// Eligibility rules and wording the screen shares with the API (owner: Dev 3; DSA Notion MODULE 17). The API enforces every rule
// again; this file only decides what to show and what the user may try. Nothing here approves a loan.
import { hasRestrictedNumber, TERMINAL, type ApplicationStatus } from './rules';

export type CriterionResult = 'PASS' | 'FAIL' | 'UNKNOWN';
export type DecisionOutcome = 'ELIGIBLE' | 'INELIGIBLE' | 'REFER';

export interface Money {
  amount: string;
  currency: string;
}

export interface Criterion {
  code: string;
  result: CriterionResult;
  reason: string;
}

export interface ProductResult {
  productVersionId: string;
  result: CriterionResult;
  decisionResult: DecisionOutcome | null;
  criteria: Criterion[];
  missingData: string[];
  indicativeMaxAmount: Money | null;
}

export interface EligibilityOverride {
  productVersionId: string;
  reason: string;
  overriddenBy: string;
  overriddenAt: string;
  assessmentId?: string;
}

export interface EligibilityAssessment {
  id: string;
  applicationId: string;
  assessedAt: string;
  results: ProductResult[];
  decisionRecordIds: string[];
  overrides: EligibilityOverride[];
  createdBy: string;
  version: number;
  productVersionId: string | null;
  ruleSetVersionId: string | null;
  ruleSetVersionNo: number | null;
  decisionStatus: string | null;
  matchedRuleUids: string[];
  missingData: string[];
}

export interface ApplicantInputs {
  applicationId: string;
  declaredMonthlyIncome: Money | null;
  declaredIncomeSource: 'APPLICANT_STATED' | 'SALES_ESTIMATE' | null;
  declaredAt: string | null;
  verifiedMonthlyIncome: (Money & { checklistItemId: string }) | null;
  verifiedAt: string | null;
  credit: {
    score: number;
    reportReference: string;
    reportDate: string;
    enteredAt: string;
    usable: boolean;
  } | null;
  creditEntryEnabled: boolean;
  /** When any figure last changed. Null when nothing was ever recorded. */
  updatedAt: string | null;
  version: number;
}

export const RESULT_LABELS: Record<CriterionResult, string> = {
  PASS: 'Meets the approved criteria',
  FAIL: 'Does not meet the approved criteria',
  UNKNOWN: 'Cannot be decided yet',
};

/** Applicant figures can change only while the file is still being worked on (the API enforces the same list). */
export const INPUT_EDITABLE_STATUSES = ['DRAFT', 'DOCUMENTS_PENDING', 'UNDER_REVIEW'] as const;

/** Shown with every result. A check never promises approval. */
export const NO_PROMISE =
  'This is a preliminary check against the approved rules. It does not approve a loan or promise a sanction; final approval rests with the lender.';

/** What each missing or unusable item means for the user, and what would resolve it. */
export const MISSING_DATA_TEXT: Record<string, string> = {
  CREDIT_SCORE_MISSING:
    'Credit score is not recorded. It can be recorded from an authorised credit report when the tenant allows it.',
  CREDIT_DATA_STALE: 'The credit report is older than the allowed age. Record a current report.',
  VERIFIED_MONTHLY_INCOME_MISSING:
    'Verified monthly income is missing. Verify it from an accepted income document on the checklist.',
  INCOME_EVIDENCE_NOT_ACCEPTED:
    'The income document used for verification is no longer accepted. Verify income again from an accepted document.',
  INCOME_EVIDENCE_NOT_PRIMARY:
    "The income document is not the primary applicant's. Verify income from the applicant's own accepted income document.",
  CREDIT_ENTRY_NOT_ENABLED:
    'Manual credit data is not switched on for this tenant, so credit data is not used.',
  FACT_MISSING: 'Some information the rules need is missing.',
};

const MISSING_SHORT: Record<string, string> = {
  CREDIT_SCORE_MISSING: 'credit score is missing',
  CREDIT_DATA_STALE: 'the credit report is out of date',
  VERIFIED_MONTHLY_INCOME_MISSING: 'verified monthly income is missing',
  INCOME_EVIDENCE_NOT_ACCEPTED: 'the income document is no longer accepted',
  INCOME_EVIDENCE_NOT_PRIMARY: "the income document is not the applicant's",
  CREDIT_ENTRY_NOT_ENABLED: 'manual credit data is switched off',
  FACT_MISSING: 'some information is missing',
};

export interface Outcome {
  tone: 'success' | 'warning' | 'error';
  title: string;
  detail: string;
}

/** The plain statement for one product result. It repeats only what the stored result says. */
export function outcomeOf(result: ProductResult): Outcome {
  const codes = result.criteria.map((c) => c.code);
  if (result.result === 'PASS') {
    return {
      tone: 'success',
      title: 'Preliminary eligibility passed.',
      detail: 'Final approval remains with the lender.',
    };
  }
  if (result.result === 'FAIL') {
    const reason = result.criteria.find((c) => c.result === 'FAIL')?.reason;
    return {
      tone: 'error',
      title: 'Does not meet the approved criteria.',
      detail: reason ?? 'An authorised approver can override this result with a recorded reason.',
    };
  }
  if (codes.includes('RULE_SET_UNAVAILABLE')) {
    return {
      tone: 'warning',
      title: 'Cannot be assessed: no approved rule set is active for this product.',
      detail: 'Nothing has been decided for this application.',
    };
  }
  if (codes.includes('EVALUATION_FAILED')) {
    return {
      tone: 'warning',
      title: 'Could not be assessed: the rules did not give a usable answer.',
      detail: 'Nothing has been decided for this application.',
    };
  }
  if (result.missingData.length > 0) {
    const first = result.missingData.map((c) => MISSING_SHORT[c] ?? MISSING_SHORT.FACT_MISSING);
    return {
      tone: 'warning',
      title: `Assessment pending: ${first.join('; ')}.`,
      detail: 'A pending assessment is not a pass. Resolve the item below and check again.',
    };
  }
  return {
    tone: 'warning',
    title: 'Manual review required: the available information is insufficient.',
    detail: 'The rules refer this application to an underwriter.',
  };
}

