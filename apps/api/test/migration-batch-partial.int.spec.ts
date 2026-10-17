// What happens when the hosted batch stops half way, or has to be backed out (owner: Dev 1). Never touches hosted.
// 1. Each migration applied through the REAL wrapper (tools/sql/make-apply-run.mjs) is all-or-nothing: a statement that fails at the end
//    leaves the database exactly as it was.
// 2. Stopping after any number of migrations and rolling the applied ones back in reverse order succeeds, and every row that existed
//    before the batch (operator-edited flags, custom roles and their grants, master data, users, tenants) is still there unchanged.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres } from '../../../tests/guard/start-postgres';

const ROOT = path.resolve(__dirname, '../../..');
const DIR = process.env.DSA_MIGRATIONS_DIR ?? path.join(ROOT, 'supabase/migrations');
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const migration = (n: string) => files.find((f) => f.startsWith(`202610010000${n}_`))!;
const PENDING = ['54', '55', '56', '57', '58', '59', '60', '61', '62', '63', '64', '65'];
const ORDER = ['54', '57', '59', '60', '61', '58', '55', '63', '64', '65'];
const rollbackFile = (n: string) =>
  n === '54'
    ? path.join(ROOT, 'tools/sql/0054/rollback.sql')
    : path.join(ROOT, 'tools/sql/batch', `${n}.rollback.sql`);

let container: StartedPostgreSqlContainer;
let admin: pg.Client;
let seq = 0;

const connectTo = async (database: string) => {
  const url = new URL(container.getConnectionUri());
  url.pathname = `/${database}`;
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  return c;
};

async function fresh(): Promise<pg.Client> {
  const name = `pt_${seq++}`;
  await admin.query(`CREATE DATABASE ${name} TEMPLATE partial_base`);
  return connectTo(name);
}

/** Structure, policies, triggers, constraints, permissions, grants, flags, rule sets and functions, reduced to one hash. */
const fingerprint = async (db: pg.Client, withRules = true) => {
  await db.query('RESET search_path');
  return (
    await db.query(`
      SELECT md5(string_agg(x, '|' ORDER BY x)) AS h FROM (
        SELECT 'col:' || table_name || '.' || column_name || ':' || data_type AS x FROM information_schema.columns WHERE table_schema = 'app'
        UNION ALL SELECT 'pol:' || tablename || '.' || policyname FROM pg_policies WHERE schemaname = 'app'
        UNION ALL SELECT 'trg:' || tgrelid::regclass || '.' || tgname FROM pg_trigger WHERE NOT tgisinternal
        UNION ALL SELECT 'con:' || conrelid::regclass || '.' || conname FROM pg_constraint WHERE connamespace = 'app'::regnamespace
        UNION ALL SELECT 'perm:' || code FROM app.permission
        UNION ALL SELECT 'grant:' || r.tenant_id || r.code || ':' || rp.permission_code FROM app.role_permission rp JOIN app.role r ON r.id = rp.role_id AND r.tenant_id = rp.tenant_id
        UNION ALL SELECT 'flag:' || key || ':' || scope || ':' || value FROM app.feature_flag
        UNION ALL SELECT 'fn:' || p.proname FROM pg_proc p WHERE p.pronamespace = 'app'::regnamespace
        UNION ALL SELECT 'colpriv:' || table_name || '.' || column_name || ':' || privilege_type FROM information_schema.column_privileges WHERE table_schema = 'app' AND grantee = 'dsa_app'
        UNION ALL SELECT 'tblpriv:' || table_name || ':' || privilege_type FROM information_schema.table_privileges WHERE table_schema = 'app' AND grantee = 'dsa_app'
        ${withRules ? "UNION ALL SELECT 'rs:' || id || ':' || status FROM app.rule_set UNION ALL SELECT 'rsv:' || id || ':' || status FROM app.rule_set_version" : ''}
      ) t`)
  ).rows[0].h as string;
};

