// Grievance screen rules (owner: Dev 3; DSA Notion MODULE 13). Each rule mirrors the API; the API stays the authority.
import { describe, expect, it } from 'vitest';
import {
  canReopen,
  canResolve,
  canStartWork,
  isEditable,
  isValidDescription,
  isValidReason,
  isValidReference,
  isValidResolution,
} from './rules';

describe('grievances: status rules (TEST-GRV-WEB-001)', () => {
  it('a resolved complaint is read-only and can only be reopened', () => {
    expect(isEditable('RESOLVED')).toBe(false);
    expect(canResolve('RESOLVED')).toBe(false);
    expect(canReopen('RESOLVED')).toBe(true);
  });

  it('open and in-progress complaints can be edited and resolved, but not reopened', () => {
    for (const s of ['OPEN', 'IN_PROGRESS'] as const) {
      expect(isEditable(s)).toBe(true);
      expect(canResolve(s)).toBe(true);
      expect(canReopen(s)).toBe(false);
    }
  });

  it('work starts only from open', () => {
    expect(canStartWork('OPEN')).toBe(true);
    expect(canStartWork('IN_PROGRESS')).toBe(false);
    expect(canStartWork('RESOLVED')).toBe(false);
  });
});

describe('grievances: text rules (TEST-GRV-WEB-002)', () => {
  it('a description and a resolution are 10 to 2000 characters after trimming', () => {
    expect(isValidDescription('Callback never came')).toBe(true);
    expect(isValidDescription('   short   ')).toBe(false);
    expect(isValidDescription('x'.repeat(2001))).toBe(false);
    expect(isValidResolution('Callback made and closed')).toBe(true);
    expect(isValidResolution('done')).toBe(false);
  });

  it('a reopen reason is 5 to 500 characters', () => {
    expect(isValidReason('Still not fixed')).toBe(true);
    expect(isValidReason('no')).toBe(false);
  });

  it('a lender reference refuses identity and account-number patterns', () => {
    expect(isValidReference('LND-REF-4471')).toBe(true);
    expect(isValidReference('x')).toBe(false);
    expect(isValidReference('ABCDE1234F')).toBe(false);
    expect(isValidReference('123456789012')).toBe(false);
  });

  it('rejects descriptions with PAN, Aadhaar or account numbers (CMP-02)', () => {
    expect(isValidDescription('My PAN is ABCDE1234F please check')).toBe(false);
    expect(isValidDescription('Aadhaar number is 1234 5678 9012 update')).toBe(false);
    expect(isValidDescription('My account number is 12345678901234')).toBe(false);
  });
});
