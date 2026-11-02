// What the seeded roles can open once migration M-099 has added the grants the Notion Roles page names (owner: Dev 1). The grants are read
// from the migration itself, so this spec follows the file that runs on the database. The base is the hosted snapshot after the M-098
// backfill, as in the other persona specs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canPerformAction, visibleGroups } from './access';
import { QLOAX_ROLE_GRANTS } from './role-grants.fixture';

const MIGRATION = path.resolve(
  __dirname,
  '../../../../supabase/migrations/20261001000099_role_grants_per_roles_page.sql',
);
const sql = readFileSync(MIGRATION, 'utf8');
const rows = /VALUES\s*(.*?)\)\s*AS g\(role_code, permission_code\)/is.exec(sql)?.[1] ?? '';
const ADDED: Record<string, string[]> = {};
for (const m of rows.matchAll(/\(\s*'(ROLE-[A-Z-]+)'\s*,\s*'([a-z_.]+)'\s*\)/g))
  (ADDED[m[1]!] ??= []).push(m[2]!);

const after = (role: string): Set<string> =>
  new Set([...(QLOAX_ROLE_GRANTS[role] ?? []), ...(ADDED[role] ?? [])]);

const screens = (role: string): string[] => {
  const held = after(role);
  return visibleGroups(false, (c) => held.has(c), false, false, [])
    .flatMap((g) => g.items)
    .filter((i) => i.to)
    .map((i) => i.label);
};
const may = (role: string, action: string) => {
  const held = after(role);
  return canPerformAction(action, (c) => held.has(c));
};

describe('roles after migration M-099 (Notion Roles page)', () => {
  it('TEST-SUBPERM-08 the migration names the roles this spec expects, and no role loses a grant', () => {
    expect(Object.keys(ADDED).sort()).toEqual(
      [
        'ROLE-BRANCH-MGR',
        'ROLE-COMPLIANCE',
        'ROLE-FINANCE-EXEC',
        'ROLE-ORG-OWNER',
        'ROLE-RM',
        'ROLE-SALES-EXEC',
        'ROLE-TENANT-ADMIN',
      ].sort(),
    );
    for (const [role, held] of Object.entries(QLOAX_ROLE_GRANTS))
      for (const code of held) expect(after(role).has(code), `${role} lost ${code}`).toBe(true);
  });

  it('TEST-SUBPERM-08 Branch Manager now opens Performance, Targets, Leaderboard and the report catalogue', () => {
    const seen = screens('ROLE-BRANCH-MGR');
    for (const label of ['Performance Dashboard', 'Targets', 'Leaderboard', 'Reports & Catalogue'])
      expect(seen, label).toContain(label);
  });

  it('TEST-SUBPERM-08 Compliance opens the report catalogue but not team performance, the leaderboard or targets', () => {
    const seen = screens('ROLE-COMPLIANCE');
    expect(seen).toContain('Reports & Catalogue');
    for (const label of ['Performance Dashboard', 'Leaderboard', 'Targets'])
      expect(seen, label).not.toContain(label);
  });

  it('TEST-SUBPERM-08 the DSA Owner opens the staff directory without gaining user management', () => {
    expect(screens('ROLE-ORG-OWNER')).toContain('Users');
    expect(may('ROLE-ORG-OWNER', 'user.manage')).toBe(false);
    expect(may('ROLE-ORG-OWNER', 'user.invite')).toBe(false);
    expect(may('ROLE-ORG-OWNER', 'user.offboard')).toBe(false);
  });

  it('TEST-SUBPERM-08 Tenant Administrator opens Integrations and API management', () => {
    const seen = screens('ROLE-TENANT-ADMIN');
    expect(seen).toContain('Integrations');
    expect(seen).toContain('API management');
  });

  it('TEST-SUBPERM-08 RM can upload documents and share them; Sales Executive can edit logged activity', () => {
    expect(may('ROLE-RM', 'document.upload')).toBe(true);
    expect(may('ROLE-RM', 'share.create')).toBe(true);
    expect(may('ROLE-SALES-EXEC', 'activity.update')).toBe(true);
  });

  it('TEST-SUBPERM-08 Finance Executive can raise payout requests and verify disbursements, and still cannot approve payouts', () => {
    expect(may('ROLE-FINANCE-EXEC', 'payout.request')).toBe(true);
    expect(may('ROLE-FINANCE-EXEC', 'disbursement.verify')).toBe(true);
    expect(may('ROLE-FINANCE-EXEC', 'payout.approve')).toBe(false);
  });

  it('TEST-SUBPERM-08 the migration does not give a role both sides of a maker-checker pair it did not already hold', () => {
    const PAIRS = [['payout.request', 'payout.approve']] as const;
    for (const role of Object.keys(ADDED)) {
      const before = new Set(QLOAX_ROLE_GRANTS[role] ?? []);
      const held = after(role);
      for (const [maker, checker] of PAIRS) {
        const had = before.has(maker) && before.has(checker);
        const has = held.has(maker) && held.has(checker);
        expect(has && !had, `${role} would gain ${maker} and ${checker}`).toBe(false);
      }
    }
  });
});
