// Principal resolution — owner: Dev 1 — TASK-102.
// Turns a verified token into the Principal (Contracts §4.1): the app_user row for the token subject, its
// effective role grants, the members of teams it manages and the queues it belongs to. Every query runs inside
// withTenantTx with the token's tenant, so RLS hides other tenants' users even if a subject were reused.
import {
  AppError,
  PERMISSION_CODES,
  type PermissionCode,
  type PermissionGrant,
  type Principal,
  type RequestContext,
  type ScopeType,
  type TxRunner,
} from '@dsa/contracts';
import { sql } from 'kysely';
import type { VerifiedToken } from './verify-token';

export interface PrincipalResolver {
  resolve(token: VerifiedToken, ctx: { correlationId: string; now: Date }): Promise<Principal>;
}

const KNOWN_PERMISSIONS = new Set<string>(PERMISSION_CODES);

export function createPrincipalResolver(txRunner: TxRunner): PrincipalResolver {
  return {
    async resolve(token, { correlationId, now }) {
      const bootstrap: RequestContext = {
        principal: {
          kind: 'SERVICE',
          id: 'SYSTEM:auth',
          tenantId: token.tenantId,
          primaryBranchId: null,
          managedTeamMemberIds: [],
          queueIds: [],
          grants: [],
          authTime: null,
        },
        correlationId,
        now,
      };

      return txRunner.withTenantTx(bootstrap, async (tx) => {
        const user = await sql<{
          id: string;
          primary_branch_id: string;
          status: string;
          tenant_status: string;
        }>`
          select u.id, u.primary_branch_id, u.status, t.status as tenant_status
            from app_user u join tenant t on t.id = u.tenant_id
           where u.idp_subject = ${token.subject}`.execute(tx);
        let row = user.rows[0];
        // First sign-in of an invited user (API-USR-001): the invitation holds a placeholder subject. The token's tenant comes
        // from app_metadata, which only the server sets, so the invitation is bound only inside that tenant, by email.
        if (!row && token.email) {
          const bound = await sql<{
            id: string;
            primary_branch_id: string;
            status: string;
            tenant_status: string;
          }>`
            update app_user u set idp_subject = ${token.subject}, status = 'ACTIVE', availability = 'AVAILABLE',
                                  updated_by = 'SYSTEM:auth'
              from tenant t
             where t.id = u.tenant_id and u.status = 'INVITED' and u.idp_subject like 'invite:%'
               and lower(u.email::text) = ${token.email}
            returning u.id, u.primary_branch_id, u.status, t.status as tenant_status`.execute(tx);
          row = bound.rows[0];
        }
        // Unknown subject, inactive user or suspended tenant: the token is not usable here.
        if (!row || row.status !== 'ACTIVE' || row.tenant_status !== 'ACTIVE') {
          throw AppError.of('UNAUTHENTICATED', 'Missing or invalid access token.');
        }

        const grants = await sql<{
          permission_code: string;
          scope_type: ScopeType;
          scope_branch_ids: string[];
        }>`
          select rp.permission_code, a.scope_type, a.scope_branch_ids
            from user_role_assignment a join role_permission rp on rp.role_id = a.role_id
           where a.user_id = ${row.id} and a.effective_range @> ${now}::timestamptz`.execute(tx);

        const managed = await sql<{ user_id: string }>`
          select distinct m.user_id
            from team t join team_membership m on m.team_id = t.id
           where t.manager_user_id = ${row.id} and t.status = 'ACTIVE'
             and m.effective_range @> ${now}::timestamptz`.execute(tx);

        const queues = await sql<{ queue_id: string }>`
          select m.queue_id
            from work_queue_member m join work_queue q on q.id = m.queue_id
           where m.user_id = ${row.id} and q.active and m.effective_range @> ${now}::timestamptz`.execute(tx);

        return {
          kind: 'USER',
          id: row.id,
          tenantId: token.tenantId,
          primaryBranchId: row.primary_branch_id,
          managedTeamMemberIds: managed.rows.map((r) => r.user_id),
          queueIds: queues.rows.map((r) => r.queue_id),
          grants: grants.rows
            .filter((g) => KNOWN_PERMISSIONS.has(g.permission_code))
            .map((g): PermissionGrant => ({
              code: g.permission_code as PermissionCode,
              scope: g.scope_type,
              branchIds: g.scope_type === 'BRANCH' ? g.scope_branch_ids : [],
            })),
          authTime: token.mfaVerifiedAt?.toISOString().replace(/\.\d{3}Z$/, 'Z') ?? null,
        };
      });
    },
  };
}
