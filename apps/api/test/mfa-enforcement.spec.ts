// Mandatory two-step verification at the API boundary (owner: Dev 1, SUB-AUTH.02). Unit level: the verifier and
// resolver are stubbed, so these tests cover only the rule in supabaseAuth. The database-backed version is in
// test/auth.int.spec.ts.
import { ErrorEnvelope, type PermissionCode, type Principal } from '@dsa/contracts';
import { MFA_REQUIRED_PERMISSIONS, type TokenVerifier } from '@dsa/kernel';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { supabaseAuth } from '../src/http/supabase-auth';
import { createTestApp, testPrincipal } from './support/fake-auth';

const withGrant = (code: PermissionCode): Principal =>
  testPrincipal({ grants: [{ code, scope: 'TENANT', branchIds: [] }] });

function appFor(principal: Principal, aal: 'aal1' | 'aal2') {
  const verifier: TokenVerifier = {
    verify: async () => ({ subject: 'sub-x', tenantId: principal.tenantId, aal, mfaVerifiedAt: null }),
  };
  return createTestApp({
    auth: supabaseAuth({ verifier, resolver: { resolve: async () => principal } }),
  });
}

const call = (
  app: ReturnType<typeof createTestApp>,
  path = '/v1/organisations',
  method: 'get' | 'post' = 'get',
) => request(app)[method](path).set('Authorization', 'Bearer aaa.bbb.ccc');

describe('mandatory two-step verification at the API (SUB-AUTH.02)', () => {
  it('TEST-MFA-API-01 a mandatory role with an aal1 token gets 401 STEP_UP_REQUIRED', async () => {
    const res = await call(appFor(withGrant('config.manage'), 'aal1'));
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.parse(res.body).error.code).toBe('STEP_UP_REQUIRED');
  });

  it('TEST-MFA-API-02 the same mandatory role with an aal2 token passes the MFA rule', async () => {
    const res = await call(appFor(withGrant('config.manage'), 'aal2'));
    expect(res.status).not.toBe(401); // reaches routing; 404 here because no route is mounted in this stub
    expect(res.body.error?.code).not.toBe('STEP_UP_REQUIRED');
  });

  it('TEST-MFA-API-03 a role without a mandatory permission is not blocked at aal1', async () => {
    const res = await call(appFor(withGrant('lead.read'), 'aal1'));
    expect(res.body.error?.code).not.toBe('STEP_UP_REQUIRED');
  });

  it('TEST-MFA-API-04 GET /v1/me stays open at aal1 so the web app can send the user to /mfa', async () => {
    const res = await call(appFor(withGrant('config.manage'), 'aal1'), '/v1/me');
    expect(res.body.error?.code).not.toBe('STEP_UP_REQUIRED');
  });

  it('TEST-MFA-API-05 every mandatory permission triggers the rule', async () => {
    for (const code of MFA_REQUIRED_PERMISSIONS) {
      const res = await call(appFor(withGrant(code), 'aal1'));
      expect(res.body.error?.code, code).toBe('STEP_UP_REQUIRED');
    }
  });

  it('TEST-MFA-API-06 bypass tokens or missing tokens are strictly rejected with UNAUTHENTICATED', async () => {
    const app = appFor(withGrant('config.manage'), 'aal2');
    const resBypass = await request(app)
      .get('/v1/organisations')
      .set('Authorization', 'Bearer dev-bypass-token');
    expect(resBypass.status).toBe(401);
    expect(ErrorEnvelope.parse(resBypass.body).error.code).toBe('UNAUTHENTICATED');

    const resNone = await request(app).get('/v1/organisations');
    expect(resNone.status).toBe(401);
    expect(ErrorEnvelope.parse(resNone.body).error.code).toBe('UNAUTHENTICATED');
  });
});
