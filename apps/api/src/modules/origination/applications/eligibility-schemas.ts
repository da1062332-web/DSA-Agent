// Request and response schemas for MOD-ELG Eligibility (owner: Dev 3; DSA Notion MODULE 17, ENT-050). Lives with the
// applications module because every assessment belongs to one application and uses its scope rules.
// An assessment is a preliminary check against the approved rule set. It never approves a loan.
import { IdSchema, MoneySchema } from '@dsa/contracts';
import { z } from 'zod';
import { safeText } from './schemas';

export const CriterionResult = z.enum(['PASS', 'FAIL', 'UNKNOWN']);
export type CriterionResult = z.infer<typeof CriterionResult>;

/** What the approved rule set said, before the missing-data guard. REFER is the rule set's own "manual review". */
export const DecisionOutcome = z.enum(['ELIGIBLE', 'INELIGIBLE', 'REFER']);
export type DecisionOutcome = z.infer<typeof DecisionOutcome>;

export const Criterion = z.object({
  code: z.string(),
  result: CriterionResult,
  /** Why the result is what it is, or what is missing (for UNKNOWN). */
  reason: z.string(),
});
export type Criterion = z.infer<typeof Criterion>;

export const ProductResult = z.object({
  productVersionId: z.string(),
  result: CriterionResult,
  decisionResult: DecisionOutcome.nullable(),
  criteria: z.array(Criterion),
  /** Codes for the information that is missing or unusable (see eligibility-rules.ts). Never the values themselves. */
  missingData: z.array(z.string()),
  /** The rule's own ceiling for a pass. Indicative only: not an offer and not a sanction. */
  indicativeMaxAmount: MoneySchema.nullable(),
});
export type ProductResult = z.infer<typeof ProductResult>;

export const EligibilityOverride = z.object({
  productVersionId: z.string(),
  reason: z.string(),
  overriddenBy: z.string(),
  overriddenAt: z.string().datetime(),
  /** The assessment the override was recorded on. The input fingerprint stays in storage and is never returned. */
  assessmentId: z.string().optional(),
});
export type EligibilityOverride = z.infer<typeof EligibilityOverride>;

export const EligibilityAssessment = z.object({
  id: IdSchema('elg'),
  applicationId: IdSchema('app'),
  assessedAt: z.string().datetime(),
  results: z.array(ProductResult),
  decisionRecordIds: z.array(z.string()),
  overrides: z.array(EligibilityOverride),
  createdBy: z.string(),
  version: z.number().int(),
  /** Provenance. Null on the rows written before the rules were connected. The input fingerprint is not returned. */
  productVersionId: z.string().nullable(),
  ruleSetVersionId: z.string().nullable(),
  ruleSetVersionNo: z.number().int().nullable(),
  decisionStatus: z.string().nullable(),
  matchedRuleUids: z.array(z.string()),
  missingData: z.array(z.string()),
});
export type EligibilityAssessment = z.infer<typeof EligibilityAssessment>;

export const EligibilityListQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().optional(),
  })
  .strict();

/** API-ELG-003. Only a FAIL result can be overridden, and every override needs a reason of 10 to 500 characters. */
export const OverrideRequest = z
  .object({
    productVersionId: z.string().trim().min(3).max(64),
    reason: safeText(10, 500),
  })
  .strict();
export type OverrideRequest = z.infer<typeof OverrideRequest>;

// ---- Applicant inputs (the figures the rules read). Declared income is never used as verified income. ----

export const INCOME_SOURCES = ['APPLICANT_STATED', 'SALES_ESTIMATE'] as const;

/** True for a YYYY-MM-DD string that names a real day (rejects 2026-02-31). */
export const isCalendarDate = (value: string): boolean => {
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
};

const Amount = z.string().regex(/^\d{1,16}\.\d{2}$/, 'must be a decimal amount with 2 places');
const InrAmount = z.object({ amount: Amount, currency: z.literal('INR') }).strict();

/** A partial update. A field left out is unchanged; `null` clears it. Declared income and its source go together. */
export const ApplicantInputsUpdate = z
  .object({
    declaredMonthlyIncome: InrAmount.nullable().optional(),
    declaredIncomeSource: z.enum(INCOME_SOURCES).nullable().optional(),
    verifiedMonthlyIncome: InrAmount.extend({ checklistItemId: z.string().trim().min(3).max(64) })
      .strict()
      .nullable()
      .optional(),
    credit: z
      .object({
        score: z.number().int().min(300).max(900),
        reportReference: safeText(1, 60),
        reportDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date as YYYY-MM-DD')
          .refine(isCalendarDate, 'must be a real calendar date'),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (Object.keys(v).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'nothing to change' });
    }
    if ((v.declaredMonthlyIncome === undefined) !== (v.declaredIncomeSource === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['declaredIncomeSource'],
        message: 'send the declared income and its source together',
      });
    }
    if (v.declaredMonthlyIncome && !v.declaredIncomeSource) {
      ctx.addIssue({
        code: 'custom',
        path: ['declaredIncomeSource'],
        message: 'is required with a declared income',
      });
    }
  });
export type ApplicantInputsUpdate = z.infer<typeof ApplicantInputsUpdate>;

export const ApplicantInputs = z.object({
  applicationId: z.string(),
  declaredMonthlyIncome: InrAmount.nullable(),
  declaredIncomeSource: z.enum(INCOME_SOURCES).nullable(),
  declaredAt: z.string().datetime().nullable(),
  verifiedMonthlyIncome: InrAmount.extend({ checklistItemId: z.string() }).nullable(),
  verifiedAt: z.string().datetime().nullable(),
  credit: z
    .object({
      score: z.number().int(),
      reportReference: z.string(),
      reportDate: z.string(),
      enteredAt: z.string().datetime(),
      /** Whether the report is recent enough for the rules: see CREDIT_DATA_MAX_AGE_DAYS. */
      usable: z.boolean(),
    })
    .nullable(),
  /** Whether this tenant allows staff to record a credit score by hand (feature flag). */
  creditEntryEnabled: z.boolean(),
  /** When any figure last changed. Null when nothing was ever recorded. */
  updatedAt: z.string().datetime().nullable(),
  version: z.number().int(),
});
export type ApplicantInputs = z.infer<typeof ApplicantInputs>;
