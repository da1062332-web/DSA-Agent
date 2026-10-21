// MOD-TEN tenant lifecycle (API-TEN-001, 003..006) and the entitlements gate against a real database (M-082), as platform
// operators, with the production wiring. Synthetic data only.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { createProductionDeps } from '../src/wiring';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { fakeAuth, testPrincipal } from './support/fake-auth';
import type { PermissionCode } from '@dsa/contracts';

const PLATFORM = 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG';
const OPS: PermissionCode[] = [
  'platform.console',
  'platform.tenant.create',
  'platform.tenant.suspend',
  'platform.tenant.offboard',
  'platform.tenant.entitlements',
];
let env: IsolationEnv;

beforeAll(async () => {
  env = await startIsolationEnv();
  for (const [id, n] of [
    ['usr_ten_op1', 1],
    ['usr_ten_op2', 2],
  ] as const) {
    await env.admin.query(
      `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, primary_branch_id, created_by, updated_by)
       values ($1, $2, $3, $4, 'Operator', 'br_01M4ZJ8H51XBQ0A3RWZSBVRZAP', 'iso', 'iso')`,
      [id, PLATFORM, `sub-ten-op${n}`, `op${n}@platform.example.com`],
    );
  }
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

const operator = (id: string) =>
  createApp({
    deps: createProductionDeps(createTxRunner(env.db)),
    corsAllowedOrigins: [],
    auth: fakeAuth(
      testPrincipal({
        id,
        tenantId: PLATFORM,
        authTime: new Date().toISOString(),
        grants: OPS.map((code) => ({ code, scope: 'TENANT', branchIds: [] })),
      }),
    ),
  });

describe('TEST-TEN-INT tenant lifecycle', () => {
  let tenantId = '';

  it('TEST-TEN-INT-01 API-TEN-001 provisions tenant, organisation, branch, admin role and an INVITED admin; a taken slug is 409', async () => {
    const body = {
      slug: 'acme-dsa',
      legalName: 'Acme DSA Pvt Ltd',
      tenantType: 'DSA_ORG',
      admin: { email: 'owner@acme-dsa.example.com', displayName: 'Acme Owner' },
    };
    const res = await request(operator('usr_ten_op1'))
      .post('/platform/v1/tenants')
      .set('Idempotency-Key', 'ten_create_00001')
      .send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    tenantId = res.body.id;
    const rows = await env.admin.query(
      `select (select status from app.app_user where id = $2) as admin_status,
              (select count(*)::int from app.role_permission where tenant_id = $1) as perms,
              (select count(*)::int from app.role_permission where tenant_id = $1 and permission_code like 'platform.%') as platform_perms`,
      [tenantId, res.body.adminUserId],
    );
    expect(rows.rows[0].admin_status).toBe('INVITED');
    expect(rows.rows[0].perms).toBeGreaterThan(50);
    expect(rows.rows[0].platform_perms).toBe(0);
    const taken = await request(operator('usr_ten_op1'))
      .post('/platform/v1/tenants')
      .set('Idempotency-Key', 'ten_create_00002')
      .send(body);
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('TENANT_SLUG_TAKEN');
  });

  it('TEST-TEN-INT-02 API-TEN-003/004 suspends and reactivates; a second suspend is refused', async () => {
    const app = operator('usr_ten_op1');
    const s = await request(app)
      .post(`/platform/v1/tenants/${tenantId}/suspension`)
      .set('Idempotency-Key', 'ten_susp_000001')
      .send({ reason: 'Unpaid invoice' });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    const again = await request(app)
      .post(`/platform/v1/tenants/${tenantId}/suspension`)
      .set('Idempotency-Key', 'ten_susp_000002')
      .send({ reason: 'Again' });
    expect(again.status).toBe(409);
    const r = await request(app)
      .post(`/platform/v1/tenants/${tenantId}/reactivation`)
      .set('Idempotency-Key', 'ten_react_00001')
      .send({ reason: 'Paid' });
    expect(r.status).toBe(200);
  });

  it('TEST-TEN-INT-03 API-TEN-006 entitlements are versioned, and a disabled module answers 403 MODULE_NOT_ENABLED', async () => {
    const put = await request(operator('usr_ten_op1'))
      .put(`/platform/v1/tenants/${env.A.tenantId}/entitlements`)
      .set('If-Match', '"0"')
      .send({ modules: { 'MOD-WFA': false } });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.version).toBe(1);
    const stale = await request(operator('usr_ten_op1'))
      .put(`/platform/v1/tenants/${env.A.tenantId}/entitlements`)
      .set('If-Match', '"0"')
      .send({ modules: {} });
    expect(stale.status).toBe(409);
    const gated = await request(env.appAs(env.A, ['automation.read'])).get('/v1/automations');
    expect(gated.status).toBe(403);
    expect(gated.body.error.code).toBe('MODULE_NOT_ENABLED');
    expect((await request(env.appAs(env.B, ['automation.read'])).get('/v1/automations')).status).toBe(200);
  });

  it('TEST-TEN-INT-04 API-TEN-005 needs two different approvers', async () => {
    const first = await request(operator('usr_ten_op1'))
      .post(`/platform/v1/tenants/${tenantId}/offboarding`)
      .set('Idempotency-Key', 'ten_off_0000001')
      .send({ reason: 'Contract ended' });
    expect(first.status, JSON.stringify(first.body)).toBe(202);
    expect(first.body.state).toBe('AWAITING_SECOND_APPROVER');
    const self = await request(operator('usr_ten_op1'))
      .post(`/platform/v1/tenants/${tenantId}/offboarding`)
      .set('Idempotency-Key', 'ten_off_0000002')
      .send({ reason: 'Contract ended' });
    expect(self.status).toBe(403);
    const second = await request(operator('usr_ten_op2'))
      .post(`/platform/v1/tenants/${tenantId}/offboarding`)
      .set('Idempotency-Key', 'ten_off_0000003')
      .send({ reason: 'Contract ended' });
    expect(second.status).toBe(200);
    expect(second.body.state).toBe('OFFBOARDING');
  });

  it('TEST-TEN-INT-05 a customer tenant administrator cannot use any of it', async () => {
    const res = await request(env.appAs(env.A, OPS))
      .post(`/platform/v1/tenants/${env.B.tenantId}/suspension`)
      .set('Idempotency-Key', 'ten_hostile_0001')
      .send({ reason: 'Hostile' });
    expect(res.status).toBe(403);
  });
});
