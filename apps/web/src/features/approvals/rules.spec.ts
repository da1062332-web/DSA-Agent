import { describe, expect, it } from 'vitest';
import { grantAction } from './rules';

describe('approvals rules (MODULE 40, SUB-ADM.06)', () => {
  it('TEST-APR-003 a pending support request is decided, an approved one can be revoked, everything else is final', () => {
    expect(grantAction({ status: 'PENDING' })).toBe('DECIDE');
    expect(grantAction({ status: 'APPROVED' })).toBe('REVOKE');
    for (const status of ['DENIED', 'EXPIRED', 'REVOKED'] as const)
      expect(grantAction({ status })).toBe('NONE');
  });
});
