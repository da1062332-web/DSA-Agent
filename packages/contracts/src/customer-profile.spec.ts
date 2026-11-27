// TEST-CUST-P102 contract rules for the customer profile, identity and addresses (task P1-02). Synthetic values only.
import { describe, expect, it } from 'vitest';
import {
  CustomerAddressCreate,
  CustomerAddressUpdate,
  CustomerIdentityUpsert,
  CustomerProfileUpsert,
  CustomerRevealRequest,
  ageOn,
  isRealDate,
} from './customer-profile';

describe('TEST-CUST-P102 customer profile contracts', () => {
  it('TEST-CUST-P102-10 PAN is upper-cased and validated; Aadhaar is refused on the identity body', () => {
    expect(CustomerIdentityUpsert.parse({ pan: 'abcde1234f' }).pan).toBe('ABCDE1234F');
    expect(CustomerIdentityUpsert.safeParse({ pan: 'ABCD1234F' }).success).toBe(false);
    expect(CustomerIdentityUpsert.safeParse({ aadhaar: '123412341234' }).success).toBe(false);
    expect(CustomerIdentityUpsert.safeParse({}).success).toBe(false);
    expect(CustomerIdentityUpsert.parse({ pan: null }).pan).toBeNull();
    expect(CustomerIdentityUpsert.safeParse({ dateOfBirth: '1990/01/31' }).success).toBe(false);
  });

  it('TEST-CUST-P102-11 the profile refuses S3 fields, bad GSTIN or Udyam, negative or non-INR money', () => {
    expect(CustomerProfileUpsert.safeParse({ pan: 'ABCDE1234F' }).success).toBe(false);
    expect(CustomerProfileUpsert.safeParse({ dateOfBirth: '1990-01-01' }).success).toBe(false);
    expect(CustomerProfileUpsert.parse({ gstin: '27abcde1234f1z5' }).gstin).toBe('27ABCDE1234F1Z5');
    expect(CustomerProfileUpsert.safeParse({ gstin: '27ABCDE1234F1X5' }).success).toBe(false);
    expect(CustomerProfileUpsert.safeParse({ udyamNumber: 'UDYAM-MH-01-0001234' }).success).toBe(true);
    expect(CustomerProfileUpsert.safeParse({ udyamNumber: 'UDYAM-MH-1-1234' }).success).toBe(false);
    expect(
      CustomerProfileUpsert.safeParse({ monthlyIncome: { amount: '60000.00', currency: 'INR' } }).success,
    ).toBe(true);
    expect(
      CustomerProfileUpsert.safeParse({ monthlyIncome: { amount: '-1.00', currency: 'INR' } }).success,
    ).toBe(false);
    expect(
      CustomerProfileUpsert.safeParse({ monthlyIncome: { amount: '100.00', currency: 'USD' } }).success,
    ).toBe(false);
    expect(
      CustomerProfileUpsert.safeParse({ monthlyIncome: { amount: 60000, currency: 'INR' } }).success,
    ).toBe(false);
  });

  it('TEST-CUST-P102-12 free text refuses PAN, Aadhaar and account-like numbers', () => {
    expect(CustomerProfileUpsert.safeParse({ employerName: 'Acme ABCDE1234F' }).success).toBe(false);
    expect(
      CustomerAddressCreate.safeParse({
        addressType: 'CURRENT',
        line1: 'Flat 4, 1234 5678 9012',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
      }).success,
    ).toBe(false);
    expect(CustomerRevealRequest.safeParse({ field: 'PAN', reason: 'account 123456789012' }).success).toBe(
      false,
    );
    expect(CustomerRevealRequest.safeParse({ field: 'PAN', reason: 'lender query from HDFC' }).success).toBe(
      true,
    );
  });

  it('TEST-CUST-P102-13 addresses need a six-digit pincode not starting with 0; an update needs a field and cannot change the type', () => {
    const ok = { addressType: 'CURRENT', line1: 'Flat 4, Shanti Nagar', city: 'Pune', state: 'Maharashtra' };
    expect(CustomerAddressCreate.safeParse({ ...ok, pincode: '411001' }).success).toBe(true);
    expect(CustomerAddressCreate.safeParse({ ...ok, pincode: '011001' }).success).toBe(false);
    expect(CustomerAddressCreate.safeParse({ ...ok, pincode: '41100' }).success).toBe(false);
    expect(CustomerAddressUpdate.safeParse({}).success).toBe(false);
    expect(CustomerAddressUpdate.safeParse({ addressType: 'OFFICE' }).success).toBe(false);
    expect(CustomerAddressUpdate.safeParse({ city: 'Mumbai' }).success).toBe(true);
  });

  it('TEST-CUST-P102-14 age is whole years on the given day, and impossible dates are refused', () => {
    const now = new Date('2026-11-27T06:00:00Z');
    expect(ageOn('2000-11-27', now)).toBe(26);
    expect(ageOn('2000-11-28', now)).toBe(25);
    expect(ageOn('2008-11-28', now)).toBe(17);
    expect(isRealDate('2024-02-29')).toBe(true);
    expect(isRealDate('2026-02-29')).toBe(false);
    expect(isRealDate('2026-13-01')).toBe(false);
  });
});
