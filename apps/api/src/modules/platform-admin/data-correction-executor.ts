// The data-correction executor (owner: Dev 1; Module 40, SUB-ADM.07; Release 2). It carries out corrections that a tenant administrator has
// APPROVED, and it is the only thing that does. It runs inside the API process (an HTTP token can never be a service identity), is OFF unless
// DATA_CORRECTION_EXECUTOR=true, and works like this for every approved correction, in the correction's own tenant:
//   1. lock the row (FOR UPDATE SKIP LOCKED, so two executors never run one correction) and require status APPROVED;
//   2. look up the script named by its scriptRef in the registry of REVIEWED scripts (correction-scripts.ts); none registered means FAILED;
//   3. run the script's dry run, which only reads, and store its diff and a hash of it on the correction;
//   4. run the script's apply in the SAME transaction as the status change to EXECUTED and the audit event, so either all of it
//      happens or none of it does;
//   5. if anything throws, that transaction rolls back (no half-applied correction, no dry-run record), and a second transaction
//      marks the correction FAILED with the reason and audits it.
// A correction that is not APPROVED (PENDING, REJECTED, EXECUTED, FAILED) is never touched, so running the executor again is harmless.
import { createHash } from 'node:crypto';
import type { AuditPort, RequestContext, Tx, TxRunner } from '@dsa/contracts';
import { sql } from 'kysely';

export const EXECUTOR_IDENTITY = 'SYSTEM:data-correction-executor';
/** The tenant context used only to ask which corrections are waiting. Tokens carry ten_… ids, so a customer session can never be this. */
export const EXECUTOR_DISCOVERY_TENANT = 'SYSTEM';

export interface ApprovedCorrection {
  id: string;
  tenantId: string;
  scriptRef: string;
  targetEntity: string | null;
  changeDescription: string | null;
  justification: string;
}

/** A reviewed script. It receives the transaction of the correction's own tenant, so row-level security applies to everything it does. */
export interface CorrectionScript {
  /** Describes what apply would change, as text a person can review. It must not write anything. */
  dryRun(tx: Tx, correction: ApprovedCorrection): Promise<string>;
  /** Carries out the change. Runs in the same transaction as the status change, so a throw undoes it. */
  apply(tx: Tx, correction: ApprovedCorrection): Promise<void>;
}

export type CorrectionOutcome =
  | { id: string; tenantId: string; outcome: 'EXECUTED'; dryRunDiffKey: string }
  | { id: string; tenantId: string; outcome: 'FAILED'; reason: string }
  | { id: string; tenantId: string; outcome: 'SKIPPED' };

const MAX_DIFF_CHARS = 20_000;
const MAX_REASON_CHARS = 500;

const contextFor = (tenantId: string, correlationId: string, now: Date): RequestContext => ({
  principal: {
    kind: 'SERVICE',
    id: EXECUTOR_IDENTITY,
    tenantId,
    primaryBranchId: null,
    managedTeamMemberIds: [],
    queueIds: [],
    grants: [],
    authTime: null,
  },
  correlationId,
  now,
});

export class DataCorrectionExecutor {
  constructor(
    private readonly deps: {
      txRunner: TxRunner;
      audit: AuditPort;
      scripts: ReadonlyMap<string, CorrectionScript>;
      clock?: () => Date;
    },
  ) {}

  private now(): Date {
    return this.deps.clock ? this.deps.clock() : new Date();
  }

  /** Finds approved corrections (ids only) and runs each. Returns what happened to every one it looked at. */
  async drain(limit = 20): Promise<CorrectionOutcome[]> {
    const waiting = await this.deps.txRunner.withTenantTx(
      contextFor(EXECUTOR_DISCOVERY_TENANT, 'corr_exec_discovery', this.now()),
      async (tx) => {
        const r = await sql<{
          tenant_id: string;
          id: string;
        }>`SELECT tenant_id, id FROM app.approved_data_corrections(${limit})`.execute(tx);
        return r.rows;
      },
    );
    const outcomes: CorrectionOutcome[] = [];
    for (const item of waiting) outcomes.push(await this.runOne(item.tenant_id, item.id));
    return outcomes;
  }

