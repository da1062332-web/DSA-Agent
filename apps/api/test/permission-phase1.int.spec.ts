// Permission audit, phase 1 (docs/PERMISSION_UI_VISIBILITY_AUDIT.md, findings F-01 to F-04). Owner: Platform squad.
// The full app and the real routes run against one throwaway PostgreSQL as the API role (NOBYPASSRLS). For each endpoint that used to answer
// any signed-in user: a user with NO permissions, a sales user, and an unrelated role are refused (403, before any lookup), and a role that
// should have access still gets through. Role grant sets are the live grants of tenant qloax-dsa as read from hosted on 2026-10-19.
import type { PermissionCode, RequestContext } from '@dsa/contracts';
import { createAuditPort, createIdGenerator } from '@dsa/kernel';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { LEDGER_AUDIT_ACTIONS, LedgerService } from '../src/modules/ledger/ledger-service';
import { SqlLedgerRepository } from '../src/modules/ledger/repository';
import { testPrincipal } from './support/fake-auth';

const P = (...c: string[]) => c as PermissionCode[];
const NONE = P();
const SALES_EXEC = P('activity.create', 'consent.record', 'customer.read', 'lead.create', 'lead.qualify', 'lead.read', 'lead.update', 'message.send', 'task.read', 'task.update');
const RM = P('activity.create', 'application.cancel', 'application.create', 'application.read', 'application.update', 'consent.record', 'customer.create', 'customer.read', 'customer.update', 'lead.create', 'lead.qualify', 'lead.read', 'lead.update', 'message.send', 'task.create', 'task.read', 'task.update', 'verification.read');
const FINANCE_EXEC = P('adjustment.create', 'finance.dispute', 'finance.reconcile', 'finance.view', 'invoice.manage');
const COMMISSION_APPROVER = P('adjustment.approve', 'finance.view', 'payout.approve', 'payout.record_payment');
const LOAN_OPS = P('application.read', 'application.review', 'application.update', 'disbursement.exception_approve', 'disbursement.record', 'disbursement.verify', 'document.review', 'lender_case.submit', 'sanction.record', 'verification.read');
const COMPLIANCE = P('application.read', 'audit.export_evidence', 'audit.read', 'customer.read', 'lead.read', 'security.incident', 'security.vuln', 'verification.read');

let env: IsolationEnv;
const as = (tenant: 'A' | 'B', codes: PermissionCode[]) => env.appAs(tenant === 'A' ? env.A : env.B, codes);
const idem = () => 'p1-' + Math.random().toString(36).slice(2, 12);

beforeAll(async () => {
  env = await startIsolationEnv();
  await env.admin.query(
    `INSERT INTO app.ledger_account (id, tenant_id, code, name, type) VALUES
       ('acc_p1_bank', $1, '1010-P1-BANK', 'Bank', 'ASSET'), ('acc_p1_pay', $1, '2100-P1-PAYABLE', 'Payable', 'LIABILITY')`,
    [env.A.tenantId],
  );
}, 240_000);

afterAll(async () => {
  await env?.stop();
});

const refused = (status: number) => expect(status).toBe(403);
const passedGate = (status: number) => expect([200, 201, 404, 409, 422]).toContain(status); // anything but 403 and 5xx

describe('F-01 commission reads need finance.view or a commission plan permission', () => {
  const reads = [
    '/v1/commission-plans',
    '/v1/commission-plans/cpl_missing',
    '/v1/commission-calculations',
    '/v1/commission-calculations/ccal_missing',
    '/v1/commission-payables',
  ];

  it('TEST-P1-F01-01 a user with no permissions and a sales user are refused on every read, including an unknown id (403, not 404)', async () => {
    for (const codes of [NONE, SALES_EXEC, RM, COMPLIANCE, LOAN_OPS]) {
      for (const path of reads) refused((await request(as('A', codes)).get(path)).status);
    }
  });

  it('TEST-P1-F01-02 finance.view (finance executive, commission approver) is allowed through on every read', async () => {
    for (const codes of [FINANCE_EXEC, COMMISSION_APPROVER]) {
      for (const path of reads) passedGate((await request(as('A', codes)).get(path)).status);
    }
  });

  it('TEST-P1-F01-03 commission.plan.edit or commission.plan.approve alone opens the plan list (the Commission screen shows for them)', async () => {
    for (const code of ['commission.plan.edit', 'commission.plan.approve'] as const) {
      passedGate((await request(as('A', P(code))).get('/v1/commission-plans')).status);
    }
  });
});

