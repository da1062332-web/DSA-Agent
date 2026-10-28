// Request and response schemas for MOD-APP Loan Applications (owner: Dev 3; DSA Notion MODULE 16). Money is a decimal
// string (Contracts §5). Scope is applied by the handlers, not here.
import { IdSchema } from '@dsa/contracts';
import { z } from 'zod';

// Free text rejects PAN, Aadhaar and 9–18-digit account-like numbers (Contracts §12, S3 out of MVP).
const S3_PATTERNS = [/[A-Z]{5}[0-9]{4}[A-Z]/i, /\b\d{4}\s?\d{4}\s?\d{4}\b/, /\b\d{9,18}\b/];
const safeText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !S3_PATTERNS.some((p) => p.test(s)), 'must not contain identity or account numbers');

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
  /** Why the file was sent back for rework (T-APP-03); cleared when it goes back to review (T-APP-02). */
  reworkReason: z.string().nullable(),
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
    reason: safeText(3, 200).optional(),
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

// ---- Transitions (API-APP-005). T-APP-01, 02, 04 and 10 are named by the spec (MVP). The T-APP table itself is not available:
// T-APP-08 (withdraw) and T-APP-09 (reopen) are the codes assumed for SUB-APP.06 (audit follow-up 2026-10-19), with the
// permissions the module page gives them (application.withdraw, application.reopen). T-APP-03 (send back for rework),
// T-APP-05 (send back to review) and T-APP-07 (close) were added on 2026-10-28 by owner decision, from the schema: the
// rework_reason column and the application.close permission. ----
export const CancelReason = z.enum(['DUPLICATE', 'CREATED_IN_ERROR', 'INELIGIBLE', 'OTHER']);
export const ApplicationTransition = z.discriminatedUnion('transitionCode', [
  z
    .object({
      transitionCode: z.literal('T-APP-01'),
      productVersionId: z.string().trim().min(3).max(64),
    })
    .strict(),
  z.object({ transitionCode: z.literal('T-APP-02') }).strict(),
  z
    .object({
      transitionCode: z.literal('T-APP-03'),
      reason: safeText(5, 200),
    })
    .strict(),
  z.object({ transitionCode: z.literal('T-APP-04') }).strict(),
  z
    .object({
      transitionCode: z.literal('T-APP-05'),
      reason: safeText(5, 200),
    })
    .strict(),
  z
    .object({
      transitionCode: z.literal('T-APP-07'),
      reason: safeText(5, 200).optional(),
    })
    .strict(),
  z
    .object({
      transitionCode: z.literal('T-APP-08'),
      reason: safeText(5, 200),
    })
    .strict(),
  z
    .object({
      transitionCode: z.literal('T-APP-09'),
      reason: safeText(5, 200),
    })
    .strict(),
  z
    .object({
      transitionCode: z.literal('T-APP-10'),
      cancelReason: CancelReason,
    })
    .strict(),
]);

// ---- Creation from a customer (API-APP-001) ----
export const ApplicationCreate = z
  .object({
    customerId: z.string().trim().min(3).max(64),
    branchId: z.string().trim().min(3).max(64),
    productCategory: z.enum(['PL', 'BL', 'MSME', 'LAP', 'HL', 'VL', 'GL', 'EL', 'OTHER']),
    requestedAmount: z.object({
      amount: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, 'a decimal string'),
      currency: z.literal('INR'),
    }),
    tenureMonths: z.number().int().min(1).max(480).optional(),
    purposeCode: PurposeCode.optional(),
    applicantType: ApplicantType,
    salesOwnerUserId: z.string().trim().min(3).max(64).optional(),
  })
  .strict();

// ---- Parties (API-APP-006) ----
export const ApplicationPartyChange = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('ADD'),
      customerId: z.string().trim().min(3).max(64),
      role: z.enum(['CO_APPLICANT', 'GUARANTOR']),
      relationshipToPrimary: z
        .enum(['SPOUSE', 'PARENT', 'CHILD', 'SIBLING', 'PARTNER', 'DIRECTOR', 'OTHER'])
        .optional(),
    })
    .strict(),
  z.object({ action: z.literal('REMOVE'), partyId: z.string().trim().min(3).max(64) }).strict(),
]);

// ---- Ownership (API-APP-011) ----
export const ApplicationAssignment = z
  .object({
    salesOwnerUserId: z.string().trim().min(3).max(64).optional(),
    opsOwnerUserId: z.string().trim().min(3).max(64).nullable().optional(),
    opsQueueId: z.string().trim().min(3).max(64).nullable().optional(),
    reason: safeText(3, 200),
  })
  .strict()
  .refine(
    (a) => a.salesOwnerUserId !== undefined || a.opsOwnerUserId !== undefined || a.opsQueueId !== undefined,
    {
      message: 'at least one owner is required',
    },
  );
export type ApplicationTransition = z.infer<typeof ApplicationTransition>;
