// apps/api/src/modules/crm/customers/authz-helper.ts — owner: Dev 5 (MOD-ACL scope resolution for customers)
import { AppError, type PermissionCode, type RequestContext } from '@dsa/contracts';
import type { CustomerRow } from './types';

/** Checks if the principal has a specific permission code. Throws 403 FORBIDDEN if not. */
export function requirePermission(ctx: RequestContext, code: PermissionCode): void {
  const hasGrant = ctx.principal.grants.some((g) => g.code === code);
  if (!hasGrant) {
    throw AppError.of('FORBIDDEN', `Permission '${code}' required.`);
  }
}

/** Checks whether a customer is within the authorized record scope of the principal. */
export function isCustomerInScope(
  ctx: RequestContext,
  code: PermissionCode,
  customer: CustomerRow,
): boolean {
  if (customer.tenant_id !== ctx.principal.tenantId) {
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
        grant.branchIds.includes(customer.home_branch_id) ||
        (ctx.principal.primaryBranchId && ctx.principal.primaryBranchId === customer.home_branch_id)
      ) {
        return true;
      }
    }

    if (grant.scope === 'TEAM') {
      if (
        customer.created_by === ctx.principal.id ||
        ctx.principal.managedTeamMemberIds.includes(customer.created_by)
      ) {
        return true;
      }
    }

    if (grant.scope === 'OWN') {
      if (customer.created_by === ctx.principal.id) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validates permission and record scope on a specific customer.
 * Out-of-scope or cross-tenant records return 404 NOT_FOUND.
 * In-scope but without permission returns 403 FORBIDDEN.
 */
export function requireCustomerAccess(
  ctx: RequestContext,
  code: PermissionCode,
  customer: CustomerRow | null,
): asserts customer is CustomerRow {
  requirePermission(ctx, code);

  if (!customer || !isCustomerInScope(ctx, code, customer)) {
    throw AppError.of('NOT_FOUND', 'Customer not found or outside authorized scope');
  }
}

export interface CustomerScopeFilter {
  isTenantWide: boolean;
  branchIds: string[];
  teamUserIds: string[];
  ownUserId: string | null;
}

/** Computes combined scope filters for customer list queries. */
export function getCustomerScopeFilter(
  ctx: RequestContext,
  code: PermissionCode,
): CustomerScopeFilter {
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
      grant.branchIds.forEach((b) => branchIds.add(b));
      if (ctx.principal.primaryBranchId) {
        branchIds.add(ctx.principal.primaryBranchId);
      }
    }
    if (grant.scope === 'TEAM') {
      teamUserIds.add(ctx.principal.id);
      ctx.principal.managedTeamMemberIds.forEach((u) => teamUserIds.add(u));
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
  };
}
