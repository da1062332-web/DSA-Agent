// packages/contracts/src/lender-policy.ts — owner: Dipanshu (lenders, matching) — P1-04 lender policy grid and multi-lender matching.
// Additive (Contracts §15 change log: 2026-11-26 P1-04). Shared by the API (origination/catalogue, origination/applications) and the web
// app (features/lenders, features/applications). Money on the wire is { amount: "899100.00", currency: "INR" }; bre-core works in
// integer paise, and moneyToPaise / paiseToMoney convert at the edge.
import { z } from 'zod';
import { IdSchema } from './ids';
import { ListMeta, CursorQuery } from './pagination';
import { MoneySchema, type Money } from './money';
import { PRODUCT_APPLICANT_TYPES } from './products';

// ---- Enumerations -------------------------------------------------------------------------------------------------------------

export const LENDER_POLICY_STATUSES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
export type LenderPolicyStatus = (typeof LENDER_POLICY_STATUSES)[number];

/** ACTIVATE needs rule.approve, step-up and SOD-01 (maker-checker); RETIRE needs lender_policy.manage. */
export const LENDER_POLICY_ACTIONS = ['ACTIVATE', 'RETIRE'] as const;
export type LenderPolicyAction = (typeof LENDER_POLICY_ACTIONS)[number];

/** The application's applicant_type values, which a policy can allow or exclude. */
// Not EMPLOYMENT_TYPES: that name is the customer-profile list (P1-02), which has more values. A policy filters on applicant_type.
export const LENDER_POLICY_EMPLOYMENT_TYPES = PRODUCT_APPLICANT_TYPES;
export type LenderPolicyEmploymentType = (typeof LENDER_POLICY_EMPLOYMENT_TYPES)[number];

export const LENDER_MATCH_OUTCOMES = ['ELIGIBLE', 'NOT_ELIGIBLE', 'NEEDS_DATA'] as const;
export type LenderMatchOutcomeCode = (typeof LENDER_MATCH_OUTCOMES)[number];

/** Same list, same order as @dsa/bre-core (a bre-core test pins them together). */
export const LENDER_MATCH_REASONS = [
  'POLICY_NOT_EFFECTIVE',
  'BUREAU_SCORE_BELOW_MIN',
  'AGE_BELOW_MIN',
  'AGE_AT_MATURITY_ABOVE_MAX',
  'INCOME_BELOW_MIN',
  'PINCODE_NOT_SERVICEABLE',
  'CONSTITUTION_NOT_ALLOWED',
  'EMPLOYMENT_NOT_ALLOWED',
  'VINTAGE_BELOW_MIN',
  'AMOUNT_BELOW_PRODUCT_MIN',
  'TENURE_OUT_OF_RANGE',
  'FOIR_EXCEEDED',
  'ELIGIBLE_AMOUNT_BELOW_PRODUCT_MIN',
] as const;
export type LenderMatchReason = (typeof LENDER_MATCH_REASONS)[number];

/** Input field names (request body of a match run and `missingFields` of a result). Same list as @dsa/bre-core. */
export const LENDER_MATCH_FIELDS = [
  'requestedAmount',
  'tenureMonths',
  'monthlyIncome',
  'monthlyObligations',
  'ageYears',
  'pincode',
  'bureauScore',
  'collateralValue',
  'employmentType',
  'constitution',
  'vintageMonths',
] as const;
export type LenderMatchField = (typeof LENDER_MATCH_FIELDS)[number];

export const LENDER_MATCH_LIMITS = ['REQUESTED', 'PRODUCT_MAX', 'FOIR', 'LTV'] as const;
export type LenderMatchLimitCode = (typeof LENDER_MATCH_LIMITS)[number];

/** Where a prefilled input came from: the application row, applicant_financial_input, or typed for this run. */
export const LENDER_MATCH_INPUT_SOURCES = [
  'APPLICATION',
  'FINANCIAL_INPUT',
  'ENTERED',
  // Added 2026-11-28 (Bhushan; Contracts §15, additive): the borrower's customer profile, the borrower plus earning co-applicants
  // (income clubbed the way lenders do), and the property pledged on the file.
  'CUSTOMER_PROFILE',
  'CO_APPLICANTS',
  'COLLATERAL',
] as const;
export type LenderMatchInputSource = (typeof LENDER_MATCH_INPUT_SOURCES)[number];

