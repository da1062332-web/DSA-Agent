// TEST-SEC-001 cases for P1-04 multi-lender matching (owner: Dipanshu). Tenant B holds lender_match.run and still must not read the
// prefill or the latest run of tenant A's application, nor run a match on it, nor see tenant A's policies in its own run.
import { createIdGenerator } from '@dsa/kernel';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv, type TenantFixture } from '../harness';

let env: IsolationEnv;
const ids = createIdGenerator();
let appA: string;
let appB: string;

async function seedApplication(t: TenantFixture): Promise<string> {
  const id = ids.next('app');
  const customer = ids.next('cust');
  await env.admin.query(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Iso Match', $3, 'iso', 'iso')`,
    [customer, t.tenantId, t.branchId],
  );
  await env.admin.query(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, requested_amount, tenure_months,
                                       applicant_type, status, sales_owner_id, created_by, updated_by)
     values ($1, $2, $3, $4, 'PL', 500000.00, 36, 'SALARIED', 'DRAFT', $5, 'iso', 'iso')`,
    [id, t.tenantId, t.branchId, customer, t.userIds[0]],
  );
  return id;
}

/** One matchable policy in tenant A: empanelled lender, active PL product, active policy. */
async function seedPolicy(t: TenantFixture): Promise<void> {
  const [lnd, prd, prv] = [ids.next('lnd'), ids.next('prd'), ids.next('prv')];
  const q = (text: string, values: unknown[]) => env.admin.query(text, values);
  await q(
    `insert into app.lender (id, tenant_id, name, lender_type, created_by, updated_by) values ($1, $2, 'Iso Lender', 'NBFC', 'iso', 'iso')`,
    [lnd, t.tenantId],
  );
  await q(
    `insert into app.loan_product (id, tenant_id, lender_id, name, category, applicant_types, secured, created_by, updated_by)
     values ($1, $2, $3, 'Iso PL', 'PL', '{SALARIED}', false, 'iso', 'iso')`,
    [prd, t.tenantId, lnd],
  );
  await q(
    `insert into app.loan_product_version (id, tenant_id, product_id, version_no, effective_from, amount_min, amount_max, currency,
                                           tenure_min_months, tenure_max_months, created_by)
     values ($1, $2, $3, 1, '2026-01-01T00:00:00Z', 50000, 1000000, 'INR', 12, 60, 'iso')`,
    [prv, t.tenantId, prd],
  );
  await q(
    `insert into app.empanelment (id, tenant_id, organisation_id, lender_id, dsa_code, valid_range, permitted_categories, created_by, updated_by)
     values ($1, $2, $3, $4, 'ISO-DSA', daterange(current_date - 30, current_date + 365), '{PL}', 'iso', 'iso')`,
    [ids.next('emp'), t.tenantId, t.orgId, lnd],
  );
  await q(
    `insert into app.lender_policy (id, tenant_id, lender_id, product_version_id, status, version_no, rate_min_bps, rate_max_bps,
                                    effective_from, editors, approved_by, approved_at, created_by, updated_by)
     values ($1, $2, $3, $4, 'ACTIVE', 1, 1000, 1200, '2026-01-01T00:00:00Z', $5, $6, now(), 'iso', 'iso')`,
    [ids.next('lpo'), t.tenantId, lnd, prv, [t.userIds[0]], t.userIds[1]],
  );
}

beforeAll(async () => {
  env = await startIsolationEnv();
  await seedPolicy(env.A);
  appA = await seedApplication(env.A);
  appB = await seedApplication(env.B);
  const run = await request(env.appAs(env.A, ['lender_match.run']))
    .post(`/v1/applications/${appA}/lender-matches`)
    .set('Idempotency-Key', 'iso-lmr-a-0001')
    .send({});
  expect(run.status).toBe(201);
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

describe('TEST-SEC-001 lender matches: tenants never cross', () => {
  it('P1-04: tenant B cannot read the prefill or the latest run of a tenant A application', async () => {
    const b = env.appAs(env.B, ['lender_match.run']);
    expect((await request(b).get(`/v1/applications/${appA}/lender-matches/inputs`)).status).toBe(404);
    expect((await request(b).get(`/v1/applications/${appA}/lender-matches/latest`)).status).toBe(404);
  });

  it('P1-04: tenant B cannot run a match on a tenant A application, and nothing is stored', async () => {
    const res = await request(env.appAs(env.B, ['lender_match.run']))
      .post(`/v1/applications/${appA}/lender-matches`)
      .set('Idempotency-Key', 'iso-lmr-b-0001')
      .send({});
    expect(res.status).toBe(404);
    const rows = await env.admin.query(
      `select count(*)::int as n from app.lender_match_run where tenant_id = $1`,
      [env.B.tenantId],
    );
    expect(rows.rows[0].n).toBe(0);
  });

  it("P1-04: a tenant B run on its own application never evaluates tenant A's policies", async () => {
    const res = await request(env.appAs(env.B, ['lender_match.run']))
      .post(`/v1/applications/${appB}/lender-matches`)
      .set('Idempotency-Key', 'iso-lmr-b-0002')
      .send({});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ policyCount: 0, results: [] });
  });
});
