import { describe, expect, it } from 'vitest';
import { hasPermission, type Me } from './useMe';

describe('useMe & hasPermission (DEF-004 Regression Test)', () => {
  it('returns false when me is undefined without throwing', () => {
    expect(hasPermission(undefined, 'lead.create')).toBe(false);
  });

  it('returns false when grants is undefined without throwing TypeError', () => {
    const meWithoutGrants = {
      id: 'usr_1',
      tenantId: 'ten_1',
      email: 'a@b.com',
      displayName: 'User',
      primaryBranchId: null,
      queueIds: [],
      grants: undefined as unknown as any[],
      mfaVerifiedAt: null,
    } as unknown as Me;
    expect(hasPermission(meWithoutGrants, 'lead.create')).toBe(false);
  });

  it('returns false when grants is empty array', () => {
    const meWithEmptyGrants: Me = {
      id: 'usr_1',
      tenantId: 'ten_1',
      email: 'a@b.com',
      displayName: 'User',
      primaryBranchId: null,
      queueIds: [],
      grants: [],
      mfaVerifiedAt: null,
    };
    expect(hasPermission(meWithEmptyGrants, 'lead.create')).toBe(false);
  });

  it('returns true when grant code is present', () => {
    const meWithGrant: Me = {
      id: 'usr_1',
      tenantId: 'ten_1',
      email: 'a@b.com',
      displayName: 'User',
      primaryBranchId: null,
      queueIds: [],
      grants: [{ code: 'lead.create', scope: 'TENANT', branchIds: [] }],
      mfaVerifiedAt: null,
    };
    expect(hasPermission(meWithGrant, 'lead.create')).toBe(true);
    expect(hasPermission(meWithGrant, 'config.manage')).toBe(false);
  });
});