describe('F-02 sanction and disbursement reads need a sanction or disbursement permission', () => {
  const reads = [
    '/v1/sanctions',
    '/v1/sanctions/san_missing',
    '/v1/sanctions/san_missing/tranches',
    '/v1/tranches/trn_missing',
    '/v1/disbursements',
    '/v1/lender-cases/lcs_missing/sanctions',
  ];

  it('TEST-P1-F02-01 no permissions, sales, RM, compliance and finance are refused on every read, including unknown ids (403, not 404)', async () => {
    for (const codes of [NONE, SALES_EXEC, RM, COMPLIANCE, FINANCE_EXEC]) {
      for (const path of reads) refused((await request(as('A', codes)).get(path)).status);
    }
  });

  it('TEST-P1-F02-02 application.read alone is not enough (decision D-02 would widen it)', async () => {
    for (const path of reads) refused((await request(as('A', P('application.read'))).get(path)).status);
  });

  it('TEST-P1-F02-03 loan operations (sanction.record, disbursement.*) and each sanction or disbursement permission on its own are allowed through', async () => {
    for (const codes of [LOAN_OPS, P('sanction.record'), P('disbursement.record'), P('disbursement.verify')]) {
      for (const path of reads) passedGate((await request(as('A', codes)).get(path)).status);
    }
  });
});

describe('F-03 manual ledger posting is closed to human sessions; the ledger audit actions are valid', () => {
  const body = () => ({
    referenceType: 'MANUAL',
    referenceId: 'p1-manual-1',
    period: '2026-10',
    lines: [
      { accountCode: '1010-P1-BANK', entryType: 'DEBIT', amount: '100.00' },
      { accountCode: '2100-P1-PAYABLE', entryType: 'CREDIT', amount: '100.00' },
    ],
  });

  it('TEST-P1-F03-01 no permissions, sales, finance executive, commission approver, and a user holding every ledger permission are all refused, and nothing is written', async () => {
    const everyLedgerPermission = P('finance.view', 'finance.period_close', 'export.run', 'adjustment.create', 'adjustment.approve', 'payout.record_payment', 'invoice.manage');
    for (const codes of [NONE, SALES_EXEC, FINANCE_EXEC, COMMISSION_APPROVER, everyLedgerPermission]) {
      const res = await request(as('A', codes)).post('/v1/ledger/journals').set('Idempotency-Key', idem()).send(body());
      refused(res.status);
    }
    // refused before the body is read: an empty body gets 403, not a validation message
    refused((await request(as('A', NONE)).post('/v1/ledger/journals').set('Idempotency-Key', idem()).send({})).status);
    const rows = await env.admin.query(`SELECT count(*)::int AS n FROM app.ledger_journal WHERE tenant_id = $1 AND reference_id = 'p1-manual-1'`, [env.A.tenantId]);
    expect(rows.rows[0].n).toBe(0);
  });

  it('TEST-P1-F03-02 the reads of the same module are unchanged: finance.view still lists journals, a sales user does not', async () => {
    passedGate((await request(as('A', FINANCE_EXEC)).get('/v1/ledger/journals')).status);
    refused((await request(as('A', SALES_EXEC)).get('/v1/ledger/journals')).status);
  });

  it('TEST-P1-F03-03 the database constraint is NOT weakened: the old three-part action names are still rejected, the new ones are accepted', async () => {
    const ids = createIdGenerator();
    const audit = createAuditPort(ids);
    const txRunner = createTxRunner(env.db);
    const ctx: RequestContext = {
      principal: testPrincipal({ kind: 'SERVICE', id: 'SYSTEM:test', tenantId: env.A.tenantId, grants: [] }),
      correlationId: 'corr-p1',
      now: new Date(),
    };
    const record = (action: string) =>
      txRunner.withTenantTx(ctx, (tx) => audit.record(tx, ctx, { action, entityType: 'ledger_test', entityId: 'x' }));

    for (const old of ['ledger.journal.post', 'ledger.period.close', 'ledger.export.run']) {
      await expect(record(old), old).rejects.toThrow();
    }
    for (const action of Object.values(LEDGER_AUDIT_ACTIONS)) {
      expect(action).toMatch(/^[a-z_]+\.[a-z_]+$/);
      await record(action);
    }
    const written = await env.admin.query(`SELECT action FROM app.audit_event WHERE tenant_id = $1 AND entity_type = 'ledger_test' ORDER BY action`, [env.A.tenantId]);
    expect(written.rows.map((r) => r.action)).toEqual(['ledger.export_run', 'ledger.journal_posted', 'ledger.period_closed']);
  });

  it('TEST-P1-F03-04 a system identity can still post: the journal and its audit event are written together, as the settlement adapter does', async () => {
    const ids = createIdGenerator();
    const txRunner = createTxRunner(env.db);
    const service = new LedgerService({ repository: new SqlLedgerRepository(), audit: createAuditPort(ids) });
    const ctx: RequestContext = {
      principal: testPrincipal({ kind: 'SERVICE', id: 'SYSTEM:ledger-adapter', tenantId: env.A.tenantId, grants: [{ code: 'finance.view', scope: 'TENANT', branchIds: [] }] }),
      correlationId: 'corr-p1-svc',
      now: new Date(),
    };
    service.assertManualPostingAllowed(ctx); // does not throw for a SERVICE principal
    const journal = await txRunner.withTenantTx(ctx, (tx) => service.postJournal(tx, ctx, { ...body(), referenceId: 'p1-service-1' }));
    expect(journal.referenceId).toBe('p1-service-1');
    const audited = await env.admin.query(`SELECT action FROM app.audit_event WHERE tenant_id = $1 AND entity_id = $2`, [env.A.tenantId, journal.id]);
    expect(audited.rows.map((r) => r.action)).toEqual([LEDGER_AUDIT_ACTIONS.journalPosted]);
  });
});

