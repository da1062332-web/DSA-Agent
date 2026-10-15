// apps/api/src/modules/crm/targets/service.ts — owner: Dev 5 (MOD-PERF Targets)
import {
  AppError,
  type PermissionCode,
  type RequestContext,
  type Tx,
} from '@dsa/contracts';
import type {
  ApproveTargetRequest,
  CreateTargetRequest,
  TargetDto,
  TargetListQuery,
  TargetListResponse,
} from '@dsa/contracts';
import type { ApiDeps } from '../../types';
import type { TargetRepository } from './repository';
import { toTargetDto, type TargetRow, type TargetSlice } from './types';

interface ScopeContext {
  isTenantWide: boolean;
  allowedBranchIds: string[];
  allowedOwnUserId: string | null;
}

export class TargetService {
  constructor(
    private readonly repo: TargetRepository,
    private readonly deps: ApiDeps,
  ) {}

  private checkPermission(ctx: RequestContext, code: PermissionCode): void {
    const hasGrant = ctx.principal.grants.some((g) => g.code === code);
    if (!hasGrant) {
      throw AppError.of('FORBIDDEN', `Missing required permission: ${code}`);
    }
  }

  private resolveScope(ctx: RequestContext, code: PermissionCode): ScopeContext {
    this.checkPermission(ctx, code);

    const matchingGrants = ctx.principal.grants.filter((g) => g.code === code);
    let isTenantWide = false;
    const branchIds = new Set<string>();
    let allowedOwnUserId: string | null = null;

    for (const grant of matchingGrants) {
      if (grant.scope === 'TENANT') {
        isTenantWide = true;
        break;
      }
      if (grant.scope === 'BRANCH') {
        for (const b of grant.branchIds) branchIds.add(b);
        if (ctx.principal.primaryBranchId) branchIds.add(ctx.principal.primaryBranchId);
      }
      if (grant.scope === 'OWN') {
        allowedOwnUserId = ctx.principal.id;
      }
    }

    return {
      isTenantWide,
      allowedBranchIds: Array.from(branchIds),
      allowedOwnUserId,
    };
  }

  private async authorizeDimensionScope(
    tx: Tx,
    ctx: RequestContext,
    scope: ScopeContext,
    dimensionType: 'BRANCH' | 'USER' | 'PRODUCT',
    dimensionId: string,
  ): Promise<void> {
    const tenantId = ctx.principal.tenantId;

    if (dimensionType === 'BRANCH') {
      const exists = await this.repo.checkBranchExists(tx, tenantId, dimensionId);
      if (!exists) {
        throw AppError.of('NOT_FOUND', `Branch '${dimensionId}' not found.`);
      }
      if (!scope.isTenantWide && !scope.allowedBranchIds.includes(dimensionId)) {
        throw AppError.of('FORBIDDEN', `Branch '${dimensionId}' is outside authorized scope.`);
      }
    } else if (dimensionType === 'USER') {
      const primaryBranch = await this.repo.getUserPrimaryBranch(tx, tenantId, dimensionId);
      if (primaryBranch === null) {
        throw AppError.of('NOT_FOUND', `User '${dimensionId}' not found.`);
      }
      if (!scope.isTenantWide) {
        const isOwn = scope.allowedOwnUserId === dimensionId;
        const inBranch = primaryBranch && scope.allowedBranchIds.includes(primaryBranch);
        if (!isOwn && !inBranch) {
          throw AppError.of('FORBIDDEN', `User '${dimensionId}' is outside authorized scope.`);
        }
      }
    } else if (dimensionType === 'PRODUCT') {
      const exists = await this.repo.checkProductExists(tx, tenantId, dimensionId);
      if (!exists) {
        throw AppError.of('NOT_FOUND', `Loan product '${dimensionId}' not found.`);
      }
      if (!scope.isTenantWide) {
        throw AppError.of(
          'FORBIDDEN',
          'Setting product targets requires TENANT-scoped target.manage permission.',
        );
      }
    }
  }

