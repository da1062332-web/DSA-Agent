// Removing a role from a user ENDS the assignment (migration 0057): the row stays as history, the user loses the permissions,
// and the database lets dsa_api do nothing else to it. Real database, synthetic data only.
import type { PermissionCode } from '@dsa/contracts';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
let seq = 0;
const key = () => `idem-role-end-${Date.now()}-${seq++}`;
const ADMIN = ['user.manage', 'role.manage'] as PermissionCode[];

beforeAll(async () => {
  env = await startIsolationEnv();
}, 180_000);
afterAll(async () => {
  await env?.stop();
});

/** A connection as dsa_api itself, inside tenant A's context, to see what the database allows. */
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

async function newRoleAssignedToUser2() {
  const a = env.appAs(env.A, ADMIN);
  const code = `ROLE-END-${String.fromCharCode(65 + (seq % 26))}${String.fromCharCode(65 + ((seq >> 3) % 26))}`;
  const role = await request(a)
    .post('/v1/roles')
    .set('Idempotency-Key', key())
    .send({ code, name: `Ending ${code}`, permissions: ['lead.read'] });
  expect(role.status, JSON.stringify(role.body)).toBe(201);
  const user = env.A.userIds[1];
  const assign = await request(a)
    .post(`/v1/users/${user}/roles`)
    .set('Idempotency-Key', key())
    .send({ roleId: role.body.id, scopeType: 'TENANT' });
  expect(assign.status, JSON.stringify(assign.body)).toBe(201);
  return { a, roleId: role.body.id as string, user, assignmentId: assign.body.id as string };
}

describe('removing a role ends the assignment', () => {
  it('TEST-ROLEEND-01 the user loses the role and its permissions, and the assignment stays as closed history', async () => {
    const { a, roleId, user, assignmentId } = await newRoleAssignedToUser2();
    const before = await request(a).get(`/v1/users/${user}/roles`);
    expect(JSON.stringify(before.body)).toContain(roleId);
    expect(JSON.stringify((await request(a).get(`/v1/users/${user}/permissions`)).body)).toContain('lead.read');

    const removed = await request(a).delete(`/v1/users/${user}/roles/${roleId}`);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);

    expect(JSON.stringify((await request(a).get(`/v1/users/${user}/roles`)).body)).not.toContain(roleId);
    expect(JSON.stringify((await request(a).get(`/v1/users/${user}/permissions`)).body)).not.toContain('lead.read');

    const row = await env.admin.query(
      `SELECT upper_inf(effective_range) AS open, upper(effective_range) <= now() AS closed_now FROM app.user_role_assignment WHERE id = $1`,
      [assignmentId],
    );
    expect(row.rows).toHaveLength(1); // kept as history
    expect(row.rows[0].open).toBe(false);
  });

  it('TEST-ROLEEND-02 the same role can be assigned again afterwards, as a new assignment', async () => {
    const { a, roleId, user, assignmentId } = await newRoleAssignedToUser2();
    expect((await request(a).delete(`/v1/users/${user}/roles/${roleId}`)).status).toBe(200);
    const again = await request(a)
      .post(`/v1/users/${user}/roles`)
      .set('Idempotency-Key', key())
      .send({ roleId, scopeType: 'TENANT' });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.id).not.toBe(assignmentId);
    expect(JSON.stringify((await request(a).get(`/v1/users/${user}/roles`)).body)).toContain(roleId);
  });

  it('TEST-ROLEEND-03 removing a role the user does not hold, or has already lost, is 404', async () => {
    const { a, roleId, user } = await newRoleAssignedToUser2();
    expect((await request(a).delete(`/v1/users/${user}/roles/${roleId}`)).status).toBe(200);
    expect((await request(a).delete(`/v1/users/${user}/roles/${roleId}`)).status).toBe(404);
    expect((await request(a).delete(`/v1/users/${user}/roles/role_does_not_exist`)).status).toBe(404);
  });

  it('TEST-ROLEEND-04 a user cannot remove their own role (SOD-05 still holds)', async () => {
    const a = env.appAs(env.A, ADMIN, 0);
    const res = await request(a).delete(`/v1/users/${env.A.userIds[0]}/roles/any_role`);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error.code).toBe('SOD_VIOLATION');
  });

  it('TEST-ROLEEND-05 tenant B cannot end tenant A assignment: 404, and it stays open', async () => {
    const { roleId, user, assignmentId } = await newRoleAssignedToUser2();
    const b = env.appAs(env.B, ADMIN);
    expect((await request(b).delete(`/v1/users/${user}/roles/${roleId}`)).status).toBe(404);
    const row = await env.admin.query(`SELECT upper_inf(effective_range) AS open FROM app.user_role_assignment WHERE id = $1`, [assignmentId]);
    expect(row.rows[0].open).toBe(true);
  });
});

