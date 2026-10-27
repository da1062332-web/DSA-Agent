// TEST-IDB: the identity-binding tool (D5) against a real database, connected as dsa_api so row-level security applies to it as it does
// to the API. Supabase Auth accounts are given as data; nothing reaches a Supabase project.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyBindings, classifyBindings, readAppUsers } from '../../../tools/identity-binding';
import { startIsolationEnv, type IsolationEnv } from '../harness';

let env: IsolationEnv;
let db: pg.Client;
const NEW_SUBJECT = '7d1f0c52-3b8e-4f6a-9c21-5e4b3a2d1c0f';

beforeAll(async () => {
  env = await startIsolationEnv();
  db = new pg.Client({ connectionString: env.apiDatabaseUrl });
  await db.connect();
});

afterAll(async () => {
  await db?.end();
  await env?.stop();
});

/** Tenant A user 0 is bound; tenant A user 1 has an account of its own tenant; tenant B user 1's address belongs to tenant A. */
const accounts = () => [
  { id: 'sub-iso-a0', email: 'user0@iso-a.example.com', tenantId: env.A.tenantId },
  { id: NEW_SUBJECT, email: 'user1@iso-a.example.com', tenantId: env.A.tenantId },
  { id: 'e2b9a7c4-0000-4000-8000-000000000001', email: 'user1@iso-b.example.com', tenantId: env.A.tenantId },
];
const categoryOf = (rows: ReturnType<typeof classifyBindings>, userId: string) =>
  rows.find((r) => r.user.id === userId)?.category;
const subjectOf = async (userId: string) =>
  (await env.admin.query(`select idp_subject from app.app_user where id = $1`, [userId])).rows[0].idp_subject;

describe('identity binding', () => {
  it('TEST-IDB-01 the inventory reads every tenant’s users as dsa_api and classifies them without writing anything', async () => {
    const before = (await env.admin.query(`select count(*)::int as n from app.audit_event`)).rows[0].n;
    const users = await readAppUsers(db);
    expect(users.map((u) => u.id)).toEqual(expect.arrayContaining([...env.A.userIds, ...env.B.userIds]));
    const rows = classifyBindings(users, accounts());
    expect(categoryOf(rows, env.A.userIds[0])).toBe('BOUND');
    expect(categoryOf(rows, env.A.userIds[1])).toBe('BINDABLE');
    expect(categoryOf(rows, env.B.userIds[1])).toBe('CROSS_TENANT');
    expect(categoryOf(rows, env.B.userIds[0])).toBe('NO_ACCOUNT');
    expect((await env.admin.query(`select count(*)::int as n from app.audit_event`)).rows[0].n).toBe(before);
  });

  it('TEST-IDB-02 binding refuses before writing when the number of bindable rows is not the one expected', async () => {
    const rows = classifyBindings(await readAppUsers(db), accounts());
    const result = await applyBindings(db, rows, 2);
    expect(result).toMatchObject({ bound: [] });
    expect(result.refused).toMatch(/not the 2 expected/);
    expect(await subjectOf(env.A.userIds[1])).toBe('sub-iso-a1');
  });

  it('TEST-IDB-03 a row that changed after it was checked is not bound, and its tenant writes nothing', async () => {
    const rows = classifyBindings(await readAppUsers(db), accounts());
    await env.admin.query(`update app.app_user set idp_subject = 'changed-meanwhile' where id = $1`, [
      env.A.userIds[1],
    ]);
    const result = await applyBindings(db, rows, 1);
    expect(result.bound).toEqual([]);
    expect(result.refused).toMatch(/changed since it was checked/);
    expect(await subjectOf(env.A.userIds[1])).toBe('changed-meanwhile');
    await env.admin.query(`update app.app_user set idp_subject = 'sub-iso-a1' where id = $1`, [
      env.A.userIds[1],
    ]);
  });

  it('TEST-IDB-04 a bindable user is bound to its own account’s subject, once, with an audit record; the rest is left for a person', async () => {
    const rows = classifyBindings(await readAppUsers(db), accounts());
    expect(await applyBindings(db, rows, 1)).toEqual({ bound: [env.A.userIds[1]] });
    expect(await subjectOf(env.A.userIds[1])).toBe(NEW_SUBJECT);
    expect(await subjectOf(env.B.userIds[1])).toBe('sub-iso-b1');
    const audit = await env.admin.query(
      `select tenant_id, actor_id, before, after from app.audit_event where action = 'user.identity_bound' and entity_id = $1`,
      [env.A.userIds[1]],
    );
    expect(audit.rows).toEqual([
      {
        tenant_id: env.A.tenantId,
        actor_id: 'SYSTEM:identity-binding',
        before: { idpSubject: 'sub-iso-a1' },
        after: { idpSubject: NEW_SUBJECT },
      },
    ]);
    // Run again: it is BOUND now, so nothing is bindable.
    const again = classifyBindings(await readAppUsers(db), accounts());
    expect(categoryOf(again, env.A.userIds[1])).toBe('BOUND');
    expect(await applyBindings(db, again, 0)).toEqual({ bound: [] });
  });
});
