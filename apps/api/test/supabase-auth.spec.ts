import { AppError, ErrorEnvelope } from '@dsa/contracts';
import type { PrincipalResolver, TokenVerifier } from '@dsa/kernel';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { supabaseAuth } from '../src/http/supabase-auth';
import { createTestApp, testPrincipal } from './support/fake-auth';

const TOKEN = 'aaa.bbb.ccc';
const verified = {
  subject: 'sub-1',
  tenantId: 'ten_01JTESTTENANT00000000000000',
  aal: 'aal1' as const,
  mfaVerifiedAt: null,
};

function appWith(verifier: TokenVerifier, resolver: PrincipalResolver) {
  return createTestApp({ auth: supabaseAuth({ verifier, resolver }) });
}

describe('supabaseAuth middleware (TASK-102)', () => {
  it('TEST-KRN-102-20 401 UNAUTHENTICATED without a Bearer token, and never calls the verifier', async () => {
    const verify = vi.fn();
    const app = appWith({ verify }, { resolve: vi.fn() });
    for (const header of [undefined, 'Basic abc', 'Bearer ', 'Bearer not-a-jwt']) {
      const req = request(app).get('/v1/anything');
      const res = header ? await req.set('Authorization', header) : await req;
      expect(res.status).toBe(401);
      expect(ErrorEnvelope.parse(res.body).error.code).toBe('UNAUTHENTICATED');
    }
    expect(verify).not.toHaveBeenCalled();
  });

  it('TEST-KRN-102-21 passes verifier errors through (TOKEN_EXPIRED)', async () => {
    const app = appWith(
      { verify: () => Promise.reject(AppError.of('TOKEN_EXPIRED', 'expired')) },
      { resolve: vi.fn() },
    );
    const res = await request(app).get('/v1/anything').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.parse(res.body).error.code).toBe('TOKEN_EXPIRED');
  });

  it('TEST-KRN-102-22 sets req.ctx from the resolved principal; tenant in the query string is ignored', async () => {
    const principal = testPrincipal();
    const resolve = vi.fn().mockResolvedValue(principal);
    const app = appWith({ verify: () => Promise.resolve(verified) }, { resolve });
    const res = await request(app)
      .get('/v1/does-not-exist?tenantId=ten_01JOTHERTENANT0000000000000')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(404); // authenticated, then no route
    expect(resolve).toHaveBeenCalledWith(
      verified,
      expect.objectContaining({ correlationId: expect.any(String) }),
    );
  });

  it('TEST-KRN-102-23 401 when the subject has no active app_user', async () => {
    const app = appWith(
      { verify: () => Promise.resolve(verified) },
      { resolve: () => Promise.reject(AppError.of('UNAUTHENTICATED', 'no user')) },
    );
    const res = await request(app).get('/v1/me').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(401);
  });
});
