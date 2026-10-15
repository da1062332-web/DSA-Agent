// apps/api/test/invoices.spec.ts — Module 33: Invoices & Statements (MOD-INV) test suite
import type { RequestContext, Tx, TxRunner } from '@dsa/contracts';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryInvoiceRepository } from '../src/modules/invoices/repository';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const inMemoryTxRunner: TxRunner = {
  async withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tx = {} as any;
    tx.tenantId = ctx.principal.tenantId;
    return fn(tx as Tx);
  },
};

const inMemoryAudit = {
  record: async () => 'aud_01JTESTAUDIT00000000000000',
};

describe('Module 33 — Invoices & Statements (MOD-INV)', () => {
  let repository: InMemoryInvoiceRepository;

  const tenantA = 'ten_01JTESTTENANTA0000000000000';
  const tenantB = 'ten_01JTESTTENANTB0000000000000';

  // 1. Finance Exec with invoice.manage and finance.view in Tenant A
  const financeExecA = testPrincipal({
    id: 'usr_fin_exec_01',
    tenantId: tenantA,
    grants: [
      { code: 'invoice.manage', scope: 'TENANT', branchIds: [] },
      { code: 'finance.view', scope: 'TENANT', branchIds: [] },
    ],
  });

  // 2. Finance Viewer (read-only) in Tenant A
  const financeViewerA = testPrincipal({
    id: 'usr_fin_view_01',
    tenantId: tenantA,
    grants: [{ code: 'finance.view', scope: 'TENANT', branchIds: [] }],
  });

  // 3. Regular Sales Agent (no finance permissions) in Tenant A
  const agentA = testPrincipal({
    id: 'usr_agent_01',
    tenantId: tenantA,
    grants: [],
  });

  // 4. Connector Self-Service User in Tenant A
  const connectorUserA = testPrincipal({
    id: 'con_01JTESTCONN0000000000001',
    tenantId: tenantA,
    grants: [],
  });

  // 5. User in Tenant B with finance permissions
  const financeExecB = testPrincipal({
    id: 'usr_fin_exec_b1',
    tenantId: tenantB,
    grants: [
      { code: 'invoice.manage', scope: 'TENANT', branchIds: [] },
      { code: 'finance.view', scope: 'TENANT', branchIds: [] },
    ],
  });

  beforeEach(() => {
    repository = new InMemoryInvoiceRepository();
  });

  describe('API-INV-001: POST /v1/invoices — Record Invoice', () => {
    it('records a lender invoice when user has invoice.manage', async () => {
      const app = createTestApp({
        auth: fakeAuth(financeExecA),
        deps: { txRunner: inMemoryTxRunner, invoiceRepository: repository, audit: inMemoryAudit as any },
      });

      const res = await request(app)
        .post('/v1/invoices')
        .send({
          direction: 'TO_LENDER',
          number: 'INV-2026-001',
          date: '2026-10-15',
          dueDate: '2026-11-15',
          amount: 150000.0,
          currency: 'INR',
          partyId: 'lnd_hdfc_01',
          partyName: 'HDFC Bank',
          taxFields: {
            gstRate: 18,
            gstAmount: 27000,
            hsnSac: '9971',
          },
          calculationIds: ['ccal_01', 'ccal_02'],
          notes: 'Q3 Payout commission invoice',
        });

      expect(res.status).toBe(201);
      expect(res.header['etag']).toBe('"0"');
      expect(res.body.id).toMatch(/^inv_/);
      expect(res.body.tenantId).toBe(tenantA);
      expect(res.body.direction).toBe('TO_LENDER');
      expect(res.body.number).toBe('INV-2026-001');
      expect(res.body.amount).toBe(150000);
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.taxFields.gstRate).toBe(18);
      expect(res.body.calculationIds).toEqual(['ccal_01', 'ccal_02']);
    });

    it('rejects recording invoice if user lacks invoice.manage permission', async () => {
      const app = createTestApp({
        auth: fakeAuth(agentA),
        deps: { txRunner: inMemoryTxRunner, invoiceRepository: repository, audit: inMemoryAudit as any },
      });

      const res = await request(app).post('/v1/invoices').send({
        direction: 'TO_LENDER',
        number: 'INV-2026-002',
        date: '2026-10-15',
        amount: 50000,
        partyId: 'lnd_icici_01',
      });

      expect(res.status).toBe(403);
    });

    it('enforces UNIQUE(tenant_id, direction, number) constraint and rejects duplicates', async () => {
      const app = createTestApp({
        auth: fakeAuth(financeExecA),
        deps: { txRunner: inMemoryTxRunner, invoiceRepository: repository, audit: inMemoryAudit as any },
      });

      // 1. Create first invoice
      const firstRes = await request(app).post('/v1/invoices').send({
        direction: 'TO_LENDER',
        number: 'INV-DUPLICATE-001',
        date: '2026-10-15',
        amount: 25000,
        partyId: 'lnd_axis_01',
      });
      expect(firstRes.status).toBe(201);

      // 2. Attempt second invoice with same number and direction in tenant A
      const secondRes = await request(app).post('/v1/invoices').send({
        direction: 'TO_LENDER',
        number: 'INV-DUPLICATE-001',
        date: '2026-10-16',
        amount: 30000,
        partyId: 'lnd_axis_01',
      });
      expect(secondRes.status).toBe(409);
      expect(secondRes.body.error?.code).toBe('VERSION_CONFLICT');

      // 3. Same number with different direction (FROM_CONNECTOR) is permitted
      const connectorRes = await request(app).post('/v1/invoices').send({
        direction: 'FROM_CONNECTOR',
        number: 'INV-DUPLICATE-001',
        date: '2026-10-16',
        amount: 12000,
        partyId: 'con_01',
      });
      expect(connectorRes.status).toBe(201);
    });
  });

  describe('API-INV-002: GET /v1/invoices — List Invoices', () => {
    beforeEach(async () => {
      // Seed test invoices across Tenant A and Tenant B
      await repository.createInvoice({} as Tx, tenantA, {
        id: 'inv_a_01',
        direction: 'TO_LENDER',
        number: 'INV-A-01',
        date: '2026-10-10',
        amount: 100000,
        currency: 'INR',
        partyId: 'lnd_hdfc',
        partyName: 'HDFC Bank',
        createdBy: financeExecA.id,
      });

      await repository.createInvoice({} as Tx, tenantA, {
        id: 'inv_a_02',
        direction: 'FROM_CONNECTOR',
        number: 'INV-A-02',
        date: '2026-10-12',
        amount: 20000,
        currency: 'INR',
        partyId: 'con_01',
        partyName: 'Sharma Financials',
        createdBy: financeExecA.id,
      });

      await repository.createInvoice({} as Tx, tenantB, {
        id: 'inv_b_01',
        direction: 'TO_LENDER',
        number: 'INV-B-01',
        date: '2026-10-11',
        amount: 75000,
        currency: 'INR',
        partyId: 'lnd_sbi',
        partyName: 'State Bank of India',
        createdBy: financeExecB.id,
      });
    });

    it('allows user with finance.view to list invoices with tenant isolation', async () => {
      const app = createTestApp({
        auth: fakeAuth(financeViewerA),
        deps: { txRunner: inMemoryTxRunner, invoiceRepository: repository, audit: inMemoryAudit as any },
      });

      const res = await request(app).get('/v1/invoices');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((i: any) => i.tenantId === tenantA)).toBe(true);
      expect(res.body.data.some((i: any) => i.id === 'inv_b_01')).toBe(false);
    });

    it('filters invoices by direction and status', async () => {
      const app = createTestApp({
        auth: fakeAuth(financeViewerA),
        deps: { txRunner: inMemoryTxRunner, invoiceRepository: repository, audit: inMemoryAudit as any },
      });

      const res = await request(app).get('/v1/invoices?direction=FROM_CONNECTOR');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].direction).toBe('FROM_CONNECTOR');
      expect(res.body.data[0].number).toBe('INV-A-02');
    });

    it('rejects listing invoices if user lacks finance.view', async () => {
      const app = createTestApp({
        auth: fakeAuth(agentA),
        deps: { txRunner: inMemoryTxRunner, invoiceRepository: repository, audit: inMemoryAudit as any },
      });

      const res = await request(app).get('/v1/invoices');
      expect(res.status).toBe(403);
    });
  });

  describe('API-INV-003: POST /v1/invoices/:id/status — Issue, Pay or Void', () => {
    let createdInvoiceId: string;

    beforeEach(async () => {
      const inv = await repository.createInvoice({} as Tx, tenantA, {
        id: 'inv_test_lifecycle',
        direction: 'FROM_CONNECTOR',
        number: 'INV-CONN-777',
        date: '2026-10-14',
        amount: 45000,
        currency: 'INR',
        partyId: connectorUserA.id,
        partyName: 'Rahul Verma Partner',
        createdBy: financeExecA.id,
      });
      createdInvoiceId = inv.id;
    });

    it('transitions DRAFT -> ISSUED -> PAID with lock version increment', async () => {
      const app = createTestApp({
        auth: fakeAuth(financeExecA),
        deps: { txRunner: inMemoryTxRunner, invoiceRepository: repository, audit: inMemoryAudit as any },
      });

      // 1. Issue invoice
      const issueRes = await request(app)
        .post(`/v1/invoices/${createdInvoiceId}/status`)
        .set('If-Match', '"0"')
        .send({ status: 'ISSUED', notes: 'Approved for payment processing' });

      expect(issueRes.status).toBe(200);
      expect(issueRes.header['etag']).toBe('"1"');
      expect(issueRes.body.status).toBe('ISSUED');
      expect(issueRes.body.lockVersion).toBe(1);

      // 2. Pay invoice (which should also post a ledger entry for FROM_CONNECTOR)
      const payRes = await request(app)
        .post(`/v1/invoices/${createdInvoiceId}/status`)
        .set('If-Match', '"1"')
        .send({ status: 'PAID', notes: 'Paid via IMPS Ref #992812' });

      expect(payRes.status).toBe(200);
      expect(payRes.header['etag']).toBe('"2"');
      expect(payRes.body.status).toBe('PAID');
      expect(payRes.body.lockVersion).toBe(2);

      // Verify that ledger entry was generated
      const ledgerEntries = await repository.listLedgerEntries(
        {} as Tx,
        tenantA,
        connectorUserA.id,
      );
      expect(ledgerEntries).toHaveLength(1);
      expect(ledgerEntries[0]!.entryType).toBe('PAYOUT_DISBURSED');
      expect(ledgerEntries[0]!.amount).toBe(45000);
      expect(ledgerEntries[0]!.referenceId).toBe('INV-CONN-777');
    });

    it('rejects invalid state transition directly from DRAFT to PAID', async () => {
      const app = createTestApp({
        auth: fakeAuth(financeExecA),
        deps: { txRunner: inMemoryTxRunner, invoiceRepository: repository, audit: inMemoryAudit as any },
      });

      const res = await request(app)
        .post(`/v1/invoices/${createdInvoiceId}/status`)
        .send({ status: 'PAID' });

      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe('INVALID_TRANSITION');
    });

    it('rejects update when stale If-Match lock version is passed', async () => {
      const app = createTestApp({
        auth: fakeAuth(financeExecA),
        deps: { txRunner: inMemoryTxRunner, invoiceRepository: repository, audit: inMemoryAudit as any },
      });

      const res = await request(app)
        .post(`/v1/invoices/${createdInvoiceId}/status`)
        .set('If-Match', '"99"')
        .send({ status: 'ISSUED' });

      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe('VERSION_CONFLICT');
    });
  });

  describe('API-LED-004 & API-CPT-004: Connector Statement Generator', () => {
    beforeEach(async () => {
      // Seed ledger entries for connector
      await repository.createLedgerEntry({} as Tx, tenantA, {
        id: 'led_01',
        connectorId: connectorUserA.id,
        entryType: 'COMMISSION_EARNED',
        amount: 80000,
        currency: 'INR',
        entryDate: '2026-09-15',
        description: 'September Commission Payout',
        balanceAfter: 80000,
        createdBy: 'system',
      });

      await repository.createLedgerEntry({} as Tx, tenantA, {
        id: 'led_02',
        connectorId: connectorUserA.id,
        entryType: 'PAYOUT_DISBURSED',
        amount: 50000,
        currency: 'INR',
        entryDate: '2026-09-30',
        description: 'Monthly Bank Payout',
        balanceAfter: 30000,
        createdBy: 'system',
      });

      await repository.createLedgerEntry({} as Tx, tenantA, {
        id: 'led_03',
        connectorId: connectorUserA.id,
        entryType: 'COMMISSION_EARNED',
        amount: 60000,
        currency: 'INR',
        entryDate: '2026-10-05',
        description: 'October Disbursement Commission',
        balanceAfter: 90000,
        createdBy: 'system',
      });
    });

    it('generates connector statement with opening balance, credits, debits and closing balance', async () => {
      const app = createTestApp({
        auth: fakeAuth(financeViewerA),
        deps: { txRunner: inMemoryTxRunner, invoiceRepository: repository, audit: inMemoryAudit as any },
      });

      const res = await request(app).get(
        `/v1/connectors/${connectorUserA.id}/statements?fromDate=2026-10-01&toDate=2026-10-31`,
      );

      expect(res.status).toBe(200);
      expect(res.body.connectorId).toBe(connectorUserA.id);
      expect(res.body.openingBalance).toBe(30000); // 80000 - 50000
      expect(res.body.totalCredits).toBe(60000);
      expect(res.body.totalDebits).toBe(0);
      expect(res.body.closingBalance).toBe(90000);
      expect(res.body.entries).toHaveLength(1);
      expect(res.body.entries[0].type).toBe('COMMISSION_EARNED');
      expect(res.body.entries[0].runningBalance).toBe(90000);
    });

    it('permits connector self-service access to own statement via portal endpoint', async () => {
      const app = createTestApp({
        auth: fakeAuth(connectorUserA),
        deps: { txRunner: inMemoryTxRunner, invoiceRepository: repository, audit: inMemoryAudit as any },
      });

      const res = await request(app).get(
        `/v1/portal/connectors/${connectorUserA.id}/statements?fromDate=2026-09-01&toDate=2026-10-31`,
      );

      expect(res.status).toBe(200);
      expect(res.body.openingBalance).toBe(0);
      expect(res.body.totalCredits).toBe(140000);
      expect(res.body.totalDebits).toBe(50000);
      expect(res.body.closingBalance).toBe(90000);
      expect(res.body.entries).toHaveLength(3);
    });

    it('rejects unauthorized user trying to view another connector statement', async () => {
      const app = createTestApp({
        auth: fakeAuth(agentA),
        deps: { txRunner: inMemoryTxRunner, invoiceRepository: repository, audit: inMemoryAudit as any },
      });

      const res = await request(app).get(
        `/v1/connectors/${connectorUserA.id}/statements?fromDate=2026-10-01`,
      );

      expect(res.status).toBe(403);
    });
  });
});