/** The rows that existed before the batch and must never be lost: as one hash per table. */
const preExisting = async (db: pg.Client) => {
  const one = async (sql: string) =>
    (
      await db.query(
        `SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM (${sql}) t`,
      )
    ).rows[0].h as string;
  return {
    tenants: await one('SELECT id, slug, status FROM app.tenant'),
    users: await one('SELECT id, tenant_id, status FROM app.app_user'),
    roles: await one('SELECT id, tenant_id, code, name FROM app.role'),
    flags: await one(
      "SELECT key, scope, value, updated_by FROM app.feature_flag WHERE updated_by = 'usr_operator_edit'",
    ),
    master: await one(
      "SELECT dataset, code, label, created_by FROM app.master_data_item WHERE created_by = 'usr_operator_seed'",
    ),
    customRole: await one(
      "SELECT rp.tenant_id, rp.permission_code FROM app.role_permission rp JOIN app.role r ON r.id = rp.role_id AND r.tenant_id = rp.tenant_id WHERE r.code = 'ROLE-CUSTOM-PARTIAL'",
    ),
    grantsKept: await one(
      "SELECT rp.tenant_id, rp.role_id, rp.permission_code FROM app.role_permission rp WHERE rp.permission_code NOT IN ('role.manage','eligibility.override','security.incident','security.vuln','sanction.record','disbursement.record','disbursement.verify','disbursement.exception_approve')",
    ),
  };
};

beforeAll(async () => {
  container = await startPostgres();
  admin = await connectTo('postgres');
  await admin.query('CREATE DATABASE partial_base');
  const base = await connectTo('partial_base');
  const fixture = (name: string) => readFileSync(path.join(ROOT, 'tests/guard/fixtures', name), 'utf8');
  const pending = new Set(PENDING.map(migration));
  // Hosted ran the ORIGINAL 0053 (the connector statement table was called ledger_entry), so the starting state uses that text.
  const original0053 = readFileSync(
    path.join(ROOT, 'tests/guard/fixtures/0053-as-applied-on-hosted.sql'),
    'utf8',
  );
  for (const f of files.filter((x) => !pending.has(x))) {
    await base.query(
      f.startsWith('20261001000053_') ? original0053 : readFileSync(path.join(DIR, f), 'utf8'),
    );
    if (f.startsWith('20261001000001_')) await base.query(fixture('hosted-test-fixtures.early.sql'));
  }
  await base.query(fixture('hosted-test-fixtures.late.sql'));
  // Data an operator created on hosted before the batch: it must survive the batch and any rollback of it.
  await base.query(
    `UPDATE app.feature_flag SET value = NOT value, updated_by = 'usr_operator_edit', lock_version = lock_version + 1 WHERE key = (SELECT key FROM app.feature_flag ORDER BY key LIMIT 1)`,
  );
  await base.query(
    `INSERT INTO app.master_data_item (dataset, code, label, created_by) VALUES ('states', 'MH', 'Maharashtra (operator)', 'usr_operator_seed'), ('custom_list', 'X1', 'Custom', 'usr_operator_seed') ON CONFLICT DO NOTHING`,
  );
  await base.query(
    `INSERT INTO app.role (id, tenant_id, code, name, is_template, created_by) SELECT 'rol_custom_' || t.id, t.id, 'ROLE-CUSTOM-PARTIAL', 'Custom partial role', false, 'usr_operator' FROM app.tenant t WHERE t.slug <> 'platform-operations'`,
  );
  await base.query(
    `INSERT INTO app.role_permission (tenant_id, role_id, permission_code) SELECT r.tenant_id, r.id, 'lead.read' FROM app.role r WHERE r.code = 'ROLE-CUSTOM-PARTIAL'`,
  );
  await base.end();
}, 300_000);

afterAll(async () => {
  await admin?.end();
  await container?.stop();
});

