import { describe, expect, it } from 'vitest';
import {
  canDecideCorrection,
  grantAction,
  isValidCorrection,
  isValidJustification,
  NO_DIFF_NOTE,
} from './rules';

describe('approvals rules (MODULE 40, SUB-ADM.06 and .07)', () => {
  it('TEST-APR-001 a correction needs a script reference, target, description and justification of the minimum length', () => {
    const ok = {
      scriptRef: 'SCR-1',
      targetEntity: 'LEAD',
      changeDescription: 'Fix pincode',
      justification: 'Wrong pincode at import',
    };
    expect(isValidCorrection(ok)).toBe(true);
    expect(isValidCorrection({ ...ok, justification: 'too short' })).toBe(false);
    expect(isValidCorrection({ ...ok, scriptRef: 'S' })).toBe(false);
    expect(isValidCorrection({ ...ok, targetEntity: '' })).toBe(false);
    expect(isValidCorrection({ ...ok, changeDescription: 'fix' })).toBe(false);
    expect(isValidJustification('   ten chars!  ')).toBe(true);
  });

  it('TEST-APR-002 SOD-08: the requester cannot approve; only a pending correction can be decided; the permission is required', () => {
    const c = { status: 'PENDING' as const, requestedBy: 'usr_a' };
    expect(canDecideCorrection(c, 'usr_b', true)).toBe(true);
    expect(canDecideCorrection(c, 'usr_a', true)).toBe(false);
    expect(canDecideCorrection(c, 'usr_b', false)).toBe(false);
    expect(canDecideCorrection(c, undefined, true)).toBe(false);
    expect(canDecideCorrection({ ...c, status: 'APPROVED' }, 'usr_b', true)).toBe(false);
  });

  it('TEST-APR-003 a pending support request is decided, an approved one can be revoked, everything else is final', () => {
    expect(grantAction({ status: 'PENDING' })).toBe('DECIDE');
    expect(grantAction({ status: 'APPROVED' })).toBe('REVOKE');
    for (const status of ['DENIED', 'EXPIRED', 'REVOKED'] as const)
      expect(grantAction({ status })).toBe('NONE');
  });

  it('TEST-APR-004 the screen never claims a dry-run diff exists when none was attached', () => {
    expect(NO_DIFF_NOTE).toMatch(/No dry-run diff has been attached/);
  });
});
