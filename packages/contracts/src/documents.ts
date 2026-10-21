// MOD-DOC documents (Module 20; API-DOC-001..009, API-PRV-004). Owner: Dev 3. Added 2026-10-19 (additive, Contracts §15).
import { z } from 'zod';

export const DOCUMENT_CATEGORIES = [
  'IDENTITY',
  'ADDRESS',
  'INCOME',
  'BUSINESS',
  'PROPERTY',
  'BANKING',
  'OTHER',
] as const;
export const DOCUMENT_REJECT_REASONS = [
  'ILLEGIBLE',
  'EXPIRED_DOCUMENT',
  'MISMATCH',
  'INCOMPLETE',
  'WRONG_DOCUMENT',
  'OTHER',
] as const;
/** The file types the scanner can verify by signature. */
export const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

const TypeCode = z.string().regex(/^[A-Z_]{2,40}$/, 'must be an upper-case code');
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'must be a lower-case hex sha256');
const FileName = z
  .string()
  .min(1)
  .max(255)
  .refine((n) => !/[\\/\0]/.test(n), 'must be a plain file name');

// API-DOC-007 / API-DOC-008
export const DocumentTypeSchema = z.object({
  code: TypeCode,
  name: z.string(),
  category: z.enum(DOCUMENT_CATEGORIES),
  allowedMime: z.array(z.string()),
  maxSizeBytes: z.number().int(),
  validityMonths: z.number().int().nullable(),
  sensitivity: z.enum(['S1', 'S2', 'S3']),
  retentionClass: z.string(),
  instructions: z.string().nullable(),
  active: z.boolean(),
  /** false for the platform defaults a tenant has not customised. */
  custom: z.boolean(),
  version: z.number().int().nullable(),
});
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const UpsertDocumentTypeSchema = z.object({
  code: TypeCode,
  name: z.string().min(2).max(120),
  category: z.enum(DOCUMENT_CATEGORIES),
  allowedMime: z.array(z.enum(DOCUMENT_MIME_TYPES)).min(1).optional(),
  maxSizeBytes: z.number().int().min(1024).max(52_428_800).optional(),
  validityMonths: z.number().int().min(1).max(120).nullable().optional(),
  sensitivity: z.enum(['S1', 'S2', 'S3']).optional(),
  retentionClass: z.enum(['R-CFG', 'R-OPS', 'R-LOAN', 'R-FIN', 'R-AUD', 'R-SHORT']).optional(),
  instructions: z.string().max(1000).nullable().optional(),
  active: z.boolean().optional(),
});
export type UpsertDocumentTypeInput = z.infer<typeof UpsertDocumentTypeSchema>;

// API-DOC-001 / API-DOC-002
export const CreateUploadIntentSchema = z.object({
  checklistItemId: z.string().min(1),
  fileName: FileName,
  sizeBytes: z.number().int().positive(),
  mimeType: z.enum(DOCUMENT_MIME_TYPES),
  sha256: Sha256,
});
export type CreateUploadIntentInput = z.infer<typeof CreateUploadIntentSchema>;

export const UploadIntentResponseSchema = z.object({
  uploadIntentId: z.string(),
  method: z.literal('PUT'),
  url: z.string(),
  expiresAt: z.string(),
  requiredHeaders: z.record(z.string()),
});
export type UploadIntentResponse = z.infer<typeof UploadIntentResponseSchema>;

export const CompleteUploadResponseSchema = z.object({
  documentId: z.string(),
  versionId: z.string(),
  scanStatus: z.enum(['PENDING', 'CLEAN', 'QUARANTINED']),
});
export type CompleteUploadResponse = z.infer<typeof CompleteUploadResponseSchema>;

// API-DOC-003
export const DocumentVersionSchema = z.object({
  id: z.string(),
  versionNo: z.number().int(),
  fileName: z.string(),
  sha256: z.string(),
  sizeBytes: z.number().int(),
  detectedMime: z.string(),
  scanStatus: z.enum(['PENDING', 'CLEAN', 'QUARANTINED']),
  reviewStatus: z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'SUPERSEDED', 'EXPIRED']),
  validUntil: z.string().nullable(),
  uploadedBy: z.string(),
  uploadedVia: z.string(),
  createdAt: z.string(),
});
export type DocumentVersion = z.infer<typeof DocumentVersionSchema>;

export const DocumentResourceSchema = z.object({
  id: z.string(),
  ownerType: z.enum(['APPLICATION', 'PARTY', 'CONNECTOR', 'LENDER_CASE']),
  ownerId: z.string(),
  applicationId: z.string().nullable(),
  checklistItemId: z.string().nullable(),
  documentTypeCode: z.string(),
  status: z.enum(['ACTIVE', 'EXPIRED', 'PURGED']),
  currentVersionId: z.string().nullable(),
  versions: z.array(DocumentVersionSchema),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DocumentResource = z.infer<typeof DocumentResourceSchema>;

// API-DOC-006
export const ReviewDocumentVersionSchema = z
  .object({
    decision: z.enum(['ACCEPT', 'REJECT']),
    reasonCode: z.enum(DOCUMENT_REJECT_REASONS).optional(),
    comment: z.string().max(1000).optional(),
    validUntil: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .refine((r) => r.decision !== 'REJECT' || r.reasonCode, {
    message: 'A rejection needs a reasonCode',
    path: ['reasonCode'],
  });
export type ReviewDocumentVersionInput = z.infer<typeof ReviewDocumentVersionSchema>;

// API-DOC-004 / API-DOC-005
export const DocumentLinkRequestSchema = z.object({ purpose: z.string().max(200).optional() });
export const DocumentLinkResponseSchema = z.object({ url: z.string(), expiresAt: z.string() });
export type DocumentLinkResponse = z.infer<typeof DocumentLinkResponseSchema>;

// API-DOC-009
export const DocumentArchiveResponseSchema = z.object({
  archiveId: z.string(),
  status: z.enum(['QUEUED', 'READY', 'FAILED']),
  documentCount: z.number().int(),
  url: z.string().nullable(),
  expiresAt: z.string().nullable(),
});
export type DocumentArchiveResponse = z.infer<typeof DocumentArchiveResponseSchema>;

// Checklist waiver (API-APP-009) lives with the application; listed here because it moves documents' checklist rows.
export const WaiveChecklistItemSchema = z.object({
  checklistItemId: z.string().min(1),
  status: z.enum(['WAIVED', 'NOT_APPLICABLE']),
  reason: z.string().min(5).max(500),
});
export type WaiveChecklistItemInput = z.infer<typeof WaiveChecklistItemSchema>;

// API-PRV-004
export const CreateLegalHoldSchema = z.object({
  subjectType: z.enum(['CUSTOMER', 'LOAN_APPLICATION', 'LEAD', 'DOCUMENT']),
  subjectId: z.string().min(1),
  reason: z.string().min(5).max(1000),
  reference: z.string().max(200).optional(),
});
export type CreateLegalHoldInput = z.infer<typeof CreateLegalHoldSchema>;

export const LegalHoldSchema = z.object({
  id: z.string(),
  subjectType: z.string(),
  subjectId: z.string(),
  reason: z.string(),
  reference: z.string().nullable(),
  placedBy: z.string(),
  placedAt: z.string(),
  releasedAt: z.string().nullable(),
  version: z.number().int(),
});
export type LegalHold = z.infer<typeof LegalHoldSchema>;
