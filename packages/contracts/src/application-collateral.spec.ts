// TEST-APP-P103 contract rules for co-applicant relationships and property collateral (task P1-03). Synthetic values only.
import { describe, expect, it } from 'vitest';
import {
  CollateralCreate,
  CollateralUpdate,
  partyRelationshipIssue,
  relationshipsForPrimary,
} from './application-collateral';
import { moneyToPaise, paiseToMoney } from './lender-policy';

const VALID = {
  propertyType: 'RESIDENTIAL_FLAT',
  addressLine1: 'Flat 12, Shanti Heights, Baner Road',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411045',
  estimatedMarketValue: { amount: '5000000.00', currency: 'INR' },
  ownershipType: 'FREEHOLD',
};

describe('TEST-APP-P103 co-applicant relationship rule', () => {
  const rule = (
    role: 'CO_APPLICANT' | 'GUARANTOR',
    relationship: Parameters<typeof partyRelationshipIssue>[0]['relationship'],
    primaryPartyType: 'INDIVIDUAL' | 'ENTITY',
    partyType: 'INDIVIDUAL' | 'ENTITY',
  ) => partyRelationshipIssue({ role, relationship, primaryPartyType, partyType });

  it('TEST-APP-P103-01 a co-applicant must name a relationship; a guarantor may leave it out', () => {
    expect(rule('CO_APPLICANT', undefined, 'INDIVIDUAL', 'INDIVIDUAL')).toBe('REQUIRED');
    expect(rule('CO_APPLICANT', null, 'INDIVIDUAL', 'INDIVIDUAL')).toBe('REQUIRED');
    expect(rule('GUARANTOR', undefined, 'INDIVIDUAL', 'INDIVIDUAL')).toBeNull();
  });

  it('TEST-APP-P103-02 spouse, parent, child and sibling join two individuals only', () => {
    for (const r of ['SPOUSE', 'PARENT', 'CHILD', 'SIBLING'] as const) {
      expect(rule('CO_APPLICANT', r, 'INDIVIDUAL', 'INDIVIDUAL')).toBeNull();
      expect(rule('CO_APPLICANT', r, 'ENTITY', 'INDIVIDUAL')).toBe('FAMILY_NEEDS_INDIVIDUALS');
      expect(rule('CO_APPLICANT', r, 'INDIVIDUAL', 'ENTITY')).toBe('FAMILY_NEEDS_INDIVIDUALS');
    }
  });

  it('TEST-APP-P103-03 a director is an individual co-applying with a company; partner and other join anyone', () => {
    expect(rule('CO_APPLICANT', 'DIRECTOR', 'ENTITY', 'INDIVIDUAL')).toBeNull();
    expect(rule('CO_APPLICANT', 'DIRECTOR', 'INDIVIDUAL', 'INDIVIDUAL')).toBe('DIRECTOR_NEEDS_ENTITY');
    expect(rule('CO_APPLICANT', 'DIRECTOR', 'ENTITY', 'ENTITY')).toBe('DIRECTOR_NEEDS_ENTITY');
    expect(rule('CO_APPLICANT', 'PARTNER', 'ENTITY', 'ENTITY')).toBeNull();
    expect(rule('CO_APPLICANT', 'PARTNER', 'INDIVIDUAL', 'INDIVIDUAL')).toBeNull();
    expect(rule('GUARANTOR', 'OTHER', 'ENTITY', 'INDIVIDUAL')).toBeNull();
  });

  it('TEST-APP-P103-04 the form offers family ties to an individual applicant and director to a company', () => {
    expect(relationshipsForPrimary('INDIVIDUAL')).toEqual([
      'SPOUSE',
      'PARENT',
      'CHILD',
      'SIBLING',
      'PARTNER',
      'OTHER',
    ]);
    expect(relationshipsForPrimary('ENTITY')).toEqual(['PARTNER', 'DIRECTOR', 'OTHER']);
  });
});

describe('TEST-APP-P103 collateral contracts', () => {
  it('TEST-APP-P103-05 ₹50,00,000 is 500000000 paise and comes back as the same amount', () => {
    const parsed = CollateralCreate.parse(VALID);
    expect(moneyToPaise(parsed.estimatedMarketValue)).toBe(500_000_000);
    expect(paiseToMoney(500_000_000)).toEqual({ amount: '5000000.00', currency: 'INR' });
  });

  it('TEST-APP-P103-06 the value must be INR, above zero and within 13 rupee digits', () => {
    const value = (amount: string, currency = 'INR') =>
      CollateralCreate.safeParse({ ...VALID, estimatedMarketValue: { amount, currency } }).success;
    expect(value('0.00')).toBe(false);
    expect(value('0.01')).toBe(true);
    expect(value('5000000.00', 'USD')).toBe(false);
    expect(value('5000000')).toBe(false);
    expect(value('9999999999999.99')).toBe(true);
    expect(value('10000000000000.00')).toBe(false);
  });

  it('TEST-APP-P103-07 the address refuses identity or account numbers; the pincode, enums and date are checked', () => {
    expect(CollateralCreate.safeParse({ ...VALID, addressLine1: 'Flat 1, owner ABCDE1234F' }).success).toBe(
      false,
    );
    expect(CollateralCreate.safeParse({ ...VALID, city: 'Pune 123456789012' }).success).toBe(false);
    expect(CollateralCreate.safeParse({ ...VALID, pincode: '011045' }).success).toBe(false);
    expect(CollateralCreate.safeParse({ ...VALID, propertyType: 'AGRICULTURAL' }).success).toBe(false);
    expect(CollateralCreate.safeParse({ ...VALID, ownershipType: 'RENTED' }).success).toBe(false);
    expect(CollateralCreate.safeParse({ ...VALID, appraisalDate: '2026-02-30' }).success).toBe(false);
    expect(CollateralCreate.safeParse({ ...VALID, appraisalDate: '2026-11-01' }).success).toBe(true);
    expect(CollateralCreate.safeParse({ ...VALID, occupancyType: 'TENANTED' }).success).toBe(true);
  });

  it('TEST-APP-P103-08 unknown fields (an owner PAN, a tenant id) are refused; an update needs at least one field', () => {
    expect(CollateralCreate.safeParse({ ...VALID, ownerPan: 'ABCDE1234F' }).success).toBe(false);
    expect(CollateralCreate.safeParse({ ...VALID, tenantId: 'ten_x' }).success).toBe(false);
    expect(CollateralUpdate.safeParse({}).success).toBe(false);
    expect(CollateralUpdate.safeParse({ city: 'Mumbai' }).success).toBe(true);
  });
});
