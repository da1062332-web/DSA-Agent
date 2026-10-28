// /v1 authentication (owner: Dev 1, TASK-102). Verifies the Supabase access token, resolves the Principal and
// sets req.ctx. The tenant comes only from the token (FR-TEN-007); tenant ids in path, query or body are ignored.
// Mandatory two-step verification (SUB-AUTH.02): a principal whose role requires MFA must present an aal2 token on
// every /v1 call except GET /v1/me, which the web app uses to find out where to send them.
import { AppError } from '@dsa/contracts';
import { requiresMfa, type PrincipalResolver, type TokenVerifier } from '@dsa/kernel';
import type { RequestHandler } from 'express';
import { secondFactorSkipped } from './mfa-switch';

const BEARER = /^Bearer ([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/;

export function supabaseAuth(deps: { verifier: TokenVerifier; resolver: PrincipalResolver }): RequestHandler {
  return async (req, _res, next) => {
    try {
      const raw =
        BEARER.exec(req.get('authorization') ?? '')?.[1] ||
        (typeof req.query.token === 'string' && req.query.token ? req.query.token : undefined) ||
        (typeof req.query.access_token === 'string' && req.query.access_token
          ? req.query.access_token
          : undefined);
      if (!raw) throw AppError.of('UNAUTHENTICATED', 'Missing or invalid access token.');

      const now = new Date();
      const token = await deps.verifier.verify(raw);
      const principal = await deps.resolver.resolve(token, { correlationId: req.correlationId, now });
      const profileOnly = req.method === 'GET' && (req.path === '/me' || req.path === '/v1/me');
      // The developer switch is honoured only against a local stack; the project setting applies to any project (see mfa-switch.ts).
      const skipMfa = secondFactorSkipped();
      if (!skipMfa && requiresMfa(principal) && token.aal !== 'aal2' && !profileOnly) {
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
