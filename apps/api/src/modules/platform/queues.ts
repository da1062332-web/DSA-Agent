// MOD-ORG work queues (owner: Dev 1) — API-ORG-011 POST /v1/work-queues (Idem) · API-ORG-012 GET /v1/work-queues
// (restored, TASK-435) · API-ORG-013 PATCH /v1/work-queues/{id} · API-ORG-014 PUT /v1/work-queues/{id}/members.
// One INTAKE and one UNASSIGNED queue per branch (unique indexes). Round-robin assignment is UserDirectoryPort.
// Reads: any signed-in user. Queues: config.manage. Members: user.manage, within the caller's branch scope (API-ORG-014).
import { AppError, type Tx } from '@dsa/contracts';
import { requirePermissionForBranch, withIdempotency } from '@dsa/kernel';
import type { Router } from 'express';
import { sql } from 'kysely';
import { idempotencyKey, ifMatchVersion, requireCtx, sendResource } from '../../http/request';
import type { ApiDeps } from '../types';
import {
  iso,
  keysetPage,
  loadForUpdate,
  requireActiveBranch,
  requireActiveUsers,
  updateVersioned,
  type Row,
} from './db';
import {
  ListQuery,
  WorkQueueCreate,
  WorkQueueMembersPut,
  WorkQueuePatch,
  type WorkQueue,
  type WorkQueueDetail,
} from './schemas';

const QUEUE_WITH_COUNT = sql`(
  select q.*, (select count(*)::int from work_queue_member m
                where m.queue_id = q.id and m.effective_range @> now()) as member_count
    from work_queue q) q`;

