// TEST-ACL-M104: rehearsal for migration 0104 (task P0-07, role-based UI cleanup), with its verify and rollback scripts. A database is
// built from the migrations before 0104, the template roles are given a mix of grants the migration removes and grants it keeps, and a
// platform-realm role holds a code the migration lists for customer tenants. Then: verify fails, apply, verify passes, check who holds
// what, apply again, roll back from the runbook snapshot. Local container only; the real migrations folder is not changed.
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IsolationEnv } from '../../../tests/isolation/harness';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const BATCH = path.join(ROOT, 'tools/sql/batch');
const M104 = readdirSync(MIGRATIONS).find((f) => f.startsWith('20261001000104_'))!;
const sql = (name: string) => readFileSync(name, 'utf8');
const PLATFORM_TENANT = 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG';

// role code -> [codes 0104 removes, codes it must keep]
const SETUP: Record<string, [string[], string[]]> = {
  'ROLE-BRANCH-MGR': [
    ['finance.view', 'invoice.view', 'api.manage', 'verification.perform'],
    ['commission.view', 'payout.view', 'verification.read', 'user.manage'],
  ],
  'ROLE-TENANT-ADMIN': [
    ['platform.console', 'lead.read', 'application.read'],
    ['config.manage', 'user.manage', 'audit.read'],
  ],
  'ROLE-SALES-EXEC': [
    ['customer.read', 'privacy.read'],
    ['lead.read', 'consent.record'],
  ],
  'ROLE-COMPLIANCE': [['attendance.read'], ['audit.read', 'verification.read']],
};

type Row = { check: string; result: string; detail: string };
let env: IsolationEnv;
let tmp = '';
let A = '';
let B = '';

const exec = async (text: string) => {
  const result = await env.admin.query(text);
  return (Array.isArray(result) ? result[result.length - 1] : result) as { rows: Record<string, unknown>[] };
};
const verify = async () => (await exec(sql(path.join(BATCH, '104.verify.sql')))).rows as Row[];
const failures = (rows: Row[]) => rows.filter((r) => r.result === 'FAIL');
const held = async (tenant: string, code: string) =>
  (
    await exec(`select rp.permission_code from app.role_permission rp join app.role r on r.tenant_id = rp.tenant_id and r.id = rp.role_id
                 where r.tenant_id = '${tenant}' and r.code = '${code}' order by 1`)
  ).rows.map((r) => r.permission_code as string);

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'dsa-pre0104-'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql') && x < '20261001000104')) {
    copyFileSync(path.join(MIGRATIONS, f), path.join(tmp, f));
  }
  process.env.DSA_MIGRATIONS_DIR = tmp;
  // Imported after the variable is set: the harness reads it when it loads.
  const { startIsolationEnv } = await import('../../../tests/isolation/harness');
  env = await startIsolationEnv();
  A = env.A.tenantId;
  B = env.B.tenantId;

  const roles: string[] = [];
  const grants: string[] = [];
  for (const t of [A, B])
    for (const [code, [cut, keep]] of Object.entries(SETUP)) {
      const id = `rol_m104_${code.toLowerCase().replace(/[^a-z]/g, '')}_${t}`;
      roles.push(`('${id}', '${t}', '${code}', '${code}', true, 'iso')`);
      for (const p of [...cut, ...keep]) grants.push(`('${t}', '${id}', '${p}')`);
    }
  await exec(`
    INSERT INTO app.role (id, tenant_id, code, name, is_template, created_by)
      VALUES ${roles.join(', ')} ON CONFLICT (tenant_id, code) DO NOTHING;
    INSERT INTO app.role_permission (tenant_id, role_id, permission_code) VALUES ${grants.join(', ')} ON CONFLICT DO NOTHING;
    -- A platform-realm role holding a code the migration lists for customer tenants: it must stay.
    INSERT INTO app.role (id, tenant_id, code, name, is_template, created_by)
      VALUES ('rol_m104_platform_admin', '${PLATFORM_TENANT}', 'ROLE-TENANT-ADMIN', 'Platform copy', false, 'iso')
      ON CONFLICT (tenant_id, code) DO NOTHING;
    INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
      VALUES ('${PLATFORM_TENANT}', 'rol_m104_platform_admin', 'platform.console') ON CONFLICT DO NOTHING;
    -- The runbook snapshot the rollback restores from.
    CREATE SCHEMA IF NOT EXISTS dsa_backup;
    CREATE TABLE dsa_backup.role_permission_pre_m104 AS SELECT * FROM app.role_permission;`);
});

afterAll(async () => {
  await env?.stop();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('TEST-ACL-M104 migration 0104 trims the grants behind screens a role does not use', () => {
  it('TEST-ACL-M104-01 the verify script fails before the apply', async () => {
    expect(failures(await verify()).map((r) => r.check)).toEqual([
      'no customer-tenant template role still holds a trimmed grant',
    ]);
  });

  it('TEST-ACL-M104-02 applies, and its verify passes', async () => {
    await exec(sql(path.join(MIGRATIONS, M104)));
    expect(failures(await verify())).toEqual([]);
  });

  it('TEST-ACL-M104-03 each role keeps exactly the grants not on the list, in both tenants', async () => {
    for (const t of [A, B])
      for (const [code, [, keep]] of Object.entries(SETUP))
        expect(await held(t, code)).toEqual([...keep].sort());
  });

  it('TEST-ACL-M104-04 the platform realm is not touched', async () => {
    expect(await held(PLATFORM_TENANT, 'ROLE-TENANT-ADMIN')).toEqual(['platform.console']);
  });

  it('TEST-ACL-M104-05 applying again changes nothing', async () => {
    const before = await exec(`select count(*)::int as n from app.role_permission`);
    await exec(sql(path.join(MIGRATIONS, M104)));
    const after = await exec(`select count(*)::int as n from app.role_permission`);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it('TEST-ACL-M104-06 the rollback puts back exactly the removed grants from the snapshot', async () => {
    await exec(sql(path.join(BATCH, '104.rollback.sql')));
    for (const t of [A, B])
      for (const [code, [cut, keep]] of Object.entries(SETUP))
        expect(await held(t, code)).toEqual([...cut, ...keep].sort());
    // Back where it started, the verify fails again.
    expect(failures(await verify())).toHaveLength(1);
  });

  it('TEST-ACL-M104-07 the verify and rollback scripts carry the same pair list as the migration', () => {
    const list = (text: string) =>
      [...text.matchAll(/\(\s*'(ROLE-[A-Z-]+)'\s*,\s*'([a-z_.]+)'\s*\)/g)].map((m) => `${m[1]} ${m[2]}`);
    const fromMigration = list(sql(path.join(MIGRATIONS, M104)));
    expect(fromMigration).toHaveLength(61);
    expect(list(sql(path.join(BATCH, '104.verify.sql')))).toEqual(fromMigration);
    expect(list(sql(path.join(BATCH, '104.rollback.sql')))).toEqual(fromMigration);
  });
});
