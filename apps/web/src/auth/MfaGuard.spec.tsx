import { describe, expect, it } from 'vitest';
import { isTotpCode } from './totp';
import type { Aal } from './AuthProvider';
import { mfaRequired, type Me } from '../api/useMe';

describe('MFA Enforcement Guard & TOTP Validation', () => {
  it('validates 6-digit numeric TOTP codes accurately', () => {
    expect(isTotpCode('123456')).toBe(true);
    expect(isTotpCode('000000')).toBe(true);
    expect(isTotpCode('999999')).toBe(true);
    expect(isTotpCode('12345')).toBe(false);
    expect(isTotpCode('1234567')).toBe(false);
    expect(isTotpCode('12a456')).toBe(false);
    expect(isTotpCode('')).toBe(false);
    expect(isTotpCode('      ')).toBe(false);
  });

  it('determines when challenge is needed (aal.next is aal2 and aal.current is not aal2)', () => {
    const aalWithFactorUnchallenged: Aal = { current: 'aal1', next: 'aal2' };
    const needsChallenge =
      aalWithFactorUnchallenged.next === 'aal2' && aalWithFactorUnchallenged.current !== 'aal2';
    expect(needsChallenge).toBe(true);

    const aalPassed: Aal = { current: 'aal2', next: 'aal2' };
    const needsChallengeWhenPassed = aalPassed.next === 'aal2' && aalPassed.current !== 'aal2';
    expect(needsChallengeWhenPassed).toBe(false);
  });

  it('determines when enrolment is needed (aal.next is not aal2 and role requires MFA)', () => {
    const aalWithoutFactor: Aal = { current: 'aal1', next: 'aal1' };
    const adminUser: Me = {
      id: 'usr_admin',
      tenantId: 'ten_1',
      email: 'admin@dsa.com',
      displayName: 'Admin',
      primaryBranchId: null,
      queueIds: [],
      grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
      mfaVerifiedAt: null,
    };

    const needsEnrolment = aalWithoutFactor.next !== 'aal2' && mfaRequired(adminUser);
    expect(needsEnrolment).toBe(true);

    const regularAgent: Me = {
      id: 'usr_agent',
      tenantId: 'ten_1',
      email: 'agent@dsa.com',
      displayName: 'Agent',
      primaryBranchId: null,
      queueIds: [],
      grants: [{ code: 'lead.read', scope: 'TENANT', branchIds: [] }],
      mfaVerifiedAt: null,
    };
    const regularNeedsEnrolment = aalWithoutFactor.next !== 'aal2' && mfaRequired(regularAgent);
    expect(regularNeedsEnrolment).toBe(false);
  });
});
