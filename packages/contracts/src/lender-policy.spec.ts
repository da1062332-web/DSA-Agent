// P1-04 lender policy and matching contracts (owner: Dipanshu).
import { describe, expect, it } from 'vitest';
import {
  EmiCalculationRequestSchema,
  ID_PREFIXES,
  LenderMatchRunRequestSchema,
  LenderPolicyCreateSchema,
  LenderPolicyListQuerySchema,
  LenderPolicyPatchSchema,
  LenderPolicyTransitionSchema,
  moneyToPaise,
  paiseToMoney,
  permissionGroupOf,
  PERMISSION_CODES,
} from './index';

const ULID = '01JD8Y3Z4K5M6N7P8Q9R0S1T2V';
const inr = (amount: string) => ({ amount, currency: 'INR' });
const draft = {
  lenderId: `lnd_${ULID}`,
  productVersionId: `prv_${ULID}`,
  rateMinBps: 1050,
  rateMaxBps: 1200,
  effectiveFrom: '2026-12-01T00:00:00Z',
};

describe('P1-04 money helpers', () => {
  it('P1-04 moneyToPaise and paiseToMoney round-trip, always two decimals', () => {
    expect(moneyToPaise(inr('899100.00'))).toBe(89_910_000);
    expect(moneyToPaise(inr('0.05'))).toBe(5);
    expect(paiseToMoney(89_910_000)).toEqual(inr('899100.00'));
    expect(paiseToMoney(2_224_445)).toEqual(inr('22244.45'));
    expect(paiseToMoney(7)).toEqual(inr('0.07'));
  });

  it('P1-04 paiseToMoney rejects negative and fractional paise', () => {
    expect(() => paiseToMoney(-1)).toThrow(RangeError);
    expect(() => paiseToMoney(1.5)).toThrow(RangeError);
  });
});

describe('P1-04 LenderPolicyCreateSchema', () => {
  it('P1-04 a minimal draft gets null and empty defaults', () => {
    const p = LenderPolicyCreateSchema.parse(draft);
    expect(p.foirCapBps).toBeNull();
    expect(p.serviceablePincodes).toEqual([]);
    expect(p.effectiveTo).toBeNull();
  });

  it('P1-04 rejects a rate band upside down, ages out of order and an end before the start', () => {
    const r = LenderPolicyCreateSchema.safeParse({
      ...draft,
      rateMinBps: 1300,
      minAge: 30,
      maxAgeAtMaturity: 25,
      effectiveTo: '2026-11-30T00:00:00Z',
    });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['rateMaxBps', 'maxAgeAtMaturity', 'effectiveTo']));
  });

  it('P1-04 rejects a bad pincode entry, a foreign currency, an unknown field and a timestamp without Z', () => {
    expect(LenderPolicyCreateSchema.safeParse({ ...draft, serviceablePincodes: ['0411'] }).success).toBe(
      false,
    );
    expect(
      LenderPolicyCreateSchema.safeParse({ ...draft, minIncome: { amount: '1.00', currency: 'USD' } })
        .success,
    ).toBe(false);
    expect(LenderPolicyCreateSchema.safeParse({ ...draft, tenantId: 'ten_x' }).success).toBe(false);
    expect(
      LenderPolicyCreateSchema.safeParse({ ...draft, effectiveFrom: '2026-12-01T00:00:00+05:30' }).success,
    ).toBe(false);
  });

  it('P1-04 accepts pincode prefixes and the application employment types', () => {
    const r = LenderPolicyCreateSchema.safeParse({
      ...draft,
      serviceablePincodes: ['411', '560034'],
      allowedEmployment: ['SALARIED', 'SELF_EMPLOYED_PROFESSIONAL'],
      allowedConstitutions: ['PROPRIETORSHIP'],
    });
    expect(r.success).toBe(true);
  });
});

describe('P1-04 patch, transition, list and match schemas', () => {
  it('P1-04 a patch needs at least one field and never moves the policy to another lender', () => {
    expect(LenderPolicyPatchSchema.safeParse({}).success).toBe(false);
    expect(LenderPolicyPatchSchema.safeParse({ lenderId: draft.lenderId }).success).toBe(false);
    expect(LenderPolicyPatchSchema.safeParse({ foirCapBps: 5000 }).success).toBe(true);
  });

  it('P1-04 transitions are ACTIVATE or RETIRE only', () => {
    expect(LenderPolicyTransitionSchema.safeParse({ action: 'ACTIVATE' }).success).toBe(true);
    expect(LenderPolicyTransitionSchema.safeParse({ action: 'APPROVE' }).success).toBe(false);
  });

  it('P1-04 the list query allow-lists its filters and caps the limit at 200', () => {
    expect(LenderPolicyListQuerySchema.safeParse({ status: 'ACTIVE', limit: '20' }).success).toBe(true);
    expect(LenderPolicyListQuerySchema.safeParse({ sort: 'name' }).success).toBe(false);
    expect(LenderPolicyListQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });

  it('P1-04 a match request may override any input, and null clears it', () => {
    const r = LenderMatchRunRequestSchema.parse({ monthlyObligations: inr('10000.00'), pincode: null });
    expect(r.pincode).toBeNull();
    expect(LenderMatchRunRequestSchema.safeParse({ pincode: '41100' }).success).toBe(false);
    expect(LenderMatchRunRequestSchema.safeParse({ ageYears: 17 }).success).toBe(false);
  });

  it('P1-04 an EMI calculation takes INR principal, a rate in bps and 1–480 months', () => {
    expect(
      EmiCalculationRequestSchema.safeParse({
        principal: inr('1000000.00'),
        annualRateBps: 1200,
        tenureMonths: 60,
      }).success,
    ).toBe(true);
    expect(
      EmiCalculationRequestSchema.safeParse({
        principal: inr('1000000.00'),
        annualRateBps: 1200,
        tenureMonths: 0,
      }).success,
    ).toBe(false);
  });
});

describe('P1-04 catalogue entries', () => {
  it('P1-04 the three permission codes are in the catalogue and grouped under Lenders', () => {
    for (const code of ['lender_policy.read', 'lender_policy.manage', 'lender_match.run'] as const) {
      expect(PERMISSION_CODES).toContain(code);
      expect(permissionGroupOf(code)?.feature.id).toBe('lender-policies');
    }
  });

  it('P1-04 the id prefixes for policies, runs and results exist', () => {
    for (const p of ['lpo', 'lmr', 'lmx']) expect(ID_PREFIXES).toContain(p);
  });
});
