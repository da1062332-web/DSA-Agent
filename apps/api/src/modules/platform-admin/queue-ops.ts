// SUB-ADM.04 background queues (owner: Dev 1). The real queues are the outbox relay and the job queue; their counts, pause
// flags and parked items come from the platform-realm functions and table of M-068. Dead letters carry no event payload,
// only which tenant, which item type, the error and the timing.
import {
  AppError,
  type DeadLetterItem,
  type JobQueueInfo,
  type RequestContext,
  type TxRunner,
} from '@dsa/contracts';
import { sql } from 'kysely';

type Row = Record<string, unknown>;

export interface QueueOps {
  overview(ctx: RequestContext): Promise<{ queues: JobQueueInfo[]; deadLetters: DeadLetterItem[] }>;
  setPaused(ctx: RequestContext, queue: string, paused: boolean, reason: string): Promise<void>;
  deadLetterAction(ctx: RequestContext, id: string, action: 'REPLAY' | 'DISCARD'): Promise<void>;
}

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

export class PgQueueOps implements QueueOps {
  constructor(private readonly txRunner: TxRunner) {}

  async overview(ctx: RequestContext): Promise<{ queues: JobQueueInfo[]; deadLetters: DeadLetterItem[] }> {
    return this.txRunner.withTenantTx(ctx, async (tx) => {
      const stats = await sql<Row>`SELECT * FROM app.platform_queue_stats()`.execute(tx);
      const flags = await sql<Row>`SELECT * FROM app.worker_queue_state`.execute(tx);
      const dead = await sql<Row>`SELECT * FROM app.platform_dead_letters(200)`.execute(tx);
      const flagOf = new Map(flags.rows.map((f) => [String(f.queue), f]));
      return {
        queues: stats.rows.map((r) => {
          const f = flagOf.get(String(r.queue));
          return {
            queue: String(r.queue),
            activeJobs: Number(r.active_jobs),
            failedJobs: Number(r.failed_jobs),
            delayedJobs: Number(r.delayed_jobs),
            completedJobs: Number(r.completed_jobs),
            paused: Boolean(f?.paused),
            pausedReason: (f?.paused_reason as string | null) ?? null,
            pausedAt: iso(f?.paused_at),
            pausedBy: (f?.paused_by as string | null) ?? null,
          };
        }),
        deadLetters: dead.rows.map((r) => ({
          id: String(r.id),
          queue: String(r.queue),
          originalJobId: String(r.id),
          payload: { tenantId: String(r.tenant_id), type: String(r.item_type) },
          errorReason: String(r.error_reason),
          failedAt: iso(r.failed_at)!,
          retryCount: Number(r.retry_count),
          status: r.status as DeadLetterItem['status'],
        })),
      };
    });
  }

  async setPaused(ctx: RequestContext, queue: string, paused: boolean, reason: string): Promise<void> {
    await this.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`
        UPDATE app.worker_queue_state
           SET paused = ${paused}, paused_reason = ${paused ? reason : null}, paused_at = ${paused ? ctx.now : null},
               paused_by = ${paused ? ctx.principal.id : null}, updated_at = now()
         WHERE queue = ${queue}
        RETURNING queue`.execute(tx);
      if (!r.rows[0]) throw AppError.of('NOT_FOUND', `Queue '${queue}' not found.`);
    });
  }

  async deadLetterAction(ctx: RequestContext, id: string, action: 'REPLAY' | 'DISCARD'): Promise<void> {
    await this.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`SELECT * FROM app.platform_dead_letter_action(${id}, ${action})`.execute(tx);
      if (!r.rows[0]) throw AppError.of('NOT_FOUND', `Dead letter record '${id}' not found.`);
    });
  }
}
