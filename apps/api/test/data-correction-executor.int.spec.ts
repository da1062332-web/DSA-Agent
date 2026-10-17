// The data-correction executor (migration 0062; owner: Dev 1; Module 40, SUB-ADM.07). Real database, the real application role, synthetic data only.
// It carries out APPROVED corrections with reviewed scripts, once, audited, undoing everything if a script fails, and never outside the
// correction's own tenant. Nothing here runs against hosted: the executor is also off unless DATA_CORRECTION_EXECUTOR=true.
import { createHash } from 'node:crypto';
import { createAuditPort, createIdGenerator } from '@dsa/kernel';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import {
  DataCorrectionExecutor,
  EXECUTOR_DISCOVERY_TENANT,
  EXECUTOR_IDENTITY,
  type CorrectionScript,
} from '../src/modules/platform-admin/data-correction-executor';
import { registeredCorrectionScripts } from '../src/modules/platform-admin/correction-scripts';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
let seq = 0;
const calls: string[] = [];

/** Renames the branch named by targetEntity to the text after "to:" in changeDescription. Reads in the dry run, writes in apply. */
const renameBranch: CorrectionScript = {
  async dryRun(tx, c) {
    calls.push(`dryRun:${c.id}`);
    const r = await (
      tx as unknown as { query: (s: string, p: unknown[]) => Promise<{ rows: Array<{ name: string }> }> }
    ).query('select name from app.branch where id = $1', [c.targetEntity]);
    return `branch ${c.targetEntity}: "${r.rows[0]?.name}" -> "${newName(c)}"`;
  },
  async apply(tx, c) {
    calls.push(`apply:${c.id}`);
    await (tx as unknown as { query: (s: string, p: unknown[]) => Promise<unknown> }).query(
      'update app.branch set name = $1 where id = $2',
      [newName(c), c.targetEntity],
    );
  },
};
const newName = (c: { changeDescription: string | null }) =>
  (c.changeDescription ?? '').split('to:')[1]!.trim();

/** Changes the branch, then fails: the change must not survive. */
const failsAfterWriting: CorrectionScript = {
  async dryRun() {
    return 'dry run is fine';
  },
  async apply(tx, c) {
    await (tx as unknown as { query: (s: string, p: unknown[]) => Promise<unknown> }).query(
      `update app.branch set name = 'HALF-APPLIED' where id = $1`,
      [c.targetEntity],
    );
    throw new Error('simulated failure after a write');
  },
};

/** Tries to rename a branch of the OTHER tenant: row-level security must make that a no-op. */
const reachesAcross: CorrectionScript = {
  async dryRun() {
    return 'tries another tenant';
  },
  async apply(tx, c) {
    await (tx as unknown as { query: (s: string, p: unknown[]) => Promise<unknown> }).query(
      `update app.branch set name = 'TAKEN-OVER' where id = $1`,
      [c.targetEntity],
    );
  },
};

const scripts = new Map<string, CorrectionScript>([
  ['SCR-TEST-RENAME', renameBranch],
  ['SCR-TEST-FAIL', failsAfterWriting],
  ['SCR-TEST-ACROSS', reachesAcross],
]);

function executor() {
  const ids = createIdGenerator();
  return new DataCorrectionExecutor({
    txRunner: createTxRunner(env.db),
    audit: createAuditPort(ids),
    scripts,
  });
}

beforeAll(async () => {
  env = await startIsolationEnv();
}, 180_000);
afterAll(async () => {
  await env?.stop();
});

async function newCorrection(opts: {
  tenant: IsolationEnv['A'];
  status?: string;
  scriptRef?: string;
  target?: string;
  change?: string;
}): Promise<string> {
  const id = `dcr_exec_${Date.now()}_${seq++}`;
  const status = opts.status ?? 'APPROVED';
  await env.admin.query(
    `INSERT INTO app.data_correction_request (id, tenant_id, requested_by, approved_by, approved_at, justification, script_ref, target_entity, change_description, status, failure_reason, created_by)
     VALUES ($1, $2, $3, $4, now(), 'Synthetic justification for the test', $5, $6, $7, $8, $9, $3)`,
    [
      id,
      opts.tenant.tenantId,
      opts.tenant.userIds[0],
      opts.tenant.userIds[1],
      opts.scriptRef ?? 'SCR-TEST-RENAME',
      opts.target ?? opts.tenant.branchId,
      opts.change ?? 'rename to: Renamed by correction',
      status,
      status === 'FAILED' ? 'earlier failure' : null,
    ],
  );
  return id;
}

const row = async (id: string) =>
  (await env.admin.query(`SELECT * FROM app.data_correction_request WHERE id = $1`, [id])).rows[0];
const branchName = async (id: string) =>
  (await env.admin.query(`SELECT name FROM app.branch WHERE id = $1`, [id])).rows[0].name as string;