describe('what the database lets dsa_api do to an assignment', () => {
  it('TEST-ROLEEND-06 it can close an open assignment, and nothing else', async () => {
    const { assignmentId } = await newRoleAssignedToUser2();
    await asApiRole(env.A.tenantId, async (c) => {
      // DELETE is still refused.
      await c.query('SAVEPOINT s1');
      await expect(c.query(`DELETE FROM app.user_role_assignment WHERE id = $1`, [assignmentId])).rejects.toMatchObject({ code: '42501' });
      await c.query('ROLLBACK TO s1');
      // Any other column is refused.
      await c.query('SAVEPOINT s2');
      await expect(c.query(`UPDATE app.user_role_assignment SET scope_type = 'OWN' WHERE id = $1`, [assignmentId])).rejects.toMatchObject({ code: '42501' });
      await c.query('ROLLBACK TO s2');
      await c.query('SAVEPOINT s3');
      await expect(c.query(`UPDATE app.user_role_assignment SET role_id = 'other' WHERE id = $1`, [assignmentId])).rejects.toMatchObject({ code: '42501' });
      await c.query('ROLLBACK TO s3');
      // Closing it is allowed.
      const closed = await c.query(
        `UPDATE app.user_role_assignment SET effective_range = tstzrange(lower(effective_range), greatest(now(), lower(effective_range)), '[)') WHERE id = $1`,
        [assignmentId],
      );
      expect(closed.rowCount).toBe(1);
    });
  });

  it('TEST-ROLEEND-07 it cannot extend, reopen or move an assignment', async () => {
    const { assignmentId } = await newRoleAssignedToUser2();
    await asApiRole(env.A.tenantId, async (c) => {
      const attempt = async (name: string, sql: string, expected: string | RegExp) => {
        await c.query(`SAVEPOINT ${name}`);
        await expect(c.query(sql, [assignmentId]), name).rejects.toThrow(expected);
        await c.query(`ROLLBACK TO ${name}`);
      };
      // An open assignment may not be closed in the future, or moved to start later.
      await attempt('future', `UPDATE app.user_role_assignment SET effective_range = tstzrange(lower(effective_range), now() + interval '1 day', '[)') WHERE id = $1`, /can only be ended/);
      await attempt('moved', `UPDATE app.user_role_assignment SET effective_range = tstzrange(now() + interval '1 hour', NULL, '[)') WHERE id = $1`, /can only be ended/);
      // Close it, then try to change an ended one.
      await c.query(`UPDATE app.user_role_assignment SET effective_range = tstzrange(lower(effective_range), greatest(now(), lower(effective_range)), '[)') WHERE id = $1`, [assignmentId]);
      await attempt('reopen', `UPDATE app.user_role_assignment SET effective_range = tstzrange(lower(effective_range), NULL, '[)') WHERE id = $1`, /has ended/);
    });
  });

  it('TEST-ROLEEND-08 it cannot touch another tenant assignment (row-level security hides it: 0 rows)', async () => {
    const { assignmentId } = await newRoleAssignedToUser2();
    await asApiRole(env.B.tenantId, async (c) => {
      const res = await c.query(
        `UPDATE app.user_role_assignment SET effective_range = tstzrange(lower(effective_range), greatest(now(), lower(effective_range)), '[)') WHERE id = $1`,
        [assignmentId],
      );
      expect(res.rowCount).toBe(0);
    });
  });
});