// ---- Money helpers ------------------------------------------------------------------------------------------------------------

/** INR money only: a policy and a match are always in rupees. */
export const InrMoneySchema = MoneySchema.refine((m) => m.currency === 'INR', {
  message: 'currency must be INR',
  path: ['currency'],
});

/** "899100.00" → 89910000 paise. Throws RangeError beyond Number.MAX_SAFE_INTEGER paise (≈ ₹90 lakh crore). */
export function moneyToPaise(money: Money): number {
  const [rupees, paise = '00'] = money.amount.split('.');
  const value = Number(rupees) * 100 + Number(paise.padEnd(2, '0').slice(0, 2));
  if (!Number.isSafeInteger(value)) throw new RangeError('amount is too large');
  return value;
}

/** 89910000 paise → { amount: "899100.00", currency: "INR" }. */
export function paiseToMoney(paise: number): Money {
  if (!Number.isSafeInteger(paise) || paise < 0)
    throw new RangeError('paise must be a non-negative safe integer');
  const rupees = Math.floor(paise / 100);
  return { amount: `${rupees}.${String(paise % 100).padStart(2, '0')}`, currency: 'INR' };
}

// ---- Lender policy ------------------------------------------------------------------------------------------------------------

const Bps = z.number().int().min(0).max(10_000);
const CapBps = z.number().int().min(1).max(10_000);
const IsoInstant = z
  .string()
  .datetime({ offset: false, message: 'must be an ISO 8601 UTC timestamp ending in Z' });
const PincodeEntry = z.string().regex(/^[1-9][0-9]{1,5}$/, 'a 6-digit pincode or a 2–5 digit pincode prefix');
const Constitution = z.string().regex(/^[A-Z][A-Z_]{1,39}$/, 'an upper-case code such as PROPRIETORSHIP');

const PolicyTermsShape = {
  minBureauScore: z.number().int().min(300).max(900).nullable(),
  minAge: z.number().int().min(18).max(100).nullable(),
  maxAgeAtMaturity: z.number().int().min(18).max(100).nullable(),
  minIncome: InrMoneySchema.nullable(),
  foirCapBps: CapBps.nullable(),
  ltvCapBps: CapBps.nullable(),
  rateMinBps: Bps,
  rateMaxBps: Bps,
  processingFeeBps: Bps.nullable(),
  serviceablePincodes: z.array(PincodeEntry).max(2000),
  allowedConstitutions: z.array(Constitution).max(20),
  allowedEmployment: z
    .array(z.enum(LENDER_POLICY_EMPLOYMENT_TYPES))
    .max(LENDER_POLICY_EMPLOYMENT_TYPES.length),
  minVintageMonths: z.number().int().min(0).max(1200).nullable(),
  documentProfileId: z.string().min(1).max(64).nullable(),
  effectiveFrom: IsoInstant,
  effectiveTo: IsoInstant.nullable(),
};

type TermsCheck = {
  rateMinBps?: number;
  rateMaxBps?: number;
  minAge?: number | null;
  maxAgeAtMaturity?: number | null;
  effectiveFrom?: string;
  effectiveTo?: string | null;
};

/** Cross-field rules, checked when both sides are in the body (the database CHECKs cover a PATCH that sends one side). */
function checkTerms(t: TermsCheck, ctx: z.RefinementCtx): void {
  if (t.rateMinBps !== undefined && t.rateMaxBps !== undefined && t.rateMaxBps < t.rateMinBps)
    ctx.addIssue({ code: 'custom', path: ['rateMaxBps'], message: 'must be at least rateMinBps' });
  if (t.minAge != null && t.maxAgeAtMaturity != null && t.maxAgeAtMaturity < t.minAge)
    ctx.addIssue({ code: 'custom', path: ['maxAgeAtMaturity'], message: 'must be at least minAge' });
  if (t.effectiveFrom && t.effectiveTo && Date.parse(t.effectiveTo) <= Date.parse(t.effectiveFrom))
    ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'must be after effectiveFrom' });
}

