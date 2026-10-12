// Express app factory (owner: Dev 1). Middleware order is fixed by Contracts §1:
// helmet → CORS allow-list → correlation → auth → rate limit → (per-route zod validation → handler) → error handler.
import crypto from 'node:crypto';
import cors from 'cors';
import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import type { Database } from '@dsa/contracts';
import { type Kysely, sql } from 'kysely';
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

const PASSWORD_SALT = 'dsa_crm_salt_2026';
export function hashPassword(password: string): string {
  return crypto.scryptSync(password, PASSWORD_SALT, 64).toString('hex');
}

export interface CreateAppOptions {
  deps: ApiDeps;
  corsAllowedOrigins: string[];
  db?: Kysely<Database>;
  /** Authentication for /v1. Default: 401 on every request until TASK-102. Tests pass fakeAuth(principal). */
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

  const openApiDoc = buildOpenApiDocument();
  app.get('/openapi.json', (_req, res) => {
    res.json(openApiDoc);
  });
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));
  app.use('/swagger', swaggerUi.serve, swaggerUi.setup(openApiDoc));

  app.post('/auth/login', express.json(), async (req, res, next) => {
    try {
      const { email, password } = req.body ?? {};
      if (!email || typeof email !== 'string' || !email.trim()) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Email or User ID is required.' } });
      }
      if (!password || typeof password !== 'string') {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Password is required.' } });
      }

      const cleanEmail = email.trim();

      if (opts.db) {
        const queryRes = await sql<{
          id: string;
          tenant_id: string;
          email: string;
          display_name: string;
          password_hash: string | null;
          status: string;
        }>`SELECT * FROM app.authenticate_user(${cleanEmail})`.execute(opts.db);

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

        const user = {
          id: userRow.id,
          email: userRow.email,
          displayName: userRow.display_name,
          tenantId: userRow.tenant_id,
          authenticatedAt: new Date().toISOString(),
        };

        const token = `token_${Buffer.from(JSON.stringify(user)).toString('base64url')}`;
        return res.status(200).json({ token, user });
      }

      return res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Database connection not available.' },
      });
    } catch (err) {
      next(err);
    }
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
