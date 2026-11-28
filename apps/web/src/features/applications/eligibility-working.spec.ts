// TEST-WEB-ELGW the eligibility working (2026-11-28). Synthetic values only.
import type { BorrowerIncomeLine } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import { countedText, incomeTotals, ltvPercent } from './eligibility-working';

const line = (over: Partial<BorrowerIncomeLine>): BorrowerIncomeLine => ({
  customerId: 'cust_a',
  role: 'PRIMARY',
  relationshipToPrimary: null,
  monthlyIncome: null,
  incomeSource: null,
  monthlyObligations: null,
  counted: true,
  ...over,
});
const inr = (amount: string) => ({ amount, currency: 'INR' });

describe('TEST-WEB-ELGW eligibility working', () => {
  it('TEST-WEB-ELGW-01 clubs the borrower and co-applicants, leaves the guarantor out, and works out the existing FOIR', () => {
    const totals = incomeTotals([
      line({ monthlyIncome: inr('60000.00'), monthlyObligations: inr('10000.00') }),
      line({
        customerId: 'cust_b',
        role: 'CO_APPLICANT',
        monthlyIncome: inr('40000.50'),
        monthlyObligations: inr('5000.00'),
      }),
      line({ customerId: 'cust_c', role: 'GUARANTOR', counted: false, monthlyIncome: inr('900000.00') }),
    ]);
    expect(totals).toEqual({
      income: '100000.50',
      obligations: '15000.00',
      existingFoirPercent: 15,
      missingIncome: [],
    });
  });

  it('TEST-WEB-ELGW-02 names the counted borrowers with no income; no income gives no FOIR', () => {
    const totals = incomeTotals([
      line({ monthlyObligations: inr('8000.00') }),
      line({ customerId: 'cust_b', role: 'CO_APPLICANT' }),
    ]);
    expect(totals.income).toBeNull();
    expect(totals.existingFoirPercent).toBeNull();
    expect(totals.missingIncome).toEqual(['cust_a', 'cust_b']);
  });

  it('TEST-WEB-ELGW-03 LTV is the request over the property value, to one decimal', () => {
    expect(ltvPercent('3750000.00', '5000000.00')).toBe(75);
    expect(ltvPercent('1000000.00', '3000000.00')).toBe(33.3);
    expect(ltvPercent('1000000.00', null)).toBeNull();
  });

  it('TEST-WEB-ELGW-04 each line says whether its income is counted', () => {
    expect(countedText(line({}))).toBe('Borrower');
    expect(countedText(line({ role: 'CO_APPLICANT' }))).toBe('Income clubbed with the borrower');
    expect(countedText(line({ role: 'GUARANTOR', counted: false }))).toMatch(/Not counted/);
  });
});
