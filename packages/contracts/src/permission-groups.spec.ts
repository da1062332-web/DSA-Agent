import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BROAD_PARENTS,
  LEGACY_PARENTS,
  PERMISSION_CODES,
  PERMISSION_GROUPS,
  SUB_PERMISSION_CODES,
  TRANSITION_PARENTS,
  permissionGroupOf,
  ungroupedPermissionCodes,
  withLegacy,
  withSubPermissionBackfill,
} from './index';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations');

/**
 * The permission codes the migrations define, read from every `INSERT INTO permission` statement. The catalogue in the code must
 * match these, so adding a code means adding a migration, and the count is never pinned by hand.
 */
function migrationPermissionCodes(): Map<string, string> {
  const defined = new Map<string, string>();
  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of sql.matchAll(/INSERT INTO (?:app\.)?permission \(code[^)]*\)\s*VALUES?([\s\S]*?);/gi)) {
      for (const row of statement[1]!.matchAll(/\(\s*'([a-z_]+(?:\.[a-z_]+)+)'/g)) {
        if (!defined.has(row[1]!)) defined.set(row[1]!, file);
      }
    }
  }
  return defined;
}

/**
 * Codes a merged migration defines that the catalogue has since retired. A merged migration is never edited, so its
 * INSERT stays on record; P0-06 removed the ledger module and migration 0147 drops the rows once the owner agrees.
 */
const RETIRED_PERMISSION_CODES = ['ledger.view', 'ledger.journal_post'];

describe('sub-permission catalogue', () => {
  it('TEST-PERM-06 the catalogue matches the codes the migrations define, with no duplicates and no hand-pinned count', () => {
    const defined = migrationPermissionCodes();
    for (const code of RETIRED_PERMISSION_CODES) defined.delete(code);
    expect(new Set<string>(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
    expect(new Set<string>(SUB_PERMISSION_CODES).size).toBe(SUB_PERMISSION_CODES.length);
    expect(new Set<string>(PERMISSION_CODES)).toEqual(new Set<string>(defined.keys()));
    expect(SUB_PERMISSION_CODES.filter((code) => !defined.has(code))).toEqual([]);
    expect(SUB_PERMISSION_CODES.every((code) => (PERMISSION_CODES as readonly string[]).includes(code))).toBe(true);
  });

  it('TEST-PERM-06 every catalogue code is in exactly one feature of PERMISSION_GROUPS', () => {
    const seen = new Map<string, number>();
    for (const m of PERMISSION_GROUPS)
      for (const f of m.features) for (const c of f.codes) seen.set(c, (seen.get(c) ?? 0) + 1);
    expect(ungroupedPermissionCodes()).toEqual([]);
    expect([...seen].filter(([, n]) => n > 1).map(([c]) => c)).toEqual([]);
    expect([...seen.keys()].filter((c) => !(PERMISSION_CODES as readonly string[]).includes(c))).toEqual([]);
  });

  it('TEST-PERM-06 each sub-permission has a legacy parent entry, and the parents are real, older, non-sub codes', () => {
    expect(Object.keys(LEGACY_PARENTS).sort()).toEqual([...SUB_PERMISSION_CODES].sort());
    const sub = new Set<string>(SUB_PERMISSION_CODES);
    for (const [code, parents] of Object.entries(LEGACY_PARENTS)) {
      for (const p of parents) {
        expect(PERMISSION_CODES as readonly string[], `${code} parent ${p}`).toContain(p);
        expect(sub.has(p), `${code} must not have a sub-permission parent (${p})`).toBe(false);
        expect(p).not.toBe(code);
      }
    }
  });

  it('TEST-PERM-06 withLegacy returns the code first, then its parents; a code with no parents returns just itself', () => {
    expect(withLegacy('commission.view')).toEqual([
      'commission.view',
      'finance.view',
      'commission.plan.edit',
      'commission.plan.approve',
    ]);
    expect(withLegacy('lead.read')).toEqual(['lead.read']);
  });

  it('TEST-PERM-08 a broad read parent is never a runtime alias, so a role that must keep it does not keep the screen', () => {
    // application.read opens Applications for many roles; it must not also open Lender cases, Eligibility or the Activity feed.
    expect(withLegacy('lender_case.read')).toEqual([
      'lender_case.read',
      'lender_case.submit',
      'lender_case.update_status',
    ]);
    expect(withLegacy('eligibility.read')).toEqual(['eligibility.read']);
    expect(withLegacy('activity.read')).toEqual(['activity.read', 'activity.create']);
    expect(withLegacy('performance.read')).toEqual(['performance.read']);
    expect(withLegacy('privacy.read')).toEqual(['privacy.read', 'privacy.manage']);
    expect(withLegacy('audit.seal')).toEqual(['audit.seal']);
    for (const parents of Object.values(TRANSITION_PARENTS))
      for (const p of parents) expect(BROAD_PARENTS.has(p), p).toBe(false);
    // The backfill still reads every parent, broad or not, so the migration keeps access exactly as it was.
    expect(LEGACY_PARENTS['lender_case.read']).toContain('application.read');
  });

  it('TEST-PERM-08 withSubPermissionBackfill gives a role every sub-permission whose parent it holds, and the open-to-staff reads', () => {
    const rm = withSubPermissionBackfill(['application.read', 'customer.read', 'lead.read', 'task.read']);
    expect(rm).toEqual(
      expect.arrayContaining([
        'lender_case.read',
        'eligibility.read',
        'activity.read',
        'privacy.read',
        'lender.read',
        'product.read',
        'attendance.read',
      ]),
    );
    // No parent held, no sub-permission: a rule author gets only the open-to-staff reads.
    const author = withSubPermissionBackfill(['rule.author', 'rule.simulate']);
    expect(author.filter((c) => (SUB_PERMISSION_CODES as readonly string[]).includes(c))).toEqual([
      'attendance.read',
    ]);
    // Idempotent, and it never drops what the role already had.
    expect(withSubPermissionBackfill(rm).sort()).toEqual(rm.slice().sort());
    expect(rm).toEqual(expect.arrayContaining(['application.read', 'task.read']));
  });

  it('TEST-PERM-06 permissionGroupOf names the feature a sub-permission sits under', () => {
    expect(permissionGroupOf('lender_case.read')?.feature.id).toBe('lender-cases');
    expect(permissionGroupOf('payout.disburse')?.module.id).toBe('finance');
    expect(permissionGroupOf('not.a_code')).toBeUndefined();
  });
});
