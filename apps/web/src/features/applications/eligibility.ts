// Eligibility rules the screen shares with the API (owner: Dev 3; DSA Notion MODULE 17). The API enforces them again.
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
