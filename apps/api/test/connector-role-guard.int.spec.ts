// Integration tests (real database; the harness applies every migration in order, including 0097, and the API as dsa_api): a connector
// portal login holds no role, the reserved ROLE-CONNECTOR namespace stays closed to staff and to role creation, a change of user type
// cannot leave a role behind, and a role change and a type change serialise. The role routes are exercised over HTTP as well.
// Synthetic data only. Needs Docker (Testcontainers); the guarded integration config runs it.
import type { PermissionCode } from '@dsa/contracts';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
let seq = 0;
const uid = (prefix: string) => `${prefix}_guard_${Date.now().toString(36)}_${seq++}`;
const RESERVED = 'ROLE-CONNECTOR-PORTAL';

beforeAll(async () => {
  env = await startIsolationEnv();
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

/** A second connection as the superuser, for the concurrency cases (same server, same database). */
async function secondConnection(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: env.adminDatabaseUrl });
  await c.connect();
  return c;
}

/** Runs statements with the triggers of this session switched off: the way legacy rows that predate the guard are created. */
async function withoutTriggers(statements: Array<[string, unknown[]]>): Promise<void> {
  await env.admin.query('SET session_replication_role = replica');
  try {
    for (const [text, values] of statements) await env.admin.query(text, values);
  } finally {
    await env.admin.query('SET session_replication_role = origin');
  }
}

/** The id of a role in the tenant with this code. The reserved namespace is created only with the triggers off (legacy data). */
async function roleIdOf(code: string, tenantId = env.A.tenantId, legacy = false): Promise<string> {
  const found = await env.admin.query('SELECT id FROM app.role WHERE tenant_id = $1 AND code = $2', [
    tenantId,
    code,
  ]);
  if (found.rows[0]) return found.rows[0].id as string;
  const id = uid('role');
  const insert: [string, unknown[]] = [
    `INSERT INTO app.role (id, tenant_id, code, name, is_template, created_by) VALUES ($1, $2, $3, $4, false, 'SYSTEM:test')`,
    [id, tenantId, code, code],
  ];
  if (legacy) await withoutTriggers([insert]);
  else await env.admin.query(insert[0], insert[1]);
  return id;
}

async function userOf(userType: 'STAFF' | 'CONNECTOR'): Promise<string> {
  const id = uid('usr');
  await env.admin.query(
    `INSERT INTO app.app_user (id, tenant_id, idp_subject, email, display_name, user_type, status, availability,
                               primary_branch_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', 'OFF_DUTY', $7, 'SYSTEM:test', 'SYSTEM:test')`,
    [id, env.A.tenantId, `idp-${id}`, `${id}@example.test`, id, userType, env.A.branchId],
  );
  return id;
}

/** Assigns the role; resolves with the database's refusal message, or null when the row was written. */
async function assign(userId: string, roleId: string, assignmentId = uid('ura')): Promise<string | null> {
  try {
    await env.admin.query(
      `INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by)
       VALUES ($1, $2, $3, $4, 'TENANT', '{}', 'SYSTEM:test')`,
      [assignmentId, env.A.tenantId, userId, roleId],
    );
    return null;
  } catch (err) {
    return (err as { message: string }).message;
  }
}

/** Changes the user type; resolves with the refusal message, or null when the change was written. */
async function setUserType(
  userId: string,
  userType: 'STAFF' | 'CONNECTOR',
  client = env.admin,
): Promise<string | null> {
  try {
    await client.query('UPDATE app.app_user SET user_type = $2 WHERE id = $1', [userId, userType]);
    return null;
  } catch (err) {
    return (err as { message: string }).message;
  }
}

async function openAssignments(userId: string): Promise<number> {
  const r = await env.admin.query(
    `SELECT count(*)::int AS n FROM app.user_role_assignment WHERE user_id = $1 AND (upper_inf(effective_range) OR upper(effective_range) > now())`,
    [userId],
  );
  return r.rows[0].n as number;
}

const ADMIN: PermissionCode[] = ['user.manage'];
// The replacement route (PUT role-assignments) is gated on role.manage, so its principal holds that as well.
const ROLE_ADMIN: PermissionCode[] = ['user.manage', 'role.manage'];
const key = (l: string) => `grd_${l}_${Math.random().toString(36).slice(2, 10)}`;
const versionOf = async (id: string) =>
  Number(
    (await env.admin.query('SELECT lock_version FROM app.app_user WHERE id = $1', [id])).rows[0].lock_version,
  );

