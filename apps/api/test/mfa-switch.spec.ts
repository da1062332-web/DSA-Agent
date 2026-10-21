// The DISABLE_MFA development switch (owner: Dev 1; SUB-AUTH.02). MFA is mandatory for admin and platform roles; the switch is honoured
// only against a local Supabase stack outside production, refused at startup anywhere else, and ignored at request time if it slips through.
import type { PermissionCode, Principal } from '@dsa/contracts';
import type { TokenVerifier } from '@dsa/kernel';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { mfaDisabled, mfaMayBeDisabledHere } from '../src/http/mfa-switch';
import { supabaseAuth } from '../src/http/supabase-auth';
import { createTestApp, testPrincipal } from './support/fake-auth';

const LOCAL = 'http://127.0.0.1:54321';
const HOSTED = 'https://abcdefghijklmnop.supabase.co';
const base = {
  DATABASE_URL: 'postgresql://dsa_api:x@localhost:5432/postgres',
  LOG_LEVEL: 'silent',
  APP_SIGNING_SECRET: '01234567890123456789012345678901',
};

describe('which environments may switch MFA off', () => {
  it('TEST-MFASW-01 a developer on a local Supabase stack outside production can switch it off', () => {
    expect(mfaDisabled({ DISABLE_MFA: 'true', SUPABASE_URL: LOCAL, NODE_ENV: 'development' })).toBe(true);
    expect(
      mfaDisabled({ DISABLE_MFA: 'true', SUPABASE_URL: 'http://localhost:54321', NODE_ENV: 'test' }),
    ).toBe(true);
    expect(mfaMayBeDisabledHere({ SUPABASE_URL: LOCAL })).toBe(true);
  });

  it('TEST-MFASW-02 without the variable, MFA stays on everywhere, local or not', () => {
    expect(mfaDisabled({ SUPABASE_URL: LOCAL, NODE_ENV: 'development' })).toBe(false);
    expect(mfaDisabled({ DISABLE_MFA: 'false', SUPABASE_URL: LOCAL })).toBe(false);
    expect(mfaDisabled({ DISABLE_MFA: '1', SUPABASE_URL: LOCAL })).toBe(false); // only the exact word counts
  });

  it('TEST-MFASW-03 against a hosted Supabase project, in production, or with no URL at all, the variable is ignored', () => {
    expect(mfaDisabled({ DISABLE_MFA: 'true', SUPABASE_URL: HOSTED, NODE_ENV: 'development' })).toBe(false);
    expect(mfaDisabled({ DISABLE_MFA: 'true', SUPABASE_URL: LOCAL, NODE_ENV: 'production' })).toBe(false);
    expect(mfaDisabled({ DISABLE_MFA: 'true', NODE_ENV: 'development' })).toBe(false);
    expect(mfaDisabled({ DISABLE_MFA: 'true', SUPABASE_URL: 'not a url' })).toBe(false);
    expect(mfaDisabled({ DISABLE_MFA: 'true', SUPABASE_URL: 'http://127.0.0.1.evil.example.com' })).toBe(
      false,
    ); // look-alike host
  });
});

describe('startup refuses a prohibited DISABLE_MFA', () => {
  it('TEST-MFASW-04 the API will not start with DISABLE_MFA=true against a hosted project', () => {
    expect(() => loadConfig({ ...base, SUPABASE_URL: HOSTED, DISABLE_MFA: 'true' })).toThrow(/DISABLE_MFA/);
  });

  it('TEST-MFASW-05 the API will not start with DISABLE_MFA=true in production, even against a local URL', () => {
    expect(() =>
      loadConfig({ ...base, SUPABASE_URL: LOCAL, NODE_ENV: 'production', DISABLE_MFA: 'true' }),
    ).toThrow(/DISABLE_MFA/);
  });

  it('TEST-MFASW-06 it starts with the switch on a local stack, and with the switch absent anywhere', () => {
    expect(loadConfig({ ...base, SUPABASE_URL: LOCAL, DISABLE_MFA: 'true' }).DISABLE_MFA).toBe(true);
    expect(loadConfig({ ...base, SUPABASE_URL: HOSTED }).DISABLE_MFA).toBe(false);
    expect(loadConfig({ ...base, SUPABASE_URL: HOSTED, NODE_ENV: 'production' }).DISABLE_MFA).toBe(false);
  });

  it('TEST-MFASW-07 the error names the variable and never prints a value', () => {
    try {
      loadConfig({ ...base, SUPABASE_URL: HOSTED, DISABLE_MFA: 'true' });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain('DISABLE_MFA');
      expect((err as Error).message).not.toContain('abcdefghijklmnop');
      expect((err as Error).message).not.toContain('dsa_api:x');
    }
  });
});

describe('the middleware honours the switch only where allowed', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  const withGrant = (code: PermissionCode): Principal =>
    testPrincipal({ grants: [{ code, scope: 'TENANT', branchIds: [] }] });
  const appFor = (principal: Principal) => {
    const verifier: TokenVerifier = {
      verify: async () => ({ subject: 's', tenantId: principal.tenantId, aal: 'aal1', mfaVerifiedAt: null }),
    };
    return createTestApp({ auth: supabaseAuth({ verifier, resolver: { resolve: async () => principal } }) });
  };
  const get = (principal: Principal) =>
    request(appFor(principal)).get('/v1/organisations').set('Authorization', 'Bearer aaa.bbb.ccc');

  it('TEST-MFASW-08 against a hosted URL, an aal1 token for a platform role is still refused although DISABLE_MFA=true', async () => {
    process.env.DISABLE_MFA = 'true';
    process.env.SUPABASE_URL = HOSTED;
    process.env.NODE_ENV = 'development';
    const res = await get(withGrant('platform.console'));
    expect(res.body.error?.code).toBe('STEP_UP_REQUIRED');
  });

  it('TEST-MFASW-09 in production the same token is refused even against a local-looking URL', async () => {
    process.env.DISABLE_MFA = 'true';
    process.env.SUPABASE_URL = LOCAL;
    process.env.NODE_ENV = 'production';
    expect((await get(withGrant('config.manage'))).body.error?.code).toBe('STEP_UP_REQUIRED');
  });

  it('TEST-MFASW-10 on a local development stack the switch lets the call through (the permitted case)', async () => {
    process.env.DISABLE_MFA = 'true';
    process.env.SUPABASE_URL = LOCAL;
    process.env.NODE_ENV = 'development';
    expect((await get(withGrant('config.manage'))).body.error?.code).not.toBe('STEP_UP_REQUIRED');
  });
});
