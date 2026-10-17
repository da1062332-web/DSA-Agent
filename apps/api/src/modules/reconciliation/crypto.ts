// apps/api/src/modules/reconciliation/crypto.ts
import crypto from 'node:crypto';

const HMAC_SALT = process.env.REC_HMAC_SALT || 'dsa_reconciliation_salt_2026';

/**
 * Creates a deterministic SHA-256 HMAC hash of a loan account number
 * for S2 privacy-preserving matching.
 */
export function hashLoanAccount(loanAccount: string): string {
  return crypto.createHmac('sha256', HMAC_SALT).update(loanAccount.trim().toUpperCase()).digest('hex');
}

/**
 * Masks customer name for S2 privacy compliance (e.g., "Rajesh Sharma" -> "R***** S*****")
 */
export function maskCustomerName(name: string): string {
  if (!name || name.trim().length === 0) return '***';
  const parts = name.trim().split(/\s+/);
  return parts
    .map((part) => {
      if (part.length <= 1) return part;
      return `${part[0]}${'*'.repeat(Math.max(1, Math.min(part.length - 1, 5)))}`;
    })
    .join(' ');
}

/**
 * Computes SHA-256 hex digest of file buffer or content string
 */
export function computeSha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}
