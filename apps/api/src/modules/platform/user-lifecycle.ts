// MOD-USR lifecycle (owner: Dev 1; DSA Notion MODULE 4, SUB-USR.01 and SUB-USR.02). APIs:
//   API-USR-001 POST /v1/users/invitations          user.manage; Idempotency-Key. The user starts INVITED.
//   API-USR-004 POST /v1/users/{id}/deactivation    user.manage; Idempotency-Key; If-Match. Atomic hand-over (M-073).
//   API-USR-005 POST /v1/users/{id}/suspension      user.manage; If-Match. Suspend or reactivate.
//   API-USR-006 PUT  /v1/users/{id}/role-assignments role.manage; If-Match; step-up; SOD-05.
//   API-USR-008 POST /v1/users/{id}/transfers       user.manage; Idempotency-Key. Now, or scheduled through the job queue.
// Nobody changes their own status or roles (SOD-05), and no change may leave the tenant without an active administrator.
// Every change bumps the user's lock_version, and writes audit and an outbox event in the same transaction.
import {
  AppError,
  DeactivateUserRequest,
  EraseUserRequest,
  InviteUserRequest,
  ReplaceRoleAssignmentsRequest,
  SuspendUserRequest,
  TransferUserRequest,
  type RequestContext,
  type Tx,
  type UserTransferResponse,
} from '@dsa/contracts';
import { withIdempotency, type PrincipalResolverOptions } from '@dsa/kernel';
import type { Router } from 'express';
import { sql } from 'kysely';
import { idempotencyKey, ifMatchVersion, requireCtx, sendResource } from '../../http/request';
import type { ApiDeps } from '../types';
import { requireActiveBranch, type Row } from './db';
import { globalJobQueue, type JobHandler } from './job-queue';
import { assertAdministratorRemains, countActiveAdministrators } from './role-guards';
import { ACTIVATION_REFUSED, DELETED_REFUSED } from './user-status';
import {
  MAX_RESENDS,
  RESEND_COOLDOWN_MS,
  invitationExpiry,
  ERASED_DISPLAY_NAME,
  erasedEmail,
  erasedSubject,
  invitationState,
  isErased,
  isUnboundSubject,
  resendRefusal,
  unboundSubject,
} from './invitations';

export const USER_TRANSFER_JOB = 'USER_TRANSFER';

const toUser = (r: Row) => ({
  id: String(r.id),
  tenantId: String(r.tenant_id),
  email: String(r.email),
  mobileE164: (r.mobile_e164 as string | null) ?? null,
  displayName: String(r.display_name),
  userType: String(r.user_type),
  status: String(r.status),
  availability: String(r.availability),
  primaryBranchId: String(r.primary_branch_id),
  assignedRoles: ((r.assigned_roles as string[] | null) ?? []).filter(Boolean),
  version: Number(r.lock_version),
  lockVersion: Number(r.lock_version),
  createdAt: new Date(String(r.created_at)).toISOString(),
  updatedAt: new Date(String(r.updated_at)).toISOString(),
  // A deleted account (POST /v1/users/:id/erasure): kept for history, never changed again.
  deleted: isErased(String(r.idp_subject), String(r.email)),
});

async function readUser(tx: Tx, id: string) {
  const r = await sql<Row>`
    select u.*, coalesce(array_agg(r.name) filter (where r.name is not null), '{}') as assigned_roles
      from app_user u
      left join user_role_assignment a on a.user_id = u.id and a.effective_range @> now()
      left join role r on r.id = a.role_id
     where u.id = ${id}
     group by u.id`.execute(tx);
  if (!r.rows[0]) throw AppError.of('NOT_FOUND', 'User not found.');
  return toUser(r.rows[0]);
}

/** Locks the user for the change; 404 when not in the caller's tenant, 409 when the version is stale. */
async function lockUser(tx: Tx, id: string, version: number | null): Promise<Row> {
  const r = await sql<Row>`select * from app_user where id = ${id} for update`.execute(tx);
  const row = r.rows[0];
  if (!row) throw AppError.of('NOT_FOUND', 'User not found.');
  if (version !== null && Number(row.lock_version) !== version) {
    throw AppError.of('VERSION_CONFLICT', 'The user was changed by someone else. Reload and try again.', [
      { field: 'If-Match', issue: 'STALE', meta: { currentVersion: row.lock_version } },
    ]);
  }
  return row;
}

