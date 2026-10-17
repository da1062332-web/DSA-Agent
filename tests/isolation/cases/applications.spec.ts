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
});
