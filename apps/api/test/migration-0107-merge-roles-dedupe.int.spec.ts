// TEST-ACL-M107: rehearsal for migration 0107, the correction to M-105. A user who held BOTH Rule author and Rule approver gets two open
// ROLE-POLICY-MGR assignments from M-105; M-107 ends the extra one. Database built from the migrations before 0105, then 0105 and 0107 are applied.
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IsolationEnv } from '../../../tests/isolation/harness';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const BATCH = path.join(ROOT, 'tools/sql/batch');
const M105 = readdirSync(MIGRATIONS).find((f) => f.startsWith('20261001000105_'))!;
const M107 = readdirSync(MIGRATIONS).find((f) => f.startsWith('20261001000107_'))!;
const sql = (name: string) => readFileSync(name, 'utf8');

type Row = { check: string; result: string; detail: string };
let env: IsolationEnv;
let tmp = '';
let A = '';
let both = '';

const exec = async (text: string) => {
  const result = await env.admin.query(text);
  return (Array.isArray(result) ? result[result.length - 1] : result) as { rows: Record<string, unknown>[] };
};
const verify = async () => (await exec(sql(path.join(BATCH, '107.verify.sql')))).rows as Row[];
const failures = (rows: Row[]) => rows.filter((r) => r.result === 'FAIL');
const openPolicy = async () =>
  (
    await exec(`select count(*)::int as n from app.user_role_assignment a join app.role r on r.tenant_id = a.tenant_id and r.id = a.role_id
                 where a.user_id = '${both}' and r.code = 'ROLE-POLICY-MGR' and not isempty(a.effective_range) and upper_inf(a.effective_range)`)
  ).rows[0]!.n as number;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'dsa-pre0107-'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql') && x < '20261001000105')) {
    copyFileSync(path.join(MIGRATIONS, f), path.join(tmp, f));
  }
  process.env.DSA_MIGRATIONS_DIR = tmp;
  const { startIsolationEnv } = await import('../../../tests/isolation/harness');
  env = await startIsolationEnv();
  A = env.A.tenantId;
  both = env.A.userIds[0]!;

  await exec(`
    INSERT INTO app.role (id, tenant_id, code, name, is_template, created_by) VALUES
      ('rol_rule_auth_${A}', '${A}', 'ROLE-RULE-AUTHOR', 'Rule author', false, 'iso'),
      ('rol_rule_app_${A}', '${A}', 'ROLE-RULE-APPROVER', 'Rule approver', false, 'iso')
    ON CONFLICT DO NOTHING;
    INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by, effective_range) VALUES
      ('ura_m107_test_auth', '${A}', '${both}', 'rol_rule_auth_${A}', 'TENANT', '{}', 'iso', tstzrange(now() - interval '10 days', NULL, '[)')),
      ('ura_m107_test_app', '${A}', '${both}', 'rol_rule_app_${A}', 'TENANT', '{}', 'iso', tstzrange(now() - interval '10 days', NULL, '[)'))
    ON CONFLICT (id) DO NOTHING;
  `);
  // The state hosted was in: M-105 applied, the user holds ROLE-POLICY-MGR twice.
  await exec(sql(path.join(MIGRATIONS, M105)));
});

afterAll(async () => {
  await env?.stop();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('TEST-ACL-M107 migration 0107 ends the duplicate Lender policy manager assignment from M-105', () => {
  it('TEST-ACL-M107-01 after M-105 the user holding both rule roles has two open ROLE-POLICY-MGR assignments, and the verify script fails', async () => {
    expect(await openPolicy()).toBe(2);
    expect(failures(await verify()).map((r) => r.check)).toEqual([
      'no user holds the same role through two open assignments',
    ]);
  });

  it('TEST-ACL-M107-02 applies, the user keeps exactly one open ROLE-POLICY-MGR assignment, and the verify passes', async () => {
    await exec(sql(path.join(MIGRATIONS, M107)));
    expect(await openPolicy()).toBe(1);
    expect(failures(await verify())).toEqual([]);
  });

  it('TEST-ACL-M107-03 the ended duplicate stays as history (never deleted)', async () => {
    const { rows } = await exec(
      `select count(*)::int as n from app.user_role_assignment where user_id = '${both}' and created_by = 'SYSTEM:migration-0105'`,
    );
    expect(rows[0]!.n).toBe(2);
  });

  it('TEST-ACL-M107-04 applying again changes nothing (idempotent)', async () => {
    const before = await exec(
      `select count(*)::int as n from app.user_role_assignment where upper_inf(effective_range) and not isempty(effective_range)`,
    );
    await exec(sql(path.join(MIGRATIONS, M107)));
    const after = await exec(
      `select count(*)::int as n from app.user_role_assignment where upper_inf(effective_range) and not isempty(effective_range)`,
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });
});
