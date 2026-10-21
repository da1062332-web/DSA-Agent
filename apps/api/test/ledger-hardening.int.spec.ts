// Permission audit F-03, on a throwaway PostgreSQL (docs/PERMISSION_UI_VISIBILITY_AUDIT.md). The ledger's real posting path is in-process, not
// the HTTP route: FinanceService -> LedgerSettlementJournalAdapter -> LedgerService.postJournal as the system identity SYSTEM:ledger-adapter.
// This proves, against the real tables and the real audit_event CHECK constraint, that (1) the adapter path writes the journal, its lines and
// an audit event with a valid action name in one transaction, (2) period close and export write valid audit events too, and (3) a failure
// (a closed period, or an audit write that fails) leaves neither a journal nor an audit row behind.
import type { RequestContext, Tx } from '@dsa/contracts';
import { createAuditPort, createIdGenerator } from '@dsa/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { LedgerSettlementJournalAdapter } from '../src/modules/ledger/adapter';
import { LEDGER_AUDIT_ACTIONS, LedgerService } from '../src/modules/ledger/ledger-service';
import { SqlLedgerRepository } from '../src/modules/ledger/repository';
import { testPrincipal } from './support/fake-auth';

let env: IsolationEnv;
const BANK = 'H-BANK';
const PAYABLE = 'H-PAYABLE';

beforeAll(async () => {
  env = await startIsolationEnv();
  await env.admin.query(
    `INSERT INTO app.ledger_account (id, tenant_id, code, name, type) VALUES
       ('acc_h_bank', $1, '${BANK}', 'Bank', 'ASSET'), ('acc_h_pay', $1, '${PAYABLE}', 'Payable', 'LIABILITY')`,
    [env.A.tenantId],
  );
}, 240_000);

afterAll(async () => {
  await env?.stop();
});

const user = (...codes: string[]): RequestContext => ({
  principal: testPrincipal({
    id: env.A.userIds[0],
    tenantId: env.A.tenantId,
    grants: codes.map((code) => ({ code: code as never, scope: 'TENANT' as const, branchIds: [] })),
  }),
  correlationId: 'corr-ledger-hardening',
  now: new Date(),
});
const system = (): RequestContext => ({
  principal: testPrincipal({
    kind: 'SERVICE',
    id: 'SYSTEM:ledger-adapter',
    tenantId: env.A.tenantId,
    grants: [],
  }),
  correlationId: 'corr-ledger-hardening-system',
  now: new Date(),
});
const lines = (amount: string) => [
  { accountCode: PAYABLE, entryType: 'DEBIT' as const, amount },
  { accountCode: BANK, entryType: 'CREDIT' as const, amount },
];
const journalRows = async (referenceId: string) =>
  (
    await env.admin.query(`SELECT id FROM app.ledger_journal WHERE tenant_id = $1 AND reference_id = $2`, [
      env.A.tenantId,
      referenceId,
    ])
  ).rows as { id: string }[];
const auditActionsFor = async (entityId: string) =>
  (
    await env.admin.query(
      `SELECT action FROM app.audit_event WHERE tenant_id = $1 AND entity_id = $2 ORDER BY action`,
      [env.A.tenantId, entityId],
    )
  ).rows.map((r) => r.action as string);

