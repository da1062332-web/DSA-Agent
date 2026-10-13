// packages/contracts/src/verification.ts — owner: Developer 2 (Module 19: Verification)
import { z } from 'zod';
import { IdSchema } from './ids';

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

export const VERIFICATION_OUTCOMES = [
  'POSITIVE',
  'NEGATIVE',
  'REFER_TO_CREDIT',
  'WAIVED',
] as const;
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
  partyId: z.string().optional(),
  customerId: z.string().optional(),
  verificationType: z.enum(VERIFICATION_TYPES),
  branchId: z.string().min(1, 'Branch ID is required'),
  priority: z.enum(VERIFICATION_PRIORITIES).default('MEDIUM'),
  assignedToUserId: z.string().optional(),
  assignedToQueueId: z.string().optional(),
  scheduledAt: z.string().datetime().optional(),
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

export const CompleteVerificationRequestSchema = z.object({
  outcome: z.enum(VERIFICATION_OUTCOMES),
  findingsSummary: z.string().max(2000).min(5, 'Findings summary must be at least 5 characters'),
  rejectionReason: z.enum(REJECTION_REASONS).optional(),
  markStatus: z.enum(['VERIFIED', 'REJECTED', 'WAIVED']).default('VERIFIED'),
}).refine(
  (data) => data.markStatus !== 'REJECTED' || !!data.rejectionReason,
  {
    message: 'Rejection reason is required when verification status is marked as REJECTED',
    path: ['rejectionReason'],
  }
);
export type CompleteVerificationRequest = z.infer<typeof CompleteVerificationRequestSchema>;

export const ChecklistAttestationRequestSchema = z.object({
  checklistItemId: z.string().min(1, 'Checklist item ID is required'),
  status: z.enum(CHECKLIST_REVIEW_STATUSES),
  attestationNote: z.string().max(500).optional(),
  rejectReason: z.enum(CHECKLIST_REJECT_REASONS).optional(),
}).refine(
  (data) => data.status !== 'REJECTED' || !!data.rejectReason,
  {
    message: 'Reject reason is required when status is REJECTED',
    path: ['rejectReason'],
  }
);
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
