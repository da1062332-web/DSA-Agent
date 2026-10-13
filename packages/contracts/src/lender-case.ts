// packages/contracts/src/lender-case.ts — owner: Dev 4 (MOD-LCS Lender Cases)
import { z } from 'zod';

export const LENDER_CASE_STATUSES = [
  'DRAFT',
  'PACKAGE_READY',
  'SUBMITTED',
  'UNDER_PROCESSING',
  'QUERY_RAISED',
  'QUERY_RESPONDED',
  'SANCTIONED',
  'REJECTED',
  'WITHDRAWN',
  'SANCTION_EXPIRED',
  'SANCTION_CANCELLED',
  'PARTIALLY_DISBURSED',
  'DISBURSED',
  'CLOSED',
] as const;
export type LenderCaseStatus = (typeof LENDER_CASE_STATUSES)[number];
export const LenderCaseStatusEnum = z.enum(LENDER_CASE_STATUSES);

export const SUBMISSION_CHANNELS = ['PORTAL', 'EMAIL', 'API', 'PHYSICAL'] as const;
export type SubmissionChannel = (typeof SUBMISSION_CHANNELS)[number];
export const SubmissionChannelEnum = z.enum(SUBMISSION_CHANNELS);

export const STATUS_SOURCES = ['MANUAL', 'LENDER_API', 'LENDER_FILE', 'EMAIL_PARSED', 'SYSTEM'] as const;
export type StatusSource = (typeof STATUS_SOURCES)[number];
export const StatusSourceEnum = z.enum(STATUS_SOURCES);

export const DECLINE_REASON_CODES = [
  'POLICY',
  'INCOME',
  'CREDIT_HISTORY',
  'DOCUMENTATION',
  'LOCATION',
  'CUSTOMER_DECLINED',
  'OTHER',
] as const;
export type DeclineReasonCode = (typeof DECLINE_REASON_CODES)[number];
export const DeclineReasonCodeEnum = z.enum(DECLINE_REASON_CODES);

export const PACKAGE_KINDS = ['SUBMISSION', 'QUERY_RESPONSE'] as const;
export type PackageKind = (typeof PACKAGE_KINDS)[number];
export const PackageKindEnum = z.enum(PACKAGE_KINDS);

/** Terminal states where a case cannot receive regular status updates */
export const TERMINAL_LENDER_CASE_STATUSES: ReadonlySet<LenderCaseStatus> = new Set<LenderCaseStatus>([
  'REJECTED',
  'WITHDRAWN',
  'SANCTION_EXPIRED',
  'SANCTION_CANCELLED',
  'CLOSED',
]);

/** Active states covered by the single active case per (application, lender) unique index */
export const ACTIVE_LENDER_CASE_STATUSES: ReadonlySet<LenderCaseStatus> = new Set<LenderCaseStatus>([
  'DRAFT',
  'PACKAGE_READY',
  'SUBMITTED',
  'UNDER_PROCESSING',
  'QUERY_RAISED',
  'QUERY_RESPONDED',
]);

/** State machine valid transitions */
export const VALID_LENDER_CASE_TRANSITIONS: Record<LenderCaseStatus, readonly LenderCaseStatus[]> = {
  DRAFT: ['PACKAGE_READY', 'WITHDRAWN'],
  PACKAGE_READY: ['SUBMITTED', 'DRAFT', 'WITHDRAWN'],
  SUBMITTED: ['UNDER_PROCESSING', 'QUERY_RAISED', 'SANCTIONED', 'REJECTED', 'WITHDRAWN'],
  UNDER_PROCESSING: ['QUERY_RAISED', 'SANCTIONED', 'REJECTED', 'WITHDRAWN'],
  QUERY_RAISED: ['QUERY_RESPONDED', 'REJECTED', 'WITHDRAWN'],
  QUERY_RESPONDED: ['UNDER_PROCESSING', 'QUERY_RAISED', 'SANCTIONED', 'REJECTED', 'WITHDRAWN'],
  SANCTIONED: ['PARTIALLY_DISBURSED', 'DISBURSED', 'SANCTION_EXPIRED', 'SANCTION_CANCELLED', 'WITHDRAWN'],
  PARTIALLY_DISBURSED: ['DISBURSED', 'CLOSED'],
  DISBURSED: ['CLOSED'],
  REJECTED: [],
  WITHDRAWN: [],
  SANCTION_EXPIRED: [],
  SANCTION_CANCELLED: [],
  CLOSED: [],
};