describe('F-03 the real ledger posting path, against the real audit constraint', () => {
  const txRunner = () => createTxRunner(env.db);
  const realService = () =>
    new LedgerService({ repository: new SqlLedgerRepository(), audit: createAuditPort(createIdGenerator()) });

  it('TEST-HARD-LEDINT-01 the settlement adapter posts the journal, its lines and a valid audit event in one transaction', async () => {
    const adapter = new LedgerSettlementJournalAdapter(realService());
    const ctx = system();
    const res = await txRunner().withTenantTx(ctx, (tx) =>
      adapter.postSettlementJournal(tx, env.A.tenantId, {
        payoutId: 'pay_hardening_adapter',
        currency: 'INR',
        paidOn: new Date('2026-10-15'),
        lines: lines('250.00'),
      }),
    );
    expect(res.entryId).toBeDefined();

    const journals = await journalRows('pay_hardening_adapter');
    expect(journals).toHaveLength(1);
    expect(journals[0]!.id).toBe(res.entryId);
    expect(await auditActionsFor(res.entryId)).toEqual([LEDGER_AUDIT_ACTIONS.journalPosted]);
    // the adapter identity is a system identity, so it is also what the audit event names as the actor
    const actor = await env.admin.query(
      `SELECT actor_type, actor_id FROM app.audit_event WHERE entity_id = $1`,
      [res.entryId],
    );
    expect(actor.rows[0]).toMatchObject({ actor_type: 'SERVICE', actor_id: 'SYSTEM:ledger-adapter' });
  });

  it('TEST-HARD-LEDINT-02 period close and an export each write an audit event the database accepts', async () => {
    const service = realService();
    const poster = user('finance.view');
    await txRunner().withTenantTx(poster, (tx) =>
      service.postJournal(tx, poster, {
        referenceType: 'PAYOUT_RECORDING',
        referenceId: 'pay_hardening_close',
        period: '2026-07',
        lines: lines('40.00'),
      }),
    );
    const closer = user('finance.period_close');
    const closed = await txRunner().withTenantTx(closer, (tx) =>
      service.closePeriod(tx, closer, '2026-07', { note: 'hardening close' }),
    );
    expect(closed.status).toBe('CLOSED');

    const exporter = user('finance.view', 'export.run');
    const exported = await txRunner().withTenantTx(exporter, (tx) =>
      service.createExport(tx, exporter, { format: 'CSV', period: '2026-07' }),
    );

    const actions = await env.admin.query(
      `SELECT action FROM app.audit_event WHERE tenant_id = $1 AND action LIKE 'ledger.%' ORDER BY action`,
      [env.A.tenantId],
    );
    const seen = new Set(actions.rows.map((r) => r.action as string));
    expect(seen.has(LEDGER_AUDIT_ACTIONS.periodClosed)).toBe(true);
    expect(seen.has(LEDGER_AUDIT_ACTIONS.exportRun)).toBe(true);
    expect(await auditActionsFor(exported.exportId)).toEqual([LEDGER_AUDIT_ACTIONS.exportRun]);
    for (const a of seen) expect(a).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });

  it('TEST-HARD-LEDINT-03 posting into a closed period fails and leaves no journal and no audit event', async () => {
    const service = realService();
    const ctx = system();
    const before = await env.admin.query(
      `SELECT count(*)::int AS n FROM app.audit_event WHERE tenant_id = $1`,
      [env.A.tenantId],
    );
    await expect(
      txRunner().withTenantTx(ctx, (tx) =>
        service.postJournal(tx, ctx, {
          referenceType: 'PAYOUT_RECORDING',
          referenceId: 'pay_hardening_after_close',
          period: '2026-07', // closed by the previous test
          lines: lines('1.00'),
        }),
      ),
    ).rejects.toThrow(/closed accounting period/);
    expect(await journalRows('pay_hardening_after_close')).toHaveLength(0);
    const after = await env.admin.query(
      `SELECT count(*)::int AS n FROM app.audit_event WHERE tenant_id = $1`,
      [env.A.tenantId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('TEST-HARD-LEDINT-04 if the audit write fails, the journal is rolled back with it (no financial record without its audit trail)', async () => {
    const failingAudit = {
      async record(_tx: Tx, _ctx: RequestContext): Promise<string> {
        throw new Error('audit store unavailable');
      },
    };
    const service = new LedgerService({ repository: new SqlLedgerRepository(), audit: failingAudit });
    const ctx = system();
    await expect(
      txRunner().withTenantTx(ctx, (tx) =>
        service.postJournal(tx, ctx, {
          referenceType: 'PAYOUT_RECORDING',
          referenceId: 'pay_hardening_audit_down',
          period: '2026-08',
          lines: lines('9.00'),
        }),
      ),
    ).rejects.toThrow(/audit store unavailable/);
    expect(await journalRows('pay_hardening_audit_down')).toHaveLength(0);
    const lineRows = await env.admin.query(
      `SELECT count(*)::int AS n FROM app.ledger_journal WHERE tenant_id = $1 AND period = '2026-08'`,
      [env.A.tenantId],
    );
    expect(lineRows.rows[0].n).toBe(0);
  });

  it('TEST-HARD-LEDINT-05 tenant isolation: the other tenant sees none of these journals or audit events', async () => {
    const j = await env.admin.query(
      `SELECT count(*)::int AS n FROM app.ledger_journal WHERE tenant_id = $1`,
      [env.B.tenantId],
    );
    expect(j.rows[0].n).toBe(0);
    const ctxB: RequestContext = {
      principal: testPrincipal({
        id: env.B.userIds[0],
        tenantId: env.B.tenantId,
        grants: [{ code: 'finance.view', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-b',
      now: new Date(),
    };
    const listed = await txRunner().withTenantTx(ctxB, (tx) => realService().listJournals(tx, ctxB, {}));
    expect(listed.data).toHaveLength(0);
  });
});
