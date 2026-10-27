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

  it('TEST-CFGG-SIGN the signing secret: empty values mean unset, a short one is refused, production requires one', () => {
    expect(
      loadConfig({ ...base, SUPABASE_JWT_SECRET: '', APP_SIGNING_SECRET: '' }).APP_SIGNING_SECRET,
    ).toBeUndefined();
    expect(loadConfig({ ...base, SUPABASE_JWT_SECRET: '' }).SUPABASE_JWT_SECRET).toBeUndefined();
    expect(message({ APP_SIGNING_SECRET: 'too-short' })).toMatch(/APP_SIGNING_SECRET/);
    expect(message({ APP_SIGNING_SECRET: '<64-hex-characters>' })).toMatch(/APP_SIGNING_SECRET/);
    expect(message({ NODE_ENV: 'production' })).toMatch(/APP_SIGNING_SECRET/);
    expect(message({ NODE_ENV: 'production', APP_SIGNING_SECRET: 'a'.repeat(64) })).toBe('');
    expect(message({ APP_SIGNING_SECRET: 'a'.repeat(64) })).not.toContain('a'.repeat(64));
  });

  it('TEST-CFGG-06 the published bypass secret is gone: test login is off by default and has no default secret', () => {
    const parsed = loadConfig({ ...base });
    expect(parsed.TEST_AUTH_ENABLED).toBe(false);
    expect(parsed.BYPASS_JWT_SECRET).toBeUndefined();
  });

  it('TEST-CFGG-07 test login starts only on the local stack, with a local database and its own secret', () => {
    const SECRET = 'a-unique-test-secret-for-this-machine-0123456789';
    expect(message({ TEST_AUTH_ENABLED: 'true', SUPABASE_URL: LOCAL, BYPASS_JWT_SECRET: SECRET })).toBe('');
    expect(message({ TEST_AUTH_ENABLED: 'true', BYPASS_JWT_SECRET: SECRET })).toMatch(/TEST_AUTH_ENABLED/);
    expect(
      message({ TEST_AUTH_ENABLED: 'true', SUPABASE_URL: LOCAL, BYPASS_JWT_SECRET: SECRET, NODE_ENV: 'production' }),
    ).toMatch(/TEST_AUTH_ENABLED/);
    expect(message({ TEST_AUTH_ENABLED: 'true', SUPABASE_URL: LOCAL })).toMatch(/BYPASS_JWT_SECRET/);
    expect(
      message({
        TEST_AUTH_ENABLED: 'true',
        SUPABASE_URL: LOCAL,
        BYPASS_JWT_SECRET: 'dsa-crm-test-bypass-jwt-secret-key-2026',
      }),
    ).toMatch(/BYPASS_JWT_SECRET/);
  });

  it('TEST-CFGG-08 test login is refused against a hosted database even with a local URL, unless its host is approved', () => {
    const SECRET = 'a-unique-test-secret-for-this-machine-0123456789';
    const hostedDb = 'postgresql://dsa_api.mlpkwwhnagxzinaohdxg:pw@aws-1-ap-south-1.pooler.supabase.com:6543/postgres';
    const refused = message({
      TEST_AUTH_ENABLED: 'true',
      SUPABASE_URL: LOCAL,
      BYPASS_JWT_SECRET: SECRET,
      DATABASE_URL: hostedDb,
    });
    expect(refused).toMatch(/DATABASE_URL/);
    expect(refused).not.toContain('mlpkwwhnagxzinaohdxg');
    expect(
      message({
        TEST_AUTH_ENABLED: 'true',
        SUPABASE_URL: LOCAL,
        BYPASS_JWT_SECRET: SECRET,
        DATABASE_URL: 'postgresql://dsa_api:pw@test-db.internal:5432/dsa',
        TEST_DATABASE_HOSTS: 'test-db.internal',
      }),
    ).toBe('');
  });

  it('TEST-CFGG-09 MFA may be switched off only against a local or approved database too', () => {
    const hostedDb = 'postgresql://dsa_api.mlpkwwhnagxzinaohdxg:pw@aws-1-ap-south-1.pooler.supabase.com:6543/postgres';
    expect(message({ DISABLE_MFA: 'true', SUPABASE_URL: LOCAL, DATABASE_URL: hostedDb })).toMatch(/DISABLE_MFA/);
    expect(message({ DISABLE_MFA: 'true', SUPABASE_URL: LOCAL })).toBe('');
  });

  it('TEST-CFGG-10 the shared database refuses test login and the test OTP, even with every other test switch set', () => {
    const SECRET = 'a-unique-test-secret-for-this-machine-0123456789';
    const sharedPooler = 'postgresql://dsa_api.mlpkwwhnagxzinaohdxg:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';
    const onLocalStack = message({
      TEST_AUTH_ENABLED: 'true',
      TEST_BYPASS_OTP: '000000',
      SUPABASE_URL: LOCAL,
      BYPASS_JWT_SECRET: SECRET,
      DATABASE_URL: sharedPooler,
    });
    expect(onLocalStack).toMatch(/DATABASE_URL/);
    expect(onLocalStack).not.toContain('mlpkwwhnagxzinaohdxg');
    expect(onLocalStack).not.toContain('000000');
    const onHostedUrl = message({
      TEST_AUTH_ENABLED: 'true',
      TEST_BYPASS_OTP: '000000',
      SUPABASE_URL: HOSTED,
      BYPASS_JWT_SECRET: SECRET,
      DATABASE_URL: sharedPooler,
    });
    expect(onHostedUrl).toMatch(/SUPABASE_URL/);
    expect(onHostedUrl).not.toContain('000000');
  });
});
