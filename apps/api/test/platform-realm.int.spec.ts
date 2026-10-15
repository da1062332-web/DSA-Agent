// The platform realm against a real database (owner: Dev 1; DSA Notion MODULE 1 and MODULE 40; migration 0050).
// Proves the database, not just the API, enforces the realm: policies on tenant, feature_flag, master_data_item and
// support_access_grant, the platform-only user-count function, and the grant changes. Runs on a throwaway local
// PostgreSQL (the isolation harness); it never touches the hosted project. Synthetic data only.
import { PLATFORM_TENANT_ID, type PermissionCode, type PermissionGrant } from '@dsa/contracts';
import { createAuditPort, createAuthz, createIdGenerator, createUserDirectory } from '@dsa/kernel';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { fakeAuth, testPrincipal } from './support/fake-auth';
import { startIsolationEnv, type IsolationEnv, type TenantFixture } from '../../../tests/isolation/harness';

let env: IsolationEnv;
beforeAll(async () => {
  env = await startIsolationEnv();
}, 180_000);
afterAll(async () => {
  await env?.stop();
});

const grants = (...codes: PermissionCode[]): PermissionGrant[] => codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] }));
const PLATFORM_CODES: PermissionCode[] = ['platform.console', 'platform.flags', 'platform.master_data', 'platform.jobs', 'platform.support_access', 'platform.release'];

/** The API as one user of a tenant (a customer tenant, or the platform tenant by id). */
function appFor(tenantId: string, userId: string, codes: PermissionCode[], branchId: string | null = null) {
  const ids = createIdGenerator();
  return createApp({
    deps: { txRunner: createTxRunner(env.db), authz: createAuthz(), audit: createAuditPort(ids), ids, userDirectory: createUserDirectory() },
    corsAllowedOrigins: [],
    auth: fakeAuth(testPrincipal({ tenantId, id: userId, primaryBranchId: branchId, grants: grants(...codes) })),
  });
}
const platformApp = (userId = 'usr_platform_super_1') => appFor(PLATFORM_TENANT_ID, userId, PLATFORM_CODES);
const tenantApp = (t: TenantFixture, codes: PermissionCode[], userIndex: 0 | 1 = 0) => appFor(t.tenantId, t.userIds[userIndex], codes, t.branchId);

/** Raw SQL as the API database role (dsa_api, RLS applies) inside a session of the given tenant. */
async function asTenant<T>(tenantId: string, fn: (q: (text: string) => Promise<unknown[]>) => Promise<T>): Promise<T> {
  return env.db.transaction().execute(async (trx) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
    return fn(async (text) => (await sql.raw(text).execute(trx)).rows as unknown[]);
  });
}
/** Runs one statement in its own transaction and returns the error text, or null if it succeeded. */
async function failure(tenantId: string, text: string): Promise<string | null> {
  try {
    await asTenant(tenantId, (q) => q(text));
    return null;
  } catch (e) {
    return String((e as Error).message);
  }
}

