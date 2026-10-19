// apps/api/src/modules/platform/worker.ts — owner: Platform Squad (MOD-IMP, TASK-413; outbox relay TASK-105)
// One timer for the API's background work: the outbox relay, queued jobs (found per tenant through app.runnable_jobs,
// M-067) and storage retention. A failing tick is reported through onError and the loop carries on.
import type { RequestContext, TxRunner } from '@dsa/contracts';
import { sql } from 'kysely';
import { globalStorage } from '../../storage/object-storage';
import { globalJobQueue } from './job-queue';
import type { OutboxRelay } from './outbox-relay';

export const WORKER_DISCOVERY_TENANT = 'SYSTEM';

const serviceContext = (tenantId: string, correlationId: string): RequestContext => ({
  principal: {
    kind: 'SERVICE',
    id: 'SYSTEM:background-worker',
    tenantId,
    primaryBranchId: null,
    managedTeamMemberIds: [],
    queueIds: [],
    grants: [],
    authTime: null,
  },
  correlationId,
  now: new Date(),
});

export interface BackgroundWorkerOptions {
  txRunner: TxRunner;
  outboxRelay?: OutboxRelay;
  intervalMs?: number;
  onError?: (stage: 'outbox' | 'jobs' | 'storage', err: unknown) => void;
}

export function startBackgroundWorker(opts: BackgroundWorkerOptions): { stop: () => void } {
  let isRunning = false;
  let lastCleanup = Date.now();
  const report = opts.onError ?? (() => undefined);

  const tick = async () => {
    if (opts.outboxRelay) {
      await opts.outboxRelay.drain().catch((err) => report('outbox', err));
    }

    if (globalJobQueue.hasHandlers()) {
      try {
        const jobs = await opts.txRunner.withTenantTx(
          serviceContext(WORKER_DISCOVERY_TENANT, 'worker_job_discovery'),
          async (tx) =>
            (await sql<{ tenant_id: string; id: string }>`SELECT tenant_id, id FROM app.runnable_jobs(20)`.execute(tx))
              .rows,
        );
        for (const job of jobs) {
          await opts.txRunner.withTenantTx(serviceContext(job.tenant_id, `worker_job_${job.id}`), (tx) =>
            globalJobQueue.processJob(tx, job.id),
          );
        }
      } catch (err) {
        report('jobs', err);
      }
    }

    const now = Date.now();
    if (now - lastCleanup > 60 * 60 * 1000) {
      lastCleanup = now;
      try {
        await globalStorage.cleanupExpired('exports', 24); // 24-hr expiry for exports
        await globalStorage.cleanupExpired('source', 24 * 7); // 7-day retention for source import files
      } catch (err) {
        report('storage', err);
      }
    }
  };

  const timer = setInterval(() => {
    if (isRunning) return;
    isRunning = true;
    void tick().finally(() => {
      isRunning = false;
    });
  }, opts.intervalMs ?? 2000);

  return {
    stop: () => clearInterval(timer),
  };
}
