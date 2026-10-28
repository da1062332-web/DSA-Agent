// Application screen rules (owner: Dev 3; DSA Notion MODULE 16). Each rule mirrors the API.
import { describe, expect, it } from 'vitest';
import {
  canAssignOwners,
  canChangeParties,
  canEditDetails,
  canHold,
  canRemoveParty,
  hasRestrictedNumber,
  isValidAmount,
  isValidAssignmentReason,
  isValidHoldReason,
  isValidLegalHoldReason,
  isValidTenure,
  newApplicationProblem,
  CLOSABLE,
  isValidTransitionReason,
} from './rules';

describe('applications: status rules (TEST-APP-WEB-001)', () => {
  it('details can be edited only in Draft and Documents pending', () => {
    expect(canEditDetails('DRAFT')).toBe(true);
    expect(canEditDetails('DOCUMENTS_PENDING')).toBe(true);
    expect(canEditDetails('UNDER_REVIEW')).toBe(false);
    expect(canEditDetails('CANCELLED')).toBe(false);
  });

  it('a hold can be set in any status that is not terminal', () => {
    expect(canHold('UNDER_REVIEW')).toBe(true);
    expect(canHold('DISBURSED')).toBe(true);
    for (const s of ['CLOSED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'] as const) {
      expect(canHold(s)).toBe(false);
    }
  });
});

describe('applications: input rules (TEST-APP-WEB-002)', () => {
  it('an amount is a positive decimal with at most two places', () => {
    expect(isValidAmount('300000.00')).toBe(true);
    expect(isValidAmount('300000')).toBe(true);
    expect(isValidAmount('0')).toBe(false);
    expect(isValidAmount('1,00,000')).toBe(false);
    expect(isValidAmount('100.123')).toBe(false);
  });

  it('a tenure is a whole number of months from 1 to 480', () => {
    expect(isValidTenure('1')).toBe(true);
    expect(isValidTenure('480')).toBe(true);
    expect(isValidTenure('0')).toBe(false);
    expect(isValidTenure('481')).toBe(false);
    expect(isValidTenure('12.5')).toBe(false);
  });

  it('a hold reason is 3 to 200 characters after trimming', () => {
    expect(isValidHoldReason('Bank statements awaited')).toBe(true);
    expect(isValidHoldReason('  ab  ')).toBe(false);
    expect(isValidHoldReason('x'.repeat(201))).toBe(false);
  });
});

describe('applications: parties, owners and legal hold rules (TEST-APP-WEB-003)', () => {
  it('parties change in Draft, Documents pending and Under review only', () => {
    expect(canChangeParties('DRAFT')).toBe(true);
    expect(canChangeParties('UNDER_REVIEW')).toBe(true);
    for (const s of ['READY_FOR_SUBMISSION', 'SUBMITTED', 'WITHDRAWN', 'CANCELLED'] as const) {
      expect(canChangeParties(s)).toBe(false);
    }
  });

  it('the primary applicant and an already removed party cannot be removed', () => {
    expect(canRemoveParty({ role: 'PRIMARY', removedAt: null })).toBe(false);
    expect(canRemoveParty({ role: 'GUARANTOR', removedAt: '2026-10-28T10:00:00Z' })).toBe(false);
    expect(canRemoveParty({ role: 'CO_APPLICANT', removedAt: null })).toBe(true);
  });

  it('owners can be reassigned until the application is closed, with a reason of 3 to 200 characters', () => {
    expect(canAssignOwners('UNDER_REVIEW')).toBe(true);
    expect(canAssignOwners('SANCTIONED')).toBe(true);
    for (const s of ['CLOSED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'] as const)
      expect(canAssignOwners(s)).toBe(false);
    expect(isValidAssignmentReason('  ab ')).toBe(false);
    expect(isValidAssignmentReason('Branch transfer')).toBe(true);
    expect(isValidAssignmentReason('x'.repeat(201))).toBe(false);
  });

  it('a legal hold needs a reason of 5 to 1000 characters; free text must not carry PAN, Aadhaar or account numbers', () => {
    expect(isValidLegalHoldReason('abcd')).toBe(false);
    expect(isValidLegalHoldReason('Court order 2026/ABC')).toBe(true);
    expect(hasRestrictedNumber('PAN ABCDE1234F')).toBe(true);
    expect(hasRestrictedNumber('Aadhaar 2345 6789 0123')).toBe(true);
    expect(hasRestrictedNumber('Account 123456789012')).toBe(true);
    expect(hasRestrictedNumber('Court order 2026/ABC')).toBe(false);
  });
});

describe('applications: new application (TEST-APP-WEB-004)', () => {
  const ready = { customerId: 'cust_1', branchId: 'br_1', amount: '300000.00', tenure: '' };
  it('a new application needs a customer, a branch and a valid amount; tenure is optional but must be valid', () => {
    expect(newApplicationProblem(ready)).toBeNull();
    expect(newApplicationProblem({ ...ready, customerId: null })).toMatch(/customer/);
    expect(newApplicationProblem({ ...ready, branchId: null })).toMatch(/branch/);
    expect(newApplicationProblem({ ...ready, amount: '-5' })).toMatch(/amount/);
    expect(newApplicationProblem({ ...ready, tenure: '600' })).toMatch(/Tenure/);
    expect(newApplicationProblem({ ...ready, tenure: '60' })).toBeNull();
  });
});

describe('applications: send back and close rules (TEST-APP-WEB-005)', () => {
  it('a send back reason is 5 to 200 characters; only a disbursed or terminal file can be closed', () => {
    expect(isValidTransitionReason('abcd')).toBe(false);
    expect(isValidTransitionReason('  Wrong period  ')).toBe(true);
    expect(isValidTransitionReason('x'.repeat(201))).toBe(false);
    expect(CLOSABLE).toEqual(['DISBURSED', 'REJECTED', 'WITHDRAWN', 'CANCELLED']);
    expect(CLOSABLE).not.toContain('CLOSED');
  });
});
