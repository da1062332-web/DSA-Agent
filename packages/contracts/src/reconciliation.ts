// packages/contracts/src/reconciliation.ts — MOD-REC Reconciliation Management
import { z } from 'zod';
import { IdSchema } from './ids';
import { ADJUSTMENT_TYPES, type AdjustmentType } from './commission';

export const MATCH_TYPES = ['EXACT', 'PARTIAL', 'VARIANCE', 'UNMATCHED', 'DUPLICATE'] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

export const MATCH_STATUSES = ['ACTIVE', 'SUPERSEDED', 'REVOKED'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const EXCEPTION_CLASSIFICATIONS = [
  'SHORT_REMITTANCE',
  'OVER_REMITTANCE',
  'MISSING_REMITTANCE',
  'UNMATCHED_STATEMENT_LINE',
  'DUPLICATE_REMITTANCE',
  'TIMING_DIFFERENCE',
] as const;
export type ExceptionClassification = (typeof EXCEPTION_CLASSIFICATIONS)[number];

export const EXCEPTION_STATUSES = ['OPEN', 'INVESTIGATING', 'RESOLVED', 'WRITTEN_OFF'] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];

export const FINANCIAL_DISPUTE_PARTY_TYPES = ['LENDER', 'CONNECTOR'] as const;
export type FinancialDisputePartyType = (typeof FINANCIAL_DISPUTE_PARTY_TYPES)[number];

export const FINANCIAL_DISPUTE_SUBJECT_TYPES = ['STATEMENT_LINE', 'PAYOUT', 'CALCULATION'] as const;
export type FinancialDisputeSubjectType = (typeof FINANCIAL_DISPUTE_SUBJECT_TYPES)[number];

export const FINANCIAL_DISPUTE_STATUSES = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED', 'WITHDRAWN'] as const;
export type FinancialDisputeStatus = (typeof FINANCIAL_DISPUTE_STATUSES)[number];

// SUB-REC.01: Statement Ingestion
export const ImportStatementLineInputSchema = z.object({
  loanAccount: z.string().min(1, 'Loan account number required'),
  customerName: z.string().min(1, 'Customer name required'),
  disbursedAmount: z.number().positive('Disbursed amount must be positive'),
  commissionAmount: z.number().nonnegative('Commission amount must be non-negative'),
  taxDeducted: z.number().nonnegative('Tax deducted must be non-negative').optional().default(0),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'paidOn must be YYYY-MM-DD'),
  rawRowRef: z.string().optional(),
});
export type ImportStatementLineInput = z.input<typeof ImportStatementLineInputSchema>;

export const ImportLenderStatementInputSchema = z.object({
  lenderId: z.string().min(1, 'lenderId required'),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'period must be YYYY-MM format'),
  sourceFileKey: z.string().min(1, 'sourceFileKey required'),
  importBatchId: z.string().min(1, 'importBatchId required'),
  fileSha256: z.string().min(64).max(64, 'fileSha256 must be 64-char SHA-256 hex string'),
  lines: z.array(ImportStatementLineInputSchema).min(1, 'Statement must contain at least one line'),
});
export type ImportLenderStatementInput = z.input<typeof ImportLenderStatementInputSchema>;

export const LenderStatementLineResponseSchema = z.object({
  id: IdSchema('stl'),
  statementId: IdSchema('stm'),
  loanAccountHash: z.string(),
  customerNameMasked: z.string(),
  disbursedAmount: z.number(),
  commissionAmount: z.number(),
  taxDeducted: z.number(),
  paidOn: z.string(),
  rawRowRef: z.string().nullable(),
  status: z.enum(['UNMATCHED', 'MATCHED', 'EXCEPTION', 'DISPUTED']),
  createdAt: z.string(),
});
export type LenderStatementLineResponse = z.infer<typeof LenderStatementLineResponseSchema>;

export const LenderStatementResponseSchema = z.object({
  id: IdSchema('stm'),
  lenderId: z.string(),
  period: z.string(),
  sourceFileKey: z.string(),
  importBatchId: z.string(),
  fileSha256: z.string(),
  totals: z.object({
    totalDisbursed: z.number(),
    totalCommission: z.number(),
    totalTaxDeducted: z.number(),
    netCommission: z.number(),
    lineCount: z.number(),
  }),
  status: z.enum(['IMPORTED', 'MATCHED', 'PARTIALLY_MATCHED', 'RECONCILED', 'FAILED']),
  createdAt: z.string(),
  createdBy: z.string(),
  lines: z.array(LenderStatementLineResponseSchema).optional(),
});
export type LenderStatementResponse = z.infer<typeof LenderStatementResponseSchema>;

// SUB-REC.02: Commission Matching
export const ReconciliationMatchResponseSchema = z.object({
  id: IdSchema('rmt'),
  statementLineId: IdSchema('stl'),
  calculationId: IdSchema('ccal'),
  matchType: z.enum(MATCH_TYPES),
  matchedAmount: z.number(),
  decisionRecordId: z.string().nullable(),
  status: z.enum(MATCH_STATUSES),
  createdAt: z.string(),
  createdBy: z.string(),
});
export type ReconciliationMatchResponse = z.infer<typeof ReconciliationMatchResponseSchema>;

// SUB-REC.03: Exceptions & Adjustments
export const ReconciliationExceptionResponseSchema = z.object({
  id: IdSchema('rex'),
  statementLineId: IdSchema('stl').nullable(),
  calculationId: IdSchema('ccal').nullable(),
  varianceAmount: z.number(),
  classification: z.enum(EXCEPTION_CLASSIFICATIONS),
  status: z.enum(EXCEPTION_STATUSES),
  ownerUserId: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  resolutionNote: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  resolvedBy: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string(),
});
export type ReconciliationExceptionResponse = z.infer<typeof ReconciliationExceptionResponseSchema>;

