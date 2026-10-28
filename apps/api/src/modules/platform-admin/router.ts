// apps/api/src/modules/platform-admin/router.ts
// Module: platform-admin — owner: Platform squad (MOD-ADM: SUB-ADM.01 to SUB-ADM.08)
//
// Two realms (DSA Notion MODULE 1 and MODULE 40):
//   - Platform routes (console, flags, master data, jobs, health, support-access requests, releases) need the permission AND a
//     signed-in user of the platform tenant. A tenant administrator holding the same permission code is refused.
//   - Tenant routes (approving support access, data corrections) need the permission AND a user of a customer tenant. A platform
//     operator cannot approve their own request.
// Service identities get no shortcut in either realm. Every platform action and every cross-tenant read is written to the audit trail.
import { registerTenantLifecycleRoutes } from './tenant-lifecycle';
import {
  AppError,
  ApproveDataCorrectionRequestSchema,
  ApproveSupportAccessRequestSchema,
  CreateDataCorrectionRequestSchema,
  CreateSupportAccessRequestSchema,
  ListPlatformTenantsQuerySchema,
  RevokeSupportAccessRequestSchema,
  MasterDataImportRequestSchema,
  PauseQueueRequestSchema,
  ResumeQueueRequestSchema,
  UpdateFeatureFlagRequestSchema,
  UpdateReleaseRequestSchema,
  UpdateTenantFeatureFlagRequestSchema,
  isPlatformRealm,
  type AuditEventInput,
  type PermissionCode,
  type RequestContext,
} from '@dsa/contracts';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { ApiDeps } from '../types';
import { PlatformAdminService } from './platform-admin-service';

export { PlatformAdminService };

/** Tenant-realm routes (support-access approvals, data corrections), mounted under /v1 with the other modules. */
export function createRouter(deps: ApiDeps, serviceOverride?: PlatformAdminService): Router {
  return buildRouter(deps, 'tenant', serviceOverride);
}

/** Platform-realm routes (console, flags, master data, jobs, health, releases, support requests), mounted at /platform. */
export function createPlatformRouter(deps: ApiDeps, serviceOverride?: PlatformAdminService): Router {
  return buildRouter(deps, 'platform', serviceOverride);
}

