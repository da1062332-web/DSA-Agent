// TEST-ACL-M119: rehearsal for migration 0119 (delete retired roles). Database built from the migrations before 0119, with tenant A
// holding two retired roles kept for history (one with an assignment, one without) beside the live roles. 0119 refuses while a retired
// role is still held, then deletes the ended assignments and the retired roles, twice without error; verify passes; the rollback puts
// them back from the snapshots. Synthetic data only.
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IsolationEnv } from '../../../tests/isolation/harness';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const BATCH = path.join(ROOT, 'tools/sql/batch');
const M119 = readdirSync(MIGRATIONS).find((f) => f.startsWith('20261001000119_'))!;
const sql = (name: string) => readFileSync(name, 'utf8');

type Row = { check: string; result: string; detail: string };
let env: IsolationEnv;
let tmp = '';
let A = '';
let holder = '';

const exec = async (text: string, params?: unknown[]) => {
  const result = await env.admin.query(text, params);
  return (Array.isArray(result) ? result[result.length - 1] : result) as { rows: Record<string, unknown>[] };
};
const verify = async () => (await exec(sql(path.join(BATCH, '119.verify.sql')))).rows as Row[];
const failures = (rows: Row[]) => rows.filter((r) => r.result === 'FAIL');
const roleCodes = async () =>
  (await exec(`select code from app.role where tenant_id = $1 order by code`, [A])).rows.map(
    (r) => r.code as string,
  );
const assignmentsOf = async (roleId: string) =>
  (
    await exec(
      `select count(*)::int as n from app.user_role_assignment where tenant_id = $1 and role_id = $2`,
      [A, roleId],
    )
  ).rows[0]!.n as number;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'dsa-pre0119-'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql') && x < '20261001000119')) {
    copyFileSync(path.join(MIGRATIONS, f), path.join(tmp, f));
  }
  process.env.DSA_MIGRATIONS_DIR = tmp;
  const { startIsolationEnv } = await import('../../../tests/isolation/harness');
  env = await startIsolationEnv();
  A = env.A.tenantId;
  holder = env.A.userIds[1];
  await exec(
    `INSERT INTO app.role (id, tenant_id, code, name, is_template, version, created_by) VALUES
       ('rol_m119_own', $1, 'ROLE-ORG-OWNER', 'DSA owner', false, 1, 'iso'),
       ('rol_m119_rm', $1, 'ROLE-RM', 'Relationship manager', false, 1, 'iso'),
       ('rol_m119_ops', $1, 'ROLE-LOAN-OPS', 'Loan operations', false, 1, 'iso'),
       ('rol_m119_pol', $1, 'ROLE-POLICY-MGR', 'Lender policy manager', true, 1, 'iso'),
       ('rol_m119_doc', $1, 'ROLE-DOC-VERIFIER', 'Document verifier (retired)', false, 2, 'iso'),
       ('rol_m119_ra', $1, 'ROLE-RULE-AUTHOR', 'Rule author (retired)', false, 2, 'iso')
     ON CONFLICT DO NOTHING`,
    [A],
  );
  // An assignment of the retired Document verifier that is still open: 0119 must refuse until it is ended.
  await exec(
    `INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by)
     VALUES ('ura_m119_doc', $1, $2, 'rol_m119_doc', 'TENANT', '{}', 'SYSTEM:test')`,
    [A, holder],
  );
}, 240_000);

afterAll(async () => {
  await env?.stop();
  delete process.env.DSA_MIGRATIONS_DIR;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('TEST-ACL-M119 migration 0119 rehearsal', () => {
  it('TEST-ACL-M119-01 before the apply the retired roles FAIL the verify', async () => {
    expect(failures(await verify()).map((r) => r.check)).toContain('no customer tenant keeps a retired role');
  });

  it('TEST-ACL-M119-02 refuses, changing nothing, while a retired role is still held', async () => {
    await expect(exec(sql(path.join(MIGRATIONS, M119)))).rejects.toThrow(/M-119 refused: 1 open assignment/);
    expect(await roleCodes()).toContain('ROLE-DOC-VERIFIER');
    expect(await assignmentsOf('rol_m119_doc')).toBe(1);
  });

  it('TEST-ACL-M119-03 once the assignment has ended, applying 0119 twice deletes the retired roles and their history only', async () => {
    await exec(
      `UPDATE app.user_role_assignment SET effective_range = tstzrange(lower(effective_range), now(), '[)') WHERE id = 'ura_m119_doc'`,
    );
    await exec(`CREATE SCHEMA IF NOT EXISTS dsa_backup;
                CREATE TABLE dsa_backup.role_pre_m119 AS SELECT * FROM app.role;
                CREATE TABLE dsa_backup.user_role_assignment_pre_m119 AS SELECT * FROM app.user_role_assignment;`);
    await exec(sql(path.join(MIGRATIONS, M119)));
    await exec(sql(path.join(MIGRATIONS, M119)));
    const rows = await verify();
    expect(failures(rows), JSON.stringify(failures(rows))).toEqual([]);
    expect(await roleCodes()).toEqual(['ROLE-LOAN-OPS', 'ROLE-ORG-OWNER', 'ROLE-POLICY-MGR', 'ROLE-RM']);
    expect(await assignmentsOf('rol_m119_doc')).toBe(0);
  });

  it('TEST-ACL-M119-04 the rollback puts the retired roles and the ended assignment back from the snapshots', async () => {
    await exec(sql(path.join(BATCH, '119.rollback.sql')));
    expect(await roleCodes()).toEqual(expect.arrayContaining(['ROLE-DOC-VERIFIER', 'ROLE-RULE-AUTHOR']));
    expect(await assignmentsOf('rol_m119_doc')).toBe(1);
  });
});
