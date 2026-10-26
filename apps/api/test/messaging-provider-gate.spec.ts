// The simulated messaging provider is for test environments only: the configuration refuses it in production.
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const base = {
  DATABASE_URL: 'postgresql://dsa_api:secret@127.0.0.1:54322/postgres',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_JWT_SECRET: 'super-secret-jwt-token-with-at-least-32-characters-long',
  APP_SIGNING_SECRET: 'a'.repeat(40),
};

describe('Messaging: simulated provider configuration gate', () => {
  it('TEST-MSG-GATE-001 refuses the simulated provider in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', ENABLE_MOCK_PROVIDERS: 'true' })).toThrow(
      /simulated messaging provider is not allowed in production/,
    );
  });

  it('TEST-MSG-GATE-002 allows the simulated provider in development and test, and it is off by default', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'development', ENABLE_MOCK_PROVIDERS: 'true' }).ENABLE_MOCK_PROVIDERS).toBe(true);
    expect(loadConfig({ ...base, NODE_ENV: 'test' }).ENABLE_MOCK_PROVIDERS).toBe(false);
  });
});