const toQueue = (r: Row): WorkQueue => ({
  id: String(r.id),
  code: String(r.code),
  name: String(r.name),
  kind: r.kind as WorkQueue['kind'],
  branchId: (r.branch_id as string | null) ?? null,
  teamId: (r.team_id as string | null) ?? null,
  recordTypes: r.record_types as WorkQueue['recordTypes'],
  active: Boolean(r.active),
  memberCount: Number(r.member_count ?? 0),
  version: Number(r.lock_version),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const snapshot = (r: Row) => ({
  code: r.code,
  name: r.name,
  kind: r.kind,
  active: r.active,
  recordTypes: r.record_types,
});

async function loadQueueDetail(tx: Tx, id: string): Promise<WorkQueueDetail> {
  const q = await sql<Row>`select * from ${QUEUE_WITH_COUNT} where id = ${id}`.execute(tx);
  const row = q.rows[0];
  if (!row) throw AppError.of('NOT_FOUND', 'Work queue not found.');
  const m = await sql<{
    user_id: string;
    display_name: string;
    can_pick: boolean;
    can_assign: boolean;
    since: Date;
  }>`
    select m.user_id, u.display_name, m.can_pick, m.can_assign, lower(m.effective_range) as since
      from work_queue_member m join app_user u on u.id = m.user_id
     where m.queue_id = ${id} and m.effective_range @> now()
     order by u.display_name, m.user_id`.execute(tx);
  return {
    ...toQueue(row),
    members: m.rows.map((x) => ({
      userId: x.user_id,
      displayName: x.display_name,
      canPick: x.can_pick,
      canAssign: x.can_assign,
      since: iso(x.since),
    })),
  };
}

export function registerQueueRoutes(router: Router, deps: ApiDeps): void {
  router.get('/work-queues', async (req, res) => {
    const ctx = requireCtx(req);
    const q = ListQuery.parse(req.query);
    const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
    const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
    const page = await deps.txRunner.withTenantTx(ctx, (tx) =>
      keysetPage(tx, {
        from: QUEUE_WITH_COUNT,
        select: sql`*`,
        sortColumn: 'code',
        where: [
          ...(q.status ? [sql`active = ${q.status === 'ACTIVE'}`] : []),
          ...(q.q ? [sql`(code ilike ${`%${q.q}%`} or name ilike ${`%${q.q}%`})`] : []),
          ...(branchId ? [sql`branch_id = ${branchId}`] : []),
          ...(kind ? [sql`kind = ${kind}`] : []),
        ],
        limit: q.limit,
        cursor: q.cursor,
        map: toQueue,
      }),
    );
    res.json(page);
  });

  router.get('/work-queues/:id', async (req, res) => {
    const ctx = requireCtx(req);
    const queue = await deps.txRunner.withTenantTx(ctx, (tx) => loadQueueDetail(tx, req.params.id));
    sendResource(res, 200, queue);
  });

  router.post('/work-queues', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'config.manage');
    const key = idempotencyKey(req);
    const input = WorkQueueCreate.parse(req.body);

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(tx, ctx, { key, method: 'POST', path: '/v1/work-queues', body: input }, async () => {
        if (input.branchId) await requireActiveBranch(tx, input.branchId, 'branchId');
        if (input.teamId) {
          const t = await sql<{ status: string }>`select status from team where id = ${input.teamId}`.execute(
            tx,
          );
          if (t.rows[0]?.status !== 'ACTIVE') {
            throw AppError.of('VALIDATION_ERROR', 'The team does not exist or is inactive.', [
              { field: 'teamId', issue: 'TEAM_NOT_ACTIVE' },
            ]);
          }
        }
        const id = deps.ids.next('wq');
        await sql`
          insert into work_queue (id, tenant_id, code, name, kind, branch_id, team_id, record_types, created_by, updated_by)
          values (${id}, ${ctx.principal.tenantId}, ${input.code}, ${input.name}, ${input.kind},
                  ${input.branchId ?? null}, ${input.teamId ?? null}, ${input.recordTypes}::text[],
                  ${ctx.principal.id}, ${ctx.principal.id})`.execute(tx);
        const queue = await loadQueueDetail(tx, id);
        await deps.audit.record(tx, ctx, {
          action: 'work_queue.created',
          entityType: 'WORK_QUEUE',
          entityId: id,
          after: { code: queue.code, name: queue.name, kind: queue.kind, recordTypes: queue.recordTypes },
          permissionUsed: 'config.manage',
        });
        return { status: 201, body: queue, resourceRef: id };
      }),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });

  router.patch('/work-queues/:id', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'config.manage');
    const version = ifMatchVersion(req);
    const input = WorkQueuePatch.parse(req.body);

    const queue = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const current = await loadForUpdate(tx, 'work_queue', req.params.id, 'Work queue');
      if (input.active && current.branch_id)
        await requireActiveBranch(tx, String(current.branch_id), 'active');
      const updated = await updateVersioned(tx, ctx, 'work_queue', current, version, {
        name: input.name,
        active: input.active,
        record_types: input.recordTypes ? sql`${input.recordTypes}::text[]` : undefined,
      });
      await deps.audit.record(tx, ctx, {
        action: 'work_queue.updated',
        entityType: 'WORK_QUEUE',
        entityId: String(updated.id),
        before: snapshot(current),
        after: snapshot(updated),
        permissionUsed: 'config.manage',
      });
      return loadQueueDetail(tx, String(updated.id));
    });
    sendResource(res, 200, queue);
  });

  router.put('/work-queues/:id/members', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'user.manage');
    const version = ifMatchVersion(req);
    const input = WorkQueueMembersPut.parse(req.body);
    const wanted = new Map(input.members.map((m) => [m.userId, m]));

    const queue = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const current = await loadForUpdate(tx, 'work_queue', req.params.id, 'Work queue');
      requirePermissionForBranch(ctx, ['user.manage'], (current.branch_id as string | null) ?? null);
      await requireActiveUsers(tx, [...wanted.keys()], 'members');

      const active = await sql<{ id: string; user_id: string; can_pick: boolean; can_assign: boolean }>`
        select id, user_id, can_pick, can_assign from work_queue_member
         where queue_id = ${current.id} and effective_range @> now()`.execute(tx);
      const have = new Map(active.rows.map((m) => [m.user_id, m]));

      // A member whose flags change is closed and re-added, so the history shows when the rights changed.
      const toClose = active.rows.filter((m) => {
        const w = wanted.get(m.user_id);
        return !w || w.canPick !== m.can_pick || w.canAssign !== m.can_assign;
      });
      const toAdd = [...wanted.values()].filter((w) => {
        const h = have.get(w.userId);
        return !h || toClose.some((c) => c.user_id === w.userId);
      });

      if (toClose.length) {
        await sql`
          update work_queue_member set effective_range = tstzrange(lower(effective_range), now(), '[)')
           where id = any(${toClose.map((m) => m.id)}::text[])`.execute(tx);
      }
      for (const m of toAdd) {
        await sql`
          insert into work_queue_member (id, tenant_id, queue_id, user_id, can_pick, can_assign, created_by)
          values (${deps.ids.next('wqm')}, ${ctx.principal.tenantId}, ${current.id}, ${m.userId},
                  ${m.canPick}, ${m.canAssign}, ${ctx.principal.id})`.execute(tx);
      }
      await updateVersioned(tx, ctx, 'work_queue', current, version, {});
      await deps.audit.record(tx, ctx, {
        action: 'work_queue.members_replaced',
        entityType: 'WORK_QUEUE',
        entityId: String(current.id),
        before: {
          members: active.rows.map((m) => ({
            userId: m.user_id,
            canPick: m.can_pick,
            canAssign: m.can_assign,
          })),
        },
        after: { members: input.members },
        permissionUsed: 'user.manage',
      });
      return loadQueueDetail(tx, String(current.id));
    });
    sendResource(res, 200, queue);
  });
}
