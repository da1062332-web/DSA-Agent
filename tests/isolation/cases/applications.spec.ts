// TEST-SEC-001 cases for origination/applications (owner: Dev 3, MOD-APP, Module 16). A tenant B principal with every
// application permission must not see, edit or hold tenant A applications. The full scope matrix is in
// apps/api/test/applications.int.spec.ts.
import type { PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ADMIN, startIsolationEnv, type IsolationEnv } from '../harness';

let env: IsolationEnv;
let appId: string;
beforeAll(async () => {
  env = await startIsolationEnv();
  appId = 'app_iso_mod16_a1';
  await env.admin.query(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ('cust_iso_mod16_a1', $1, 'INDIVIDUAL', 'Isolation Customer', $2, $3, $3)`,
    [env.A.tenantId, env.A.branchId, env.A.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, requested_amount,
        applicant_type, sales_owner_id, created_by, updated_by)
     values ($1, $2, $3, 'cust_iso_mod16_a1', 'PL', 300000.00, 'SALARIED', $4, $4, $4)`,
    [appId, env.A.tenantId, env.A.branchId, env.A.userIds[0]],
  );
});
afterAll(async () => {
  await env?.stop();
});

const APP_CODES: PermissionCode[] = ['application.read', 'application.update'];

describe('TEST-SEC-001 origination/applications: tenants never cross', () => {
  it('API-APP-002 API-APP-003: tenant B cannot list or read tenant A applications', async () => {
    const a = env.appAs(env.A, APP_CODES);
    const b = env.appAs(env.B, [...ALL_ADMIN, ...APP_CODES]);
    const list = await request(a).get('/v1/applications?limit=200');
    expect(list.status).toBe(200);
    const bList = await request(b).get('/v1/applications?limit=200');
    const aIds = list.body.data.map((x: { id: string }) => x.id);
    const bIds = bList.body.data.map((x: { id: string }) => x.id);
    for (const id of aIds) expect(bIds).not.toContain(id);
    if (aIds[0]) expect((await request(b).get(`/v1/applications/${aIds[0]}`)).status).toBe(404);
  });

  it('API-APP-004 API-APP-010: tenant B cannot edit or hold a tenant A application, even with the right version', async () => {
    const a = env.appAs(env.A, APP_CODES);
    const b = env.appAs(env.B, [...ALL_ADMIN, ...APP_CODES]);
    const id = appId;
    const current = await request(a).get(`/v1/applications/${id}`);
    const etag = current.headers.etag as string;
    expect(
      (await request(b).patch(`/v1/applications/${id}`).set('If-Match', etag).send({ tenureMonths: 12 }))
        .status,
    ).toBe(404);
    expect(
      (
        await request(b)
          .put(`/v1/applications/${id}/hold`)
          .set('If-Match', etag)
          .send({ onHold: true, reason: 'Hostile' })
      ).status,
    ).toBe(404);
    const after = await request(a).get(`/v1/applications/${id}`);
    expect(after.body.onHold).toBe(false);
  });

  it('API-APP-005: tenant B with every permission cannot move a tenant A application (404), and it stays put', async () => {
    const a = env.appAs(env.A, [...APP_CODES, 'application.review', 'application.cancel']);
    const b = env.appAs(env.B, [...ALL_ADMIN, ...APP_CODES, 'application.review', 'application.cancel']);
    const current = await request(a).get(`/v1/applications/${appId}`);
    const etag = current.headers.etag as string;
    const res = await request(b)
      .post(`/v1/applications/${appId}/transitions`)
      .set('If-Match', etag)
      .set('Idempotency-Key', 'iso-app-trn-hostile-1')
      .send({ transitionCode: 'T-APP-10', cancelReason: 'OTHER' });
    expect(res.status).toBe(404);
    const after = await request(a).get(`/v1/applications/${appId}`);
    expect(after.body.status).toBe('DRAFT');
  });

  it('API-ELG-001 API-ELG-002 API-ELG-003: tenant B cannot assess, read or override a tenant A eligibility assessment', async () => {
    const a = env.appAs(env.A, APP_CODES);
    const b = env.appAs(env.B, [...ALL_ADMIN, ...APP_CODES, 'eligibility.override']);
    // An application with a product, so tenant A can run an assessment.
    await env.admin.query(
      `insert into app.lender (id, tenant_id, name, lender_type, created_by, updated_by)
       values ('lnd_iso_elg_a1', $1, 'Isolation Eligibility Lender', 'NBFC', $2, $2)`,
      [env.A.tenantId, env.A.userIds[0]],
    );
    await env.admin.query(
      `insert into app.loan_product (id, tenant_id, lender_id, name, category, applicant_types, secured, created_by, updated_by)
       values ('prd_iso_elg_a1', $1, 'lnd_iso_elg_a1', 'Isolation Eligibility Product', 'PL', '{SALARIED}', false, $2, $2)`,
      [env.A.tenantId, env.A.userIds[0]],
    );
    await env.admin.query(
      `insert into app.loan_product_version (id, tenant_id, product_id, version_no, effective_from, amount_min, amount_max,
                                             currency, tenure_min_months, tenure_max_months, created_by)
       values ('prv_iso_elg_a1', $1, 'prd_iso_elg_a1', 1, '2026-01-01T00:00:00Z', 50000, 1000000, 'INR', 12, 60, $2)`,
      [env.A.tenantId, env.A.userIds[0]],
    );
    await env.admin.query(
      `update app.loan_application set product_version_id = 'prv_iso_elg_a1', status = 'DOCUMENTS_PENDING' where id = $1`,
      [appId],
    );

    const run = await request(a)
      .post(`/v1/applications/${appId}/eligibility-assessments`)
      .set('Idempotency-Key', 'iso-elg-run-1')
      .send({});
    expect(run.status).toBe(201);

    expect(
      (
        await request(b)
          .post(`/v1/applications/${appId}/eligibility-assessments`)
          .set('Idempotency-Key', 'iso-elg-run-hostile')
          .send({})
      ).status,
    ).toBe(404);
    expect((await request(b).get(`/v1/applications/${appId}/eligibility-assessments`)).status).toBe(404);
    expect(
      (
        await request(b)
          .post(`/v1/eligibility-assessments/${run.body.id}/overrides`)
          .set('Idempotency-Key', 'iso-elg-override-hostile')
          .send({ productVersionId: 'prv_iso_elg_a1', reason: 'Hostile override attempt' })
      ).status,
    ).toBe(404);
    const history = await request(a).get(`/v1/applications/${appId}/eligibility-assessments`);
    expect(history.body.data[0].overrides).toEqual([]);
  });

  it('API-ELG-004 API-ELG-005 API-ELG-006: tenant B cannot read or change tenant A applicant figures, or see its latest assessment', async () => {
    const a = env.appAs(env.A, APP_CODES);
    const b = env.appAs(env.B, [...ALL_ADMIN, ...APP_CODES]);
    await env.admin.query(`update app.loan_application set status = 'DOCUMENTS_PENDING' where id = $1`, [
      appId,
    ]);
    const stored = await request(a)
      .put(`/v1/applications/${appId}/eligibility-inputs`)
      .set('If-Match', '"0"')
      .send({
        declaredMonthlyIncome: { amount: '45000.00', currency: 'INR' },
        declaredIncomeSource: 'APPLICANT_STATED',
      });
    expect(stored.status).toBe(200);
    expect((await request(b).get(`/v1/applications/${appId}/eligibility-inputs`)).status).toBe(404);
    expect(
      (
        await request(b)
          .put(`/v1/applications/${appId}/eligibility-inputs`)
          .set('If-Match', '"1"')
          .send({ declaredMonthlyIncome: null, declaredIncomeSource: null })
      ).status,
    ).toBe(404);
    expect((await request(b).get(`/v1/applications/${appId}/eligibility-assessments/latest`)).status).toBe(
      404,
    );
    const kept = await env.admin.query(
      `select declared_monthly_income_amount from app.applicant_financial_input where application_id = $1`,
      [appId],
    );
    expect(kept.rows[0].declared_monthly_income_amount).toBe('45000.00');
  });
});

