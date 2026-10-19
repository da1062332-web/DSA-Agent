// Rehearsal of the migration 0050 runbook on a throwaway PostgreSQL (owner: Dev 1; MODULE 1 platform realm).
// Builds a database in the state hosted dev was in before 0050 (migrations up to 0049, operator permissions on tenant roles, the
// leftover test rows), then runs the real scripts in the runbook order: preflight, backup, apply in one transaction, verify,
// behaviour check, rollback with grant restore. It proves the scripts work, that a failed apply changes nothing, that rollback
// restores the original state exactly, and that apply can be repeated after a rollback. It never touches hosted.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres } from '../../../tests/guard/start-postgres';

const ROOT = path.resolve(__dirname, '../../..');
const OPS = path.join(ROOT, 'tools/sql/0050');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20261001000050_platform_realm.sql');
const MIGRATIONS_DIR = process.env.DSA_MIGRATIONS_DIR ?? path.join(ROOT, 'supabase/migrations');
const PLATFORM = 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG';
const sqlOf = (file: string) => readFileSync(path.join(OPS, file), 'utf8');
const wrap = (body: string) => `BEGIN;\n${body}\nCOMMIT;`;

let container: StartedPostgreSqlContainer;
let db: pg.Client;
const work = mkdtempSync(path.join(os.tmpdir(), 'dsa-0050-'));

// 0061 and 0066 need the platform realm that this rehearsal is about to apply, so they are not part of the pre-0050 state.
const NEEDS_PLATFORM_REALM = ['0050_platform_realm', '0061_master_data', '0066_tenant_feature_flag'];
beforeAll(async () => {
  container = await startPostgres();
  db = new pg.Client({ connectionString: container.getConnectionUri() });
  await db.connect();
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !NEEDS_PLATFORM_REALM.some((n) => f.includes(n)))
    .sort()) {
    await db.query(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
  }
  await db.query(
    `CREATE ROLE dsa_api LOGIN PASSWORD 'rehearsal' NOBYPASSRLS IN ROLE dsa_app; ALTER ROLE dsa_api SET search_path = app, extensions;`,
  );
  await seedHostedLikeState();
}, 240_000);
afterAll(async () => {
  await db?.end();
  await container?.stop();
});