export const ListExceptionsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(EXCEPTION_STATUSES).optional(),
  classification: z.enum(EXCEPTION_CLASSIFICATIONS).optional(),
});
export type ListExceptionsQuery = z.infer<typeof ListExceptionsQuerySchema>;

export const ResolveExceptionInputSchema = z.object({
  status: z.enum(['RESOLVED', 'WRITTEN_OFF', 'INVESTIGATING']),
  classification: z.enum(EXCEPTION_CLASSIFICATIONS).optional(),
  resolutionNote: z.string().min(5, 'Resolution note must be at least 5 characters'),
  evidenceRef: z.string().optional(),
});
export type ResolveExceptionInput = z.infer<typeof ResolveExceptionInputSchema>;

export const AdjustmentProposalInputSchema = z.object({
  type: z.enum(ADJUSTMENT_TYPES),
  amount: z.number().positive('Adjustment amount must be positive'),
  reason: z.string().min(5, 'Reason must be at least 5 characters'),
  calculationId: IdSchema('ccal').optional(),
  payableId: IdSchema('cpay').optional(),
  exceptionId: IdSchema('rex').optional(),
  evidenceRef: z.string().optional(),
  journalId: z.string().optional(),
});
export type AdjustmentProposalInput = z.infer<typeof AdjustmentProposalInputSchema>;

export const AdjustmentApprovalInputSchema = z.object({
  approved: z.boolean(),
  rejectionReason: z.string().optional(),
});
export type AdjustmentApprovalInput = z.infer<typeof AdjustmentApprovalInputSchema>;

// SUB-REC.04: Financial Disputes
export const CreateFinancialDisputeInputSchema = z.object({
  partyType: z.enum(FINANCIAL_DISPUTE_PARTY_TYPES),
  partyId: z.string().min(1, 'partyId required'),
  subjectType: z.enum(FINANCIAL_DISPUTE_SUBJECT_TYPES),
  subjectId: z.string().min(1, 'subjectId required'),
  reason: z.string().min(10, 'Dispute reason must be at least 10 characters'),
  payableIds: z.array(IdSchema('cpay')).optional(),
});
export type CreateFinancialDisputeInput = z.infer<typeof CreateFinancialDisputeInputSchema>;

export const UpdateFinancialDisputeInputSchema = z.object({
  status: z.enum(FINANCIAL_DISPUTE_STATUSES),
  resolution: z.string().optional(),
  outcomeAdjustmentId: IdSchema('adj').optional(),
  releaseHolds: z.boolean().default(false),
});
export type UpdateFinancialDisputeInput = z.infer<typeof UpdateFinancialDisputeInputSchema>;

export const FinancialDisputeResponseSchema = z.object({
  id: IdSchema('dsp'),
  partyType: z.enum(FINANCIAL_DISPUTE_PARTY_TYPES),
  partyId: z.string(),
  subjectType: z.enum(FINANCIAL_DISPUTE_SUBJECT_TYPES),
  subjectId: z.string(),
  reason: z.string(),
  status: z.enum(FINANCIAL_DISPUTE_STATUSES),
  resolution: z.string().nullable(),
  outcomeAdjustmentId: IdSchema('adj').nullable(),
  lockVersion: z.number(),
  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type FinancialDisputeResponse = z.infer<typeof FinancialDisputeResponseSchema>;

// Aliases for module convenience
export const CreateDisputeInputSchema = CreateFinancialDisputeInputSchema;
export type CreateDisputeInput = CreateFinancialDisputeInput;
export const UpdateDisputeInputSchema = UpdateFinancialDisputeInputSchema;
export type UpdateDisputeInput = UpdateFinancialDisputeInput;
export const DisputeResponseSchema = FinancialDisputeResponseSchema;
export type DisputeResponse = FinancialDisputeResponse;

// SUB-REC.05: Bank Payout Reconciliation
export const BankReconcilePayoutInputSchema = z.object({
  bankReference: z.string().min(4, 'Bank reference required'),
  paidAmount: z.number().positive('Paid amount must be positive'),
  settlementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'settlementDate must be YYYY-MM-DD'),
});
export type BankReconcilePayoutInput = z.infer<typeof BankReconcilePayoutInputSchema>;

// Automated Bank Statement Ingestion Engine (MT940 / CSV Feeds) (MOD-REC / TASK-418)
export const AutoIngestBankFeedInputSchema = z.object({
  lenderId: z.string().min(1, 'lenderId required'),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'period must be YYYY-MM format'),
  format: z.enum(['MT940', 'CSV']).default('MT940'),
  rawFeedContent: z.string().min(10, 'rawFeedContent is required'),
  filename: z.string().optional().default('bank_feed.txt'),
});
export type AutoIngestBankFeedInput = z.infer<typeof AutoIngestBankFeedInputSchema>;

export const AutoIngestBankFeedResponseSchema = z.object({
  statementId: IdSchema('stm'),
  lenderId: z.string(),
  period: z.string(),
  format: z.enum(['MT940', 'CSV']),
  parsedLinesCount: z.number().int(),
  totalDisbursed: z.number(),
  totalCommission: z.number(),
  totalTaxDeducted: z.number(),
  netCommission: z.number(),
  fileSha256: z.string(),
  status: z.enum(['IMPORTED', 'MATCHED', 'PARTIALLY_MATCHED']),
  message: z.string(),
});
export type AutoIngestBankFeedResponse = z.infer<typeof AutoIngestBankFeedResponseSchema>;

