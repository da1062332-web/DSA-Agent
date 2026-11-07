// apps/api/src/modules/crm/customers/normalizer.ts — owner: Dev 5 (MOD-CUST)
import { AppError } from '@dsa/contracts';
import { blindIndexKeys, tenantBlindIndex } from '../../../secrets';

// The keyed hashes used for lookup take their key from MOBILE_HMAC_SECRET (required in production; see src/secrets.ts).

/** Normalizes a phone number to canonical E.164 standard. */
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

/** Computes tenant-scoped HMAC-SHA-256 for mobile matching. Rows are written with the current key. */
export function computeMobileHash(
  tenantId: string,
  mobileE164: string,
  secret: string = blindIndexKeys('MOBILE_HMAC_SECRET').current,
): Buffer {
  return tenantBlindIndex('MOBILE_HMAC_SECRET', tenantId, mobileE164, secret);
}

/** The hashes a stored mobile hash may match: the current key, and the previous key when MOBILE_HMAC_SECRET_PREVIOUS is set. */
export function mobileHashCandidates(tenantId: string, mobileE164: string): Buffer[] {
  const keys = blindIndexKeys('MOBILE_HMAC_SECRET');
  const hashes = [computeMobileHash(tenantId, mobileE164, keys.current)];
  if (keys.previous !== undefined) hashes.push(computeMobileHash(tenantId, mobileE164, keys.previous));
  return hashes;
}

/** Normalizes email address. */
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

/** Computes tenant-scoped HMAC-SHA-256 for email matching. Rows are written with the current key. */
export function computeEmailHash(
  tenantId: string,
  email: string,
  secret: string = blindIndexKeys('MOBILE_HMAC_SECRET').current,
): Buffer {
  return tenantBlindIndex('MOBILE_HMAC_SECRET', tenantId, email, secret);
}

/** The hashes a stored e-mail hash may match: the current key, and the previous key when MOBILE_HMAC_SECRET_PREVIOUS is set. */
export function emailHashCandidates(tenantId: string, email: string): Buffer[] {
  const keys = blindIndexKeys('MOBILE_HMAC_SECRET');
  const hashes = [computeEmailHash(tenantId, email, keys.current)];
  if (keys.previous !== undefined) hashes.push(computeEmailHash(tenantId, email, keys.previous));
  return hashes;
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

/** Masks mobile number for safe display (e.g. +91 ****** 3210). */
export function maskMobile(mobileE164?: string | null): string | null {
  if (!mobileE164) return null;
  if (mobileE164.length < 8) return '******';
  const prefix = mobileE164.slice(0, 3);
  const suffix = mobileE164.slice(-4);
  return `${prefix} ****** ${suffix}`;
}

/** Masks email address for safe display (e.g. j***e@domain.com). */
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

/** Masks customer name for party port display (e.g. "R**** Sharma"). */
export function maskName(fullName: string): string {
  const words = fullName.trim().split(/\s+/);
  return words
    .map((w) => {
      if (w.length <= 2) return w;
      return `${w.charAt(0)}${'*'.repeat(Math.max(1, w.length - 2))}${w.slice(-1)}`;
    })
    .join(' ');
}
