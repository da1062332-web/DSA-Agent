// MOD-USR lifecycle (owner: Dev 1; DSA Notion MODULE 4, SUB-USR.01 and SUB-USR.02). APIs:
//   API-USR-001 POST /v1/users/invitations          user.manage; Idempotency-Key. The user starts INVITED.
//   API-USR-004 POST /v1/users/{id}/deactivation    user.manage; Idempotency-Key; If-Match. Atomic hand-over (M-072).
//   API-USR-005 POST /v1/users/{id}/suspension      user.manage; If-Match. Suspend or reactivate.
//   API-USR-006 PUT  /v1/users/{id}/role-assignments role.manage; If-Match; step-up; SOD-05.
//   API-USR-008 POST /v1/users/{id}/transfers       user.manage; Idempotency-Key. Now, or scheduled through the job queue.
// Nobody changes their own status or roles (SOD-05), and no change may leave the tenant without an active administrator.
// Every change bumps the user's lock_version, and writes audit and an outbox event in the same transaction.
import {
  AppError,
  DeactivateUserRequest,
  InviteUserRequest,
  ReplaceRoleAssignmentsRequest,
  SuspendUserRequest,
  TransferUserRequest,
  type RequestContext,
  type Tx,
  type UserTransferResponse,
} from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import type { Router } from 'express';
import { sql } from 'kysely';
import { idempotencyKey, ifMatchVersion, requireCtx, sendResource } from '../../http/request';
import type { ApiDeps } from '../types';
import { requireActiveBranch, type Row } from './db';
import { globalJobQueue, type JobHandler } from './job-queue';
import { assertAdministratorRemains, countActiveAdministrators } from './role-guards';

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

export function registerUserLifecycleRoutes(router: Router, deps: ApiDeps): void {
  // API-USR-001
  router.post('/users/invitations', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'user.manage');
    const key = idempotencyKey(req);
    const input = InviteUserRequest.parse(req.body);
    const email = input.email.trim().toLowerCase();
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
          // The identity-provider subject is bound on first sign-in; until then it is a placeholder nobody can present.
          await sql`
          insert into app_user (id, tenant_id, idp_subject, email, mobile_e164, display_name, user_type, status,
                                availability, primary_branch_id, created_by, updated_by)
          values (${userId}, ${ctx.principal.tenantId}, ${`invite:${userId}`}, ${email}, ${input.mobileE164 ?? null},
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
          await deps.audit.record(tx, ctx, {
            action: 'user.invited',
            entityType: 'USER',
            entityId: userId,
            after: {
              status: 'INVITED',
              primaryBranchId: input.primaryBranchId,
              roleIds: input.roleIds ?? [],
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

  // API-USR-005
  router.post('/users/:id/suspension', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'user.manage');
    const version = ifMatchVersion(req);
    const input = SuspendUserRequest.parse(req.body);
    refuseSelf(ctx, req.params.id, 'suspend or reactivate');
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const row = await lockUser(tx, req.params.id, version);
      const [from, to] = input.action === 'SUSPEND' ? ['ACTIVE', 'SUSPENDED'] : ['SUSPENDED', 'ACTIVE'];
      if (row.status !== from) {
        throw AppError.of(
          'INVALID_STATE',
          `Only a ${from} user can be ${input.action === 'SUSPEND' ? 'suspended' : 'reactivated'}.`,
        );
      }
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
