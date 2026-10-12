// apps/api/src/modules/crm/leads/normalizer.ts — owner: Dev 5 (TASK-107)
import { AppError } from '@dsa/contracts';
import crypto from 'node:crypto';

const HMAC_SECRET = process.env.MOBILE_HMAC_SECRET || 'dsa_mobile_hmac_default_secret_key_32';

/** Normalizes a phone number to canonical E.164. Supports 10-digit Indian numbers and standard E.164. */
export function normalizeMobile(raw: string): string {
  const cleaned = raw.trim().replace(/[\s\-()]/g, '');
  if (!cleaned) {
    throw AppError.of('VALIDATION_ERROR', 'Mobile number cannot be empty', [
      { field: 'mobile', issue: 'REQUIRED' },
    ]);
  }

  // If already E.164
  if (/^\+[1-9][0-9]{7,14}$/.test(cleaned)) {
    return cleaned;
  }

  // 10-digit Indian mobile
  if (/^[6-9][0-9]{9}$/.test(cleaned)) {
    return `+91${cleaned}`;
  }

  // 11-digit starting with 0
  if (/^0[6-9][0-9]{9}$/.test(cleaned)) {
    return `+91${cleaned.slice(1)}`;
  }

  // 12-digit starting with 91
  if (/^91[6-9][0-9]{9}$/.test(cleaned)) {
    return `+${cleaned}`;
  }

  throw AppError.of('VALIDATION_ERROR', 'Invalid mobile number format. Expected E.164 standard.', [
    { field: 'mobile', issue: 'INVALID_E164' },
  ]);
}

/** Computes tenant-scoped HMAC-SHA-256 for mobile matching. */
export function computeMobileHash(tenantId: string, mobileE164: string): Buffer {
  return crypto
    .createHmac('sha256', `${HMAC_SECRET}:${tenantId}`)
    .update(mobileE164)
    .digest();
}

/** Normalizes email to lowercase citext without destructive transforms. */
export function normalizeEmail(raw?: string | null): string | null {
  if (!raw || raw.trim().length === 0) return null;
  const cleaned = raw.trim().toLowerCase();
  const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  if (!emailRegex.test(cleaned)) {
    throw AppError.of('VALIDATION_ERROR', 'Invalid email address format', [
      { field: 'email', issue: 'INVALID_EMAIL' },
    ]);
  }
  return cleaned;
}

/** Computes tenant-scoped HMAC-SHA-256 for email. */
export function computeEmailHash(tenantId: string, email: string): Buffer {
  return crypto
    .createHmac('sha256', `${HMAC_SECRET}:${tenantId}`)
    .update(email)
    .digest();
}

/** Validates 6-digit Indian postal code. */
export function validatePincode(raw?: string | null): string | null {
  if (!raw || raw.trim().length === 0) return null;
  const cleaned = raw.trim();
  if (!/^[1-9][0-9]{5}$/.test(cleaned)) {
    throw AppError.of('VALIDATION_ERROR', 'Pincode must be a valid 6-digit postal code', [
      { field: 'pincode', issue: 'INVALID_PINCODE' },
    ]);
  }
  return cleaned;
}

/** Enforces no S3-class data (PAN, Aadhaar, account numbers) in free-text fields (ADR-4D-04). */
export function assertNoS3Data(text?: string | null, fieldName = 'text'): void {
  if (!text) return;

  // PAN pattern: 5 uppercase letters, 4 digits, 1 uppercase letter
  if (/[A-Z]{5}[0-9]{4}[A-Z]/i.test(text)) {
    throw AppError.of('VALIDATION_ERROR', `${fieldName} contains prohibited PAN pattern`, [
      { field: fieldName, issue: 'PROHIBITED_S3_DATA' },
    ]);
  }

  // Aadhaar pattern: 12 digits (with optional spaces)
  if (/\b[2-9][0-9]{3}\s?[0-9]{4}\s?[0-9]{4}\b/.test(text)) {
    throw AppError.of('VALIDATION_ERROR', `${fieldName} contains prohibited Aadhaar pattern`, [
      { field: fieldName, issue: 'PROHIBITED_S3_DATA' },
    ]);
  }

  // Bank account: 9–18 digit sequences
  if (/\b[0-9]{9,18}\b/.test(text)) {
    throw AppError.of('VALIDATION_ERROR', `${fieldName} contains prohibited account number pattern`, [
      { field: fieldName, issue: 'PROHIBITED_S3_DATA' },
    ]);
  }
}

/** Masks mobile number for safe display (e.g., +91 ****** 3210). */
export function maskMobile(mobileE164: string): string {
  if (mobileE164.length < 8) return '******';
  const prefix = mobileE164.slice(0, 3);
  const suffix = mobileE164.slice(-4);
  return `${prefix} ****** ${suffix}`;
}

/** Masks email address for safe display (e.g., j***e@domain.com). */
export function maskEmail(email?: string | null): string | null {
  if (!email) return null;
  const parts = email.split('@');
  if (parts.length !== 2) return '******';
  const name = parts[0] ?? '';
  const domain = parts[1] ?? '';
  if (name.length <= 2) {
    return `${name.charAt(0)}***@${domain}`;
  }
  return `${name.charAt(0)}***${name.charAt(name.length - 1)}@${domain}`;
}
