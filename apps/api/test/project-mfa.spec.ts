// The project's authenticator sign-in setting (SUPABASE_MFA_ENABLED). When the Supabase project has it off, no second factor can be asked
// for, so the API must not demand one either. When it is on (the default), MFA roles still need a fresh second factor.
import type { PermissionCode, Principal } from '@dsa/contracts';
import type { TokenVerifier } from '@dsa/kernel';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { mfaDisabled, projectMfaOff, secondFactorSkipped } from '../src/http/mfa-switch';
import { supabaseAuth } from '../src/http/supabase-auth';
import { createTestApp, testPrincipal } from './support/fake-auth';

const HOSTED = 'https://abcdefghijklmnop.supabase.co';
const HOSTED_DB = 'postgresql://dsa_api.abcdefghijklmnop:x@aws-1-ap-south-1.pooler.supabase.com:6543/postgres';

describe('the project setting for authenticator sign-in', () => {
  it('TEST-PMFA-01 only the explicit value false means the project has authenticator sign-in off', () => {
    expect(projectMfaOff({})).toBe(false);
    expect(projectMfaOff({ SUPABASE_MFA_ENABLED: 'true' })).toBe(false);
    expect(projectMfaOff({ SUPABASE_MFA_ENABLED: 'false' })).toBe(true);
  });

  it('TEST-PMFA-02 with the project setting off, the second factor is skipped, against the hosted project as well', () => {
    expect(
      secondFactorSkipped({ SUPABASE_MFA_ENABLED: 'false', SUPABASE_URL: HOSTED, DATABASE_URL: HOSTED_DB, NODE_ENV: 'production' }),
    ).toBe(true);
  });

  it('TEST-PMFA-03 with the default setting, the second factor is still required', () => {
    expect(secondFactorSkipped({ SUPABASE_URL: HOSTED, DATABASE_URL: HOSTED_DB, NODE_ENV: 'production' })).toBe(false);
  });

  it('TEST-PMFA-04 the developer switch is still refused against the hosted project, and the project setting does not enable it', () => {
    expect(
      mfaDisabled({ DISABLE_MFA: 'true', SUPABASE_URL: HOSTED, DATABASE_URL: HOSTED_DB, NODE_ENV: 'development' }),
    ).toBe(false);
  });
});

describe('the sign-in middleware follows the project setting', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  const principalWith = (code: PermissionCode): Principal =>
    testPrincipal({ grants: [{ code, scope: 'TENANT', branchIds: [] }] });
  const get = (principal: Principal) => {
    const verifier: TokenVerifier = {
      verify: async () => ({ subject: 's', tenantId: principal.tenantId, aal: 'aal1', mfaVerifiedAt: null }),
    };
    const app = createTestApp({ auth: supabaseAuth({ verifier, resolver: { resolve: async () => principal } }) });
    return request(app).get('/v1/organisations').set('Authorization', 'Bearer aaa.bbb.ccc');
  };

  it('TEST-PMFA-05 with the project setting off, an aal1 session for an MFA role is let through against the hosted project', async () => {
    process.env.SUPABASE_MFA_ENABLED = 'false';
    process.env.SUPABASE_URL = HOSTED;
    process.env.DATABASE_URL = HOSTED_DB;
    process.env.NODE_ENV = 'production';
    expect((await get(principalWith('config.manage'))).body.error?.code).not.toBe('STEP_UP_REQUIRED');
  });

  it('TEST-PMFA-06 with the default setting, the same aal1 session for an MFA role is still refused', async () => {
    delete process.env.SUPABASE_MFA_ENABLED;
    process.env.SUPABASE_URL = HOSTED;
    process.env.DATABASE_URL = HOSTED_DB;
    process.env.NODE_ENV = 'production';
    expect((await get(principalWith('config.manage'))).body.error?.code).toBe('STEP_UP_REQUIRED');
  });
});