const withDefaults = {
  ...PolicyTermsShape,
  minBureauScore: PolicyTermsShape.minBureauScore.default(null),
  minAge: PolicyTermsShape.minAge.default(null),
  maxAgeAtMaturity: PolicyTermsShape.maxAgeAtMaturity.default(null),
  minIncome: PolicyTermsShape.minIncome.default(null),
  foirCapBps: PolicyTermsShape.foirCapBps.default(null),
  ltvCapBps: PolicyTermsShape.ltvCapBps.default(null),
  processingFeeBps: PolicyTermsShape.processingFeeBps.default(null),
  serviceablePincodes: PolicyTermsShape.serviceablePincodes.default([]),
  allowedConstitutions: PolicyTermsShape.allowedConstitutions.default([]),
  allowedEmployment: PolicyTermsShape.allowedEmployment.default([]),
  minVintageMonths: PolicyTermsShape.minVintageMonths.default(null),
  documentProfileId: PolicyTermsShape.documentProfileId.default(null),
  effectiveTo: PolicyTermsShape.effectiveTo.default(null),
};

/** POST /v1/lender-policies — a new DRAFT version for a lender and product version (Idempotency-Key). */
export const LenderPolicyCreateSchema = z
  .object({ lenderId: IdSchema('lnd'), productVersionId: IdSchema('prv'), ...withDefaults })
  .strict()
  .superRefine(checkTerms);
export type LenderPolicyCreate = z.infer<typeof LenderPolicyCreateSchema>;

/** PATCH /v1/lender-policies/{id} — edits a DRAFT only (If-Match). Lender and product version never change. */
export const LenderPolicyPatchSchema = z
  .object(PolicyTermsShape)
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'send at least one field' })
  .superRefine(checkTerms);
export type LenderPolicyPatch = z.infer<typeof LenderPolicyPatchSchema>;

/** POST /v1/lender-policies/{id}/transitions (If-Match). */
export const LenderPolicyTransitionSchema = z.object({ action: z.enum(LENDER_POLICY_ACTIONS) }).strict();
export type LenderPolicyTransition = z.infer<typeof LenderPolicyTransitionSchema>;

/** GET /v1/lender-policies — allow-listed filters (Contracts §5). */
export const LenderPolicyListQuerySchema = CursorQuery.extend({
  lenderId: IdSchema('lnd').optional(),
  productVersionId: IdSchema('prv').optional(),
  status: z.enum(LENDER_POLICY_STATUSES).optional(),
}).strict();
export type LenderPolicyListQuery = z.infer<typeof LenderPolicyListQuerySchema>;

