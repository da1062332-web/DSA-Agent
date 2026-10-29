// MOD-ELG decision rules, pure (owner: Dev 3). No database: these check what the approved rule set's answer means, which
// information is missing or unusable, what reaches the rules, and when an override duplicates an earlier one.
import { describe, expect, it } from 'vitest';
import { isCalendarDate } from '../src/modules/origination/applications/eligibility-schemas';
import {
  assessProduct,
  buildFacts,
  businessDate,
  CREDIT_DATA_MAX_AGE_DAYS,
  creditReportUsable,
  isDuplicateOverride,
  missingDataCode,
  pendingFor,
  type EngineView,
} from '../src/modules/origination/applications/eligibility-rules';

const NOW = new Date('2026-10-28T10:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);
const PRIMARY_ACCEPTED = { checklistStatus: 'ACCEPTED', primary: true };

const engine = (over: Partial<EngineView> = {}): EngineView => ({
  status: 'OK',
  errorCode: null,
  outputs: null,
  fallbackApplied: false,
  matchedRuleUids: [],
  missingFields: [],
  ...over,
});
const ELIGIBLE = {
  result: 'ELIGIBLE' as const,
  maxEligibleAmount: { amount: '2500000.00', currency: 'INR' },
  reasons: [{ code: 'PRIME_BORROWER_ELIGIBLE', text: 'Applicant meets prime credit and income benchmarks' }],
};
const INELIGIBLE = {
  result: 'INELIGIBLE' as const,
  maxEligibleAmount: null,
  reasons: [{ code: 'CREDIT_SCORE_LOW', text: 'Credit bureau score below acceptable threshold (min 600)' }],
};
const REFER = {
  result: 'REFER' as const,
  maxEligibleAmount: null,
  reasons: [{ code: 'MANUAL_REVIEW', text: 'Application referred for underwriter review' }],
};

describe('eligibility rules: credit data freshness (TEST-ELG-RULE-001)', () => {
  it('a report up to the limit is usable; one day older is not; a report dated after today is not', () => {
    expect(creditReportUsable(daysAgo(CREDIT_DATA_MAX_AGE_DAYS), NOW)).toBe(true);
    expect(creditReportUsable(daysAgo(CREDIT_DATA_MAX_AGE_DAYS + 1), NOW)).toBe(false);
    expect(creditReportUsable(daysAgo(-1), NOW)).toBe(false);
    expect(creditReportUsable('not-a-date', NOW)).toBe(false);
  });

  it('the business day is the Asia/Kolkata day, so a report dated today in India is usable at 01:30 there', () => {
    const at = new Date('2026-10-27T20:00:00Z'); // 01:30 on 28 October in Asia/Kolkata
    expect(businessDate(at)).toBe('2026-10-28');
    expect(businessDate(new Date('2026-10-27T18:00:00Z'))).toBe('2026-10-27');
    expect(creditReportUsable('2026-10-28', at)).toBe(true);
    expect(creditReportUsable('2026-10-29', at)).toBe(false);
  });

  it('a stale report is pending as stale, and a missing one as missing', () => {
    expect(
      pendingFor({ credit: null, creditEnabled: true, verifiedIncome: null, asOf: NOW }).map((p) => p.code),
    ).toEqual(['CREDIT_SCORE_MISSING', 'VERIFIED_MONTHLY_INCOME_MISSING']);
    expect(
      pendingFor({
        credit: { score: 800, reportDate: daysAgo(200) },
        creditEnabled: true,
        verifiedIncome: PRIMARY_ACCEPTED,
        asOf: NOW,
      }).map((p) => p.code),
    ).toEqual(['CREDIT_DATA_STALE']);
  });

  it('credit data is not used while manual credit entry is off for the tenant, however recent the report', () => {
    expect(
      pendingFor({
        credit: { score: 800, reportDate: daysAgo(1) },
        creditEnabled: false,
        verifiedIncome: PRIMARY_ACCEPTED,
        asOf: NOW,
      }).map((p) => p.code),
    ).toEqual(['CREDIT_ENTRY_NOT_ENABLED']);
  });
});

describe('eligibility rules: verified income evidence (TEST-ELG-RULE-002)', () => {
  it('income counts only with an accepted checklist item of the primary applicant', () => {
    expect(
      pendingFor({
        credit: { score: 700, reportDate: daysAgo(1) },
        creditEnabled: true,
        verifiedIncome: PRIMARY_ACCEPTED,
        asOf: NOW,
      }),
    ).toEqual([]);
    expect(
      pendingFor({
        credit: { score: 700, reportDate: daysAgo(1) },
        creditEnabled: true,
        verifiedIncome: { checklistStatus: 'REJECTED', primary: true },
        asOf: NOW,
      }).map((p) => p.code),
    ).toEqual(['INCOME_EVIDENCE_NOT_ACCEPTED']);
    expect(
      pendingFor({
        credit: { score: 700, reportDate: daysAgo(1) },
        creditEnabled: true,
        verifiedIncome: { checklistStatus: null, primary: true },
        asOf: NOW,
      }).map((p) => p.code),
    ).toEqual(['INCOME_EVIDENCE_NOT_ACCEPTED']);
  });

  it("a co-applicant's accepted document does not verify the primary applicant's income", () => {
    const pending = pendingFor({
      credit: { score: 700, reportDate: daysAgo(1) },
      creditEnabled: true,
      verifiedIncome: { checklistStatus: 'ACCEPTED', primary: false },
      asOf: NOW,
    });
    expect(pending.map((p) => p.code)).toEqual(['INCOME_EVIDENCE_NOT_PRIMARY']);
    expect(pending[0]!.fact).toBe('applicant.monthly_income.amount');
  });
});

describe('eligibility rules: what reaches the rules (TEST-ELG-RULE-003)', () => {
  const base = {
    employmentType: 'SALARIED',
    requested: { amount: '300000.00', currency: 'INR' },
    tenureMonths: 36,
    purposeCode: 'PERSONAL_NEEDS',
    product: { min: { amount: '50000.00', currency: 'INR' }, max: { amount: '1000000.00', currency: 'INR' } },
    credit: null,
    verifiedIncome: null,
  };

  it('declared income is never passed as monthly_income; only the verified figure is', () => {
    const facts = buildFacts({ ...base, verifiedIncome: null });
    expect(facts.applicant).not.toHaveProperty('monthly_income');
    const verified = buildFacts({ ...base, verifiedIncome: { amount: '80000.00', currency: 'INR' } });
    expect(verified.applicant.monthly_income).toEqual({ amount: '80000.00', currency: 'INR' });
  });

  it('a credit score reaches the rules only when it is usable', () => {
    expect(buildFacts({ ...base, credit: { score: 790 } }).applicant).toHaveProperty('credit_score', 790);
    expect(buildFacts({ ...base, credit: null }).applicant).not.toHaveProperty('credit_score');
  });

  it('tenure and purpose are passed only when stored', () => {
    const none = buildFacts({ ...base, tenureMonths: null, purposeCode: null });
    expect(none.application).not.toHaveProperty('tenure_months');
    expect(none.application).not.toHaveProperty('loan_purpose');
    expect(buildFacts(base).application).toMatchObject({ tenure_months: 36, loan_purpose: 'PERSONAL_NEEDS' });
  });
});

describe('eligibility rules: the product result (TEST-ELG-RULE-004)', () => {
  it('PASS only when a rule matched on complete, usable information and no fallback was used', () => {
    const passed = assessProduct(engine({ outputs: ELIGIBLE, matchedRuleUids: ['RUL-ELG-003'] }), []);
    expect(passed).toMatchObject({
      result: 'PASS',
      decisionResult: 'ELIGIBLE',
      indicativeMaxAmount: { amount: '2500000.00', currency: 'INR' },
      missingData: [],
    });
    expect(passed.criteria).toEqual([
      expect.objectContaining({ code: 'PRIME_BORROWER_ELIGIBLE', result: 'PASS' }),
    ]);
  });

  it('an ELIGIBLE answer is never a pass while information is pending, or when it came from a fallback', () => {
    const pending = [
      {
        code: 'INCOME_EVIDENCE_NOT_ACCEPTED' as const,
        fact: 'applicant.monthly_income.amount' as const,
        reason: 'x',
      },
    ];
    const withPending = assessProduct(
      engine({ outputs: ELIGIBLE, matchedRuleUids: ['RUL-ELG-003'] }),
      pending,
    );
    expect(withPending.result).toBe('UNKNOWN');
    expect(withPending.missingData).toEqual(['INCOME_EVIDENCE_NOT_ACCEPTED']);
    const fallback = assessProduct(
      engine({ outputs: ELIGIBLE, fallbackApplied: true, matchedRuleUids: [] }),
      [],
    );
    expect(fallback.result).toBe('UNKNOWN');
  });

  it('an ELIGIBLE answer is not a pass while the engine reports a missing fact, even with nothing pending here', () => {
    const result = assessProduct(
      engine({
        outputs: ELIGIBLE,
        matchedRuleUids: ['RUL-ELG-003'],
        missingFields: ['application.tenure_months'],
      }),
      [],
    );
    expect(result.result).toBe('UNKNOWN');
    expect(result.missingData).toEqual(['FACT_MISSING']);
  });

  it('a decisive INELIGIBLE rule is a FAIL, even when other information is missing', () => {
    const pending = [
      {
        code: 'VERIFIED_MONTHLY_INCOME_MISSING' as const,
        fact: 'applicant.monthly_income.amount' as const,
        reason: 'x',
      },
    ];
    const failed = assessProduct(engine({ outputs: INELIGIBLE, matchedRuleUids: ['RUL-ELG-001'] }), pending);
    expect(failed).toMatchObject({ result: 'FAIL', decisionResult: 'INELIGIBLE' });
    expect(failed.missingData).toEqual(['VERIFIED_MONTHLY_INCOME_MISSING']);
    expect(failed.criteria).toEqual([expect.objectContaining({ code: 'CREDIT_SCORE_LOW', result: 'FAIL' })]);
  });

  it('a manual-review answer is UNKNOWN with the pending items listed as well', () => {
    const pending = [
      {
        code: 'CREDIT_SCORE_MISSING' as const,
        fact: 'applicant.credit_score' as const,
        reason: 'Credit score is not recorded.',
      },
    ];
    const referred = assessProduct(engine({ outputs: REFER, matchedRuleUids: [] }), pending);
    expect(referred).toMatchObject({ result: 'UNKNOWN', decisionResult: 'REFER' });
    expect(referred.criteria.map((c) => c.code)).toEqual(['MANUAL_REVIEW', 'CREDIT_SCORE_MISSING']);
  });

  it('a missing rule set, a failed evaluation or an unexpected answer is UNKNOWN, never a pass', () => {
    expect(assessProduct(engine({ status: 'NO_VERSION', outputs: REFER }), [])).toMatchObject({
      result: 'UNKNOWN',
      decisionResult: null,
      criteria: [expect.objectContaining({ code: 'RULE_SET_UNAVAILABLE' })],
    });
    expect(assessProduct(engine({ errorCode: 'MULTIPLE_MATCH', outputs: null }), [])).toMatchObject({
      result: 'UNKNOWN',
      criteria: [expect.objectContaining({ code: 'EVALUATION_FAILED' })],
    });
    expect(assessProduct(engine({ outputs: { result: 'APPROVED' as never, reasons: [] } }), []).result).toBe(
      'UNKNOWN',
    );
  });

  it('a fact the engine could not read is reported once, and not again when the same fact is already pending', () => {
    const pending = [
      { code: 'CREDIT_DATA_STALE' as const, fact: 'applicant.credit_score' as const, reason: 'Stale.' },
    ];
    const result = assessProduct(
      engine({
        outputs: REFER,
        missingFields: ['applicant.credit_score', 'applicant.monthly_income.amount'],
      }),
      pending,
    );
    expect(result.missingData).toEqual(['CREDIT_DATA_STALE', 'VERIFIED_MONTHLY_INCOME_MISSING']);
    expect(missingDataCode('applicant.credit_score')).toBe('CREDIT_SCORE_MISSING');
    expect(missingDataCode('something.else')).toBe('FACT_MISSING');
  });
});

describe('eligibility rules: override duplicates (TEST-ELG-RULE-005)', () => {
  const prior = [{ productVersionId: 'prv_1', inputHash: 'sha256:aa', assessmentId: 'elg_1' }];

  it('the same product result for the same inputs is a duplicate, in any assessment', () => {
    expect(
      isDuplicateOverride(prior, {
        productVersionId: 'prv_1',
        inputHash: 'sha256:aa',
        assessmentId: 'elg_2',
      }),
    ).toBe(true);
  });

  it('a changed input set, or another product version, is not a duplicate', () => {
    expect(
      isDuplicateOverride(prior, {
        productVersionId: 'prv_1',
        inputHash: 'sha256:bb',
        assessmentId: 'elg_2',
      }),
    ).toBe(false);
    expect(
      isDuplicateOverride(prior, {
        productVersionId: 'prv_2',
        inputHash: 'sha256:aa',
        assessmentId: 'elg_2',
      }),
    ).toBe(false);
  });

  it('an older override without an input hash only covers its own assessment', () => {
    const legacy = [{ productVersionId: 'prv_1', inputHash: null, assessmentId: 'elg_1' }];
    expect(
      isDuplicateOverride(legacy, {
        productVersionId: 'prv_1',
        inputHash: 'sha256:aa',
        assessmentId: 'elg_1',
      }),
    ).toBe(true);
    expect(
      isDuplicateOverride(legacy, {
        productVersionId: 'prv_1',
        inputHash: 'sha256:aa',
        assessmentId: 'elg_2',
      }),
    ).toBe(false);
  });
});

describe('eligibility rules: calendar dates (TEST-ELG-RULE-006)', () => {
  it('a date must name a real day: 2026-02-31 is refused, 2028-02-29 (a leap day) is accepted', () => {
    expect(isCalendarDate('2026-02-31')).toBe(false);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-10-28')).toBe(true);
  });
});
