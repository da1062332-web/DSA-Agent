// apps/api/src/modules/origination/verifications/keyed-hash.ts — owner: Prathamesh (MOD-VER). The keyed hashes behind the idempotency of the
// calls that carry a PAN, an account number, a date of birth or a name (POST /v1/verifications/checks, POST /v1/customers/{id}/credit-reports).
//
// withIdempotency stores a plain SHA-256 of the whole request, and a PAN or a date of birth hashed that way can be brute-forced offline. So
// those calls hand it a body in which each such value is replaced by a keyed hash (HMAC-SHA256). The key is derived from the deployment secret
// the way document-store.ts derives its keys, with a label of its own. This is the only place that derives it, so every caller hashes alike.
import crypto from 'node:crypto';

/** Used when no deployment secret is configured (development and tests), like the documents module does. One per process. */
const processSecret = crypto.randomBytes(32).toString('hex');

const KEY_LABEL = 'dsa:verification-idempotency:v1';

/** `(label, value) => hex`: the HMAC of one value under a key derived from `secret` (at least 32 characters, else the process secret). */
export function createKeyedHasher(secret: string | undefined): (label: string, value: string) => string {
  const key = crypto
    .createHmac('sha256', secret && secret.length >= 32 ? secret : processSecret)
    .update(KEY_LABEL)
    .digest();
  return (label, value) => crypto.createHmac('sha256', key).update(`${label}\n${value}`).digest('hex');
}

/** The vendor's case id: stable for one Idempotency-Key (the scope the key has: tenant, user, key), so a retry reaches the vendor with the same id. */
export function vendorCaseId(
  keyed: (label: string, value: string) => string,
  tenantId: string,
  userId: string,
  idempotencyKey: string,
): string {
  return `idem_${keyed('case', `${tenantId}:${userId}:${idempotencyKey}`).slice(0, 20)}`;
}
