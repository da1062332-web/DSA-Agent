// Request and response schemas for MOD-APP Loan Applications (owner: Dev 3; DSA Notion MODULE 16). Money is a decimal
// string (Contracts §5). Scope is applied by the handlers, not here.
import { IdSchema } from '@dsa/contracts';
import { z } from 'zod';

const Money = z
  .string()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, 'decimal amount, up to 2 places, e.g. "300000.00"')
  .refine((v) => Number(v) > 0, 'amount must be greater than zero');

export const ApplicationStatus = z.enum([
  'DRAFT',
  'DOCUMENTS_PENDING',
  'UNDER_REVIEW',
  'READY_FOR_SUBMISSION',
  'SUBMITTED',
  'SANCTIONED',
  'PARTIALLY_DISBURSED',
  'DISBURSED',
  'CLOSED',
  'REJECTED',
  'WITHDRAWN',
  'CANCELLED',
]);
export type ApplicationStatus = z.infer<typeof ApplicationStatus>;

/** Statuses from which nothing more happens. A terminal application takes no edit and no hold. */
export const TERMINAL_STATUSES: readonly ApplicationStatus[] = [
  'CLOSED',
  'REJECTED',
  'WITHDRAWN',
  'CANCELLED',
];
/** Statuses in which the applicant's details may still be edited (assumption: confirm with the spec owner). */
export const EDITABLE_STATUSES: readonly ApplicationStatus[] = ['DRAFT', 'DOCUMENTS_PENDING'];

export const ApplicantType = z.enum([
  'SALARIED',
  'SELF_EMPLOYED_PROFESSIONAL',
  'SELF_EMPLOYED_BUSINESS',
  'NON_INDIVIDUAL',
]);
export const PurposeCode = z.enum([
  'PERSONAL_NEEDS',
  'MEDICAL',
  'EDUCATION',
  'HOME_PURCHASE',
  'HOME_IMPROVEMENT',
  'VEHICLE',
  'WORKING_CAPITAL',
  'BUSINESS_EXPANSION',
  'DEBT_CONSOLIDATION',
  'OTHER',
]);

// ---- Read (API-APP-002, API-APP-003) ----
export const Application = z.object({
  id: IdSchema('app'),
  customerId: z.string(),
  leadId: z.string().nullable(),
  branchId: z.string(),
  productCategory: z.string(),
  productVersionId: z.string().nullable(),
  requestedAmount: z.string(),
  currency: z.string(),
  tenureMonths: z.number().int().nullable(),
  purposeCode: PurposeCode.nullable(),
  applicantType: ApplicantType,
  status: ApplicationStatus,
  onHold: z.boolean(),
  holdReason: z.string().nullable(),
  holdUntil: z.string().nullable(),
  salesOwnerId: z.string(),
  opsOwnerId: z.string().nullable(),
  opsQueueId: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Application = z.infer<typeof Application>;

export const ApplicationListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  status: ApplicationStatus.optional(),
  onHold: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

// ---- Edit (API-APP-004) ----
export const ApplicationPatch = z
  .object({
    requestedAmount: Money.optional(),
    tenureMonths: z.number().int().min(1).max(480).optional(),
    purposeCode: PurposeCode.nullable().optional(),
    applicantType: ApplicantType.optional(),
  })
  .strict()
  .refine((p) => Object.values(p).some((v) => v !== undefined), {
    message: 'at least one field is required',
  });

// ---- Hold (API-APP-010) ----
export const ApplicationHold = z
  .object({
    onHold: z.boolean(),
    reason: z.string().trim().min(3).max(200).optional(),
    until: z.string().datetime().nullable().optional(),
  })
  .strict()
  .superRefine((h, ctx) => {
    if (h.onHold && !h.reason) {
      ctx.addIssue({
        code: 'custom',
        message: 'a reason is required to put an application on hold',
        path: ['reason'],
      });
    }
    if (!h.onHold && (h.reason || h.until)) {
      ctx.addIssue({
        code: 'custom',
        message: 'reason and until apply only when setting a hold',
        path: ['reason'],
      });
    }
  });
