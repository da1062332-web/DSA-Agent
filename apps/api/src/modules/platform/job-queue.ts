// apps/api/src/modules/platform/job-queue.ts — owner: Platform Squad (MOD-IMP, TASK-413)
import { AppError, type Tx } from '@dsa/contracts';
import { sql } from 'kysely';

export interface JobRow {
  id: string;
  tenant_id: string;
  job_type: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  run_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

export type JobHandler = (tx: Tx, tenantId: string, payload: Record<string, unknown>) => Promise<void>;

export class JobQueue {
  private handlers = new Map<string, JobHandler>();

  registerHandler(jobType: string, handler: JobHandler): void {
    this.handlers.set(jobType, handler);
  }

  async enqueue(
    tx: Tx,
    jobId: string,
    tenantId: string,
    jobType: string,
    payload: Record<string, unknown>,
    runAt: Date = new Date(),
  ): Promise<string> {
    await sql`
      INSERT INTO job_queue (
        id, tenant_id, job_type, payload, status, attempts, max_attempts, run_at, created_at
      ) VALUES (
        ${jobId}, ${tenantId}, ${jobType}, ${JSON.stringify(payload)}::jsonb,
        'PENDING', 0, 3, ${runAt.toISOString()}::timestamptz, now()
      )
    `.execute(tx);

    return jobId;
  }

  /**
   * Atomically claims and executes one pending job using SELECT ... FOR UPDATE SKIP LOCKED.
   */
  async processNextJob(tx: Tx, tenantId?: string): Promise<boolean> {
    const tenantFilter = tenantId ? sql`AND tenant_id = ${tenantId}` : sql``;

    const selectResult = await sql<JobRow>`
      SELECT * FROM job_queue
       WHERE status IN ('PENDING', 'FAILED')
         AND run_at <= now()
         AND attempts < max_attempts
         ${tenantFilter}
       ORDER BY run_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
    `.execute(tx);

    const job = selectResult.rows[0];
    if (!job) return false;

    const handler = this.handlers.get(job.job_type);
    if (!handler) {
      await sql`
        UPDATE job_queue
           SET status = 'FAILED',
               last_error = ${`No handler registered for job type ${job.job_type}`},
               attempts = attempts + 1
         WHERE id = ${job.id}
      `.execute(tx);
      return false;
    }

    // Mark RUNNING
    await sql`
      UPDATE job_queue
         SET status = 'RUNNING',
             started_at = now(),
             attempts = attempts + 1
       WHERE id = ${job.id}
    `.execute(tx);

    try {
      await handler(tx, job.tenant_id, typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload);

      // Mark COMPLETED
      await sql`
        UPDATE job_queue
           SET status = 'COMPLETED',
               completed_at = now(),
               last_error = null
         WHERE id = ${job.id}
      `.execute(tx);

      return true;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Exponential backoff for retry: next attempt in (attempts * 30) seconds
      const nextDelaySeconds = (job.attempts + 1) * 30;

      await sql`
        UPDATE job_queue
           SET status = 'FAILED',
               last_error = ${errMsg},
               run_at = now() + (${nextDelaySeconds} || ' seconds')::interval
         WHERE id = ${job.id}
      `.execute(tx);

      return false;
    }
  }
}

export const globalJobQueue = new JobQueue();
