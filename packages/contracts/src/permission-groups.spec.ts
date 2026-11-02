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

describe('sub-permission catalogue', () => {
  it('TEST-PERM-06 the catalogue has the 119 original codes plus the 32 sub-permissions, with no duplicates', () => {
    expect(SUB_PERMISSION_CODES).toHaveLength(32);
    expect(PERMISSION_CODES).toHaveLength(151);
    expect(new Set<string>(PERMISSION_CODES).size).toBe(151);
    expect(new Set<string>(SUB_PERMISSION_CODES).size).toBe(32);
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
    expect(withLegacy('ledger.journal_post')).toEqual(['ledger.journal_post']);
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