// Each route is registered on exactly one surface, once: platform routes as /v1/... under the /platform mount (so
// /platform/v1/...), tenant routes as bare paths under the /v1 mount. The listing of support-access requests answers both
// realms, so it is on both surfaces.
function buildRouter(
  deps: ApiDeps,
  surface: 'platform' | 'tenant',
  serviceOverride?: PlatformAdminService,
): Router {
  const router = Router();
  const service = serviceOverride ?? new PlatformAdminService(deps);
  const on = (where: 'platform' | 'tenant') => (where === surface ? router : Router());

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

  /** An audit event for an action that has no database write of its own (the in-memory parts of the console). */
  const audit = (ctx: RequestContext, event: AuditEventInput): Promise<void> =>
    deps.txRunner.withTenantTx(ctx, async (tx) => {
      await deps.audit.record(tx, ctx, event);
    });

  /** A refusal on a sensitive route is itself recorded. The 403 stands even if the audit write fails. */
  const refuse = async (
    ctx: RequestContext,
    required: string,
    realm: 'platform' | 'tenant',
    message: string,
  ): Promise<never> => {
    try {
      await audit(ctx, {
        action: 'platform.access_denied',
        entityType: 'ROUTE',
        entityId: null,
        after: { required, realm, principalKind: ctx.principal.kind },
        permissionUsed: required,
      });
    } catch {
      // never turn a refusal into an error
    }
    throw AppError.of('FORBIDDEN', message);
  };

  /** The permission, held by a user of the platform tenant. */
  const requirePlatform = async (ctx: RequestContext, code: PermissionCode): Promise<void> => {
    if (!ctx.principal.grants.some((g) => g.code === code)) {
      await refuse(ctx, code, 'platform', `Permission denied: ${code} required.`);
    }
    if (!isPlatformRealm(ctx.principal)) {
      await refuse(ctx, code, 'platform', 'This action is for platform operators only.');
    }
  };

  /** The permission, held by a user of a customer tenant (never a platform operator or a service identity). */
  const requireTenant = async (ctx: RequestContext, code: PermissionCode): Promise<void> => {
    requirePermission(ctx, code);
    if (ctx.principal.kind !== 'USER' || isPlatformRealm(ctx.principal)) {
      await refuse(ctx, code, 'tenant', 'This action belongs to a customer tenant.');
    }
  };

  /** Any one of the permissions, held by a user of a customer tenant. */
  const requireTenantAny = async (ctx: RequestContext, codes: PermissionCode[]): Promise<void> => {
    if (!codes.some((c) => ctx.principal.grants.some((g) => g.code === c))) {
      await refuse(ctx, codes[0] ?? 'permission', 'tenant', `Permission denied: one of [${codes.join(', ')}] required.`);
    }
    if (ctx.principal.kind !== 'USER' || isPlatformRealm(ctx.principal)) {
      await refuse(ctx, codes[0] ?? 'permission', 'tenant', 'This action belongs to a customer tenant.');
    }
  };

  /** Only the data-correction executor, a service identity, marks a correction executed (Module 40, SUB-ADM.07). */
  const requireExecutor = (ctx: RequestContext): void => {
    if (ctx.principal.kind !== 'SERVICE' || ctx.principal.id !== 'SYSTEM:data-correction-executor') {
      throw AppError.of('FORBIDDEN', 'Only the data correction executor can mark a correction as executed.');
    }
  };

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
  on('platform').get(
    '/v1/tenants',
    handle(async (ctx, req, res) => {
      await requirePlatform(ctx, 'platform.console');
      const query = ListPlatformTenantsQuerySchema.parse(req.query);
      res.json(await service.listTenants(ctx, query));
    }),
  );

  // One tenant's overview: the same metadata as the list, no business data. Reading it across tenants is audited.
  on('platform').get(
    '/v1/tenants/:tenantId',
    handle(async (ctx, req, res) => {
      await requirePlatform(ctx, 'platform.console');
      const tenant = await service.getTenant(ctx, getParam(req, 'tenantId'));
      await audit(ctx, {
        action: 'platform.tenant_viewed',
        entityType: 'TENANT',
        entityId: tenant.id,
        permissionUsed: 'platform.console',
      });
      res.json(tenant);
    }),
  );

  // Break-glass read-only view of one tenant (SUB-ADM.06). Open only inside an approved support window; the database
  // makes the check (migration 0088). Both the reads and the refused attempts go to the audit trail, with the grant id.
  on('platform').get(
    '/v1/tenants/:tenantId/support-view',
    handle(async (ctx, req, res) => {
      await requirePlatform(ctx, 'platform.console');
      const tenantId = getParam(req, 'tenantId');
      const view = await service.getSupportTenantView(ctx, tenantId).catch(async (err: unknown) => {
        await audit(ctx, {
          action: 'platform.support_view_denied',
          entityType: 'TENANT',
          entityId: tenantId,
          permissionUsed: 'platform.console',
        });
        throw err;
      });
      await audit(ctx, {
        action: 'platform.support_view_read',
        entityType: 'TENANT',
        entityId: view.tenant.id,
        after: { grantId: view.grantId, endsAt: view.endsAt },
        permissionUsed: 'platform.console',
      });
      res.json(view);
    }),
  );

  // Who has looked at this tenant's set-up through the support view, and when (including refused attempts).
  on('platform').get(
    '/v1/tenants/:tenantId/support-view-log',
    handle(async (ctx, req, res) => {
      await requirePlatform(ctx, 'platform.console');
      res.json({ data: await service.listSupportViewLog(ctx, getParam(req, 'tenantId')) });
    }),
  );

  // ==========================================
  // SUB-ADM.02: Feature Flags (API-ADM-001 / API-ADM-002)
  // ==========================================
  on('platform').get(
    '/v1/flags',
    handle(async (ctx, _req, res) => {
      await requirePlatform(ctx, 'platform.flags');
      res.json(await service.listFeatureFlags(ctx));
    }),
  );

  on('platform').get(
    '/v1/flags/:key',
    handle(async (ctx, req, res) => {
      await requirePlatform(ctx, 'platform.flags');
      const scope = (req.query.scope as string) || 'GLOBAL';
      const flag = await service.getFeatureFlag(ctx, getParam(req, 'key'), scope);
      res.set('ETag', `"${flag.lockVersion}"`);
      res.json(flag);
    }),
  );

  on('platform').put(
    '/v1/flags/:key',
    handle(async (ctx, req, res) => {
      await requirePlatform(ctx, 'platform.flags');
      const input = UpdateFeatureFlagRequestSchema.parse(req.body);
      const updated = await service.putFeatureFlag(ctx, getParam(req, 'key'), input, req.get('if-match'));
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

  // Per-tenant overrides of TENANT-scope flags. The tenant is in the path and the body may carry nothing but the value (a body that names a
  // scope or a tenant is a 422), so a call made for one tenant cannot be turned into a change to a GLOBAL flag or to another tenant.
  on('platform').get(
    '/v1/tenants/:tenantId/flags',
    handle(async (ctx, req, res) => {
      await requirePlatform(ctx, 'platform.flags');
      res.json(await service.listTenantFeatureFlags(ctx, getParam(req, 'tenantId')));
    }),
  );

  on('platform').put(
    '/v1/tenants/:tenantId/flags/:key',
    handle(async (ctx, req, res) => {
      await requirePlatform(ctx, 'platform.flags');
      const input = UpdateTenantFeatureFlagRequestSchema.parse(req.body);
      const updated = await service.putTenantFeatureFlag(
        ctx,
        getParam(req, 'tenantId'),
        getParam(req, 'key'),
        input,
        req.get('if-match'),
      );
      res.set('ETag', `"${updated.lockVersion}"`);
      res.json(updated);
    }),
  );

  // ==========================================
  // SUB-ADM.03: Master Data (API-ADM-003)
  // ==========================================
  on('platform').get(
    '/v1/master-data',
    handle(async (ctx, req, res) => {
      await requirePlatform(ctx, 'platform.master_data');
      res.json(await service.getMasterData(ctx, req.query.listCode as string | undefined));
    }),
  );

  on('platform').post(
    '/v1/master-data/imports',
    handle(async (ctx, req, res) => {
      await requirePlatform(ctx, 'platform.master_data');
      const body = MasterDataImportRequestSchema.parse(req.body);
      const result = await service.importMasterData(ctx, body);
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
  on('platform').get(
    '/v1/jobs',
    handle(async (ctx, _req, res) => {
      await requirePlatform(ctx, 'platform.jobs');
      res.json(await service.getJobsAndQueues(ctx));
    }),
  );

  on('platform').post(
    '/v1/queues/:queue/pause',
    handle(async (ctx, req, res) => {
      await requirePlatform(ctx, 'platform.jobs');
      const input = PauseQueueRequestSchema.parse(req.body);
      const result = await service.pauseQueue(ctx, getParam(req, 'queue'), input);
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

  on('platform').post(
    '/v1/queues/:queue/resume',
    handle(async (ctx, req, res) => {
      await requirePlatform(ctx, 'platform.jobs');
      const input = ResumeQueueRequestSchema.parse(req.body);
      const result = await service.resumeQueue(ctx, getParam(req, 'queue'), input);
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

  on('platform').post(
    '/v1/dead-letters/:id/replay',
    handle(async (ctx, req, res) => {
      await requirePlatform(ctx, 'platform.jobs');
      const result = await service.replayDeadLetter(ctx, getParam(req, 'id'));
      await audit(ctx, {
        action: 'platform.dead_letter_replayed',
        entityType: 'DEAD_LETTER',
        entityId: getParam(req, 'id'),
        permissionUsed: 'platform.jobs',
      });
      res.json(result);
    }),
  );

  on('platform').post(
    '/v1/dead-letters/:id/discard',
    handle(async (ctx, req, res) => {
      await requirePlatform(ctx, 'platform.jobs');
      const result = await service.discardDeadLetter(ctx, getParam(req, 'id'));
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
  on('platform').get(
    '/v1/health',
    handle(async (ctx, _req, res) => {
      await requirePlatform(ctx, 'platform.console');
      res.json(await service.getSystemHealth());
    }),
  );

  // ==========================================
  // SUB-ADM.06: Support Access (API-ADM-006 / API-ADM-007)
  // The operator asks (platform realm). The target tenant's administrator decides (tenant realm). A tenant administrator
  // listing here sees only their own tenant's requests, so they can find the ones waiting for them.
  // ==========================================
  router.get(
    surface === 'platform' ? '/v1/support-access-requests' : '/support-access-requests',
    handle(async (ctx, req, res) => {
      const tenantId = req.query.tenantId as string | undefined;
      if (isPlatformRealm(ctx.principal)) {
        await requirePlatform(ctx, 'platform.support_access');
        res.json(await service.listSupportAccessRequests(ctx, tenantId));
        return;
      }
      await requireTenant(ctx, 'config.manage');
      if (tenantId !== undefined && tenantId !== ctx.principal.tenantId) {
        throw AppError.of('FORBIDDEN', "You can only list your own tenant's requests.");
      }
      res.json(await service.listSupportAccessRequests(ctx));
    }),
  );

  on('platform').post(
    '/v1/support-access-requests',
    handle(async (ctx, req, res) => {
      await requirePlatform(ctx, 'platform.support_access');
      const input = CreateSupportAccessRequestSchema.parse(req.body);
      res.status(201).json(await service.createSupportAccessRequest(ctx, input));
    }),
  );

  on('tenant').post(
    '/support-access-requests/:id/approval',
    handle(async (ctx, req, res) => {
      await requireTenant(ctx, 'config.manage');
      const input = ApproveSupportAccessRequestSchema.parse(req.body);
      res.json(await service.approveSupportAccessRequest(ctx, getParam(req, 'id'), input));
    }),
  );

  on('tenant').post(
    '/support-access-requests/:id/revocation',
    handle(async (ctx, req, res) => {
      await requireTenant(ctx, 'config.manage');
      RevokeSupportAccessRequestSchema.parse(req.body ?? {});
      res.json(await service.revokeSupportAccessRequest(ctx, getParam(req, 'id')));
    }),
  );

  // ==========================================
  // SUB-ADM.07: Data Correction (API-ADM-008 / API-ADM-009) — tenant realm
  // ==========================================
  on('tenant').get(
    '/data-corrections',
    handle(async (ctx, _req, res) => {
      await requireTenantAny(ctx, ['data_correction.request', 'data_correction.approve', 'config.manage']);
      res.json(await service.listDataCorrections(ctx));
    }),
  );

  on('tenant').post(
    '/data-corrections',
    handle(async (ctx, req, res) => {
      await requireTenant(ctx, 'data_correction.request');
      const input = CreateDataCorrectionRequestSchema.parse(req.body);
      res.status(201).json(await service.createDataCorrectionRequest(ctx, input));
    }),
  );

  on('tenant').post(
    '/data-corrections/:id/approval',
    handle(async (ctx, req, res) => {
      await requireTenant(ctx, 'data_correction.approve');
      const input = ApproveDataCorrectionRequestSchema.parse(req.body);
      res.json(await service.approveDataCorrectionRequest(ctx, getParam(req, 'id'), input));
    }),
  );

  // Executed by the correction executor (a service identity), never by a person. The executor carries the tenant in its token.
  on('tenant').post(
    '/data-corrections/:id/execute',
    handle(async (ctx, req, res) => {
      requireExecutor(ctx);
      res.json(await service.executeDataCorrection(ctx, getParam(req, 'id')));
    }),
  );

  // ==========================================
  // SUB-ADM.08: Release Management (Release Register)
  // ==========================================
  on('platform').get(
    '/v1/releases',
    handle(async (ctx, _req, res) => {
      await requirePlatform(ctx, 'platform.release');
      res.json(await service.getReleases(ctx));
    }),
  );

  on('platform').put(
    '/v1/releases/:version',
    handle(async (ctx, req, res) => {
      await requirePlatform(ctx, 'platform.release');
      // Recording that a release passed its gates, or was published, is a decision of record: it needs a recent authenticator check.
      deps.authz.requireStepUp(ctx);
      const patch = UpdateReleaseRequestSchema.parse(req.body);
      const updated = await service.updateRelease(ctx, getParam(req, 'version'), patch, req.get('if-match'));
      res.set('ETag', `"${updated.lockVersion}"`);
      res.json(updated);
    }),
  );

  // MOD-TEN lifecycle (API-TEN-001, 003..006).
  if (surface === 'platform') registerTenantLifecycleRoutes(router, deps, requirePlatform);

  return router;
}
