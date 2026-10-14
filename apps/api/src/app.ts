// Express app factory (owner: Dev 1). Middleware order is fixed by Contracts §1:
// helmet → CORS allow-list → correlation → auth → rate limit → (per-route zod validation → handler) → error handler.
import cors from 'cors';
import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { authPlaceholder } from './http/auth-placeholder';
import { CORRELATION_HEADER, correlation } from './http/correlation';
import { errorHandler } from './http/error-handler';
import { notFound } from './http/not-found';
import { rateLimit } from './http/rate-limit';
import swaggerUi from 'swagger-ui-express';
import { apiModules } from './modules';
import { createPublicMessagingRouter } from './modules/crm/messaging/router';
import { createPublicDocumentSharingRouter } from './modules/origination/document-sharing/router';
import type { ApiDeps } from './modules/types';
import { buildOpenApiDocument } from './openapi';

export interface CreateAppOptions {
  deps: ApiDeps;
  corsAllowedOrigins: string[];
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

  const openApiDoc = buildOpenApiDocument();
  app.get('/openapi.json', (_req, res) => {
    res.json(openApiDoc);
  });
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));
  app.use('/swagger', swaggerUi.serve, swaggerUi.setup(openApiDoc));

  // Public routes (API-MSG-005, API-DSH-003..005)
  const publicV1 = express.Router();
  publicV1.use(rateLimit());
  publicV1.use(express.json({ limit: '25mb' }));
  publicV1.use(createPublicMessagingRouter(opts.deps));
  publicV1.use(createPublicDocumentSharingRouter(opts.deps));
  app.use('/public/v1', publicV1);

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
