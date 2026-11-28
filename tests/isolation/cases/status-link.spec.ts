// TEST-SEC-001 cases for the customer status link (task P3-05, checklist 6). Tenant B cannot create a status link for tenant A's
// application (404), and a link that names tenant B is never resolved to tenant A's application. The reads (the stage and the pending
// documents) run here against Postgres under row-level security. The token rules and the view are in apps/api/test/status-link.spec.ts.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentDeps } from '../../../apps/api/src/modules/origination/applications/documents';
import { StatusLinkSigner } from '../../../apps/api/src/modules/origination/applications/status-link';
import { startIsolationEnv, type IsolationEnv } from '../harness';

let env: IsolationEnv;
const APP_A = 'app_iso_sl_a1';
const CUSTOMER_A = 'cust_iso_sl_a1';
const PARTY_A = 'apty_iso_sl_a1';
const DOC_TYPE_A = 'dt_iso_sl_a1';
const ITEM_A = 'cli_iso_sl_a1';

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  await env.admin.query(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Isolation Borrower', $3, $4, $4)`,
    [CUSTOMER_A, a.tenantId, a.branchId, a.userIds[0]],
  );
  // A file past Draft needs a product version (loan_application check). The applications case builds the same chain.
  await env.admin.query(
    `insert into app.lender (id, tenant_id, name, lender_type, created_by, updated_by)
     values ('lnd_iso_sl_a1', $1, 'Isolation Status Lender', 'NBFC', $2, $2)`,
    [a.tenantId, a.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_product (id, tenant_id, lender_id, name, category, applicant_types, secured, created_by, updated_by)
     values ('prd_iso_sl_a1', $1, 'lnd_iso_sl_a1', 'Isolation Status Product', 'HL', '{SALARIED}', true, $2, $2)`,
    [a.tenantId, a.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_product_version (id, tenant_id, product_id, version_no, effective_from, amount_min, amount_max,
                                           currency, tenure_min_months, tenure_max_months, created_by)
     values ('prv_iso_sl_a1', $1, 'prd_iso_sl_a1', 1, '2026-01-01T00:00:00Z', 50000, 10000000, 'INR', 12, 240, $2)`,
    [a.tenantId, a.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, requested_amount,
        applicant_type, sales_owner_id, created_by, updated_by)
     values ($1, $2, $3, $4, 'HL', 3750000.00, 'SALARIED', $5, $5, $5)`,
    [APP_A, a.tenantId, a.branchId, CUSTOMER_A, a.userIds[0]],
  );
  await env.admin.query(
    `update app.loan_application set product_version_id = 'prv_iso_sl_a1', status = 'DOCUMENTS_PENDING' where id = $1`,
    [APP_A],
  );
  await env.admin.query(
    `insert into app.application_party (id, tenant_id, application_id, customer_id, role, party_type, created_by)
     values ($1, $2, $3, $4, 'PRIMARY', 'INDIVIDUAL', $5)`,
    [PARTY_A, a.tenantId, APP_A, CUSTOMER_A, a.userIds[0]],
  );
  await env.admin.query(
    `insert into app.document_type (id, tenant_id, code, name, category, created_by, updated_by)
     values ($1, $2, 'SALARY_SLIP', 'Salary slip', 'INCOME', $3, $3)`,
    [DOC_TYPE_A, a.tenantId, a.userIds[0]],
  );
  await env.admin.query(
    `insert into app.checklist_item (id, tenant_id, application_id, party_id, document_type_code, ordinal, mandatory, status,
        source_decision_id, created_by, updated_by)
     values ($1, $2, $3, $4, 'SALARY_SLIP', 1, true, 'PENDING', 'dec_iso_sl_a1', $5, $5)`,
    [ITEM_A, a.tenantId, APP_A, PARTY_A, a.userIds[0]],
  );
});
afterAll(async () => {
  await env?.stop();
});

describe('TEST-SEC-001 customer status link: tenants never cross', () => {
  it('TEST-SEC-001 tenant B cannot create a status link for tenant A application (404)', async () => {
    const res = await request(env.appAs(env.B, ['application.read'])).post(`/v1/applications/${APP_A}/status-link`);
    expect(res.status).toBe(404);
  });

  it('TEST-SEC-001 tenant A creates a link, and the customer view shows the stage and the pending salary slip', async () => {
    const created = await request(env.appAs(env.A, ['application.read'])).post(`/v1/applications/${APP_A}/status-link`);
    expect(created.status).toBe(201);
    const token = String(created.body.url).slice('/status/'.length);

    const view = await request(env.anonymousApp()).get(`/public/v1/status/${token}`);
    expect(view.status).toBe(200);
    expect(view.body.stage).toBe('Under processing');
    expect(view.body.pendingDocuments).toEqual([{ name: 'Salary slip', status: 'PENDING', label: 'Pending' }]);
    expect(Object.keys(view.body).sort()).toEqual([
      'application',
      'expiresAt',
      'lastUpdated',
      'pendingDocuments',
      'progress',
      'stage',
    ]);
    expect(view.body.progress.currentIndex).toBe(1);
    expect(view.body.application).toMatchObject({ loanType: 'Home loan', appliedOn: expect.any(String) });
    expect(view.body.application.reference).toBe(created.body.reference);
    expect(JSON.stringify(view.body)).not.toContain(APP_A);
  });

  it('TEST-SEC-001 a link that names tenant B for tenant A application never resolves (410, no detail)', async () => {
    const forged = new StatusLinkSigner(documentDeps(env.deps).secret).sign({
      t: env.B.tenantId,
      a: APP_A,
      e: Math.floor(Date.now() / 1000) + 3600,
    });
    const res = await request(env.anonymousApp()).get(`/public/v1/status/${forged}`);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('LINK_EXPIRED');
    expect(JSON.stringify(res.body)).not.toContain('Salary slip');
  });
});
