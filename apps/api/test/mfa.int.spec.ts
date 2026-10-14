// Mandatory two-step verification against a real database (owner: Dev 1, SUB-AUTH.02). Each run gets a throwaway
// PostgreSQL 16 container with every migration applied; tokens are signed with the test-only secret.
import { FakeUserDirectoryPort } from '@dsa/contracts/fakes';
import {
  createAuditPort,
  createAuthz,
  createIdGenerator,
  createPrincipalResolver,
  createTokenVerifier,
} from '@dsa/kernel';
import { mintTestToken } from '@dsa/kernel/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { supabaseAuth } from '../src/http/supabase-auth';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

const TEST_SECRET = 'test-only-hs256-secret-for-mfa-int-tests-0123456789';
const SUPABASE_URL = 'http://127.0.0.1:54321';

let env: IsolationEnv;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  env = await startIsolationEnv();
  const txRunner = createTxRunner(env.db);
  app = createApp({
    deps: {
      txRunner,
      authz: createAuthz(),
      audit: createAuditPort(createIdGenerator()),
      ids: createIdGenerator(),
      userDirectory: new FakeUserDirectoryPort(),
    },
    corsAllowedOrigins: [],
    auth: supabaseAuth({
      verifier: createTokenVerifier({ supabaseUrl: SUPABASE_URL, jwtSecret: TEST_SECRET }),
      resolver: createPrincipalResolver(txRunner),
    }),
  });
  // Tenant A's first user is a tenant admin (mandatory MFA); the second user has no grants (not mandatory).
  await env.admin.query(
    `insert into app.role (id, tenant_id, code, name, created_by) values ('role_mfa_admin', $1, 'ROLE-TENANT-ADMIN', 'Admin', 'iso')`,
    [env.A.tenantId],
  );
  await env.admin.query(
    `insert into app.role_permission (tenant_id, role_id, permission_code) values ($1, 'role_mfa_admin', 'config.manage')`,
    [env.A.tenantId],
  );
  await env.admin.query(
    `insert into app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, created_by)
     values ('ura_mfa_admin', $1, $2, 'role_mfa_admin', 'TENANT', 'iso')`,
    [env.A.tenantId, env.A.userIds[0]],
  );
}, 180_000);

afterAll(async () => {
  await env?.stop();
});

const token = (sub: string, aal: 'aal1' | 'aal2') =>
  mintTestToken({ supabaseUrl: SUPABASE_URL, jwtSecret: TEST_SECRET, sub, tenantId: env.A.tenantId, aal });
const bearer = async (sub: string, aal: 'aal1' | 'aal2') => ({
  Authorization: `Bearer ${await token(sub, aal)}`,
});

describe('mandatory two-step verification (TEST-MFA-INT)', () => {
  it('TEST-MFA-INT-01 a mandatory role is blocked at aal1 with STEP_UP_REQUIRED, and passes at aal2', async () => {
    const aal1 = await request(app)
      .get('/v1/branches')
      .set(await bearer('sub-iso-a0', 'aal1'));
    expect(aal1.status).toBe(401);
    expect(aal1.body.error.code).toBe('STEP_UP_REQUIRED');

    const aal2 = await request(app)
      .get('/v1/branches')
      .set(await bearer('sub-iso-a0', 'aal2'));
    expect(aal2.status).toBe(200);
  });

  it('TEST-MFA-INT-02 GET /v1/me stays open at aal1 so the web app can send the user to /mfa', async () => {
    const me = await request(app)
      .get('/v1/me')
      .set(await bearer('sub-iso-a0', 'aal1'));
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(env.A.userIds[0]);
  });

  it('TEST-MFA-INT-03 a user with no mandatory permission is never blocked at aal1', async () => {
    const res = await request(app)
      .get('/v1/branches')
      .set(await bearer('sub-iso-a1', 'aal1'));
    expect(res.status).toBe(200);
  });
});
