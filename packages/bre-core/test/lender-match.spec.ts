// packages/bre-core/test/lender-match.spec.ts — owner: Dipanshu (P1-04 lender policy grid and multi-lender matching)
import { describe, expect, it } from 'vitest';
import {
  calculateEmi,
  matchLenderPolicy,
  matchLenders,
  principalForEmi,
  type LenderMatchInputs,
  type LenderPolicyTerms,
} from '../src';

const NOW = new Date('2026-11-26T06:00:00Z');
const rupees = (r: number): number => r * 100;

/** The spec's worked example (Notion P1-04 §5): ₹10,00,000 over 60 months, income ₹60,000, obligations ₹10,000. */
const inputs = (over: Partial<LenderMatchInputs> = {}): LenderMatchInputs => ({
  requestedAmountPaise: rupees(1_000_000),
  tenureMonths: 60,
  monthlyIncomePaise: rupees(60_000),
  monthlyObligationsPaise: rupees(10_000),
  ageYears: 35,
  pincode: '560034',
  bureauScore: 742,
  collateralValuePaise: null,
  employmentType: 'SALARIED',
  constitution: 'INDIVIDUAL',
  vintageMonths: 48,
  ...over,
});

const policy = (over: Partial<LenderPolicyTerms> = {}): LenderPolicyTerms => ({
  policyId: 'lpo_A',
  lenderId: 'lnd_A',
  productVersionId: 'prv_A',
  amountMinPaise: rupees(50_000),
  amountMaxPaise: rupees(2_500_000),
  tenureMinMonths: 12,
  tenureMaxMonths: 84,
  minBureauScore: 700,
  minAge: 21,
  maxAgeAtMaturity: 60,
  minIncomePaise: rupees(25_000),
  foirCapBps: 5000,
  ltvCapBps: null,
  rateMinBps: 1050,
  rateMaxBps: 1200,
  processingFeeBps: 100,
  serviceablePincodes: [],
  allowedConstitutions: [],
  allowedEmployment: [],
  minVintageMonths: null,
  effectiveFrom: '2026-01-01T00:00:00Z',
  effectiveTo: null,
  ...over,
});

describe('P1-04 calculateEmi and principalForEmi', () => {
  it('P1-04 EMI for ₹10,00,000 at 12% over 60 months is ₹22,244.45 (rounded up to the paisa)', () => {
    expect(calculateEmi(rupees(1_000_000), 1200, 60)).toBe(2_224_445);
  });

  it('P1-04 a zero rate uses EMI = P / n, rounded up to the paisa', () => {
    expect(calculateEmi(rupees(120_000), 0, 12)).toBe(rupees(10_000));
    expect(calculateEmi(100, 0, 3)).toBe(34);
    expect(principalForEmi(rupees(10_000), 0, 12)).toBe(rupees(120_000));
  });

  it('P1-04 principalForEmi rounds down to the rupee and its EMI never exceeds the allowed EMI', () => {
    const p = principalForEmi(rupees(20_000), 1200, 60);
    expect(p).toBe(rupees(899_100));
    expect(p % 100).toBe(0);
    expect(calculateEmi(p, 1200, 60)).toBeLessThanOrEqual(rupees(20_000));
  });

  it('P1-04 rejects non-integer money and a tenure below one month', () => {
    expect(() => calculateEmi(100.5, 1200, 12)).toThrow(RangeError);
    expect(() => calculateEmi(100, 1200, 0)).toThrow(RangeError);
  });
});

describe('P1-04 matchLenders: the worked example', () => {
  const lenderA = policy();
  const lenderB = policy({ policyId: 'lpo_B', lenderId: 'lnd_B', minBureauScore: 760 });
  const lenderC = policy({ policyId: 'lpo_C', lenderId: 'lnd_C', serviceablePincodes: ['411'] });

  it('P1-04 lender A is FOIR-limited to ₹8,99,100', () => {
    const r = matchLenderPolicy(inputs(), lenderA, NOW);
    expect(r.outcome).toBe('ELIGIBLE');
    expect(r.limitedBy).toBe('FOIR');
    expect(r.eligibleAmountPaise).toBe(rupees(899_100));
    expect(r.emiMaxPaise).toBeLessThanOrEqual(rupees(20_000));
    expect(r.emiMinPaise).toBeLessThan(r.emiMaxPaise!);
    expect(r.foirBps).toBeLessThanOrEqual(5000);
    expect(r.processingFeePaise).toBe(rupees(8_991));
  });

  it('P1-04 lender B is NOT_ELIGIBLE with BUREAU_SCORE_BELOW_MIN', () => {
    const r = matchLenderPolicy(inputs(), lenderB, NOW);
    expect(r.outcome).toBe('NOT_ELIGIBLE');
    expect(r.reasons).toEqual(['BUREAU_SCORE_BELOW_MIN']);
    expect(r.eligibleAmountPaise).toBeNull();
  });

  it('P1-04 lender C is NOT_ELIGIBLE with PINCODE_NOT_SERVICEABLE (411 prefix, application in 560)', () => {
    const r = matchLenderPolicy(inputs(), lenderC, NOW);
    expect(r.reasons).toEqual(['PINCODE_NOT_SERVICEABLE']);
    expect(matchLenderPolicy(inputs({ pincode: '411001' }), lenderC, NOW).outcome).toBe('ELIGIBLE');
  });

  it('P1-04 results are sorted ELIGIBLE first, then by policy id within the same outcome', () => {
    const results = matchLenders(inputs(), [lenderC, lenderB, lenderA], NOW);
    expect(results.map((r) => r.policyId)).toEqual(['lpo_A', 'lpo_B', 'lpo_C']);
  });
});

