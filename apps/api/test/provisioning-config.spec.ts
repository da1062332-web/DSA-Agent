// The provisioning worker refuses to start without explicit, complete configuration, and never prints a value.
import { describe, expect, it } from 'vitest';
import { loadProvisioningConfig } from '../src/provisioning/config';

const KEY = 'service-role-key-that-must-never-leak-0123456789';
const GOOD = {
  PROVISIONING_WORKER_ENABLED: 'true',
  DATABASE_URL: 'postgres://dsa_api:secret-db-password@127.0.0.1:5432/postgres',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: KEY,
  INVITE_REDIRECT_URL: 'http://localhost:5173/accept-invitation',
};
const problem = (env: NodeJS.ProcessEnv) => {
  try {
    loadProvisioningConfig(env);
    return '';
  } catch (err) {
    return (err as Error).message;
  }
};

describe('provisioning worker configuration', () => {
  it('TEST-PCFG-01 a complete configuration loads, with a 5-second poll by default', () => {
    expect(loadProvisioningConfig(GOOD)).toMatchObject({
      PROVISIONING_POLL_MS: 5000,
      INVITE_REDIRECT_URL: GOOD.INVITE_REDIRECT_URL,
    });
  });

  it('TEST-PCFG-02 the worker does not start unless PROVISIONING_WORKER_ENABLED is exactly "true"', () => {
    expect(problem({ ...GOOD, PROVISIONING_WORKER_ENABLED: undefined })).toMatch(
      /PROVISIONING_WORKER_ENABLED/,
    );
    expect(problem({ ...GOOD, PROVISIONING_WORKER_ENABLED: 'yes' })).toMatch(/PROVISIONING_WORKER_ENABLED/);
  });

  it('TEST-PCFG-03 a missing key, database or redirect is refused', () => {
    for (const name of [
      'SUPABASE_SERVICE_ROLE_KEY',
      'DATABASE_URL',
      'INVITE_REDIRECT_URL',
      'SUPABASE_URL',
    ] as const) {
      expect(problem({ ...GOOD, [name]: undefined })).toContain(name);
    }
  });

  it('TEST-PCFG-04 a database role that bypasses row-level security is refused', () => {
    expect(problem({ ...GOOD, DATABASE_URL: 'postgres://postgres:pw@127.0.0.1:5432/postgres' })).toMatch(
      /dsa_api/,
    );
    expect(
      problem({ ...GOOD, DATABASE_URL: 'postgres://postgres.abcdef:pw@pooler.example.com:6543/postgres' }),
    ).toMatch(/dsa_api/);
  });

  it('TEST-PCFG-05 the redirect must be HTTPS (or HTTP on localhost) and point at /accept-invitation', () => {
    expect(problem({ ...GOOD, INVITE_REDIRECT_URL: 'http://crm.example.com/accept-invitation' })).toMatch(
      /https/,
    );
    expect(problem({ ...GOOD, INVITE_REDIRECT_URL: 'https://crm.example.com/somewhere' })).toMatch(
      /accept-invitation/,
    );
    expect(problem({ ...GOOD, INVITE_REDIRECT_URL: 'https://crm.example.com/accept-invitation' })).toBe('');
  });

  it('TEST-PCFG-06 the error never contains the key or the database password', () => {
    const message = problem({ ...GOOD, PROVISIONING_WORKER_ENABLED: 'no', INVITE_REDIRECT_URL: 'nope' });
    expect(message).not.toContain(KEY);
    expect(message).not.toContain('secret-db-password');
  });
});
