// TEST-SEC-001 cases for users, roles, permissions and API clients (owner: Dev 1 / Platform, Modules 2, 3 and 29).
// Tenant B holds every administration permission and still must not see or change tenant A's users, roles or API clients.
// Named operationIds: API-USR-CREATE, API-USR-GET, API-USR-UPDATE, API-USR-PERMS-GET, API-USR-ROLES-ASSIGN,
// API-USR-ROLES-LIST, API-USR-ROLES-REMOVE, API-ACL-ROLES-LIST, API-ACL-ROLES-GET, API-ACL-ROLES-CREATE,
// API-ACL-ROLES-UPDATE, API-ACL-ROLES-DELETE, API-ACL-PERMS-LIST, and the API client operations:
//   get /v1/api-clients, post /v1/api-clients, get /v1/api-clients/{id}, patch /v1/api-clients/{id},
//   delete /v1/api-clients/{id}, post /v1/api-clients/{id}/rotate-secret.
import type { PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../harness';

let env: IsolationEnv;
let roleAId: string;
let clientAId: string;
let userAId: string;

const ADMIN: PermissionCode[] = [
  'user.manage',
  'role.manage',
  'config.manage',
  'api.manage',
  'api.read',
] as PermissionCode[];
let seq = 0;
const key = () => `idem-iso-usr-${Date.now()}-${seq++}`;

beforeAll(async () => {
  env = await startIsolationEnv();
  userAId = env.A.userIds[0];

  const a = env.appAs(env.A, ADMIN);
  const role = await request(a)
    .post('/v1/roles')
    .set('Idempotency-Key', key())
    .send({ code: 'ROLE-ISO-AUDITOR', name: 'Isolation auditor', permissions: [] });
  expect(role.status, JSON.stringify(role.body)).toBe(201);
  roleAId = role.body.id;

  // API clients are stored in app.api_client (PgApiClientRepository), so each request below goes through the database and its policies.
  const client = await request(a)
    .post('/v1/api-clients')
    .set('Idempotency-Key', key())
    .send({ name: 'Isolation client', partnerName: 'Isolation partner' });
  expect(client.status, JSON.stringify(client.body)).toBe(201);
  clientAId = client.body.id;
  expect(clientAId).toBeTruthy();
});

afterAll(async () => {
  await env?.stop();
});

describe('TEST-SEC-001 users: tenants never cross', () => {
  it('API-USR-GET API-USR-PERMS-GET API-USR-ROLES-LIST: tenant B cannot read tenant A user, permissions or roles', async () => {
    const a = env.appAs(env.A, ADMIN);
    const b = env.appAs(env.B, ADMIN);
    expect((await request(a).get(`/v1/users/${userAId}`)).status).toBe(200);

    expect((await request(b).get(`/v1/users/${userAId}`)).status).toBe(404);
    expect((await request(b).get(`/v1/users/${userAId}/permissions`)).status).toBe(404);
    expect((await request(b).get(`/v1/users/${userAId}/roles`)).status).toBe(404);
  });

  it('API-USR-UPDATE: tenant B cannot change tenant A user', async () => {
    const b = env.appAs(env.B, ADMIN);
    const res = await request(b)
      .patch(`/v1/users/${userAId}`)
      .set('If-Match', '"0"')
      .send({ displayName: 'Hijacked' });
    expect(res.status).toBe(404);
    const row = await env.admin.query(`SELECT display_name FROM app.app_user WHERE id = $1`, [userAId]);
    expect(row.rows[0]?.display_name).not.toBe('Hijacked');
  });

  it('API-USR-ROLES-ASSIGN API-USR-ROLES-REMOVE: tenant B cannot assign or remove roles on tenant A user, or use tenant A role', async () => {
    const b = env.appAs(env.B, ADMIN);
    const assign = await request(b)
      .post(`/v1/users/${userAId}/roles`)
      .set('Idempotency-Key', key())
      .send({ roleId: roleAId, scopeType: 'TENANT' });
    expect(assign.status, JSON.stringify(assign.body)).toBe(404);
    const none = await env.admin.query(
      `SELECT 1 FROM app.user_role_assignment WHERE user_id = $1 AND role_id = $2`,
      [userAId, roleAId],
    );
    expect(none.rows).toHaveLength(0);

    // Give tenant A's user the role, then let tenant B try to take it away: 404, and the assignment stays open.
    await env.admin.query(
      `INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by)
       VALUES ($1, $2, $3, $4, 'TENANT', '{}', $5)`, // created_by must differ from the user (SOD-05)
      [`ura_iso_${Date.now()}`, env.A.tenantId, userAId, roleAId, env.A.userIds[1]],
    );
    const remove = await request(b).delete(`/v1/users/${userAId}/roles/${roleAId}`);
    expect(remove.status).toBe(404);
    const kept = await env.admin.query(
      `SELECT 1 FROM app.user_role_assignment WHERE user_id = $1 AND role_id = $2`,
      [userAId, roleAId],
    );
    expect(kept.rows).toHaveLength(1);
    const open = await env.admin.query(
      `SELECT upper_inf(effective_range) AS open FROM app.user_role_assignment WHERE user_id = $1 AND role_id = $2`,
      [userAId, roleAId],
    );
    expect(open.rows[0].open).toBe(true);
  });

  it('API-USR-CREATE: a user created by tenant B belongs to tenant B, and tenant A cannot see it', async () => {
    const b = env.appAs(env.B, ADMIN);
    const created = await request(b)
      .post('/v1/users')
      .set('Idempotency-Key', key())
      .send({
        email: `iso.b.${Date.now()}@example.test`,
        displayName: 'Iso B user',
        mobileE164: null,
        primaryBranchId: env.B.branchId,
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.tenantId).toBe(env.B.tenantId);
    const a = env.appAs(env.A, ADMIN);
    expect((await request(a).get(`/v1/users/${created.body.id}`)).status).toBe(404);
  });
});

describe('TEST-SEC-001 roles and permissions: tenants never cross', () => {
  it('API-ACL-ROLES-LIST API-ACL-ROLES-GET: tenant B cannot see tenant A role', async () => {
    const a = env.appAs(env.A, ADMIN);
    const b = env.appAs(env.B, ADMIN);
    expect((await request(a).get(`/v1/roles/${roleAId}`)).status).toBe(200);

    expect((await request(b).get(`/v1/roles/${roleAId}`)).status).toBe(404);
    const list = await request(b).get('/v1/roles');
    expect(list.status).toBe(200);
    const ids = (list.body.data ?? list.body).map((r: { id: string }) => r.id);
    expect(ids).not.toContain(roleAId);
  });

  it('API-ACL-ROLES-UPDATE API-ACL-ROLES-DELETE: tenant B cannot change or delete tenant A role', async () => {
    const b = env.appAs(env.B, ADMIN);
    const patch = await request(b)
      .patch(`/v1/roles/${roleAId}`)
      .set('If-Match', '"0"')
      .send({ name: 'Hijacked' });
    expect(patch.status).toBe(404);
    const del = await request(b).delete(`/v1/roles/${roleAId}`);
    expect(del.status).toBe(404);
    const row = await env.admin.query(`SELECT name FROM app.role WHERE id = $1`, [roleAId]);
    expect(row.rows[0]?.name).toBe('Isolation auditor');
  });

  it('API-ACL-ROLES-CREATE: the same role code may exist in both tenants, and each is its own role', async () => {
    const b = env.appAs(env.B, ADMIN);
    const created = await request(b)
      .post('/v1/roles')
      .set('Idempotency-Key', key())
      .send({ code: 'ROLE-ISO-AUDITOR', name: 'Isolation auditor B', permissions: [] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.id).not.toBe(roleAId);
    expect(created.body.tenantId).toBe(env.B.tenantId);
  });

  it('API-ACL-PERMS-LIST: the permission catalogue is read-only reference data, answered for either tenant', async () => {
    const b = env.appAs(env.B, ADMIN);
    const res = await request(b).get('/v1/permissions');
    expect(res.status).toBe(200);
  });
});

describe('TEST-SEC-001 API clients: tenants never cross', () => {
  it('get /v1/api-clients, get /v1/api-clients/{id}: tenant B cannot see tenant A client', async () => {
    const a = env.appAs(env.A, ADMIN);
    const b = env.appAs(env.B, ADMIN);
    expect((await request(a).get(`/v1/api-clients/${clientAId}`)).status).toBe(200);

    expect((await request(b).get(`/v1/api-clients/${clientAId}`)).status).toBe(404);
    const list = await request(b).get('/v1/api-clients');
    expect(list.status).toBe(200);
    const ids = (list.body.data ?? list.body).map((c: { id: string }) => c.id);
    expect(ids).not.toContain(clientAId);
  });

  it('patch /v1/api-clients/{id}, post /v1/api-clients/{id}/rotate-secret, delete /v1/api-clients/{id}: tenant B cannot change tenant A client', async () => {
    const b = env.appAs(env.B, ADMIN);
    expect((await request(b).patch(`/v1/api-clients/${clientAId}`).send({ name: 'Hijacked' })).status).toBe(
      404,
    );
    expect(
      (await request(b).post(`/v1/api-clients/${clientAId}/rotate-secret`).set('Idempotency-Key', key()))
        .status,
    ).toBe(404);
    expect((await request(b).delete(`/v1/api-clients/${clientAId}`)).status).toBe(404);
    // Still there, still unchanged, for its own tenant.
    const still = await request(env.appAs(env.A, ADMIN)).get(`/v1/api-clients/${clientAId}`);
    expect(still.status).toBe(200);
    expect(still.body.name).toBe('Isolation client');
  });

  it('post /v1/api-clients: a client created by tenant B belongs to tenant B', async () => {
    const b = env.appAs(env.B, ADMIN);
    const created = await request(b)
      .post('/v1/api-clients')
      .set('Idempotency-Key', key())
      .send({ name: 'Isolation client B', partnerName: 'Isolation partner B' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.tenantId).toBe(env.B.tenantId);
    expect((await request(env.appAs(env.A, ADMIN)).get(`/v1/api-clients/${created.body.id}`)).status).toBe(
      404,
    );
  });
});
