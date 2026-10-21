// Permission audit F-03 and F-04 (docs/PERMISSION_UI_VISIBILITY_AUDIT.md): manual ledger posting is closed to people, the ledger audit
// actions are valid, and a security event filed over HTTP cannot carry forged principal, address, type or severity.
// No database: refusals never reach a repository, the in-memory ledger repository backs the service paths.
import { SECURITY_EVENT_TYPES, type PermissionCode, type RequestContext, type Tx } from '@dsa/contracts';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LedgerSettlementJournalAdapter } from '../src/modules/ledger/adapter';
import { LEDGER_AUDIT_ACTIONS, LedgerService } from '../src/modules/ledger/ledger-service';
import { InMemoryLedgerRepository } from '../src/modules/ledger/repository';
import { REPORTABLE_EVENT_TYPES } from '../src/modules/security/report-policy';
import { SecurityService } from '../src/modules/security/service';
import { createTestApp, fakeAuth, testDeps, testPrincipal } from './support/fake-auth';
import { createMockSecurityStore } from './support/mock-security-db';

const TENANT_A = 'ten_01J00000000000000000000000';
const TENANT_B = 'ten_01J99999999999999999999999';
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

describe('F-04: a security event filed over HTTP cannot forge who, where, what or how serious', () => {
  let store: ReturnType<typeof createMockSecurityStore>;
  beforeEach(() => {
    store = createMockSecurityStore();
  });

  const reporter = testPrincipal({
    tenantId: TENANT_A,
    id: 'usr_reporter_01',
    grants: grants('security.incident'),
  });
  const appFor = (principal?: ReturnType<typeof testPrincipal>) =>
    createTestApp({
      auth: principal ? fakeAuth(principal) : undefined,
      deps: testDeps({ txRunner: store.txRunner }),
    });

  const forged = {
    type: 'SUSPICIOUS_ACCESS',
    principal: 'usr_victim_99',
    ip: '10.9.9.9',
    severity: 'CRITICAL',
    details: {
      note: 'looks odd',
      reportedBy: 'usr_someone_else',
      reporterKind: 'SERVICE',
      source: 'SIEM',
      claimed: 'overwritten?',
      password: 'Sup3rSecret!',
    },
  };

  it('TEST-HARD-SEC-01 no permission, or a permission of another kind, cannot file an event; nothing is stored', async () => {
    for (const p of [
      testPrincipal({ tenantId: TENANT_A, grants: [] }),
      testPrincipal({ tenantId: TENANT_A, grants: grants('lead.read', 'finance.view', 'config.manage') }),
    ]) {
      const res = await request(appFor(p)).post('/v1/security/events').send(forged);
      expect(res.status).toBe(403);
    }
    expect((await request(appFor()).post('/v1/security/events').send(forged)).status).toBe(401);
    expect(store.securityEvents).toHaveLength(0);
  });

  it('TEST-HARD-SEC-02 principal, address and severity come from the server; what the caller claimed is kept as a claim', async () => {
    const res = await request(appFor(reporter)).post('/v1/security/events').send(forged);
    expect(res.status).toBe(201);

    expect(res.body.principal).toBe('usr_reporter_01'); // not usr_victim_99
    expect(res.body.ip).not.toBe('10.9.9.9');
    expect(res.body.ip).toMatch(/127\.0\.0\.1|::1/); // the address supertest connected from
    expect(res.body.severity).toBe('MEDIUM'); // not CRITICAL
    expect(res.body.tenantId).toBe(TENANT_A);

    expect(res.body.details.claimed).toEqual({
      principal: 'usr_victim_99',
      ip: '10.9.9.9',
      severity: 'CRITICAL',
    });
    // the caller's own look-alike keys are overwritten by the server's
    expect(res.body.details.reportedBy).toBe('usr_reporter_01');
    expect(res.body.details.reporterKind).toBe('USER');
    expect(res.body.details.source).toBe('API_REPORT');
    expect(res.body.details.note).toBe('looks odd');
    expect(res.body.details.password).toBe('[REDACTED]');

    const stored = store.securityEvents.find((e) => e.id === res.body.id)!;
    expect(stored.principal).toBe('usr_reporter_01');
    expect(stored.severity).toBe('MEDIUM');
  });

  it('TEST-HARD-SEC-03 only reportable types are accepted: every type the system detects itself is refused with NOT_REPORTABLE', async () => {
    const system = SECURITY_EVENT_TYPES.filter(
      (t) => !(REPORTABLE_EVENT_TYPES as readonly string[]).includes(t),
    );
    expect(system.length).toBeGreaterThan(0);
    for (const type of system) {
      const res = await request(appFor(reporter))
        .post('/v1/security/events')
        .send({ ...forged, type });
      expect(res.status, type).toBe(422);
      expect(res.body.error.details[0]).toMatchObject({ field: 'type', issue: 'NOT_REPORTABLE' });
    }
    expect(store.securityEvents).toHaveLength(0);
  });

  it('TEST-HARD-SEC-04 principal, ip and severity are optional now, but an unknown type, a missing type and a bad severity are still 422', async () => {
    const ok = await request(appFor(reporter))
      .post('/v1/security/events')
      .send({ type: 'SUSPICIOUS_ACCESS', details: { geoMismatch: true } });
    expect(ok.status).toBe(201);
    expect(ok.body.details.claimed).toEqual({ principal: null, ip: null, severity: null });

    for (const body of [
      { type: 'NOT_A_TYPE' },
      { details: {} },
      { type: 'SUSPICIOUS_ACCESS', severity: 'SUPER_URGENT' },
    ]) {
      expect((await request(appFor(reporter)).post('/v1/security/events').send(body)).status).toBe(422);
    }
  });

  it('TEST-HARD-SEC-05 oversized details are refused, and an oversized claim is clipped', async () => {
    const big = await request(appFor(reporter))
      .post('/v1/security/events')
      .send({ type: 'SUSPICIOUS_ACCESS', details: { blob: 'x'.repeat(20_000) } });
    expect(big.status).toBe(422);
    expect(big.body.error.details[0]).toMatchObject({ field: 'details', issue: 'TOO_LARGE' });

    const clipped = await request(appFor(reporter))
      .post('/v1/security/events')
      .send({ type: 'SUSPICIOUS_ACCESS', principal: 'p'.repeat(128) });
    expect(clipped.status).toBe(201);
    expect(clipped.body.details.claimed.principal).toHaveLength(128);
  });

  it('TEST-HARD-SEC-06 the tenant is the caller’s, whatever the body says; another tenant cannot read the event', async () => {
    const res = await request(appFor(reporter))
      .post('/v1/security/events')
      .send({ ...forged, tenantId: TENANT_B });
    expect(res.status).toBe(201);
    expect(res.body.tenantId).toBe(TENANT_A);

    const other = testPrincipal({ tenantId: TENANT_B, id: 'usr_b', grants: grants('security.incident') });
    const list = await request(appFor(other)).get('/v1/security/events');
    expect(list.status).toBe(200);
    expect(list.body.data.some((e: { id: string }) => e.id === res.body.id)).toBe(false);
  });

  it('TEST-HARD-SEC-07 a reported event never raises the critical alert or reaches high severity, even when it claims CRITICAL', async () => {
    const alerted: string[] = [];
    const service = new SecurityService(testDeps({ txRunner: store.txRunner }), {
      onSecurityAlert: (e) => {
        alerted.push(e.id);
      },
    });
    const ctx = {
      principal: reporter,
      correlationId: 'corr-hard-sec',
      now: new Date(),
      ip: '198.51.100.7',
    } as RequestContext;
    const event = await service.reportSecurityEvent(ctx, {
      type: 'SUSPICIOUS_ACCESS',
      severity: 'CRITICAL',
      ip: '1.2.3.4',
    });
    expect(event.severity).toBe('MEDIUM');
    expect(event.ip).toBe('198.51.100.7');
    expect(alerted).toEqual([]);
  });

  it('TEST-HARD-SEC-08 the trusted in-process recorder still stores what the system detected, and still alerts', async () => {
    const alerted: string[] = [];
    const service = new SecurityService(testDeps({ txRunner: store.txRunner }), {
      onSecurityAlert: (e) => {
        alerted.push(e.id);
      },
    });
    const ctx = { principal: reporter, correlationId: 'corr-hard-sec-2', now: new Date() } as RequestContext;
    const event = await service.recordSecurityEvent(ctx, {
      type: 'INTEGRITY_VIOLATION',
      principal: 'SYSTEM:audit-chain',
      ip: '10.0.0.5',
      severity: 'CRITICAL',
      details: { token: 'abc' },
    });
    expect(event).toMatchObject({
      type: 'INTEGRITY_VIOLATION',
      principal: 'SYSTEM:audit-chain',
      ip: '10.0.0.5',
      severity: 'CRITICAL',
    });
    expect(event.details.token).toBe('[REDACTED]');
    expect(alerted).toEqual([event.id]);
  });

  it('TEST-HARD-SEC-09 every event type, including the ones HTTP refuses, is still recordable by trusted server code with the metadata it detected', async () => {
    const service = new SecurityService(testDeps({ txRunner: store.txRunner }));
    const ctx = { principal: reporter, correlationId: 'corr-hard-sec-3', now: new Date() } as RequestContext;
    for (const type of SECURITY_EVENT_TYPES) {
      const event = await service.recordSecurityEvent(ctx, {
        type,
        principal: `SYSTEM:detector-${type}`,
        ip: '10.0.0.9',
        severity: 'LOW',
        details: {},
      });
      expect(event).toMatchObject({
        type,
        principal: `SYSTEM:detector-${type}`,
        ip: '10.0.0.9',
        severity: 'LOW',
      });
    }
    expect(store.securityEvents).toHaveLength(SECURITY_EVENT_TYPES.length);
  });
});