const auditRows = async (action: string, id: string) =>
  (
    await env.admin.query(
      `SELECT actor_id, actor_type, tenant_id, before, after FROM app.audit_event WHERE action = $1 AND entity_id = $2 ORDER BY seq`,
      [action, id],
    )
  ).rows;

describe('carrying out an approved correction', () => {
  it('TEST-EXEC-01 an approved correction is executed by its reviewed script, with the dry-run diff, a hash of it, and an audit event by the executor', async () => {
    const before = await branchName(env.A.branchId);
    const id = await newCorrection({ tenant: env.A, change: 'rename to: Corrected Branch Name' });

    const outcomes = await executor().drain();
    const mine = outcomes.find((o) => o.id === id);
    expect(mine?.outcome).toBe('EXECUTED');

    expect(await branchName(env.A.branchId)).toBe('Corrected Branch Name');
    const stored = await row(id);
    expect(stored.status).toBe('EXECUTED');
    expect(stored.executed_at).not.toBeNull();
    expect(stored.executor_identity).toBe(EXECUTOR_IDENTITY);
    expect(stored.dry_run_diff).toBe(`branch ${env.A.branchId}: "${before}" -> "Corrected Branch Name"`);
    expect(stored.dry_run_diff_key).toBe(
      `sha256:${createHash('sha256').update(stored.dry_run_diff).digest('hex')}`,
    );

    const [event] = await auditRows('data_correction.executed', id);
    expect(event).toMatchObject({
      actor_id: EXECUTOR_IDENTITY,
      actor_type: 'SERVICE',
      tenant_id: env.A.tenantId,
    });
    expect(event!.after).toMatchObject({
      status: 'EXECUTED',
      scriptRef: 'SCR-TEST-RENAME',
      dryRunDiffKey: stored.dry_run_diff_key,
    });
  });

  it('TEST-EXEC-02 running it again changes nothing: the script does not run twice and no second audit event is written', async () => {
    const id = await newCorrection({ tenant: env.A, change: 'rename to: Once Only' });
    const ex = executor();
    await ex.drain();
    const callsAfterFirst = calls.filter((c) => c.endsWith(id)).length;
    expect(callsAfterFirst).toBe(2); // one dry run, one apply

    expect((await ex.drain()).some((o) => o.id === id)).toBe(false);
    expect(await ex.runOne(env.A.tenantId, id)).toMatchObject({ outcome: 'SKIPPED' });
    expect(calls.filter((c) => c.endsWith(id)).length).toBe(2);
    expect(await auditRows('data_correction.executed', id)).toHaveLength(1);
  });

  it('TEST-EXEC-03 only APPROVED corrections are touched: pending, rejected, executed and failed ones are left alone', async () => {
    const ids = await Promise.all(
      ['PENDING', 'REJECTED', 'EXECUTED', 'FAILED'].map((status) =>
        newCorrection({ tenant: env.A, status, change: 'rename to: Must Not Happen' }),
      ),
    );
    const outcomes = await executor().drain();
    for (const id of ids) {
      expect(
        outcomes.some((o) => o.id === id),
        id,
      ).toBe(false);
      expect(
        calls.some((c) => c.endsWith(id)),
        id,
      ).toBe(false);
    }
    expect(await branchName(env.A.branchId)).not.toBe('Must Not Happen');
    expect((await Promise.all(ids.map(row))).map((r) => r.status)).toEqual([
      'PENDING',
      'REJECTED',
      'EXECUTED',
      'FAILED',
    ]);
  });
});

