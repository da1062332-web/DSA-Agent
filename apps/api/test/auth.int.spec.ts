// TEST-AUTH-INT: token verification and principal lookup against a dedicated database (owner: Dev 1, TASK-102).
// Runs on its own throwaway PostgreSQL 16 container with every migration applied, connected as dsa_api, so RLS and
// the tenant context behave as in production. Tokens are signed with a test-only HS256 secret. Hosted and local
// projects sign with their own keys, which never reach a test.
import { createPrincipalResolver, createTokenVerifier } from '@dsa/kernel';
import { mintTestToken } from '@dsa/kernel/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { supabaseAuth } from '../src/http/supabase-auth';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { testDeps } from './support/fake-auth';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

const TEST_SECRET = 'test-only-hs256-secret-for-auth-int-tests-0123456789';
const WRONG_SECRET = 'a-different-secret-that-signs-nothing-real-000000';
const SUPABASE_URL = 'http://127.0.0.1:54321';

let env: IsolationEnv;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  env = await startIsolationEnv();
  const verifier = createTokenVerifier({ supabaseUrl: SUPABASE_URL, jwtSecret: TEST_SECRET });
  const txRunner = createTxRunner(env.db);
  app = createApp({
    deps: testDeps({ txRunner }),
    corsAllowedOrigins: [],
    auth: supabaseAuth({ verifier, resolver: createPrincipalResolver(txRunner) }),
  });
}, 180_000);

afterAll(async () => {
  await env?.stop();
});

const mint = (opts: {
  sub?: string;
  tenantId?: string;
  secret?: string;
  aal?: 'aal1' | 'aal2';
  now?: Date;
  ttl?: number;
}) =>
  mintTestToken({
    supabaseUrl: SUPABASE_URL,
    jwtSecret: opts.secret ?? TEST_SECRET,
    sub: opts.sub ?? 'sub-iso-a0',
    tenantId: opts.tenantId ?? env.A.tenantId,
    aal: opts.aal,
    now: opts.now,
    ttlSeconds: opts.ttl,
  });

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('authentication against the dedicated database (TEST-AUTH-INT)', () => {
  it('TEST-AUTH-INT-01 a valid token resolves to the user of its tenant', async () => {
    const res = await request(app)
      .get('/v1/me')
      .set(bearer(await mint({})));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(env.A.userIds[0]);
    expect(res.body.tenantId).toBe(env.A.tenantId);
    expect(res.body.mfaVerifiedAt).toBeNull();
  });

  it('TEST-AUTH-INT-02 an expired token is 401 TOKEN_EXPIRED', async () => {
    const yesterday = new Date(Date.now() - 2 * 3600 * 1000);
    const res = await request(app)
      .get('/v1/me')
      .set(bearer(await mint({ now: yesterday, ttl: 3600 })));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('TEST-AUTH-INT-03 a token signed with another secret is 401 UNAUTHENTICATED', async () => {
    const res = await request(app)
      .get('/v1/me')
      .set(bearer(await mint({ secret: WRONG_SECRET })));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('TEST-AUTH-INT-04 a subject with no app_user row is 401', async () => {
    const res = await request(app)
      .get('/v1/me')
      .set(bearer(await mint({ sub: 'sub-does-not-exist' })));
    expect(res.status).toBe(401);
  });

  it('TEST-AUTH-INT-05 a user token claiming another tenant is 401 (RLS hides the user)', async () => {
    const res = await request(app)
      .get('/v1/me')
      .set(bearer(await mint({ tenantId: env.B.tenantId })));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('TEST-AUTH-INT-06 a suspended user cannot use a valid token; reactivating restores access', async () => {
    const token = await mint({});
    await env.admin.query(`update app.app_user set status = 'SUSPENDED' where id = $1`, [env.A.userIds[0]]);
    try {
      expect((await request(app).get('/v1/me').set(bearer(token))).status).toBe(401);
    } finally {
      await env.admin.query(`update app.app_user set status = 'ACTIVE' where id = $1`, [env.A.userIds[0]]);
    }
    expect((await request(app).get('/v1/me').set(bearer(token))).status).toBe(200);
  });

  it('TEST-AUTH-INT-07 an aal2 token carries the MFA time; an aal1 token does not', async () => {
    const aal2 = await request(app)
      .get('/v1/me')
      .set(bearer(await mint({ aal: 'aal2' })));
    expect(aal2.status).toBe(200);
    expect(aal2.body.mfaVerifiedAt).not.toBeNull();
    const aal1 = await request(app)
      .get('/v1/me')
      .set(bearer(await mint({ aal: 'aal1' })));
    expect(aal1.body.mfaVerifiedAt).toBeNull();
  });

  it('TEST-AUTH-INT-08 a tenant id in the query string cannot switch tenants', async () => {
    const res = await request(app)
      .get(`/v1/tenant?tenantId=${env.B.tenantId}`)
      .set(bearer(await mint({ tenantId: env.A.tenantId })));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(env.A.tenantId);
    expect(res.body.slug).toBe('iso-a');
  });
});
