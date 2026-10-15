// packages/contracts/src/commission.ts — owner: Developer 5 (Bhushan) (MOD-COM / Module 30 Part A)
import { z } from 'zod';
import { IdSchema } from './ids';

export const QUALIFYING_EVENTS = ['DISBURSEMENT', 'SANCTION', 'FIRST_EMI'] as const;
export type QualifyingEvent = (typeof QUALIFYING_EVENTS)[number];

export const COMMISSION_BASES = ['DISBURSED_AMOUNT', 'SANCTION_AMOUNT', 'NET_LOAN'] as const;
export type CommissionBasis = (typeof COMMISSION_BASES)[number];

export const COMMISSION_PLAN_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'RETIRED'] as const;
export type CommissionPlanStatus = (typeof COMMISSION_PLAN_STATUSES)[number];

export const CALCULATION_KINDS = ['PROJECTED', 'EARNED'] as const;
export type CalculationKind = (typeof CALCULATION_KINDS)[number];

export const CALCULATION_STATUSES = [
  'PROJECTED',
  'EARNED',
  'ACCRUED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CLOSED',
  'DISPUTED',
  'REVERSED',
  'SUPERSEDED',
] as const;
export type CalculationStatus = (typeof CALCULATION_STATUSES)[number];

export const PAYABLE_STATES = [
  'ACCRUED',
  'ON_HOLD',
  'ELIGIBLE',
  'IN_PAYOUT',
  'APPROVED',
  'PAID',
  'REVERSED',
] as const;
export type PayableState = (typeof PAYABLE_STATES)[number];

export const ADJUSTMENT_TYPES = ['WRITE_OFF', 'CLAWBACK', 'CORRECTION', 'TAX', 'MANUAL'] as const;
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

export const CreateCommissionPlanInputSchema = z.object({
  lenderId: IdSchema('lnd'),
  qualifyingEvent: z.enum(QUALIFYING_EVENTS).default('DISBURSEMENT'),
  basis: z.enum(COMMISSION_BASES).default('DISBURSED_AMOUNT'),
  roundingMode: z.string().default('ROUND_HALF_UP'),
  clawbackWindowDays: z.number().int().min(0).default(90),
  defaultRate: z.number().min(0).max(1).default(0.015), // e.g. 1.5%
  ruleSetId: z.string().optional().nullable(),
  status: z.enum(COMMISSION_PLAN_STATUSES).default('DRAFT'),
});
export type CreateCommissionPlanInput = z.input<typeof CreateCommissionPlanInputSchema>;

export const UpdateCommissionPlanInputSchema = z.object({
  qualifyingEvent: z.enum(QUALIFYING_EVENTS).optional(),
  basis: z.enum(COMMISSION_BASES).optional(),
  roundingMode: z.string().optional(),
  clawbackWindowDays: z.number().int().min(0).optional(),
  status: z.enum(COMMISSION_PLAN_STATUSES).optional(),
});
export type UpdateCommissionPlanInput = z.infer<typeof UpdateCommissionPlanInputSchema>;

export const ApproveCommissionPlanInputSchema = z.object({
  comment: z.string().max(255).optional(),
});
export type ApproveCommissionPlanInput = z.infer<typeof ApproveCommissionPlanInputSchema>;

