// apps/api/src/modules/crm/customers/identity-crypto.ts — owner: Bhushan (MOD-CUST, task P1-02).
// Field encryption for a customer's PAN and date of birth, and the keyed hash that finds a duplicate PAN without decrypting.
//
// Encryption: AES-256-GCM with a key derived from ENCRYPTION_KEY (src/secrets.ts; production requires it, no literal fallback). The
// additional authenticated data binds each ciphertext to its tenant, customer and field, so a ciphertext copied to another row or field
// fails to decrypt instead of revealing the wrong person's PAN. Stored layout: [version 0x01][12-byte IV][16-byte tag][ciphertext].
// Hash: HMAC-SHA-256 keyed with "<HMAC_SECRET>:<tenantId>" (tenantBlindIndex), the same blind index connectors use for their PAN.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { blindIndexKeys, secretFromEnv, tenantBlindIndex } from '../../../secrets';

export type IdentityField = 'PAN' | 'DATE_OF_BIRTH';

const VERSION = 0x01;

function key(): Buffer {
  return createHash('sha256').update(secretFromEnv('ENCRYPTION_KEY')).digest();
}

function aad(tenantId: string, customerId: string, field: IdentityField): Buffer {
  return Buffer.from(`customer_identity:${tenantId}:${customerId}:${field}`, 'utf8');
}

export function encryptIdentityField(
  tenantId: string,
  customerId: string,
  field: IdentityField,
  plaintext: string,
): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(aad(tenantId, customerId, field));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), encrypted]);
}

export function decryptIdentityField(
  tenantId: string,
  customerId: string,
  field: IdentityField,
  stored: Buffer,
): string {
  if (stored.length < 1 + 12 + 16 + 1 || stored[0] !== VERSION) {
    throw new Error('Unreadable identity ciphertext.');
  }
  const iv = stored.subarray(1, 13);
  const tag = stored.subarray(13, 29);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAAD(aad(tenantId, customerId, field));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(stored.subarray(29)), decipher.final()]).toString('utf8');
}

/** The PAN hash written with the current key. */
export function panHash(tenantId: string, pan: string): Buffer {
  return tenantBlindIndex('HMAC_SECRET', tenantId, pan);
}

/** Hashes a stored PAN may carry: the current key, and the previous one while HMAC_SECRET_PREVIOUS is set. */
export function panHashCandidates(tenantId: string, pan: string): Buffer[] {
  const keys = blindIndexKeys('HMAC_SECRET');
  const hashes = [tenantBlindIndex('HMAC_SECRET', tenantId, pan, keys.current)];
  if (keys.previous !== undefined) hashes.push(tenantBlindIndex('HMAC_SECRET', tenantId, pan, keys.previous));
  return hashes;
}
