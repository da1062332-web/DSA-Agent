import { describe, expect, it } from 'vitest';
import {
  MISSING_DATA_TEXT,
  NO_PROMISE,
  RESULT_LABELS,
  canOverride,
  creditProblem,
  formatMoney,
  formatRequested,
  formatTenure,
  isValidOverrideReason,
  latestAssessment,
  needsAutoCheck,
  normaliseAmount,
  outcomeOf,
  type EligibilityAssessment,
  type ProductResult,
} from './eligibility';

const TODAY = '2026-10-28';
const result = (
  r: ProductResult['result'],
  over: Partial<ProductResult> = {},
  id = 'prv_a_1',
): ProductResult => ({
  productVersionId: id,
  result: r,
  decisionResult: null,
  criteria: [],
  missingData: [],
  indicativeMaxAmount: null,
  ...over,
});
const assessment = (
  results: ProductResult[],
  overrides: EligibilityAssessment['overrides'] = [],
): EligibilityAssessment => ({
  id: 'elg_1',
  applicationId: 'app_1',
  assessedAt: '2026-10-15T00:00:00.000Z',
  results,
  decisionRecordIds: [],
  overrides,
  createdBy: 'usr_1',
  version: 0,
  productVersionId: 'prv_a_1',
  ruleSetVersionId: 'rsv_1',
  ruleSetVersionNo: 1,
  decisionStatus: 'OK',
  matchedRuleUids: [],
  missingData: [],
});

describe('eligibility outcome wording (TEST-ELG-WEB-001)', () => {
  it('a pass says it is preliminary and that the lender decides', () => {
    const o = outcomeOf(
      result('PASS', { criteria: [{ code: 'STANDARD_ELIGIBLE', result: 'PASS', reason: 'x' }] }),
    );
    expect(o).toMatchObject({ tone: 'success', title: 'Preliminary eligibility passed.' });
    expect(o.detail).toMatch(/lender/);
  });

  it('a failed result repeats the rule reason', () => {
    const o = outcomeOf(
      result('FAIL', {
        criteria: [{ code: 'CREDIT_SCORE_LOW', result: 'FAIL', reason: 'Credit bureau score below 600' }],
      }),
    );
    expect(o).toMatchObject({ tone: 'error', detail: 'Credit bureau score below 600' });
  });

  it('pending information is named in plain words, and is never presented as a pass', () => {
    const o = outcomeOf(result('UNKNOWN', { missingData: ['VERIFIED_MONTHLY_INCOME_MISSING'] }));
    expect(o.tone).toBe('warning');
    expect(o.title).toBe('Assessment pending: verified monthly income is missing.');
  });

  it('no rule set, a failed evaluation and a manual-review answer each have their own wording', () => {
    expect(
      outcomeOf(
        result('UNKNOWN', { criteria: [{ code: 'RULE_SET_UNAVAILABLE', result: 'UNKNOWN', reason: 'x' }] }),
      ).title,
    ).toMatch(/no approved rule set/);
    expect(
      outcomeOf(
        result('UNKNOWN', { criteria: [{ code: 'EVALUATION_FAILED', result: 'UNKNOWN', reason: 'x' }] }),
      ).title,
    ).toMatch(/did not give a usable answer/);
    expect(outcomeOf(result('UNKNOWN', { decisionResult: 'REFER' })).title).toMatch(/Manual review required/);
  });

  it('every missing-data code has a plain message that says what would resolve it', () => {
    for (const code of [
      'CREDIT_SCORE_MISSING',
      'CREDIT_DATA_STALE',
      'VERIFIED_MONTHLY_INCOME_MISSING',
      'INCOME_EVIDENCE_NOT_ACCEPTED',
    ]) {
      expect(MISSING_DATA_TEXT[code], code).toBeTruthy();
    }
    expect(MISSING_DATA_TEXT.VERIFIED_MONTHLY_INCOME_MISSING).toMatch(/accepted income document/);
  });
});

describe('eligibility money and tenure are shown only when they are real (TEST-ELG-WEB-002)', () => {
  it('the requested amount is shown in rupees, a zero is a real zero, and a missing or malformed value is not shown as zero', () => {
    expect(formatRequested('2500000.00', 'INR')).toBe('₹25,00,000.00');
    expect(formatRequested('0.00', 'INR')).toBe('₹0.00');
    expect(formatRequested(null, 'INR')).toBeNull();
    expect(formatRequested('', 'INR')).toBeNull();
    expect(formatRequested('abc', 'INR')).toBeNull();
    expect(formatMoney({ amount: '1000.00', currency: 'USD' })).toBe('USD 1,000.00');
  });

  it('a missing tenure is missing, never a default of 36 months', () => {
    expect(formatTenure(null)).toBeNull();
    expect(formatTenure(undefined)).toBeNull();
    expect(formatTenure(0)).toBe('0 months');
    expect(formatTenure(60)).toBe('60 months');
  });
});