export const CommissionPlanResponseSchema = z.object({
  id: IdSchema('cpl'),
  lenderId: IdSchema('lnd'),
  qualifyingEvent: z.enum(QUALIFYING_EVENTS),
  basis: z.enum(COMMISSION_BASES),
  roundingMode: z.string(),
  clawbackWindowDays: z.number().int(),
  ruleSetId: z.string().nullable(),
  status: z.enum(COMMISSION_PLAN_STATUSES),
  lockVersion: z.number().int(),
  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type CommissionPlanResponse = z.infer<typeof CommissionPlanResponseSchema>;

export const CalculateCommissionInputSchema = z.object({
  lenderId: IdSchema('lnd'),
  trancheId: z.string(),
  applicationId: z.string().optional().nullable(),
  lenderCaseId: z.string().optional().nullable(),
  connectorId: z.string().optional().nullable(),
  eventDate: z.string().default(() => new Date().toISOString().slice(0, 10)),
  basisAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.string().length(3).default('INR'),
  customRate: z.number().min(0).max(1).optional(),
  connectorShareRate: z.number().min(0).max(1).default(0.7), // 70% split by default
});
export type CalculateCommissionInput = z.input<typeof CalculateCommissionInputSchema>;

export const CommissionCalculationResponseSchema = z.object({
  id: IdSchema('ccal'),
  lenderId: IdSchema('lnd'),
  trancheId: z.string(),
  applicationId: z.string().nullable(),
  lenderCaseId: z.string().nullable(),
  eventDate: z.string(),
  basisAmount: z.string(),
  rate: z.string(),
  rateType: z.string(),
  grossAmount: z.string(),
  currency: z.string(),
  calcKind: z.enum(CALCULATION_KINDS),
  status: z.enum(CALCULATION_STATUSES),
  lockVersion: z.number().int(),
  createdAt: z.string(),
  createdBy: z.string(),
});
export type CommissionCalculationResponse = z.infer<typeof CommissionCalculationResponseSchema>;

export const CommissionPayableResponseSchema = z.object({
  id: IdSchema('cpay'),
  calculationId: IdSchema('ccal'),
  connectorId: z.string(),
  shareRate: z.string(),
  amount: z.string(),
  currency: z.string(),
  state: z.enum(PAYABLE_STATES),
  holdReasons: z.unknown().nullable(),
  lockVersion: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CommissionPayableResponse = z.infer<typeof CommissionPayableResponseSchema>;

export const CreateClawbackInputSchema = z.object({
  calculationId: IdSchema('ccal').optional(),
  payableId: IdSchema('cpay').optional(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  reason: z.string().min(5).max(255),
  evidenceRef: z.string().max(255).optional(),
});
export type CreateClawbackInput = z.infer<typeof CreateClawbackInputSchema>;

export const RejectClawbackInputSchema = z.object({
  reason: z.string().min(3).max(255),
});
export type RejectClawbackInput = z.infer<typeof RejectClawbackInputSchema>;

export const AdjustmentResponseSchema = z.object({
  id: IdSchema('adj'),
  adjustmentType: z.enum(ADJUSTMENT_TYPES),
  type: z.string().optional(),
  calculationId: z.string().nullable(),
  payableId: z.string().nullable(),
  exceptionId: z.string().nullable().optional(),
  amount: z.string(),
  reason: z.string(),
  evidenceRef: z.string().nullable(),
  journalId: z.string().nullable().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  createdAt: z.string(),
  createdBy: z.string(),
  approvedAt: z.string().nullable(),
  approvedBy: z.string().nullable(),
});
export type AdjustmentResponse = z.infer<typeof AdjustmentResponseSchema>;

export const CreateRecalculationProposalInputSchema = z.object({
  reason: z.string().min(5).max(255),
  affectedCalculationIds: z.array(IdSchema('ccal')).min(1),
  preview: z.record(z.unknown()).default({}),
});
export type CreateRecalculationProposalInput = z.infer<typeof CreateRecalculationProposalInputSchema>;

export const ApproveRecalculationProposalInputSchema = z.object({
  comment: z.string().max(255).optional(),
});
export type ApproveRecalculationProposalInput = z.infer<typeof ApproveRecalculationProposalInputSchema>;

export const RecalculationProposalResponseSchema = z.object({
  id: IdSchema('recp'),
  reason: z.string(),
  affectedCalculationIds: z.array(z.string()),
  preview: z.record(z.unknown()),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  lockVersion: z.number().int(),
  createdAt: z.string(),
  createdBy: z.string(),
});
export type RecalculationProposalResponse = z.infer<typeof RecalculationProposalResponseSchema>;

