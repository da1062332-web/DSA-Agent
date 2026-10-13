// /v1 authentication (owner: Dev 1, TASK-102). Verifies the Supabase access token, resolves the Principal and
// sets req.ctx. The tenant comes only from the token (FR-TEN-007); tenant ids in path, query or body are ignored.
import { AppError } from '@dsa/contracts';
import type { PrincipalResolver, TokenVerifier } from '@dsa/kernel';
import type { RequestHandler } from 'express';

const BEARER = /^Bearer ([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/;

export function supabaseAuth(deps: { verifier: TokenVerifier; resolver: PrincipalResolver }): RequestHandler {
  return async (req, _res, next) => {
    try {
      const raw = BEARER.exec(req.get('authorization') ?? '')?.[1];
      if (!raw) throw AppError.of('UNAUTHENTICATED', 'Missing or invalid access token.');

      const now = new Date();
      const token = await deps.verifier.verify(raw);
      const principal = await deps.resolver.resolve(token, { correlationId: req.correlationId, now });
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
