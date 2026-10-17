// apps/api/src/modules/platform/worker.ts — owner: Platform Squad (MOD-IMP, TASK-413)
import type { ApiDeps } from '../types';
import { globalStorage } from '../../storage/object-storage';
import { globalJobQueue } from './job-queue';

export function startBackgroundWorker(deps: ApiDeps, intervalMs = 2000): { stop: () => void } {
  let isRunning = false;
  let lastCleanup = Date.now();

  const timer = setInterval(async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      // 1. Process pending jobs from PostgreSQL queue
      await deps.txRunner
        .withTenantTx(
          {
            principal: {
              kind: 'SERVICE',
              id: 'usr_system',
              tenantId: 'ten_default',
              primaryBranchId: null,
              managedTeamMemberIds: [],
              queueIds: [],
              grants: [],
              authTime: null,
            },
            correlationId: 'worker_poll',
            now: new Date(),
          },
          async (tx) => {
            await globalJobQueue.processNextJob(tx);
          },
        )
        .catch(() => {
          // Ignore idle / no-tenant errors in background poll
        });

      // 2. Periodic Storage Retention Cleanup (every 1 hour)
      const now = Date.now();
      if (now - lastCleanup > 60 * 60 * 1000) {
        lastCleanup = now;
        // 24-hr expiry for exports
        await globalStorage.cleanupExpired('exports', 24);
        // 7-day retention for source import files
        await globalStorage.cleanupExpired('source', 24 * 7);
      }
    } catch {
      // Background worker tick error ignored to ensure loop continuity
    } finally {
      isRunning = false;
    }
  }, intervalMs);

  return {
    stop: () => clearInterval(timer),
  };
}