describe('hosted batch: stopping half way and backing out', () => {
  for (const n of ORDER) {
    it(`TEST-PARTIAL-ATOMIC 00${n} through the real wrapper: a failure at the end leaves nothing behind`, async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), `dsa-wrap-${n}-`));
      const out = execFileSync(
        'node',
        [path.join(ROOT, 'tools/sql/make-apply-run.mjs'), path.join(DIR, migration(n)), dir],
        { encoding: 'utf8' },
      );
      expect(out).toContain('body equals the migration: YES');
      const wrapper = readFileSync(path.join(dir, 'apply-run.sql'), 'utf8');
      expect(wrapper).toMatch(/BEGIN;[\s\S]*COMMIT;\s*$/);
      const broken = wrapper.replace(/COMMIT;\s*$/, 'SELECT 1/0;\nCOMMIT;\n');
      writeFileSync(path.join(dir, 'broken.sql'), broken);

      const db = await fresh();
      try {
        const before = await fingerprint(db);
        await expect(db.query(broken)).rejects.toThrow(/division by zero/);
        await db.query('ROLLBACK').catch(() => undefined);
        expect(await fingerprint(db), `00${n} left something behind after a failure`).toBe(before);

        // and the wrapper without the failure does apply, in one transaction
        await db.query(wrapper);
        expect(await fingerprint(db)).not.toBe(before);
      } finally {
        await db.end();
      }
    });
  }

  for (const k of [1, 3, 5, 7, 9, 10]) {
    it(`TEST-PARTIAL-ROLLBACK stopped after ${k} of ${ORDER.length}: rolling the applied ones back in reverse order restores the database and keeps every earlier row`, async () => {
      const db = await fresh();
      try {
        const applied = ORDER.slice(0, k);
        const hasRules = applied.includes('55');
        const before = await fingerprint(db, false);
        const rows = await preExisting(db);

        for (const n of applied) await db.query(readFileSync(path.join(DIR, migration(n)), 'utf8'));
        for (const n of [...applied].reverse()) {
          try {
            await db.query(readFileSync(rollbackFile(n), 'utf8'));
          } catch (e) {
            throw new Error(
              `rollback of 00${n} after applying ${applied.join(', ')} failed: ${(e as Error).message}`,
            );
          }
        }

        expect(await fingerprint(db, false), `state after rolling back ${applied.join(', ')}`).toBe(before);
        expect(await preExisting(db), 'rows that existed before the batch changed').toEqual(rows);
        if (hasRules) {
          // Rule versions are append-only, so 0055's rollback retires them: nothing seeded is still in force.
          const active = await db.query(
            `SELECT count(*)::int AS n FROM app.rule_set_version WHERE id LIKE 'rsv_elg_%' AND status = 'ACTIVE'`,
          );
          expect(active.rows[0].n).toBe(0);
        }
      } finally {
        await db.end();
      }
    });
  }

  it('TEST-PARTIAL-DATA a grant added by hand AFTER the batch is removed by the matching rollback: that is the one place a rollback loses later work, and it is documented', async () => {
    const db = await fresh();
    await db.query(readFileSync(path.join(DIR, migration('55')), 'utf8'));
    const custom = await db.query(
      `SELECT tenant_id, id FROM app.role WHERE code = 'ROLE-CUSTOM-PARTIAL' LIMIT 1`,
    );
    await db.query(
      `INSERT INTO app.role_permission (tenant_id, role_id, permission_code) VALUES ($1, $2, 'eligibility.override')`,
      [custom.rows[0].tenant_id, custom.rows[0].id],
    );
    await db.query(readFileSync(rollbackFile('55'), 'utf8'));
    expect(
      (
        await db.query(
          `SELECT count(*)::int AS n FROM app.role_permission WHERE permission_code = 'eligibility.override'`,
        )
      ).rows[0].n,
    ).toBe(0);
    expect(readFileSync(path.join(ROOT, 'tools/sql/batch/README.md'), 'utf8')).toMatch(
      /removes the override grants/i,
    );
    await db.end();
  });
});