describe('database: a connector portal login holds no role (TEST-CONROLE-DB)', () => {
  it('TEST-CONROLE-DB-001 a connector portal login cannot take an internal role', async () => {
    const connector = await userOf('CONNECTOR');
    expect(await assign(connector, await roleIdOf('ROLE-RM'))).toMatch(
      /connector portal login cannot hold the role ROLE-RM/,
    );
  });

  it('TEST-CONROLE-DB-002 a connector portal login cannot take a role even when the role is named for connectors', async () => {
    const connector = await userOf('CONNECTOR');
    expect(await assign(connector, await roleIdOf(RESERVED, env.A.tenantId, true))).toMatch(
      /connector portal login cannot hold the role ROLE-CONNECTOR-PORTAL/,
    );
  });

  it('TEST-CONROLE-DB-003 a staff account cannot take a role in the reserved connector namespace', async () => {
    const staff = await userOf('STAFF');
    expect(await assign(staff, await roleIdOf(RESERVED, env.A.tenantId, true))).toMatch(
      /staff account cannot hold the reserved connector role/,
    );
  });

  it('TEST-CONROLE-DB-004 a staff account keeps its internal roles', async () => {
    const staff = await userOf('STAFF');
    expect(await assign(staff, await roleIdOf('ROLE-RM'))).toBeNull();
  });

  it('TEST-CONROLE-DB-005 an existing staff assignment cannot be moved to a connector login', async () => {
    const staff = await userOf('STAFF');
    const connector = await userOf('CONNECTOR');
    const assignmentId = uid('ura');
    expect(await assign(staff, await roleIdOf('ROLE-RM'), assignmentId)).toBeNull();
    await expect(
      env.admin.query('UPDATE app.user_role_assignment SET user_id = $1 WHERE id = $2', [
        connector,
        assignmentId,
      ]),
    ).rejects.toThrow(/connector portal login cannot hold the role/);
  });

  it('TEST-CONROLE-DB-006 a role cannot be created or renamed into the reserved namespace', async () => {
    await expect(
      env.admin.query(
        `INSERT INTO app.role (id, tenant_id, code, name, is_template, created_by) VALUES ($1, $2, 'ROLE-CONNECTOR-OPS', 'x', false, 'SYSTEM:test')`,
        [uid('role'), env.A.tenantId],
      ),
    ).rejects.toThrow(/reserved for the connector portal/);
    const renamable = await roleIdOf('ROLE-ACC-RENAME');
    await expect(
      env.admin.query(`UPDATE app.role SET code = 'ROLE-CONNECTOR-RENAMED' WHERE id = $1`, [renamable]),
    ).rejects.toThrow(/reserved for the connector portal/);
  });

  it('TEST-CONROLE-DB-007 a user with an open role cannot change into a connector login', async () => {
    const staff = await userOf('STAFF');
    expect(await assign(staff, await roleIdOf('ROLE-RM'))).toBeNull();
    expect(await setUserType(staff, 'CONNECTOR')).toMatch(/cannot become CONNECTOR while it holds a role/);
    expect(await openAssignments(staff)).toBe(1);
  });

  it('TEST-CONROLE-DB-008 a user whose roles have all ended, or who never had one, may change into a connector login', async () => {
    const withHistory = await userOf('STAFF');
    const assignmentId = uid('ura');
    expect(await assign(withHistory, await roleIdOf('ROLE-RM'), assignmentId)).toBeNull();
    await env.admin.query(
      `UPDATE app.user_role_assignment SET effective_range = tstzrange(lower(effective_range), now(), '[)') WHERE id = $1`,
      [assignmentId],
    );
    expect(await setUserType(withHistory, 'CONNECTOR')).toBeNull();
    const roleless = await userOf('STAFF');
    expect(await setUserType(roleless, 'CONNECTOR')).toBeNull();
  });

  it('TEST-CONROLE-DB-009 a role assignment and a change of user type cannot interleave: the second waits for the first', async () => {
    const staff = await userOf('STAFF');
    const role = await roleIdOf('ROLE-RM');
    const first = await secondConnection();
    const second = await secondConnection();
    try {
      // The type change holds the user row; an assignment for that user must wait for it, not read the old type and write.
      await first.query('BEGIN');
      expect(await setUserType(staff, 'CONNECTOR', first)).toBeNull();
      await second.query("BEGIN; SET LOCAL lock_timeout = '500ms'");
      await expect(
        second.query(
          `INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by)
           VALUES ($1, $2, $3, $4, 'TENANT', '{}', 'SYSTEM:test')`,
          [uid('ura'), env.A.tenantId, staff, role],
        ),
      ).rejects.toMatchObject({ code: '55P03' });
      await second.query('ROLLBACK');
      await first.query('COMMIT');
      // After the change is committed, the same assignment is refused by the type.
      expect(await assign(staff, role)).toMatch(/connector portal login cannot hold the role/);
    } finally {
      await first.end();
      await second.end();
    }
  });

  it('TEST-CONROLE-DB-010 a change of user type waits for a role assignment that is being written', async () => {
    const staff = await userOf('STAFF');
    const role = await roleIdOf('ROLE-RM');
    const writer = await secondConnection();
    const changer = await secondConnection();
    try {
      await writer.query('BEGIN');
      await writer.query(
        `INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by)
         VALUES ($1, $2, $3, $4, 'TENANT', '{}', 'SYSTEM:test')`,
        [uid('ura'), env.A.tenantId, staff, role],
      );
      await changer.query("BEGIN; SET LOCAL lock_timeout = '500ms'");
      await expect(
        changer.query('UPDATE app.app_user SET user_type = $2 WHERE id = $1', [staff, 'CONNECTOR']),
      ).rejects.toMatchObject({ code: '55P03' });
      await changer.query('ROLLBACK');
      await writer.query('COMMIT');
      expect(await setUserType(staff, 'CONNECTOR')).toMatch(/cannot become CONNECTOR while it holds a role/);
    } finally {
      await writer.end();
      await changer.end();
    }
  });
});