  async createTarget(
    tx: Tx,
    ctx: RequestContext,
    input: CreateTargetRequest,
  ): Promise<{ status: number; target: TargetDto; resourceRef: string }> {
    const scope = this.resolveScope(ctx, 'target.manage');
    const tenantId = ctx.principal.tenantId;

    await this.authorizeDimensionScope(tx, ctx, scope, input.dimensionType, input.dimensionId);

    const slice: TargetSlice = {
      period: input.period,
      dimensionType: input.dimensionType,
      dimensionId: input.dimensionId,
      metricCode: input.metricCode,
    };

    // Check if there is already a target pending approval for this slice
    const existingPending = await this.repo.findPendingSlice(tx, tenantId, slice);
    if (existingPending) {
      throw AppError.of(
        'INVALID_STATE',
        'A target revision is already pending approval for this slice (period + dimension + metric).',
      );
    }

    const maxVersion = await this.repo.getMaxVersion(tx, tenantId, slice);
    const newVersion = maxVersion + 1;
    const targetId = this.deps.ids.next('trg');

    const row: TargetRow = {
      id: targetId,
      tenant_id: tenantId,
      period: input.period,
      dimension_type: input.dimensionType,
      dimension_id: input.dimensionId,
      metric_code: input.metricCode,
      target_value: input.targetValue,
      unit: input.unit,
      version: newVersion,
      status: 'PENDING_APPROVAL',
      lock_version: 0,
      created_by: ctx.principal.id,
      created_at: new Date(),
      updated_by: ctx.principal.id,
      updated_at: new Date(),
      approved_by: null,
      approved_at: null,
      rejection_reason: null,
    };

    await this.repo.insertTarget(tx, row);

    await this.deps.audit.record(tx, ctx, {
      action: 'target.created',
      entityType: 'TARGET',
      entityId: targetId,
      after: {
        period: input.period,
        dimensionType: input.dimensionType,
        dimensionId: input.dimensionId,
        metricCode: input.metricCode,
        targetValue: input.targetValue,
        unit: input.unit,
        version: newVersion,
        status: 'PENDING_APPROVAL',
      },
      permissionUsed: 'target.manage',
    });

    return {
      status: 201,
      target: toTargetDto(row),
      resourceRef: targetId,
    };
  }

  async approveTarget(
    tx: Tx,
    ctx: RequestContext,
    targetId: string,
    ifMatchVersion: number,
    input: ApproveTargetRequest,
  ): Promise<{ target: TargetDto }> {
    const scope = this.resolveScope(ctx, 'target.manage');
    const tenantId = ctx.principal.tenantId;

    const target = await this.repo.findTargetById(tx, tenantId, targetId);
    if (!target) {
      throw AppError.of('NOT_FOUND', `Target '${targetId}' not found.`);
    }

    if (target.status !== 'PENDING_APPROVAL') {
      throw AppError.of(
        'INVALID_STATE',
        `Target '${targetId}' is in status '${target.status}' and cannot be approved or rejected.`,
      );
    }

    // SOD-04 Dual-Control: Creator cannot approve or reject their own target
    if (target.created_by === ctx.principal.id) {
      throw AppError.of(
        'SOD_VIOLATION',
        'Target creator cannot approve or reject their own target (SOD-04 dual-control violation).',
      );
    }

    // Authorize approver's scope over the target's dimension
    await this.authorizeDimensionScope(
      tx,
      ctx,
      scope,
      target.dimension_type,
      target.dimension_id,
    );

    const now = new Date();
    const slice: TargetSlice = {
      period: target.period,
      dimensionType: target.dimension_type,
      dimensionId: target.dimension_id,
      metricCode: target.metric_code,
    };

    if (input.decision === 'APPROVE') {
      // Mark any prior approved target for this slice as SUPERSEDED
      await this.repo.supersedeSlice(tx, tenantId, slice, target.id);

      const updated = await this.repo.updateTarget(tx, tenantId, targetId, ifMatchVersion, {
        status: 'APPROVED',
        approved_by: ctx.principal.id,
        approved_at: now,
        updated_by: ctx.principal.id,
      });

      await this.deps.audit.record(tx, ctx, {
        action: 'target.approved',
        entityType: 'TARGET',
        entityId: targetId,
        before: { status: target.status, version: target.version },
        after: {
          status: 'APPROVED',
          approvedBy: ctx.principal.id,
          approvedAt: now.toISOString(),
          version: target.version,
        },
        permissionUsed: 'target.manage',
      });

      return { target: toTargetDto(updated) };
    } else {
      const updated = await this.repo.updateTarget(tx, tenantId, targetId, ifMatchVersion, {
        status: 'REJECTED',
        approved_by: ctx.principal.id,
        approved_at: now,
        rejection_reason: input.rejectionReason ?? null,
        updated_by: ctx.principal.id,
      });

      await this.deps.audit.record(tx, ctx, {
        action: 'target.rejected',
        entityType: 'TARGET',
        entityId: targetId,
        before: { status: target.status, version: target.version },
        after: {
          status: 'REJECTED',
          rejectedBy: ctx.principal.id,
          rejectionReason: input.rejectionReason,
        },
        permissionUsed: 'target.manage',
      });

      return { target: toTargetDto(updated) };
    }
  }

