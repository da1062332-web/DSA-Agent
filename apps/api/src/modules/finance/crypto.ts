// apps/api/src/modules/finance/crypto.ts — Cryptographic utilities for MOD-PAY
import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const DEFAULT_KEY_SOURCE = process.env.FINANCE_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || 'dsa-crm-default-finance-key-32b!';

function resolveKey(keySource?: string): Buffer {
  return crypto.createHash('sha256').update(keySource || DEFAULT_KEY_SOURCE).digest();
}

/**
 * Encrypts sensitive financial identifiers (e.g. payment UTR, bank account number) using AES-256-GCM.
 * Formats output as: "aes256gcm:<iv_hex>:<tag_hex>:<ciphertext_hex>"
 */
export function encryptPaymentRef(plaintext: string, secretKey?: string): string {
  const key = resolveKey(secretKey);
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `aes256gcm:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts sensitive financial identifiers previously encrypted with AES-256-GCM.
 */
export function decryptPaymentRef(ciphertext: string, secretKey?: string): string {
  if (!ciphertext.startsWith('aes256gcm:')) {
    // If legacy base64 encoded string, decode directly
    return Buffer.from(ciphertext, 'base64').toString('utf8');
  }

  const parts = ciphertext.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid ciphertext format for payment reference.');
  }

  const [, ivHex, tagHex, dataHex] = parts;
  const key = resolveKey(secretKey);
  const iv = Buffer.from(ivHex!, 'hex');
  const tag = Buffer.from(tagHex!, 'hex');
  const encrypted = Buffer.from(dataHex!, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Masks a financial reference retaining only the last 4 characters for safe display and logging.
 */
export function maskPaymentRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const trimmed = ref.trim();
  if (trimmed.length <= 4) return '******';
  return `******${trimmed.slice(-4)}`;
}
