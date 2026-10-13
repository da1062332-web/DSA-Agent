// Express app factory (owner: Dev 1). Middleware order is fixed by Contracts §1:
// helmet → CORS allow-list → correlation → auth → rate limit → (per-route zod validation → handler) → error handler.
import crypto from 'node:crypto';
import cors from 'cors';
import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import { SignJWT } from 'jose';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@dsa/contracts';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { authPlaceholder } from './http/auth-placeholder';
import { CORRELATION_HEADER, correlation } from './http/correlation';
import { errorHandler } from './http/error-handler';
import { notFound } from './http/not-found';
import { rateLimit } from './http/rate-limit';
import swaggerUi from 'swagger-ui-express';
import { apiModules } from './modules';
import type { ApiDeps } from './modules/types';
import { buildOpenApiDocument } from './openapi';

export interface CreateAppOptions {
  deps: ApiDeps;
  corsAllowedOrigins: string[];
  /** This environment's Supabase URL, shown in Swagger for the auth operations. */
  supabaseUrl?: string;
  jwtSecret?: string;
  db?: Kysely<Database>;
  /** Authentication for /v1: supabaseAuth(...) in server.ts. Default: 401 on every request. Tests pass fakeAuth(principal). */
  auth?: RequestHandler;
  /** Request logging is off when no logger is given (tests). */
  logger?: Logger;
}

export function createApp(opts: CreateAppOptions): Express {
  const app = express();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: opts.corsAllowedOrigins,
      exposedHeaders: [
        CORRELATION_HEADER,
        'ETag',
        'Idempotent-Replayed',
        'Retry-After',
        'RateLimit-Limit',
        'RateLimit-Remaining',
        'RateLimit-Reset',
      ],
    }),
  );
  app.use(correlation());
  if (opts.logger) {
    app.use(
      pinoHttp({
        logger: opts.logger,
        genReqId: (req) => req.correlationId,
        // Method, path and status only: no headers, query strings or bodies (Contracts §12).
        serializers: {
          req: (req: { id: string; method: string; url?: string }) => ({
            correlationId: req.id,
            method: req.method,
            route: req.url?.split('?')[0],
          }),
          res: (res: { statusCode: number }) => ({ status: res.statusCode }),
        },
      }),
    );
  }

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const openApiDoc = buildOpenApiDocument({ supabaseUrl: opts.supabaseUrl });
  app.get('/openapi.json', (_req, res) => {
    res.json(openApiDoc);
  });
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));
  app.use('/swagger', swaggerUi.serve, swaggerUi.setup(openApiDoc));

  const PASSWORD_SALT = 'dsa_crm_salt_2026';
  function hashPassword(password: string): string {
    return crypto.scryptSync(password, PASSWORD_SALT, 64).toString('hex');
  }

  app.post('/auth/login', express.json(), async (req, res, next) => {
    try {
      const { email, password } = req.body ?? {};
      if (!email || typeof email !== 'string' || !email.trim()) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Email or User ID is required.' } });
      }
      if (!password || typeof password !== 'string') {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Password is required.' } });
      }

      const cleanIdentifier = email.trim();
      if (!opts.db) {
        return res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Database client unavailable.' } });
      }

      const queryRes = await sql<{
        id: string;
        tenant_id: string;
        idp_subject: string | null;
        email: string;
        display_name: string;
        password_hash: string | null;
        status: string;
      }>`SELECT * FROM app.authenticate_user(${cleanIdentifier})`.execute(opts.db);

      const userRow = queryRes.rows[0];
      if (!userRow || !userRow.password_hash) {
        return res.status(401).json({
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
        });
      }

      const inputHash = hashPassword(password);
      if (inputHash !== userRow.password_hash) {
        return res.status(401).json({
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
        });
      }

      const subject = userRow.idp_subject ?? userRow.id;
      const tenantId = userRow.tenant_id;
      const jwtSecret = opts.jwtSecret ?? 'dsa_internal_jwt_signing_secret_2026_qloax';
      const supabaseUrl = (opts.supabaseUrl ?? 'https://mlpkwwhnagxzinaohdxg.supabase.co').replace(/\/+$/, '');
      const iat = Math.floor(Date.now() / 1000);
      const expiresIn = 604800; // 7 days

      const accessToken = await new SignJWT({
        role: 'authenticated',
        aal: 'aal1',
        amr: [{ method: 'password', timestamp: iat }],
        app_metadata: { tenant_id: tenantId },
        user_metadata: { display_name: userRow.display_name },
        email: userRow.email,
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuer(`${supabaseUrl}/auth/v1`)
        .setAudience('authenticated')
        .setSubject(subject)
        .setIssuedAt(iat)
        .setExpirationTime(iat + expiresIn)
        .sign(new TextEncoder().encode(jwtSecret));

      const session = {
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: expiresIn,
        expires_at: iat + expiresIn,
        refresh_token: accessToken,
        user: {
          id: subject,
          email: userRow.email,
          app_metadata: { tenant_id: tenantId },
          user_metadata: { display_name: userRow.display_name },
        },
      };

      return res.status(200).json(session);
    } catch (err) {
      next(err);
    }
  });

  app.post('/auth/logout', (_req, res) => {
    res.status(200).json({ success: true });
  });

  const v1 = express.Router();
  v1.use(opts.auth ?? authPlaceholder);
  v1.use(rateLimit());
  v1.use(express.json({ limit: '1mb' }));
  for (const mod of apiModules) v1.use(mod.createRouter(opts.deps));
  v1.use(notFound);
  app.use('/v1', v1);

  app.use(notFound);
  app.use(errorHandler(opts.logger));
  return app;
}
