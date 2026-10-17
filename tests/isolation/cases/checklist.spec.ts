// TEST-SEC-001 cases for the application document checklist (owner: Dev 3, MOD-DOC checklist slice, API-APP-007).
// A tenant B principal with every application permission must not read a tenant A checklist, and the list a tenant A user
// gets follows the application scope. The summary rules are tested in apps/api/test/checklist.spec.ts.
import type { PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ADMIN, startIsolationEnv, type IsolationEnv } from '../harness';

let env: IsolationEnv;
const APP = 'app_iso_chk_a1';

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  const user = a.userIds[0];
  await env.admin.query(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ('cust_iso_chk_a1', $1, 'INDIVIDUAL', 'Checklist Customer', $2, $3, $3)`,
    [a.tenantId, a.branchId, user],
  );
  await env.admin.query(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, requested_amount,
        applicant_type, sales_owner_id, created_by, updated_by)
     values ($1, $2, $3, 'cust_iso_chk_a1', 'PL', 100000.00, 'SALARIED', $4, $4, $4)`,
    [APP, a.tenantId, a.branchId, user],
  );
  await env.admin.query(
    `insert into app.application_party (id, tenant_id, application_id, customer_id, role, party_type, created_by)
     values ('pty_iso_chk_a1', $1, $2, 'cust_iso_chk_a1', 'PRIMARY', 'INDIVIDUAL', $3)`,
    [a.tenantId, APP, user],
  );
  await env.admin.query(
    `insert into app.checklist_item (id, tenant_id, application_id, party_id, document_type_code, mandatory, status, source_decision_id, created_by, updated_by)
     values ('chk_iso_1', $1, $2, 'pty_iso_chk_a1', 'PAN_CARD', true, 'PENDING', 'dec_iso', $3, $3),
            ('chk_iso_2', $1, $2, 'pty_iso_chk_a1', 'BANK_STATEMENT', false, 'WAIVED', 'dec_iso', $3, $3)`,
    [a.tenantId, APP, user],
  );
}, 240_000);

afterAll(async () => {
  await env?.stop();
});

const READ: PermissionCode[] = ['application.read'];

describe('TEST-SEC-001 application checklist: tenants never cross', () => {
  it('API-APP-007: the owning tenant reads its checklist with a summary; another tenant gets 404 and no item', async () => {
    const own = await request(env.appAs(env.A, READ)).get(`/v1/applications/${APP}/checklist`);
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(own.body.data.map((i: { id: string }) => i.id).sort()).toEqual(['chk_iso_1', 'chk_iso_2']);
    expect(own.body.summary).toMatchObject({
      total: 2,
      mandatory: 1,
      outstandingMandatory: 1,
      complete: false,
    });

    const other = await request(env.appAs(env.B, [...ALL_ADMIN, ...READ])).get(
      `/v1/applications/${APP}/checklist`,
    );
    expect(other.status).toBe(404);
    expect(JSON.stringify(other.body)).not.toContain('chk_iso');
  });

  it('API-APP-007: without application.read the call is 403, and an unknown application is 404', async () => {
    const none = await request(env.appAs(env.A, ['lead.read'])).get(`/v1/applications/${APP}/checklist`);
    expect(none.status).toBe(403);
    const missing = await request(env.appAs(env.A, READ)).get(
      '/v1/applications/app_does_not_exist/checklist',
    );
    expect(missing.status).toBe(404);
  });
});
