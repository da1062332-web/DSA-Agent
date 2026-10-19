// apps/api/src/modules/integrations/router.ts
// Module 28: Integration Management (MOD-INT) Router

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  AppError,
  ConfigureIntegrationRequestSchema,
  ListIntegrationsQuerySchema,
  type PermissionCode,
  type RequestContext,
} from '@dsa/contracts';
import type { ApiDeps } from '../types';
import { IntegrationService } from './integration-service';

export { IntegrationService };

export function createRouter(deps: ApiDeps, serviceOverride?: IntegrationService): Router {
  const router = Router();
  const service = serviceOverride ?? new IntegrationService(deps);

  const getContext = (req: Request): RequestContext => {
    const ctx = req.ctx as RequestContext | undefined;
    if (!ctx || !ctx.principal) {
      throw AppError.of('UNAUTHENTICATED', 'Authentication required.');
    }
    return ctx;
  };

  const requireAnyPermission = (ctx: RequestContext, ...codes: PermissionCode[]): void => {
    if (ctx.principal.kind === 'SERVICE') return;
    const hasGrant = ctx.principal.grants.some((g) => codes.includes(g.code as PermissionCode));
    if (!hasGrant) {
      throw AppError.of('FORBIDDEN', `Permission denied: one of [${codes.join(', ')}] required.`);
    }
  };

  const getParam = (req: Request, name: string): string => String(req.params[name] ?? '');

  // 1. GET /v1/integrations/capabilities (Catalog of supported operations)
  router.get(
    '/integrations/capabilities',
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const capabilities = service.listCapabilities();
        res.json({ data: capabilities, meta: { total: capabilities.length } });
      } catch (err) {
        next(err);
      }
    },
  );

  // 2. GET /v1/integrations (API-INT-001)
  router.get(
    '/integrations',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requireAnyPermission(ctx, 'config.manage', 'integration.read');
        const query = ListIntegrationsQuerySchema.parse(req.query);
        const result = await service.listIntegrations(ctx, query);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // 3. GET /v1/integrations/:provider
  router.get(
    '/integrations/:provider',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requireAnyPermission(ctx, 'config.manage', 'integration.read');
        const provider = getParam(req, 'provider');
        const capability = String(req.query.capability ?? '');
        if (!capability) {
          throw AppError.of(
            'VALIDATION_ERROR',
            'Query parameter "capability" is required when fetching single integration.',
          );
        }
        const conn = await service.getIntegration(ctx, provider, capability);
        res.set('ETag', `"${conn.lockVersion}"`);
        res.json(conn);
      } catch (err) {
        next(err);
      }
    },
  );

  // 4. PUT /v1/integrations/:provider (API-INT-002)
  router.put(
    '/integrations/:provider',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requireAnyPermission(ctx, 'config.manage', 'integration.manage');
        const provider = getParam(req, 'provider');
        const input = ConfigureIntegrationRequestSchema.parse(req.body);
        const ifMatch = req.get('if-match');

        const updated = await service.configureIntegration(ctx, provider, input, ifMatch);
        res.set('ETag', `"${updated.lockVersion}"`);
        res.json(updated);
      } catch (err) {
        next(err);
      }
    },
  );

  // 5. POST /v1/integrations/:provider/ping (Manual Health Check probe)
  router.post(
    '/integrations/:provider/ping',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requireAnyPermission(ctx, 'config.manage', 'integration.manage');
        const provider = getParam(req, 'provider');
        const capability = String(req.body?.capability ?? '');
        if (!capability) {
          throw AppError.of('VALIDATION_ERROR', 'Field "capability" is required in ping payload.');
        }
        const health = await service.pingIntegration(ctx, provider, capability);
        res.json(health);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
