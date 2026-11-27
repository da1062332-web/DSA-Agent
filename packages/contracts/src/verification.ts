// packages/contracts/src/verification.ts
// Module 19 (Checklist & Field Investigation) & Module 22 (Identity & Underwriting Verification)
import { z } from 'zod';
import { GSTIN_PATTERN, PAN_PATTERN } from './customer-profile';
import { IdSchema } from './ids';
import { CursorQuery, listResponse } from './pagination';
import { freeTextNoS3 } from './s3-text';

// ==========================================
// Module 19: Verification Cases & Checklist
// ==========================================

export const VERIFICATION_TYPES = [
  'DOCUMENT_REVIEW',
  'IDENTITY_KYC',
  'RESIDENCE_FI',
  'OFFICE_FI',
  'EMPLOYMENT',
  'BANK_STATEMENT',
] as const;
export type VerificationType = (typeof VERIFICATION_TYPES)[number];

export const VERIFICATION_STATUSES = [
  'INITIATED',
  'ASSIGNED',
  'IN_PROGRESS',
  'VERIFIED',
  'REJECTED',
  'WAIVED',
  'CANCELLED',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VERIFICATION_OUTCOMES = ['POSITIVE', 'NEGATIVE', 'REFER_TO_CREDIT', 'WAIVED'] as const;
export type VerificationOutcome = (typeof VERIFICATION_OUTCOMES)[number];

export const VERIFICATION_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type VerificationPriority = (typeof VERIFICATION_PRIORITIES)[number];

export const REJECTION_REASONS = [
  'ADDRESS_NOT_FOUND',
  'APPLICANT_UNKNOWN',
  'DOCUMENT_FORGED',
  'SALARY_MISMATCH',
  'BUSINESS_CLOSED',
  'UNCOOPERATIVE',
  'INCOMPLETE_DETAILS',
  'OTHER',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export const CHECKLIST_REVIEW_STATUSES = ['ACCEPTED', 'REJECTED', 'WAIVED'] as const;
export type ChecklistReviewStatus = (typeof CHECKLIST_REVIEW_STATUSES)[number];

export const CHECKLIST_REJECT_REASONS = [
  'ILLEGIBLE',
  'EXPIRED_DOCUMENT',
  'MISMATCH',
  'INCOMPLETE',
  'WRONG_DOCUMENT',
  'OTHER',
] as const;
export type ChecklistRejectReason = (typeof CHECKLIST_REJECT_REASONS)[number];

// Request Schemas
export const CreateVerificationRequestSchema = z.object({
  applicationId: z.string().min(1, 'Application ID is required'),
  partyId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  verificationType: z.enum(VERIFICATION_TYPES),
  assignedToUserId: z.string().nullable().optional(),
  assignedToQueueId: z.string().nullable().optional(),
  branchId: z.string().min(1, 'Branch ID is required'),
  priority: z.enum(VERIFICATION_PRIORITIES).default('MEDIUM'),
  scheduledAt: z.string().datetime().nullable().optional(),
  checklistItmIds: z.array(z.string()).default([]),
  findingsSummary: z.string().max(2000).optional(),
});
export type CreateVerificationRequest = z.infer<typeof CreateVerificationRequestSchema>;

export const UpdateVerificationRequestSchema = z.object({
  status: z.enum(VERIFICATION_STATUSES).optional(),
  priority: z.enum(VERIFICATION_PRIORITIES).optional(),
  assignedToUserId: z.string().nullable().optional(),
  assignedToQueueId: z.string().nullable().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  findingsSummary: z.string().max(2000).optional(),
  checklistItmIds: z.array(z.string()).optional(),
});
export type UpdateVerificationRequest = z.infer<typeof UpdateVerificationRequestSchema>;

export const CompleteVerificationRequestSchema = z
  .object({
    outcome: z.enum(VERIFICATION_OUTCOMES),
    findingsSummary: z.string().max(2000).min(5, 'Findings summary must be at least 5 characters'),
    rejectionReason: z.enum(REJECTION_REASONS).optional(),
    markStatus: z.enum(['VERIFIED', 'REJECTED', 'WAIVED']).default('VERIFIED'),
  })
  .refine((data) => data.markStatus !== 'REJECTED' || !!data.rejectionReason, {
    message: 'Rejection reason is required when verification status is marked as REJECTED',
    path: ['rejectionReason'],
  });
export type CompleteVerificationRequest = z.infer<typeof CompleteVerificationRequestSchema>;

export const ChecklistAttestationRequestSchema = z
  .object({
    checklistItemId: z.string().min(1, 'Checklist item ID is required'),
    status: z.enum(CHECKLIST_REVIEW_STATUSES),
    attestationNote: z.string().max(500).optional(),
    rejectReason: z.enum(CHECKLIST_REJECT_REASONS).optional(),
  })
  .refine((data) => data.status !== 'REJECTED' || !!data.rejectReason, {
    message: 'Reject reason is required when status is REJECTED',
    path: ['rejectReason'],
  });
export type ChecklistAttestationRequest = z.infer<typeof ChecklistAttestationRequestSchema>;

export const VerificationListQuerySchema = z.object({
  status: z.enum(VERIFICATION_STATUSES).optional(),
  verificationType: z.enum(VERIFICATION_TYPES).optional(),
  priority: z.enum(VERIFICATION_PRIORITIES).optional(),
  applicationId: z.string().optional(),
  branchId: z.string().optional(),
  assignedToUserId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type VerificationListQuery = z.infer<typeof VerificationListQuerySchema>;

// Response Schemas
export const VerificationResponseSchema = z.object({
  id: IdSchema('vrf'),
  tenantId: z.string(),
  applicationId: z.string(),
  partyId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  verificationType: z.enum(VERIFICATION_TYPES),
  status: z.enum(VERIFICATION_STATUSES),
  outcome: z.enum(VERIFICATION_OUTCOMES).nullable().optional(),
  assignedToUserId: z.string().nullable().optional(),
  assignedToQueueId: z.string().nullable().optional(),
  branchId: z.string(),
  priority: z.enum(VERIFICATION_PRIORITIES),
  scheduledAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  verifiedBy: z.string().nullable().optional(),
  findingsSummary: z.string().nullable().optional(),
  rejectionReason: z.enum(REJECTION_REASONS).nullable().optional(),
  checklistItmIds: z.array(z.string()),
  lockVersion: z.number().int(),
  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type VerificationResponse = z.infer<typeof VerificationResponseSchema>;

export const VerificationListResponseSchema = z.object({
  data: z.array(VerificationResponseSchema),
  meta: z.object({
    nextCursor: z.string().nullable().optional(),
    limit: z.number(),
    totalCount: z.number().optional(),
  }),
});
export type VerificationListResponse = z.infer<typeof VerificationListResponseSchema>;

// ==========================================
// Module 22: Verification (MOD-VER) Checks
// ==========================================

export const VERIFICATION_CHECK_TYPES = [
  'PAN',
  'GST',
  'CIN',
  'ITR',
  'BANK_STATEMENT',
  'BUREAU',
  'IDENTITY_DOCUMENT',
  'EMPLOYMENT',
  'ADDRESS',
  // The bank-account penny drop (P1-06): a Rs 1 transfer to the account, which returns the name the bank holds. Not BANK_STATEMENT,
  // which is the analysis of an uploaded statement (P4-15). Added 2026-11-27 with migration 0138, which widens the table's CHECK.
  'BANK_ACCOUNT',
] as const;
export type VerificationCheckType = (typeof VERIFICATION_CHECK_TYPES)[number];

export const VERIFICATION_METHODS = ['MANUAL', 'PROVIDER_AUTOMATED'] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export const VERIFICATION_PURPOSES = [
  'KYC',
  'FINANCIAL_UNDERWRITING',
  'EMPLOYMENT_CHECK',
  'COLLATERAL_LEGAL',
  'FRAUD_PREVENTION',
] as const;
export type VerificationPurpose = (typeof VERIFICATION_PURPOSES)[number];

export const VERIFICATION_RESULTS = ['VERIFIED', 'REJECTED', 'FLAGGED', 'INCONCLUSIVE'] as const;
export type VerificationResult = (typeof VERIFICATION_RESULTS)[number];

export const VERIFICATION_SUBJECT_TYPES = ['CUSTOMER', 'LOAN_APPLICATION', 'LEAD'] as const;
export type VerificationSubjectType = (typeof VERIFICATION_SUBJECT_TYPES)[number];

/**
 * Minimal Result Field Schemas (Strictly Masked — S3 Data Classification, ADR-4D-04)
 * Absolutely no raw 12-digit Aadhaar numbers permitted.
 */
export const MinimalResultSchema = z.object({
  statusDescription: z.string().max(255),
  matchScore: z.number().min(0).max(100).optional(),
  nameMatchScore: z.number().min(0).max(100).optional(),
  maskedIdentifier: z.string().max(32).optional(),
  discrepancies: z.array(z.string()).optional().default([]),
  providerReference: z.string().max(128).optional(),
  rawPayloadHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/, 'Must be a 64-char SHA-256 hexadecimal hash')
    .optional(),
});
export type MinimalResult = z.infer<typeof MinimalResultSchema>;

/**
 * API-VER-001: POST /v1/verifications Input Schema
 */
export const CreateVerificationSchema = z.object({
  subjectType: z.enum(VERIFICATION_SUBJECT_TYPES),
  subjectId: z.string().min(5).max(64),
  checkType: z.enum(VERIFICATION_CHECK_TYPES),
  method: z.enum(VERIFICATION_METHODS),
  purpose: z.enum(VERIFICATION_PURPOSES),
  consentRecordId: IdSchema('cnst'),
  result: z.enum(VERIFICATION_RESULTS),
  minimalResult: MinimalResultSchema,
  evidenceRef: z.string().min(3).max(512),
  validityExpiresAt: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateVerificationInput = z.input<typeof CreateVerificationSchema>;

/**
 * Entity ENT-064: verification
 */
export const VerificationSchema = z.object({
  id: IdSchema('ver'),
  tenantId: IdSchema('ten'),
  subjectType: z.enum(VERIFICATION_SUBJECT_TYPES),
  subjectId: z.string(),
  checkType: z.enum(VERIFICATION_CHECK_TYPES),
  method: z.enum(VERIFICATION_METHODS),
  purpose: z.enum(VERIFICATION_PURPOSES),
  consentRecordId: IdSchema('cnst'),
  result: z.enum(VERIFICATION_RESULTS),
  minimalResult: MinimalResultSchema,
  evidenceRef: z.string(),
  validityExpiresAt: z.string().datetime().nullable(),
  performedBy: IdSchema('usr'),
  performedAt: z.string().datetime(),
  notes: z.string().nullable(),
  lockVersion: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type VerificationRecord = z.infer<typeof VerificationSchema>;

/**
 * API-VER-002: GET /v1/verifications Query Schema
 */
export const ListVerificationsQuerySchema = CursorQuery.extend({
  subjectType: z.enum(VERIFICATION_SUBJECT_TYPES).optional(),
  subjectId: z.string().optional(),
  checkType: z.enum(VERIFICATION_CHECK_TYPES).optional(),
  result: z.enum(VERIFICATION_RESULTS).optional(),
  method: z.enum(VERIFICATION_METHODS).optional(),
});
export type ListVerificationsQuery = z.infer<typeof ListVerificationsQuerySchema>;

export const ListVerificationsResponseSchema = listResponse(VerificationSchema);
export type ListVerificationsResponse = z.infer<typeof ListVerificationsResponseSchema>;

// ==========================================
// API-VER-003: POST /v1/verifications/checks (the server runs a provider check)
// Added 2026-11-27 (additive, Contracts §15, P1-06). The caller never states the result: the server computes it from the
// vendor's answer, so a provider-automated record cannot be forged.
// ==========================================

/**
 * The provider checks the server can run. PAN and GST only read a register and can be repeated freely. BANK_ACCOUNT is the penny
 * drop: it moves Rs 1, so it is never repeated by accident (see KycCheckPort for what an unknown outcome becomes).
 */
export const KYC_RUNNABLE_CHECKS = ['PAN', 'GST', 'BANK_ACCOUNT'] as const;
export type KycRunnableCheck = (typeof KYC_RUNNABLE_CHECKS)[number];

const upperMatching = (pattern: RegExp, message: string) =>
  z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .refine((s) => pattern.test(s), message);

/** An Indian bank account number: 9 to 18 digits. Spaces and hyphens typed between digits are removed first. */
const BANK_ACCOUNT_NUMBER_PATTERN = /^[0-9]{9,18}$/;
/** An IFSC code: four letters, a zero, six letters or digits (HDFC0001234). */
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const runCheckCommon = {
  subjectType: z.enum(VERIFICATION_SUBJECT_TYPES),
  subjectId: z.string().min(5).max(64),
  consentRecordId: IdSchema('cnst'),
  /** Free text: compared with the name the vendor holds and never stored. */
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((s) => !freeTextNoS3(s), 'must not contain identity or account numbers')
    .optional(),
  purpose: z.enum(VERIFICATION_PURPOSES).default('KYC'),
};

/**
 * `idNumber` is the full PAN or GSTIN, and `accountNumber` the full bank account number, typed for this check only: they go to the
 * vendor and are never stored, logged or returned. `ifsc` is a public branch code. For BANK_ACCOUNT, `name` is the account holder's
 * name that the bank's answer is compared with (without it the check stands on the bank's word that the Rs 1 credit went through).
 * `.strict()`: an unknown key (an Aadhaar number, a date of birth) is a 422, never ignored.
 */
export const RunVerificationCheckSchema = z.discriminatedUnion('check', [
  z
    .object({
      ...runCheckCommon,
      check: z.literal('PAN'),
      idNumber: upperMatching(PAN_PATTERN, 'must be a valid PAN'),
    })
    .strict(),
  z
    .object({
      ...runCheckCommon,
      check: z.literal('GST'),
      idNumber: upperMatching(GSTIN_PATTERN, 'must be a valid GSTIN'),
    })
    .strict(),
  z
    .object({
      ...runCheckCommon,
      check: z.literal('BANK_ACCOUNT'),
      accountNumber: z
        .string()
        .max(32)
        .transform((s) => s.replace(/[\s-]/g, ''))
        .refine(
          (s) => BANK_ACCOUNT_NUMBER_PATTERN.test(s),
          'must be a valid bank account number (9 to 18 digits)',
        ),
      ifsc: upperMatching(IFSC_PATTERN, 'must be a valid IFSC code'),
    })
    .strict(),
]);
/** What a caller sends. */
export type RunVerificationCheckInput = z.input<typeof RunVerificationCheckSchema>;
/** What the server works with after validation: the identifier upper-cased (the account number stripped of spaces), the purpose defaulted. */
export type RunVerificationCheck = z.output<typeof RunVerificationCheckSchema>;
