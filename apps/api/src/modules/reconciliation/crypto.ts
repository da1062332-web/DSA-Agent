// apps/api/src/modules/reconciliation/crypto.ts
import crypto from 'node:crypto';
import { blindIndexKeys } from '../../secrets';

/**
 * Creates a deterministic keyed hash (HMAC-SHA-256) of a loan account number for S2 privacy-preserving matching. The key comes from
 * REC_HMAC_SALT, required in production. Rows are written with the current key; see loanAccountHashCandidates for the matching rule.
 */
export function hashLoanAccount(
  loanAccount: string,
  key: string = blindIndexKeys('REC_HMAC_SALT').current,
): string {
  return crypto.createHmac('sha256', key).update(loanAccount.trim().toUpperCase()).digest('hex');
}

/**
 * The hashes a stored loan-account hash may match: the current key, and the previous key when REC_HMAC_SALT_PREVIOUS is set. Lookups
 * accept either, so changing the key does not lose the matches of rows written before the change.
 */
export function loanAccountHashCandidates(loanAccount: string): string[] {
  const keys = blindIndexKeys('REC_HMAC_SALT');
  const hashes = [hashLoanAccount(loanAccount, keys.current)];
  if (keys.previous !== undefined) hashes.push(hashLoanAccount(loanAccount, keys.previous));
  return hashes;
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
