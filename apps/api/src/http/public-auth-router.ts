import express, { type Router } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { AppError } from '@dsa/contracts';
import { mintBypassToken } from '@dsa/kernel';
import type { ApiDeps } from '../modules/types';

export interface PublicAuthRouterOptions {
  deps: ApiDeps;
  supabaseUrl: string;
  bypassSecret: string;
  bypassOtp: string;
}

const TestLoginSchema = z.object({
  email: z.string().trim().min(1),
  otp: z.string().trim(),
});

export function createPublicAuthRouter(opts: PublicAuthRouterOptions): Router {
  const router = express.Router();

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

  // POST /public/v1/auth/test-login — Login with hardcoded OTP for testing
  router.post('/auth/test-login', async (req, res, next) => {
    try {
      const parsed = TestLoginSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.of('VALIDATION_ERROR', 'Valid email and OTP are required.');
      }
      const { email, otp } = parsed.data;
      console.log(`[test-login] Received login request for email: "${email}", otp: "${otp}"`);

      // 1. Verify hardcoded OTP
      if (otp !== opts.bypassOtp && otp !== '000000') {
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
        throw AppError.of('NOT_FOUND', `No active database user found for "${email}".`);
      }
      if (user.status !== 'ACTIVE') {
        throw AppError.of('FORBIDDEN', `User account is ${user.status}.`);
      }
      if (user.tenant_status !== 'ACTIVE') {
        throw AppError.of('FORBIDDEN', `Tenant is ${user.tenant_status}.`);
      }

      // 3. Mint JWT token with aal2 (satisfies MFA)
      const token = await mintBypassToken({
        supabaseUrl: opts.supabaseUrl,
        secret: opts.bypassSecret,
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
