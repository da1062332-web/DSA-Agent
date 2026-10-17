// packages/contracts/src/sanction.ts — owner: Dev 3 (MOD-SND Contracts)
import { z } from 'zod';

export const RateTypeEnum = z.enum(['FIXED', 'FLOATING']);
export type RateType = z.infer<typeof RateTypeEnum>;

export const SanctionStatusEnum = z.enum(['ACTIVE', 'REVISED', 'EXPIRED', 'CANCELLED']);
export type SanctionStatus = z.infer<typeof SanctionStatusEnum>;

export const SanctionSourceEnum = z.enum(['MANUAL', 'LENDER_API', 'EMAIL_PARSED']);
export type SanctionSource = z.infer<typeof SanctionSourceEnum>;

export const TrancheStatusEnum = z.enum(['RECORDED', 'VERIFIED', 'RETURNED', 'VOIDED']);
export type TrancheStatus = z.infer<typeof TrancheStatusEnum>;

export const TrancheDecisionEnum = z.enum(['VERIFY', 'RETURN']);
export type TrancheDecision = z.infer<typeof TrancheDecisionEnum>;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const RecordSanctionRequestSchema = z
  .object({
    amount: z.number().positive('amount must be greater than 0'),
    tenureMonths: z.number().int().min(1, 'tenureMonths must be at least 1'),
    rateValue: z.number().positive('rateValue must be positive'),
    rateType: RateTypeEnum,
    benchmarkText: z.string().max(200).nullable().optional(),
    feesText: z.string().max(500).nullable().optional(),
    conditions: z.array(z.string().max(500)).default([]),
    sanctionDate: z.string().regex(DATE_REGEX, 'sanctionDate must be YYYY-MM-DD'),
    validUntil: z.string().regex(DATE_REGEX, 'validUntil must be YYYY-MM-DD'),
    letterDocumentId: z.string().nullable().optional(),
    source: SanctionSourceEnum.default('MANUAL'),
  })
  .refine((data) => data.validUntil >= data.sanctionDate, {
    message: 'validUntil must be on or after sanctionDate',
    path: ['validUntil'],
  });

export type RecordSanctionRequest = z.infer<typeof RecordSanctionRequestSchema>;

export const CancelSanctionRequestSchema = z.object({
  reason: z.string().min(3, 'cancellation reason must be at least 3 characters').max(1000),
});
export type CancelSanctionRequest = z.infer<typeof CancelSanctionRequestSchema>;

export const RecordTrancheRequestSchema = z.object({
  amount: z.number().positive('amount must be greater than 0'),
  currency: z.string().length(3).default('INR'),
  disbursedOn: z.string().regex(DATE_REGEX, 'disbursedOn must be YYYY-MM-DD'),
  utr: z.string().max(100).nullable().optional(),
  loanAccountNumber: z.string().max(100).nullable().optional(),
  evidenceDocumentId: z.string().nullable().optional(),
});
export type RecordTrancheRequest = z.infer<typeof RecordTrancheRequestSchema>;

export const VerifyTrancheRequestSchema = z
  .object({
    decision: TrancheDecisionEnum,
    comment: z.string().max(1000).nullable().optional(),
  })
  .refine(
    (data) =>
      data.decision !== 'RETURN' ||
      (data.comment !== null && data.comment !== undefined && data.comment.trim().length > 0),
    {
      message: 'comment is required when returning a tranche',
      path: ['comment'],
    },
  );
export type VerifyTrancheRequest = z.infer<typeof VerifyTrancheRequestSchema>;

export const ExceptionApprovalRequestSchema = z.object({
  reason: z.string().min(5, 'exception reason must be at least 5 characters').max(1000),
});
export type ExceptionApprovalRequest = z.infer<typeof ExceptionApprovalRequestSchema>;

export const VoidTrancheRequestSchema = z.object({
  reason: z.string().min(5, 'void reason must be at least 5 characters').max(1000),
  createReplacement: z.boolean().default(false),
  replacement: RecordTrancheRequestSchema.optional(),
});
export type VoidTrancheRequest = z.infer<typeof VoidTrancheRequestSchema>;

export interface SanctionDto {
  id: string;
  tenantId: string;
  lenderCaseId: string;
  version: number;
  amount: number;
  tenureMonths: number;
  rateValue: number;
  rateType: RateType;
  benchmarkText: string | null;
  feesText: string | null;
  conditions: string[];
  sanctionDate: string;
  validUntil: string;
  letterDocumentId: string | null;
  status: SanctionStatus;
  source: SanctionSource;
  cancelReason: string | null;
  lockVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface DisbursementTrancheDto {
  id: string;
  tenantId: string;
  sanctionId: string;
  trancheNo: number;
  amount: number;
  currency: string;
  disbursedOn: string;
  utrMasked: string | null;
  loanAccountMasked: string | null;
  evidenceDocumentId: string | null;
  status: TrancheStatus;
  recordedBy: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  verificationComment: string | null;
  exceptionApprovalId: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  replacedByTrancheId: string | null;
  lockVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

/**
 * Masks banking / financial identifiers for safe display without exposing full plaintext or ciphertext.
 * Retains only the last 4 characters if length > 4.
 */
export function maskFinancialIdentifier(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length <= 4) return 'XXXX';
  const lastFour = trimmed.slice(-4);
  return `XXXX-XXXX-${lastFour}`;
}
