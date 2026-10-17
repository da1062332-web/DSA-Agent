// apps/api/src/modules/platform-admin/router.ts
// Module: platform-admin — owner: Platform squad (MOD-ADM: SUB-ADM.01 to SUB-ADM.08)
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  AppError,
  ApproveDataCorrectionRequestSchema,
  ApproveSupportAccessRequestSchema,
  CreateDataCorrectionRequestSchema,
  CreateSupportAccessRequestSchema,
  ListPlatformTenantsQuerySchema,
  MasterDataImportRequestSchema,
  PauseQueueRequestSchema,
  ResumeQueueRequestSchema,
  UpdateFeatureFlagRequestSchema,
  type PermissionCode,
  type RequestContext,
} from '@dsa/contracts';
import type { ApiDeps } from '../types';
import { PlatformAdminService } from './platform-admin-service';

export { PlatformAdminService };

export function createRouter(deps: ApiDeps, serviceOverride?: PlatformAdminService): Router {
  const router = Router();
  const service = serviceOverride ?? new PlatformAdminService(deps);

  const getContext = (req: Request): RequestContext => {
    const ctx = req.ctx as RequestContext | undefined;
    if (!ctx || !ctx.principal) {
      throw AppError.of('UNAUTHENTICATED', 'Authentication required.');
    }
    return ctx;
  };

  const requirePermission = (ctx: RequestContext, code: PermissionCode): void => {
    if (ctx.principal.kind === 'SERVICE') return;
    const hasGrant = ctx.principal.grants.some((g) => g.code === code);
    if (!hasGrant) {
      throw AppError.of('FORBIDDEN', `Permission denied: ${code} required.`);
    }
  };

  const getParam = (req: Request, name: string): string => String(req.params[name] ?? '');

  // ==========================================
  // SUB-ADM.01: Platform Console (API-TEN-002)
  // ==========================================
  router.get(
    ['/v1/tenants', '/platform/v1/tenants'],
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'platform.console');
        const query = ListPlatformTenantsQuerySchema.parse(req.query);
        const result = await service.listTenants(ctx, query);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // ==========================================
  // SUB-ADM.02: Feature Flags (API-ADM-001 / API-ADM-002)
  // ==========================================
  router.get(['/v1/flags', '/platform/v1/flags'], async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'platform.flags');
      const result = await service.listFeatureFlags();
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get(
    ['/v1/flags/:key', '/platform/v1/flags/:key'],
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'platform.flags');
        const scope = (req.query.scope as string) || 'GLOBAL';
        const flag = await service.getFeatureFlag(getParam(req, 'key'), scope);
        res.set('ETag', `"${flag.lockVersion}"`);
        res.json(flag);
      } catch (err) {
        next(err);
      }
    },
  );

  router.put(
    ['/v1/flags/:key', '/platform/v1/flags/:key'],
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'platform.flags');
        const input = UpdateFeatureFlagRequestSchema.parse(req.body);
        const ifMatch = req.get('if-match');
        const updated = await service.putFeatureFlag(getParam(req, 'key'), input, ifMatch, ctx.principal.id);
        res.set('ETag', `"${updated.lockVersion}"`);
        res.json(updated);
      } catch (err) {
        next(err);
      }
    },
  );

  // ==========================================
  // SUB-ADM.03: Master Data (API-ADM-003)
  // ==========================================
  router.get(
    ['/v1/master-data', '/platform/v1/master-data'],
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'platform.master_data');
        const listCode = req.query.listCode as string | undefined;
        const result = await service.getMasterData(listCode);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    ['/v1/master-data/imports', '/platform/v1/master-data/imports'],
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'platform.master_data');
        const body = MasterDataImportRequestSchema.parse(req.body);
        const result = await service.importMasterData(body, ctx.principal.id);
        res.status(body.dryRun ? 200 : 201).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // ==========================================
  // SUB-ADM.04: Background Jobs (API-ADM-004 / API-ADM-005)
  // ==========================================
  router.get(['/v1/jobs', '/platform/v1/jobs'], async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'platform.jobs');
      const result = await service.getJobsAndQueues();
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    ['/v1/queues/:queue/pause', '/platform/v1/queues/:queue/pause'],
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'platform.jobs');
        const input = PauseQueueRequestSchema.parse(req.body);
        const result = await service.pauseQueue(getParam(req, 'queue'), input, ctx.principal.id);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    ['/v1/queues/:queue/resume', '/platform/v1/queues/:queue/resume'],
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'platform.jobs');
        const input = ResumeQueueRequestSchema.parse(req.body);
        const result = await service.resumeQueue(getParam(req, 'queue'), input, ctx.principal.id);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    ['/v1/dead-letters/:id/replay', '/platform/v1/dead-letters/:id/replay'],
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'platform.jobs');
        const result = await service.replayDeadLetter(getParam(req, 'id'));
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    ['/v1/dead-letters/:id/discard', '/platform/v1/dead-letters/:id/discard'],
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'platform.jobs');
        const result = await service.discardDeadLetter(getParam(req, 'id'));
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // ==========================================
  // SUB-ADM.05: System Health
  // ==========================================
  router.get(
    ['/v1/health', '/platform/v1/health'],
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await service.getSystemHealth();
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // ==========================================
  // SUB-ADM.06: Support Access (API-ADM-006 / API-ADM-007)
  // ==========================================
  router.get(
    ['/v1/support-access-requests', '/platform/v1/support-access-requests'],
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'platform.support_access');
        const tenantId = req.query.tenantId as string | undefined;
        const result = await service.listSupportAccessRequests(tenantId);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    ['/v1/support-access-requests', '/platform/v1/support-access-requests'],
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'platform.support_access');
        const input = CreateSupportAccessRequestSchema.parse(req.body);
        const result = await service.createSupportAccessRequest(input, ctx.principal.id);
        res.status(201).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    ['/v1/support-access-requests/:id/approval', '/support-access-requests/:id/approval'],
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'config.manage');
        const input = ApproveSupportAccessRequestSchema.parse(req.body);
        const result = await service.approveSupportAccessRequest(
          getParam(req, 'id'),
          input,
          ctx.principal.id,
        );
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // ==========================================
  // SUB-ADM.07: Data Correction (API-ADM-008 / API-ADM-009)
  // ==========================================
  router.get(
    ['/v1/data-corrections', '/data-corrections'],
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'data_correction.request');
        const result = await service.listDataCorrections(ctx.principal.tenantId);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    ['/v1/data-corrections', '/data-corrections'],
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'data_correction.request');
        const input = CreateDataCorrectionRequestSchema.parse(req.body);
        const result = await service.createDataCorrectionRequest(input, ctx.principal.id);
        res.status(201).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    ['/v1/data-corrections/:id/approval', '/data-corrections/:id/approval'],
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'data_correction.approve');
        const input = ApproveDataCorrectionRequestSchema.parse(req.body);
        const result = await service.approveDataCorrectionRequest(
          getParam(req, 'id'),
          input,
          ctx.principal.id,
        );
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    ['/v1/data-corrections/:id/execute', '/data-corrections/:id/execute'],
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'data_correction.approve');
        const result = await service.executeDataCorrection(getParam(req, 'id'));
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // ==========================================
  // SUB-ADM.08: Release Management (Release Register)
  // ==========================================
  router.get(
    ['/v1/releases', '/platform/v1/releases'],
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = getContext(req);
        requirePermission(ctx, 'platform.release');
        const result = await service.getReleases();
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