  async getTarget(tx: Tx, ctx: RequestContext, targetId: string): Promise<TargetDto> {
    const scope = this.resolveScope(ctx, 'report.read');
    const tenantId = ctx.principal.tenantId;

    const target = await this.repo.findTargetById(tx, tenantId, targetId);
    if (!target) {
      throw AppError.of('NOT_FOUND', `Target '${targetId}' not found.`);
    }

    if (!scope.isTenantWide) {
      if (
        target.dimension_type === 'BRANCH' &&
        !scope.allowedBranchIds.includes(target.dimension_id)
      ) {
        throw AppError.of('NOT_FOUND', `Target '${targetId}' not found.`);
      }
      if (target.dimension_type === 'USER') {
        const isOwn = scope.allowedOwnUserId === target.dimension_id;
        const primaryBranch = await this.repo.getUserPrimaryBranch(
          tx,
          tenantId,
          target.dimension_id,
        );
        const inBranch = primaryBranch && scope.allowedBranchIds.includes(primaryBranch);
        if (!isOwn && !inBranch) {
          throw AppError.of('NOT_FOUND', `Target '${targetId}' not found.`);
        }
      }
    }

    return toTargetDto(target);
  }

  async listTargets(
    tx: Tx,
    ctx: RequestContext,
    query: TargetListQuery,
  ): Promise<TargetListResponse> {
    const scope = this.resolveScope(ctx, 'report.read');
    const tenantId = ctx.principal.tenantId;

    const result = await this.repo.listTargets(tx, {
      tenantId,
      period: query.period,
      dimensionType: query.dimensionType,
      dimensionId: query.dimensionId,
      metricCode: query.metricCode,
      status: query.status,
      limit: query.limit,
      cursor: query.cursor,
      isTenantWide: scope.isTenantWide,
      allowedBranchIds: scope.allowedBranchIds,
      allowedOwnUserId: scope.allowedOwnUserId,
    });

    return {
      items: result.targets.map(toTargetDto),
      nextCursor: result.nextCursor,
    };
  }

  async getTargetHistory(
    tx: Tx,
    ctx: RequestContext,
    targetId: string,
  ): Promise<TargetListResponse> {
    const scope = this.resolveScope(ctx, 'report.read');
    const tenantId = ctx.principal.tenantId;

    const target = await this.repo.findTargetById(tx, tenantId, targetId);
    if (!target) {
      throw AppError.of('NOT_FOUND', `Target '${targetId}' not found.`);
    }

    // Verify record scope
    if (!scope.isTenantWide) {
      if (
        target.dimension_type === 'BRANCH' &&
        !scope.allowedBranchIds.includes(target.dimension_id)
      ) {
        throw AppError.of('NOT_FOUND', `Target '${targetId}' not found.`);
      }
      if (target.dimension_type === 'USER') {
        const isOwn = scope.allowedOwnUserId === target.dimension_id;
        const primaryBranch = await this.repo.getUserPrimaryBranch(
          tx,
          tenantId,
          target.dimension_id,
        );
        const inBranch = primaryBranch && scope.allowedBranchIds.includes(primaryBranch);
        if (!isOwn && !inBranch) {
          throw AppError.of('NOT_FOUND', `Target '${targetId}' not found.`);
        }
      }
    }

    const slice: TargetSlice = {
      period: target.period,
      dimensionType: target.dimension_type,
      dimensionId: target.dimension_id,
      metricCode: target.metric_code,
    };

    const history = await this.repo.getSliceHistory(tx, tenantId, slice);
    return {
      items: history.map(toTargetDto),
      nextCursor: null,
    };
  }
}
