// packages/contracts/src/document-sharing.ts — Module 25: Document Sharing (MOD-DSH)
// Canonical entities: ENT-062 (upload_link), ENT-063 (external_share)
import { z } from 'zod';
import { IdSchema } from './ids';

export const UPLOAD_LINK_STATUSES = ['ACTIVE', 'EXPIRED', 'REVOKED', 'LOCKED', 'COMPLETED'] as const;
export type UploadLinkStatus = (typeof UPLOAD_LINK_STATUSES)[number];

export const SHARE_RECIPIENT_TYPES = ['LENDER', 'CO_LENDER', 'PARTNER', 'AUDITOR'] as const;
export type ShareRecipientType = (typeof SHARE_RECIPIENT_TYPES)[number];
export const ShareRecipientTypeSchema = z.enum(SHARE_RECIPIENT_TYPES);

export const SHARE_PURPOSES = ['LENDER_SUBMISSION', 'PORTFOLIO_REVIEW', 'AUDIT_INSPECTION'] as const;
export type SharePurpose = (typeof SHARE_PURPOSES)[number];
export const SharePurposeSchema = z.enum(SHARE_PURPOSES);

/**
 * SUB-DSH.01: Create Customer Upload Link (POST /v1/upload-links)
 */
export const CreateUploadLinkSchema = z.object({
  applicationId: IdSchema('app'),
  checklistItemIds: z.array(z.string().min(1)).min(1).max(20),
  recipientContactId: z.string().optional(),
  expiresInHours: z.number().int().min(1).max(168).default(48), // Default 48h, max 7 days
  maxUses: z.number().int().min(1).max(50).default(5),
  otpRequired: z.boolean().default(true),
});
export type CreateUploadLinkInput = z.infer<typeof CreateUploadLinkSchema>;

/**
 * ENT-062: Upload Link Record
 */
export const UploadLinkRecordSchema = z.object({
  id: IdSchema('upl'),
  tenantId: z.string(),
  applicationId: z.string(),
  items: z.array(z.string()),
  itemDetails: z
    .array(
      z.object({
        id: z.string(),
        documentTypeCode: z.string(),
        ordinal: z.number().int(),
        mandatory: z.boolean().optional(),
      }),
    )
    .optional(),
  recipientContactId: z.string(),
  expiresAt: z.string(),
  otpRequired: z.boolean(),
  maxUses: z.number().int(),
  uses: z.number().int(),
  revokedAt: z.string().nullable(),
  lockedAt: z.string().nullable(),
  uploadUrl: z.string().optional(),
  lockVersion: z.number().int().nonnegative(),
  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type UploadLinkRecord = z.infer<typeof UploadLinkRecordSchema>;

/**
 * Public Upload Link Status (GET /public/v1/upload/:token)
 * Zero sensitive customer/application data exposed prior to OTP verification.
 */
export const PublicUploadLinkStatusSchema = z.object({
  status: z.enum(['PENDING_OTP', 'READY_FOR_UPLOAD', 'COMPLETED', 'LOCKED', 'EXPIRED', 'REVOKED']),
  expiresAt: z.string(),
  otpRequired: z.boolean(),
  maskedContact: z.string(),
  requestedItems: z.array(
    z.object({
      checklistItemId: z.string(),
      documentTypeCode: z.string(),
      ordinal: z.number().int(),
      mandatory: z.boolean(),
    }),
  ),
});
export type PublicUploadLinkStatus = z.infer<typeof PublicUploadLinkStatusSchema>;

/**
 * Verify Upload OTP (POST /public/v1/upload/:token/otp-verification)
 */
export const VerifyUploadOtpSchema = z.object({
  otp: z.string().regex(/^\d{6}$/, 'OTP must be exactly 6 numeric digits'),
});
export type VerifyUploadOtpInput = z.infer<typeof VerifyUploadOtpSchema>;

export const VerifyUploadOtpResponseSchema = z.object({
  uploadSessionToken: z.string(),
  sessionExpiresAt: z.string(),
  applicationReference: z.string(),
  items: z.array(
    z.object({
      checklistItemId: z.string(),
      documentTypeCode: z.string(),
      ordinal: z.number().int(),
      mandatory: z.boolean(),
    }),
  ),
});
export type VerifyUploadOtpResponse = z.infer<typeof VerifyUploadOtpResponseSchema>;

/**
 * Public File Upload Response (POST /public/v1/upload/:token/files)
 */
export const UploadFileResponseSchema = z.object({
  documentId: IdSchema('doc'),
  checklistItemId: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  fileSizeBytes: z.number().int().nonnegative(),
  status: z.literal('SUBMITTED'),
  uploadedAt: z.string(),
});
export type UploadFileResponse = z.infer<typeof UploadFileResponseSchema>;

/**
 * SUB-DSH.02: Create Case Share Package (POST /v1/shares)
 */
export const ShareRecipientContactSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  mobile: z.string().optional(),
});

export const CreateShareSchema = z.object({
  applicationId: IdSchema('app'),
  recipientType: ShareRecipientTypeSchema,
  recipientId: z.string().min(1).max(100),
  recipientContact: ShareRecipientContactSchema,
  purpose: SharePurposeSchema.default('LENDER_SUBMISSION'),
  expiresInDays: z.number().int().min(1).max(30).default(7),
  checklistItemIds: z.array(z.string()).optional(),
});
export type CreateShareInput = z.infer<typeof CreateShareSchema>;

/**
 * ENT-063: External Share Record
 */
export const ExternalShareRecordSchema = z.object({
  id: IdSchema('shr'),
  tenantId: z.string(),
  applicationId: z.string(),
  recipientType: ShareRecipientTypeSchema,
  recipientId: z.string(),
  recipientContact: ShareRecipientContactSchema,
  purpose: SharePurposeSchema,
  consentIds: z.array(z.string()),
  manifest: z.record(z.unknown()),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  accessCount: z.number().int().nonnegative(),
  dataSharingRecordId: z.string(),
  lockVersion: z.number().int().nonnegative(),
  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type ExternalShareRecord = z.infer<typeof ExternalShareRecordSchema>;

/**
 * List Shares Query (GET /v1/shares?subjectType=&subjectId=)
 */
export const ListSharesQuerySchema = z.object({
  subjectType: z.enum(['LOAN_APPLICATION']).optional(),
  subjectId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type ListSharesQuery = z.infer<typeof ListSharesQuerySchema>;

/**
 * List Upload Links Query (GET /v1/upload-links?applicationId=)
 */
export const ListUploadLinksQuerySchema = z.object({
  applicationId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type ListUploadLinksQuery = z.infer<typeof ListUploadLinksQuerySchema>;
