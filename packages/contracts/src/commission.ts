// packages/contracts/src/commission.ts — owner: Developer 5 (Bhushan) (MOD-COM / Module 30 Part A)
import { z } from 'zod';
import { IdSchema } from './ids';
import { LOAN_CATEGORIES } from './products';

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

/**
 * Whether the DSA charges GST on its commission invoice, or the lender pays it under reverse charge.
 *
 * Notification 13/2017-Central Tax (Rate) Sl. No. 11 puts services supplied by an individual DSA (explicitly not a body
 * corporate, partnership or LLP) to a bank or NBFC under reverse charge: the lender accounts for the tax and the DSA's
 * invoice carries no GST. A company, partnership or LLP DSA charges GST itself under forward charge. Which applies
 * follows from the tenant's `organisation.constitution`, and is confirmed per tenant by the project owner with
 * compliance (plan sections 11 and 12.6) rather than inferred in code.
 */
export const COMMISSION_TAX_TREATMENTS = ['FORWARD_CHARGE', 'RCM_RECIPIENT_PAYS'] as const;
export type CommissionTaxTreatment = (typeof COMMISSION_TAX_TREATMENTS)[number];

export const CreateCommissionPlanInputSchema = z.object({
  lenderId: IdSchema('lnd'),
  qualifyingEvent: z.enum(QUALIFYING_EVENTS).default('DISBURSEMENT'),
  basis: z.enum(COMMISSION_BASES).default('DISBURSED_AMOUNT'),
  roundingMode: z.string().default('ROUND_HALF_UP'),
  clawbackWindowDays: z.number().int().min(0).default(90),
  defaultRate: z.number().min(0).max(1).default(0.015), // e.g. 1.5%
  ruleSetId: z.string().optional().nullable(),
  /**
   * @deprecated Only DRAFT is accepted here, and a plan is made ACTIVE only through POST /v1/commission-plans/{id}/approval. Any other value
   * is refused with 422 USE_APPROVAL_ROUTE. The field is kept as a shim for one release, then removed (Contracts §15).
   */
  status: z.enum(COMMISSION_PLAN_STATUSES).default('DRAFT'),
});
export type CreateCommissionPlanInput = z.input<typeof CreateCommissionPlanInputSchema>;

export const UpdateCommissionPlanInputSchema = z.object({
  qualifyingEvent: z.enum(QUALIFYING_EVENTS).optional(),
  basis: z.enum(COMMISSION_BASES).optional(),
  roundingMode: z.string().optional(),
  clawbackWindowDays: z.number().int().min(0).optional(),
  /**
   * @deprecated Never accepted by PATCH. Any value is refused with 422 USE_APPROVAL_ROUTE; activation and retirement have their own routes.
   * The field is kept as a shim for one release, then removed (Contracts §15).
   */
  status: z.enum(COMMISSION_PLAN_STATUSES).optional(),
});
export type UpdateCommissionPlanInput = z.infer<typeof UpdateCommissionPlanInputSchema>;

export const ApproveCommissionPlanInputSchema = z.object({
  comment: z.string().max(255).optional(),
});
export type ApproveCommissionPlanInput = z.infer<typeof ApproveCommissionPlanInputSchema>;

/** Retiring an ACTIVE plan stops it from being used for new calculations. The reason is kept in the audit trail. */
export const RetireCommissionPlanInputSchema = z.object({
  reason: z.string().trim().min(5, 'A reason of at least 5 characters is needed.').max(255),
});
export type RetireCommissionPlanInput = z.infer<typeof RetireCommissionPlanInputSchema>;

