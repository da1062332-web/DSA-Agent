// apps/api/src/modules/crm/tasks/authz-helper.ts — owner: Dev 6 (MOD-ACL scope resolution for tasks)
import { AppError, type PermissionCode, type RequestContext } from '@dsa/contracts';
import type { TaskRow } from './types';

/** Checks if the principal has a specific permission code. Throws 403 FORBIDDEN if not. */
export function requirePermission(ctx: RequestContext, code: PermissionCode): void {
  const hasGrant = ctx.principal.grants.some((g) => g.code === code);
  if (!hasGrant) {
    throw AppError.of('FORBIDDEN', `Permission '${code}' required.`);
  }
}

/** Checks whether a task is within the authorized record scope of the principal. */
export function isTaskInScope(ctx: RequestContext, code: PermissionCode, task: TaskRow): boolean {
  if (task.tenant_id !== ctx.principal.tenantId) {
    return false;
  }

  const matchingGrants = ctx.principal.grants.filter((g) => g.code === code);
  if (matchingGrants.length === 0) {
    return false;
  }

  for (const grant of matchingGrants) {
    if (grant.scope === 'TENANT') {
      return true;
    }

    if (grant.scope === 'BRANCH') {
      if (
        grant.branchIds.includes(task.branch_id) ||
        (ctx.principal.primaryBranchId && ctx.principal.primaryBranchId === task.branch_id)
      ) {
        return true;
      }
    }

    if (grant.scope === 'TEAM') {
      if (
        (task.owner_user_id && ctx.principal.managedTeamMemberIds.includes(task.owner_user_id)) ||
        task.owner_user_id === ctx.principal.id
      ) {
        return true;
      }
    }

    if (grant.scope === 'OWN') {
      if (task.owner_user_id === ctx.principal.id) {
        return true;
      }
    }
  }

  // Also check queue membership if assigned to a queue
  if (task.owner_queue_id && ctx.principal.queueIds.includes(task.owner_queue_id)) {
    return true;
  }

  return false;
}

/**
 * Validates permission and record scope on a specific task.
 * Returns 404 NOT_FOUND for cross-tenant, unknown, or out-of-scope tasks.
 */
export function requireTaskAccess(
  ctx: RequestContext,
  code: PermissionCode,
  task: TaskRow | null,
): asserts task is TaskRow {
  requirePermission(ctx, code);

  if (!task || !isTaskInScope(ctx, code, task)) {
    throw AppError.of('NOT_FOUND', 'Task not found or outside authorized scope');
  }
}

export interface TaskScopeFilter {
  isTenantWide: boolean;
  branchIds: string[];
  teamUserIds: string[];
  ownUserId: string | null;
  queueIds: string[];
}

/** Computes the combined scope filters for task list queries. */
export function getTaskScopeFilter(ctx: RequestContext, code: PermissionCode): TaskScopeFilter {
  const matchingGrants = ctx.principal.grants.filter((g) => g.code === code);
  if (matchingGrants.length === 0) {
    throw AppError.of('FORBIDDEN', `Permission '${code}' required.`);
  }

  let isTenantWide = false;
  const branchIds = new Set<string>();
  const teamUserIds = new Set<string>();
  let ownUserId: string | null = null;

  for (const grant of matchingGrants) {
    if (grant.scope === 'TENANT') {
      isTenantWide = true;
      break;
    }
    if (grant.scope === 'BRANCH') {
      for (const b of grant.branchIds) branchIds.add(b);
      if (ctx.principal.primaryBranchId) branchIds.add(ctx.principal.primaryBranchId);
    }
    if (grant.scope === 'TEAM') {
      for (const u of ctx.principal.managedTeamMemberIds) teamUserIds.add(u);
      teamUserIds.add(ctx.principal.id);
    }
    if (grant.scope === 'OWN') {
      ownUserId = ctx.principal.id;
    }
  }

  return {
    isTenantWide,
    branchIds: Array.from(branchIds),
    teamUserIds: Array.from(teamUserIds),
    ownUserId,
    queueIds: ctx.principal.queueIds,
  };
}
