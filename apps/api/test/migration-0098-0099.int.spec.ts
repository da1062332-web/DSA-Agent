// Rehearsal for origin's migrations 0098 (sub-permission expand) and 0099 (per-role grants), with their verify and rollback scripts. A database is
// built from the migrations before 0098, roles that hold parent grants are written as they would be then, and the runbook's snapshots are
// taken. Then: apply, verify, roll back (refusing when a grant was made by hand, or the snapshot is missing), roll back again, and apply again.
// Local container only. The real migrations folder is not changed: the rehearsal copies the earlier ones into a temporary folder.
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IsolationEnv } from '../../../tests/isolation/harness';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const BATCH = path.join(ROOT, 'tools/sql/batch');
const file = (prefix: string) => readdirSync(MIGRATIONS).find((f) => f.startsWith(prefix))!;
const M98 = file('20261001000098_');
const M99 = file('20261001000099_');
const sql = (name: string) => readFileSync(name, 'utf8');

type Row = { check: string; result: string; detail: string };
const ROLE = {
  tenantAdmin: 'rol_m98_tadmin',
  branch: 'rol_m98_branch',
  rm: 'rol_m98_rm',
  compliance: 'rol_m98_compliance',
} as const;

let env: IsolationEnv;
let tmp = '';

const exec = async (text: string) => {
  const result = await env.admin.query(text);
  return (Array.isArray(result) ? result[result.length - 1] : result) as { rows: Record<string, unknown>[] };
};
const verify = async (script: string) => (await exec(sql(path.join(BATCH, script)))).rows as Row[];
const failures = (rows: Row[]) => rows.filter((r) => r.result === 'FAIL');
const holds = async (roleId: string, code: string) =>
  (
    await exec(
      `select 1 from app.role_permission where role_id = '${roleId}' and permission_code = '${code}'`,
    )
  ).rows.length === 1;
const snapshotPre98 = `
  CREATE SCHEMA IF NOT EXISTS dsa_backup;
  DROP TABLE IF EXISTS dsa_backup.permission_pre_m098;
  DROP TABLE IF EXISTS dsa_backup.role_permission_pre_m098;
  CREATE TABLE dsa_backup.permission_pre_m098 AS SELECT * FROM app.permission;
  CREATE TABLE dsa_backup.role_permission_pre_m098 AS SELECT * FROM app.role_permission;`;
const snapshotPre99 = `
  DROP TABLE IF EXISTS dsa_backup.role_permission_pre_m099;
  CREATE TABLE dsa_backup.role_permission_pre_m099 AS SELECT * FROM app.role_permission;`;
const confirm98 = "SET dsa.rollback_m098_confirmed = 'no-human-grants';";
const confirm99 = "SET dsa.rollback_m099_confirmed = 'no-human-grants';";
const refused = (text: string) => expect(exec(text)).rejects.toThrow('Refused');

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'dsa-pre0098-'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql') && x < '20261001000098')) {
    copyFileSync(path.join(MIGRATIONS, f), path.join(tmp, f));
  }
  process.env.DSA_MIGRATIONS_DIR = tmp;
  // Imported after the variable is set: the harness reads it when it loads.
  const { startIsolationEnv } = await import('../../../tests/isolation/harness');
  env = await startIsolationEnv();

  // The roles as they are before 0098: template roles that hold the parent codes the backfill copies from.
  const t = env.A.tenantId;
  await env.admin.query(`
    INSERT INTO app.role (id, tenant_id, code, name, created_by) VALUES
      ('${ROLE.tenantAdmin}', '${t}', 'ROLE-TENANT-ADMIN', 'Tenant Administrator', 'iso'),
      ('${ROLE.branch}', '${t}', 'ROLE-BRANCH-MGR', 'Branch Manager', 'iso'),
      ('${ROLE.rm}', '${t}', 'ROLE-RM', 'Relationship Manager', 'iso'),
      ('${ROLE.compliance}', '${t}', 'ROLE-COMPLIANCE', 'Compliance', 'iso');
    INSERT INTO app.role_permission (tenant_id, role_id, permission_code) VALUES
      ('${t}', '${ROLE.tenantAdmin}', 'config.manage'),
      ('${t}', '${ROLE.branch}', 'report.read'),
      ('${t}', '${ROLE.branch}', 'target.manage'),
      ('${t}', '${ROLE.rm}', 'application.read'),
      ('${t}', '${ROLE.compliance}', 'report.read');`);
});