export const CommissionPlanResponseSchema = z.object({
  id: IdSchema('cpl'),
  lenderId: IdSchema('lnd'),
  qualifyingEvent: z.enum(QUALIFYING_EVENTS),
  basis: z.enum(COMMISSION_BASES),
  roundingMode: z.string(),
  clawbackWindowDays: z.number().int(),
  ruleSetId: z.string().nullable(),
  // P2-01: how the lender invoice is taxed, and the rates it uses. Rates are basis points (1800 = 18.00%).
  taxTreatment: z.enum(COMMISSION_TAX_TREATMENTS),
  gstRateBps: z.number().int(),
  tdsRateBps: z.number().int(),
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
  // No schema default: a date computed at generation time made the OpenAPI document change on every run (CI-03). The service uses today.
  eventDate: z.string().optional(),
  basisAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.string().length(3).default('INR'),
  customRate: z.number().min(0).max(1).optional(),
  connectorShareRate: z.number().min(0).max(1).default(0.7), // 70% split by default
  // P2-01. Both optional: the manual correction route may omit them, and customRate still overrides the slab.
  productCategory: z.enum(LOAN_CATEGORIES).optional(),
  slabId: z.string().optional().nullable(),
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
  /** P2-01: the slab that produced the rate. null for a custom rate and for calculations made before slabs existed. */
  slabId: z.string().nullable(),
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

// --- P2-01 commission volume slabs (owner: Devyani; migration 0141) -------------------------------------------------
// Lenders pay on monthly disbursed volume per product category, not on a single rate. These schemas describe that grid.
// Reviewed by Vaibhav as a contracts change (plan section 10).

/** Amounts in this module are bare decimal strings, matching basisAmount above rather than the Money object. */
const SlabAmountSchema = z.string().regex(/^\d+(\.\d{1,2})?$/);

export const CreateCommissionPlanSlabInputSchema = z
  .object({
    productCategory: z.enum(LOAN_CATEGORIES),
    /** Inclusive lower bound of the monthly volume band. */
    volumeFrom: SlabAmountSchema.default('0'),
    /** Exclusive upper bound, or null on the open-ended top band. Bands therefore tile without overlapping. */
    volumeTo: SlabAmountSchema.nullable().optional(),
    /** 100 bps = 1.00%. Give this or flatAmount, never both. */
    rateBps: z.number().int().min(0).max(100000).nullable().optional(),
    /** A fixed amount per qualifying event. Give this or rateBps, never both. */
    flatAmount: SlabAmountSchema.nullable().optional(),
    effectiveFrom: z.string(),
    effectiveTo: z.string().nullable().optional(),
  })
  .refine((v) => (v.rateBps === null || v.rateBps === undefined) !== (v.flatAmount === null || v.flatAmount === undefined), {
    message: 'Give exactly one of rateBps or flatAmount.',
    path: ['rateBps'],
  })
  .refine((v) => v.volumeTo == null || Number(v.volumeTo) > Number(v.volumeFrom ?? '0'), {
    message: 'volumeTo must be greater than volumeFrom.',
    path: ['volumeTo'],
  });
export type CreateCommissionPlanSlabInput = z.input<typeof CreateCommissionPlanSlabInputSchema>;

export const UpdateCommissionPlanSlabInputSchema = z.object({
  volumeFrom: SlabAmountSchema.optional(),
  volumeTo: SlabAmountSchema.nullable().optional(),
  rateBps: z.number().int().min(0).max(100000).nullable().optional(),
  flatAmount: SlabAmountSchema.nullable().optional(),
  effectiveFrom: z.string().optional(),
  effectiveTo: z.string().nullable().optional(),
});
export type UpdateCommissionPlanSlabInput = z.infer<typeof UpdateCommissionPlanSlabInputSchema>;

export const CommissionPlanSlabResponseSchema = z.object({
  id: IdSchema('cslb'),
  planId: IdSchema('cpl'),
  productCategory: z.enum(LOAN_CATEGORIES),
  volumeFrom: z.string(),
  volumeTo: z.string().nullable(),
  rateBps: z.number().int().nullable(),
  flatAmount: z.string().nullable(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  lockVersion: z.number().int(),
  createdAt: z.string(),
  createdBy: z.string(),
});
export type CommissionPlanSlabResponse = z.infer<typeof CommissionPlanSlabResponseSchema>;

/** The slab editor's preview: "10,00,000 disbursed this month in PL -> 1.20% -> 12,000". No write, no clock of its own. */
export const SlabPreviewInputSchema = z.object({
  productCategory: z.enum(LOAN_CATEGORIES),
  monthlyVolume: SlabAmountSchema,
  basisAmount: SlabAmountSchema,
  asOf: z.string().optional(),
});
export type SlabPreviewInput = z.infer<typeof SlabPreviewInputSchema>;

export const SlabPreviewResponseSchema = z.object({
  slabId: z.string().nullable(),
  /** null when no band covers that volume on that date: the caller shows "no slab matches", never a fallback rate. */
  rateBps: z.number().int().nullable(),
  flatAmount: z.string().nullable(),
  grossAmount: z.string().nullable(),
  currency: z.string(),
  matched: z.boolean(),
});
export type SlabPreviewResponse = z.infer<typeof SlabPreviewResponseSchema>;
