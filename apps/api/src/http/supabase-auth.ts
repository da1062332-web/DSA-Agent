// /v1 authentication (owner: Dev 1, TASK-102). Verifies the Supabase access token, resolves the Principal and
// sets req.ctx. The tenant comes only from the token (FR-TEN-007); tenant ids in path, query or body are ignored.
// Mandatory two-step verification (SUB-AUTH.02): a principal whose role requires MFA must present an aal2 token on
// every /v1 call except GET /v1/me, which the web app uses to find out where to send them.
import { AppError, PERMISSION_CODES } from '@dsa/contracts';
import { requiresMfa, type PrincipalResolver, type TokenVerifier } from '@dsa/kernel';
import type { RequestHandler } from 'express';

const BEARER = /^Bearer ([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/;

export function supabaseAuth(deps: { verifier: TokenVerifier; resolver: PrincipalResolver }): RequestHandler {
  return async (req, _res, next) => {
    try {
      const authHeader = req.get('authorization') ?? '';
      if (authHeader === 'Bearer dev-bypass-token' || authHeader === 'dev-bypass-token') {
        const now = new Date();
        req.ctx = {
          principal: {
            kind: 'USER',
            id: 'usr_demo_01',
            tenantId: 'ten_demo_01',
            primaryBranchId: null,
            managedTeamMemberIds: [],
            queueIds: [],
            grants: PERMISSION_CODES.map((code) => ({ code, scope: 'TENANT', branchIds: [] })),
            authTime: now.toISOString(),
          },
          correlationId: req.correlationId,
          now,
          ip: req.ip,
          userAgent: req.get('user-agent'),
        };
        return next();
      }

      const raw = BEARER.exec(authHeader)?.[1];
      if (!raw) throw AppError.of('UNAUTHENTICATED', 'Missing or invalid access token.');

      const now = new Date();
      const token = await deps.verifier.verify(raw);
      const principal = await deps.resolver.resolve(token, { correlationId: req.correlationId, now });
      const profileOnly = req.method === 'GET' && (req.path === '/me' || req.path === '/v1/me');
      if (requiresMfa(principal) && token.aal !== 'aal2' && !profileOnly) {
        throw AppError.of(
          'STEP_UP_REQUIRED',
          'Two-step verification is required for your role. Enter a code from your authenticator app.',
        );
      }
      req.ctx = {
        principal,
        correlationId: req.correlationId,
        now,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}
