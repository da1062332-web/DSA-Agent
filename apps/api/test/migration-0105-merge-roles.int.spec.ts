// TEST-ACL-M105: rehearsal for migration 0105 (Role merge: Document verifier -> Loan ops, Rule author/approver -> Lender policy manager,
// Commission approver -> Org owner / Finance exec, Sales exec -> Telecaller).
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IsolationEnv } from '../../../tests/isolation/harness';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const BATCH = path.join(ROOT, 'tools/sql/batch');
const M105 = readdirSync(MIGRATIONS).find((f) => f.startsWith('20261001000105_'))!;
const sql = (name: string) => readFileSync(name, 'utf8');

type Row = { check: string; result: string; detail: string };
let env: IsolationEnv;
let tmp = '';
let A = '';
let B = '';
let docHolder = '';
let ruleAuthorHolder = '';
let ruleApproverHolder = '';
let commHolder = '';

const exec = async (text: string) => {
  const result = await env.admin.query(text);
  return (Array.isArray(result) ? result[result.length - 1] : result) as { rows: Record<string, unknown>[] };
};
const verify = async () => (await exec(sql(path.join(BATCH, '105.verify.sql')))).rows as Row[];
const failures = (rows: Row[]) => rows.filter((r) => r.result === 'FAIL');
const openRoles = async (userId: string) =>
  (
    await exec(`select r.code, a.scope_type from app.user_role_assignment a join app.role r on r.tenant_id = a.tenant_id and r.id = a.role_id
                 where a.user_id = '${userId}' and not isempty(a.effective_range) and upper_inf(a.effective_range) order by r.code`)
  ).rows;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'dsa-pre0105-'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql') && x < '20261001000105')) {
    copyFileSync(path.join(MIGRATIONS, f), path.join(tmp, f));
  }
  process.env.DSA_MIGRATIONS_DIR = tmp;
  const { startIsolationEnv } = await import('../../../tests/isolation/harness');
  env = await startIsolationEnv();
  A = env.A.tenantId;
  B = env.B.tenantId;
  [docHolder, ruleAuthorHolder] = env.A.userIds;
  // Create two extra users in tenant A for rule approver and comm approver
  const u3 = 'usr_test_iso_approver';
  const u4 = 'usr_test_iso_comm';
  ruleApproverHolder = u3;
  commHolder = u4;

  await exec(`
    INSERT INTO app.app_user (id, tenant_id, email, phone, display_name, status, user_type, created_by) VALUES
      ('${u3}', '${A}', 'rule.approver@iso.local', '+919876543221', 'Rule Approver User', 'ACTIVE', 'STAFF', 'iso'),
      ('${u4}', '${A}', 'comm.approver@iso.local', '+919876543222', 'Commission Approver User', 'ACTIVE', 'STAFF', 'iso')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO app.role (id, tenant_id, code, name, is_template, created_by) VALUES
      ('rol_doc_ver_${A}', '${A}', 'ROLE-DOC-VERIFIER', 'Document verifier', false, 'iso'),
      ('rol_rule_auth_${A}', '${A}', 'ROLE-RULE-AUTHOR', 'Rule author', false, 'iso'),
      ('rol_rule_app_${A}', '${A}', 'ROLE-RULE-APPROVER', 'Rule approver', false, 'iso'),
      ('rol_comm_app_${A}', '${A}', 'ROLE-COMMISSION-APPROVER', 'Commission and Payout Approver', false, 'iso'),
      ('rol_loan_ops_${A}', '${A}', 'ROLE-LOAN-OPS', 'Loan operations', false, 'iso'),
      ('rol_finance_exec_${A}', '${A}', 'ROLE-FINANCE-EXEC', 'Finance Executive', false, 'iso'),
      ('rol_sales_exec_${A}', '${A}', 'ROLE-SALES-EXEC', 'Sales executive', false, 'iso'),
      ('rol_loan_ops_${B}', '${B}', 'ROLE-LOAN-OPS', 'Loan operations', false, 'iso')
    ON CONFLICT DO NOTHING;

    INSERT INTO app.role_permission (tenant_id, role_id, permission_code) VALUES
      ('${A}', 'rol_doc_ver_${A}', 'document.review'),
      ('${A}', 'rol_doc_ver_${A}', 'verification.read'),
      ('${A}', 'rol_rule_auth_${A}', 'rule.author'),
      ('${A}', 'rol_rule_auth_${A}', 'rule.simulate'),
      ('${A}', 'rol_rule_app_${A}', 'rule.approve'),
      ('${A}', 'rol_comm_app_${A}', 'payout.approve'),
      ('${A}', 'rol_comm_app_${A}', 'commission.plan.approve')
    ON CONFLICT DO NOTHING;

    INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by, effective_range) VALUES
      ('ura_m105_test_doc', '${A}', '${docHolder}', 'rol_doc_ver_${A}', 'BRANCH', ARRAY['${env.A.branchId}'], 'iso',
        tstzrange(now() - interval '10 days', NULL, '[)')),
      ('ura_m105_test_auth', '${A}', '${ruleAuthorHolder}', 'rol_rule_auth_${A}', 'TENANT', '{}', 'iso',
        tstzrange(now() - interval '10 days', NULL, '[)')),
      ('ura_m105_test_app', '${A}', '${ruleApproverHolder}', 'rol_rule_app_${A}', 'TENANT', '{}', 'iso',
        tstzrange(now() - interval '10 days', NULL, '[)')),
      ('ura_m105_test_comm', '${A}', '${commHolder}', 'rol_comm_app_${A}', 'BRANCH', ARRAY['${env.A.branchId}'], 'iso',
        tstzrange(now() - interval '10 days', NULL, '[)'))
    ON CONFLICT (id) DO NOTHING;
  `);
});

