import { PERMISSION_CODES } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import { groupPermissionsForEditor } from './permission-grouping';
import type { Permission } from './types';

const perm = (code: string): Permission => ({
  code,
  description: `${code} description`,
  introducedIn: 'test',
});
const everything = PERMISSION_CODES.map(perm);

describe('role editor grouping', () => {
  it('TEST-ROLEEDIT-01 places every permission in exactly one group, and nothing under Other while the catalogue is grouped', () => {
    const groups = groupPermissionsForEditor(everything);
    const all = groups.flatMap((g) => g.permissions.map((p) => p.code));
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual([...PERMISSION_CODES].sort());
    expect(groups.find((g) => g.key === 'other')).toBeUndefined();
  });

  it('TEST-ROLEEDIT-01 a sub-permission sits under its feature, next to the permissions it was split from', () => {
    const groups = groupPermissionsForEditor(everything);
    const payouts = groups.find((g) => g.key === 'finance/payouts');
    expect(payouts?.moduleLabel).toBe('Finance');
    expect(payouts?.permissions.map((p) => p.code)).toEqual(
      expect.arrayContaining([
        'payout.view',
        'payout.request',
        'payout.approve',
        'payout.record_payment',
        'payout.disburse',
      ]),
    );
    const lenderCases = groups.find((g) => g.key === 'lending/lender-cases');
    expect(lenderCases?.permissions.map((p) => p.code)).toEqual([
      'lender_case.read',
      'lender_case.submit',
      'lender_case.update_status',
    ]);
  });

  it('TEST-ROLEEDIT-01 a permission the contracts do not group is shown under Other instead of vanishing', () => {
    const groups = groupPermissionsForEditor([perm('lead.read'), perm('brand_new.thing')]);
    expect(groups.find((g) => g.key === 'other')?.permissions.map((p) => p.code)).toEqual([
      'brand_new.thing',
    ]);
    expect(groups.some((g) => g.permissions.some((p) => p.code === 'lead.read'))).toBe(true);
  });

  it('TEST-ROLEEDIT-01 only the permissions this tenant has are listed, and an empty feature is dropped', () => {
    const groups = groupPermissionsForEditor([perm('lead.read'), perm('lead.create')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.permissions.map((p) => p.code)).toEqual(['lead.read', 'lead.create']);
  });
});
