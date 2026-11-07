// The keys that protect data at rest and the keyed hashes (blind indexes) used to find rows. Owner: Dev 1 (security hardening, 2026-11-07).
//
// Production must supply each variable in PRODUCTION_SECRET_VARIABLES. A missing or short value stops the process at startup, and the message
// names the variable, never its value. Development and test use the labelled values below. Those values are reached only outside production:
// secretFromEnv refuses to return them when NODE_ENV is production.
//
// Blind indexes can be re-keyed without losing existing rows. Set the new value as <NAME> and the old one as <NAME>_PREVIOUS. Lookups match
// either hash, and new rows are always written with the current key. Re-hashing the old rows is a separate backfill (docs/SECRET_ROTATION.md).
// Encryption keys have no read path in the application today, so they have no _PREVIOUS variable.

import { createHmac } from 'node:crypto';

export const SECRET_MIN_LENGTH = 32;

/** The variables production requires. Each must be at least SECRET_MIN_LENGTH characters. */
export const PRODUCTION_SECRET_VARIABLES = [
  'ENCRYPTION_KEY',
  'HMAC_SECRET',
  'MOBILE_HMAC_SECRET',
  'REC_HMAC_SALT',
  'DOCUMENT_UPLOAD_SESSION_SECRET',
] as const;

export type SecretName = (typeof PRODUCTION_SECRET_VARIABLES)[number];

/** Explicit development and test values. They are never used when NODE_ENV is production. */
const DEVELOPMENT_VALUES: Record<SecretName, string> = {
  ENCRYPTION_KEY: 'dev_dsa_encryption_key_32_bytes!',
  HMAC_SECRET: 'dev_dsa_hmac_secret_key_32_bytes_long!!',
  MOBILE_HMAC_SECRET: 'dsa_mobile_hmac_default_secret_key_32',
  REC_HMAC_SALT: 'dsa_reconciliation_salt_2026',
  DOCUMENT_UPLOAD_SESSION_SECRET: 'dsa_upload_session_signing_secret_2026',
};

/** A value that is set in production must be long enough to be a secret. */
export function checkedSecret(name: string, value: string): string {
  if (value.length < SECRET_MIN_LENGTH) {
    throw new Error(`${name} must be at least ${SECRET_MIN_LENGTH} characters.`);
  }
  return value;
}

/** Returns the secret named by the variable. In production the variable is required; elsewhere the development value is used when it is unset. */
export function secretFromEnv(name: SecretName, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (value !== undefined && value !== '') {
    return env.NODE_ENV === 'production' ? checkedSecret(name, value) : value;
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(`${name} is required in production (at least ${SECRET_MIN_LENGTH} characters).`);
  }
  return DEVELOPMENT_VALUES[name];
}

/** The previous key for a blind index, when one is configured. It is not length-checked: it may be a value that was used before this rule. */
export function previousSecretFromEnv(
  name: SecretName,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = env[`${name}_PREVIOUS`];
  return value === undefined || value === '' ? undefined : value;
}

export interface BlindIndexKeys {
  current: string;
  /** Present only when <NAME>_PREVIOUS is set. Lookups then match either hash. */
  previous?: string;
}

export function blindIndexKeys(name: SecretName, env: NodeJS.ProcessEnv = process.env): BlindIndexKeys {
  const previous = previousSecretFromEnv(name, env);
  return previous === undefined
    ? { current: secretFromEnv(name, env) }
    : { current: secretFromEnv(name, env), previous };
}

/**
 * The tenant-scoped keyed hash used as a blind index: HMAC-SHA-256 keyed with "<secret>:<tenantId>". Mobile numbers and e-mail addresses use
 * MOBILE_HMAC_SECRET (leads, customers, imports). Shared here so every module computes it the same way.
 */
export function tenantBlindIndex(
  name: SecretName,
  tenantId: string,
  value: string,
  key: string = blindIndexKeys(name).current,
): Buffer {
  return createHmac('sha256', `${key}:${tenantId}`).update(value).digest();
}

/**
 * The key for finance payment-reference encryption. FINANCE_ENCRYPTION_KEY, when set, takes precedence (as before); otherwise the shared
 * ENCRYPTION_KEY is used, which production requires anyway.
 */
export function financeEncryptionKeySource(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.FINANCE_ENCRYPTION_KEY;
  if (explicit !== undefined && explicit !== '') {
    return env.NODE_ENV === 'production' ? checkedSecret('FINANCE_ENCRYPTION_KEY', explicit) : explicit;
  }
  return secretFromEnv('ENCRYPTION_KEY', env);
}
