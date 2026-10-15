// apps/api/src/modules/platform-admin/router.ts
// Module: platform-admin — owner: Platform squad (MOD-ADM: SUB-ADM.01 to SUB-ADM.08)
//
// Two realms (DSA Notion MODULE 1 and MODULE 40):
//   - Platform routes (console, flags, master data, jobs, health, support-access requests, releases) need the permission AND a
//     signed-in user of the platform tenant. A tenant administrator holding the same permission code is refused.
//   - Tenant routes (approving support access, data corrections) need the permission AND a user of a customer tenant. A platform
//     operator cannot approve their own request.
// Service identities get no shortcut in either realm. Every platform action and every cross-tenant read is written to the audit trail.
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
  isPlatformRealm,
  type AuditEventInput,
  type PermissionCode,
  type RequestContext,
} from '@dsa/contracts';
import { Router, type NextFunction, type Request, type Response } from 'express';
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
    if (!ctx.principal.grants.some((g) => g.code === code)) {
      throw AppError.of('FORBIDDEN', `Permission denied: ${code} required.`);
    }
  };

  /** The permission, held by a user of the platform tenant. */
  const requirePlatform = (ctx: RequestContext, code: PermissionCode): void => {
    requirePermission(ctx, code);
    if (!isPlatformRealm(ctx.principal)) {
      throw AppError.of('FORBIDDEN', 'This action is for platform operators only.');
    }
  };

  /** The permission, held by a user of a customer tenant (never a platform operator or a service identity). */
  const requireTenant = (ctx: RequestContext, code: PermissionCode): void => {
    requirePermission(ctx, code);
    if (ctx.principal.kind !== 'USER' || isPlatformRealm(ctx.principal)) {
      throw AppError.of('FORBIDDEN', 'This action belongs to a customer tenant.');
    }
  };

  /** An audit event for an action that has no database write of its own (the in-memory parts of the console). */
  const audit = (ctx: RequestContext, event: AuditEventInput): Promise<void> =>
    deps.txRunner.withTenantTx(ctx, async (tx) => {
      await deps.audit.record(tx, ctx, event);
    });

  const getParam = (req: Request, name: string): string => String(req.params[name] ?? '');

  type Handler = (ctx: RequestContext, req: Request, res: Response) => Promise<void>;
  const handle =
    (fn: Handler) =>
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        await fn(getContext(req), req, res);
      } catch (err) {
        next(err);
      }
    };

  // ==========================================
  // SUB-ADM.01: Platform Console (API-TEN-002)
  // ==========================================
  router.get(
    ['/v1/tenants', '/platform/v1/tenants'],
    handle(async (ctx, req, res) => {
      requirePlatform(ctx, 'platform.console');
      const query = ListPlatformTenantsQuerySchema.parse(req.query);
      res.json(await service.listTenants(ctx, query));
    }),
  );

  // ==========================================
  // SUB-ADM.02: Feature Flags (API-ADM-001 / API-ADM-002)
  // ==========================================
  router.get(
    ['/v1/flags', '/platform/v1/flags'],
    handle(async (ctx, _req, res) => {
      requirePlatform(ctx, 'platform.flags');
      res.json(await service.listFeatureFlags());
    }),
  );

  router.get(
    ['/v1/flags/:key', '/platform/v1/flags/:key'],
    handle(async (ctx, req, res) => {
      requirePlatform(ctx, 'platform.flags');
      const scope = (req.query.scope as string) || 'GLOBAL';
      const flag = await service.getFeatureFlag(getParam(req, 'key'), scope);
      res.set('ETag', `"${flag.lockVersion}"`);
      res.json(flag);
    }),
  );

  router.put(
    ['/v1/flags/:key', '/platform/v1/flags/:key'],
    handle(async (ctx, req, res) => {
      requirePlatform(ctx, 'platform.flags');
      const input = UpdateFeatureFlagRequestSchema.parse(req.body);
      const updated = await service.putFeatureFlag(getParam(req, 'key'), input, req.get('if-match'), ctx.principal.id);
      await audit(ctx, {
        action: 'platform.flag_set',
        entityType: 'FEATURE_FLAG',
        entityId: updated.key,
        after: { scope: updated.scope, value: updated.value },
        permissionUsed: 'platform.flags',
      });
      res.set('ETag', `"${updated.lockVersion}"`);
      res.json(updated);
    }),
  );

  // ==========================================
  // SUB-ADM.03: Master Data (API-ADM-003)
  // ==========================================
  router.get(
    ['/v1/master-data', '/platform/v1/master-data'],
    handle(async (ctx, req, res) => {
      requirePlatform(ctx, 'platform.master_data');
      res.json(await service.getMasterData(req.query.listCode as string | undefined));
    }),
  );

  router.post(
    ['/v1/master-data/imports', '/platform/v1/master-data/imports'],
    handle(async (ctx, req, res) => {
      requirePlatform(ctx, 'platform.master_data');
      const body = MasterDataImportRequestSchema.parse(req.body);
      const result = await service.importMasterData(body, ctx.principal.id);
      if (!body.dryRun) {
        await audit(ctx, {
          action: 'platform.master_data_imported',
          entityType: 'MASTER_DATA',
          entityId: null,
          after: { listCode: body.listCode },
          permissionUsed: 'platform.master_data',
        });
      }
      res.status(body.dryRun ? 200 : 201).json(result);
    }),
  );

  // ==========================================
  // SUB-ADM.04: Background Jobs (API-ADM-004 / API-ADM-005)
  // ==========================================
  router.get(
    ['/v1/jobs', '/platform/v1/jobs'],
    handle(async (ctx, _req, res) => {
      requirePlatform(ctx, 'platform.jobs');
      res.json(await service.getJobsAndQueues());
    }),
  );

  router.post(
    ['/v1/queues/:queue/pause', '/platform/v1/queues/:queue/pause'],
    handle(async (ctx, req, res) => {
      requirePlatform(ctx, 'platform.jobs');
      const input = PauseQueueRequestSchema.parse(req.body);
      const result = await service.pauseQueue(getParam(req, 'queue'), input, ctx.principal.id);
      await audit(ctx, {
        action: 'platform.queue_paused',
        entityType: 'JOB_QUEUE',
        entityId: getParam(req, 'queue'),
        reason: input.reason,
        permissionUsed: 'platform.jobs',
      });
      res.json(result);
    }),
  );

  router.post(
    ['/v1/queues/:queue/resume', '/platform/v1/queues/:queue/resume'],
    handle(async (ctx, req, res) => {
      requirePlatform(ctx, 'platform.jobs');
      const input = ResumeQueueRequestSchema.parse(req.body);
      const result = await service.resumeQueue(getParam(req, 'queue'), input, ctx.principal.id);
      await audit(ctx, {
        action: 'platform.queue_resumed',
        entityType: 'JOB_QUEUE',
        entityId: getParam(req, 'queue'),
        reason: input.reason,
        permissionUsed: 'platform.jobs',
      });
      res.json(result);
    }),
  );

  router.post(
    ['/v1/dead-letters/:id/replay', '/platform/v1/dead-letters/:id/replay'],
    handle(async (ctx, req, res) => {
      requirePlatform(ctx, 'platform.jobs');
      const result = await service.replayDeadLetter(getParam(req, 'id'));
      await audit(ctx, {
        action: 'platform.dead_letter_replayed',
        entityType: 'DEAD_LETTER',
        entityId: getParam(req, 'id'),
        permissionUsed: 'platform.jobs',
      });
      res.json(result);
    }),
  );

  router.post(
    ['/v1/dead-letters/:id/discard', '/platform/v1/dead-letters/:id/discard'],
    handle(async (ctx, req, res) => {
      requirePlatform(ctx, 'platform.jobs');
      const result = await service.discardDeadLetter(getParam(req, 'id'));
      await audit(ctx, {
        action: 'platform.dead_letter_discarded',
        entityType: 'DEAD_LETTER',
        entityId: getParam(req, 'id'),
        permissionUsed: 'platform.jobs',
      });
      res.json(result);
    }),
  );

  // ==========================================
  // SUB-ADM.05: System Health (platform operators)
  // ==========================================
  router.get(
    ['/v1/health', '/platform/v1/health'],
    handle(async (ctx, _req, res) => {
      requirePlatform(ctx, 'platform.console');
      res.json(await service.getSystemHealth());
    }),
  );

  // ==========================================
  // SUB-ADM.06: Support Access (API-ADM-006 / API-ADM-007)
  // The operator asks (platform realm). The target tenant's administrator decides (tenant realm). A tenant administrator
  // listing here sees only their own tenant's requests, so they can find the ones waiting for them.
  // ==========================================
  // The app mounts this router under /platform and under /v1, so the bare path is what a tenant reaches as /v1/support-access-requests.
  router.get(
    ['/v1/support-access-requests', '/platform/v1/support-access-requests', '/support-access-requests'],
    handle(async (ctx, req, res) => {
      const tenantId = req.query.tenantId as string | undefined;
      if (isPlatformRealm(ctx.principal)) {
        requirePlatform(ctx, 'platform.support_access');
        res.json(await service.listSupportAccessRequests(ctx, tenantId));
        return;
      }
      requireTenant(ctx, 'config.manage');
      if (tenantId !== undefined && tenantId !== ctx.principal.tenantId) {
        throw AppError.of('FORBIDDEN', 'You can only list your own tenant\'s requests.');
      }
      res.json(await service.listSupportAccessRequests(ctx));
    }),
  );

  router.post(
    ['/v1/support-access-requests', '/platform/v1/support-access-requests'],
    handle(async (ctx, req, res) => {
      requirePlatform(ctx, 'platform.support_access');
      const input = CreateSupportAccessRequestSchema.parse(req.body);
      res.status(201).json(await service.createSupportAccessRequest(ctx, input));
    }),
  );

  router.post(
    ['/v1/support-access-requests/:id/approval', '/support-access-requests/:id/approval'],
    handle(async (ctx, req, res) => {
      requireTenant(ctx, 'config.manage');
      const input = ApproveSupportAccessRequestSchema.parse(req.body);
      res.json(await service.approveSupportAccessRequest(ctx, getParam(req, 'id'), input));
    }),
  );

  // ==========================================
  // SUB-ADM.07: Data Correction (API-ADM-008 / API-ADM-009) — tenant realm
  // ==========================================
  router.get(
    ['/v1/data-corrections', '/data-corrections'],
    handle(async (ctx, _req, res) => {
      requireTenant(ctx, 'data_correction.request');
      res.json(await service.listDataCorrections(ctx));
    }),
  );

  router.post(
    ['/v1/data-corrections', '/data-corrections'],
    handle(async (ctx, req, res) => {
      requireTenant(ctx, 'data_correction.request');
      const input = CreateDataCorrectionRequestSchema.parse(req.body);
      const result = await service.createDataCorrectionRequest(ctx, input);
      await audit(ctx, {
        action: 'data_correction.requested',
        entityType: 'DATA_CORRECTION',
        entityId: result.id,
        after: { scriptRef: result.scriptRef },
        reason: result.justification,
        permissionUsed: 'data_correction.request',
      });
      res.status(201).json(result);
    }),
  );

  router.post(
    ['/v1/data-corrections/:id/approval', '/data-corrections/:id/approval'],
    handle(async (ctx, req, res) => {
      requireTenant(ctx, 'data_correction.approve');
      const input = ApproveDataCorrectionRequestSchema.parse(req.body);
      const result = await service.approveDataCorrectionRequest(ctx, getParam(req, 'id'), input);
      await audit(ctx, {
        action: input.decision === 'APPROVED' ? 'data_correction.approved' : 'data_correction.rejected',
        entityType: 'DATA_CORRECTION',
        entityId: result.id,
        permissionUsed: 'data_correction.approve',
      });
      res.json(result);
    }),
  );

  router.post(
    ['/v1/data-corrections/:id/execute', '/data-corrections/:id/execute'],
    handle(async (ctx, req, res) => {
      requireTenant(ctx, 'data_correction.approve');
      const result = await service.executeDataCorrection(ctx, getParam(req, 'id'));
      await audit(ctx, {
        action: 'data_correction.executed',
        entityType: 'DATA_CORRECTION',
        entityId: result.id,
        permissionUsed: 'data_correction.approve',
      });
      res.json(result);
    }),
  );

  // ==========================================
  // SUB-ADM.08: Release Management (Release Register)
  // ==========================================
  router.get(
    ['/v1/releases', '/platform/v1/releases'],
    handle(async (ctx, _req, res) => {
      requirePlatform(ctx, 'platform.release');
      res.json(await service.getReleases());
    }),
  );

  return router;
}
