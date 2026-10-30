// MOD-ELG rules (owner: Dev 3; DSA Notion MODULE 17). Pure functions, no I/O. They decide which information is usable, what the
// rule set's answer means for the product result, and whether an override duplicates an earlier one. The database work is in
// eligibility.ts; these functions are tested directly in eligibility-rules.spec.ts.
//
// The invariant behind all of it: a PASS needs the approved rule set to match a rule on usable information, and missing,
// stale or unaccepted information can only ever make the result UNKNOWN or REFER, never PASS.
import type { Criterion, CriterionResult, DecisionOutcome } from './eligibility-schemas';

export const ELIGIBILITY_DECISION_KEY = 'DK-application.eligibility' as const;

/** How old a credit report may be and still be used. Not taken from the approved rules. It is a placeholder for the credit
 *  policy owner to confirm (docs/PENDING_APPROVALS.md section 7). A report older than this counts as missing. */
export const CREDIT_DATA_MAX_AGE_DAYS = 90;

/** Applications in these states take no new assessment and no override. */
export const TERMINAL_STATUSES = ['CLOSED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'] as const;
/** Applicant inputs can be recorded only while the file is still being worked on. */
export const INPUT_EDITABLE_STATUSES = ['DRAFT', 'DOCUMENTS_PENDING', 'UNDER_REVIEW'] as const;

export const isTerminal = (status: string): boolean =>
  (TERMINAL_STATUSES as readonly string[]).includes(status);

export type MissingCode =
  | 'CREDIT_ENTRY_NOT_ENABLED'
  | 'CREDIT_SCORE_MISSING'
  | 'CREDIT_DATA_STALE'
  | 'VERIFIED_MONTHLY_INCOME_MISSING'
  | 'INCOME_EVIDENCE_NOT_PRIMARY'
  | 'INCOME_EVIDENCE_NOT_ACCEPTED'
  | 'FACT_MISSING';

export type FactPath = 'applicant.credit_score' | 'applicant.monthly_income.amount';

export interface Pending {
  code: MissingCode;
  /** The fact the rules read, so one gap is not reported twice (once here and once by the rule engine). */
  fact: FactPath;
  reason: string;
}

const DAY_MS = 86_400_000;

