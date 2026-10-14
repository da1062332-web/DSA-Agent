// Application screen rules (owner: Dev 3; DSA Notion MODULE 16). Each rule mirrors the API.
import { describe, expect, it } from 'vitest';
import { canEditDetails, canHold, isValidAmount, isValidHoldReason, isValidTenure } from './rules';

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
