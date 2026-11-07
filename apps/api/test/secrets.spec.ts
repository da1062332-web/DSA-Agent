// Secrets that protect data at rest and the blind indexes used for lookup (src/secrets.ts). Owner: Dev 1 (security hardening, 2026-11-07).
// Each test restores the environment it changes. Error messages must name a variable and never echo its value.
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import {
  PRODUCTION_SECRET_VARIABLES,
  blindIndexKeys,
  financeEncryptionKeySource,
  previousSecretFromEnv,
  secretFromEnv,
} from '../src/secrets';
import { encryptPaymentRef, decryptPaymentRef } from '../src/modules/finance/crypto';
import { loanAccountHashCandidates, hashLoanAccount } from '../src/modules/reconciliation/crypto';
import {
  computeMobileHash,
  emailHashCandidates,
  mobileHashCandidates,
} from '../src/modules/crm/leads/normalizer';

const HOSTED = 'https://mlpkwwhnagxzinaohdxg.supabase.co';
const STRONG = 'a'.repeat(64);
const DEV_LITERALS = [
  'dev_dsa_encryption_key_32_bytes!',
  'dev_dsa_hmac_secret_key_32_bytes_long!!',
  'dsa_mobile_hmac_default_secret_key_32',
  'dsa_reconciliation_salt_2026',
  'dsa_upload_session_signing_secret_2026',
];
const base = {
  DATABASE_URL: 'postgresql://dsa_api:s3cretvalue@localhost:5432/postgres',
  SUPABASE_URL: HOSTED,
} as NodeJS.ProcessEnv;
const productionEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  ...base,
  NODE_ENV: 'production',
  APP_SIGNING_SECRET: STRONG,
  ENCRYPTION_KEY: STRONG,
  HMAC_SECRET: STRONG,
  MOBILE_HMAC_SECRET: STRONG,
  REC_HMAC_SALT: STRONG,
  DOCUMENT_UPLOAD_SESSION_SECRET: STRONG,
  ...extra,
});

const saved: Record<string, string | undefined> = {};
function setEnv(values: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(values)) {
    if (!(k in saved)) saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete saved[k];
  }
});

describe('production secrets are required from configuration (TEST-SECRET)', () => {
  it('TEST-SECRET-01 production refuses to start without each required secret, and the message names only the variable', () => {
    for (const name of PRODUCTION_SECRET_VARIABLES) {
      const env = productionEnv();
      delete env[name];
      let message = '';
      try {
        loadConfig(env);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message, name).toContain(name);
      expect(message, name).toMatch(/required in production/);
    }
  });

  it('TEST-SECRET-02 production refuses a short value, and the message does not echo it', () => {
    const env = productionEnv({ HMAC_SECRET: 'short-value-1234' });
    let message = '';
    try {
      loadConfig(env);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/HMAC_SECRET/);
    expect(message).not.toContain('short-value-1234');
  });

  it('TEST-SECRET-03 production starts when every required secret is set and at least 32 characters', () => {
    expect(() => loadConfig(productionEnv())).not.toThrow();
  });

  it('TEST-SECRET-04 development and test start without them, and the explicit labelled values are used there', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'development' })).not.toThrow();
    setEnv({ NODE_ENV: 'development', HMAC_SECRET: undefined, ENCRYPTION_KEY: undefined });
    expect(secretFromEnv('HMAC_SECRET')).toBe('dev_dsa_hmac_secret_key_32_bytes_long!!');
  });

  it('TEST-SECRET-05 in production an unset secret is never replaced by a development literal', () => {
    setEnv({ NODE_ENV: 'production', MOBILE_HMAC_SECRET: undefined });
    let thrown: Error | undefined;
    try {
      secretFromEnv('MOBILE_HMAC_SECRET');
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown?.message).toMatch(/MOBILE_HMAC_SECRET is required in production/);
    for (const literal of DEV_LITERALS) expect(thrown?.message).not.toContain(literal);
  });

  it('TEST-SECRET-06 the upload-session signing secret is required in production (containment report 8.1A)', () => {
    const env = productionEnv();
    delete env.DOCUMENT_UPLOAD_SESSION_SECRET;
    expect(() => loadConfig(env)).toThrow(/DOCUMENT_UPLOAD_SESSION_SECRET/);
  });
});