describe('when a correction cannot be carried out', () => {
  it('TEST-EXEC-04 a script that fails after writing leaves no trace of its write: the correction is FAILED with the reason, audited, and not retried', async () => {
    const name = await branchName(env.A.branchId);
    const id = await newCorrection({ tenant: env.A, scriptRef: 'SCR-TEST-FAIL' });
    const outcomes = await executor().drain();
    expect(outcomes.find((o) => o.id === id)).toMatchObject({
      outcome: 'FAILED',
      reason: 'simulated failure after a write',
    });

    expect(await branchName(env.A.branchId)).toBe(name); // the half-applied change was rolled back
    const stored = await row(id);
    expect(stored).toMatchObject({
      status: 'FAILED',
      failure_reason: 'simulated failure after a write',
      dry_run_diff: null,
      dry_run_diff_key: null,
    });
    const [event] = await auditRows('data_correction.failed', id);
    expect(event!.after).toMatchObject({ status: 'FAILED', reason: 'simulated failure after a write' });
    expect(await auditRows('data_correction.executed', id)).toHaveLength(0);

    expect((await executor().drain()).some((o) => o.id === id)).toBe(false); // FAILED is final: a new request is needed
  });

  it('TEST-EXEC-05 a correction naming a script nobody has reviewed is FAILED and changes nothing', async () => {
    const name = await branchName(env.A.branchId);
    const id = await newCorrection({
      tenant: env.A,
      scriptRef: 'SCR-NOT-REVIEWED',
      change: 'rename to: Free Text Wins',
    });
    const outcome = (await executor().drain()).find((o) => o.id === id);
    expect(outcome).toMatchObject({ outcome: 'FAILED' });
    expect((outcome as { reason: string }).reason).toContain('NO_REGISTERED_SCRIPT');
    expect(await branchName(env.A.branchId)).toBe(name);
    expect((await row(id)).status).toBe('FAILED');
  });

  it('TEST-EXEC-06 the real registry is empty, so with the production script list every approved correction would fail safe rather than change data', () => {
    expect(registeredCorrectionScripts.size).toBe(0);
  });

  it('TEST-EXEC-07 the database will not store FAILED without a reason', async () => {
    const id = await newCorrection({ tenant: env.A, status: 'PENDING' });
    await expect(
      env.admin.query(`UPDATE app.data_correction_request SET status = 'FAILED' WHERE id = $1`, [id]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('tenants stay apart', () => {
  it('TEST-EXEC-08 a script runs in the correction own tenant: it cannot change another tenant branch', async () => {
    const bName = await branchName(env.B.branchId);
    const id = await newCorrection({ tenant: env.A, scriptRef: 'SCR-TEST-ACROSS', target: env.B.branchId });
    const outcome = (await executor().drain()).find((o) => o.id === id);
    expect(outcome?.outcome).toBe('EXECUTED'); // the script ran, and row-level security made its write a no-op
    expect(await branchName(env.B.branchId)).toBe(bName);
  });

  it('TEST-EXEC-09 corrections of two tenants are each executed in their own tenant, with their own audit events', async () => {
    const a = await newCorrection({ tenant: env.A, change: 'rename to: A renamed' });
    const b = await newCorrection({ tenant: env.B, change: 'rename to: B renamed' });
    await executor().drain();
    expect(await branchName(env.A.branchId)).toBe('A renamed');
    expect(await branchName(env.B.branchId)).toBe('B renamed');
    expect((await auditRows('data_correction.executed', a))[0]!.tenant_id).toBe(env.A.tenantId);
    expect((await auditRows('data_correction.executed', b))[0]!.tenant_id).toBe(env.B.tenantId);
  });
});

describe('who may ask which corrections are waiting', () => {
  async function asApiRole<T>(tenant: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
    const c = new pg.Client({
      host: env.admin.host,
      port: env.admin.port,
      database: env.admin.database,
      user: 'dsa_api',
      password: 'isolation',
    });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
      return await fn(c);
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      await c.end();
    }
  }

  it('TEST-EXEC-10 only the executor context can list waiting corrections, and it gets ids only; a customer session and a session with no tenant are refused', async () => {
    const id = await newCorrection({ tenant: env.A, status: 'APPROVED', scriptRef: 'SCR-TEST-RENAME' });
    await asApiRole(EXECUTOR_DISCOVERY_TENANT, async (c) => {
      const r = await c.query(`SELECT * FROM app.approved_data_corrections(100)`);
      expect(Object.keys(r.rows[0]).sort()).toEqual(['id', 'tenant_id']);
      expect(r.rows.map((x) => x.id)).toContain(id);
    });
    await asApiRole(env.A.tenantId, async (c) => {
      await expect(c.query(`SELECT * FROM app.approved_data_corrections()`)).rejects.toMatchObject({
        code: '42501',
      });
    });
    const c = new pg.Client({
      host: env.admin.host,
      port: env.admin.port,
      database: env.admin.database,
      user: 'dsa_api',
      password: 'isolation',
    });
    await c.connect();
    try {
      await expect(c.query(`SELECT * FROM app.approved_data_corrections()`)).rejects.toMatchObject({
        code: '42501',
      }); // no tenant at all
    } finally {
      await c.end();
    }
  });

  it('TEST-EXEC-11 it is off unless DATA_CORRECTION_EXECUTOR=true', () => {
    const base = {
      DATABASE_URL: 'postgresql://dsa_api:x@localhost:5432/postgres',
      SUPABASE_URL: 'http://127.0.0.1:54321',
      LOG_LEVEL: 'silent',
    };
    expect(loadConfig(base).DATA_CORRECTION_EXECUTOR).toBe(false);
    expect(loadConfig({ ...base, DATA_CORRECTION_EXECUTOR: 'false' }).DATA_CORRECTION_EXECUTOR).toBe(false);
    expect(loadConfig({ ...base, DATA_CORRECTION_EXECUTOR: 'true' }).DATA_CORRECTION_EXECUTOR).toBe(true);
  });
});