describe('P1-04 matchLenderPolicy: boundaries', () => {
  it('P1-04 FOIR exactly at the cap is eligible for the full requested amount', () => {
    const r = matchLenderPolicy(
      inputs({
        requestedAmountPaise: rupees(500_000),
        tenureMonths: 12,
        monthlyIncomePaise: rupees(100_000),
        monthlyObligationsPaise: rupees(8_333),
      }),
      // EMI at 0% = 500,000 / 12 = 41,666.67; obligations 8,333 → total 49,999.67, just under 50%.
      policy({ rateMinBps: 0, rateMaxBps: 0 }),
      NOW,
    );
    expect(r.outcome).toBe('ELIGIBLE');
    expect(r.limitedBy).toBe('REQUESTED');
    expect(r.eligibleAmountPaise).toBe(rupees(500_000));
    expect(r.foirBps).toBe(5000);
  });

  it('P1-04 obligations already at the FOIR cap give NOT_ELIGIBLE FOIR_EXCEEDED', () => {
    const r = matchLenderPolicy(inputs({ monthlyObligationsPaise: rupees(30_000) }), policy(), NOW);
    expect(r.outcome).toBe('NOT_ELIGIBLE');
    expect(r.reasons).toEqual(['FOIR_EXCEEDED']);
  });

  it('P1-04 age at maturity equal to the cap passes, one month over fails', () => {
    const p = policy({ maxAgeAtMaturity: 60 });
    expect(matchLenderPolicy(inputs({ ageYears: 55, tenureMonths: 60 }), p, NOW).outcome).toBe('ELIGIBLE');
    const over = matchLenderPolicy(inputs({ ageYears: 55, tenureMonths: 61 }), p, NOW);
    expect(over.reasons).toEqual(['AGE_AT_MATURITY_ABOVE_MAX']);
  });

  it('P1-04 an LTV cap limits a secured loan to the cap times the collateral value', () => {
    const r = matchLenderPolicy(
      inputs({
        requestedAmountPaise: rupees(10_000_000),
        tenureMonths: 240,
        monthlyIncomePaise: null,
        monthlyObligationsPaise: null,
        collateralValuePaise: rupees(10_000_000),
      }),
      policy({
        amountMaxPaise: rupees(20_000_000),
        tenureMaxMonths: 360,
        foirCapBps: null,
        minIncomePaise: null,
        ltvCapBps: 7500,
      }),
      NOW,
    );
    expect(r.outcome).toBe('ELIGIBLE');
    expect(r.limitedBy).toBe('LTV');
    expect(r.eligibleAmountPaise).toBe(rupees(7_500_000));
    expect(r.foirBps).toBeNull();
  });

  it('P1-04 the product maximum caps a larger request', () => {
    const r = matchLenderPolicy(
      inputs({ requestedAmountPaise: rupees(5_000_000), monthlyIncomePaise: rupees(1_000_000) }),
      policy(),
      NOW,
    );
    expect(r.limitedBy).toBe('PRODUCT_MAX');
    expect(r.eligibleAmountPaise).toBe(rupees(2_500_000));
  });

  it('P1-04 the eligible amount is rounded down to the whole rupee', () => {
    const r = matchLenderPolicy(inputs({ monthlyIncomePaise: rupees(60_000) + 37 }), policy(), NOW);
    expect(r.eligibleAmountPaise! % 100).toBe(0);
  });

  it('P1-04 a FOIR-limited amount below the product minimum is NOT_ELIGIBLE', () => {
    const r = matchLenderPolicy(
      inputs({ monthlyIncomePaise: rupees(25_000), monthlyObligationsPaise: rupees(12_000) }),
      policy({ amountMinPaise: rupees(100_000) }),
      NOW,
    );
    expect(r.reasons).toEqual(['ELIGIBLE_AMOUNT_BELOW_PRODUCT_MIN']);
  });

  it('P1-04 a policy outside its effective window is NOT_ELIGIBLE (now is the caller’s, never the clock)', () => {
    const p = policy({ effectiveFrom: '2026-12-01T00:00:00Z' });
    expect(matchLenderPolicy(inputs(), p, NOW).reasons).toEqual(['POLICY_NOT_EFFECTIVE']);
    expect(matchLenderPolicy(inputs(), p, new Date('2026-12-01T00:00:00Z')).outcome).toBe('ELIGIBLE');
    const ended = policy({ effectiveTo: '2026-11-26T06:00:00Z' });
    expect(matchLenderPolicy(inputs(), ended, NOW).reasons).toEqual(['POLICY_NOT_EFFECTIVE']);
  });

  it('P1-04 every failed hard check is reported, in a fixed order', () => {
    const r = matchLenderPolicy(
      inputs({ bureauScore: 650, ageYears: 19, employmentType: 'SELF_EMPLOYED_BUSINESS', vintageMonths: 6 }),
      policy({ allowedEmployment: ['SALARIED'], minVintageMonths: 24 }),
      NOW,
    );
    expect(r.reasons).toEqual([
      'BUREAU_SCORE_BELOW_MIN',
      'AGE_BELOW_MIN',
      'EMPLOYMENT_NOT_ALLOWED',
      'VINTAGE_BELOW_MIN',
    ]);
  });
});