/** `reportDate` is a calendar date (YYYY-MM-DD). Usable when it is not in the future and not older than the limit on `asOf`. */
/** The business day for an instant, as YYYY-MM-DD: the calendar day in Asia/Kolkata, the platform's default timezone. */
export function businessDate(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (type: 'year' | 'month' | 'day') => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function creditReportUsable(reportDate: string, asOf: Date): boolean {
  const reported = Date.parse(`${reportDate}T00:00:00Z`);
  const today = Date.parse(`${businessDate(asOf)}T00:00:00Z`);
  return (
    Number.isFinite(reported) && reported <= today && today - reported <= CREDIT_DATA_MAX_AGE_DAYS * DAY_MS
  );
}

/**
 * What the rules cannot use yet, and why. Credit data counts only while manual credit entry is switched on for the tenant, and only
 * while its report is recent. Verified income counts only when it is the primary applicant's and its evidence is still accepted.
 */
export function pendingFor(input: {
  credit: { score: number; reportDate: string } | null;
  creditEnabled: boolean;
  verifiedIncome: { checklistStatus: string | null; primary: boolean } | null;
  asOf: Date;
}): Pending[] {
  const out: Pending[] = [];
  if (!input.creditEnabled) {
    out.push({
      code: 'CREDIT_ENTRY_NOT_ENABLED',
      fact: 'applicant.credit_score',
      reason: 'Manual credit data is not switched on for this tenant, so credit data is not used.',
    });
  } else if (!input.credit) {
    out.push({
      code: 'CREDIT_SCORE_MISSING',
      fact: 'applicant.credit_score',
      reason: 'Credit score is not recorded.',
    });
  } else if (!creditReportUsable(input.credit.reportDate, input.asOf)) {
    out.push({
      code: 'CREDIT_DATA_STALE',
      fact: 'applicant.credit_score',
      reason: `The credit report is older than ${CREDIT_DATA_MAX_AGE_DAYS} days, so it cannot be used.`,
    });
  }
  if (!input.verifiedIncome) {
    out.push({
      code: 'VERIFIED_MONTHLY_INCOME_MISSING',
      fact: 'applicant.monthly_income.amount',
      reason: 'Verified monthly income is not recorded.',
    });
  } else if (!input.verifiedIncome.primary) {
    out.push({
      code: 'INCOME_EVIDENCE_NOT_PRIMARY',
      fact: 'applicant.monthly_income.amount',
      reason:
        "The income document is not the primary applicant's, so it cannot verify the applicant's income.",
    });
  } else if (input.verifiedIncome.checklistStatus !== 'ACCEPTED') {
    out.push({
      code: 'INCOME_EVIDENCE_NOT_ACCEPTED',
      fact: 'applicant.monthly_income.amount',
      reason: 'The income document used for verification is no longer accepted.',
    });
  }
  return out;
}

export interface FactsInput {
  employmentType: string;
  requested: { amount: string; currency: string };
  tenureMonths: number | null;
  purposeCode: string | null;
  product: { min: { amount: string; currency: string }; max: { amount: string; currency: string } };
  /** Only usable credit data. A stale or missing report is left out, so the rules cannot read it. */
  credit: { score: number } | null;
  /** Only verified income with accepted evidence. Declared income is never passed as `monthly_income`. */
  verifiedIncome: { amount: string; currency: string } | null;
}

/** The facts for DK-application.eligibility. Only what the rules read, and nothing the rules do not need. */
export function buildFacts(input: FactsInput) {
  return {
    applicant: {
      employment_type: input.employmentType,
      ...(input.credit ? { credit_score: input.credit.score } : {}),
      ...(input.verifiedIncome
        ? { monthly_income: { amount: input.verifiedIncome.amount, currency: input.verifiedIncome.currency } }
        : {}),
    },
    application: {
      requested_amount: input.requested,
      ...(input.tenureMonths !== null ? { tenure_months: input.tenureMonths } : {}),
      ...(input.purposeCode ? { loan_purpose: input.purposeCode } : {}),
    },
    product: { min_amount: input.product.min, max_amount: input.product.max },
  };
}

/** What the rule engine returned, as far as the assessment needs it. */
export interface EngineView {
  status: string;
  errorCode: string | null;
  outputs: {
    result?: DecisionOutcome;
    maxEligibleAmount?: { amount: string; currency: string } | null;
    reasons?: { code: string; text: string }[];
  } | null;
  fallbackApplied: boolean;
  matchedRuleUids: string[];
  missingFields: string[];
}

export interface Assessed {
  result: CriterionResult;
  decisionResult: DecisionOutcome | null;
  criteria: Criterion[];
  missingData: string[];
  indicativeMaxAmount: { amount: string; currency: string } | null;
}

const unique = <T>(values: T[]): T[] => [...new Set(values)];

/** The code shown for a fact the rule engine could not read. */
export function missingDataCode(fact: string): string {
  if (fact === 'applicant.credit_score') return 'CREDIT_SCORE_MISSING';
  if (fact === 'applicant.monthly_income.amount' || fact === 'applicant.monthly_income') {
    return 'VERIFIED_MONTHLY_INCOME_MISSING';
  }
  return 'FACT_MISSING';
}

/**
 * The product result. Only a rule that matched on complete, usable information can give PASS. A rule set that is missing,
 * failed or unexpected gives UNKNOWN, and a manual-review answer gives UNKNOWN too, so the assessment never invents a pass.
 */
export function assessProduct(engine: EngineView, pending: Pending[]): Assessed {
  const covered = new Set<string>(pending.map((p) => p.fact));
  const engineMissing = unique(
    engine.missingFields.filter((f) => !covered.has(f)).map((f) => missingDataCode(f)),
  );
  const missingData = unique([...pending.map((p) => p.code), ...engineMissing]);
  const pendingCriteria: Criterion[] = pending.map((p) => ({
    code: p.code,
    result: 'UNKNOWN',
    reason: p.reason,
  }));
  const unknown = (code: string, reason: string): Assessed => ({
    result: 'UNKNOWN',
    decisionResult: null,
    criteria: [{ code, result: 'UNKNOWN', reason }, ...pendingCriteria],
    missingData,
    indicativeMaxAmount: null,
  });

  if (engine.status === 'NO_VERSION') {
    return unknown(
      'RULE_SET_UNAVAILABLE',
      'No approved eligibility rule set is active for this product, so nothing has been assessed.',
    );
  }
  if (engine.errorCode || !engine.outputs || !engine.outputs.result) {
    return unknown('EVALUATION_FAILED', 'The rules could not be evaluated, so nothing has been assessed.');
  }

  const reasons: Criterion[] = (engine.outputs.reasons ?? []).map((r) => ({
    code: r.code,
    result: 'UNKNOWN',
    reason: r.text,
  }));
  switch (engine.outputs.result) {
    case 'INELIGIBLE':
      // A decisive rule on the information it has. Missing data elsewhere cannot turn it into a pass.
      return {
        result: 'FAIL',
        decisionResult: 'INELIGIBLE',
        criteria: reasons.map((c) => ({ ...c, result: 'FAIL' })),
        missingData,
        indicativeMaxAmount: null,
      };
    case 'ELIGIBLE': {
      // A pass needs a matched rule on complete information: nothing pending here, and nothing the engine reports as missing.
      const passable =
        !engine.fallbackApplied &&
        engine.matchedRuleUids.length > 0 &&
        pending.length === 0 &&
        engineMissing.length === 0;
      if (passable) {
        return {
          result: 'PASS',
          decisionResult: 'ELIGIBLE',
          criteria: reasons.map((c) => ({ ...c, result: 'PASS' })),
          missingData,
          indicativeMaxAmount: engine.outputs.maxEligibleAmount ?? null,
        };
      }
      return {
        result: 'UNKNOWN',
        decisionResult: 'ELIGIBLE',
        criteria: [
          {
            code: 'INCOMPLETE_INFORMATION',
            result: 'UNKNOWN',
            reason:
              'The rules point to eligibility, but required information is incomplete, so this is not a pass.',
          },
          ...pendingCriteria,
        ],
        missingData,
        indicativeMaxAmount: null,
      };
    }
    case 'REFER':
      return {
        result: 'UNKNOWN',
        decisionResult: 'REFER',
        criteria: [...reasons, ...pendingCriteria],
        missingData,
        indicativeMaxAmount: null,
      };
    default:
      return unknown(
        'EVALUATION_FAILED',
        'The rules returned an answer that is not recognised, so nothing was assessed.',
      );
  }
}

/** A dated gap in the information the rules read, for the message shown to the user. */
export const MISSING_DATA_MESSAGES: Record<string, string> = {
  CREDIT_ENTRY_NOT_ENABLED:
    'Manual credit data is not switched on for this tenant, so credit data is not used.',
  CREDIT_SCORE_MISSING: 'Credit score is not recorded.',
  CREDIT_DATA_STALE: `The credit report is older than ${CREDIT_DATA_MAX_AGE_DAYS} days. Record a current report.`,
  VERIFIED_MONTHLY_INCOME_MISSING:
    'Verified monthly income is missing. Verify income from an accepted income document.',
  INCOME_EVIDENCE_NOT_PRIMARY:
    "The income document is not the primary applicant's. Verify income from the applicant's own accepted income document.",
  INCOME_EVIDENCE_NOT_ACCEPTED:
    'The income document used for verification is no longer accepted. Verify income again.',
  FACT_MISSING: 'Some information the rules need is missing.',
};

export interface PriorOverride {
  productVersionId: string;
  inputHash?: string | null;
  assessmentId?: string;
}

/**
 * One override per product result and set of inputs. A later assessment whose inputs changed may be overridden again, so the
 * rule does not block a legitimate new decision. Older entries without an input hash match only their own assessment.
 */
export function isDuplicateOverride(
  prior: PriorOverride[],
  target: { productVersionId: string; inputHash: string | null; assessmentId: string },
): boolean {
  return prior.some(
    (o) =>
      o.productVersionId === target.productVersionId &&
      (o.inputHash ? o.inputHash === target.inputHash : o.assessmentId === target.assessmentId),
  );
}
