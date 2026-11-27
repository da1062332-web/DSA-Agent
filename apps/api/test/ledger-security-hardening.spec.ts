// Permission audit F-03 (docs/PERMISSION_UI_VISIBILITY_AUDIT.md): manual ledger posting is closed to people, and the ledger audit actions are valid.
// No database: refusals never reach a repository, the in-memory ledger repository backs the service paths.
import type { PermissionCode, RequestContext, Tx } from '@dsa/contracts';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { LedgerSettlementJournalAdapter } from '../src/modules/ledger/adapter';
import { LEDGER_AUDIT_ACTIONS, LedgerService } from '../src/modules/ledger/ledger-service';
import { InMemoryLedgerRepository } from '../src/modules/ledger/repository';
import { createTestApp, fakeAuth, testDeps, testPrincipal } from './support/fake-auth';

const TENANT_A = 'ten_01J00000000000000000000000';
const AUDIT_SHAPE = /^[a-z_]+\.[a-z_]+$/; // the audit_event.action CHECK in migration 0002

const grants = (...codes: PermissionCode[]) =>
  codes.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] as string[] }));

const validJournal = {
  referenceType: 'ADJUSTMENT',
  referenceId: 'audit-probe-1',
  period: '2026-10',
  lines: [
    { accountCode: '1010-SETTLEMENT-BANK', entryType: 'DEBIT', amount: '100.00' },
    { accountCode: '2100-COMMISSION-PAYABLE', entryType: 'CREDIT', amount: '100.00' },
  ],
};

