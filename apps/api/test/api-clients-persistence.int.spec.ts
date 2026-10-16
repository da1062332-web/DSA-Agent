// API clients survive an API restart (owner: Dev 1; Module 36). This starts the REAL server process (src/server.ts) three times
// against one throwaway database, killing the process between runs, and checks over HTTP that the data is still there. The child
// gets an explicit environment (no .env file, no hosted URL) and may only reach the local container.
import { createHash } from 'node:crypto';
import { mintTestToken } from '../../../packages/kernel/src/testing/test-token';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { apiRoleUrl, call, LOCAL_JWT_SECRET, LOCAL_SUPABASE_URL, startApi } from './support/spawn-api';

let env: IsolationEnv;
let token: string;
let dbUrl: string;

beforeAll(async () => {
  env = await startIsolationEnv();
  dbUrl = apiRoleUrl(env.admin);

  // The caller: tenant A's first user, holding config.manage (which the API-client routes accept) through a role.
  await env.admin.query(`INSERT INTO app.role (id, tenant_id, code, name, created_by) VALUES ('role_restart', $1, 'ROLE-RESTART', 'Restart test', 'iso')`, [env.A.tenantId]);
  await env.admin.query(`INSERT INTO app.role_permission (tenant_id, role_id, permission_code) VALUES ($1, 'role_restart', 'config.manage')`, [env.A.tenantId]);
  await env.admin.query(
    `INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, created_by) VALUES ('ura_restart', $1, $2, 'role_restart', 'TENANT', $3)`,
    [env.A.tenantId, env.A.userIds[0], env.A.userIds[1]],
  );
  token = await mintTestToken({ supabaseUrl: LOCAL_SUPABASE_URL, jwtSecret: LOCAL_JWT_SECRET, sub: 'sub-iso-a0', tenantId: env.A.tenantId, aal: 'aal2' });
}, 240_000);

afterAll(async () => {
  await env?.stop();
});

describe('API clients survive a restart of the real server', () => {
  it('TEST-CLIENTS-PERSIST-01 a client created before a restart is there after it, with only its secret hash stored', async () => {
    const first = await startApi(dbUrl);
    let created: { status: number; body: { id: string; clientId: string; clientSecret: string } };
    try {
      created = await call(first, token, 'POST', '/v1/api-clients', { name: 'Persisted client', partnerName: 'Persisted partner', scopes: ['partner.lead_ingest'] });
      expect(created.status, first.log()).toBe(201);
      expect(created.body.clientSecret).toMatch(/^sec_/);
    } finally {
      await first.stop();
    }

    const second = await startApi(dbUrl); // a different process, with an empty memory
    try {
      const got = await call(second, token, 'GET', `/v1/api-clients/${created.body.id}`);
      expect(got.status, second.log()).toBe(200);
      expect(got.body).toMatchObject({ id: created.body.id, clientId: created.body.clientId, name: 'Persisted client', status: 'ACTIVE' });
      expect(got.body.clientSecret).toBeUndefined();
      expect(JSON.stringify(got.body)).not.toContain(created.body.clientSecret);
      const list = await call(second, token, 'GET', '/v1/api-clients');
      expect(list.body.data.map((c: { id: string }) => c.id)).toContain(created.body.id);
    } finally {
      await second.stop();
    }

    const row = await env.admin.query(`SELECT client_secret_hash, tenant_id FROM app.api_client WHERE id = $1`, [created.body.id]);
    expect(row.rows[0].tenant_id).toBe(env.A.tenantId);
    expect(row.rows[0].client_secret_hash).toBe(createHash('sha256').update(created.body.clientSecret).digest('hex'));
    expect(JSON.stringify(row.rows[0])).not.toContain(created.body.clientSecret);
  }, 240_000);

  it('TEST-CLIENTS-PERSIST-02 an update, a secret rotation and a revocation each survive a restart', async () => {
    const a = await startApi(dbUrl);
    let id: string;
    let firstHash: string;
    try {
      const created = await call(a, token, 'POST', '/v1/api-clients', { name: 'Lifecycle client', partnerName: 'Lifecycle partner' });
      expect(created.status, a.log()).toBe(201);
      id = created.body.id;
      firstHash = (await env.admin.query(`SELECT client_secret_hash h FROM app.api_client WHERE id = $1`, [id])).rows[0].h;
    } finally {
      await a.stop();
    }

    const b = await startApi(dbUrl);
    try {
      expect((await call(b, token, 'PATCH', `/v1/api-clients/${id}`, { name: 'Renamed client', rateLimitRpm: 500 })).status, b.log()).toBe(200);
      const rotated = await call(b, token, 'POST', `/v1/api-clients/${id}/rotate-secret`);
      expect(rotated.status, b.log()).toBe(200);
      expect(rotated.body.clientSecret).toMatch(/^sec_/);
    } finally {
      await b.stop();
    }

    const c = await startApi(dbUrl);
    try {
      const got = await call(c, token, 'GET', `/v1/api-clients/${id}`);
      expect(got.body).toMatchObject({ name: 'Renamed client', rateLimitRpm: 500 });
      expect(got.body.lockVersion).toBeGreaterThanOrEqual(3); // created, updated, rotated
      const nowHash = (await env.admin.query(`SELECT client_secret_hash h FROM app.api_client WHERE id = $1`, [id])).rows[0].h;
      expect(nowHash).not.toBe(firstHash);
      expect((await call(c, token, 'DELETE', `/v1/api-clients/${id}`)).status, c.log()).toBeLessThan(300);
    } finally {
      await c.stop();
    }

    const d = await startApi(dbUrl);
    try {
      expect((await call(d, token, 'GET', `/v1/api-clients/${id}`)).status).toBe(404);
      const list = await call(d, token, 'GET', '/v1/api-clients');
      expect(list.body.data.map((x: { id: string }) => x.id)).not.toContain(id);
    } finally {
      await d.stop();
    }
    const row = await env.admin.query(`SELECT status FROM app.api_client WHERE id = $1`, [id]);
    expect(row.rows[0].status).toBe('REVOKED'); // kept for the record, no longer usable
  }, 360_000);
});
