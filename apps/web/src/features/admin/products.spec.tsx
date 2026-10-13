// MOD-PRD Products, web level (owner: Dev 3; DSA Notion MODULE 15). The terms rule must match the API. Screen behaviour is
// covered by the UI journey, not here, because the screens need the auth provider.
import { describe, expect, it } from 'vitest';
import { isValidTerms } from './ProductDetailPage';
import { APPLICANT_TYPES, CATEGORY_LABELS, PRODUCT_CATEGORIES } from './ProductsPage';

const ok = { amountMin: '100000.00', amountMax: '2500000.00', tenureMin: '12', tenureMax: '60' };

describe('products: terms rule (TEST-PRD-WEB-001)', () => {
  it('accepts a well-formed version', () => {
    expect(isValidTerms(ok)).toBe(true);
    expect(isValidTerms({ ...ok, amountMin: '500000', amountMax: '500000' })).toBe(true);
  });

  it('rejects amounts that the API would refuse as S3 or malformed money', () => {
    expect(isValidTerms({ ...ok, amountMin: '' })).toBe(false);
    expect(isValidTerms({ ...ok, amountMin: '1,00,000' })).toBe(false);
    expect(isValidTerms({ ...ok, amountMin: '100000.123' })).toBe(false);
    expect(isValidTerms({ ...ok, amountMax: '-5' })).toBe(false);
  });

  it('rejects a maximum below the minimum', () => {
    expect(isValidTerms({ ...ok, amountMin: '500000.00', amountMax: '100000.00' })).toBe(false);
  });

  it('rejects tenures that are not whole months from 1 upward, or that are inverted', () => {
    expect(isValidTerms({ ...ok, tenureMin: '0' })).toBe(false);
    expect(isValidTerms({ ...ok, tenureMin: '12.5' })).toBe(false);
    expect(isValidTerms({ ...ok, tenureMin: '60', tenureMax: '12' })).toBe(false);
    expect(isValidTerms({ ...ok, tenureMax: '' })).toBe(false);
  });
});

describe('products: reference data (TEST-PRD-WEB-002)', () => {
  it('has a label for every category the API accepts', () => {
    for (const c of PRODUCT_CATEGORIES) {
      expect(CATEGORY_LABELS[c]).toBeTruthy();
    }
    expect(Object.keys(CATEGORY_LABELS).sort()).toEqual([...PRODUCT_CATEGORIES].sort());
  });

  it('lists the seven applicant types in the spec', () => {
    expect(APPLICANT_TYPES).toHaveLength(7);
  });
});
