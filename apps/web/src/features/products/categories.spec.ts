import { LOAN_CATEGORIES, ProductListQuerySchema } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import { PRODUCT_CATEGORY_OPTIONS, categoryLabel } from './types';

describe('product categories offered by the web app', () => {
  it('TEST-PRD-CAT-001 offers exactly the categories the API contract accepts', () => {
    expect(PRODUCT_CATEGORY_OPTIONS.map((o) => o.value)).toEqual([...LOAN_CATEGORIES]);
  });

  it('TEST-PRD-CAT-002 every offered category passes the API list query, so filtering never answers 422', () => {
    for (const { value } of PRODUCT_CATEGORY_OPTIONS) {
      expect(ProductListQuerySchema.safeParse({ category: value, limit: 100 }).success).toBe(true);
    }
  });

  it('TEST-PRD-CAT-003 the retired HOME_LOAN / BUSINESS_LOAN / PERSONAL_LOAN codes are rejected by the API, which is why they must not be sent', () => {
    for (const old of ['HOME_LOAN', 'BUSINESS_LOAN', 'PERSONAL_LOAN']) {
      expect(ProductListQuerySchema.safeParse({ category: old }).success).toBe(false);
    }
  });

  it('TEST-PRD-CAT-004 shows a readable name for a code, and an unknown code as it is', () => {
    expect(categoryLabel('HL')).toBe('Home loan');
    expect(categoryLabel('PL')).toBe('Personal loan');
    expect(categoryLabel('LEGACY')).toBe('LEGACY');
  });
});
