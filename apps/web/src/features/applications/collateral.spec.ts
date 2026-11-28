// TEST-WEB-P103 collateral form rules (task P1-03). Synthetic values only.
import { describe, expect, it } from 'vitest';
import {
  EMPTY_COLLATERAL,
  amountToRupees,
  collateralProblem,
  rupeesToAmount,
  toCollateralBody,
  type CollateralForm,
} from './collateral';

const FORM: CollateralForm = {
  ...EMPTY_COLLATERAL,
  propertyType: 'RESIDENTIAL_FLAT',
  addressLine1: 'Flat 12, Shanti Heights',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411045',
  value: '50,00,000',
  ownershipType: 'FREEHOLD',
};

describe('TEST-WEB-P103 collateral form', () => {
  it('TEST-WEB-P103-01 rupees as typed become a two-place amount; zero and junk are refused', () => {
    expect(rupeesToAmount('50,00,000')).toBe('5000000.00');
    expect(rupeesToAmount('₹ 5000000.5')).toBe('5000000.50');
    expect(rupeesToAmount('0075')).toBe('75.00');
    expect(rupeesToAmount('0')).toBeNull();
    expect(rupeesToAmount('0.00')).toBeNull();
    expect(rupeesToAmount('12.345')).toBeNull();
    expect(rupeesToAmount('-5')).toBeNull();
    expect(rupeesToAmount('1e7')).toBeNull();
    expect(rupeesToAmount('10000000000000')).toBeNull();
  });

  it('TEST-WEB-P103-02 a stored amount is shown with Indian grouping', () => {
    expect(amountToRupees('5000000.00')).toBe('50,00,000');
    expect(amountToRupees('123456789.50')).toBe('12,34,56,789.50');
    expect(amountToRupees('999.00')).toBe('999');
  });

  it('TEST-WEB-P103-03 the form names the first missing or wrong field', () => {
    expect(collateralProblem(FORM, '2026-11-28')).toBeNull();
    expect(collateralProblem({ ...FORM, propertyType: '' }, '2026-11-28')).toMatch(/property type/);
    expect(collateralProblem({ ...FORM, pincode: '41104' }, '2026-11-28')).toMatch(/pincode/);
    expect(collateralProblem({ ...FORM, value: '0' }, '2026-11-28')).toMatch(/market value/);
    expect(collateralProblem({ ...FORM, addressLine1: 'Owner ABCDE1234F' }, '2026-11-28')).toMatch(/PAN/);
    expect(collateralProblem({ ...FORM, appraisalDate: '2026-11-29' }, '2026-11-28')).toMatch(/future/);
    expect(collateralProblem({ ...FORM, ownershipType: '' }, '2026-11-28')).toMatch(/freehold/);
  });

  it('TEST-WEB-P103-04 the body carries the value as INR money and blanks as null', () => {
    expect(toCollateralBody(FORM)).toEqual({
      propertyType: 'RESIDENTIAL_FLAT',
      addressLine1: 'Flat 12, Shanti Heights',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411045',
      estimatedMarketValue: { amount: '5000000.00', currency: 'INR' },
      ownershipType: 'FREEHOLD',
      occupancyType: null,
      appraisalDate: null,
    });
  });
});