  /** Runs one correction in its own tenant. Safe to call again: anything that is not APPROVED is skipped. */
  async runOne(tenantId: string, id: string): Promise<CorrectionOutcome> {
    const ctx = contextFor(tenantId, `corr_exec_${id}`, this.now());
    try {
      const done = await this.deps.txRunner.withTenantTx(ctx, async (tx) => this.attempt(tx, ctx, id));
      return done;
    } catch (err) {
      const reason = reasonOf(err);
      // The attempt rolled back, so nothing it did remains. Record the failure in a transaction of its own.
      return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
        const row = await this.lock(tx, id);
        if (!row) return { id, tenantId, outcome: 'SKIPPED' } as const;
        await sql`
          UPDATE app.data_correction_request SET status = 'FAILED', failure_reason = ${reason}, executed_at = ${ctx.now},
                 executor_identity = ${EXECUTOR_IDENTITY}, lock_version = lock_version + 1
           WHERE id = ${id} AND tenant_id = ${tenantId}`.execute(tx);
        await this.deps.audit.record(tx, ctx, {
          action: 'data_correction.failed',
          entityType: 'DATA_CORRECTION',
          entityId: id,
          before: { status: 'APPROVED' },
          after: { status: 'FAILED', reason },
          permissionUsed: EXECUTOR_IDENTITY,
        });
        return { id, tenantId, outcome: 'FAILED', reason } as const;
      });
    }
  }

  private async lock(tx: Tx, id: string): Promise<ApprovedCorrection | null> {
    const r = await sql<{
      id: string;
      tenant_id: string;
      script_ref: string | null;
      target_entity: string | null;
      change_description: string | null;
      justification: string | null;
      reason: string | null;
    }>`SELECT id, tenant_id, script_ref, target_entity, change_description, justification, reason
         FROM app.data_correction_request WHERE id = ${id} AND status = 'APPROVED' FOR UPDATE SKIP LOCKED`.execute(
      tx,
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      scriptRef: row.script_ref ?? '',
      targetEntity: row.target_entity,
      changeDescription: row.change_description,
      justification: row.justification ?? row.reason ?? '',
    };
  }

  private async attempt(tx: Tx, ctx: RequestContext, id: string): Promise<CorrectionOutcome> {
    const correction = await this.lock(tx, id);
    if (!correction) return { id, tenantId: ctx.principal.tenantId, outcome: 'SKIPPED' };

    const script = this.deps.scripts.get(correction.scriptRef);
    if (!script)
      throw new Error(
        `NO_REGISTERED_SCRIPT: no reviewed script is registered for "${correction.scriptRef}".`,
      );

    const diff = (await script.dryRun(tx, correction)).slice(0, MAX_DIFF_CHARS);
    const dryRunDiffKey = `sha256:${createHash('sha256').update(diff).digest('hex')}`;
    await script.apply(tx, correction);
    await sql`
      UPDATE app.data_correction_request SET status = 'EXECUTED', dry_run_diff_key = ${dryRunDiffKey}, dry_run_diff = ${diff},
             executed_at = ${ctx.now}, executor_identity = ${EXECUTOR_IDENTITY}, lock_version = lock_version + 1
       WHERE id = ${id} AND tenant_id = ${ctx.principal.tenantId}`.execute(tx);
    await this.deps.audit.record(tx, ctx, {
      action: 'data_correction.executed',
      entityType: 'DATA_CORRECTION',
      entityId: id,
      before: { status: 'APPROVED' },
      after: { status: 'EXECUTED', scriptRef: correction.scriptRef, dryRunDiffKey },
      permissionUsed: EXECUTOR_IDENTITY,
    });
    return { id, tenantId: ctx.principal.tenantId, outcome: 'EXECUTED', dryRunDiffKey };
  }
}

function reasonOf(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON_CHARS) || 'The correction failed.';
}

/** Starts the polling loop. Returns a handle to stop it. One run at a time; a failed tick is retried on the next one. */
export function startDataCorrectionExecutor(
  executor: DataCorrectionExecutor,
  opts: {
    intervalMs?: number;
    onOutcome?: (o: CorrectionOutcome) => void;
    onError?: (err: unknown) => void;
  } = {},
): { stop: () => void } {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      for (const outcome of await executor.drain()) opts.onOutcome?.(outcome);
    } catch (err) {
      opts.onError?.(err);
    } finally {
      running = false;
    }
  }, opts.intervalMs ?? 15_000);
  return { stop: () => clearInterval(timer) };
}
