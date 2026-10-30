// Integration test for migration 0097's precheck and its verify script, on a throwaway PostgreSQL that holds every migration before 0097
// (the hosted state before the connector guard). It proves the migration refuses to apply while a connector login holds an open role,
// the verify script reports exactly that, and the migration applies once the open assignments have ended (their history kept).
// Synthetic data only. Needs Docker (Testcontainers) and is run by the guarded integration config.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres } from '../../../tests/guard/start-postgres';

const MIGRATIONS = path.resolve(__dirname, '../../../supabase/migrations');
const GUARD = '20261001000097_connector_role_guard.sql';
const VERIFY = path.resolve(__dirname, '../../../tools/sql/batch/97.verify.sql');
const ROLLBACK = path.resolve(__dirname, '../../../tools/sql/batch/97.rollback.sql');
// A valid ULID-shaped tenant id: 26 characters after the prefix, as the isolation harness uses.
const TENANT = `ten_${'0'.repeat(25)}P`;
const BRANCH = 'br_pre_1';
const CONNECTOR_LOGIN = 'usr_pre_portal';
const STAFF = 'usr_pre_staff';
const RM = 'role_pre_rm';
const RESERVED = 'role_pre_portal';
const RM_ROW = 'ura_pre_connector';
const RESERVED_ROW = 'ura_pre_staff';

let container: StartedPostgreSqlContainer;
let db: pg.Client;