/** The state hosted dev was in before 0050 (counts match what the 2026-10-15 read-only checks found). */
async function seedHostedLikeState(): Promise<void> {
  const tenants = [
    ['ten_01M4SXZ9E66W8T6DNJYBVNS3FA', 'alpha-demo', 'Alpha Demo Finserv'],
    ['ten_01M4SXZHMRM52X9HA4DE1G5G12', 'beta-demo', 'Beta Demo Loans'],
    ['ten_demo_01', 'demo-dsa', 'Demo DSA Financial Services Ltd'],
  ];
  for (const [id, slug, name] of tenants) {
    await db.query(
      `insert into app.tenant (id, slug, legal_name, tenant_type, created_by) values ($1, $2, $3, 'DSA_ORG', 'seed')`,
      [id, slug, name],
    );
  }
  // Roles as on hosted: owner in Alpha and Beta, admin in all three, branch manager and loan ops in Alpha and Beta.
  const roles: [string, string][] = [
    ['ROLE-ORG-OWNER', tenants[0]![0]!],
    ['ROLE-ORG-OWNER', tenants[1]![0]!],
    ['ROLE-TENANT-ADMIN', tenants[0]![0]!],
    ['ROLE-TENANT-ADMIN', tenants[1]![0]!],
    ['ROLE-TENANT-ADMIN', tenants[2]![0]!],
    ['ROLE-BRANCH-MGR', tenants[0]![0]!],
    ['ROLE-BRANCH-MGR', tenants[1]![0]!],
    ['ROLE-LOAN-OPS', tenants[0]![0]!],
    ['ROLE-LOAN-OPS', tenants[1]![0]!],
  ];
  const platformCodes = [
    'platform.console',
    'platform.flags',
    'platform.master_data',
    'platform.jobs',
    'platform.support_access',
    'platform.release',
  ];
  for (const [i, [code, tenant]] of roles.entries()) {
    const roleId = `role_seed_${i}`;
    await db.query(
      `insert into app.role (id, tenant_id, code, name, created_by) values ($1, $2, $3, $3, 'seed')`,
      [roleId, tenant, code],
    );
    const perms: string[] = [];
    if (code === 'ROLE-ORG-OWNER' || code === 'ROLE-TENANT-ADMIN')
      perms.push(...platformCodes, 'data_correction.request', 'data_correction.approve');
    if (code === 'ROLE-BRANCH-MGR' || code === 'ROLE-LOAN-OPS') perms.push('data_correction.request');
    for (const p of perms)
      await db.query(
        `insert into app.role_permission (tenant_id, role_id, permission_code) values ($1, $2, $3)`,
        [tenant, roleId, p],
      );
  }
  // One real user with the owner role, so "who loses access" has something to show.
  const alpha = tenants[0]![0]!;
  await db.query(
    `insert into app.organisation (id, tenant_id, legal_name, constitution, created_by, updated_by) values ('org_seed_1', $1, 'Alpha', 'PVT_LTD', 'seed', 'seed')`,
    [alpha],
  );
  await db.query(
    `insert into app.branch (id, tenant_id, organisation_id, code, name, created_by, updated_by) values ('br_seed_1', $1, 'org_seed_1', 'MUM01', 'Mumbai', 'seed', 'seed')`,
    [alpha],
  );
  await db.query(
    `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, primary_branch_id, created_by, updated_by) values ('usr_seed_1', $1, 'sub-seed-1', 'owner@alpha.test', 'Alpha Owner', 'br_seed_1', 'seed', 'seed')`,
    [alpha],
  );
  await db.query(
    `insert into app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, created_by) values ('ura_seed_1', $1, 'usr_seed_1', 'role_seed_0', 'TENANT', 'seed')`,
    [alpha],
  );
  // The leftover live-test rows in the 0046 (legacy) shape, and a fifth flag.
  await db.query(
    `insert into app.support_access_grant (id, tenant_id, support_user_id, reason, expires_at, status, lock_version, created_by)
     values ('sag_seed_1', $1, 'usr_support_01', 'Live PG verification test', now() + interval '2 hours', 'PENDING', 1, 'TEST')`,
    [alpha],
  );
  await db.query(
    `insert into app.data_correction_request (id, tenant_id, entity_type, entity_id, field_name, old_value, new_value, reason, status, submitted_by, lock_version, created_by)
     values ('dcr_seed_1', $1, 'LEAD', 'lead_test_01', 'phone', '1', '2', 'Incorrect phone', 'PENDING', 'usr_maker', 1, 'usr_maker')`,
    [alpha],
  );
  await db.query(
    `insert into app.feature_flag (key, scope, value, owner, updated_by) values ('flag_test_seed', 'GLOBAL', true, 'test', 'test')`,
  );
}

