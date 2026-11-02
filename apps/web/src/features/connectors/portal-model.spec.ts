// The partner portal's rules: which statement lines a payout may cover, the dispute categories, and the reason check (TEST-CPTUI).
import { describe, expect, it } from 'vitest';
import {
  DISPUTE_CATEGORIES,
  DOCUMENT_STATUS_LABEL,
  uploadUnavailableMessage,
  disputeCategoryLabel,
  disputeReasonError,
  payableLines,
  referralStatusLabel,
  sumMoney,
  type PortalStatementLine,
} from './portal-model';

const line = (id: string, state: string, disputed = false, amount = '100.00'): PortalStatementLine => ({
  id,
  amount: { amount, currency: 'INR' },
  state,
  disputed,
  createdAt: '2026-11-01T00:00:00.000Z',
});

describe('partner portal rules (TEST-CPTUI)', () => {
  it('TEST-CPTUI-01 a referral status the API does not name shows as in progress, never as the raw value', () => {
    expect(referralStatusLabel('RECEIVED')).toBe('Received');
    expect(referralStatusLabel('APPLICATION')).toBe('Application stage');
    expect(referralStatusLabel('SANCTIONED')).toBe('In progress');
  });

  it('TEST-CPTUI-02 a payout covers only eligible or approved lines that are not under dispute', () => {
    const lines = [
      line('a', 'ELIGIBLE'),
      line('b', 'APPROVED'),
      line('c', 'ACCRUED'),
      line('d', 'PAID'),
      line('e', 'ELIGIBLE', true),
      line('f', 'ON_HOLD'),
    ];
    expect(payableLines(lines).map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('TEST-CPTUI-03 sums are exact in rupees, without floating-point drift', () => {
    expect(
      sumMoney([
        { amount: '0.10', currency: 'INR' },
        { amount: '0.20', currency: 'INR' },
      ]),
    ).toBe(0.3);
  });

  it('TEST-CPTUI-04 a statement line offers only the categories the API accepts for it', () => {
    expect(DISPUTE_CATEGORIES.STATEMENT_LINE.map((c) => c.value)).toEqual([
      'COMMISSION_CALCULATION',
      'OTHER',
    ]);
    expect(DISPUTE_CATEGORIES.PAYOUT.map((c) => c.value)).toEqual(['PAYOUT', 'OTHER']);
    expect(disputeCategoryLabel('PAYOUT')).toBe('Payout');
    expect(disputeCategoryLabel(null)).toBe('—');
  });

  it('TEST-CPTUI-07 every document status and every unavailable reason has a partner label, and no internal reason is named', () => {
    expect(DOCUMENT_STATUS_LABEL.ACTION_REQUIRED).toMatch(/send it again/);
    expect(Object.values(DOCUMENT_STATUS_LABEL).every((label) => label.length > 0)).toBe(true);
    expect(uploadUnavailableMessage('NO_APPROVED_TYPES')).toMatch(/not currently available/);
    expect(uploadUnavailableMessage('SCANNER_UNAVAILABLE')).toMatch(/temporarily unavailable/);
    expect(uploadUnavailableMessage('APPLICATION_CLOSED')).toMatch(/no longer be added/);
    expect(uploadUnavailableMessage(null)).toBeNull();
    for (const reason of ['NO_APPROVED_TYPES', 'SCANNER_UNAVAILABLE', 'APPLICATION_CLOSED'] as const) {
      expect(uploadUnavailableMessage(reason)).not.toMatch(
        /clamd|ClamAV|scanner is not configured|partner_upload/i,
      );
    }
  });

  it('TEST-CPTUI-05 a dispute reason needs 5 to 500 characters and no PAN, Aadhaar or account number', () => {
    expect(disputeReasonError('  abc ')).toMatch(/at least 5/);
    expect(disputeReasonError('x'.repeat(501))).toMatch(/500/);
    expect(disputeReasonError('My PAN is ABCDE1234F here')).toMatch(/PAN/);
    expect(disputeReasonError('Account 123456789012 is wrong')).toMatch(/account/);
    expect(disputeReasonError('The share rate on this line is wrong.')).toBeNull();
  });
});
