// Authorisation (Contracts §4.1, §8) — owner: Dev 1 — TASK-104.
// A grant is (permission code, scope). A record is visible when ANY grant of the principal covers it; it is
// actionable when a grant for the requested code covers it. Invisible → 404 (never reveal existence),
// visible but not permitted → 403. Step-up needs a TOTP verification within maxAgeSeconds (default 900 s).
import {
  AppError,
  type Authz,
  type PermissionCode,
  type PermissionGrant,
  type Principal,
  type RequestContext,
  type ScopedRecordRef,
} from '@dsa/contracts';
import { sql, type Expression, type SqlBool } from 'kysely';

export const STEP_UP_MAX_AGE_SECONDS = 900;

interface Filterable<QB> {
  where(expression: Expression<SqlBool>): QB;
}

export function createAuthz(): Authz {
  return {
    requirePermission(ctx, code) {
      if (!grantsFor(ctx.principal, code).length) {
        throw AppError.of('FORBIDDEN', 'You do not have permission for this action.', [
          { issue: 'PERMISSION_MISSING', meta: { permission: code } },
        ]);
      }
    },

    requireOnRecord(ctx, code, rec) {
      const p = ctx.principal;
      if (!rec || !p.grants.some((g) => covers(p, g, rec))) {
        throw AppError.of('NOT_FOUND', 'Resource not found.');
      }
      if (!grantsFor(p, code).some((g) => covers(p, g, rec))) {
        throw AppError.of('FORBIDDEN', 'You do not have permission for this action.', [
          { issue: 'PERMISSION_MISSING', meta: { permission: code } },
        ]);
      }
    },

    scopeFilter(ctx, code, qb, cols) {
      const p = ctx.principal;
      const grants = grantsFor(p, code);
      const target = qb as unknown as Filterable<typeof qb>;
      if (grants.some((g) => g.scope === 'TENANT')) return qb;
      if (!grants.length) return target.where(sql<SqlBool>`false`);

      const ownerIn = (ids: string[]) =>
        cols.owners.map((c) => sql<SqlBool>`${sql.ref(c)} = any(${ids}::text[])`);
      const inMyQueues =
        cols.queue && p.queueIds.length
          ? [sql<SqlBool>`${sql.ref(cols.queue)} = any(${p.queueIds}::text[])`]
          : [];

      const conditions = grants.flatMap((g) => {
        switch (g.scope) {
          case 'BRANCH':
            return [sql<SqlBool>`${sql.ref(cols.branch)} = any(${g.branchIds}::text[])`];
          case 'TEAM':
            return [...ownerIn([p.id, ...p.managedTeamMemberIds]), ...inMyQueues];
          case 'OWN':
            return [...ownerIn([p.id]), ...inMyQueues];
          default:
            return [];
        }
      });
      return target.where(sql<SqlBool>`(${sql.join(conditions, sql` or `)})`);
    },

    requireStepUp(ctx: RequestContext, maxAgeSeconds = STEP_UP_MAX_AGE_SECONDS) {
      const at = ctx.principal.authTime ? Date.parse(ctx.principal.authTime) : NaN;
      if (Number.isNaN(at) || ctx.now.getTime() - at > maxAgeSeconds * 1000) {
        throw AppError.of('STEP_UP_REQUIRED', 'Verify with your authenticator app to continue.');
      }
    },
  };
}

function grantsFor(p: Principal, code: PermissionCode): PermissionGrant[] {
  return p.grants.filter((g) => g.code === code);
}

function covers(p: Principal, g: PermissionGrant, rec: ScopedRecordRef): boolean {
  const inQueue = rec.queueIds.some((q) => p.queueIds.includes(q));
  switch (g.scope) {
    case 'TENANT':
      return true;
    case 'BRANCH':
      return g.branchIds.includes(rec.branchId);
    case 'TEAM':
      return rec.ownerUserIds.some((u) => u === p.id || p.managedTeamMemberIds.includes(u)) || inQueue;
    case 'OWN':
      return rec.ownerUserIds.includes(p.id) || inQueue;
  }
}

/** Convenience for handlers: does the principal hold this code at any scope? */
export function hasPermission(p: Principal, code: PermissionCode): boolean {
  return grantsFor(p, code).length > 0;
}

/**
 * Administration of branch-owned configuration (teams, queue members — MOD-ORG §SUB-ORG.03/.05).
 * Passes with any of `codes` at TENANT scope, or at BRANCH scope when `branchId` is one of the granted
 * branches. A branch-scoped manager cannot touch cross-branch (branchId null) or other branches' records.
 * Returns the permission used, for the audit record. 403 FORBIDDEN otherwise.
 */
export function requirePermissionForBranch(
  ctx: RequestContext,
  codes: PermissionCode[],
  branchId: string | null,
): PermissionCode {
  const grants = ctx.principal.grants.filter((g) => codes.includes(g.code));
  const ok =
    grants.find((g) => g.scope === 'TENANT') ??
    grants.find((g) => g.scope === 'BRANCH' && branchId !== null && g.branchIds.includes(branchId));
  if (ok) return ok.code;
  throw AppError.of('FORBIDDEN', 'You do not have permission for this action.', [
    {
      issue: grants.length ? 'OUT_OF_BRANCH_SCOPE' : 'PERMISSION_MISSING',
      meta: { permission: codes.join(' or ') },
    },
  ]);
}