describe('P1-04 matchLenderPolicy: missing data', () => {
  it('P1-04 a missing input the policy needs gives NEEDS_DATA with the field list', () => {
    const r = matchLenderPolicy(inputs({ monthlyObligationsPaise: null, bureauScore: null }), policy(), NOW);
    expect(r.outcome).toBe('NEEDS_DATA');
    expect(r.missingFields).toEqual(['monthlyObligations', 'bureauScore']);
    expect(r.eligibleAmountPaise).toBeNull();
  });

  it('P1-04 an input no rule of the policy reads is not required', () => {
    const r = matchLenderPolicy(
      inputs({ pincode: null, collateralValuePaise: null, constitution: null }),
      policy(),
      NOW,
    );
    expect(r.outcome).toBe('ELIGIBLE');
    expect(r.missingFields).toEqual([]);
  });

  it('P1-04 a failed hard check wins over missing data, and the missing fields are still listed', () => {
    const r = matchLenderPolicy(inputs({ bureauScore: 600, monthlyObligationsPaise: null }), policy(), NOW);
    expect(r.outcome).toBe('NOT_ELIGIBLE');
    expect(r.reasons).toEqual(['BUREAU_SCORE_BELOW_MIN']);
    expect(r.missingFields).toEqual(['monthlyObligations']);
  });

  it('P1-04 NEEDS_DATA sorts between ELIGIBLE and NOT_ELIGIBLE', () => {
    const results = matchLenders(
      inputs({ collateralValuePaise: null }),
      [
        policy({ policyId: 'lpo_bad', minBureauScore: 800 }),
        policy({ policyId: 'lpo_ltv', ltvCapBps: 8000 }),
        policy({ policyId: 'lpo_ok' }),
      ],
      NOW,
    );
    expect(results.map((r) => [r.policyId, r.outcome])).toEqual([
      ['lpo_ok', 'ELIGIBLE'],
      ['lpo_ltv', 'NEEDS_DATA'],
      ['lpo_bad', 'NOT_ELIGIBLE'],
    ]);
  });
});

describe('P1-04 matchLenders: determinism and speed', () => {
  const many = Array.from({ length: 120 }, (_, i) =>
    policy({
      policyId: `lpo_${String(i).padStart(3, '0')}`,
      lenderId: `lnd_${i % 12}`,
      rateMinBps: 900 + (i % 10) * 50,
      rateMaxBps: 1100 + (i % 10) * 75,
      foirCapBps: 4000 + (i % 5) * 500,
      minBureauScore: 650 + (i % 8) * 20,
      tenureMaxMonths: 84 + (i % 3) * 120,
      ltvCapBps: i % 4 === 0 ? 7000 : null,
    }),
  );

  it('P1-04 the same inputs and now give the same output byte for byte, whatever the policy order', () => {
    const a = JSON.stringify(matchLenders(inputs({ collateralValuePaise: rupees(2_000_000) }), many, NOW));
    const b = JSON.stringify(
      matchLenders(inputs({ collateralValuePaise: rupees(2_000_000) }), [...many].reverse(), NOW),
    );
    expect(a).toBe(b);
  });

  it('P1-04 120 policies match in under 300 ms', () => {
    const start = performance.now();
    matchLenders(inputs({ tenureMonths: 84, collateralValuePaise: rupees(2_000_000) }), many, NOW);
    expect(performance.now() - start).toBeLessThan(300);
  });
});
