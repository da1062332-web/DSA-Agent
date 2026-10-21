// MOD-INT dead letters for a tenant (owner: Dev 1, who owns the outbox and the job queue; DSA Notion MODULE 35):
//   API-INT-003 GET  /v1/dead-letters               integration.dlq_manage; cursor
//   API-INT-004 POST /v1/dead-letters/{id}/replay   integration.dlq_manage; Idempotency-Key
//   API-INT-005 POST /v1/dead-letters/{id}/discard  integration.dlq_manage; a reason is required
// Two kinds, told apart by the id prefix: outbox events the relay parked after MAX_ATTEMPTS (evt_, M-067) and jobs that used
// every attempt (job_). Replay puts the item back in line; discard keeps it for audit and never delivers it. Row-level
// security keeps all of it inside the caller's tenant (the platform console has its own view, SUB-ADM.04).
// Items carry no payload: only their type, error, attempts and timing.
import { AppError, type RequestContext, type Tx } from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import type { Router } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { decodeCursor, encodeCursor, idempotencyKey, requireCtx } from '../../http/request';
import type { ApiDeps } from '../types';

type Row = Record<string, unknown>;

export const DeadLetterQuery = z.object({
  kind: z.enum(['EVENT', 'JOB']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export const DeadLetterDiscard = z.object({ reason: z.string().trim().min(3).max(200) }).strict();

const ITEMS = sql`(
  select id, 'EVENT' as kind, event_type as item_type, last_publish_error as error, publish_attempts as attempts,
         dead_lettered_at as failed_at
    from outbox_event
   where dead_lettered_at is not null and discarded_at is null and published_at is null
  union all
  select id, 'JOB', job_type, last_error, attempts, coalesce(completed_at, started_at, run_at)
    from job_queue
   where status = 'FAILED' and attempts >= max_attempts) d`;

const toItem = (r: Row) => ({
  id: String(r.id),
  kind: String(r.kind),
  type: String(r.item_type),
  error: (r.error as string | null) ?? null,
  attempts: Number(r.attempts),
  failedAt: new Date(String(r.failed_at)).toISOString(),
});

async function lockItem(tx: Tx, id: string): Promise<{ kind: 'EVENT' | 'JOB'; row: Row }> {
  if (id.startsWith('evt_')) {
    const r = await sql<Row>`
      select * from outbox_event where id = ${id} and dead_lettered_at is not null and discarded_at is null
         and published_at is null for update`.execute(tx);
    if (r.rows[0]) return { kind: 'EVENT', row: r.rows[0] };
  } else if (id.startsWith('job_')) {
    const r =
      await sql<Row>`select * from job_queue where id = ${id} and status = 'FAILED' and attempts >= max_attempts for update`.execute(
        tx,
      );
    if (r.rows[0]) return { kind: 'JOB', row: r.rows[0] };
  }
  throw AppError.of('NOT_FOUND', 'Dead letter not found.');
}

async function audit(
  deps: ApiDeps,
  tx: Tx,
  ctx: RequestContext,
  action: string,
  id: string,
  kind: string,
  reason?: string,
) {
  await deps.audit.record(tx, ctx, {
    action,
    entityType: kind === 'EVENT' ? 'OUTBOX_EVENT' : 'JOB',
    entityId: id,
    reason,
    permissionUsed: 'integration.dlq_manage',
  });
}

export function registerDeadLetterRoutes(router: Router, deps: ApiDeps): void {
  // API-INT-003
  router.get('/dead-letters', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'integration.dlq_manage');
    const q = DeadLetterQuery.parse(req.query);
    const after = decodeCursor(q.cursor);
    const page = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`
        select * from ${ITEMS}
         where true ${q.kind ? sql`and kind = ${q.kind}` : sql``}
           ${after ? sql`and (failed_at, id) < (${after.k}::timestamptz, ${after.id})` : sql``}
         order by failed_at desc, id desc
         limit ${q.limit + 1}`.execute(tx);
      const rows = r.rows.slice(0, q.limit);
      const last = rows[rows.length - 1];
      return {
        data: rows.map(toItem),
        meta: {
          nextCursor:
            r.rows.length > q.limit && last
              ? encodeCursor(new Date(String(last.failed_at)).toISOString(), String(last.id))
              : null,
          limit: q.limit,
        },
      };
    });
    res.json(page);
  });

  // API-INT-004
  router.post('/dead-letters/:id/replay', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'integration.dlq_manage');
    const key = idempotencyKey(req);
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/dead-letters/${req.params.id}/replay`, body: {} },
        async () => {
          const { kind, row } = await lockItem(tx, req.params.id);
          if (kind === 'EVENT') {
            await sql`
            update outbox_event set dead_lettered_at = null, publish_attempts = 0, last_publish_error = null
             where id = ${String(row.id)}`.execute(tx);
          } else {
            await sql`
            update job_queue set status = 'PENDING', attempts = 0, last_error = null, run_at = now()
             where id = ${String(row.id)}`.execute(tx);
          }
          await audit(deps, tx, ctx, 'dead_letter.replayed', String(row.id), kind);
          return {
            status: 202,
            body: { id: String(row.id), kind, status: 'REPLAYED' },
            resourceRef: String(row.id),
          };
        },
      ),
    );
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  // API-INT-005
  router.post('/dead-letters/:id/discard', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'integration.dlq_manage');
    const input = DeadLetterDiscard.parse(req.body);
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const { kind, row } = await lockItem(tx, req.params.id);
      if (kind === 'EVENT') {
        await sql`update outbox_event set discarded_at = now() where id = ${String(row.id)}`.execute(tx);
      } else {
        await sql`update job_queue set status = 'CANCELLED', completed_at = now() where id = ${String(row.id)}`.execute(
          tx,
        );
      }
      await audit(deps, tx, ctx, 'dead_letter.discarded', String(row.id), kind, input.reason);
      return { id: String(row.id), kind, status: 'DISCARDED' };
    });
    res.json(body);
  });
}
