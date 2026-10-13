// apps/api/src/modules/crm/customers/normalizer.spec.ts — owner: Dev 5 (MOD-CUST)
import { describe, expect, it } from 'vitest';
import {
  assertNoS3Data,
  computeEmailHash,
  computeMobileHash,
  maskEmail,
  maskMobile,
  maskName,
  normalizeEmail,
  normalizeMobile,
} from './normalizer';

describe('Customer Normalizer, Hashing, and Privacy', () => {
  describe('normalizeMobile', () => {
    it('normalizes 10-digit Indian numbers to E.164', () => {
      expect(normalizeMobile('9876543210')).toBe('+919876543210');
      expect(normalizeMobile('  8123456789  ')).toBe('+918123456789');
    });

    it('strips formatting characters like spaces, dashes, and parens', () => {
      expect(normalizeMobile('+91 (987) 654-3210')).toBe('+919876543210');
    });

    it('handles 11-digit numbers starting with 0', () => {
      expect(normalizeMobile('09876543210')).toBe('+919876543210');
    });

    it('handles 12-digit numbers starting with 91', () => {
      expect(normalizeMobile('919876543210')).toBe('+919876543210');
    });

    it('preserves valid international E.164 numbers', () => {
      expect(normalizeMobile('+14155552671')).toBe('+14155552671');
      expect(normalizeMobile('+447911123456')).toBe('+447911123456');
    });

    it('throws VALIDATION_ERROR on invalid or too short inputs', () => {
      expect(() => normalizeMobile('123')).toThrowError(/Invalid mobile number format/);
      expect(() => normalizeMobile('')).toThrowError(/cannot be empty/);
      expect(() => normalizeMobile('abcdefghij')).toThrowError(/Invalid mobile number format/);
    });
  });

  describe('HMAC Hashing', () => {
    it('produces identical HMAC for identical inputs in the same tenant', () => {
      const hash1 = computeMobileHash('ten_001', '+919876543210');
      const hash2 = computeMobileHash('ten_001', '+919876543210');
      expect(hash1.equals(hash2)).toBe(true);
    });

    it('produces different HMAC for different tenants with the same mobile', () => {
      const hash1 = computeMobileHash('ten_001', '+919876543210');
      const hash2 = computeMobileHash('ten_002', '+919876543210');
      expect(hash1.equals(hash2)).toBe(false);
    });

    it('produces different HMAC for email across tenants', () => {
      const hash1 = computeEmailHash('ten_001', 'test@example.com');
      const hash2 = computeEmailHash('ten_002', 'test@example.com');
      expect(hash1.equals(hash2)).toBe(false);
    });
  });

  describe('normalizeEmail', () => {
    it('lowercases and trims valid emails', () => {
      expect(normalizeEmail('  Customer.Test@Example.COM  ')).toBe('customer.test@example.com');
    });

    it('returns null for null or empty strings', () => {
      expect(normalizeEmail(null)).toBeNull();
      expect(normalizeEmail('')).toBeNull();
      expect(normalizeEmail('   ')).toBeNull();
    });

    it('throws VALIDATION_ERROR for malformed email addresses', () => {
      expect(() => normalizeEmail('invalid-email')).toThrowError(/Invalid email/);
      expect(() => normalizeEmail('user@')).toThrowError(/Invalid email/);
      expect(() => normalizeEmail('@domain.com')).toThrowError(/Invalid email/);
    });
  });

  describe('assertNoS3Data', () => {
    it('permits clean text without sensitive financial/identity data', () => {
      expect(() => assertNoS3Data('Acme Global Enterprises Pvt Ltd', 'fullName')).not.toThrow();
      expect(() => assertNoS3Data('Sunil Kumar Verma', 'fullName')).not.toThrow();
      expect(() => assertNoS3Data(null)).not.toThrow();
    });

    it('rejects PAN pattern in text', () => {
      expect(() => assertNoS3Data('Customer with PAN ABCDE1234F', 'notes')).toThrowError(
        /prohibited PAN pattern/,
      );
    });

    it('rejects Aadhaar pattern in text', () => {
      expect(() => assertNoS3Data('Aadhaar number 2345 6789 0123 provided', 'notes')).toThrowError(
        /prohibited Aadhaar pattern/,
      );
    });

    it('rejects bank account numbers (9-18 digits)', () => {
      expect(() => assertNoS3Data('Account 123456789012345', 'notes')).toThrowError(
        /prohibited account number pattern/,
      );
    });
  });

  describe('Masking', () => {
    it('masks mobile numbers correctly', () => {
      expect(maskMobile('+919876543210')).toBe('+91 ****** 3210');
      expect(maskMobile(null)).toBeNull();
    });

    it('masks email addresses correctly', () => {
      expect(maskEmail('rahul.verma@example.com')).toBe('r***a@example.com');
      expect(maskEmail('ab@test.com')).toBe('a***@test.com');
      expect(maskEmail(null)).toBeNull();
    });

    it('masks full names correctly for party port', () => {
      expect(maskName('Rahul Sharma')).toBe('R***l S****a');
      expect(maskName('Acme Corp')).toBe('A**e C**p');
    });
  });
});