export function isValidLenderCaseTransition(from: LenderCaseStatus, to: LenderCaseStatus): boolean {
  if (from === to) return true;
  const allowed = VALID_LENDER_CASE_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

// --- Request and Response Schemas ---

export const CreateLenderCaseInputSchema = z.object({
  lenderId: z.string().min(1, 'lenderId is required'),
  productVersionId: z.string().min(1, 'productVersionId is required'),
  empanelmentId: z.string().min(1, 'empanelmentId is required'),
  tags: z.array(z.string()).default([]),
});
export type CreateLenderCaseInput = z.infer<typeof CreateLenderCaseInputSchema>;

export const LenderCaseResourceSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  applicationId: z.string(),
  lenderId: z.string(),
  productVersionId: z.string(),
  empanelmentId: z.string(),
  attemptNo: z.number().int().min(1),
  status: LenderCaseStatusEnum,
  lenderReference: z.string().nullable().optional(),
  submissionChannel: SubmissionChannelEnum.nullable().optional(),
  submittedAt: z.string().nullable().optional(),
  packageId: z.string().nullable().optional(),
  statusSource: StatusSourceEnum.nullable().optional(),
  lastStatusAt: z.string().nullable().optional(),
  declineReasonCode: DeclineReasonCodeEnum.nullable().optional(),
  stalenessFlag: z.boolean(),
  tags: z.array(z.string()),
  lockVersion: z.number().int(),
  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type LenderCaseResource = z.infer<typeof LenderCaseResourceSchema>;

export const BuildPackageInputSchema = z.object({
  kind: PackageKindEnum.default('SUBMISSION'),
  waivers: z.array(z.string()).default([]),
  freeze: z.boolean().default(true),
});
export type BuildPackageInput = z.infer<typeof BuildPackageInputSchema>;

export const SubmissionPackageResourceSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  lenderCaseId: z.string(),
  kind: PackageKindEnum,
  manifest: z.record(z.unknown()),
  manifestSha256: z.string().length(64),
  consentIds: z.array(z.string()).min(1),
  builtBy: z.string(),
  builtAt: z.string(),
  frozenAt: z.string().nullable().optional(),
});
export type SubmissionPackageResource = z.infer<typeof SubmissionPackageResourceSchema>;

export const SubmitLenderCaseInputSchema = z.object({
  channel: SubmissionChannelEnum,
  lenderReference: z.string().max(100).optional(),
  submittedAt: z.string().datetime().optional(),
});
export type SubmitLenderCaseInput = z.infer<typeof SubmitLenderCaseInputSchema>;

export const SubmitLenderCaseResponseSchema = z.object({
  lenderCaseId: z.string(),
  status: z.literal('SUBMITTED'),
  packageId: z.string(),
  manifest: z.record(z.unknown()),
  applicationStatus: z.string(),
  dataSharingRecordId: z.string(),
});
export type SubmitLenderCaseResponse = z.infer<typeof SubmitLenderCaseResponseSchema>;

export const UpdateLenderCaseStatusInputSchema = z
  .object({
    toStatus: LenderCaseStatusEnum,
    statusSource: StatusSourceEnum.default('MANUAL'),
    declineReasonCode: DeclineReasonCodeEnum.optional(),
    reasonText: z.string().max(1000).optional(),
    lenderReference: z.string().max(100).optional(),
  })
  .refine(
    (data) => {
      if (data.toStatus === 'REJECTED') {
        return !!data.declineReasonCode;
      }
      return true;
    },
    {
      message: 'declineReasonCode is required when toStatus is REJECTED',
      path: ['declineReasonCode'],
    },
  );
export type UpdateLenderCaseStatusInput = z.infer<typeof UpdateLenderCaseStatusInputSchema>;

export const RecordLenderQueryInputSchema = z.object({
  text: z.string().min(3).max(2000),
  requestedItems: z.array(z.string()).default([]),
  lenderDueDate: z.string().datetime().optional(),
});
export type RecordLenderQueryInput = z.infer<typeof RecordLenderQueryInputSchema>;

export const RecordQueryResponseInputSchema = z.object({
  text: z.string().min(1).max(2000),
  documentReferences: z.array(z.string()).default([]),
});
export type RecordQueryResponseInput = z.infer<typeof RecordQueryResponseInputSchema>;

export const LenderQueryResourceSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  lenderCaseId: z.string(),
  text: z.string(),
  requestedItems: z.array(z.string()),
  lenderDueDate: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  responseManifestId: z.string().nullable().optional(),
  respondedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  createdBy: z.string(),
});
export type LenderQueryResource = z.infer<typeof LenderQueryResourceSchema>;

export const LenderCaseStatusHistoryResourceSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  lenderCaseId: z.string(),
  fromStatus: LenderCaseStatusEnum.nullable().optional(),
  toStatus: LenderCaseStatusEnum,
  statusSource: StatusSourceEnum,
  reasonText: z.string().nullable().optional(),
  actor: z.string(),
  occurredAt: z.string(),
});
export type LenderCaseStatusHistoryResource = z.infer<typeof LenderCaseStatusHistoryResourceSchema>;