afterAll(async () => {
  await env?.stop();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('migrations 0098 and 0099 (origin; verify and rollback scripts)', () => {
  it('the copies of the migration lists in the scripts match the migration files', () => {
    const m98 = sql(path.join(MIGRATIONS, M98));
    const m99 = sql(path.join(MIGRATIONS, M99));
    // Permission codes always contain a dot; role lists such as ('anon', 'authenticated') do not.
    const pairs = (text: string) =>
      [...text.matchAll(/\('([a-z_]+\.[a-z_.]+)', '([a-z_]+\.[a-z_.]+)'\)/g)].map(
        (m) => `('${m[1]}', '${m[2]}')`,
      );
    const grants = (text: string) =>
      [...text.matchAll(/\('(ROLE-[A-Z-]+)', '([a-z_.]+)'\)/g)].map((m) => `('${m[1]}', '${m[2]}')`);
    for (const script of ['98.verify.sql', '98.rollback.sql']) {
      const copied = pairs(sql(path.join(BATCH, script)));
      expect(copied.length, script).toBeGreaterThan(0);
      for (const p of copied) expect(m98.includes(p), `${script} ${p}`).toBe(true);
    }
    for (const script of ['99.verify.sql', '99.rollback.sql']) {
      const copied = grants(sql(path.join(BATCH, script)));
      expect(copied.length, script).toBeGreaterThan(0);
      for (const g of copied) expect(m99.includes(g), `${script} ${g}`).toBe(true);
    }
  });

  it('0098 applies to the pre-0098 database, and its verify passes', async () => {
    await exec(snapshotPre98);
    await exec(sql(path.join(MIGRATIONS, M98)));
    const rows = await verify('98.verify.sql');
    expect(failures(rows)).toEqual([]);
    expect(rows.length).toBeGreaterThanOrEqual(7);
  });

  it('the 0098 backfill grants what the migration says, and only from the parent codes a role holds', async () => {
    expect(await holds(ROLE.branch, 'performance.read')).toBe(true); // report.read -> performance.read
    expect(await holds(ROLE.branch, 'target.read')).toBe(true); // target.manage -> target.read
    expect(await holds(ROLE.rm, 'eligibility.read')).toBe(true); // application.read -> eligibility.read
    expect(await holds(ROLE.rm, 'lender_case.read')).toBe(true); // application.read -> lender_case.read
    expect(await holds(ROLE.tenantAdmin, 'org.manage')).toBe(true); // config.manage -> org.manage
    expect(await holds(ROLE.compliance, 'performance.read')).toBe(true); // report.read -> performance.read
    expect(await holds(ROLE.compliance, 'eligibility.read')).toBe(false); // no parent, no grant
    expect(await holds(ROLE.rm, 'ledger.journal_post')).toBe(false); // manual posting is never backfilled
  });

  it('0099 applies, and its verify passes', async () => {
    await exec(snapshotPre99);
    await exec(sql(path.join(MIGRATIONS, M99)));
    expect(failures(await verify('99.verify.sql'))).toEqual([]);
    expect(await holds(ROLE.rm, 'document.upload')).toBe(true);
    expect(await holds(ROLE.rm, 'share.create')).toBe(true);
  });

  it('rollback 99 refuses without the snapshot, and without the confirmation', async () => {
    await exec('ALTER TABLE dsa_backup.role_permission_pre_m099 RENAME TO role_permission_pre_m099_hidden');
    await exec(confirm99);
    await refused(sql(path.join(BATCH, '99.rollback.sql')));
    await exec('ALTER TABLE dsa_backup.role_permission_pre_m099_hidden RENAME TO role_permission_pre_m099');
    await exec('RESET dsa.rollback_m099_confirmed');
    await refused(sql(path.join(BATCH, '99.rollback.sql')));
    expect(await holds(ROLE.rm, 'document.upload')).toBe(true);
  });

  it('rollback 99 removes only the grants 0099 added, and keeps the grants a role already held', async () => {
    await exec(confirm99);
    await exec(sql(path.join(BATCH, '99.rollback.sql')));
    expect(await holds(ROLE.rm, 'document.upload')).toBe(false);
    expect(await holds(ROLE.rm, 'share.create')).toBe(false);
    expect(await holds(ROLE.branch, 'report.read')).toBe(true); // held before 0099: the test inserted it
    expect(await holds(ROLE.rm, 'application.read')).toBe(true);
    expect(await holds(ROLE.branch, 'performance.read')).toBe(true); // from the 0098 backfill, not from 0099
    await exec('RESET dsa.rollback_m099_confirmed');
  });

  it('rollback 98 refuses without the snapshot or the confirmation, and refuses a grant made by hand', async () => {
    await exec(confirm98);
    await exec('ALTER TABLE dsa_backup.role_permission_pre_m098 RENAME TO role_permission_pre_m098_hidden');
    await refused(sql(path.join(BATCH, '98.rollback.sql')));
    await exec('ALTER TABLE dsa_backup.role_permission_pre_m098_hidden RENAME TO role_permission_pre_m098');
    await exec('RESET dsa.rollback_m098_confirmed');
    await refused(sql(path.join(BATCH, '98.rollback.sql')));

    // A sub-permission granted by hand after 0098, with no parent on the role: the rollback must not delete it silently.
    await exec(
      `INSERT INTO app.role_permission (tenant_id, role_id, permission_code) VALUES ('${env.A.tenantId}', '${ROLE.rm}', 'ledger.journal_post')`,
    );
    await exec(confirm98);
    await refused(sql(path.join(BATCH, '98.rollback.sql')));
    await exec(
      `DELETE FROM app.role_permission WHERE role_id = '${ROLE.rm}' AND permission_code = 'ledger.journal_post'`,
    );
    await exec('RESET dsa.rollback_m098_confirmed');
  });

  it('rollback 98 removes the codes 0098 added, keeps attendance.read, and the verify then reports what is missing', async () => {
    await exec(confirm98);
    await exec(sql(path.join(BATCH, '98.rollback.sql')));
    expect(await holds(ROLE.rm, 'lender_case.read')).toBe(false);
    expect(await holds(ROLE.branch, 'performance.read')).toBe(false);
    expect(await holds(ROLE.rm, 'application.read')).toBe(true);
    expect(await holds(ROLE.rm, 'attendance.read')).toBe(true); // kept on purpose: a screen gate
    const catalogue = (
      await exec(`select count(*)::int as n from app.permission where code = 'lender_case.read'`)
    ).rows[0] as { n: number };
    expect(catalogue.n).toBe(0);
    expect(failures(await verify('98.verify.sql')).length).toBeGreaterThan(0);
    await exec('RESET dsa.rollback_m098_confirmed');
  });

  it('after a fresh snapshot, 0098 and 0099 apply again and both verify scripts pass', async () => {
    await exec(snapshotPre98);
    await exec(sql(path.join(MIGRATIONS, M98)));
    await exec(snapshotPre99);
    await exec(sql(path.join(MIGRATIONS, M99)));
    expect(failures(await verify('98.verify.sql'))).toEqual([]);
    expect(failures(await verify('99.verify.sql'))).toEqual([]);
    expect(await holds(ROLE.branch, 'performance.read')).toBe(true);
    expect(await holds(ROLE.rm, 'document.upload')).toBe(true);
  });
});
