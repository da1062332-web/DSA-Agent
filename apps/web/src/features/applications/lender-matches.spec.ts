// P1-04 lender matches helpers (owner: Dipanshu). The inputs form ↔ the run body, labels and the empanelment a case uses.
import { LENDER_MATCH_FIELDS, LENDER_MATCH_REASONS, LenderMatchRunRequestSchema } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import { FIELD_TEXT, REASON_TEXT, empanelmentFor, formToRun, inputsToForm, rupees } from './lender-matches';

const prefilled = {
  requestedAmount: { amount: '1000000.00', currency: 'INR' },
  tenureMonths: 60,
  monthlyIncome: { amount: '60000.00', currency: 'INR' },
  monthlyObligations: null,
  ageYears: null,
  pincode: null,
  bureauScore: 742,
  collateralValue: null,
  employmentType: 'SALARIED' as const,
  constitution: null,
  vintageMonths: null,
};

describe('P1-04 lender matches form', () => {
  it('P1-04 the prefill becomes text, and the run body sends every field (empty means null) in a shape the API accepts', () => {
    const form = inputsToForm(prefilled);
    expect(form).toMatchObject({
      requestedAmount: '1000000',
      tenureMonths: '60',
      bureauScore: '742',
      pincode: '',
    });
    const { body, errors } = formToRun({
      ...form,
      monthlyObligations: '10,000',
      pincode: '560034',
      bureauScore: '',
    });
    expect(errors).toEqual({});
    expect(LenderMatchRunRequestSchema.parse(body)).toEqual({
      ...prefilled,
      monthlyObligations: { amount: '10000.00', currency: 'INR' },
      pincode: '560034',
      bureauScore: null,
    });
  });

  it('P1-04 bad input is caught per field before the run', () => {
    const { body, errors } = formToRun({
      ...inputsToForm(prefilled),
      pincode: '0411',
      bureauScore: '950',
      monthlyIncome: 'lots',
      constitution: '12',
    });
    expect(body).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(['bureauScore', 'constitution', 'monthlyIncome', 'pincode']);
  });

  it('P1-04 every reason and field the API can return has a label', () => {
    for (const r of LENDER_MATCH_REASONS) expect(REASON_TEXT[r], r).toBeTruthy();
    for (const f of LENDER_MATCH_FIELDS) expect(FIELD_TEXT[f], f).toBeTruthy();
    expect(rupees({ amount: '899100.00' })).toBe('₹8,99,100.00');
    expect(rupees(null)).toBeNull();
  });

  it('P1-04 a case uses the ACTIVE empanelment valid today that permits the category', () => {
    const e = (over: Record<string, unknown>) => ({
      id: 'emp_1',
      status: 'ACTIVE',
      permittedCategories: ['PL'],
      validFrom: '2026-01-01',
      validTo: null as string | null,
      ...over,
    });
    const today = '2026-11-27';
    expect(empanelmentFor([e({ status: 'SUSPENDED' }), e({ id: 'emp_2' })], 'PL', today)?.id).toBe('emp_2');
    expect(empanelmentFor([e({ permittedCategories: ['HL'] })], 'PL', today)).toBeNull();
    expect(empanelmentFor([e({ validTo: '2026-11-26' })], 'PL', today)).toBeNull();
    expect(empanelmentFor([e({ validFrom: '2026-11-28' })], 'PL', today)).toBeNull();
    expect(empanelmentFor(undefined, 'PL', today)).toBeNull();
  });
});
