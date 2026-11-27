// TEST-CUST-M118: rehearsal for migration 0118 (customer edit grants, P1-02 follow-up). Database built from the migrations before 0118,
// with the three roles present in tenant A and the owner already holding customer.reveal_sensitive (as M-085 grants on a fresh database).
// Verify FAILs, 0118 applies twice (idempotent), verify passes, and the rollback removes only what 0118 added. Synthetic data only.
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IsolationEnv } from '../../../tests/isolation/harness';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const BATCH = path.join(ROOT, 'tools/sql/batch');
const M118 = readdirSync(MIGRATIONS).find((f) => f.startsWith('20261001000118_'))!;
const sql = (name: string) => readFileSync(name, 'utf8');

type Row = { check: string; result: string; detail: string };
let env: IsolationEnv;
let tmp = '';
let A = '';

const exec = async (text: string) => {
  const result = await env.admin.query(text);
  return (Array.isArray(result) ? result[result.length - 1] : result) as { rows: Record<string, unknown>[] };
};
const verify = async () => (await exec(sql(path.join(BATCH, '118.verify.sql')))).rows as Row[];
const failures = (rows: Row[]) => rows.filter((r) => r.result === 'FAIL');
const holds = async (role: string, code: string) =>
  (
    await exec(`select count(*)::int as n from app.role_permission rp join app.role r on r.tenant_id = rp.tenant_id and r.id = rp.role_id
                 where r.tenant_id = '${A}' and r.code = '${role}' and rp.permission_code = '${code}'`)
  ).rows[0]!.n as number;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'dsa-pre0118-'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql') && x < '20261001000118')) {
    copyFileSync(path.join(MIGRATIONS, f), path.join(tmp, f));
  }
  process.env.DSA_MIGRATIONS_DIR = tmp;
  const { startIsolationEnv } = await import('../../../tests/isolation/harness');
  env = await startIsolationEnv();
  A = env.A.tenantId;
  await exec(`
    INSERT INTO app.role (id, tenant_id, code, name, is_template, created_by) VALUES
      ('rol_m118_rm_${A}', '${A}', 'ROLE-RM', 'Relationship manager', false, 'iso'),
      ('rol_m118_ops_${A}', '${A}', 'ROLE-LOAN-OPS', 'Loan operations', false, 'iso'),
      ('rol_m118_own_${A}', '${A}', 'ROLE-ORG-OWNER', 'DSA owner', false, 'iso')
    ON CONFLICT DO NOTHING;
    -- The owner already holds reveal before 0118 (as M-085 grants it); the rollback must keep this grant.
    INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
    SELECT r.tenant_id, r.id, 'customer.reveal_sensitive' FROM app.role r WHERE r.tenant_id = '${A}' AND r.code = 'ROLE-ORG-OWNER'
    ON CONFLICT DO NOTHING;
  `);
}, 240_000);

afterAll(async () => {
  await env?.stop();
  delete process.env.DSA_MIGRATIONS_DIR;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('TEST-CUST-M118 migration 0118 rehearsal', () => {
  it('TEST-CUST-M118-01 before the apply the grant row FAILs', async () => {
    expect(failures(await verify()).length).toBeGreaterThan(0);
  });

  it('TEST-CUST-M118-02 applying 0118 twice leaves every verify row PASS and adds exactly the four grants', async () => {
    await exec(`CREATE SCHEMA IF NOT EXISTS dsa_backup;
                CREATE TABLE dsa_backup.role_permission_pre_m118 AS SELECT * FROM app.role_permission;`);
    await exec(sql(path.join(MIGRATIONS, M118)));
    await exec(sql(path.join(MIGRATIONS, M118)));
    const rows = await verify();
    expect(failures(rows), JSON.stringify(failures(rows))).toEqual([]);
    expect(await holds('ROLE-RM', 'customer.update')).toBe(1);
    expect(await holds('ROLE-LOAN-OPS', 'customer.read')).toBe(1);
    expect(await holds('ROLE-LOAN-OPS', 'customer.update')).toBe(1);
    expect(await holds('ROLE-ORG-OWNER', 'customer.reveal_sensitive')).toBe(1);
  });

  it('TEST-CUST-M118-03 the rollback removes only what 0118 added; the earlier owner grant stays', async () => {
    await exec(sql(path.join(BATCH, '118.rollback.sql')));
    expect(await holds('ROLE-RM', 'customer.update')).toBe(0);
    expect(await holds('ROLE-LOAN-OPS', 'customer.update')).toBe(0);
    expect(await holds('ROLE-ORG-OWNER', 'customer.reveal_sensitive')).toBe(1);
  });
});
