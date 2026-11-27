// apps/api/test/invoices-accounting-export.spec.ts — P0-06: the accounting export that replaces the ledger (MOD-INV)
import type { RequestContext, Tx, TxRunner } from '@dsa/contracts';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryInvoiceRepository } from '../src/modules/invoices/repository';
import { accountingExportToCsv, monthBounds } from '../src/modules/invoices/service';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const inMemoryTxRunner: TxRunner = {
  async withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tx = {} as any;
    tx.tenantId = ctx.principal.tenantId;
    return fn(tx as Tx);
  },
};

const inMemoryAudit = { record: async () => 'aud_01JTESTAUDIT00000000000000' };

describe('P0-06 — accounting export (MOD-INV)', () => {
  const tenantA = 'ten_01JTESTTENANTA0000000000000';
  let repository: InMemoryInvoiceRepository;

  const accountant = testPrincipal({
    id: 'usr_acct_01',
    tenantId: tenantA,
    grants: [
      { code: 'invoice.view', scope: 'TENANT', branchIds: [] },
      { code: 'export.run', scope: 'TENANT', branchIds: [] },
    ],
  });

  const viewerWithoutExport = testPrincipal({
    id: 'usr_view_01',
    tenantId: tenantA,
    grants: [{ code: 'invoice.view', scope: 'TENANT', branchIds: [] }],
  });

  const appAs = (principal: ReturnType<typeof testPrincipal>) =>
    createTestApp({
      auth: fakeAuth(principal),
      deps: { txRunner: inMemoryTxRunner, invoiceRepository: repository, audit: inMemoryAudit as any },
    });

  beforeEach(() => {
    repository = new InMemoryInvoiceRepository();
  });

  it('TEST-INV-EXP-01 monthBounds covers the whole month, including February in a leap year', () => {
    expect(monthBounds('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthBounds('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(monthBounds('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthBounds('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });

  it('TEST-INV-EXP-02 the CSV carries the agreed columns and escapes a party name with a comma or quote', () => {
    const csv = accountingExportToCsv([
      {
        recordType: 'INVOICE',
        number: 'INV-2026-11-001',
        date: '2026-11-10',
        party: 'HDFC Bank Ltd, Mumbai',
        taxableValue: '100000.00',
        gst: '18000.00',
        tds: '2000.00',
        total: '116000.00',
        paymentStatus: 'PAID',
      },
      {
        recordType: 'PAYOUT',
        number: 'PAY-77',
        date: '2026-11-20',
        party: 'The "Alpha" Partner',
        taxableValue: '5000.00',
        gst: '0.00',
        tds: '0.00',
        total: '5000.00',
        paymentStatus: 'DISBURSED',
      },
    ]);

    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('Record type,Number,Date,Party,Taxable value,GST,TDS,Total,Payment status');
    // A comma inside a value must not split the column.
    expect(lines[1]).toContain('"HDFC Bank Ltd, Mumbai"');
    // A quote inside a value is doubled, per RFC 4180.
    expect(lines[2]).toContain('"The ""Alpha"" Partner"');
    expect(lines).toHaveLength(3);
  });

  it('TEST-INV-EXP-03 the endpoint returns a CSV attachment named for the month', async () => {
    const res = await request(appAs(accountant)).get('/v1/invoices/accounting-export?month=2026-11');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('accounting-2026-11.csv');
    // No data for the month still returns the header, so the accountant gets a valid file.
    expect(res.text.split('\r\n')[0]).toBe(
      'Record type,Number,Date,Party,Taxable value,GST,TDS,Total,Payment status',
    );
  });

  it('TEST-INV-EXP-04 invoice.view alone cannot take data out: export.run is required', async () => {
    const res = await request(appAs(viewerWithoutExport)).get('/v1/invoices/accounting-export?month=2026-11');
    expect(res.status).toBe(403);
  });

  it('TEST-INV-EXP-05 a month that is not YYYY-MM is refused, and is never read as an invoice id', async () => {
    const res = await request(appAs(accountant)).get('/v1/invoices/accounting-export?month=November');
    expect([400, 422]).toContain(res.status);
  });
});
