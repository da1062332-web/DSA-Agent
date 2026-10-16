// Startup guards on unsafe combinations of database login, Supabase URL and test switches (owner: Dev 1).
// The error text must name variables and reasons only, never values.
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const HOSTED = 'https://mlpkwwhnagxzinaohdxg.supabase.co';
const LOCAL = 'http://127.0.0.1:54321';
const base = {
  DATABASE_URL: 'postgresql://dsa_api:s3cretvalue@localhost:5432/postgres',
  SUPABASE_URL: HOSTED,
} as NodeJS.ProcessEnv;

const message = (env: Record<string, string>) => {
  try {
    loadConfig({ ...base, ...env });
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};

describe('startup configuration guards', () => {
  it('TEST-CFGG-01 the hosted project with the application login and no test switches starts', () => {
    expect(message({})).toBe('');
  });

  it('TEST-CFGG-02 the API refuses to connect as an RLS-bypassing database login', () => {
    for (const user of ['postgres', 'postgres.mlpkwwhnagxzinaohdxg', 'service_role', 'supabase_admin']) {
      expect(message({ DATABASE_URL: `postgresql://${user}:s3cretvalue@localhost:5432/postgres` })).toMatch(
        /DATABASE_URL/,
      );
    }
  });

  it('TEST-CFGG-03 test tokens are refused against the hosted project and allowed against the local stack', () => {
    expect(message({ TEST_TOKENS: 'true' })).toMatch(/TEST_TOKENS/);
    expect(message({ TEST_TOKENS: 'true', SUPABASE_URL: LOCAL })).toBe('');
  });

  it('TEST-CFGG-04 turning MFA off is refused against the hosted project, in production, and allowed only locally', () => {
    expect(message({ DISABLE_MFA: 'true' })).toMatch(/DISABLE_MFA/);
    expect(message({ DISABLE_MFA: 'true', SUPABASE_URL: LOCAL, NODE_ENV: 'production' })).toMatch(
      /DISABLE_MFA/,
    );
    expect(message({ DISABLE_MFA: 'true', SUPABASE_URL: LOCAL })).toBe('');
  });

  it('TEST-CFGG-05 a refusal never prints the password or the URL it refused', () => {
    const text = message({
      DATABASE_URL: 'postgresql://postgres:s3cretvalue@localhost:5432/postgres',
      TEST_TOKENS: 'true',
    });
    expect(text).not.toContain('s3cretvalue');
    expect(text).not.toContain('mlpkwwhnagxzinaohdxg');
  });
});
