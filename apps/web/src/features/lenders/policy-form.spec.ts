// P1-04 lender policy editor helpers (owner: Dipanshu). Form text ↔ API body, and why Activate is disabled.
import { LenderPolicyCreateSchema, LenderPolicyPatchSchema, type LenderPolicy } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_POLICY_FORM,
  activationBlocker,
  businessDateToInstant,
  formToCreate,
  formToPatch,
  instantToBusinessDate,
  percentToBps,
  policyToForm,
  rateBand,
  rupeesToAmount,
  type PolicyForm,
} from './policy-form';

const LENDER = 'lnd_01JD8Y3Z4K5M6N7P8Q9R0S1T2V';
const PRV = 'prv_01JD8Y3Z4K5M6N7P8Q9R0S1T2V';
const filled: PolicyForm = {
  ...EMPTY_POLICY_FORM,
  productVersionId: PRV,
  rateMin: '10.5',
  rateMax: '12',
  processingFee: '1',
  foirCap: '50',
  minBureauScore: '700',
  minAge: '21',
  maxAgeAtMaturity: '60',
  minIncome: '25,000',
  serviceablePincodes: '411, 560034',
  allowedConstitutions: 'proprietorship',
  allowedEmployment: ['SALARIED'],
  effectiveFrom: '2026-12-01',
};

describe('P1-04 policy form', () => {
  it('P1-04 percentages become basis points, rupees become INR money, dates start at midnight in India', () => {
    expect(percentToBps('10.5')).toBe(1050);
    expect(percentToBps('100')).toBe(10_000);
    expect(percentToBps('100.01')).toBeNull();
    expect(percentToBps('1.234')).toBeNull();
    expect(rupeesToAmount('25,000')).toBe('25000.00');
    expect(rupeesToAmount('₹ 1,00,000.5')).toBe('100000.50');
    expect(rupeesToAmount('-1')).toBeNull();
    expect(businessDateToInstant('2026-12-01')).toBe('2026-11-30T18:30:00.000Z');
    expect(businessDateToInstant('2026-02-30')).toBeNull();
    expect(instantToBusinessDate('2026-11-30T18:30:00.000Z')).toBe('2026-12-01');
  });

  it('P1-04 a filled form gives a create body the API schema accepts', () => {
    const { body, errors } = formToCreate(LENDER, filled);
    expect(errors).toEqual({});
    expect(LenderPolicyCreateSchema.parse(body)).toMatchObject({
      lenderId: LENDER,
      productVersionId: PRV,
      rateMinBps: 1050,
      rateMaxBps: 1200,
      foirCapBps: 5000,
      minIncome: { amount: '25000.00', currency: 'INR' },
      serviceablePincodes: ['411', '560034'],
      allowedConstitutions: ['PROPRIETORSHIP'],
    });
  });

  it('P1-04 field errors: rates required and ordered, ages ordered, bad pincodes, end before start, no product version', () => {
    const { body, errors } = formToCreate(LENDER, {
      ...filled,
      productVersionId: '',
      rateMin: '13',
      maxAgeAtMaturity: '20',
      serviceablePincodes: '0411',
      effectiveTo: '2026-11-01',
    });
    expect(body).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(
      ['effectiveTo', 'maxAgeAtMaturity', 'productVersionId', 'rateMax', 'serviceablePincodes'].sort(),
    );
    expect(formToCreate(LENDER, EMPTY_POLICY_FORM).errors).toMatchObject({
      rateMin: 'Required.',
      rateMax: 'Required.',
    });
  });

  it('P1-04 a policy round-trips through the form, and the patch never moves it or changes its status', () => {
    const policy = {
      ...formToCreate(LENDER, filled).body!,
      id: 'lpo_01JD8Y3Z4K5M6N7P8Q9R0S1T2V',
      status: 'DRAFT',
      versionNo: 1,
      editors: ['usr_1'],
    } as unknown as LenderPolicy;
    const form = policyToForm(policy);
    expect(form).toMatchObject({
      rateMin: '10.5',
      foirCap: '50',
      minIncome: '25000',
      effectiveFrom: '2026-12-01',
    });
    const { body } = formToPatch(form);
    const parsed = LenderPolicyPatchSchema.parse(body);
    for (const key of ['lenderId', 'productVersionId', 'status']) expect(parsed).not.toHaveProperty(key);
  });

  it('P1-04 Activate explains itself: not a draft, no approval permission, or the user is an editor (maker-checker)', () => {
    const draft = { status: 'DRAFT' as const, editors: ['usr_maker'] };
    expect(activationBlocker(draft, { id: 'usr_checker' }, true)).toBeNull();
    expect(activationBlocker(draft, { id: 'usr_maker' }, true)).toMatch(/maker-checker/);
    expect(activationBlocker(draft, { id: 'usr_checker' }, false)).toMatch(/permission/);
    expect(activationBlocker({ ...draft, status: 'ACTIVE' }, { id: 'usr_checker' }, true)).toMatch(/draft/);
    expect(rateBand(1050, 1200)).toBe('10.5 – 12%');
    expect(rateBand(1200, 1200)).toBe('12%');
  });
});
