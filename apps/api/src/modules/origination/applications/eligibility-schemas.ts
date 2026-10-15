// Request and response schemas for MOD-ELG Eligibility (owner: Dev 3; DSA Notion MODULE 17, ENT-050). Lives with the
// applications module because every assessment belongs to one application and uses its scope rules.
import { IdSchema } from '@dsa/contracts';
import { z } from 'zod';

export const CriterionResult = z.enum(['PASS', 'FAIL', 'UNKNOWN']);
export type CriterionResult = z.infer<typeof CriterionResult>;

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
  criteria: z.array(Criterion),
});
export type ProductResult = z.infer<typeof ProductResult>;

export const EligibilityOverride = z.object({
  productVersionId: z.string(),
  reason: z.string(),
  overriddenBy: z.string(),
  overriddenAt: z.string().datetime(),
});

export const EligibilityAssessment = z.object({
  id: IdSchema('elg'),
  applicationId: IdSchema('app'),
  assessedAt: z.string().datetime(),
  results: z.array(ProductResult),
  decisionRecordIds: z.array(z.string()),
  overrides: z.array(EligibilityOverride),
  createdBy: z.string(),
  version: z.number().int(),
});
export type EligibilityAssessment = z.infer<typeof EligibilityAssessment>;

export const EligibilityListQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().optional(),
  })
  .strict();

/** API-ELG-003. Only a FAIL result can be overridden, and every override needs a reason. */
export const OverrideRequest = z
  .object({
    productVersionId: z.string().trim().min(3).max(64),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();
export type OverrideRequest = z.infer<typeof OverrideRequest>;
