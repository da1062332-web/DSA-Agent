// apps/api/src/modules/crm/leads/authz-helper.ts — owner: Dev 5 (MOD-ACL scope resolution)
import { AppError, type PermissionCode, type RequestContext } from '@dsa/contracts';
import type { LeadRow } from './repository';

/** Checks if the principal has a specific permission code. Throws 403 FORBIDDEN if not. */
export function requirePermission(ctx: RequestContext, code: PermissionCode): void {
  const hasGrant = ctx.principal.grants.some((g) => g.code === code);
  if (!hasGrant) {
    throw AppError.of('FORBIDDEN', `Permission '${code}' required.`);
  }
}

/** Checks whether a lead is within the authorized record scope of the principal. */
export function isLeadInScope(ctx: RequestContext, code: PermissionCode, lead: LeadRow): boolean {
  if (lead.tenant_id !== ctx.principal.tenantId) {
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
        grant.branchIds.includes(lead.branch_id) ||
        (ctx.principal.primaryBranchId && ctx.principal.primaryBranchId === lead.branch_id)
      ) {
        return true;
      }
    }

    if (grant.scope === 'TEAM') {
      if (
        (lead.owner_user_id && ctx.principal.managedTeamMemberIds.includes(lead.owner_user_id)) ||
        lead.owner_user_id === ctx.principal.id
      ) {
        return true;
      }
    }

    if (grant.scope === 'OWN') {
      if (lead.owner_user_id === ctx.principal.id) {
        return true;
      }
    }
  }

  // Also check queue membership if assigned to a queue
  if (lead.owner_queue_id && ctx.principal.queueIds.includes(lead.owner_queue_id)) {
    return true;
  }

  return false;
}

/**
 * Validates permission and record scope on a specific lead.
 * Contracts §1: Unknown, other-tenant or out-of-scope IDs return 404.
 * In scope but without the permission returns 403.
 */
export function requireLeadAccess(
  ctx: RequestContext,
  code: PermissionCode,
  lead: LeadRow | null,
): asserts lead is LeadRow {
  let effectiveCode = code;
  if (code === 'lead.reopen' && !ctx.principal.grants.some((g) => g.code === 'lead.reopen')) {
    effectiveCode = 'lead.update';
  }
  requirePermission(ctx, effectiveCode);

  if (!lead || !isLeadInScope(ctx, effectiveCode, lead)) {
    throw AppError.of('NOT_FOUND', 'Lead not found or outside authorized scope');
  }
}

export interface ScopeFilter {
  isTenantWide: boolean;
  branchIds: string[];
  teamUserIds: string[];
  ownUserId: string | null;
  queueIds: string[];
}

/** Computes the combined scope filters for list queries. */
export function getScopeFilter(ctx: RequestContext, code: PermissionCode): ScopeFilter {
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