describe('the previous key for a blind index (TEST-SECRET-PREV)', () => {
  it('TEST-SECRET-PREV-01 a previous key is read when set, and absent otherwise; it is not length-checked', () => {
    expect(
      previousSecretFromEnv('REC_HMAC_SALT', { REC_HMAC_SALT_PREVIOUS: 'dsa_reconciliation_salt_2026' }),
    ).toBe('dsa_reconciliation_salt_2026');
    expect(previousSecretFromEnv('REC_HMAC_SALT', { REC_HMAC_SALT_PREVIOUS: '' })).toBeUndefined();
    expect(blindIndexKeys('REC_HMAC_SALT', { NODE_ENV: 'test' })).toEqual({
      current: 'dsa_reconciliation_salt_2026',
    });
  });

  it('TEST-SECRET-PREV-02 a loan-account hash matches the current key and the previous key, and nothing else', () => {
    const oldKey = 'x'.repeat(30);
    setEnv({ NODE_ENV: 'production', REC_HMAC_SALT: STRONG, REC_HMAC_SALT_PREVIOUS: oldKey });
    const candidates = loanAccountHashCandidates('LOAN-42');
    expect(candidates).toHaveLength(2);
    expect(candidates).toContain(hashLoanAccount('LOAN-42', STRONG));
    expect(candidates).toContain(hashLoanAccount('LOAN-42', oldKey));
    expect(candidates).not.toContain(hashLoanAccount('LOAN-43', STRONG));
  });

  it('TEST-SECRET-PREV-03 without a previous key a lookup uses only the current hash', () => {
    setEnv({ NODE_ENV: 'production', REC_HMAC_SALT: STRONG, REC_HMAC_SALT_PREVIOUS: undefined });
    expect(loanAccountHashCandidates('LOAN-42')).toEqual([hashLoanAccount('LOAN-42', STRONG)]);
  });

  it('TEST-SECRET-PREV-04 a mobile hash written under the previous key is found by a lookup, and new rows use the current key', () => {
    const oldKey = 'y'.repeat(40);
    setEnv({ NODE_ENV: 'production', MOBILE_HMAC_SECRET: STRONG, MOBILE_HMAC_SECRET_PREVIOUS: oldKey });
    const stored = computeMobileHash('ten_1', '+919812345678', oldKey);
    const candidates = mobileHashCandidates('ten_1', '+919812345678');
    expect(candidates.some((c) => c.equals(stored))).toBe(true);
    expect(candidates[0]!.equals(computeMobileHash('ten_1', '+919812345678', STRONG))).toBe(true);
    expect(emailHashCandidates('ten_1', 'a@example.com')).toHaveLength(2);
  });

  it('TEST-SECRET-PREV-05 a hash is tenant-scoped: the same mobile in another tenant does not match', () => {
    setEnv({ NODE_ENV: 'production', MOBILE_HMAC_SECRET: STRONG, MOBILE_HMAC_SECRET_PREVIOUS: undefined });
    const a = computeMobileHash('ten_a', '+919812345678');
    const b = computeMobileHash('ten_b', '+919812345678');
    expect(a.equals(b)).toBe(false);
  });
});

describe('finance encryption key (TEST-SECRET-FIN)', () => {
  it('TEST-SECRET-FIN-01 FINANCE_ENCRYPTION_KEY takes precedence; otherwise the shared ENCRYPTION_KEY is used', () => {
    expect(
      financeEncryptionKeySource({
        NODE_ENV: 'production',
        FINANCE_ENCRYPTION_KEY: STRONG,
        ENCRYPTION_KEY: 'b'.repeat(40),
      }),
    ).toBe(STRONG);
    expect(financeEncryptionKeySource({ NODE_ENV: 'production', ENCRYPTION_KEY: 'b'.repeat(40) })).toBe(
      'b'.repeat(40),
    );
    expect(() => financeEncryptionKeySource({ NODE_ENV: 'production' })).toThrow(
      /ENCRYPTION_KEY is required in production/,
    );
  });

  it('TEST-SECRET-FIN-02 a payment reference encrypts and decrypts under the configured key', () => {
    setEnv({ NODE_ENV: 'production', FINANCE_ENCRYPTION_KEY: STRONG });
    const sealed = encryptPaymentRef('UTR123456789');
    expect(sealed.startsWith('aes256gcm:')).toBe(true);
    expect(decryptPaymentRef(sealed)).toBe('UTR123456789');
  });
});

describe('identity binding by e-mail (TEST-IDENT)', () => {
  it('TEST-IDENT-01 the e-mail fallback is off by default in production and on elsewhere', () => {
    expect(loadConfig(productionEnv()).IDENTITY_EMAIL_FALLBACK).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: 'development' }).IDENTITY_EMAIL_FALLBACK).toBe(true);
    expect(loadConfig({ ...base, NODE_ENV: 'test' }).IDENTITY_EMAIL_FALLBACK).toBe(true);
  });

  it('TEST-IDENT-02 an explicit setting is respected in both directions', () => {
    expect(loadConfig(productionEnv({ IDENTITY_EMAIL_FALLBACK: 'true' })).IDENTITY_EMAIL_FALLBACK).toBe(true);
    expect(
      loadConfig({ ...base, NODE_ENV: 'development', IDENTITY_EMAIL_FALLBACK: 'false' })
        .IDENTITY_EMAIL_FALLBACK,
    ).toBe(false);
  });
});