describe('F-04 security events can only be written by a holder of security.incident, and carry who filed them', () => {
  const event = (extra: Record<string, unknown> = {}) => ({
    type: 'SUSPICIOUS_ACCESS',
    principal: 'someone-else',
    ip: '203.0.113.7',
    severity: 'HIGH',
    details: { note: 'p1', ...extra },
  });
  const count = async (tenantId: string) =>
    (await env.admin.query(`SELECT count(*)::int AS n FROM app.security_event WHERE tenant_id = $1`, [tenantId])).rows[0].n as number;

  it('TEST-P1-F04-01 no permissions, sales, RM, finance and loan operations are refused and no event is written', async () => {
    const before = await count(env.A.tenantId);
    for (const codes of [NONE, SALES_EXEC, RM, FINANCE_EXEC, LOAN_OPS]) {
      refused((await request(as('A', codes)).post('/v1/security/events').send(event())).status);
    }
    expect(await count(env.A.tenantId)).toBe(before);
  });

  it('TEST-P1-F04-02 a security.incident holder (compliance) can file an event; the server decides principal, address and severity, and keeps what the caller sent as claims', async () => {
    const res = await request(as('A', COMPLIANCE)).post('/v1/security/events').send(event({ reportedBy: 'usr_forged', reporterKind: 'SERVICE' }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.details.reportedBy).toBe(env.A.userIds[0]);
    expect(res.body.details.reporterKind).toBe('USER');
    expect(res.body.principal).toBe(env.A.userIds[0]); // the filer, not the caller's 'someone-else'
    expect(res.body.ip).not.toBe('203.0.113.7');
    expect(res.body.severity).toBe('MEDIUM'); // chosen by the server, not the claimed HIGH
    expect(res.body.details.claimed).toEqual({ principal: 'someone-else', ip: '203.0.113.7', severity: 'HIGH' });
  });

  it('TEST-P1-F04-03 tenant isolation holds: tenant B (also a holder) never sees tenant A events, and the refused call in A wrote nothing there', async () => {
    const list = await request(as('B', COMPLIANCE)).get('/v1/security/events');
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain('someone-else');
    // a tenant B writer writes to tenant B only
    const before = await count(env.A.tenantId);
    expect((await request(as('B', COMPLIANCE)).post('/v1/security/events').send(event())).status).toBe(201);
    expect(await count(env.A.tenantId)).toBe(before);
  });
});