function refuseSelf(ctx: RequestContext, userId: string, what: string): void {
  if (ctx.principal.id === userId) {
    throw AppError.of('SOD_VIOLATION', `Separation of duties (SOD-05): you cannot ${what} yourself.`);
  }
}

async function setStatus(tx: Tx, ctx: RequestContext, row: Row, status: string): Promise<void> {
  const before = await countActiveAdministrators(tx, ctx.principal.tenantId);
  await sql`update app_user set status = ${status}, updated_by = ${ctx.principal.id} where id = ${String(row.id)}`.execute(
    tx,
  );
  await assertAdministratorRemains(tx, ctx.principal.tenantId, before);
}

async function emit(
  deps: ApiDeps,
  tx: Tx,
  ctx: RequestContext,
  eventType: string,
  userId: string,
  payload: object,
) {
  await sql`
    insert into outbox_event (id, tenant_id, event_type, event_version, subject_type, subject_id, payload,
                              correlation_id, chain_depth, created_at)
    values (${deps.ids.next('evt')}, ${ctx.principal.tenantId}, ${eventType}, 1, 'USER', ${userId},
            ${JSON.stringify({ userId, ...payload })}::jsonb, ${ctx.correlationId}, 0, ${ctx.now})`.execute(
    tx,
  );
}

/** Moves the user's primary branch; also run by the scheduled transfer job. */
async function applyTransfer(tx: Tx, userId: string, toBranchId: string, actor: string): Promise<boolean> {
  const r = await sql`
    update app_user set primary_branch_id = ${toBranchId}, updated_by = ${actor}
     where id = ${userId} and status in ('INVITED', 'ACTIVE', 'SUSPENDED') and primary_branch_id <> ${toBranchId}`.execute(
    tx,
  );
  return Number(r.numAffectedRows ?? 0) > 0;
}

/** The job that applies a scheduled transfer (API-USR-008). A user deactivated meanwhile is left as is. */
export function createUserTransferHandler(deps: ApiDeps): JobHandler {
  // The worker runs each job inside withTenantTx for the job's tenant (worker.ts).
  return async (tx, tenantId, payload) => {
    const userId = String(payload.userId);
    const toBranchId = String(payload.toBranchId);
    const actor = 'SYSTEM:user-transfer';
    if (!(await applyTransfer(tx, userId, toBranchId, actor))) return;
    const ctx: RequestContext = {
      principal: {
        kind: 'SERVICE',
        id: actor,
        tenantId,
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [],
        authTime: null,
      },
      correlationId: String(payload.correlationId ?? deps.ids.next('evt')),
      now: new Date(),
    };
    await deps.audit.record(tx, ctx, {
      action: 'user.transferred',
      entityType: 'USER',
      entityId: userId,
      after: { primaryBranchId: toBranchId, scheduled: true },
      reason: String(payload.reason ?? ''),
      permissionUsed: 'user.manage',
    });
    await emit(deps, tx, ctx, 'user.transferred', userId, { toBranchId });
  };
}

/** A deleted account is kept only for history: every change to it is refused with the same message. */
function refuseDeleted(row: Row): void {
  if (isErased(String(row.idp_subject), String(row.email)))
    throw AppError.of('INVALID_STATE', DELETED_REFUSED);
}

/** For routes outside this file (router.ts): refuses when the user in the caller's tenant is a deleted account. */
export async function assertNotDeleted(tx: Tx, userId: string): Promise<void> {
  const row = (await sql<Row>`select idp_subject, email from app_user where id = ${userId}`.execute(tx))
    .rows[0];
  if (row) refuseDeleted(row);
}

/**
 * D4: an administrator cannot make an invited user ACTIVE. Activation happens only on the invitee's own password sign-in
 * (resolve-principal.ts). This holds while the user is INVITED, and also after an invited user was suspended or deactivated without
 * ever accepting: they have invitations and none was accepted. Users with no invitation at all (provisioned another way) are unaffected.
 */
