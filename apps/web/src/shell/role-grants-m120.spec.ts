// P1-04 (owner: Dipanshu): who reaches the lender policy grid and lender matching once M-105 and M-120 have run. The hosted snapshot in
// role-grants.fixture.ts predates both (it still has ROLE-RULE-AUTHOR and ROLE-RULE-APPROVER and no ROLE-POLICY-MGR), so this spec
// layers the migrations on it in order, reading the grant pairs from the SQL files that run on the database:
//   M-099 adds, M-104 trims, M-105 merges the rule roles into ROLE-POLICY-MGR and retires the doc verifier and commission approver,
//   M-120 adds lender_policy.read / lender_policy.manage / lender_match.run (and rule.approve for the owner).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { routeAllowed } from './access';
import { QLOAX_ROLE_GRANTS } from './role-grants.fixture';

const MIGRATIONS = path.resolve(__dirname, '../../../../supabase/migrations');
const pairs = (file: string): Record<string, string[]> => {
  const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8');
  const rows = /VALUES\s*(.*?)\)\s*AS g\(role_code, permission_code\)/is.exec(sql)?.[1] ?? '';
  const out: Record<string, string[]> = {};
  for (const m of rows.matchAll(/\(\s*'(ROLE-[A-Z-]+)'\s*,\s*'([a-z_.]+)'\s*\)/g))
    (out[m[1]!] ??= []).push(m[2]!);
  return out;
};
const M099 = pairs('20261001000099_role_grants_per_roles_page.sql');
const M104 = pairs('20261001000104_role_ui_cleanup_trim.sql');
const M120 = pairs('20261001000120_lender_policy_matching.sql');

// M-105, as its header states: the codes it grants, and the roles it retires.
const M105_GRANTS: Record<string, string[]> = {
  'ROLE-POLICY-MGR': ['rule.author', 'rule.simulate', 'rule.approve', 'rule.publish', 'rule.suspend'],
  'ROLE-LOAN-OPS': [
    'document.review',
    'verification.perform',
    'verification.create',
    'verification.update',
    'verification.complete',
  ],
};
const M105_RETIRED = ['ROLE-DOC-VERIFIER', 'ROLE-RULE-AUTHOR', 'ROLE-RULE-APPROVER', 'ROLE-COMMISSION-APPROVER'];

/** Grants per role after M-120, built from the snapshot and the migrations in the order they run. */
const CURRENT: Record<string, Set<string>> = (() => {
  const roles = new Set([...Object.keys(QLOAX_ROLE_GRANTS), ...Object.keys(M105_GRANTS)]);
  const out: Record<string, Set<string>> = {};
  for (const role of roles) {
    if (M105_RETIRED.includes(role)) continue;
    const held = new Set([...(QLOAX_ROLE_GRANTS[role] ?? []), ...(M099[role] ?? [])]);
    for (const code of M104[role] ?? []) held.delete(code);
    for (const code of [...(M105_GRANTS[role] ?? []), ...(M120[role] ?? [])]) held.add(code);
    out[role] = held;
  }
  return out;
})();
const opens = (role: string, p: string) => routeAllowed(p, (c) => CURRENT[role]!.has(c), false);

describe('TEST-ACC-P1-04 lender policies and matching after M-105 and M-120', () => {
  it('TEST-ACC-P1-04-01 the migrations parse: M-120 grants reach the roles the spec names, and the retired roles are gone', () => {
    expect(Object.keys(M120).sort()).toEqual(
      ['ROLE-BRANCH-MGR', 'ROLE-LOAN-OPS', 'ROLE-ORG-OWNER', 'ROLE-POLICY-MGR', 'ROLE-RM'].sort(),
    );
    for (const retired of M105_RETIRED) expect(CURRENT[retired], retired).toBeUndefined();
    expect([...CURRENT['ROLE-POLICY-MGR']!].sort()).toEqual(
      [
        'lender_policy.manage',
        'lender_policy.read',
        'rule.approve',
        'rule.author',
        'rule.publish',
        'rule.simulate',
        'rule.suspend',
      ].sort(),
    );
  });

  it('TEST-ACC-P1-04-02 the SOD-01 checkers (Lender policy manager and DSA owner) both hold rule.approve and open the lender page', () => {
    for (const role of ['ROLE-POLICY-MGR', 'ROLE-ORG-OWNER']) {
      expect(CURRENT[role]!.has('rule.approve'), role).toBe(true);
      expect(opens(role, '/lenders'), role).toBe(true);
      expect(opens(role, '/lenders/lnd_1'), role).toBe(true);
    }
    // the policy manager's job is the policy grid: no applications, no products
    expect(opens('ROLE-POLICY-MGR', '/applications/a1')).toBe(false);
    expect(opens('ROLE-POLICY-MGR', '/products')).toBe(false);
  });

  it('TEST-ACC-P1-04-03 every role that runs lender matching (owner, loan operations, branch manager, RM) opens the application page', () => {
    for (const role of ['ROLE-ORG-OWNER', 'ROLE-LOAN-OPS', 'ROLE-BRANCH-MGR', 'ROLE-RM']) {
      expect(CURRENT[role]!.has('lender_match.run'), role).toBe(true);
      expect(opens(role, '/applications/a1'), role).toBe(true);
    }
  });
});
