// Connector portal logins are refused on the internal API (/v1 and /platform/v1). A portal login reaches its own data through
// /portal/v1 only, scoped to the connector it is linked to (modules/finance/connector-portal.ts). The one exception is GET /me, which the
// web app calls to find out where to send the user. The user type comes from app_user through the principal resolver, so a request
// cannot choose it. This is a second refusal, on top of the database holding no role for a connector login (migration 0097).
import { AppError } from '@dsa/contracts';
import type { RequestHandler } from 'express';

export const connectorIdentityGate: RequestHandler = (req, _res, next) => {
  const principal = req.ctx?.principal;
  if (!principal || principal.userType !== 'CONNECTOR') return next();
  if (req.method === 'GET' && (req.path === '/me' || req.path === '/v1/me')) return next();
  next(
    AppError.of(
      'FORBIDDEN',
      'A connector portal login uses the connector portal, not this part of the system.',
      [{ issue: 'CONNECTOR_IDENTITY_NOT_ALLOWED' }],
    ),
  );
};