export async function assertMayBecomeActive(tx: Tx, userId: string, currentStatus: string): Promise<void> {
  if (currentStatus === 'ACTIVE') return;
  if (currentStatus === 'INVITED') throw AppError.of('INVALID_STATE', ACTIVATION_REFUSED);
  const invitations = (
    await sql<{ total: number; accepted: number }>`
      select count(*)::int as total, (count(*) filter (where status = 'ACCEPTED'))::int as accepted
        from staff_invitation where user_id = ${userId}`.execute(tx)
  ).rows[0];
  if (invitations && invitations.total > 0 && invitations.accepted === 0) {
    throw AppError.of('INVALID_STATE', ACTIVATION_REFUSED);
  }
}

/**
 * Writes the audit records for an invitation that is accepted and the activation it causes (API-USR-001). The sign-in path calls it
 * inside the transaction that activates the user, so an activation cannot be committed without its records.
 */
export function createInvitationAcceptedAudit(
  deps: ApiDeps,
): NonNullable<PrincipalResolverOptions['onInvitationAccepted']> {
  return async (tx, event) => {
    const ctx: RequestContext = {
      principal: {
        kind: 'SERVICE',
        id: 'SYSTEM:auth',
        tenantId: event.tenantId,
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [],
        authTime: null,
      },
      correlationId: event.correlationId,
      now: event.now,
    };
    await deps.audit.record(tx, ctx, {
      action: 'user.invitation_accepted',
      entityType: 'USER',
      entityId: event.userId,
      after: { invitationId: event.invitationId, invitationStatus: 'ACCEPTED' },
    });
    await deps.audit.record(tx, ctx, {
      action: 'user.activated',
      entityType: 'USER',
      entityId: event.userId,
      before: { status: 'INVITED' },
      after: { status: 'ACTIVE', availability: 'AVAILABLE', invitationId: event.invitationId },
    });
  };
}