/** The newest assessment. The API lists oldest first, so it is the last one. */
export const latestAssessment = (list: EligibilityAssessment[]): EligibilityAssessment | undefined =>
  list[list.length - 1];

/** Whether a result may be overridden from the screen: a failed result, not yet overridden on this assessment. */
export const canOverride = (assessment: EligibilityAssessment, result: ProductResult): boolean =>
  result.result === 'FAIL' &&
  !assessment.overrides.some((o) => o.productVersionId === result.productVersionId);

/** An override needs a reason of 10 to 500 characters (API-ELG-003), and no PAN, Aadhaar or account numbers (CLAUDE.md). */
export const isValidOverrideReason = (reason: string): boolean => {
  const n = reason.trim().length;
  return n >= 10 && n <= 500 && !hasRestrictedNumber(reason);
};

/** True for a YYYY-MM-DD string that names a real day (rejects 2026-02-31). */
export const isCalendarDate = (value: string): boolean => {
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
};

/** True when a figure was recorded or cleared after the check, so the check no longer reflects the file. */
export function figuresChangedSince(inputs: ApplicantInputs | undefined, checkedAt: string): boolean {
  if (!inputs?.updatedAt) return false;
  return Date.parse(inputs.updatedAt) > Date.parse(checkedAt);
}

/** A money value for display. Null when it is missing or malformed, so a blank never reads as a zero amount. */
export function formatMoney(value: Money | null | undefined): string | null {
  if (!value || !/^\d+(\.\d+)?$/.test(value.amount)) return null;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value.amount));
  return value.currency === 'INR' ? `₹${formatted}` : `${value.currency} ${formatted}`;
}

/** The requested amount of an application, which the API sends as a string with its currency next to it. */
export function formatRequested(
  amount: string | null | undefined,
  currency: string | null | undefined,
): string | null {
  return formatMoney(amount && currency ? { amount, currency } : null);
}

/** Tenure in months, or null when none is recorded. Never a default: a missing tenure is shown as missing. */
export const formatTenure = (months: number | null | undefined): string | null =>
  typeof months === 'number' ? `${months} months` : null;

/** The business day for an instant, as YYYY-MM-DD: the Asia/Kolkata calendar day, the same rule the API applies. */
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

/**
 * The checklist items the income picker offers: accepted items on the primary applicant's documents only. The server also
 * requires an income document type and refuses anything else (422), so this narrows the choice; it does not replace that check.
 */
export function verifiedIncomeCandidates<T extends { partyId: string; status: string }>(
  items: T[],
  parties: { id: string; role: string; removedAt: string | null }[],
): T[] {
  const primary = parties.find((p) => p.role === 'PRIMARY' && p.removedAt === null);
  return primary ? items.filter((i) => i.status === 'ACCEPTED' && i.partyId === primary.id) : [];
}

// ---- Applicant figures: the checks the form runs before the API does ----

const AMOUNT = /^\d{1,16}(\.\d{1,2})?$/;

/** Normalises an amount typed by the user to two decimal places, or null when it is not a valid amount. */
export function normaliseAmount(text: string): string | null {
  const t = text.trim();
  if (!AMOUNT.test(t)) return null;
  return Number(t).toFixed(2);
}

export function creditProblem(input: {
  score: string;
  reference: string;
  reportDate: string;
  today: string;
}): string | null {
  const score = Number(input.score);
  if (!/^\d{3}$/.test(input.score.trim()) || score < 300 || score > 900) {
    return 'The credit score is a whole number from 300 to 900.';
  }
  const reference = input.reference.trim();
  if (reference.length < 1 || reference.length > 60) return 'The report reference is 1 to 60 characters.';
  if (hasRestrictedNumber(reference))
    return 'The report reference must not contain PAN, Aadhaar or account numbers.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reportDate)) return 'Enter the report date.';
  if (!isCalendarDate(input.reportDate)) return 'Enter the report date as a real day.';
  if (input.reportDate > input.today) return 'The report date cannot be in the future.';
  return null;
}

/** The API and the database clocks can differ by a moment; a change this close to a check does not count as after it. */
const CHANGE_TOLERANCE_MS = 2_000;

/**
 * Whether the screen should run a check by itself. Every check is a saved record with an audit event, so it runs only when the latest
 * one no longer describes the application: there is none, it did not cover the application's current product version (a check
 * assesses exactly that one version), or the application changed after it. Viewing an unchanged application never adds a record,
 * and a closed file is not assessed again.
 */
export function needsAutoCheck(input: {
  hasProduct: boolean;
  status?: string;
  productVersionId?: string | null;
  updatedAt?: string | null;
  latest?: EligibilityAssessment;
}): boolean {
  const { hasProduct, status, productVersionId, updatedAt, latest } = input;
  if (!hasProduct) return false;
  if (status && TERMINAL.includes(status as ApplicationStatus)) return false;
  if (!latest) return true;
  if (productVersionId && !latest.results.some((r) => r.productVersionId === productVersionId)) return true;
  if (updatedAt && Date.parse(updatedAt) - Date.parse(latest.assessedAt) > CHANGE_TOLERANCE_MS) return true;
  return false;
}