export const LenderPolicySchema = z.object({
  id: IdSchema('lpo'),
  lenderId: IdSchema('lnd'),
  productVersionId: IdSchema('prv'),
  status: z.enum(LENDER_POLICY_STATUSES),
  versionNo: z.number().int().min(1),
  ...PolicyTermsShape,
  /** Who drafted or edited this version (the approver must not be one of them: SOD-01). */
  editors: z.array(z.string()),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  retiredAt: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type LenderPolicy = z.infer<typeof LenderPolicySchema>;

export const LenderPolicyListSchema = z.object({ data: z.array(LenderPolicySchema), meta: ListMeta });
export type LenderPolicyList = z.infer<typeof LenderPolicyListSchema>;

// ---- Multi-lender matching ----------------------------------------------------------------------------------------------------

const InputsShape = {
  requestedAmount: InrMoneySchema.nullable(),
  tenureMonths: z.number().int().min(1).max(480).nullable(),
  monthlyIncome: InrMoneySchema.nullable(),
  monthlyObligations: InrMoneySchema.nullable(),
  ageYears: z.number().int().min(18).max(100).nullable(),
  pincode: z
    .string()
    .regex(/^[1-9][0-9]{5}$/, 'a 6-digit pincode')
    .nullable(),
  bureauScore: z.number().int().min(300).max(900).nullable(),
  collateralValue: InrMoneySchema.nullable(),
  employmentType: z.enum(LENDER_POLICY_EMPLOYMENT_TYPES).nullable(),
  constitution: Constitution.nullable(),
  vintageMonths: z.number().int().min(0).max(1200).nullable(),
};

/** The inputs a run used (or would use): every field, null when unknown. */
export const LenderMatchInputsSchema = z.object(InputsShape);
export type LenderMatchInputValues = z.infer<typeof LenderMatchInputsSchema>;

/**
 * POST /v1/applications/{id}/lender-matches (Idempotency-Key). Every field is optional: a field that is sent replaces the
 * prefilled value for this run (null clears it); a field that is left out keeps the prefilled value.
 */
export const LenderMatchRunRequestSchema = z.object(InputsShape).partial().strict();
export type LenderMatchRunRequest = z.infer<typeof LenderMatchRunRequestSchema>;

/**
 * One borrower's line in the income working (2026-11-28). Lenders club the income of the borrower and the earning co-applicants and
 * count everyone's existing EMIs; a guarantor's income and EMIs are shown but not counted.
 */
export const BorrowerIncomeLineSchema = z.object({
  customerId: z.string(),
  role: z.enum(['PRIMARY', 'CO_APPLICANT', 'GUARANTOR']),
  relationshipToPrimary: z.string().nullable(),
  monthlyIncome: MoneySchema.nullable(),
  /** Where the income figure is from: the application's verified or declared figure, or the customer profile. */
  incomeSource: z.enum(['FINANCIAL_INPUT', 'CUSTOMER_PROFILE']).nullable(),
  monthlyObligations: MoneySchema.nullable(),
  counted: z.boolean(),
});
export type BorrowerIncomeLine = z.infer<typeof BorrowerIncomeLineSchema>;

/** GET /v1/applications/{id}/lender-matches/inputs — what a run would use now, and where each value comes from. */
export const LenderMatchPrefillSchema = z.object({
  applicationId: IdSchema('app'),
  inputs: LenderMatchInputsSchema,
  sources: z.record(z.enum(LENDER_MATCH_FIELDS), z.enum(LENDER_MATCH_INPUT_SOURCES).nullable()),
  /** The working behind monthlyIncome and monthlyObligations, one line per borrower on the file (2026-11-28). */
  borrowers: z.array(BorrowerIncomeLineSchema).optional(),
  /** How many live properties make up collateralValue. */
  collateralItems: z.number().int().min(0).optional(),
});
export type LenderMatchPrefill = z.infer<typeof LenderMatchPrefillSchema>;

export const LenderMatchResultSchema = z.object({
  rank: z.number().int().min(1),
  policyId: IdSchema('lpo'),
  lenderId: IdSchema('lnd'),
  lenderName: z.string(),
  productVersionId: IdSchema('prv'),
  productName: z.string(),
  outcome: z.enum(LENDER_MATCH_OUTCOMES),
  reasons: z.array(z.enum(LENDER_MATCH_REASONS)),
  missingFields: z.array(z.enum(LENDER_MATCH_FIELDS)),
  eligibleAmount: MoneySchema.nullable(),
  limitedBy: z.enum(LENDER_MATCH_LIMITS).nullable(),
  emiMin: MoneySchema.nullable(),
  emiMax: MoneySchema.nullable(),
  foirBps: z.number().int().nullable(),
  processingFee: MoneySchema.nullable(),
  rateMinBps: z.number().int(),
  rateMaxBps: z.number().int(),
});
export type LenderMatchResultView = z.infer<typeof LenderMatchResultSchema>;

/** A stored run with its ranked results (POST response, GET .../lender-matches/latest). */
export const LenderMatchRunSchema = z.object({
  id: IdSchema('lmr'),
  applicationId: IdSchema('app'),
  evaluatedAt: z.string(),
  inputs: LenderMatchInputsSchema,
  inputsHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  policyCount: z.number().int().min(0),
  eligibleCount: z.number().int().min(0),
  results: z.array(LenderMatchResultSchema),
  createdBy: z.string(),
});
export type LenderMatchRun = z.infer<typeof LenderMatchRunSchema>;

// ---- EMI calculator -----------------------------------------------------------------------------------------------------------

/** POST /v1/emi-calculations — stateless. */
export const EmiCalculationRequestSchema = z
  .object({
    principal: InrMoneySchema,
    annualRateBps: Bps,
    tenureMonths: z.number().int().min(1).max(480),
  })
  .strict();
export type EmiCalculationRequest = z.infer<typeof EmiCalculationRequestSchema>;

export const EmiCalculationSchema = z.object({
  emi: MoneySchema,
  totalPayable: MoneySchema,
  totalInterest: MoneySchema,
});
export type EmiCalculation = z.infer<typeof EmiCalculationSchema>;
