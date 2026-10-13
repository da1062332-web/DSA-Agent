// packages/contracts/src/verification.ts
// Module 22: Verification (MOD-VER) — SUB-VER.01, SUB-VER.02, SUB-VER.03
import { z } from 'zod';
import { IdSchema } from './ids';
import { CursorQuery, listResponse } from './pagination';

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

export const VERIFICATION_RESULTS = [
  'VERIFIED',
  'REJECTED',
  'FLAGGED',
  'INCONCLUSIVE',
] as const;
export type VerificationResult = (typeof VERIFICATION_RESULTS)[number];

export const VERIFICATION_SUBJECT_TYPES = [
  'CUSTOMER',
  'LOAN_APPLICATION',
  'LEAD',
] as const;
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
  rawPayloadHash: z.string().regex(/^[a-f0-9]{64}$/, 'Must be a 64-char SHA-256 hexadecimal hash').optional(),
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
