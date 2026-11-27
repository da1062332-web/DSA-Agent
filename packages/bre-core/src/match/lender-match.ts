// packages/bre-core/src/match/lender-match.ts — owner: Dipanshu (P1-04 lender policy grid and multi-lender matching)
// Pure functions: no I/O, no clock (the caller passes `now`), no randomness. Money is integer paise in and out.
// The annuity factor uses BigInt fixed-point arithmetic (18 decimal places) so the same inputs give the same output
// byte for byte on every engine: Math.pow is not required to be correctly rounded, multiplication of BigInts is exact.

/** Outcome of one lender policy against one application. Never thrown: every business result is a value. */
export type LenderMatchOutcome = 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'NEEDS_DATA';

export const LENDER_MATCH_REASON_CODES = [
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
export type LenderMatchReasonCode = (typeof LENDER_MATCH_REASON_CODES)[number];

/** Field names reported in `missingFields` (the same names as the request body of a match run). */
export const LENDER_MATCH_INPUT_FIELDS = [
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
export type LenderMatchInputField = (typeof LENDER_MATCH_INPUT_FIELDS)[number];

/** What is known about the application. `null` means not known; it is NEEDS_DATA only when a policy needs it. */
export interface LenderMatchInputs {
  requestedAmountPaise: number | null;
  tenureMonths: number | null;
  monthlyIncomePaise: number | null;
  /** Existing EMIs per month. Zero must be entered as 0: `null` is unknown, not none. */
  monthlyObligationsPaise: number | null;
  /** Age in completed years on the evaluation date. */
  ageYears: number | null;
  pincode: string | null;
  bureauScore: number | null;
  collateralValuePaise: number | null;
  employmentType: string | null;
  constitution: string | null;
  vintageMonths: number | null;
}

/** One ACTIVE lender policy joined with the product version it prices. `null` or `[]` means "no such rule". */
export interface LenderPolicyTerms {
  policyId: string;
  lenderId: string;
  productVersionId: string;
  amountMinPaise: number;
  amountMaxPaise: number;
  tenureMinMonths: number;
  tenureMaxMonths: number;
  minBureauScore: number | null;
  minAge: number | null;
  maxAgeAtMaturity: number | null;
  minIncomePaise: number | null;
  foirCapBps: number | null;
  ltvCapBps: number | null;
  rateMinBps: number;
  rateMaxBps: number;
  processingFeeBps: number | null;
  /** Full 6-digit pincodes or leading-digit prefixes ("411" serves 411001–411999). Empty serves everywhere. */
  serviceablePincodes: readonly string[];
  allowedConstitutions: readonly string[];
  allowedEmployment: readonly string[];
  minVintageMonths: number | null;
  /** ISO 8601 instants; the policy applies when effectiveFrom <= now < effectiveTo. */
  effectiveFrom: string;
  effectiveTo: string | null;
}

/** Which limit set the eligible amount. */
export type LenderMatchLimit = 'REQUESTED' | 'PRODUCT_MAX' | 'FOIR' | 'LTV';

export interface LenderMatchResult {
  policyId: string;
  lenderId: string;
  productVersionId: string;
  outcome: LenderMatchOutcome;
  reasons: LenderMatchReasonCode[];
  missingFields: LenderMatchInputField[];
  /** Rounded down to the whole rupee. Null unless ELIGIBLE. */
  eligibleAmountPaise: number | null;
  limitedBy: LenderMatchLimit | null;
  /** EMI on the eligible amount at the policy's lowest and highest rate, rounded up to the paisa. */
  emiMinPaise: number | null;
  emiMaxPaise: number | null;
  /** (obligations + EMI at the highest rate) / income, in basis points, rounded up. */
  foirBps: number | null;
  processingFeePaise: number | null;
}

const SCALE = 10n ** 18n;
const BPS_PER_MONTH_DENOMINATOR = 120_000n; // 10,000 bps × 12 months

function assertNonNegativeInt(value: number | null, name: string): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

/** Monthly rate in fixed point (SCALE = 1). */
const monthlyRate = (annualRateBps: number): bigint =>
  (BigInt(annualRateBps) * SCALE) / BPS_PER_MONTH_DENOMINATOR;

/** (1 + r)^n in fixed point, by repeated exact multiplication (n is at most a few hundred). */
function growth(rate: bigint, months: number): bigint {
  let f = SCALE;
  const step = SCALE + rate;
  for (let i = 0; i < months; i += 1) f = (f * step) / SCALE;
  return f;
}

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/**
 * EMI in paise for a principal in paise: P·r(1+r)^n / ((1+r)^n − 1), or P / n at a zero rate. Rounded up to the paisa,
 * so the EMI never understates what the borrower pays.
 */
export function calculateEmi(principalPaise: number, annualRateBps: number, tenureMonths: number): number {
  assertNonNegativeInt(principalPaise, 'principalPaise');
  assertNonNegativeInt(annualRateBps, 'annualRateBps');
  if (!Number.isSafeInteger(tenureMonths) || tenureMonths < 1)
    throw new RangeError('tenureMonths must be >= 1');
  const p = BigInt(principalPaise);
  const n = BigInt(tenureMonths);
  if (annualRateBps === 0) return Number(ceilDiv(p, n));
  const r = monthlyRate(annualRateBps);
  const f = growth(r, tenureMonths);
  return Number(ceilDiv(p * r * f, (f - SCALE) * SCALE));
}

/** The largest principal in paise whose EMI does not exceed `emiPaise`, rounded down to the whole rupee. */
export function principalForEmi(emiPaise: number, annualRateBps: number, tenureMonths: number): number {
  assertNonNegativeInt(emiPaise, 'emiPaise');
  assertNonNegativeInt(annualRateBps, 'annualRateBps');
  if (!Number.isSafeInteger(tenureMonths) || tenureMonths < 1)
    throw new RangeError('tenureMonths must be >= 1');
  const e = BigInt(emiPaise);
  const raw =
    annualRateBps === 0
      ? e * BigInt(tenureMonths)
      : (() => {
          const r = monthlyRate(annualRateBps);
          const f = growth(r, tenureMonths);
          return (e * (f - SCALE) * SCALE) / (r * f);
        })();
  return Number((raw / 100n) * 100n);
}

const floorRupee = (paise: number): number => Math.floor(paise / 100) * 100;

const mulBps = (paise: number, bps: number): number => Number((BigInt(paise) * BigInt(bps)) / 10_000n);

function isEffective(policy: LenderPolicyTerms, nowMs: number): boolean {
  const from = Date.parse(policy.effectiveFrom);
  const to = policy.effectiveTo === null ? Number.POSITIVE_INFINITY : Date.parse(policy.effectiveTo);
  return from <= nowMs && nowMs < to;
}

const pincodeServed = (pincode: string, list: readonly string[]): boolean =>
  list.some((entry) => pincode.startsWith(entry));

/** Matches one application against one policy. */
export function matchLenderPolicy(
  inputs: LenderMatchInputs,
  policy: LenderPolicyTerms,
  now: Date,
): LenderMatchResult {
  for (const [name, value] of [
    ['requestedAmountPaise', inputs.requestedAmountPaise],
    ['tenureMonths', inputs.tenureMonths],
    ['monthlyIncomePaise', inputs.monthlyIncomePaise],
    ['monthlyObligationsPaise', inputs.monthlyObligationsPaise],
    ['ageYears', inputs.ageYears],
    ['bureauScore', inputs.bureauScore],
    ['collateralValuePaise', inputs.collateralValuePaise],
    ['vintageMonths', inputs.vintageMonths],
  ] as const) {
    assertNonNegativeInt(value, name);
  }

  const base = {
    policyId: policy.policyId,
    lenderId: policy.lenderId,
    productVersionId: policy.productVersionId,
  };
  const empty = {
    eligibleAmountPaise: null,
    limitedBy: null,
    emiMinPaise: null,
    emiMaxPaise: null,
    foirBps: null,
    processingFeePaise: null,
  };

  const reasons: LenderMatchReasonCode[] = [];
  const missing = new Set<LenderMatchInputField>();
  const need = (field: LenderMatchInputField, value: unknown): boolean => {
    if (value === null || value === undefined || value === '') {
      missing.add(field);
      return false;
    }
    return true;
  };

  if (!isEffective(policy, now.getTime())) reasons.push('POLICY_NOT_EFFECTIVE');

  if (need('requestedAmount', inputs.requestedAmountPaise)) {
    if (inputs.requestedAmountPaise! < policy.amountMinPaise) reasons.push('AMOUNT_BELOW_PRODUCT_MIN');
  }
  if (need('tenureMonths', inputs.tenureMonths)) {
    const t = inputs.tenureMonths!;
    if (t < policy.tenureMinMonths || t > policy.tenureMaxMonths) reasons.push('TENURE_OUT_OF_RANGE');
  }
  if (policy.minBureauScore !== null && need('bureauScore', inputs.bureauScore)) {
    if (inputs.bureauScore! < policy.minBureauScore) reasons.push('BUREAU_SCORE_BELOW_MIN');
  }
  if (policy.minAge !== null && need('ageYears', inputs.ageYears)) {
    if (inputs.ageYears! < policy.minAge) reasons.push('AGE_BELOW_MIN');
  }
  if (policy.maxAgeAtMaturity !== null && need('ageYears', inputs.ageYears) && inputs.tenureMonths !== null) {
    // Age is in completed years, so this is the youngest the borrower can be at maturity; equal to the cap passes.
    if (inputs.ageYears! * 12 + inputs.tenureMonths > policy.maxAgeAtMaturity * 12) {
      reasons.push('AGE_AT_MATURITY_ABOVE_MAX');
    }
  }
  if (policy.minIncomePaise !== null && need('monthlyIncome', inputs.monthlyIncomePaise)) {
    if (inputs.monthlyIncomePaise! < policy.minIncomePaise) reasons.push('INCOME_BELOW_MIN');
  }
  if (policy.serviceablePincodes.length > 0 && need('pincode', inputs.pincode)) {
    if (!pincodeServed(inputs.pincode!, policy.serviceablePincodes)) reasons.push('PINCODE_NOT_SERVICEABLE');
  }
  if (policy.allowedConstitutions.length > 0 && need('constitution', inputs.constitution)) {
    if (!policy.allowedConstitutions.includes(inputs.constitution!)) reasons.push('CONSTITUTION_NOT_ALLOWED');
  }
  if (policy.allowedEmployment.length > 0 && need('employmentType', inputs.employmentType)) {
    if (!policy.allowedEmployment.includes(inputs.employmentType!)) reasons.push('EMPLOYMENT_NOT_ALLOWED');
  }
  if (policy.minVintageMonths !== null && need('vintageMonths', inputs.vintageMonths)) {
    if (inputs.vintageMonths! < policy.minVintageMonths) reasons.push('VINTAGE_BELOW_MIN');
  }
  if (policy.foirCapBps !== null) {
    need('monthlyIncome', inputs.monthlyIncomePaise);
    need('monthlyObligations', inputs.monthlyObligationsPaise);
  }
  if (policy.ltvCapBps !== null) need('collateralValue', inputs.collateralValuePaise);

  const missingFields = LENDER_MATCH_INPUT_FIELDS.filter((f) => missing.has(f));

  if (reasons.length > 0) {
    return { ...base, outcome: 'NOT_ELIGIBLE', reasons, missingFields, ...empty };
  }
  if (missingFields.length > 0) {
    return { ...base, outcome: 'NEEDS_DATA', reasons, missingFields, ...empty };
  }

  // Every input this policy needs is present and every hard check passed: size the loan.
  const tenure = inputs.tenureMonths!;
  const candidates: Array<[LenderMatchLimit, number]> = [
    ['REQUESTED', inputs.requestedAmountPaise!],
    ['PRODUCT_MAX', policy.amountMaxPaise],
  ];
  if (policy.foirCapBps !== null) {
    const allowedEmi =
      mulBps(inputs.monthlyIncomePaise!, policy.foirCapBps) - inputs.monthlyObligationsPaise!;
    if (allowedEmi <= 0) {
      return { ...base, outcome: 'NOT_ELIGIBLE', reasons: ['FOIR_EXCEEDED'], missingFields, ...empty };
    }
    candidates.push(['FOIR', principalForEmi(allowedEmi, policy.rateMaxBps, tenure)]);
  }
  if (policy.ltvCapBps !== null) {
    candidates.push(['LTV', mulBps(inputs.collateralValuePaise!, policy.ltvCapBps)]);
  }

  // The first candidate wins a tie, so REQUESTED is reported when nothing cut the amount.
  let [limitedBy, amount] = candidates[0]!;
  for (const [limit, value] of candidates.slice(1)) {
    if (value < amount) [limitedBy, amount] = [limit, value];
  }
  const eligible = floorRupee(amount);

  if (eligible < policy.amountMinPaise) {
    return {
      ...base,
      outcome: 'NOT_ELIGIBLE',
      reasons: ['ELIGIBLE_AMOUNT_BELOW_PRODUCT_MIN'],
      missingFields,
      ...empty,
    };
  }

  const emiMin = calculateEmi(eligible, policy.rateMinBps, tenure);
  const emiMax = calculateEmi(eligible, policy.rateMaxBps, tenure);
  const income = inputs.monthlyIncomePaise;
  const obligations = inputs.monthlyObligationsPaise ?? 0;
  const foirBps =
    income !== null && income > 0
      ? Number(ceilDiv(BigInt(obligations + emiMax) * 10_000n, BigInt(income)))
      : null;

  return {
    ...base,
    outcome: 'ELIGIBLE',
    reasons: [],
    missingFields,
    eligibleAmountPaise: eligible,
    limitedBy,
    emiMinPaise: emiMin,
    emiMaxPaise: emiMax,
    foirBps,
    processingFeePaise: policy.processingFeeBps === null ? null : mulBps(eligible, policy.processingFeeBps),
  };
}

const OUTCOME_ORDER: Record<LenderMatchOutcome, number> = { ELIGIBLE: 0, NEEDS_DATA: 1, NOT_ELIGIBLE: 2 };

/**
 * Matches one application against every policy. Sorted: ELIGIBLE by eligible amount (highest first) then EMI at the
 * highest rate (lowest first), then NEEDS_DATA, then NOT_ELIGIBLE; ties break on policy id so the order is stable.
 */
export function matchLenders(
  inputs: LenderMatchInputs,
  policies: readonly LenderPolicyTerms[],
  now: Date,
): LenderMatchResult[] {
  return policies
    .map((p) => matchLenderPolicy(inputs, p, now))
    .sort(
      (a, b) =>
        OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome] ||
        (b.eligibleAmountPaise ?? 0) - (a.eligibleAmountPaise ?? 0) ||
        (a.emiMaxPaise ?? 0) - (b.emiMaxPaise ?? 0) ||
        (a.policyId < b.policyId ? -1 : a.policyId > b.policyId ? 1 : 0),
    );
}