describe('TEST-REALM-INT the platform realm is enforced by the database', () => {
  it('TEST-REALM-INT-01 the platform tenant, its two roles and their grants exist; no customer-tenant role holds an operator permission', async () => {
    const tenant = await env.admin.query(`select tenant_type from app.tenant where id = $1`, [PLATFORM_TENANT_ID]);
    expect(tenant.rows[0]?.tenant_type).toBe('PLATFORM');

    const roles = await env.admin.query(
      `select r.code, array_agg(rp.permission_code order by rp.permission_code) perms
         from app.role r left join app.role_permission rp on rp.role_id = r.id
        where r.tenant_id = $1 group by r.code order by r.code`,
      [PLATFORM_TENANT_ID],
    );
    const byCode = Object.fromEntries(roles.rows.map((r) => [r.code, r.perms]));
    expect(byCode['ROLE-PLATFORM-SUPERADMIN']).toEqual(['audit.read', ...[...PLATFORM_CODES].sort()].sort());
    expect(byCode['ROLE-PLATFORM-SUPPORT']).toEqual(['platform.console', 'platform.support_access']);

    const leaked = await env.admin.query(
      `select count(*)::int n from app.role_permission where permission_code like 'platform.%' and tenant_id <> $1`,
      [PLATFORM_TENANT_ID],
    );
    expect(leaked.rows[0].n).toBe(0);
  });

  it('TEST-REALM-INT-02 the migration removes operator permissions from tenant roles and data_correction.approve from the owner, and keeps the tenant admin', async () => {
    // Recreate what migration 0046 did on hosted, then run the two DELETE statements of migration 0050 on it.
    const t = env.A;
    for (const code of ['ROLE-ORG-OWNER', 'ROLE-TENANT-ADMIN']) {
      await env.admin.query(
        `insert into app.role (id, tenant_id, code, name, is_template, created_by) values ($1, $2, $3, $3, false, 'test') on conflict do nothing`,
        [`role_realm_${code}`, t.tenantId, code],
      );
      for (const perm of [...PLATFORM_CODES, 'data_correction.request', 'data_correction.approve']) {
        await env.admin.query(
          `insert into app.role_permission (tenant_id, role_id, permission_code) values ($1, $2, $3) on conflict do nothing`,
          [t.tenantId, `role_realm_${code}`, perm],
        );
      }
    }
    const file = readFileSync(path.resolve(__dirname, '../../../supabase/migrations/20261001000050_platform_realm.sql'), 'utf8');
    const deletes = file.match(/DELETE FROM role_permission[\s\S]*?;/g);
    expect(deletes).toHaveLength(2);
    for (const stmt of deletes!) await env.admin.query(`set search_path = app, public; ${stmt}`);

    const left = await env.admin.query(
      `select r.code, array_agg(rp.permission_code order by rp.permission_code) perms
         from app.role_permission rp join app.role r on r.id = rp.role_id
        where rp.tenant_id = $1 and r.id like 'role_realm_%' group by r.code order by r.code`,
      [t.tenantId],
    );
    const by = Object.fromEntries(left.rows.map((r) => [r.code, r.perms]));
    expect(by['ROLE-ORG-OWNER']).toEqual(['data_correction.request']);
    expect(by['ROLE-TENANT-ADMIN']).toEqual(['data_correction.approve', 'data_correction.request']);
  });

  it('TEST-REALM-INT-03 a platform session lists customer tenants as metadata only (not itself, no business data); the read is audited in the platform tenant', async () => {
    const res = await request(platformApp()).get('/platform/v1/tenants');
    expect(res.status).toBe(200);
    const ids = res.body.data.map((t: { id: string }) => t.id);
    expect(ids).toEqual(expect.arrayContaining([env.A.tenantId, env.B.tenantId]));
    expect(ids).not.toContain(PLATFORM_TENANT_ID);
    for (const t of res.body.data) {
      expect(Object.keys(t).sort()).toEqual(
        ['activeUsersCount', 'applicationsCount', 'createdAt', 'createdBy', 'dataRegion', 'entitlements', 'healthStatus', 'id', 'legalName', 'slug', 'status', 'tenantType', 'timezone'],
      );
      expect(t.applicationsCount).toBeNull();
      expect(typeof t.activeUsersCount).toBe('number');
    }
    const a = res.body.data.find((t: { id: string }) => t.id === env.A.tenantId);
    expect(a.activeUsersCount).toBe(2); // the two fixture users of tenant A, counted without reading them
    const audit = await env.admin.query(
      `select tenant_id, action from app.audit_event where action = 'platform.tenants_listed' and tenant_id = $1`,
      [PLATFORM_TENANT_ID],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('TEST-REALM-INT-04 a tenant administrator holding every platform permission code gets 403, and the database shows them only their own tenant', async () => {
    const adminApp = tenantApp(env.A, [...PLATFORM_CODES, 'config.manage']);
    expect((await request(adminApp).get('/platform/v1/tenants')).status).toBe(403);
    expect((await request(adminApp).get('/platform/v1/flags')).status).toBe(403);

    const rows = (await asTenant(env.A.tenantId, (q) => q(`select id from tenant order by id`))) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual([env.A.tenantId]);
    expect(await failure(env.A.tenantId, `select * from platform_tenant_user_counts()`)).toMatch(/platform realm only/);
  });

  it('TEST-REALM-INT-05 feature flags: every tenant can read them; only a platform session can write them', async () => {
    expect(((await asTenant(env.A.tenantId, (q) => q(`select key from feature_flag`))) as unknown[]).length).toBeGreaterThan(0);
    expect(await failure(env.A.tenantId, `update feature_flag set value = not value where key = 'mfa.enforce_all'`)).toBeNull(); // RLS filters to 0 rows, no error
    const unchanged = await env.admin.query(`select value from app.feature_flag where key = 'mfa.enforce_all'`);
    expect(unchanged.rows[0].value).toBe(true);
    expect(
      await failure(env.A.tenantId, `insert into feature_flag (key, scope, value, owner, updated_by) values ('hostile.flag','GLOBAL',true,'x','x')`),
    ).toMatch(/row-level security/);

    const changed = await asTenant(PLATFORM_TENANT_ID, (q) => q(`update feature_flag set description = description where key = 'mfa.enforce_all' returning key`));
    expect(changed).toHaveLength(1);
    expect(
      await failure(PLATFORM_TENANT_ID, `insert into feature_flag (key, scope, value, owner, updated_by) values ('realm.test','GLOBAL',false,'platform','usr_x')`),
    ).toBeNull();
  });

  it('TEST-REALM-INT-06 master data: readable by all, writable by a platform session only', async () => {
    expect(((await asTenant(env.B.tenantId, (q) => q(`select code from master_data_item`))) as unknown[]).length).toBeGreaterThan(0);
    expect(
      await failure(env.B.tenantId, `insert into master_data_item (dataset, code, label, created_by) values ('loan_categories','HOSTILE','x','x')`),
    ).toMatch(/row-level security/);
    expect(
      await failure(PLATFORM_TENANT_ID, `insert into master_data_item (dataset, code, label, created_by) values ('loan_categories','REALM_TEST','Realm test','usr_x')`),
    ).toBeNull();
  });

  it('TEST-REALM-INT-07 support access: the operator files it, only the target tenant decides, nobody else sees it', async () => {
    const body = { tenantId: env.A.tenantId, reason: 'Investigate duplicate lead sync exception', incidentRef: 'INC-2026-0001', durationHours: 2 };
    const created = await request(platformApp()).post('/platform/v1/support-access-requests').send(body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ tenantId: env.A.tenantId, status: 'PENDING', requester: 'usr_platform_super_1' });
    const id = created.body.id as string;

    // Refused shapes: 5 hours (API and database both), the platform tenant as the target, an unknown tenant.
    expect((await request(platformApp()).post('/platform/v1/support-access-requests').send({ ...body, durationHours: 5 })).status).toBe(422);
    expect((await request(platformApp()).post('/platform/v1/support-access-requests').send({ ...body, tenantId: PLATFORM_TENANT_ID })).status).toBe(422);
    expect((await request(platformApp()).post('/platform/v1/support-access-requests').send({ ...body, tenantId: 'ten_does_not_exist' })).status).toBe(422);

    // The operator cannot approve it, through the API or the database.
    expect((await request(platformApp()).post(`/v1/support-access-requests/${id}/approval`).send({ decision: 'APPROVED' })).status).toBe(403);
    const dbApprove = await asTenant(PLATFORM_TENANT_ID, (q) => q(`update support_access_grant set status = 'ACTIVE', approved_by = 'usr_platform_super_1' where id = '${id}' returning id`));
    expect(dbApprove).toHaveLength(0);

    // Another tenant's administrator sees nothing of it and cannot decide it (404).
    const other = tenantApp(env.B, ['config.manage']);
    const otherList = await request(other).get('/v1/support-access-requests');
    expect(otherList.status, JSON.stringify(otherList.body)).toBe(200);
    expect(otherList.body.data).toEqual([]);
    expect((await request(other).post(`/v1/support-access-requests/${id}/approval`).send({ decision: 'APPROVED' })).status).toBe(404);

    // The target tenant's administrator sees it, and approves it.
    const owner = tenantApp(env.A, ['config.manage']);
    const mine = await request(owner).get('/v1/support-access-requests');
    expect(mine.body.data.map((g: { id: string }) => g.id)).toContain(id);
    expect((await request(owner).get(`/v1/support-access-requests?tenantId=${env.B.tenantId}`)).status).toBe(403);
    const approved = await request(owner).post(`/v1/support-access-requests/${id}/approval`).send({ decision: 'APPROVED' });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'APPROVED', approver: env.A.userIds[0] });
    expect((await request(owner).post(`/v1/support-access-requests/${id}/approval`).send({ decision: 'DENIED' })).status).toBe(409);

    const audit = await env.admin.query(`select action from app.audit_event where entity_id = $1 order by occurred_at`, [id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['platform.support_access_requested', 'platform.support_access_approved']);
  });

  it('TEST-REALM-INT-08 support access rows: the database refuses a pre-approved insert, a tenant-made insert, and a window over four hours', async () => {
    const insert = (status: string, hours: number, extra = '') =>
      `insert into support_access_grant (id, tenant_id, support_user_id, reason, scope, incident_ref, starts_at, expires_at, status, created_by${extra ? ', approved_by' : ''})
       values ('sag_db_${status}_${hours}${extra}', '${env.A.tenantId}', 'usr_p', 'reason text here', 'S', 'INC-1', now(), now() + interval '${hours} hours', '${status}', 'usr_p'${extra ? `, '${extra}'` : ''})`;
    expect(await failure(PLATFORM_TENANT_ID, insert('PENDING', 2))).toBeNull();
    expect(await failure(PLATFORM_TENANT_ID, insert('ACTIVE', 2, 'usr_p'))).toMatch(/row-level security/);
    expect(await failure(PLATFORM_TENANT_ID, insert('PENDING', 5))).toMatch(/support_access_grant_window_check/);
    expect(await failure(env.A.tenantId, insert('PENDING', 1))).toMatch(/row-level security/); // a tenant cannot file a request for itself
  });

  it('TEST-REALM-INT-09 data corrections hold business values, so a platform session cannot read them; the owning tenant can', async () => {
    await env.admin.query(
      `insert into app.data_correction_request (id, tenant_id, entity_type, entity_id, field_name, old_value, new_value, reason, submitted_by, created_by)
       values ('dcr_realm_1', $1, 'LEAD', 'lead_x', 'phone', '9999999999', '8888888888', 'Wrong number captured', 'usr_a', 'usr_a')`,
      [env.A.tenantId],
    );
    expect(await asTenant(PLATFORM_TENANT_ID, (q) => q(`select id from data_correction_request`))).toHaveLength(0);
    expect(await asTenant(env.B.tenantId, (q) => q(`select id from data_correction_request`))).toHaveLength(0);
    expect(await asTenant(env.A.tenantId, (q) => q(`select id from data_correction_request`))).toHaveLength(1);
  });

  it('TEST-REALM-INT-10 the platform realm cannot read any business table of a customer tenant', async () => {
    await env.admin.query(
      `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
       values ('cust_realm_1', $1, 'INDIVIDUAL', 'Realm Customer', $2, $3, $3)`,
      [env.A.tenantId, env.A.branchId, env.A.userIds[0]],
    );
    for (const table of ['customer', 'lead', 'loan_application', 'app_user', 'role', 'audit_event', 'message', 'complaint', 'eligibility_assessment']) {
      const rows = (await asTenant(PLATFORM_TENANT_ID, (q) => q(`select 1 from ${table} where tenant_id = '${env.A.tenantId}'`))) as unknown[];
      expect(rows, `platform session must not read ${table} of tenant A`).toHaveLength(0);
    }
  });
});
