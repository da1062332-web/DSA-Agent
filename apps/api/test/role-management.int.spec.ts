// Editing and deleting roles (migration 0059; owner: Dev 1; Modules 4 and 5). Against a real database as the real application role, synthetic data
// only. Covers: custom roles can be edited (with step-up and If-Match) and deleted; system roles never can; a role with history is kept; a
// customer tenant cannot hold a platform permission; the tenant cannot lose its last administrator; every change is audited; tenants stay apart.
import type { PermissionCode } from '@dsa/contracts';
import { createAuditPort, createAuthz, createIdGenerator, createUserDirectory } from '@dsa/kernel';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { fakeAuth, testPrincipal } from './support/fake-auth';
import { startIsolationEnv, type IsolationEnv, type TenantFixture } from '../../../tests/isolation/harness';

let env: IsolationEnv;
let seq = 0;
const key = () => `idem-role-mgmt-${Date.now()}-${seq++}`;
const MANAGE = ['role.manage', 'user.manage'] as PermissionCode[];
// An editor can only give a role what they hold themselves, so the test administrator holds these as well.
const HELD = [...MANAGE, 'lead.read', 'lead.create', 'task.read'] as PermissionCode[];

beforeAll(async () => {
  env = await startIsolationEnv();
}, 180_000);
afterAll(async () => {
  await env?.stop();
});

/** The API as a user of `tenant`. `fresh` controls whether the session passed an authenticator check in the last 15 minutes (step-up). */
function appFor(tenant: TenantFixture, opts: { fresh?: boolean; userIndex?: 0 | 1; held?: PermissionCode[] } = {}) {
  const ids = createIdGenerator();
  const userId = tenant.userIds[opts.userIndex ?? 0];
  return createApp({
    deps: {
      txRunner: createTxRunner(env.db),
      authz: createAuthz(),
      audit: createAuditPort(ids),
      ids,
      userDirectory: createUserDirectory(),
    },
    corsAllowedOrigins: [],
    auth: fakeAuth(
      testPrincipal({
        id: userId,
        tenantId: tenant.tenantId,
        primaryBranchId: tenant.branchId,
        authTime: opts.fresh === false ? null : new Date().toISOString(),
        grants: (opts.held ?? HELD).map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })),
      }),
    ),
  });
}

/** Role codes may only contain capital letters and hyphens, so a counter becomes letters: 0 -> A, 25 -> Z, 26 -> AA. */
const letters = (n: number): string => {
  let out = '';
  let rest = n;
  do {
    out = String.fromCharCode(65 + (rest % 26)) + out;
    rest = Math.floor(rest / 26) - 1;
  } while (rest >= 0);
  return out;
};
let roleSeq = 0;
const roleCode = () => `ROLE-MGMT-${letters(roleSeq++)}`;

async function createRole(t: TenantFixture, permissions: string[] = ['lead.read']) {
  const res = await request(appFor(t))
    .post('/v1/roles')
    .set('Idempotency-Key', key())
    .send({ code: roleCode(), name: 'Role under test', permissions });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; code: string; version: number };
}

const audit = async (action: string, entityId: string) =>
  (
    await env.admin.query(
      `SELECT actor_id, before, after FROM app.audit_event WHERE action = $1 AND entity_id = $2 ORDER BY seq`,
      [action, entityId],
    )
  ).rows;

async function asApiRole<T>(tenantId: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({
    host: env.admin.host,
    port: env.admin.port,
    database: env.admin.database,
    user: 'dsa_api',
    password: 'isolation',
  });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    return await fn(c);
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    await c.end();
  }
}

async function addAdministrator(t: TenantFixture, userId: string, roleId: string) {
  await env.admin.query(
    `INSERT INTO app.app_user (id, tenant_id, idp_subject, email, display_name, primary_branch_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'iso', 'iso') ON CONFLICT (id) DO NOTHING`,
    [userId, t.tenantId, `sub-${userId}`, `${userId}@example.test`, userId, t.branchId],
  );
  await env.admin.query(
    `INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, created_by) VALUES ($1, $2, $3, $4, 'TENANT', 'iso')`,
    [`ura_${userId}_${roleId}`, t.tenantId, userId, roleId],
  );
}

