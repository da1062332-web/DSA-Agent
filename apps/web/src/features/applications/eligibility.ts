// Eligibility rules the screen shares with the API (owner: Dev 3; DSA Notion MODULE 17). The API enforces them again.
import { TERMINAL, type ApplicationStatus } from './rules';

export type CriterionResult = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface Criterion {
  code: string;
  result: CriterionResult;
  reason: string;
}

export interface ProductResult {
  productVersionId: string;
  result: CriterionResult;
  criteria: Criterion[];
}

export interface EligibilityOverride {
  productVersionId: string;
  reason: string;
  overriddenBy: string;
  overriddenAt: string;
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
}

export const RESULT_LABELS: Record<CriterionResult, string> = {
  PASS: 'Meets the criteria',
  FAIL: 'Does not meet the criteria',
  UNKNOWN: 'Cannot be assessed yet',
};

/** An assessment never promises approval; this line is shown with every result. */
export const NO_PROMISE = 'This is a preliminary check. It does not approve or promise a loan.';

/** The newest assessment. The API lists oldest first, so it is the last one. */
export const latestAssessment = (list: EligibilityAssessment[]): EligibilityAssessment | undefined =>
  list[list.length - 1];

/** An override needs a reason of 10 to 500 characters (API-ELG-003). */
export const isValidOverrideReason = (reason: string): boolean => {
  const n = reason.trim().length;
  return n >= 10 && n <= 500;
};

/** Only a failed result that has not been overridden already can be overridden. */
export const canOverride = (assessment: EligibilityAssessment, result: ProductResult): boolean =>
  result.result === 'FAIL' &&
  !assessment.overrides.some((o) => o.productVersionId === result.productVersionId);

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
