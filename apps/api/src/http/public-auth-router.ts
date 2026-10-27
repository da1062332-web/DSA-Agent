// Test login (owner: Dev 1). Mounted only when createApp is given a testAuth, which test-auth.ts allows only for the local stack and an
// isolated database. Nothing here logs the one-time code, the email or a token.
import express, { type Router } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { AppError } from '@dsa/contracts';
import { mintBypassToken } from '@dsa/kernel';
import type { ApiDeps } from '../modules/types';
import type { TestAuthConfig } from '../test-auth';

export interface PublicAuthRouterOptions {
  deps: ApiDeps;
  testAuth: TestAuthConfig;
}

const TestLoginSchema = z.object({
  email: z.string().trim().min(1),
  otp: z.string().trim(),
});

export function createPublicAuthRouter(opts: PublicAuthRouterOptions): Router {
  const router = express.Router();
  const { testAuth } = opts;

  // GET /public/v1/auth/test-users — Lists available active users for testing login
  router.get('/auth/test-users', async (_req, res, next) => {
    try {
      const users = await opts.deps.txRunner.withTenantTx(
        {
          principal: {
            kind: 'SERVICE',
            id: 'SYSTEM:auth',
            tenantId: 'SYSTEM',
            grants: [],
            queueIds: [],
            managedTeamMemberIds: [],
            primaryBranchId: null,
            authTime: null,
          },
          correlationId: `test_usr_${Date.now()}`,
          now: new Date(),
        },
        async (tx) => {
          if (typeof (tx as any).query === 'function') {
            const res = await (tx as any).query('SELECT * FROM app.list_test_users()');
            return res.rows;
          }
          const rows = await sql<{
            id: string;
            email: string;
            display_name: string;
            tenant_id: string;
            role_code: string | null;
            role_name: string | null;
            branch_name: string | null;
          }>`SELECT * FROM app.list_test_users()`.execute(tx);
          return rows.rows;
        },
      );

      res.status(200).json({ data: users });
    } catch (err) {
      next(err);
    }
  });

  // POST /public/v1/auth/test-login — Signs a test user in with the fixed one-time code
  router.post('/auth/test-login', async (req, res, next) => {
    try {
      const parsed = TestLoginSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.of('VALIDATION_ERROR', 'Valid email and OTP are required.');
      }
      const { email, otp } = parsed.data;

      // 1. The fixed one-time code. The request is not logged, so neither the code nor the email reaches the logs.
      if (otp !== testAuth.otp) {
        throw AppError.of('UNAUTHENTICATED', 'Invalid test OTP.');
      }

      const normalizedEmail = email.toLowerCase();

      // 2. Query user via SECURITY DEFINER function app.lookup_test_user(p_email)
      const user = await opts.deps.txRunner.withTenantTx(
        {
          principal: {
            kind: 'SERVICE',
            id: 'SYSTEM:auth',
            tenantId: 'SYSTEM',
            grants: [],
            queueIds: [],
            managedTeamMemberIds: [],
            primaryBranchId: null,
            authTime: null,
          },
          correlationId: `test_auth_${Date.now()}`,
          now: new Date(),
        },
        async (tx) => {
          if (typeof (tx as any).query === 'function') {
            const res = await (tx as any).query('SELECT * FROM app.lookup_test_user($1)', [normalizedEmail]);
            return res.rows[0];
          }
          const result = await sql<{
            id: string;
            tenant_id: string;
            idp_subject: string | null;
            email: string;
            display_name: string;
            status: string;
            tenant_status: string;
          }>`SELECT * FROM app.lookup_test_user(${normalizedEmail})`.execute(tx);
          return result.rows[0];
        },
      );

      if (!user) {
        throw AppError.of('NOT_FOUND', 'No active database user matches that email.');
      }
      if (user.status !== 'ACTIVE') {
        throw AppError.of('FORBIDDEN', `User account is ${user.status}.`);
      }
      if (user.tenant_status !== 'ACTIVE') {
        throw AppError.of('FORBIDDEN', `Tenant is ${user.tenant_status}.`);
      }

      // 3. Mint a test token with aal2 (satisfies MFA), signed with the test secret and issued by the local stack
      const token = await mintBypassToken({
        supabaseUrl: testAuth.supabaseUrl,
        secret: testAuth.secret,
        sub: user.idp_subject || user.id,
        tenantId: user.tenant_id,
        email: user.email,
        aal: 'aal2',
        ttlSeconds: 86400,
      });

      const session = {
        access_token: token,
        token_type: 'bearer',
        expires_in: 86400,
        expires_at: Math.floor(Date.now() / 1000) + 86400,
        refresh_token: 'bypass-refresh-token',
        user: {
          id: user.idp_subject || user.id,
          aud: 'authenticated',
          role: 'authenticated',
          email: user.email,
          app_metadata: { tenant_id: user.tenant_id },
          user_metadata: { display_name: user.display_name },
          created_at: new Date().toISOString(),
        },
      };

      res.status(200).json({ data: session });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