describe('F-03: manual ledger posting is closed to people; audit actions are valid', () => {
  /** An app whose database is a spy: a refused caller must never reach it. */
  const ledgerApp = (principal: ReturnType<typeof testPrincipal>) => {
    const withTenantTx = vi.fn(async () => {
      throw new Error('the database must not be reached');
    });
    const app = createTestApp({
      auth: fakeAuth(principal),
      deps: testDeps({ txRunner: { withTenantTx } as never }),
    });
    return { app, withTenantTx };
  };

  const everyFinancePermission: PermissionCode[] = [
    'finance.view',
    'payout.record_payment',
    'payout.request',
    'payout.approve',
    'adjustment.create',
    'adjustment.approve',
    'invoice.manage',
    'export.run',
    'config.manage',
    'role.manage',
    'user.manage',
  ];

  it('TEST-HARD-LED-01 a person holding every finance permission is refused on POST /v1/ledger/journals, before the database', async () => {
    const { app, withTenantTx } = ledgerApp(
      testPrincipal({ tenantId: TENANT_A, grants: grants(...everyFinancePermission) }),
    );
    const res = await request(app).post('/v1/ledger/journals').send(validJournal);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(withTenantTx).not.toHaveBeenCalled();
  });

  it('TEST-HARD-LED-02 a user with no permissions is refused, and an invalid body does not change the answer (nothing is learned from validation)', async () => {
    const { app, withTenantTx } = ledgerApp(testPrincipal({ tenantId: TENANT_A, grants: [] }));
    const good = await request(app).post('/v1/ledger/journals').send(validJournal);
    const bad = await request(app).post('/v1/ledger/journals').send({ nonsense: true });
    expect([good.status, bad.status]).toEqual([403, 403]);
    expect(withTenantTx).not.toHaveBeenCalled();
  });

  it('TEST-HARD-LED-03 the intended path: a system identity (SERVICE) passes the guard and reaches the posting code', async () => {
    const { app, withTenantTx } = ledgerApp(
      testPrincipal({ kind: 'SERVICE', id: 'SYSTEM:test-poster', tenantId: TENANT_A, grants: [] }),
    );
    const res = await request(app).post('/v1/ledger/journals').send(validJournal);
    expect(res.status).not.toBe(403); // it failed later, in the stubbed database
    expect(withTenantTx).toHaveBeenCalled();
  });

  it('TEST-HARD-LED-04 the read side is unchanged: finance.view passes the permission check, no permission is refused', async () => {
    // The read check runs inside the transaction (before any query), so this app lets the transaction open on an empty handle.
    const readApp = (principal: ReturnType<typeof testPrincipal>) =>
      createTestApp({
        auth: fakeAuth(principal),
        deps: testDeps({
          txRunner: { withTenantTx: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({}) } as never,
        }),
      });
    const none = await request(readApp(testPrincipal({ tenantId: TENANT_A, grants: [] }))).get(
      '/v1/ledger/journals',
    );
    expect(none.status).toBe(403);
    const allowed = await request(
      readApp(testPrincipal({ tenantId: TENANT_A, grants: grants('finance.view') })),
    ).get('/v1/ledger/journals');
    expect(allowed.status).not.toBe(403); // it passed the permission check; the empty handle then fails the query
  });

  it('TEST-HARD-LED-05 the settlement adapter, the real poster, is not affected: it posts in-process as a system identity', async () => {
    const repo = new InMemoryLedgerRepository();
    const service = new LedgerService({ repository: repo });
    const res = await new LedgerSettlementJournalAdapter(service).postSettlementJournal({} as Tx, 'ten_01', {
      payoutId: 'pay_hardening_01',
      currency: 'INR',
      paidOn: new Date('2026-10-15'),
      lines: [
        { accountCode: '2100-COMMISSION-PAYABLE', entryType: 'DEBIT', amount: '10.00' },
        { accountCode: '1010-SETTLEMENT-BANK', entryType: 'CREDIT', amount: '10.00' },
      ],
    });
    expect(res.entryId).toBeDefined();
    expect((await repo.findJournalById({} as Tx, 'ten_01', res.entryId))?.reference_id).toBe(
      'pay_hardening_01',
    );
  });

  it('TEST-HARD-LED-06 assertManualPostingAllowed: SERVICE passes, USER does not, whatever the grants', () => {
    const service = new LedgerService({ repository: new InMemoryLedgerRepository() });
    const ctx = (kind: 'USER' | 'SERVICE', held: PermissionCode[]): RequestContext => ({
      principal: testPrincipal({ kind, grants: grants(...held) }),
      correlationId: 'corr-hard',
      now: new Date(),
    });
    expect(() => service.assertManualPostingAllowed(ctx('SERVICE', []))).not.toThrow();
    expect(() => service.assertManualPostingAllowed(ctx('USER', everyFinancePermission))).toThrow(
      /restricted to system/,
    );
  });

  it('TEST-HARD-LED-07 every ledger audit action has the shape the database accepts, and the three operations record exactly those', async () => {
    for (const action of Object.values(LEDGER_AUDIT_ACTIONS)) expect(action).toMatch(AUDIT_SHAPE);

    const recorded: string[] = [];
    const repo = new InMemoryLedgerRepository();
    const service = new LedgerService({
      repository: repo,
      audit: {
        async record(_tx, _ctx, event) {
          recorded.push(event.action);
          return 'aud_test';
        },
      },
    });
    const ctx = (...held: PermissionCode[]): RequestContext => ({
      principal: testPrincipal({ tenantId: 'ten_01', grants: grants(...held) }),
      correlationId: 'corr-hard-audit',
      now: new Date(),
    });
    await service.postJournal({} as Tx, ctx('finance.view'), {
      referenceType: 'PAYOUT_RECORDING',
      referenceId: 'pay_audit_names',
      period: '2026-08',
      lines: [
        { accountCode: '2100-COMMISSION-PAYABLE', entryType: 'DEBIT', amount: '5.00' },
        { accountCode: '1010-SETTLEMENT-BANK', entryType: 'CREDIT', amount: '5.00' },
      ],
    });
    await service.closePeriod({} as Tx, ctx('finance.period_close' as PermissionCode), '2026-08', {
      note: 'close',
    });
    await service.createExport({} as Tx, ctx('finance.view', 'export.run'), {
      format: 'CSV',
      period: '2026-08',
    });

    expect(recorded).toEqual([
      LEDGER_AUDIT_ACTIONS.journalPosted,
      LEDGER_AUDIT_ACTIONS.periodClosed,
      LEDGER_AUDIT_ACTIONS.exportRun,
    ]);
    for (const action of recorded) expect(action).toMatch(AUDIT_SHAPE);
  });
});
