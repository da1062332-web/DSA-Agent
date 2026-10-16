// Feature flags survive an API restart (owner: Dev 1; Modules 1 and 40). The REAL server process is started, stopped and started again
// against one throwaway database; the caller is a platform-realm user with the platform role from migration 0050.
import { PLATFORM_TENANT_ID } from '@dsa/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintTestToken } from '../../../packages/kernel/src/testing/test-token';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { apiRoleUrl, call, LOCAL_JWT_SECRET, LOCAL_SUPABASE_URL, startApi } from './support/spawn-api';

let env: IsolationEnv;
let dbUrl: string;
let platformToken: string;
let customerToken: string;

beforeAll(async () => {
  env = await startIsolationEnv();
  dbUrl = apiRoleUrl(env.admin);

  // A platform operator: a user in the platform tenant holding ROLE-PLATFORM-SUPERADMIN (created by migration 0050).
  const branch = (await env.admin.query(`SELECT id FROM app.branch WHERE tenant_id = $1 LIMIT 1`, [PLATFORM_TENANT_ID])).rows[0].id;
  const role = (await env.admin.query(`SELECT id FROM app.role WHERE tenant_id = $1 AND code = 'ROLE-PLATFORM-SUPERADMIN'`, [PLATFORM_TENANT_ID])).rows[0].id;
  await env.admin.query(
    `INSERT INTO app.app_user (id, tenant_id, idp_subject, email, display_name, primary_branch_id, created_by, updated_by)
     VALUES ('usr_platform_flags', $1, 'sub-platform-flags', 'operator@platform.example.com', 'Platform Operator', $2, 'iso', 'iso')`,
    [PLATFORM_TENANT_ID, branch],
  );
  await env.admin.query(
    `INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, created_by) VALUES ('ura_platform_flags', $1, 'usr_platform_flags', $2, 'TENANT', 'iso')`,
    [PLATFORM_TENANT_ID, role],
  );
  platformToken = await mintTestToken({ supabaseUrl: LOCAL_SUPABASE_URL, jwtSecret: LOCAL_JWT_SECRET, sub: 'sub-platform-flags', tenantId: PLATFORM_TENANT_ID, aal: 'aal2' });
  customerToken = await mintTestToken({ supabaseUrl: LOCAL_SUPABASE_URL, jwtSecret: LOCAL_JWT_SECRET, sub: 'sub-iso-a0', tenantId: env.A.tenantId, aal: 'aal2' });
}, 240_000);

afterAll(async () => {
  await env?.stop();
});

describe('feature flags survive a restart of the real server', () => {
  it('TEST-FLAGS-PERSIST-01 a changed flag and a new flag are still there after a restart, with versions kept', async () => {
    const first = await startApi(dbUrl);
    let etag: string | null;
    try {
      const list = await call(first, platformToken, 'GET', '/platform/v1/flags');
      expect(list.status, first.log()).toBe(200);
      const keys = list.body.data.map((f: { key: string }) => f.key);
      expect(keys).toEqual(expect.arrayContaining(['bre.v2_engine', 'mfa.enforce_all', 'crm.lead_auto_qualify', 'whatsapp.notifications_enabled']));

      const one = await call(first, platformToken, 'GET', '/platform/v1/flags/mfa.enforce_all?scope=GLOBAL');
      expect(one.body.value).toBe(true);
      etag = one.etag;
      const put = await call(first, platformToken, 'PUT', '/platform/v1/flags/mfa.enforce_all', { scope: 'GLOBAL', value: false, description: 'switched off by the restart test' }, { 'If-Match': etag! });
      expect(put.status, first.log()).toBe(200);
      expect(put.body.value).toBe(false);

      const created = await call(first, platformToken, 'PUT', '/platform/v1/flags/restart.test_flag', { scope: 'GLOBAL', value: true, owner: 'Restart Squad', description: 'created before the restart' });
      expect(created.status, first.log()).toBe(200);
    } finally {
      await first.stop();
    }

    const second = await startApi(dbUrl); // a different process with an empty memory
    try {
      const changed = await call(second, platformToken, 'GET', '/platform/v1/flags/mfa.enforce_all?scope=GLOBAL');
      expect(changed.status, second.log()).toBe(200);
      expect(changed.body).toMatchObject({ value: false, description: 'switched off by the restart test' });
      expect(changed.body.lockVersion).toBeGreaterThan(1);
      expect(changed.body.updatedBy).toBe('usr_platform_flags');
      const newOne = await call(second, platformToken, 'GET', '/platform/v1/flags/restart.test_flag?scope=GLOBAL');
      expect(newOne.body).toMatchObject({ value: true, owner: 'Restart Squad' });

      // The version survived too: the old ETag is now stale.
      const stale = await call(second, platformToken, 'PUT', '/platform/v1/flags/mfa.enforce_all', { scope: 'GLOBAL', value: true }, { 'If-Match': etag! });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    } finally {
      await second.stop();
    }

    const row = await env.admin.query(`SELECT value, updated_by FROM app.feature_flag WHERE key = 'mfa.enforce_all' AND scope = 'GLOBAL'`);
    expect(row.rows[0]).toMatchObject({ value: false, updated_by: 'usr_platform_flags' });
  }, 300_000);

  it('TEST-FLAGS-PERSIST-02 a customer-tenant user can read flags but cannot set them, before or after a restart', async () => {
    const api = await startApi(dbUrl);
    try {
      // The API refuses customer sessions on the platform routes; the database refuses them even if the API did not.
      expect((await call(api, customerToken, 'PUT', '/platform/v1/flags/restart.test_flag', { scope: 'GLOBAL', value: false })).status).toBe(403);
    } finally {
      await api.stop();
    }
    const stillOn = await env.admin.query(`SELECT value FROM app.feature_flag WHERE key = 'restart.test_flag'`);
    expect(stillOn.rows[0].value).toBe(true);
  }, 200_000);

  it('TEST-FLAGS-PERSIST-03 only on/off flags are stored: a non-boolean value is a 422, and nothing is written', async () => {
    const api = await startApi(dbUrl);
    try {
      const res = await call(api, platformToken, 'PUT', '/platform/v1/flags/rollout.percent', { scope: 'GLOBAL', value: 25 });
      expect(res.status, api.log()).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    } finally {
      await api.stop();
    }
    expect((await env.admin.query(`SELECT 1 FROM app.feature_flag WHERE key = 'rollout.percent'`)).rows).toHaveLength(0);
  }, 200_000);
});