beforeAll(async () => {
  container = await startPostgres();
  db = new pg.Client({ connectionString: container.getConnectionUri() });
  await db.connect();
  await db.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  END $$;`);
  // Every migration before the guard, in order: the state hosted is in before 0097 is applied.
  const before = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql') && f < GUARD)
    .sort();
  for (const f of before) await db.query(readFileSync(path.join(MIGRATIONS, f), 'utf8'));

  // A tenant with a branch, a role, a connector portal login and a staff account; the staff account also holds a reserved role.
  await db.query(
    `insert into app.tenant (id, slug, legal_name, tenant_type, created_by) values ($1, 'pre-tenant', 'Tenant', 'DSA_ORG', 'iso')`,
    [TENANT],
  );
  await db.query(
    `insert into app.organisation (id, tenant_id, legal_name, constitution, created_by, updated_by)
     values ('org_pre_1', $1, 'Same Name Pvt Ltd', 'PVT_LTD', 'iso', 'iso')`,
    [TENANT],
  );
  await db.query(
    `insert into app.branch (id, tenant_id, organisation_id, code, name, created_by, updated_by)
     values ($1, $2, 'org_pre_1', 'MUM01', 'Mumbai', 'iso', 'iso')`,
    [BRANCH, TENANT],
  );
  await db.query(
    `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, user_type, primary_branch_id, created_by, updated_by)
     values ($1, $2, 'sub-pre-portal', 'portal@pre.example.com', 'Portal Login', 'CONNECTOR', $3, 'iso', 'iso'),
            ($4, $2, 'sub-pre-staff', 'staff@pre.example.com', 'Staff', 'STAFF', $3, 'iso', 'iso')`,
    [CONNECTOR_LOGIN, TENANT, BRANCH, STAFF],
  );
  await db.query(
    `insert into app.role (id, tenant_id, code, name, is_template, created_by)
     values ($1, $2, 'ROLE-RM', 'Relationship manager', false, 'iso'),
            ($3, $2, 'ROLE-CONNECTOR-PORTAL', 'Legacy portal role', false, 'iso')`,
    [RM, TENANT, RESERVED],
  );
  // The two open assignments the precheck must find: the portal login holds RM, and the staff account holds the reserved role.
  await db.query(
    `insert into app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by)
     values ($1, $2, $3, $4, 'TENANT', '{}', 'iso'),
            ($5, $2, $6, $7, 'TENANT', '{}', 'iso')`,
    [RM_ROW, TENANT, CONNECTOR_LOGIN, RM, RESERVED_ROW, STAFF, RESERVED],
  );
}, 300_000);

afterAll(async () => {
  await db?.end();
  await container?.stop();
});

describe('migration 0097 precheck and verification (TEST-CONROLE-PRE)', () => {
  it('TEST-CONROLE-PRE-001 the migration refuses to apply while a connector login or a staff reserved role is still open', async () => {
    await expect(db.query(readFileSync(path.join(MIGRATIONS, GUARD), 'utf8'))).rejects.toThrow(
      /migration 0097 refused: 1 role assignment\(s\) on connector portal logins and 1 reserved-role assignment\(s\) on staff accounts/,
    );
    // Nothing was installed: the refusal is all or nothing.
    const installed = await db.query(
      `SELECT count(*)::int AS n FROM pg_trigger WHERE tgname IN ('user_role_assignment_user_type_guard', 'app_user_type_role_guard', 'role_reserved_code_guard') AND NOT tgisinternal`,
    );
    expect(installed.rows[0].n).toBe(0);
  });

  it('TEST-CONROLE-PRE-002 the verify script reports each open assignment and the missing guards as FAIL', async () => {
    const rows = (await db.query(readFileSync(VERIFY, 'utf8'))).rows as Array<{
      check: string;
      result: string;
      detail: string;
    }>;
    const failed = rows.filter((r) => r.result === 'FAIL').map((r) => r.check);
    expect(failed).toEqual(
      expect.arrayContaining([
        'no connector portal login holds a role that has not ended (expect 0)',
        'no staff account holds a reserved ROLE-CONNECTOR role that has not ended (expect 0)',
        'trigger user_role_assignment_user_type_guard is installed on user_role_assignment',
      ]),
    );
    expect(rows.find((r) => r.check.startsWith('no connector portal login'))!.detail).toBe(
      'open assignments: 1',
    );
  });

  it('TEST-CONROLE-PRE-003 once the open assignments have ended (history kept), the migration applies and the verify script passes', async () => {
    await db.query(
      `UPDATE app.user_role_assignment SET effective_range = tstzrange(lower(effective_range), now(), '[)')
        WHERE id IN ($1, $2)`,
      [RM_ROW, RESERVED_ROW],
    );
    await expect(db.query(readFileSync(path.join(MIGRATIONS, GUARD), 'utf8'))).resolves.toBeDefined();

    const history = await db.query(
      `SELECT count(*)::int AS n FROM app.user_role_assignment WHERE id IN ($1, $2)`,
      [RM_ROW, RESERVED_ROW],
    );
    expect(history.rows[0].n).toBe(2);

    const rows = (await db.query(readFileSync(VERIFY, 'utf8'))).rows as Array<{
      check: string;
      result: string;
    }>;
    expect(rows.filter((r) => r.result === 'FAIL')).toEqual([]);
    // The one INFO row is the legacy reserved role this fixture keeps (its history references it, so it cannot be deleted).
    expect(rows.filter((r) => r.result === 'INFO').map((r) => r.check)).toEqual([
      expect.stringContaining('reserved ROLE-CONNECTOR roles that already exist'),
    ]);
    expect(rows.length).toBe(7);
  });

  it('TEST-CONROLE-PRE-004 after the migration, a connector login still cannot take a role', async () => {
    await expect(
      db.query(
        `INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by)
         VALUES ('ura_pre_after', $1, $2, $3, 'TENANT', '{}', 'iso')`,
        [TENANT, CONNECTOR_LOGIN, RM],
      ),
    ).rejects.toThrow(/connector portal login cannot hold the role ROLE-RM/);
  });

  it('TEST-CONROLE-PRE-005 the rollback removes the three guards and changes no data', async () => {
    const rowsBefore = await db.query('SELECT count(*)::int AS n FROM app.user_role_assignment');
    await db.query(readFileSync(ROLLBACK, 'utf8'));
    const installed = await db.query(
      `SELECT count(*)::int AS n FROM pg_trigger WHERE tgname IN ('user_role_assignment_user_type_guard', 'app_user_type_role_guard', 'role_reserved_code_guard') AND NOT tgisinternal`,
    );
    expect(installed.rows[0].n).toBe(0);
    const rowsAfter = await db.query('SELECT count(*)::int AS n FROM app.user_role_assignment');
    expect(rowsAfter.rows[0].n).toBe(rowsBefore.rows[0].n);
    // The rollback is a real rollback: without the guard, a connector login takes a role again.
    await expect(
      db.query(
        `INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by)
         VALUES ('ura_pre_rolled', $1, $2, $3, 'TENANT', '{}', 'iso')`,
        [TENANT, CONNECTOR_LOGIN, RM],
      ),
    ).resolves.toBeDefined();
  });

  it('TEST-CONROLE-PRE-006 re-applying 0097 is refused while that open row exists, and applies once it has ended', async () => {
    await expect(db.query(readFileSync(path.join(MIGRATIONS, GUARD), 'utf8'))).rejects.toThrow(
      /migration 0097 refused: 1 role assignment\(s\) on connector portal logins/,
    );
    await db.query(
      `UPDATE app.user_role_assignment SET effective_range = tstzrange(lower(effective_range), now(), '[)') WHERE id = 'ura_pre_rolled'`,
    );
    await expect(db.query(readFileSync(path.join(MIGRATIONS, GUARD), 'utf8'))).resolves.toBeDefined();
    const rows = (await db.query(readFileSync(VERIFY, 'utf8'))).rows as Array<{
      check: string;
      result: string;
    }>;
    expect(rows.filter((r) => r.result === 'FAIL')).toEqual([]);
  });
});