describe('TEST-SEC-001 origination/applications: create, parties, owners, checklist and lifecycle never cross', () => {
  const A_PARTY = 'pty_iso_mod16_a1';
  const A_ITEM = 'chk_iso_mod16_a1';
  const A_WITHDRAWN = 'app_iso_mod16_a2';
  const B_CUST = 'cust_iso_mod16_b1';
  const B_APP = 'app_iso_mod16_b1';
  const EVERY: PermissionCode[] = [
    'application.create',
    'application.read',
    'application.update',
    'application.review',
    'application.cancel',
    'application.withdraw',
    'application.reopen',
    'application.assign',
    'document.waive',
  ];
  let seq = 0;
  const key = (label: string) => `iso-mod16-${label}-${seq++}`;
  const etagOf = async (id: string) =>
    `"${(await env.admin.query(`select lock_version from app.loan_application where id = $1`, [id])).rows[0].lock_version}"`;
  const appRow = async (id: string) =>
    (
      await env.admin.query(
        `select status, sales_owner_id, ops_owner_id, lock_version from app.loan_application where id = $1`,
        [id],
      )
    ).rows[0];
  const hostile = () => env.appAs(env.B, [...ALL_ADMIN, ...EVERY]);

  beforeAll(async () => {
    const a = env.A;
    const b = env.B;
    const q = (text: string, values: unknown[]) => env.admin.query(text, values);
    await q(
      `insert into app.application_party (id, tenant_id, application_id, customer_id, role, party_type, created_by)
       values ($1, $2, $3, 'cust_iso_mod16_a1', 'PRIMARY', 'INDIVIDUAL', $4)`,
      [A_PARTY, a.tenantId, appId, a.userIds[0]],
    );
    await q(
      `insert into app.checklist_item (id, tenant_id, application_id, party_id, document_type_code, mandatory,
                                       source_decision_id, created_by, updated_by)
       values ($1, $2, $3, $4, 'BANK_STATEMENT', true, 'dr_iso_mod16', $5, $5)`,
      [A_ITEM, a.tenantId, appId, A_PARTY, a.userIds[0]],
    );
    // A withdrawn tenant A application (with the product version the eligibility case created), for the reopen attempt.
    await q(
      `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, product_version_id,
          requested_amount, applicant_type, status, sales_owner_id, created_by, updated_by)
       values ($1, $2, $3, 'cust_iso_mod16_a1', 'PL', 'prv_iso_elg_a1', 200000.00, 'SALARIED', 'WITHDRAWN', $4, $4, $4)`,
      [A_WITHDRAWN, a.tenantId, a.branchId, a.userIds[0]],
    );
    // Tenant B's own customer and draft, which it might try to fill with tenant A's records.
    await q(
      `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
       values ($1, $2, 'INDIVIDUAL', 'Isolation Customer B', $3, $4, $4)`,
      [B_CUST, b.tenantId, b.branchId, b.userIds[0]],
    );
    await q(
      `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, requested_amount,
          applicant_type, status, sales_owner_id, created_by, updated_by)
       values ($1, $2, $3, $4, 'PL', 150000.00, 'SALARIED', 'DRAFT', $5, $5, $5)`,
      [B_APP, b.tenantId, b.branchId, B_CUST, b.userIds[0]],
    );
    await q(
      `insert into app.application_party (id, tenant_id, application_id, customer_id, role, party_type, created_by)
       values ('pty_iso_mod16_b1', $1, $2, $3, 'PRIMARY', 'INDIVIDUAL', $4)`,
      [b.tenantId, B_APP, B_CUST, b.userIds[0]],
    );
  });

  it('API-APP-001: tenant B cannot open an application for a tenant A customer or in a tenant A branch', async () => {
    const b = hostile();
    const base = {
      productCategory: 'PL',
      requestedAmount: { amount: '250000.00', currency: 'INR' },
      applicantType: 'SALARIED',
    };
    const foreignCustomer = await request(b)
      .post('/v1/applications')
      .set('Idempotency-Key', key('create-cust'))
      .send({ ...base, customerId: 'cust_iso_mod16_a1', branchId: env.B.branchId });
    expect(foreignCustomer.status, JSON.stringify(foreignCustomer.body)).toBe(404);
    const foreignBranch = await request(b)
      .post('/v1/applications')
      .set('Idempotency-Key', key('create-branch'))
      .send({ ...base, customerId: B_CUST, branchId: env.A.branchId });
    expect(foreignBranch.status, JSON.stringify(foreignBranch.body)).toBe(422);
    const leaked = await env.admin.query(
      `select count(*)::int as n from app.loan_application
        where tenant_id = $1 and (customer_id = 'cust_iso_mod16_a1' or branch_id = $2)`,
      [env.B.tenantId, env.A.branchId],
    );
    expect(leaked.rows[0].n).toBe(0);
  });

  it('API-APP-006 API-APP-006-LIST: tenant B cannot read or change tenant A parties, nor add a tenant A customer to its own draft', async () => {
    const b = hostile();
    expect((await request(b).get(`/v1/applications/${appId}/parties`)).status).toBe(404);
    const onA = await request(b)
      .post(`/v1/applications/${appId}/parties`)
      .set('If-Match', await etagOf(appId))
      .set('Idempotency-Key', key('party-a'))
      .send({ action: 'ADD', customerId: B_CUST, role: 'CO_APPLICANT' });
    expect(onA.status).toBe(404);
    const removeA = await request(b)
      .post(`/v1/applications/${appId}/parties`)
      .set('If-Match', await etagOf(appId))
      .set('Idempotency-Key', key('party-a-rm'))
      .send({ action: 'REMOVE', partyId: A_PARTY });
    expect(removeA.status).toBe(404);
    const pullIn = await request(b)
      .post(`/v1/applications/${B_APP}/parties`)
      .set('If-Match', await etagOf(B_APP))
      .set('Idempotency-Key', key('party-b'))
      .send({ action: 'ADD', customerId: 'cust_iso_mod16_a1', role: 'GUARANTOR' });
    // A customer of another tenant is answered exactly like a customer that does not exist, so nothing leaks.
    const missing = await request(b)
      .post(`/v1/applications/${B_APP}/parties`)
      .set('If-Match', await etagOf(B_APP))
      .set('Idempotency-Key', key('party-b-missing'))
      .send({ action: 'ADD', customerId: 'cust_iso_mod16_absent', role: 'GUARANTOR' });
    expect(pullIn.status, JSON.stringify(pullIn.body)).toBe(missing.status);
    expect(pullIn.body.error.code).toBe(missing.body.error.code);
    expect(pullIn.body.error.details).toEqual(missing.body.error.details);
    expect(pullIn.status).toBe(404);
    expect(pullIn.body.error.code).toBe('NOT_FOUND');
    const parties = await env.admin.query(
      `select application_id, removed_at from app.application_party where id = $1 or customer_id = $2`,
      [A_PARTY, 'cust_iso_mod16_a1'],
    );
    // Tenant A's customer is a party only on tenant A's applications, and nothing was removed.
    expect(parties.rows.every((r) => r.application_id !== B_APP && r.removed_at === null)).toBe(true);
  });

  it('API-APP-007-GENERATE API-APP-008: tenant B cannot build or check the tenant A checklist', async () => {
    const b = hostile();
    const count = async () =>
      (
        await env.admin.query(`select count(*)::int as n from app.checklist_item where application_id = $1`, [
          appId,
        ])
      ).rows[0].n;
    const before = await count();
    expect((await request(b).post(`/v1/applications/${appId}/checklist/generate`).send({})).status).toBe(404);
    expect((await request(b).post(`/v1/applications/${appId}/completeness-checks`).send({})).status).toBe(
      404,
    );
    expect(await count()).toBe(before);
    const app = await env.admin.query(
      `select last_completeness_result from app.loan_application where id = $1`,
      [appId],
    );
    expect(app.rows[0].last_completeness_result).toBeNull();
  });

  it('API-APP-009: tenant B cannot waive a tenant A checklist item, through the tenant A application or its own', async () => {
    const b = hostile();
    const body = { checklistItemId: A_ITEM, status: 'WAIVED', reason: 'Hostile waiver attempt' };
    const viaA = await request(b)
      .post(`/v1/applications/${appId}/waivers`)
      .set('Idempotency-Key', key('waive-a'))
      .send(body);
    expect(viaA.status).toBe(404);
    const viaOwn = await request(b)
      .post(`/v1/applications/${B_APP}/waivers`)
      .set('Idempotency-Key', key('waive-b'))
      .send(body);
    expect(viaOwn.status, JSON.stringify(viaOwn.body)).toBe(404);
    const item = await env.admin.query(`select status from app.checklist_item where id = $1`, [A_ITEM]);
    expect(item.rows[0].status).toBe('PENDING');
  });

  it('API-APP-011: tenant B cannot reassign the owners of a tenant A application', async () => {
    const b = hostile();
    const before = await appRow(appId);
    const res = await request(b)
      .post(`/v1/applications/${appId}/assignments`)
      .set('If-Match', await etagOf(appId))
      .set('Idempotency-Key', key('assign'))
      .send({
        salesOwnerUserId: env.B.userIds[0],
        opsOwnerUserId: env.B.userIds[1],
        reason: 'Hostile reassignment',
      });
    expect(res.status).toBe(404);
    expect(await appRow(appId)).toEqual(before);
  });

  it('API-APP-005 T-APP-08 T-APP-09: tenant B cannot withdraw or reopen tenant A applications; tenant A can', async () => {
    const b = hostile();
    const open = await appRow(appId);
    const withdraw = await request(b)
      .post(`/v1/applications/${appId}/transitions`)
      .set('If-Match', await etagOf(appId))
      .set('Idempotency-Key', key('withdraw'))
      .send({ transitionCode: 'T-APP-08', reason: 'Hostile withdraw attempt' });
    expect(withdraw.status).toBe(404);
    expect(await appRow(appId)).toEqual(open);

    const reopen = await request(b)
      .post(`/v1/applications/${A_WITHDRAWN}/transitions`)
      .set('If-Match', await etagOf(A_WITHDRAWN))
      .set('Idempotency-Key', key('reopen'))
      .send({ transitionCode: 'T-APP-09', reason: 'Hostile reopen attempt' });
    expect(reopen.status).toBe(404);
    expect((await appRow(A_WITHDRAWN)).status).toBe('WITHDRAWN');

    // The same request from tenant A works, so the 404 above is the tenant boundary and not a broken route.
    const own = await request(env.appAs(env.A, EVERY))
      .post(`/v1/applications/${A_WITHDRAWN}/transitions`)
      .set('If-Match', await etagOf(A_WITHDRAWN))
      .set('Idempotency-Key', key('reopen-own'))
      .send({ transitionCode: 'T-APP-09', reason: 'Customer came back' });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(own.body.status).toBe('DRAFT');
  });
});
