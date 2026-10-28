import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely';
import { createPublicAuthRouter } from '../src/http/public-auth-router';
import { correlation } from '../src/http/correlation';
import { errorHandler } from '../src/http/error-handler';
import { resolveTestAuth, type TestAuthConfig } from '../src/test-auth';
import { createTestApp } from './support/fake-auth';
import { createTokenVerifier, createPrincipalResolver } from '@dsa/kernel';
import type { Database, RequestContext, Tx, TxRunner } from '@dsa/contracts';

describe('Public Auth Router — test login with the fixed one-time code', () => {
  const mockUser = {
    id: 'usr_rm_01',
    tenant_id: 'ten_01M4SXZ9E66W8T6DNJYBVNS3FA',
    idp_subject: 'sub-rm-12345',
    email: 'rm1@alpha.com',
    display_name: 'Riya RM',
    status: 'ACTIVE',
    tenant_status: 'ACTIVE',
  };

  const handleQuery = (sql: string, params: readonly unknown[]) => {
    const s = sql.toLowerCase();
    if (s.includes('lookup_test_user')) {
      if (params[0] === 'rm1@alpha.com') {
        return { rows: [mockUser] };
      }
      return { rows: [] };
    }
    if (s.includes('list_test_users')) {
      return { rows: [mockUser] };
    }
    if (s.includes('select u.id, u.primary_branch_id')) {
      return {
        rows: [
          {
            id: mockUser.id,
            primary_branch_id: 'br_mumbai_01',
            status: 'ACTIVE',
            tenant_status: 'ACTIVE',
          },
        ],
      };
    }
    if (s.includes('user_role_assignment')) {
      return {
        rows: [
          {
            permission_code: 'lead.read',
            scope_type: 'TENANT',
            scope_branch_ids: [],
          },
          {
            permission_code: 'lead.create',
            scope_type: 'TENANT',
            scope_branch_ids: [],
          },
        ],
      };
    }
    return { rows: [] };
  };

  class MockConnection implements DatabaseConnection {
    async executeQuery<R>(compiled: { sql: string; parameters: readonly unknown[] }): Promise<QueryResult<R>> {
      return handleQuery(compiled.sql, compiled.parameters) as QueryResult<R>;
    }
    async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {}
  }

  class MockDriver implements Driver {
    async init(): Promise<void> {}
    async acquireConnection(): Promise<DatabaseConnection> {
      return new MockConnection();
    }
    async beginTransaction(): Promise<void> {}
    async commitTransaction(): Promise<void> {}
    async rollbackTransaction(): Promise<void> {}
    async releaseConnection(): Promise<void> {}
    async destroy(): Promise<void> {}
  }

  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new MockDriver(),
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

  const mockTxRunner: TxRunner = {
    async withTenantTx<T>(_ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
      return fn(db as unknown as Tx);
    },
  };

  const deps: any = {
    txRunner: mockTxRunner,
  };

  // Built by the same gate server.ts uses, so these tests exercise the real settings path.
  const LOCAL = 'http://127.0.0.1:54321';
  const SECRET = 'test-only-bypass-secret-0123456789abcdef';
  const testAuth = resolveTestAuth({
    TEST_AUTH_ENABLED: true,
    TEST_BYPASS_OTP: '000000',
    SUPABASE_URL: LOCAL,
    DATABASE_URL: 'postgresql://dsa_api:localpassword@localhost:5432/postgres',
    BYPASS_JWT_SECRET: SECRET,
  }) as TestAuthConfig;

  const app = express();
  app.use(correlation());
  app.use(express.json());
  app.use('/public/v1', createPublicAuthRouter({ deps, testAuth }));
  app.use(errorHandler());

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects login request missing email or otp with VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/public/v1/auth/test-login')
      .send({ email: '' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects wrong OTP with 401 INVALID_CREDENTIALS', async () => {
    const res = await request(app)
      .post('/public/v1/auth/test-login')
      .send({ email: 'rm1@alpha.com', otp: '111111' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 404 NOT_FOUND when user does not exist in database', async () => {
    const res = await request(app)
      .post('/public/v1/auth/test-login')
      .send({ email: 'nonexistent@example.com', otp: '000000' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('accepts the fixed code for an active DB user and mints an aal2 token the local verifier accepts', async () => {
    const res = await request(app)
      .post('/public/v1/auth/test-login')
      .send({ email: 'rm1@alpha.com', otp: '000000' });

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.access_token).toBeDefined();
    expect(res.body.data.user.email).toBe('rm1@alpha.com');

    // Verify token with TokenVerifier configured with the same test secret
    const verifier = createTokenVerifier({
      supabaseUrl: LOCAL,
      bypassSecret: SECRET,
    });
    const verified = await verifier.verify(res.body.data.access_token);
    expect(verified.email).toBe('rm1@alpha.com');
    expect(verified.aal).toBe('aal2');
    expect(verified.tenantId).toBe(mockUser.tenant_id);

    // Resolve Principal
    const resolver = createPrincipalResolver(mockTxRunner);
    const principal = await resolver.resolve(verified, {
      correlationId: 'test_corr_01',
      now: new Date(),
    });
    expect(principal.id).toBe(mockUser.id);
    expect(principal.tenantId).toBe(mockUser.tenant_id);
    expect(principal.grants.map((g) => g.code)).toContain('lead.read');
  });

  it('a verifier without the test secret refuses a test-login token', async () => {
    const res = await request(app)
      .post('/public/v1/auth/test-login')
      .send({ email: 'rm1@alpha.com', otp: '000000' });

    const verifier = createTokenVerifier({ supabaseUrl: LOCAL });
    await expect(verifier.verify(res.body.data.access_token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('lists active test users on GET /public/v1/auth/test-users', async () => {
    const res = await request(app).get('/public/v1/auth/test-users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].email).toBe('rm1@alpha.com');
  });

  it('writes neither the one-time code nor the email to the console', async () => {
    const spies = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
    ];
    await request(app).post('/public/v1/auth/test-login').send({ email: 'rm1@alpha.com', otp: '111111' });
    await request(app).post('/public/v1/auth/test-login').send({ email: 'rm1@alpha.com', otp: '000000' });

    const logged = spies.flatMap((spy) => spy.mock.calls).map((args) => JSON.stringify(args)).join('\n');
    expect(logged).not.toContain('rm1@alpha.com');
    expect(logged).not.toContain('111111');
    expect(logged).not.toContain('000000');
  });
});

describe('test login is mounted only when the gate allows it', () => {
  it('answers 404 for test-login and test-users when createApp has no test auth', async () => {
    const app = createTestApp();
    const login = await request(app)
      .post('/public/v1/auth/test-login')
      .send({ email: 'rm1@alpha.com', otp: '000000' });
    const users = await request(app).get('/public/v1/auth/test-users');

    expect(login.status).toBe(404);
    expect(users.status).toBe(404);
  });
});
