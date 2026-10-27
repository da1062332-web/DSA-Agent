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
import { moduleGate } from './http/module-gate';
import { rateLimit } from './http/rate-limit';
import swaggerUi from 'swagger-ui-express';
import { apiModules } from './modules';
import { createPublicMessagingRouter } from './modules/crm/messaging/router';
import { createPublicDocumentSharingRouter } from './modules/origination/document-sharing/router';
import { createPublicDocumentRouter } from './modules/origination/applications/documents';
import { createPublicApplyRouter } from './modules/crm/leads/lead-extras';
import { createPublicAuthRouter } from './http/public-auth-router';
import type { TestAuthConfig } from './test-auth';
import { createConnectorPortalRouter } from './modules/finance/connector-portal';
import { createPublicIntegrationWebhookRouter } from './modules/integrations/inbound-webhooks';
import { createLeadService } from './modules/crm/leads/router';
import { createPlatformRouter } from './modules/platform-admin/router';
import type { ApiDeps } from './modules/types';
import { buildOpenApiDocument } from './openapi';

export interface CreateAppOptions {
  deps: ApiDeps;
  corsAllowedOrigins: string[];
  /** Authentication for /v1: supabaseAuth(...) in server.ts. Default: 401 on every request. Tests pass fakeAuth(principal). */
  auth?: RequestHandler;
  /** Request logging is off when no logger is given (tests). */
  logger?: Logger;
  /** Test login routes (test-login, test-users). Mounted only when given: server.ts gives it only when test-auth.ts allows. */
  testAuth?: TestAuthConfig;
}

/** ApiDeps carries some ports under two names (audit/auditPort, ids/idGenerator, userDirectory/userDirectoryPort) and modules
 *  read either. Fill each alias from the other so every module sees the same port, whichever name it reads. */
export function withDepAliases(deps: ApiDeps): ApiDeps {
  return {
    ...deps,
    audit: deps.audit ?? deps.auditPort,
    auditPort: deps.auditPort ?? deps.audit,
    ids: deps.ids ?? deps.idGenerator,
    idGenerator: deps.idGenerator ?? deps.ids,
    userDirectory: deps.userDirectory ?? deps.userDirectoryPort,
    userDirectoryPort: deps.userDirectoryPort ?? deps.userDirectory,
  };
}

export function createApp(opts: CreateAppOptions): Express {
  const app = express();
  opts = { ...opts, deps: withDepAliases(opts.deps) };

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
        // One readable line: "GET /v1/users/usr_1 200 12ms [01M5V...]". The correlation id stays in the log record.
        customSuccessMessage: (req, res, ms) =>
          `${req.method} ${req.url?.split('?')[0]} ${res.statusCode} ${Math.round(ms)}ms${req.id ? ` [${req.id}]` : ''}`,
        customErrorMessage: (req, res, err) =>
          `${req.method} ${req.url?.split('?')[0]} ${res.statusCode} ${err.message}${req.id ? ` [${req.id}]` : ''}`,
        customLogLevel: (_req, res, err) => {
          if (err || res.statusCode >= 500 || res.statusCode === 401) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
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
  // The raw body is kept for signature checks over the exact bytes received (API-INT-006).
  publicV1.use(
    express.json({
      limit: '25mb',
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  publicV1.use(createPublicMessagingRouter(opts.deps));
  publicV1.use(createPublicDocumentSharingRouter(opts.deps));
  publicV1.use(createPublicDocumentRouter(opts.deps));
  publicV1.use(createPublicApplyRouter(opts.deps, () => createLeadService(opts.deps)));
  publicV1.use(createPublicIntegrationWebhookRouter(opts.deps));
  // Test login is mounted only when createApp is given a testAuth. Without it these paths answer 404 like any unknown path.
  if (opts.testAuth) publicV1.use(createPublicAuthRouter({ deps: opts.deps, testAuth: opts.testAuth }));
  app.use('/public/v1', publicV1);

  // Platform realm (API-TEN-002, API-ADM-001..API-ADM-009) at /platform/v1. The tenant-realm part of platform-admin
  // (support-access approvals, data corrections) is an ordinary module under /v1.
  const noStore: RequestHandler = (req, res, next) => {
    delete req.headers['if-none-match'];
    res.set('Cache-Control', 'no-store');
    res.vary('Authorization');
    next();
  };
  const platformRouter = express.Router();
  platformRouter.use(noStore);
  platformRouter.use(opts.auth ?? authPlaceholder);
  platformRouter.use(rateLimit());
  platformRouter.use(express.json({ limit: '10mb' }));
  platformRouter.use(createPlatformRouter(opts.deps));
  platformRouter.use(notFound);
  app.use('/platform', platformRouter);

  // Connector portal (MOD-CPT, API-CPT-001..007) at /portal/v1: connector users only, CONNECTOR_SELF scope.
  const portalV1 = express.Router();
  portalV1.use(noStore);
  portalV1.use(opts.auth ?? authPlaceholder);
  portalV1.use(rateLimit());
  portalV1.use(express.json({ limit: '1mb' }));
  portalV1.use(createConnectorPortalRouter(opts.deps));
  portalV1.use(notFound);
  app.use('/portal/v1', portalV1);

  const v1 = express.Router();
  // Authenticated responses are per user and must never come from a cache. ETags are record versions ("0" for many
  // records and users), so a browser revalidating with If-None-Match would get 304 and show the previous user's data.
  // If-Match (optimistic concurrency) is unaffected.
  v1.use(noStore);
  v1.use(opts.auth ?? authPlaceholder);
  v1.use(rateLimit());
  v1.use(express.json({ limit: '1mb' }));
  // MOD-TEN entitlements: a module the tenant is not entitled to answers 403 MODULE_NOT_ENABLED.
  v1.use(moduleGate(opts.deps.txRunner));
  for (const mod of apiModules) v1.use(mod.createRouter(opts.deps));
  v1.use(notFound);
  app.use('/v1', v1);

  app.use(notFound);
  app.use(errorHandler(opts.logger));
  return app;
}
