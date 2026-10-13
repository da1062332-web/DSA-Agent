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
});