describe('editing a custom role', () => {
  it('TEST-ROLEMGMT-01 a custom role can be renamed and its permissions replaced, with If-Match, and the change is audited with before and after', async () => {
    const role = await createRole(env.A, ['lead.read', 'task.read']);
    const patch = await request(appFor(env.A))
      .patch(`/v1/roles/${role.id}`)
      .set('If-Match', `"${role.version}"`)
      .send({ name: 'Renamed role', permissions: ['lead.read', 'lead.create'] });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    expect(patch.body).toMatchObject({ name: 'Renamed role', version: role.version + 1 });
    expect([...patch.body.permissions].sort()).toEqual(['lead.create', 'lead.read']);

    const stored = await env.admin.query(
      `SELECT permission_code FROM app.role_permission WHERE role_id = $1 ORDER BY 1`,
      [role.id],
    );
    expect(stored.rows.map((r) => r.permission_code)).toEqual(['lead.create', 'lead.read']);

    const [event] = await audit('role.updated', role.id);
    expect(event).toBeDefined();
    expect(event!.actor_id).toBe(env.A.userIds[0]);
    expect(event!.before).toMatchObject({ name: 'Role under test', permissions: ['lead.read', 'task.read'] });
    expect(event!.after.permissions.sort()).toEqual(['lead.create', 'lead.read']);
  });

  it('TEST-ROLEMGMT-02 a stale If-Match is a conflict, and without a recent authenticator check the edit is refused (step-up) and nothing changes', async () => {
    const role = await createRole(env.A);
    const stale = await request(appFor(env.A))
      .patch(`/v1/roles/${role.id}`)
      .set('If-Match', '"999"')
      .send({ name: 'Nope' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    const noStepUp = await request(appFor(env.A, { fresh: false }))
      .patch(`/v1/roles/${role.id}`)
      .set('If-Match', `"${role.version}"`)
      .send({ name: 'Nope' });
    expect(noStepUp.status).toBe(401);
    expect(noStepUp.body.error.code).toBe('STEP_UP_REQUIRED');
    expect((await env.admin.query(`SELECT name FROM app.role WHERE id = $1`, [role.id])).rows[0].name).toBe(
      'Role under test',
    );
  });

  it('TEST-ROLEMGMT-03 a customer tenant role cannot hold a platform permission, on create or on edit', async () => {
    const created = await request(appFor(env.A))
      .post('/v1/roles')
      .set('Idempotency-Key', key())
      .send({ code: roleCode(), name: 'Sneaky', permissions: ['platform.console'] });
    expect(created.status).toBe(422);
    expect(JSON.stringify(created.body)).toContain('PLATFORM_PERMISSION_NOT_ALLOWED');

    const role = await createRole(env.A);
    const edited = await request(appFor(env.A))
      .patch(`/v1/roles/${role.id}`)
      .set('If-Match', `"${role.version}"`)
      .send({ permissions: ['lead.read', 'platform.flags'] });
    expect(edited.status).toBe(422);
    expect(
      (
        await env.admin.query(
          `SELECT 1 FROM app.role_permission WHERE role_id = $1 AND permission_code LIKE 'platform.%'`,
          [role.id],
        )
      ).rows,
    ).toHaveLength(0);
  });
});

describe('system roles', () => {
  async function systemRole(t: TenantFixture) {
    const id = `rol_sys_${Date.now()}_${seq++}`;
    await env.admin.query(
      `INSERT INTO app.role (id, tenant_id, code, name, is_template, version, created_by) VALUES ($1, $2, $3, 'System baseline', true, 1, 'iso')`,
      [id, t.tenantId, `ROLE-SYS-${letters(roleSeq++)}`],
    );
    await env.admin.query(
      `INSERT INTO app.role_permission (tenant_id, role_id, permission_code) VALUES ($1, $2, 'lead.read')`,
      [t.tenantId, id],
    );
    return id;
  }

  it('TEST-ROLEMGMT-04 a system role cannot be edited or deleted through the API', async () => {
    const id = await systemRole(env.A);
    const patch = await request(appFor(env.A))
      .patch(`/v1/roles/${id}`)
      .set('If-Match', '"1"')
      .send({ name: 'Hacked' });
    expect(patch.status).toBe(422);
    expect(JSON.stringify(patch.body)).toContain('SYSTEM_ROLE');
    const del = await request(appFor(env.A)).delete(`/v1/roles/${id}`);
    expect(del.status).toBe(422);
    expect((await env.admin.query(`SELECT name FROM app.role WHERE id = $1`, [id])).rows[0].name).toBe(
      'System baseline',
    );
    expect(
      (await env.admin.query(`SELECT 1 FROM app.role_permission WHERE role_id = $1`, [id])).rows,
    ).toHaveLength(1);
  });

  it('TEST-ROLEMGMT-05 and the database refuses it too, for the application role, even when the API is bypassed', async () => {
    const id = await systemRole(env.A);
    await asApiRole(env.A.tenantId, async (c) => {
      const refused = async (sql: string, params: unknown[] = [id]) => {
        await c.query('SAVEPOINT s');
        await expect(c.query(sql, params)).rejects.toMatchObject({ code: '42501' });
        await c.query('ROLLBACK TO s');
      };
      await refused(`UPDATE app.role SET name = 'x' WHERE id = $1`);
      await refused(`DELETE FROM app.role WHERE id = $1`);
      await refused(`DELETE FROM app.role_permission WHERE role_id = $1`);
      await refused(`UPDATE app.role SET is_template = false WHERE id = $1`); // not a column dsa_app may update
      await refused(`UPDATE app.role SET code = 'ROLE-OTHER' WHERE id = $1`);
    });
  });
});

describe('deleting a custom role', () => {
  it('TEST-ROLEMGMT-06 an unused custom role is deleted with its permissions, and the deletion is audited', async () => {
    const role = await createRole(env.A, ['lead.read', 'task.read']);
    const del = await request(appFor(env.A)).delete(`/v1/roles/${role.id}`);
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    expect((await env.admin.query(`SELECT 1 FROM app.role WHERE id = $1`, [role.id])).rows).toHaveLength(0);
    expect(
      (await env.admin.query(`SELECT 1 FROM app.role_permission WHERE role_id = $1`, [role.id])).rows,
    ).toHaveLength(0);
    const [event] = await audit('role.deleted', role.id);
    expect(event!.before).toMatchObject({ code: role.code });
  });

  it('TEST-ROLEMGMT-07 a role that is assigned, or ever was, is refused: the assignment history is kept', async () => {
    const assigned = await createRole(env.A);
    await env.admin.query(
      `INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, created_by) VALUES ($1, $2, $3, $4, 'TENANT', $5)`,
      [`ura_del_${seq++}`, env.A.tenantId, env.A.userIds[1], assigned.id, env.A.userIds[0]],
    );
    const whileAssigned = await request(appFor(env.A)).delete(`/v1/roles/${assigned.id}`);
    expect(whileAssigned.status).toBe(422);

    await env.admin.query(
      `UPDATE app.user_role_assignment SET effective_range = tstzrange(lower(effective_range), greatest(now(), lower(effective_range)), '[)') WHERE role_id = $1`,
      [assigned.id],
    );
    const afterEnded = await request(appFor(env.A)).delete(`/v1/roles/${assigned.id}`);
    expect(afterEnded.status).toBe(422);
    expect(JSON.stringify(afterEnded.body)).toContain('HAS_ASSIGNMENT_HISTORY');
    expect((await env.admin.query(`SELECT 1 FROM app.role WHERE id = $1`, [assigned.id])).rows).toHaveLength(
      1,
    );

    await asApiRole(env.A.tenantId, async (c) => {
      await c.query('SAVEPOINT s');
      await expect(c.query(`DELETE FROM app.role WHERE id = $1`, [assigned.id])).rejects.toMatchObject({
        code: '23503',
      });
      await c.query('ROLLBACK TO s');
    });
  });
});

describe('the tenant keeps an administrator', () => {
  it('TEST-ROLEMGMT-08 the last administrator cannot be removed by a role edit, ending the assignment, or a status change; a second one makes it fine', async () => {
    const t = env.B; // its own fixtures: nobody else in this file touches tenant B's administrators
    const adminRole = await createRole(t, ['user.manage', 'lead.read']);
    await addAdministrator(t, 'usr_last_admin_1', adminRole.id);
    const api = appFor(t, { userIndex: 0 });

    // 1. Removing the permission from the role that makes the only administrator.
    const strip = await request(api)
      .patch(`/v1/roles/${adminRole.id}`)
      .set('If-Match', `"${adminRole.version}"`)
      .send({ permissions: ['lead.read'] });
    expect(strip.status, JSON.stringify(strip.body)).toBe(409);
    expect(JSON.stringify(strip.body)).toContain('LAST_ADMINISTRATOR');
    expect(
      (
        await env.admin.query(
          `SELECT permission_code FROM app.role_permission WHERE role_id = $1 AND permission_code = 'user.manage'`,
          [adminRole.id],
        )
      ).rows,
    ).toHaveLength(1);

    // 2. Ending that administrator's assignment.
    const end = await request(api).delete(`/v1/users/usr_last_admin_1/roles/${adminRole.id}`);
    expect(end.status).toBe(409);
    expect(
      (
        await env.admin.query(
          `SELECT upper_inf(effective_range) open FROM app.user_role_assignment WHERE user_id = 'usr_last_admin_1'`,
        )
      ).rows[0].open,
    ).toBe(true);

    // 3. Suspending that administrator.
    const suspend = await request(api).patch('/v1/users/usr_last_admin_1').send({ status: 'SUSPENDED' });
    expect(suspend.status).toBe(409);
    expect(
      (await env.admin.query(`SELECT status FROM app.app_user WHERE id = 'usr_last_admin_1'`)).rows[0].status,
    ).toBe('ACTIVE');

    // With a second administrator the same edits go through.
    const second = await createRole(t, ['user.manage']);
    await addAdministrator(t, 'usr_last_admin_2', second.id);
    const ok = await request(api)
      .patch(`/v1/roles/${adminRole.id}`)
      .set('If-Match', `"${adminRole.version}"`)
      .send({ permissions: ['lead.read'] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const suspendOk = await request(api).patch('/v1/users/usr_last_admin_1').send({ status: 'SUSPENDED' });
    expect(suspendOk.status, JSON.stringify(suspendOk.body)).toBe(200);
    expect((await audit('user.status_changed', 'usr_last_admin_1')).length).toBe(1); // the refused attempt left no audit row, the allowed one did
  });
});

describe('tenants stay apart', () => {
  it('TEST-ROLEMGMT-09 another tenant cannot edit or delete this tenant role: 404, nothing changes', async () => {
    const role = await createRole(env.A, ['lead.read']);
    const patch = await request(appFor(env.B))
      .patch(`/v1/roles/${role.id}`)
      .set('If-Match', `"${role.version}"`)
      .send({ name: 'Taken over' });
    expect(patch.status).toBe(404);
    const del = await request(appFor(env.B)).delete(`/v1/roles/${role.id}`);
    expect(del.status).toBe(404);
    expect((await env.admin.query(`SELECT name FROM app.role WHERE id = $1`, [role.id])).rows[0].name).toBe(
      'Role under test',
    );
  });

  it('TEST-ROLEMGMT-10 the audit trail of a role names who did it, in the tenant where it happened', async () => {
    const role = await createRole(env.A, ['lead.read']);
    const rows = await env.admin.query(
      `SELECT tenant_id, actor_id FROM app.audit_event WHERE action = 'role.created' AND entity_id = $1`,
      [role.id],
    );
    expect(rows.rows).toEqual([{ tenant_id: env.A.tenantId, actor_id: env.A.userIds[0] }]);
  });
});

describe('an editor cannot give away more than they hold', () => {
  it('TEST-ROLEMGMT-11 a role can only be given permissions the editor holds; permissions already in the role may stay', async () => {
    const editor = ['role.manage', 'lead.read', 'task.read'] as PermissionCode[];
    // Created by a full administrator, with a permission the limited editor does not hold.
    const role = await createRole(env.A, ['lead.read', 'lead.create']);

    const create = await request(appFor(env.A, { held: editor }))
      .post('/v1/roles')
      .set('Idempotency-Key', key())
      .send({ code: roleCode(), name: 'Escalation', permissions: ['lead.read', 'lender.manage'] });
    expect(create.status).toBe(403);
    expect(JSON.stringify(create.body)).toContain('PERMISSION_NOT_HELD: lender.manage');

    const add = await request(appFor(env.A, { held: editor }))
      .patch(`/v1/roles/${role.id}`)
      .set('If-Match', `"${role.version}"`)
      .send({ permissions: ['lead.read', 'lead.create', 'task.read', 'task.create'] });
    expect(add.status).toBe(403);
    expect(JSON.stringify(add.body)).toContain('PERMISSION_NOT_HELD: task.create');

    // Keeping what the role already has (even though the editor lacks lead.create) and adding what the editor holds is fine.
    const ok = await request(appFor(env.A, { held: editor }))
      .patch(`/v1/roles/${role.id}`)
      .set('If-Match', `"${role.version}"`)
      .send({ permissions: ['lead.read', 'lead.create', 'task.read'] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });
});
