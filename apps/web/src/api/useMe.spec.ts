import { describe, expect, it } from 'vitest';
import { hasPermission, mfaRequired, type Me } from './useMe';

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

describe('mfaRequired enforcement check', () => {
  it('returns false when me is undefined or has empty grants', () => {
    expect(mfaRequired(undefined)).toBe(false);
    expect(
      mfaRequired({
        id: 'usr_1',
        tenantId: 'ten_1',
        email: 'a@b.com',
        displayName: 'User',
        primaryBranchId: null,
        queueIds: [],
        grants: [],
        mfaVerifiedAt: null,
      }),
    ).toBe(false);
  });

  it('returns false for standard non-MFA permissions', () => {
    const standardUser: Me = {
      id: 'usr_1',
      tenantId: 'ten_1',
      email: 'a@b.com',
      displayName: 'User',
      primaryBranchId: null,
      queueIds: [],
      grants: [{ code: 'lead.create', scope: 'TENANT', branchIds: [] }],
      mfaVerifiedAt: null,
    };
    expect(mfaRequired(standardUser)).toBe(false);
  });

  it('returns true for every mandatory MFA permission', () => {
    const mandatoryCodes = [
      'config.manage',
      'user.manage',
      'audit.read',
      'document.review',
      'lender_case.submit',
      'lender_case.update_status',
      'application.review',
      'rule.author',
      'rule.approve',
      'rule.publish',
      'rule.suspend',
      'payout.approve',
      'payout.record_payment',
    ];

    for (const code of mandatoryCodes) {
      const user: Me = {
        id: 'usr_1',
        tenantId: 'ten_1',
        email: 'a@b.com',
        displayName: 'User',
        primaryBranchId: null,
        queueIds: [],
        grants: [{ code, scope: 'TENANT', branchIds: [] }],
        mfaVerifiedAt: null,
      };
      expect(mfaRequired(user), `Expected mfaRequired to be true for ${code}`).toBe(true);
    }
  });

  it('returns true when user holds privileged administrative/sensitive permissions', () => {
    const adminUser: Me = {
      id: 'usr_2',
      tenantId: 'ten_1',
      email: 'admin@dsa.com',
      displayName: 'Admin',
      primaryBranchId: null,
      queueIds: [],
      grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
      mfaVerifiedAt: null,
    };
    expect(mfaRequired(adminUser)).toBe(true);

    const reviewerUser: Me = {
      id: 'usr_3',
      tenantId: 'ten_1',
      email: 'reviewer@dsa.com',
      displayName: 'Reviewer',
      primaryBranchId: null,
      queueIds: [],
      grants: [{ code: 'application.review', scope: 'TENANT', branchIds: [] }],
      mfaVerifiedAt: null,
    };
    expect(mfaRequired(reviewerUser)).toBe(true);
  });
});