describe('API: the role routes keep the same rule (TEST-CONROLE-API)', () => {
  it('TEST-CONROLE-API-010 a tenant cannot create a role in the reserved namespace', async () => {
    const app = env.appAs(env.A, [...ADMIN]);
    const res = await request(app)
      .post('/v1/roles')
      .send({ code: 'ROLE-CONNECTOR-OPS', name: 'Connector operations', permissions: [] });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.details[0].issue).toBe('RESERVED_ROLE_CODE');
  });

  it('TEST-CONROLE-API-011 assigning a role to a connector portal login is refused, and nothing is written', async () => {
    const connector = await userOf('CONNECTOR');
    const app = env.appAs(env.A, [...ADMIN], 1);
    const res = await request(app)
      .post(`/v1/users/${connector}/roles`)
      .send({ roleId: await roleIdOf('ROLE-RM'), scopeType: 'TENANT', scopeBranchIds: [] });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.details[0].issue).toBe('ROLE_NOT_ALLOWED_FOR_CONNECTOR');
    expect(await openAssignments(connector)).toBe(0);
  });

  it('TEST-CONROLE-API-012 the replacement path revalidates an assignment that is already held, instead of carrying it over', async () => {
    // A row that predates the guard: a staff member with an open RM role whose account was later changed to a connector login.
    const legacy = await userOf('STAFF');
    const role = await roleIdOf('ROLE-RM');
    expect(await assign(legacy, role)).toBeNull();
    await withoutTriggers([["UPDATE app.app_user SET user_type = 'CONNECTOR' WHERE id = $1", [legacy]]]);
    const app = env.appAs(env.A, [...ROLE_ADMIN], 1);

    const kept = await request(app)
      .put(`/v1/users/${legacy}/role-assignments`)
      .set('If-Match', `"${await versionOf(legacy)}"`)
      .send({ assignments: [{ roleId: role, scopeType: 'TENANT', scopeBranchIds: [] }] });
    expect(kept.status, JSON.stringify(kept.body)).toBe(422);
    expect(kept.body.error.details[0].issue).toBe('ROLE_NOT_ALLOWED_FOR_CONNECTOR');
    expect(await openAssignments(legacy)).toBe(1);

    // Replacing with an empty set ends the held row: the invalid assignment can always be removed.
    const ended = await request(app)
      .put(`/v1/users/${legacy}/role-assignments`)
      .set('If-Match', `"${await versionOf(legacy)}"`)
      .send({ assignments: [] });
    expect(ended.status, JSON.stringify(ended.body)).toBe(200);
    expect(await openAssignments(legacy)).toBe(0);
  });

  it('TEST-CONROLE-API-013 an invitation cannot carry the reserved namespace, nor a role from another tenant', async () => {
    const app = env.appAs(env.A, [...ADMIN]);
    const reserved = await roleIdOf(RESERVED, env.A.tenantId, true);
    const reservedRes = await request(app)
      .post('/v1/users/invitations')
      .set('Idempotency-Key', key('inv1'))
      .send({
        email: 'reserved.invitee@acc.example.com',
        displayName: 'Reserved Invitee',
        primaryBranchId: env.A.branchId,
        roleIds: [reserved],
      });
    expect(reservedRes.status, JSON.stringify(reservedRes.body)).toBe(422);
    expect(reservedRes.body.error.details[0].issue).toBe('CONNECTOR_ROLE_NOT_ALLOWED_FOR_STAFF');

    const foreign = await roleIdOf('ROLE-ACC-FOREIGN', env.B.tenantId);
    const foreignRes = await request(app)
      .post('/v1/users/invitations')
      .set('Idempotency-Key', key('inv2'))
      .send({
        email: 'foreign.invitee@acc.example.com',
        displayName: 'Foreign Invitee',
        primaryBranchId: env.A.branchId,
        roleIds: [foreign],
      });
    expect(foreignRes.status, JSON.stringify(foreignRes.body)).toBe(422);
    expect(foreignRes.body.error.details[0].issue).toBe('NOT_FOUND');

    const written = await env.admin.query(
      `SELECT count(*)::int AS n FROM app.app_user WHERE email IN ('reserved.invitee@acc.example.com', 'foreign.invitee@acc.example.com')`,
    );
    expect(written.rows[0].n).toBe(0);
  });
});
