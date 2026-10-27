// TEST-SEC-001 cases for origination/lender-cases (owner: Dev 4) — MOD-LCS Lender Cases.
// Tenant B holds every admin permission and still must not read tenant A's queries, status history or submission package.
import type { PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ADMIN, startIsolationEnv, type IsolationEnv } from '../harness';

let env: IsolationEnv;
beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  const u = a.userIds[0];
  const q = (text: string, values: unknown[]) => env.admin.query(text, values);
  await q(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ('cust_lcs_a1', $1, 'INDIVIDUAL', 'Lender Case Customer', $2, $3, $3)`,
    [a.tenantId, a.branchId, u],
  );
  await q(
    `insert into app.lead (id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash, product_category, source,
                           owner_user_id, created_by, updated_by)
     values ('lead_lcs_a1', $1, $2, 'Lender Case Lead', '+919876500077', decode('000000000000000000000000000000bb', 'hex'),
             'PL', 'PHONE', $3, $3, $3)`,
    [a.tenantId, a.branchId, u],
  );
  await q(
    `insert into app.lender (id, tenant_id, name, lender_type, created_by, updated_by) values ('lnd_lcs_a1', $1, 'Case Lender', 'NBFC', $2, $2)`,
    [a.tenantId, u],
  );
  await q(
    `insert into app.loan_product (id, tenant_id, lender_id, name, category, applicant_types, secured, status, created_by, updated_by)
     values ('prd_lcs_a1', $1, 'lnd_lcs_a1', 'Case Product', 'PL', '{SALARIED}', false, 'ACTIVE', $2, $2)`,
    [a.tenantId, u],
  );
  await q(
    `insert into app.loan_product_version (id, tenant_id, product_id, version_no, effective_from, amount_min, amount_max,
                                           currency, tenure_min_months, tenure_max_months, created_by)
     values ('prv_lcs_a1', $1, 'prd_lcs_a1', 1, '2026-01-01T00:00:00Z', 50000, 1000000, 'INR', 12, 60, $2)`,
    [a.tenantId, u],
  );
  await q(
    `insert into app.empanelment (id, tenant_id, organisation_id, lender_id, dsa_code, valid_range, permitted_categories,
                                  status, created_by, updated_by)
     values ('emp_lcs_a1', $1, $2, 'lnd_lcs_a1', 'DSA_LCS_A1', daterange(current_date - 30, current_date + 365), array['PL'],
             'ACTIVE', $3, $3)`,
    [a.tenantId, a.orgId, u],
  );
  await q(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, lead_id, product_category, product_version_id,
                                       requested_amount, applicant_type, status, sales_owner_id, created_by, updated_by)
     values ('app_lcs_a1', $1, $2, 'cust_lcs_a1', 'lead_lcs_a1', 'PL', 'prv_lcs_a1', 300000, 'SALARIED',
             'DOCUMENTS_PENDING', $3, $3, $3)`,
    [a.tenantId, a.branchId, u],
  );
  await q(
    `insert into app.lender_case (id, tenant_id, application_id, lender_id, product_version_id, empanelment_id, attempt_no,
                                  status, created_by, updated_by)
     values ('lc_lcs_a1', $1, 'app_lcs_a1', 'lnd_lcs_a1', 'prv_lcs_a1', 'emp_lcs_a1', 1, 'DRAFT', $2, $2)`,
    [a.tenantId, u],
  );
});
afterAll(async () => {
  await env?.stop();
});

describe('TEST-SEC-001 lender cases: tenants never cross', () => {
  it('API-LCS-008 API-LCS-009 API-LCS-010: queries, status history and package stay in the caller tenant', async () => {
    // Both tenants hold every admin permission plus application.read, the permission these reads need.
    const reader: PermissionCode[] = [...ALL_ADMIN, 'application.read'];
    const a = env.appAs(env.A, reader);
    const b = env.appAs(env.B, reader);

    // Tenant A reads its own case: no queries yet, no status history rows were seeded, no package built.
    const ownQueries = await request(a).get('/v1/lender-cases/lc_lcs_a1/queries');
    expect(ownQueries.status).toBe(200);
    expect(ownQueries.body.data).toEqual([]);
    const ownHistory = await request(a).get('/v1/lender-cases/lc_lcs_a1/history');
    expect(ownHistory.status).toBe(200);
    const ownPackage = await request(a).get('/v1/lender-cases/lc_lcs_a1/package');
    expect(ownPackage.status).toBe(404);

    // The tenant-wide list is paged: tenant A sees its case, tenant B's first page holds none of tenant A's cases.
    const ownList = await request(a).get('/v1/lender-cases?limit=5');
    expect(ownList.status).toBe(200);
    expect(ownList.body.data.map((c: { id: string }) => c.id)).toContain('lc_lcs_a1');
    const otherList = await request(b).get('/v1/lender-cases?limit=5');
    expect(otherList.status).toBe(200);
    expect(otherList.body.data.map((c: { id: string }) => c.id)).not.toContain('lc_lcs_a1');

    // Tenant B sees none of it: the same ids are unknown in tenant B.
    for (const path of ['queries', 'history', 'package']) {
      const res = await request(b).get(`/v1/lender-cases/lc_lcs_a1/${path}`);
      expect(res.status, path).toBe(404);
      expect(res.body.error.code, path).toBe('NOT_FOUND');
    }
  });
});
