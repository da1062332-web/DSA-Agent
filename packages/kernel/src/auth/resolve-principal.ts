// Principal resolution — owner: Dev 1 — TASK-102.
// Turns a verified token into the Principal (Contracts §4.1): the app_user row for the token subject, its
// effective role grants, the members of teams it manages and the queues it belongs to. Every query runs inside
// withTenantTx with the token's tenant, so RLS hides other tenants' users even if a subject were reused.
//
// Staff invitations (API-USR-001): an INVITED user becomes ACTIVE only when all of these hold: the token belongs to the sign-in
// account that the invitation linked to the record, the session was signed in with a password (a link alone signs the invitee in once
// to set a password and cannot activate the record), the tenant is active, and the invitation was sent by the provisioning worker and
// is PENDING and not yet expired.
// Acceptance is recorded in the same transaction through the onInvitationAccepted hook, so the audit trail cannot miss it.
import {
  AppError,
  PERMISSION_CODES,
  type PermissionCode,
  type PermissionGrant,
  type Principal,
  type RequestContext,
  type ScopeType,
  type Tx,
  type TxRunner,
} from '@dsa/contracts';
import { sql } from 'kysely';
import type { VerifiedToken } from './verify-token';

export interface PrincipalResolver {
  resolve(token: VerifiedToken, ctx: { correlationId: string; now: Date }): Promise<Principal>;
}

export interface InvitationAcceptance {
  userId: string;
  tenantId: string;
  invitationId: string;
  correlationId: string;
  now: Date;
}

export interface PrincipalResolverOptions {
  /** Runs inside the transaction that activates an invited user, after the invitation is marked ACCEPTED. Used for the audit trail. */
  onInvitationAccepted?: (tx: Tx, event: InvitationAcceptance) => Promise<void>;
  /**
   * Identity binding (D5). true (the default, as before): a token whose subject is bound to no user may match a user by its e-mail
   * address. false: a token matches by its subject only. A user bound to the token's subject always wins over an e-mail match.
   */
  emailFallback?: boolean;
  /** Called with the user id each time a token was matched by e-mail rather than by subject: an account still to bind. */
  onEmailFallback?: (userId: string) => void;
}

const KNOWN_PERMISSIONS = new Set<string>(PERMISSION_CODES);
const UNAUTHENTICATED_MESSAGE = 'Missing or invalid access token.';
const EXPIRED = 'EXPIRED' as const;

interface UserRow {
  id: string;
  primary_branch_id: string;
  status: string;
  idp_subject: string;
  user_type: string;
  tenant_status: string;
}

export function createPrincipalResolver(txRunner: TxRunner, options: PrincipalResolverOptions = {}): PrincipalResolver {
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

      const outcome = await txRunner.withTenantTx(bootstrap, async (tx) => {
        // A user bound to this subject wins over one that only shares the e-mail address, and exactly one row is read.
        const found =
          options.emailFallback === false
            ? await sql<UserRow>`
          select u.id, u.primary_branch_id, u.status, u.idp_subject, u.user_type, t.status as tenant_status
            from app_user u join tenant t on t.id = u.tenant_id
           where u.idp_subject = ${token.subject}`.execute(tx)
            : await sql<UserRow>`
          select u.id, u.primary_branch_id, u.status, u.idp_subject, u.user_type, t.status as tenant_status
            from app_user u join tenant t on t.id = u.tenant_id
           where (u.idp_subject = ${token.subject} or u.id = ${token.subject} or (u.email is not null and lower(u.email::text) = ${token.email?.toLowerCase() ?? ''}))
           order by (u.idp_subject = ${token.subject}) desc
           limit 1`.execute(tx);
        let row: UserRow | undefined = found.rows[0];
        if (row && row.idp_subject !== token.subject && row.id !== token.subject) options.onEmailFallback?.(row.id);
        if (row && row.status === 'INVITED') {
          const accepted = await acceptInvitation(tx, row, token, { correlationId, now }, options);
          // An expired invitation is recorded as EXPIRED and committed; the refusal is raised after the transaction.
          if (accepted === EXPIRED) return EXPIRED;
          row = accepted;
        }

        // Unknown subject, inactive user or suspended tenant: the token is not usable here.
        if (!row || row.status !== 'ACTIVE' || row.tenant_status !== 'ACTIVE') {
          throw AppError.of('UNAUTHENTICATED', UNAUTHENTICATED_MESSAGE);
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
          userType: row.user_type as 'STAFF' | 'CONNECTOR',
        } satisfies Principal;
      });

      if (outcome === EXPIRED) throw AppError.of('UNAUTHENTICATED', 'This invitation has expired. Ask for a new one.');
      return outcome;
    },
  };
}

/**
 * Activates an INVITED user on the first valid password sign-in of the linked account. Returns the activated row, or EXPIRED when the
 * invitation has run out (the expiry is recorded). Any other case is refused with the same message as an unknown token.
 */
async function acceptInvitation(
  tx: Tx,
  row: UserRow,
  token: VerifiedToken,
  ctx: { correlationId: string; now: Date },
  options: PrincipalResolverOptions,
): Promise<UserRow | typeof EXPIRED> {
  const signedInWithPassword = (token.authMethods ?? []).includes('password');
  if (row.idp_subject !== token.subject || !signedInWithPassword || row.tenant_status !== 'ACTIVE') {
    throw AppError.of('UNAUTHENTICATED', UNAUTHENTICATED_MESSAGE);
  }

  // Only an invitation the provisioning worker has sent counts: until then the account, the claim and the binding may be incomplete.
  const pending = await sql<{ id: string; expires_at: Date }>`
    select id, expires_at from staff_invitation
     where user_id = ${row.id} and status = 'PENDING' and delivery_state = 'SENT'
     limit 1`.execute(tx);
  const invitation = pending.rows[0];
  if (!invitation) throw AppError.of('UNAUTHENTICATED', UNAUTHENTICATED_MESSAGE);

  if (invitation.expires_at.getTime() <= ctx.now.getTime()) {
    await sql`update staff_invitation set status = 'EXPIRED' where id = ${invitation.id}`.execute(tx);
    return EXPIRED;
  }

  const activated = await sql<UserRow>`
    update app_user u set status = 'ACTIVE', availability = 'AVAILABLE', updated_by = 'SYSTEM:auth'
      from tenant t
     where u.id = ${row.id} and t.id = u.tenant_id and u.status = 'INVITED'
    returning u.id, u.primary_branch_id, u.status, u.idp_subject, t.status as tenant_status`.execute(tx);
  const user = activated.rows[0];
  if (!user) throw AppError.of('UNAUTHENTICATED', UNAUTHENTICATED_MESSAGE);

  await sql`
    update staff_invitation set status = 'ACCEPTED', accepted_at = ${ctx.now}::timestamptz, last_failure = null
     where id = ${invitation.id}`.execute(tx);
  await options.onInvitationAccepted?.(tx, {
    userId: user.id,
    tenantId: token.tenantId,
    invitationId: invitation.id,
    correlationId: ctx.correlationId,
    now: ctx.now,
  });
  return user;
}