/** Everything 0050 touches, as JSON, so before and after can be compared whole. */
async function signature(): Promise<unknown> {
  const q = async (text: string) => (await db.query(text)).rows;
  const tables = `('tenant','feature_flag','master_data_item','support_access_grant','data_correction_request')`;
  return {
    policies: await q(
      `select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname = 'app' and tablename in ${tables} order by 1, 2`,
    ),
    constraints: await q(
      `select conrelid::regclass::text as tbl, conname, contype::text, pg_get_constraintdef(oid) as def, convalidated from pg_constraint where conrelid in ('app.tenant'::regclass, 'app.support_access_grant'::regclass, 'app.data_correction_request'::regclass) order by 1, 2`,
    ),
    columns: await q(
      `select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'app' and table_name in ${tables} order by 1, 2`,
    ),
    rls: await q(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class where relnamespace = 'app'::regnamespace and relname in ${tables} order by 1`,
    ),
    grants: await q(
      `select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'app' and table_name in ${tables} order by 1, 2, 3`,
    ),
    rolePermission: await q(
      `select tenant_id, role_id, permission_code from app.role_permission order by 1, 2, 3`,
    ),
    roles: await q(`select id, tenant_id, code from app.role order by 1`),
    tenants: await q(`select id, tenant_type, status from app.tenant order by 1`),
    orgsAndBranches: await q(
      `select (select count(*) from app.organisation) as orgs, (select count(*) from app.branch) as branches`,
    ),
    functions: await q(`select proname from pg_proc where pronamespace = 'app'::regnamespace order by 1`),
    rows: await q(
      `select (select count(*) from app.support_access_grant) as support, (select count(*) from app.data_correction_request) as corrections, (select count(*) from app.feature_flag) as flags, (select count(*) from app.master_data_item) as master`,
    ),
  };
}

/**
 * Runs a read-only check script on a FRESH connection, as the hosted CLI does. The connection that applied the migration has run
 * SET search_path = app, so on it PostgreSQL prints policy expressions as app_tenant(); a fresh session prints app.app_tenant(),
 * which is what hosted shows. Checking on the old connection hid a real defect in verify.sql.
 */
const checks = async (file: string) => {
  const fresh = new pg.Client({ connectionString: container.getConnectionUri() });
  await fresh.connect();
  try {
    return (await fresh.query(sqlOf(file))).rows as {
      name?: string;
      actual?: string;
      severity?: string;
      result: string;
    }[];
  } finally {
    await fresh.end();
  }
};
const applyFile = () => wrap(readFileSync(MIGRATION, 'utf8'));
const backupFile = path.join(work, 'backup-before.json');

describe('TEST-RUNBOOK migration 0050 runbook, rehearsed', () => {
  let before: unknown;

  it('TEST-RUNBOOK-01 preflight: every REQUIRED row passes on a hosted-like database; INFO rows report the real counts', async () => {
    const rows = await checks('preflight.sql');
    const required = rows.filter((r) => r.severity === 'REQUIRED');
    expect(required.length).toBeGreaterThanOrEqual(14);
    expect(required.filter((r) => r.result !== 'PASS')).toEqual([]);
    const info = Object.fromEntries(rows.filter((r) => r.severity === 'INFO').map((r) => [r.name, r.actual]));
    expect(info['operator grants that will be DELETED from customer-tenant roles (hosted dev: 30)']).toBe(
      '30',
    );
    expect(info['accounts that will LOSE platform.* (hosted dev: 7 accounts, 5 people)']).toBe(
      'owner@alpha.test',
    );
  });

  it('TEST-RUNBOOK-02 backup: one JSON object with exact role_permission rows and consistent counts, and the grant restore reads it', async () => {
    before = await signature();
    const result = await db.query(sqlOf('backup.sql'));
    const backup = result.rows[0].backup;
    expect(backup.format).toBe('dsa-0050-backup-v1');
    expect(backup.role_permission).toHaveLength(backup.counts.role_permission);
    expect(backup.role_permission).toHaveLength(44); // 30 operator grants + 5 data_correction.approve + 9 data_correction.request
    writeFileSync(backupFile, JSON.stringify({ rows: [{ backup }] }));
    const restore = execFileSync(process.execPath, [path.join(OPS, 'restore-grants.mjs'), backupFile], {
      encoding: 'utf8',
    });
    expect(restore).toContain(`Restores ${backup.counts.role_permission} role_permission rows`);
    expect(restore).toContain('ON CONFLICT DO NOTHING');
    // A damaged backup is refused rather than half-restored.
    writeFileSync(
      path.join(work, 'bad.json'),
      JSON.stringify({ rows: [{ backup: { ...backup, counts: { ...backup.counts, role_permission: 1 } } }] }),
    );
    expect(() =>
      execFileSync(process.execPath, [path.join(OPS, 'restore-grants.mjs'), path.join(work, 'bad.json')], {
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    ).toThrow();
  });

  it('TEST-RUNBOOK-03 apply: the migration runs once in a transaction and verify.sql passes every row', async () => {
    await db.query(applyFile());
    const rows = await checks('verify.sql');
    expect(rows.length).toBeGreaterThanOrEqual(30);
    expect(rows.filter((r) => r.result !== 'PASS').map((r) => `${r.name}: ${r.actual}`)).toEqual([]);
  });

  it('TEST-RUNBOOK-04 behaviour check as the API role: every line passes, and it leaves nothing behind', async () => {
    const snapshot = await signature();
    let message = '';
    try {
      await db.query(sqlOf('verify-behaviour.sql'));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('VERIFY-BEHAVIOUR (rolled back on purpose)');
    const lines = message.split('\n').filter((l) => /^(PASS|FAIL) \|/.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(20);
    expect(lines.filter((l) => l.startsWith('FAIL'))).toEqual([]);
    expect(await signature()).toEqual(snapshot);
  });

  it('TEST-RUNBOOK-05 applying twice is safe: the second run fails as a whole and changes nothing', async () => {
    const applied = await signature();
    await expect(db.query(applyFile())).rejects.toThrow(/already exists/);
    await db.query('ROLLBACK').catch(() => undefined);
    expect(await signature()).toEqual(applied);
  });

  it('TEST-RUNBOOK-06 rollback stops, changing nothing, when the new shape already holds data the old one cannot', async () => {
    await db.query(
      `insert into app.data_correction_request (id, tenant_id, justification, script_ref, requested_by, status, created_by)
       values ('dcr_api_1', 'ten_demo_01', 'API shaped correction', 'SCR-1', 'usr_x', 'PENDING', 'usr_x')`,
    );
    const applied = await signature();
    const restore = execFileSync(process.execPath, [path.join(OPS, 'restore-grants.mjs'), backupFile], {
      encoding: 'utf8',
    });
    await expect(db.query(wrap(`${sqlOf('rollback.sql')}\n${restore}`))).rejects.toThrow(/ROLLBACK STOPPED/);
    await db.query('ROLLBACK').catch(() => undefined);
    expect(await signature()).toEqual(applied);
    await db.query(`delete from app.data_correction_request where id = 'dcr_api_1'`);
  });

  it('TEST-RUNBOOK-07 rollback restores the original state exactly, and preflight passes again afterwards', async () => {
    const restore = execFileSync(process.execPath, [path.join(OPS, 'restore-grants.mjs'), backupFile], {
      encoding: 'utf8',
    });
    await db.query(wrap(`${sqlOf('rollback.sql')}\n${restore}`));
    expect(await signature()).toEqual(before);
    const rows = await checks('preflight.sql');
    expect(rows.filter((r) => r.severity === 'REQUIRED' && r.result !== 'PASS')).toEqual([]);
  });

  it('TEST-RUNBOOK-08 after a rollback the migration can be applied again, and verifies again', async () => {
    await db.query(applyFile());
    expect((await checks('verify.sql')).filter((r) => r.result !== 'PASS')).toEqual([]);
  });

  it('TEST-RUNBOOK-09 once platform audit events exist, rollback suspends the platform tenant instead of deleting it, and still restores everything else', async () => {
    await db.query(
      `insert into app.audit_event (id, tenant_id, actor_type, actor_id, action, entity_type, entity_id, correlation_id)
       values ('aud_runbook_1', $1, 'USER', 'usr_platform_1', 'platform.tenants_listed', 'TENANT', null, 'corr-runbook-1')`,
      [PLATFORM],
    );
    const restore = execFileSync(process.execPath, [path.join(OPS, 'restore-grants.mjs'), backupFile], {
      encoding: 'utf8',
    });
    await db.query(wrap(`${sqlOf('rollback.sql')}\n${restore}`));
    expect(
      (await db.query(`select status, tenant_type from app.tenant where id = $1`, [PLATFORM])).rows[0],
    ).toEqual({ status: 'SUSPENDED', tenant_type: 'PLATFORM' });
    const now = (await signature()) as Record<string, unknown>;
    const was = before as Record<string, unknown>;
    // Everything except the (suspended) platform tenant and the type check that must keep allowing it is back as it was.
    expect(now.policies).toEqual(was.policies);
    expect(now.rls).toEqual(was.rls);
    expect(now.rolePermission).toEqual(was.rolePermission);
    expect(now.roles).toEqual(was.roles); // the platform roles and their grants are gone even though the tenant row stays
    expect(now.orgsAndBranches).toEqual(was.orgsAndBranches);
    expect(now.functions).toEqual(was.functions);
    expect(now.columns).toEqual(was.columns);
  });
});