export function registerUserLifecycleRoutes(router: Router, deps: ApiDeps): void {
  // API-USR-001
  router.post('/users/invitations', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'user.manage');
    const key = idempotencyKey(req);
    const input = InviteUserRequest.parse(req.body);
    const email = input.email.trim().toLowerCase();
    // The API never talks to Supabase Auth (Architecture B). It records the user and a QUEUED invitation; the provisioning worker
    // creates or reuses the sign-in account, writes the tenant claim, binds the user and asks Supabase to send the e-mail.
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: '/v1/users/invitations', body: input },
        async () => {
          const dup = await sql`select 1 from app_user where email = ${email}`.execute(tx);
          if (dup.rows.length) {
            throw AppError.of(
              'VALIDATION_ERROR',
              'A user with this email address already exists in this tenant.',
              [{ field: 'email', issue: 'DUPLICATE_EMAIL' }],
            );
          }
          await requireActiveBranch(tx, input.primaryBranchId, 'primaryBranchId');
          const userId = deps.ids.next('usr');
          // The subject is a placeholder nobody can present until the provisioning worker binds the user to its Auth account.
          await sql`
          insert into app_user (id, tenant_id, idp_subject, email, mobile_e164, display_name, user_type, status,
                                availability, primary_branch_id, created_by, updated_by)
          values (${userId}, ${ctx.principal.tenantId}, ${unboundSubject(userId)}, ${email}, ${input.mobileE164 ?? null},
                  ${input.displayName.trim()}, 'STAFF', 'INVITED', 'OFF_DUTY', ${input.primaryBranchId},
                  ${ctx.principal.id}, ${ctx.principal.id})`.execute(tx);
          for (const roleId of input.roleIds ?? []) {
            const role = await sql`select 1 from role where id = ${roleId}`.execute(tx);
            if (!role.rows.length) {
              throw AppError.of('VALIDATION_ERROR', 'The role was not found.', [
                { field: 'roleIds', issue: 'NOT_FOUND' },
              ]);
            }
            await sql`
            insert into user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by)
            values (${deps.ids.next('ura')}, ${ctx.principal.tenantId}, ${userId}, ${roleId}, 'TENANT', '{}',
                    ${ctx.principal.id})`.execute(tx);
          }
          // One PENDING invitation per user, QUEUED for the provisioning worker. It cannot activate anyone until the worker marks it SENT.
          // The worker sets the real expiry when the e-mail goes out.
          const invitationId = deps.ids.next('inv');
          await sql`
          insert into staff_invitation (id, tenant_id, user_id, status, delivery_state, requested_at, next_attempt_at,
                                        sent_at, expires_at, created_by, updated_by)
          values (${invitationId}, ${ctx.principal.tenantId}, ${userId}, 'PENDING', 'QUEUED', ${ctx.now}::timestamptz,
                  ${ctx.now}::timestamptz, ${ctx.now}::timestamptz, ${invitationExpiry(ctx.now)}::timestamptz,
                  ${ctx.principal.id}, ${ctx.principal.id})`.execute(tx);
          await deps.audit.record(tx, ctx, {
            action: 'user.invited',
            entityType: 'USER',
            entityId: userId,
            after: {
              status: 'INVITED',
              primaryBranchId: input.primaryBranchId,
              roleIds: input.roleIds ?? [],
              invitationId,
              delivery: 'QUEUED',
            },
            permissionUsed: 'user.manage',
          });
          await emit(deps, tx, ctx, 'user.invited', userId, { primaryBranchId: input.primaryBranchId });
          return { status: 201, body: await readUser(tx, userId), resourceRef: userId };
        },
      ),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });

  // Queues a new set-password e-mail for an invitee who has not yet set a password (API-USR-001); the provisioning worker sends it.
  // Only an INVITED user can be re-invited. The user row and the invitation row are locked, so the limits and the cooldown cannot be
  // passed by two requests at once, and a request is refused while an earlier one is still being sent.
  router.post('/users/:id/invitation/resend', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'user.manage');
    const userId = req.params.id;
    await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const person = (
        await sql<{ status: string }>`
        select status from app_user where id = ${userId} for update`.execute(tx)
      ).rows[0];
      if (!person) throw AppError.of('NOT_FOUND', 'User not found.');
      if (person.status !== 'INVITED') {
        throw AppError.of('INVALID_STATE', 'Only an invited user can be sent a new invitation.');
      }
      const current = (
        await sql<{
          id: string;
          status: string;
          delivery_state: string;
          requested_at: Date;
          expires_at: Date;
          resend_count: number;
        }>`
          select id, status, delivery_state, requested_at, expires_at, resend_count from staff_invitation
           where user_id = ${userId} and status in ('PENDING', 'EXPIRED')
           order by requested_at desc limit 1 for update`.execute(tx)
      ).rows[0];
      if (current && (current.delivery_state === 'QUEUED' || current.delivery_state === 'SENDING')) {
        throw AppError.of(
          'INVALID_STATE',
          'The invitation e-mail is still being sent. Check again in a minute.',
        );
      }
      const refusal = resendRefusal(
        current
          ? {
              status: current.status,
              sentAt: current.requested_at,
              expiresAt: current.expires_at,
              resendCount: current.resend_count,
            }
          : undefined,
        ctx.now,
      );
      if (refusal) throw AppError.of('INVALID_STATE', refusal);

      // The worker sets the real expiry when the e-mail goes out; until then the invitation cannot activate anyone.
      const expiry = invitationExpiry(ctx.now);
      if (current) {
        await sql`
          update staff_invitation
             set status = 'PENDING', delivery_state = 'QUEUED', requested_at = ${ctx.now}::timestamptz,
                 next_attempt_at = ${ctx.now}::timestamptz, delivery_attempts = 0, expires_at = ${expiry}::timestamptz,
                 resend_count = resend_count + 1, last_failure = null, claimed_at = null, claimed_by = null,
                 updated_by = ${ctx.principal.id}
           where id = ${current.id}`.execute(tx);
      } else {
        await sql`
          insert into staff_invitation (id, tenant_id, user_id, status, delivery_state, requested_at, next_attempt_at,
                                        sent_at, expires_at, created_by, updated_by)
          values (${deps.ids.next('inv')}, ${ctx.principal.tenantId}, ${userId}, 'PENDING', 'QUEUED', ${ctx.now}::timestamptz,
                  ${ctx.now}::timestamptz, ${ctx.now}::timestamptz, ${expiry}::timestamptz, ${ctx.principal.id},
                  ${ctx.principal.id})`.execute(tx);
      }
      await deps.audit.record(tx, ctx, {
        action: 'user.invitation_resent',
        entityType: 'USER',
        entityId: userId,
        after: {
          status: 'INVITED',
          resent: current ? 'EXISTING_INVITATION' : 'NEW_INVITATION',
          delivery: 'QUEUED',
        },
        permissionUsed: 'user.manage',
      });
    });
    res.status(202).json({ id: userId, invitation: 'QUEUED' });
  });

  // The state of the latest invitation of a user, for administrators (API-USR-001).
  router.get('/users/:id/invitation', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'user.manage');
    const userId = req.params.id;
    const view = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const person = (
        await sql<{ status: string }>`select status from app_user where id = ${userId}`.execute(tx)
      ).rows[0];
      if (!person) throw AppError.of('NOT_FOUND', 'User not found.');
      const latest = (
        await sql<{
          status: string;
          delivery_state: string;
          last_failure: string | null;
          requested_at: Date;
          sent_at: Date;
          expires_at: Date;
          resend_count: number;
          accepted_at: Date | null;
        }>`
          select status, delivery_state, last_failure, requested_at, sent_at, expires_at, resend_count, accepted_at
            from staff_invitation
           where user_id = ${userId} order by requested_at desc limit 1`.execute(tx)
      ).rows[0];
      return { userStatus: person.status, latest };
    });
    const record = view.latest;
    res.json({
      userStatus: view.userStatus,
      invitationState: invitationState(
        record
          ? {
              status: record.status,
              sentAt: record.sent_at,
              expiresAt: record.expires_at,
              resendCount: record.resend_count,
            }
          : undefined,
        ctx.now,
      ),
      // QUEUED or SENDING: the worker has not sent it yet. FAILED: lastFailure is a short code (never a provider message).
      deliveryState: record ? record.delivery_state : null,
      lastFailure: record ? record.last_failure : null,
      sentAt: record && record.delivery_state === 'SENT' ? record.sent_at.toISOString() : null,
      expiresAt: record ? record.expires_at.toISOString() : null,
      resendCount: record ? record.resend_count : 0,
      acceptedAt: record?.accepted_at ? record.accepted_at.toISOString() : null,
      // For the resend button's countdown: the earliest time the cooldown allows another request, how many are left, and the server's
      // clock (so a browser with a wrong clock still counts down correctly).
      nextResendAt: record
        ? new Date(record.requested_at.getTime() + RESEND_COOLDOWN_MS).toISOString()
        : null,
      resendsLeft: record ? Math.max(0, MAX_RESENDS - record.resend_count) : MAX_RESENDS,
      serverTime: ctx.now.toISOString(),
    });
  });

  // API-USR-004
  router.post('/users/:id/deactivation', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'user.manage');
    const key = idempotencyKey(req);
    const version = ifMatchVersion(req);
    const input = DeactivateUserRequest.parse(req.body);
    refuseSelf(ctx, req.params.id, 'deactivate');
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/users/${req.params.id}/deactivation`, body: input },
        async () => {
          const row = await lockUser(tx, req.params.id, version);
          refuseDeleted(row);
          if (row.status === 'DEACTIVATED')
            throw AppError.of('INVALID_STATE', 'The user is already deactivated.');
          if (input.handoverToUserId === row.id) {
            throw AppError.of('VALIDATION_ERROR', 'Hand over to another user.', [
              { field: 'handoverToUserId', issue: 'SAME_USER' },
            ]);
          }
          const to = await sql<Row>`select status from app_user where id = ${input.handoverToUserId}`.execute(
            tx,
          );
          if (to.rows[0]?.status !== 'ACTIVE') {
            throw AppError.of('VALIDATION_ERROR', 'The hand-over user must be active in this tenant.', [
              { field: 'handoverToUserId', issue: to.rows[0] ? 'NOT_ACTIVE' : 'NOT_FOUND' },
            ]);
          }
          const moved = await sql<{ counts: Record<string, number> }>`
            select handover_owned_records(${String(row.id)}, ${input.handoverToUserId}, ${ctx.principal.id}) as counts`.execute(
            tx,
          );
          const counts = moved.rows[0]!.counts;
          await setStatus(tx, ctx, row, 'DEACTIVATED');
          // Ending the assignments keeps them as history; a deactivated user holds no role.
          await sql`
            update user_role_assignment
               set effective_range = tstzrange(lower(effective_range), greatest(now(), lower(effective_range)), '[)')
             where user_id = ${String(row.id)} and effective_range @> now()`.execute(tx);
          await deps.audit.record(tx, ctx, {
            action: 'user.deactivated',
            entityType: 'USER',
            entityId: String(row.id),
            before: { status: row.status },
            after: { status: 'DEACTIVATED', handoverToUserId: input.handoverToUserId, handedOver: counts },
            reason: input.reason,
            permissionUsed: 'user.manage',
          });
          await emit(deps, tx, ctx, 'user.deactivated', String(row.id), {
            handoverToUserId: input.handoverToUserId,
            handedOver: counts,
          });
          return {
            status: 200,
            body: { ...(await readUser(tx, String(row.id))), handedOver: counts },
            resourceRef: String(row.id),
          };
        },
      ),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });

  // Delete account (API-USR-004E). The person's name, e-mail and mobile are erased for good and they can never sign in again. A nameless
  // DEACTIVATED record stays, so the leads, tasks and audit entries that point at the user keep their meaning. Open work is handed over
  // first (as deactivation does), roles end, and pending invitations are revoked. The Supabase sign-in account is deleted afterwards by
  // the provisioning worker, the only holder of the service-role key; until then the old account matches no user.
  router.post('/users/:id/erasure', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'user.manage');
    const key = idempotencyKey(req);
    const version = ifMatchVersion(req);
    const input = EraseUserRequest.parse(req.body);
    refuseSelf(ctx, req.params.id, 'delete');
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/users/${req.params.id}/erasure`, body: input },
        async () => {
          const row = await lockUser(tx, req.params.id, version);
          const userId = String(row.id);
          refuseDeleted(row);
          let handedOver: Record<string, number> = {};
          if (input.handoverToUserId) {
            if (input.handoverToUserId === userId) {
              throw AppError.of('VALIDATION_ERROR', 'Hand over to another user.', [
                { field: 'handoverToUserId', issue: 'SAME_USER' },
              ]);
            }
            const to =
              await sql<Row>`select status from app_user where id = ${input.handoverToUserId}`.execute(tx);
            if (to.rows[0]?.status !== 'ACTIVE') {
              throw AppError.of('VALIDATION_ERROR', 'The hand-over user must be active in this tenant.', [
                { field: 'handoverToUserId', issue: to.rows[0] ? 'NOT_ACTIVE' : 'NOT_FOUND' },
              ]);
            }
            const moved = await sql<{ counts: Record<string, number> }>`
              select handover_owned_records(${userId}, ${input.handoverToUserId}, ${ctx.principal.id}) as counts`.execute(
              tx,
            );
            handedOver = moved.rows[0]!.counts;
          } else if (row.status !== 'INVITED') {
            throw AppError.of('VALIDATION_ERROR', 'Choose who takes over this person’s open work.', [
              { field: 'handoverToUserId', issue: 'REQUIRED' },
            ]);
          }
          if (row.status !== 'DEACTIVATED') await setStatus(tx, ctx, row, 'DEACTIVATED');
          await sql`
            update user_role_assignment
               set effective_range = tstzrange(lower(effective_range), greatest(now(), lower(effective_range)), '[)')
             where user_id = ${userId} and effective_range @> now()`.execute(tx);
          await sql`
            update staff_invitation
               set status = 'REVOKED',
                   delivery_state = case when delivery_state in ('QUEUED', 'SENDING') then 'CANCELLED' else delivery_state end,
                   claimed_at = null, claimed_by = null, updated_by = ${ctx.principal.id}
             where user_id = ${userId} and status = 'PENDING'`.execute(tx);
          // A deleted account belongs to no team or work queue and leads no team; the memberships end (and stay as history), and a team
          // it led is left without a manager for an administrator to name one.
          const teamsLeft = await sql`
            update team_membership
               set effective_range = tstzrange(lower(effective_range), greatest(now(), lower(effective_range)), '[)')
             where user_id = ${userId} and effective_range @> now()`.execute(tx);
          const queuesLeft = await sql`
            update work_queue_member
               set effective_range = tstzrange(lower(effective_range), greatest(now(), lower(effective_range)), '[)')
             where user_id = ${userId} and effective_range @> now()`.execute(tx);
          const teamsUnmanaged = await sql`
            update team set manager_user_id = null, updated_by = ${ctx.principal.id}
             where manager_user_id = ${userId}`.execute(tx);
          const memberships = {
            teamsLeft: Number(teamsLeft.numAffectedRows ?? 0),
            queuesLeft: Number(queuesLeft.numAffectedRows ?? 0),
            teamsWithoutManager: Number(teamsUnmanaged.numAffectedRows ?? 0),
          };
          // An invitee who was never bound has no sign-in account to delete, so the subject is retired here; otherwise the worker
          // deletes the account and then retires it.
          const subject = String(row.idp_subject);
          await sql`
            update app_user
               set display_name = ${ERASED_DISPLAY_NAME}, email = ${erasedEmail(userId)}, mobile_e164 = null,
                   availability = 'OFF_DUTY',
                   idp_subject = ${isUnboundSubject(subject) ? erasedSubject(userId) : subject},
                   updated_by = ${ctx.principal.id}
             where id = ${userId}`.execute(tx);
          await deps.audit.record(tx, ctx, {
            action: 'user.erased',
            entityType: 'USER',
            entityId: userId,
            before: { status: row.status },
            after: {
              status: 'DEACTIVATED',
              erased: true,
              handoverToUserId: input.handoverToUserId ?? null,
              handedOver,
              ...memberships,
            },
            reason: input.reason,
            permissionUsed: 'user.manage',
          });
          await emit(deps, tx, ctx, 'user.erased', userId, { handedOver, ...memberships });
          return {
            status: 200,
            body: { ...(await readUser(tx, userId)), handedOver, ...memberships },
            resourceRef: userId,
          };
        },
      ),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });

  // API-USR-005
  router.post('/users/:id/suspension', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'user.manage');
    const version = ifMatchVersion(req);
    const input = SuspendUserRequest.parse(req.body);
    refuseSelf(ctx, req.params.id, 'suspend or reactivate');
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const row = await lockUser(tx, req.params.id, version);
      refuseDeleted(row);
      const [from, to] = input.action === 'SUSPEND' ? ['ACTIVE', 'SUSPENDED'] : ['SUSPENDED', 'ACTIVE'];
      if (row.status !== from) {
        throw AppError.of(
          'INVALID_STATE',
          `Only a ${from} user can be ${input.action === 'SUSPEND' ? 'suspended' : 'reactivated'}.`,
        );
      }
      if (to === 'ACTIVE') await assertMayBecomeActive(tx, String(row.id), String(row.status));
      await setStatus(tx, ctx, row, to);
      const action = input.action === 'SUSPEND' ? 'user.suspended' : 'user.reactivated';
      await deps.audit.record(tx, ctx, {
        action,
        entityType: 'USER',
        entityId: String(row.id),
        before: { status: from },
        after: { status: to },
        reason: input.reason,
        permissionUsed: 'user.manage',
      });
      await emit(deps, tx, ctx, action, String(row.id), { status: to });
      return readUser(tx, String(row.id));
    });
    sendResource(res, 200, body);
  });

  // API-USR-006
  router.put('/users/:id/role-assignments', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'role.manage');
    deps.authz.requireStepUp(ctx);
    const version = ifMatchVersion(req);
    const input = ReplaceRoleAssignmentsRequest.parse(req.body);
    refuseSelf(ctx, req.params.id, 'change the roles of');
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const row = await lockUser(tx, req.params.id, version);
      refuseDeleted(row);
      if (row.status === 'DEACTIVATED')
        throw AppError.of('INVALID_STATE', 'A deactivated user cannot hold roles.');
      const adminsBefore = await countActiveAdministrators(tx, ctx.principal.tenantId);
      const current = await sql<Row>`
        select id, role_id, scope_type, scope_branch_ids from user_role_assignment
         where user_id = ${String(row.id)} and effective_range @> now()`.execute(tx);
      const keyOf = (roleId: string, scope: string, branches: string[]) =>
        `${roleId}|${scope}|${[...branches].sort().join(',')}`;
      const wanted = new Map(
        input.assignments.map((a) => [keyOf(a.roleId, a.scopeType, a.scopeBranchIds), a]),
      );
      const held = new Map(
        current.rows.map((c) => [
          keyOf(String(c.role_id), String(c.scope_type), (c.scope_branch_ids as string[]) ?? []),
          c,
        ]),
      );
      const ended: string[] = [];
      for (const [k, c] of held) {
        if (wanted.has(k)) continue;
        await sql`
          update user_role_assignment
             set effective_range = tstzrange(lower(effective_range), greatest(now(), lower(effective_range)), '[)')
           where id = ${String(c.id)}`.execute(tx);
        ended.push(String(c.role_id));
      }
      const added: string[] = [];
      for (const [k, a] of wanted) {
        if (held.has(k)) continue;
        const role = await sql`select 1 from role where id = ${a.roleId}`.execute(tx);
        if (!role.rows.length) {
          throw AppError.of('VALIDATION_ERROR', 'The role was not found.', [
            { field: 'assignments', issue: 'ROLE_NOT_FOUND' },
          ]);
        }
        if (a.scopeType === 'BRANCH' && a.scopeBranchIds.length === 0) {
          throw AppError.of('VALIDATION_ERROR', 'A BRANCH assignment names at least one branch.', [
            { field: 'assignments', issue: 'BRANCHES_REQUIRED' },
          ]);
        }
        await sql`
          insert into user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by)
          values (${deps.ids.next('ura')}, ${ctx.principal.tenantId}, ${String(row.id)}, ${a.roleId}, ${a.scopeType},
                  ${a.scopeBranchIds}, ${ctx.principal.id})`.execute(tx);
        added.push(a.roleId);
      }
      await assertAdministratorRemains(tx, ctx.principal.tenantId, adminsBefore);
      await sql`update app_user set updated_by = ${ctx.principal.id} where id = ${String(row.id)}`.execute(
        tx,
      );
      await deps.audit.record(tx, ctx, {
        action: 'user.roles_replaced',
        entityType: 'USER',
        entityId: String(row.id),
        before: { roleIds: current.rows.map((c) => String(c.role_id)) },
        after: { added, ended },
        permissionUsed: 'role.manage',
      });
      await emit(deps, tx, ctx, 'user.roles_changed', String(row.id), { added, ended });
      return readUser(tx, String(row.id));
    });
    sendResource(res, 200, body);
  });

  // API-USR-008
  router.post('/users/:id/transfers', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'user.manage');
    const key = idempotencyKey(req);
    const input = TransferUserRequest.parse(req.body);
    const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : ctx.now;
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/users/${req.params.id}/transfers`, body: input },
        async () => {
          const row = await lockUser(tx, req.params.id, null);
          refuseDeleted(row);
          if (row.status === 'DEACTIVATED')
            throw AppError.of('INVALID_STATE', 'A deactivated user cannot be transferred.');
          if (row.primary_branch_id === input.toBranchId) {
            throw AppError.of('VALIDATION_ERROR', 'The user is already in that branch.', [
              { field: 'toBranchId', issue: 'SAME_BRANCH' },
            ]);
          }
          await requireActiveBranch(tx, input.toBranchId, 'toBranchId');
          const scheduled = effectiveAt.getTime() > ctx.now.getTime();
          if (scheduled) {
            await globalJobQueue.enqueue(
              tx,
              deps.ids.next('job'),
              ctx.principal.tenantId,
              USER_TRANSFER_JOB,
              {
                userId: String(row.id),
                toBranchId: input.toBranchId,
                reason: input.reason,
                correlationId: ctx.correlationId,
              },
              effectiveAt,
            );
          } else {
            await applyTransfer(tx, String(row.id), input.toBranchId, ctx.principal.id);
          }
          await deps.audit.record(tx, ctx, {
            action: scheduled ? 'user.transfer_scheduled' : 'user.transferred',
            entityType: 'USER',
            entityId: String(row.id),
            before: { primaryBranchId: row.primary_branch_id },
            after: { primaryBranchId: input.toBranchId, effectiveAt: effectiveAt.toISOString() },
            reason: input.reason,
            permissionUsed: 'user.manage',
          });
          await emit(
            deps,
            tx,
            ctx,
            scheduled ? 'user.transfer_scheduled' : 'user.transferred',
            String(row.id),
            {
              toBranchId: input.toBranchId,
              effectiveAt: effectiveAt.toISOString(),
            },
          );
          const body: UserTransferResponse = {
            userId: String(row.id),
            toBranchId: input.toBranchId,
            effectiveAt: effectiveAt.toISOString(),
            status: scheduled ? 'SCHEDULED' : 'APPLIED',
          };
          return { status: scheduled ? 202 : 200, body, resourceRef: String(row.id) };
        },
      ),
    );
    res.status(result.status).json(result.body);
  });
}
