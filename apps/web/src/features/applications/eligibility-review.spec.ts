// Eligibility review rules on the screen (owner: Dev 3; DSA Notion MODULE 17). The API refuses the same inputs; these checks keep the
// form from offering what the API would refuse, and say when a check no longer reflects the figures.
import { describe, expect, it } from 'vitest';
import {
  MISSING_DATA_TEXT,
  businessDate,
  creditProblem,
  figuresChangedSince,
  isCalendarDate,
  isValidOverrideReason,
  type ApplicantInputs,
  verifiedIncomeCandidates,
} from './eligibility';

const inputs = (updatedAt: string | null): ApplicantInputs => ({
  applicationId: 'app_1',
  declaredMonthlyIncome: null,
  declaredIncomeSource: null,
  declaredAt: null,
  verifiedMonthlyIncome: null,
  verifiedAt: null,
  credit: null,
  creditEntryEnabled: false,
  updatedAt,
  version: 0,
});

describe('eligibility review: free text (TEST-ELG-WEB-005)', () => {
  it('an override reason with a PAN, an Aadhaar or an account number is refused, like the API refuses it', () => {
    expect(isValidOverrideReason('Reviewed with PAN ABCDE1234F and the file')).toBe(false);
    expect(isValidOverrideReason('Aadhaar 2345 6789 0123 checked by phone')).toBe(false);
    expect(isValidOverrideReason('Account 123456789012 was the source')).toBe(false);
    expect(isValidOverrideReason('Income proof reviewed by the branch manager')).toBe(true);
  });
});

describe('eligibility review: dates (TEST-ELG-WEB-006)', () => {
  it('a report date must name a real day', () => {
    expect(isCalendarDate('2026-02-31')).toBe(false);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(
      creditProblem({ score: '700', reference: 'RPT-1', reportDate: '2026-02-31', today: '2026-10-28' }),
    ).toMatch(/real day/);
  });
});

describe('eligibility review: a check that no longer reflects the figures (TEST-ELG-WEB-007)', () => {
  const checkedAt = '2026-10-28T10:00:00.000Z';

  it('is not flagged when nothing was recorded, or nothing changed since the check', () => {
    expect(figuresChangedSince(undefined, checkedAt)).toBe(false);
    expect(figuresChangedSince(inputs(null), checkedAt)).toBe(false);
    expect(figuresChangedSince(inputs('2026-10-27T09:00:00.000Z'), checkedAt)).toBe(false);
  });

  it('is flagged when a figure was recorded or cleared after the check', () => {
    expect(figuresChangedSince(inputs('2026-10-28T10:30:00.000Z'), checkedAt)).toBe(true);
  });
});

describe('eligibility review: the messages for the new gaps (TEST-ELG-WEB-008)', () => {
  it('a credit switched off and a co-applicant document each say what is missing', () => {
    expect(MISSING_DATA_TEXT.CREDIT_ENTRY_NOT_ENABLED).toMatch(/not switched on for this tenant/);
    expect(MISSING_DATA_TEXT.INCOME_EVIDENCE_NOT_PRIMARY).toMatch(/primary applicant/);
  });
});

describe('eligibility review: the business day (TEST-ELG-WEB-009)', () => {
  it('is the Asia/Kolkata calendar day, the same rule the API applies', () => {
    expect(businessDate(new Date('2026-10-27T20:00:00Z'))).toBe('2026-10-28');
    expect(businessDate(new Date('2026-10-27T18:00:00Z'))).toBe('2026-10-27');
  });
});

describe('eligibility review: the income picker (TEST-ELG-WEB-010)', () => {
  it("offers only accepted items on the primary applicant's documents", () => {
    const items = [
      { id: 'a', partyId: 'p1', status: 'ACCEPTED', documentTypeCode: 'SALARY_SLIP' },
      { id: 'b', partyId: 'p2', status: 'ACCEPTED', documentTypeCode: 'SALARY_SLIP' },
      { id: 'c', partyId: 'p1', status: 'PENDING', documentTypeCode: 'ITR' },
    ];
    const parties = [
      { id: 'p1', role: 'PRIMARY', removedAt: null },
      { id: 'p2', role: 'CO_APPLICANT', removedAt: null },
    ];
    expect(verifiedIncomeCandidates(items, parties).map((i) => i.id)).toEqual(['a']);
    expect(verifiedIncomeCandidates(items, [])).toEqual([]);
  });
});