describe('eligibility overrides and input rules (TEST-ELG-WEB-003)', () => {
  it('an override reason must be 10 to 500 characters after trimming', () => {
    expect(isValidOverrideReason('too short')).toBe(false);
    expect(isValidOverrideReason('   a b c d e   ')).toBe(false);
    expect(isValidOverrideReason('Income proof reviewed by the branch manager')).toBe(true);
    expect(isValidOverrideReason('x'.repeat(501))).toBe(false);
  });

  it('only a failed result that is not already overridden on this assessment can be overridden', () => {
    expect(canOverride(assessment([result('UNKNOWN')]), result('UNKNOWN'))).toBe(false);
    expect(canOverride(assessment([result('PASS')]), result('PASS'))).toBe(false);
    expect(canOverride(assessment([result('FAIL')]), result('FAIL'))).toBe(true);
    const done = [
      {
        productVersionId: 'prv_a_1',
        reason: 'r'.repeat(12),
        overriddenBy: 'u',
        overriddenAt: '2026-10-15T00:00:00.000Z',
      },
    ];
    expect(canOverride(assessment([result('FAIL')], done), result('FAIL'))).toBe(false);
  });

  it('an amount typed by the user is normalised to two decimals, and anything else is refused', () => {
    expect(normaliseAmount('50000')).toBe('50000.00');
    expect(normaliseAmount(' 50000.5 ')).toBe('50000.50');
    expect(normaliseAmount('-1')).toBeNull();
    expect(normaliseAmount('1.234')).toBeNull();
    expect(normaliseAmount('')).toBeNull();
  });

  it('a credit entry needs a score of 300 to 900, a reference without PAN or account numbers, and a date not in the future', () => {
    const ok = { score: '720', reference: 'RPT-2026-0007', reportDate: '2026-10-01', today: TODAY };
    expect(creditProblem(ok)).toBeNull();
    expect(creditProblem({ ...ok, score: '299' })).toMatch(/300 to 900/);
    expect(creditProblem({ ...ok, score: '72.5' })).toMatch(/300 to 900/);
    expect(creditProblem({ ...ok, reference: 'PAN ABCDE1234F' })).toMatch(/PAN/);
    expect(creditProblem({ ...ok, reference: '' })).toMatch(/1 to 60/);
    expect(creditProblem({ ...ok, reportDate: '2026-11-01' })).toMatch(/future/);
    expect(creditProblem({ ...ok, reportDate: '' })).toMatch(/report date/);
  });

  it('every result has plain wording, and the no-promise line says it is not an approval', () => {
    expect(Object.keys(RESULT_LABELS).sort()).toEqual(['FAIL', 'PASS', 'UNKNOWN']);
    expect(RESULT_LABELS.UNKNOWN).toBe('Cannot be decided yet');
    expect(NO_PROMISE).toMatch(/does not approve/);
  });
});

describe('needsAutoCheck', () => {
  const latest = { ...assessment([result('PASS', {}, 'prv_a_1')]), id: 'elg_1' }; // assessed 2026-10-15T00:00:00Z
  const base = { hasProduct: true, productVersionId: 'prv_a_1', updatedAt: '2026-10-14T12:00:00.000Z', latest };

  it('TEST-ELG-AUTO-001 runs when there is a product and no check yet', () => {
    expect(needsAutoCheck({ ...base, latest: undefined })).toBe(true);
  });

  it('TEST-ELG-AUTO-002 does nothing without a product, because the API refuses a check then', () => {
    expect(needsAutoCheck({ ...base, hasProduct: false, latest: undefined })).toBe(false);
  });

  it('TEST-ELG-AUTO-003 does not run again for an application that was only viewed', () => {
    expect(needsAutoCheck(base)).toBe(false);
  });

  it('TEST-ELG-AUTO-004 runs again when the product version changed since the latest check', () => {
    expect(needsAutoCheck({ ...base, productVersionId: 'prv_b_2' })).toBe(true);
  });

  it('TEST-ELG-AUTO-005 runs again when the application changed after the latest check, but not for a change within the clock tolerance', () => {
    expect(needsAutoCheck({ ...base, updatedAt: '2026-10-15T00:05:00.000Z' })).toBe(true);
    expect(needsAutoCheck({ ...base, updatedAt: '2026-10-15T00:00:01.000Z' })).toBe(false);
  });

  it('TEST-ELG-AUTO-006 never assesses a closed file again', () => {
    for (const status of ['CLOSED', 'REJECTED', 'WITHDRAWN', 'CANCELLED']) {
      expect(needsAutoCheck({ ...base, status, latest: undefined })).toBe(false);
    }
    expect(needsAutoCheck({ ...base, status: 'UNDER_REVIEW', latest: undefined })).toBe(true);
  });
});
