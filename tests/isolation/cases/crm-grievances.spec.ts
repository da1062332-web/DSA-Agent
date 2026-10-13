// TEST-SEC-001 cases for crm/grievances (owner: Dev 3, MOD-GRV, Module 13). Tenant B holds every complaint permission and
// still must not see, change, resolve or complain about tenant A's records.
import type { PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ADMIN, startIsolationEnv, type IsolationEnv, type TenantFixture } from '../harness';

/** Handlers hold both grievance permissions, plus the admin ones the shared harness fixtures already use. */
const GRV: PermissionCode[] = [...ALL_ADMIN, 'complaint.create', 'complaint.manage'];

let env: IsolationEnv;
beforeAll(async () => {
  env = await startIsolationEnv();
});
afterAll(async () => {
  await env?.stop();
});

async function seedApplication(t: TenantFixture, appId: string, customerId: string) {
  await env.admin.query(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Isolation Customer', $3, $4, $4)`,
    [customerId, t.tenantId, t.branchId, t.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, requested_amount,
                                       applicant_type, sales_owner_id, created_by, updated_by)
     values ($1, $2, $3, $4, 'PL', 100000.00, 'SALARIED', $5, $5, $5)`,
    [appId, t.tenantId, t.branchId, customerId, t.userIds[0]],
  );
}

const BODY = { channel: 'PHONE', category: 'SERVICE', description: 'Tenant A complaint about a callback' };

describe('TEST-SEC-001 crm/grievances: tenants never cross', () => {
  it('API-GRV-001: tenant B cannot complain about a tenant A application (404, not 403)', async () => {
    await seedApplication(env.A, 'app_iso_grv_a1', 'cust_iso_grv_a1');
    const b = env.appAs(env.B, GRV);
    const res = await request(b)
      .post('/v1/complaints')
      .set('Idempotency-Key', 'iso-grv-intake-01')
      .send({ ...BODY, complainantType: 'APPLICATION', complainantId: 'app_iso_grv_a1' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('API-GRV-001 API-GRV-002 API-GRV-002-GET: tenant B cannot read or list tenant A complaints', async () => {
    await seedApplication(env.A, 'app_iso_grv_a2', 'cust_iso_grv_a2');
    const a = env.appAs(env.A, GRV);
    const b = env.appAs(env.B, GRV);
    const own = await request(a)
      .post('/v1/complaints')
      .set('Idempotency-Key', 'iso-grv-read-own')
      .send({ ...BODY, complainantType: 'APPLICATION', complainantId: 'app_iso_grv_a2' });
    expect(own.status).toBe(201);

    expect((await request(b).get(`/v1/complaints/${own.body.id}`)).status).toBe(404);
    const list = await request(b).get('/v1/complaints');
    expect(list.body.data.map((c: { id: string }) => c.id)).not.toContain(own.body.id);
  });

  it('API-GRV-003 API-GRV-004: tenant B cannot assign, refer or resolve tenant A complaints, even with the right version', async () => {
    await seedApplication(env.A, 'app_iso_grv_a3', 'cust_iso_grv_a3');
    const a = env.appAs(env.A, GRV);
    const b = env.appAs(env.B, GRV);
    const own = await request(a)
      .post('/v1/complaints')
      .set('Idempotency-Key', 'iso-grv-write-own')
      .send({ ...BODY, complainantType: 'APPLICATION', complainantId: 'app_iso_grv_a3' });
    const version = own.headers.etag as string;

    const assign = await request(b)
      .patch(`/v1/complaints/${own.body.id}`)
      .set('If-Match', version)
      .send({ ownerUserId: env.B.userIds[0] });
    expect(assign.status).toBe(404);

    const refer = await request(b)
      .patch(`/v1/complaints/${own.body.id}`)
      .set('If-Match', version)
      .send({ lenderReferral: { lenderId: 'lnd_hostile_1', reference: 'HOSTILE-1' } });
    expect(refer.status).toBe(404);

    const resolve = await request(b)
      .post(`/v1/complaints/${own.body.id}/resolution`)
      .set('Idempotency-Key', 'iso-grv-hostile-resolve')
      .set('If-Match', version)
      .send({ action: 'RESOLVE', resolution: 'Hostile resolution from tenant B' });
    expect(resolve.status).toBe(404);

    const after = await request(a).get(`/v1/complaints/${own.body.id}`);
    expect(after.body.status).toBe('OPEN');
    expect(after.body.ownerUserId).toBeNull();
    expect(after.body.lenderReferral).toEqual({});
  });
});