afterAll(async () => {
  await env?.stop();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('TEST-ACL-M105 migration 0105 merges roles and retires redundant roles', () => {
  it('TEST-ACL-M105-01 the verify script fails before the apply', async () => {
    const failed = failures(await verify()).map((r) => r.check);
    expect(failed).toContain('no retired role holds a permission');
    expect(failed).toContain('no open assignment for retired roles');
    expect(failed).toContain('ROLE-POLICY-MGR exists in every customer tenant');
  });

  it('TEST-ACL-M105-02 applies, and its verify passes', async () => {
    await exec(sql(path.join(MIGRATIONS, M105)));
    expect(failures(await verify())).toEqual([]);
  });

  it('TEST-ACL-M105-03 open Document verifier holder now holds ROLE-LOAN-OPS with the same branch scope', async () => {
    expect(await openRoles(docHolder)).toEqual([{ code: 'ROLE-LOAN-OPS', scope_type: 'BRANCH' }]);
  });

  it('TEST-ACL-M105-04 open Rule author and Rule approver holders now hold ROLE-POLICY-MGR', async () => {
    expect(await openRoles(ruleAuthorHolder)).toEqual([{ code: 'ROLE-POLICY-MGR', scope_type: 'TENANT' }]);
    expect(await openRoles(ruleApproverHolder)).toEqual([{ code: 'ROLE-POLICY-MGR', scope_type: 'TENANT' }]);
  });

  it('TEST-ACL-M105-05 open Commission approver holder now holds ROLE-FINANCE-EXEC', async () => {
    expect(await openRoles(commHolder)).toEqual([{ code: 'ROLE-FINANCE-EXEC', scope_type: 'BRANCH' }]);
  });

  it('TEST-ACL-M105-06 ROLE-SALES-EXEC is renamed Telecaller', async () => {
    const { rows } = await exec(`select name from app.role where code = 'ROLE-SALES-EXEC' and tenant_id = '${A}'`);
    expect(rows[0]?.name).toBe('Telecaller');
  });

  it('TEST-ACL-M105-07 applying again changes nothing (idempotent)', async () => {
    const before = await exec(`select count(*)::int as n from app.user_role_assignment`);
    await exec(sql(path.join(MIGRATIONS, M105)));
    const after = await exec(`select count(*)::int as n from app.user_role_assignment`);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    expect(failures(await verify())).toEqual([]);
  });
});
