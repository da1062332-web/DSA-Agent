// TEST-SEC-001 cases for P2-04 lender document packs (owner: Dipanshu). Tenant B holds lender.manage and lender_case.submit and still
// must not read or change tenant A's pack profile, nor download a tenant A case's pack. Every case is 404, and nothing is written.
import { createIdGenerator } from '@dsa/kernel';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../harness';

let env: IsolationEnv;
const ids = createIdGenerator();
let lenderA = '';
let caseA = '';

beforeAll(async () => {
  env = await startIsolationEnv();
  const t = env.A;
  const q = (text: string, values: unknown[]) => env.admin.query(text, values);
  const [prd, prv, emp, cust, app] = [
    ids.next('prd'),
    ids.next('prv'),
    ids.next('emp'),
    ids.next('cust'),
    ids.next('app'),
  ];
  lenderA = ids.next('lnd');
  await q(
    `insert into app.lender (id, tenant_id, name, lender_type, created_by, updated_by) values ($1, $2, 'Iso Pack Lender', 'NBFC', 'iso', 'iso')`,
    [lenderA, t.tenantId],
  );
  await q(
    `insert into app.loan_product (id, tenant_id, lender_id, name, category, applicant_types, secured, created_by, updated_by)
     values ($1, $2, $3, 'Iso PL', 'PL', '{SALARIED}', false, 'iso', 'iso')`,
    [prd, t.tenantId, lenderA],
  );
  await q(
    `insert into app.loan_product_version (id, tenant_id, product_id, version_no, effective_from, amount_min, amount_max, currency,
                                           tenure_min_months, tenure_max_months, created_by)
     values ($1, $2, $3, 1, '2026-01-01T00:00:00Z', 50000, 1000000, 'INR', 12, 60, 'iso')`,
    [prv, t.tenantId, prd],
  );
  await q(
    `insert into app.empanelment (id, tenant_id, organisation_id, lender_id, dsa_code, valid_range, permitted_categories, created_by, updated_by)
     values ($1, $2, $3, $4, 'ISO-PACK', daterange(current_date - 30, current_date + 365), '{PL}', 'iso', 'iso')`,
    [emp, t.tenantId, t.orgId, lenderA],
  );
  await q(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Iso Pack', $3, 'iso', 'iso')`,
    [cust, t.tenantId, t.branchId],
  );
  await q(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, requested_amount, tenure_months,
                                       applicant_type, status, sales_owner_id, created_by, updated_by)
     values ($1, $2, $3, $4, 'PL', 500000.00, 36, 'SALARIED', 'DRAFT', $5, 'iso', 'iso')`,
    [app, t.tenantId, t.branchId, cust, t.userIds[0]],
  );
  const created = await request(env.appAs(t, ['lender_case.submit']))
    .post(`/v1/applications/${app}/lender-cases`)
    .send({ lenderId: lenderA, productVersionId: prv, empanelmentId: emp });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  caseA = created.body.id;
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

describe('TEST-SEC-001 lender packs: tenants never cross', () => {
  it("P2-04: tenant B cannot read or save tenant A's pack profile, and nothing is stored", async () => {
    const b = env.appAs(env.B, ['lender.manage', 'lender.read']);
    expect((await request(b).get(`/v1/lenders/${lenderA}/pack-profile`)).status).toBe(404);
    const put = await request(b)
      .put(`/v1/lenders/${lenderA}/pack-profile`)
      .set('If-Match', '"0"')
      .send({ documentOrder: ['PAN'], filenamePattern: '{seq}_{docType}' });
    expect(put.status).toBe(404);
    const rows = await env.admin.query(`select count(*)::int as n from app.lender_pack_profile`);
    expect(rows.rows[0].n).toBe(0);
  });

  it("P2-04: tenant B cannot download a tenant A case's pack, and no download is audited", async () => {
    const res = await request(env.appAs(env.B, ['lender_case.submit'])).get(`/v1/lender-cases/${caseA}/pack`);
    expect(res.status).toBe(404);
    const audited = await env.admin.query(
      `select count(*)::int as n from app.audit_event where action = 'lender_case.pack_downloaded'`,
    );
    expect(audited.rows[0].n).toBe(0);
  });

  it('P2-04: a tenant id in the body is not accepted', async () => {
    const res = await request(env.appAs(env.A, ['lender.manage']))
      .put(`/v1/lenders/${lenderA}/pack-profile`)
      .set('If-Match', '"0"')
      .send({ documentOrder: [], filenamePattern: '{seq}_{docType}', tenantId: env.B.tenantId });
    expect(res.status).toBe(422);
  });
});
