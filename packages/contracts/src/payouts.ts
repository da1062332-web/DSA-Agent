// packages/contracts/src/payouts.ts — owner: Developer 5 (Bhushan) (MOD-PAY / Module 30 Part B)
import { z } from 'zod';
import { IdSchema } from './ids';

export const PAYOUT_ORIGINS = ['CONNECTOR', 'FINANCE'] as const;
export type PayoutOrigin = (typeof PAYOUT_ORIGINS)[number];

export const PAYOUT_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'PAYMENT_RECORDED',
  'PAYMENT_FAILED',
  'RECONCILED',
] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const CreatePayoutRequestInputSchema = z.object({
  connectorId: z.string().min(1),
  origin: z.enum(PAYOUT_ORIGINS).default('FINANCE'),
  payableIds: z.array(IdSchema('cpay')).min(1),
  retryOfPayoutId: IdSchema('prq').optional(),
});
export type CreatePayoutRequestInput = z.infer<typeof CreatePayoutRequestInputSchema>;

export const PayoutLineResponseSchema = z.object({
  id: IdSchema('pln'),
  payoutId: IdSchema('prq'),
  payableId: IdSchema('cpay'),
  amount: z.string(),
  currency: z.string(),
  status: z.string(),
  createdAt: z.string(),
});
export type PayoutLineResponse = z.infer<typeof PayoutLineResponseSchema>;

export const PayoutRequestResponseSchema = z.object({
  id: IdSchema('prq'),
  connectorId: z.string(),
  origin: z.enum(PAYOUT_ORIGINS),
  status: z.enum(PAYOUT_STATUSES),
  total: z.string(),
  currency: z.string(),
  paymentRefMasked: z.string().nullable(),
  paidOn: z.string().nullable(),
  failureReason: z.string().nullable(),
  retryOfPayoutId: z.string().nullable().optional(),
  submittedBy: z.string().nullable(),
  submittedAt: z.string().nullable(),
  lines: z.array(PayoutLineResponseSchema).optional(),
  lockVersion: z.number().int(),
  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type PayoutRequestResponse = z.infer<typeof PayoutRequestResponseSchema>;

export const PayoutApprovalInputSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().max(255).optional(),
});
export type PayoutApprovalInput = z.infer<typeof PayoutApprovalInputSchema>;

export const PayoutApprovalResponseSchema = z.object({
  id: z.string(),
  payoutId: IdSchema('prq'),
  approverId: z.string(),
  seat: z.string(),
  decision: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().nullable(),
  status: z.enum(PAYOUT_STATUSES),
  total: z.string(),
  lineCount: z.number().int(),
  approvedAt: z.string(),
});
export type PayoutApprovalResponse = z.infer<typeof PayoutApprovalResponseSchema>;

export const CancelPayoutRequestInputSchema = z.object({
  reason: z.string().max(255).optional(),
});
export type CancelPayoutRequestInput = z.infer<typeof CancelPayoutRequestInputSchema>;

export const RecordPaymentInputSchema = z.object({
  paymentRef: z.string().min(4).max(64), // e.g. UTR number
  paidOn: z.string().default(() => new Date().toISOString()),
});
export type RecordPaymentInput = z.infer<typeof RecordPaymentInputSchema>;

export const RecordPaymentFailureInputSchema = z.object({
  failureReason: z.string().min(3).max(255),
});
export type RecordPaymentFailureInput = z.infer<typeof RecordPaymentFailureInputSchema>;

export const CreatePayoutBatchInputSchema = z.object({
  payoutIds: z.array(IdSchema('prq')).min(1),
});
export type CreatePayoutBatchInput = z.infer<typeof CreatePayoutBatchInputSchema>;

export const PayoutBatchResponseSchema = z.object({
  id: IdSchema('pbt'),
  payoutIds: z.array(z.string()),
  fileObjectKey: z.string().nullable(),
  fileSha256: z.string().nullable(),
  status: z.enum(['GENERATED', 'DOWNLOADED', 'PROCESSED']),
  generatedBy: z.string(),
  generatedAt: z.string(),
});
export type PayoutBatchResponse = z.infer<typeof PayoutBatchResponseSchema>;
