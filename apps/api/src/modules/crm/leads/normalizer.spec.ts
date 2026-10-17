// apps/api/src/modules/crm/leads/normalizer.spec.ts — owner: Dev 5 (TASK-107)
import { describe, expect, it } from 'vitest';
import {
  assertNoS3Data,
  computeEmailHash,
  computeMobileHash,
  maskEmail,
  maskMobile,
  normalizeEmail,
  normalizeMobile,
  validatePincode,
} from './normalizer';

describe('TASK-107 Normalizer & S3 Privacy', () => {
  describe('normalizeMobile', () => {
    it('normalizes 10-digit Indian numbers to E.164 with +91', () => {
      expect(normalizeMobile('9876543210')).toBe('+919876543210');
      expect(normalizeMobile('98765 43210')).toBe('+919876543210');
      expect(normalizeMobile('98765-43210')).toBe('+919876543210');
      expect(normalizeMobile('(98765) 43210')).toBe('+919876543210');
    });

    it('normalizes 11-digit numbers with leading 0', () => {
      expect(normalizeMobile('09876543210')).toBe('+919876543210');
    });

    it('normalizes 12-digit numbers with leading 91', () => {
      expect(normalizeMobile('919876543210')).toBe('+919876543210');
    });

    it('preserves valid international E.164 numbers', () => {
      expect(normalizeMobile('+919876543210')).toBe('+919876543210');
      expect(normalizeMobile('+14155552671')).toBe('+14155552671');
    });

    it('throws VALIDATION_ERROR on invalid numbers', () => {
      expect(() => normalizeMobile('')).toThrowError(/cannot be empty/i);
      expect(() => normalizeMobile('1234')).toThrowError(/Invalid mobile number/i);
      expect(() => normalizeMobile('abcd1234ef')).toThrowError(/Invalid mobile number/i);
    });
  });

  describe('computeMobileHash & computeEmailHash', () => {
    it('produces deterministic HMAC-SHA256 Buffer scoped to tenant', () => {
      const hash1 = computeMobileHash('ten_A', '+919876543210');
      const hash2 = computeMobileHash('ten_A', '+919876543210');
      const hashDiffTenant = computeMobileHash('ten_B', '+919876543210');

      expect(Buffer.isBuffer(hash1)).toBe(true);
      expect(hash1.equals(hash2)).toBe(true);
      expect(hash1.equals(hashDiffTenant)).toBe(false);
    });

    it('produces deterministic email hash', () => {
      const h1 = computeEmailHash('ten_1', 'user@example.com');
      const h2 = computeEmailHash('ten_1', 'user@example.com');
      expect(h1.equals(h2)).toBe(true);
    });
  });

  describe('normalizeEmail', () => {
    it('trims and lowercases email', () => {
      expect(normalizeEmail('  User.Name@Example.COM  ')).toBe('user.name@example.com');
      expect(normalizeEmail(null)).toBeNull();
      expect(normalizeEmail('')).toBeNull();
    });

    it('throws VALIDATION_ERROR for invalid email syntax', () => {
      expect(() => normalizeEmail('not-an-email')).toThrowError(/Invalid email/i);
      expect(() => normalizeEmail('user@')).toThrowError(/Invalid email/i);
      expect(() => normalizeEmail('@domain.com')).toThrowError(/Invalid email/i);
    });
  });

  describe('validatePincode', () => {
    it('validates 6-digit postal code', () => {
      expect(validatePincode('560001')).toBe('560001');
      expect(validatePincode(null)).toBeNull();
      expect(validatePincode('')).toBeNull();
    });

    it('throws VALIDATION_ERROR for invalid pincode', () => {
      expect(() => validatePincode('12345')).toThrowError(/6-digit/i);
      expect(() => validatePincode('060001')).toThrowError(/6-digit/i); // pincode cannot start with 0
      expect(() => validatePincode('56000A')).toThrowError(/6-digit/i);
    });
  });

  describe('assertNoS3Data', () => {
    it('passes clean text', () => {
      expect(() => assertNoS3Data('Regular Customer Name', 'name')).not.toThrow();
      expect(() => assertNoS3Data(null)).not.toThrow();
    });

    it('rejects PAN card numbers', () => {
      expect(() => assertNoS3Data('My PAN is ABCDE1234F for reference', 'note')).toThrowError(
        /prohibited PAN pattern/i,
      );
    });

    it('rejects Aadhaar card numbers', () => {
      expect(() => assertNoS3Data('Aadhaar 2345 6789 0123', 'note')).toThrowError(
        /prohibited Aadhaar pattern/i,
      );
    });

    it('rejects bank account numbers', () => {
      expect(() => assertNoS3Data('Acct 12345678901234', 'note')).toThrowError(/prohibited account number/i);
    });
  });

  describe('masking', () => {
    it('masks mobile number', () => {
      expect(maskMobile('+919876543210')).toBe('+91 ****** 3210');
    });

    it('masks email address', () => {
      expect(maskEmail('john.doe@example.com')).toBe('j***e@example.com');
      expect(maskEmail('ab@example.com')).toBe('a***@example.com');
      expect(maskEmail(null)).toBeNull();
    });
  });
});
