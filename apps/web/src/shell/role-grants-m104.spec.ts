// What each seeded role can open once migration M-104 (task P0-07, role-based UI cleanup) has removed the grants behind screens the
// role's job does not use (owner: Dev 1, platform lane). The grants are read from migrations M-099 and M-104 themselves, so this spec
// follows the files that run on the database. The base is the hosted snapshot after the M-098 backfill, as in the other persona specs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { visibleGroups } from './access';
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
const ADDED = pairs('20261001000099_role_grants_per_roles_page.sql');
const TRIMMED = pairs('20261001000104_role_ui_cleanup_trim.sql');

const grants = (role: string, trimmed: boolean): Set<string> => {
  const held = new Set([...(QLOAX_ROLE_GRANTS[role] ?? []), ...(ADDED[role] ?? [])]);
  if (trimmed) for (const code of TRIMMED[role] ?? []) held.delete(code);
  return held;
};
const screens = (held: Set<string>): string[] => {
  const can = (c: string) => held.has(c);
  const isAdmin = ['config.manage', 'user.manage', 'org.manage', 'role.manage'].some(can);
  return visibleGroups(isAdmin, can, false, false, [])
    .flatMap((g) => g.items)
    .filter((i) => i.to)
    .map((i) => i.label);
};
const hidden = (role: string) => {
  const after = screens(grants(role, true));
  return screens(grants(role, false)).filter((s) => !after.includes(s));
};

describe('TEST-ACC-P0-07 migration 104 removes the screens each role does not use', () => {
  it('TEST-ACC-P0-07-01 Branch manager loses back-office and setup screens and keeps commission, payouts and verification', () => {
    expect(hidden('ROLE-BRANCH-MGR').sort()).toEqual(
      [
        'Access control',
        'Automation rules',
        'Integrations',
        'Invoices',
        'Reconciliation',
        'Verification workbench',
      ].sort(),
    );
    expect(screens(grants('ROLE-BRANCH-MGR', true))).toEqual(
      expect.arrayContaining(['Commission', 'Payouts', 'Verification', 'Users', 'Leads', 'Applications']),
    );
  });

  it('TEST-ACC-P0-07-02 Tenant administrator loses the business screens and keeps administration', () => {
    expect(hidden('ROLE-TENANT-ADMIN').sort()).toEqual(
      [
        'Applications',
        'Customers',
        'Leads',
        'Lender cases',
        'Sanction and disbursement',
        'Verification',
        'Verification workbench',
      ].sort(),
    );
    const after = screens(grants('ROLE-TENANT-ADMIN', true));
    expect(after).toEqual(
      expect.arrayContaining([
        'Users',
        'Access control',
        'Configuration',
        'Integrations',
        'Audit',
      ]),
    );
    expect([...grants('ROLE-TENANT-ADMIN', true)].filter((c) => c.startsWith('platform.'))).toEqual([]);
  });

  it('TEST-ACC-P0-07-03 Loan operations loses automation and connectors and keeps its case work', () => {
    expect(hidden('ROLE-LOAN-OPS').sort()).toEqual(['Automation rules', 'Connectors']);
    expect(screens(grants('ROLE-LOAN-OPS', true))).toEqual(
      expect.arrayContaining(['Applications', 'Lender cases', 'Verification', 'Verification workbench']),
    );
  });

  it('TEST-ACC-P0-07-04 RM, Team manager and Telecaller no longer see Privacy and consent; the Telecaller loses Customers', () => {
    expect(hidden('ROLE-RM')).toEqual(['Privacy and consent']);
    expect(hidden('ROLE-TEAM-MGR')).toEqual(['Privacy and consent']);
    expect(hidden('ROLE-SALES-EXEC').sort()).toEqual(['Customers', 'Privacy and consent']);
    // Consent is still recorded on the lead and the customer.
    for (const role of ['ROLE-RM', 'ROLE-TEAM-MGR', 'ROLE-SALES-EXEC'])
      expect(grants(role, true).has('consent.record')).toBe(true);
  });

  it('TEST-ACC-P0-07-05 the RM keeps verification.read for the application page but no longer sees the verification list', () => {
    expect(grants('ROLE-RM', true).has('verification.read')).toBe(true);
    expect(screens(grants('ROLE-RM', true))).not.toContain('Verification');
    expect(screens(grants('ROLE-COMPLIANCE', true))).toContain('Verification');
  });

  it('TEST-ACC-P0-07-06 Compliance, Finance executive and Commission approver no longer see Workforce', () => {
    for (const role of ['ROLE-COMPLIANCE', 'ROLE-FINANCE-EXEC', 'ROLE-COMMISSION-APPROVER'])
      expect(hidden(role)).toEqual(['Workforce']);
  });

  it('TEST-ACC-P0-07-07 the DSA owner and the roles P0-01 will merge are unchanged', () => {
    for (const role of ['ROLE-ORG-OWNER', 'ROLE-DOC-VERIFIER', 'ROLE-RULE-AUTHOR', 'ROLE-RULE-APPROVER'])
      expect(hidden(role)).toEqual([]);
  });

  it('TEST-ACC-P0-07-08 no role gains a screen from the trim', () => {
    for (const role of Object.keys(QLOAX_ROLE_GRANTS)) {
      const before = screens(grants(role, false));
      expect(screens(grants(role, true)).filter((s) => !before.includes(s))).toEqual([]);
    }
  });
});
