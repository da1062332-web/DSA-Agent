// apps/api/test/commission-invoice.spec.ts — owner: Devyani — P2-01 the monthly commission invoice to a lender.
//
// The acceptance criterion in the spec is "expected equals invoiced to the paisa", so every total here is asserted
// exactly. The other two things under test are statutory: the invoice number must satisfy CGST Rule 46(b), and TDS
// must never reduce the invoice value.
import { AppError, type Authz, type CommissionPort, type EarnedCommissionLine, type RequestContext, type Tx } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import { InMemoryInvoiceRepository } from '../src/modules/invoices/repository';
import { financialYearLabel, InvoiceService } from '../src/modules/invoices/service';
import { testPrincipal } from './support/fake-auth';

const TENANT = 'ten_01JTESTTENANTA0000000000000';
const LENDER = 'lnd_01J00000000000000000000001';
const tx = {} as Tx;

const authz: Authz = {
  requirePermission(ctx, code) {
    if (!ctx.principal.grants.some((g) => g.code === code)) {
      throw AppError.of('FORBIDDEN', `Permission '${code}' is required.`);
    }
  },
  requireOnRecord() {},
  requireStepUp() {},
  scopeFilter: (<QB,>(_c: unknown, _p: unknown, qb: QB) => qb) as Authz['scopeFilter'],
};

const ctx = (): RequestContext => ({
  principal: testPrincipal({
    id: 'usr_fin_01',
    tenantId: TENANT,
    grants: [{ code: 'invoice.manage', scope: 'TENANT', branchIds: [] }],
  }),
  correlationId: 'corr-inv',
  now: new Date('2026-12-01T00:00:00.000Z'),
});

const line = (over: Partial<EarnedCommissionLine> = {}): EarnedCommissionLine => ({
  calculationId: `ccal_${Math.random().toString(36).slice(2, 10)}`,
  lenderId: LENDER,
  trancheId: 'trn_1',
  applicationId: null,
  productCategory: 'PL',
  eventDate: '2026-11-10',
  basisAmount: '400000.00',
  rate: '0.010000',
  rateType: 'PERCENTAGE',
  grossAmount: '4000.00',
  currency: 'INR',
  slabId: 'cslb_1',
  ...over,
});

function harness(opts: { lines?: EarnedCommissionLine[]; treatment?: 'FORWARD_CHARGE' | 'RCM_RECIPIENT_PAYS' } = {}) {
  const repository = new InMemoryInvoiceRepository();
  const commissionPort: CommissionPort = {
    async listEarnedForMonth() {
      return opts.lines ?? [line()];
    },
    async getInvoiceTerms() {
      return {
        taxTreatment: opts.treatment ?? 'FORWARD_CHARGE',
        gstRateBps: 1800,
        tdsRateBps: 200,
        roundingMode: 'ROUND_HALF_UP',
      };
    },
  };
  return { repository, service: new InvoiceService({ repository, authz, commissionPort }) };
}

describe('P2-01 monthly commission invoice', () => {
  it('TC-COM-INV-01 the spec example: 4,000 commission, 18% GST added, 2% TDS shown but not subtracted', async () => {
    const { service } = harness();
    const invoice = await service.buildLenderCommissionInvoice(tx, ctx(), { lenderId: LENDER, month: '2026-11' });

    expect(invoice.amount).toBe(4000);
    expect(invoice.taxFields?.gstAmount).toBe(720); // 18% of 4,000
    expect(invoice.taxFields?.tdsAmount).toBe(80); //  2% of 4,000, a memo only
    // The invoice value is the taxable amount. TDS is the lender's deduction and must not reduce it.
    expect(invoice.amount).not.toBe(4000 - 80);
  });

  it('TC-COM-INV-02 under reverse charge the invoice carries no GST at all', async () => {
    // Notification 13/2017-CT(R) Sl. No. 11: an individual or proprietorship DSA billing a bank or NBFC.
    const { service } = harness({ treatment: 'RCM_RECIPIENT_PAYS' });
    const invoice = await service.buildLenderCommissionInvoice(tx, ctx(), { lenderId: LENDER, month: '2026-11' });

    expect(invoice.taxFields?.gstAmount).toBe(0);
    expect(invoice.taxFields?.taxTreatment).toBe('RCM_RECIPIENT_PAYS');
    // TDS is still shown: the lender deducts it either way.
    expect(invoice.taxFields?.tdsAmount).toBe(80);
  });

  it('TC-COM-INV-03 the number satisfies CGST Rule 46(b)', async () => {
    const { service } = harness();
    const invoice = await service.buildLenderCommissionInvoice(tx, ctx(), { lenderId: LENDER, month: '2026-11' });

    expect(invoice.number).toBe('CI/26-27/000001');
    expect(invoice.number.length).toBeLessThanOrEqual(16);
    // Letters, digits, hyphen and slash only.
    expect(invoice.number).toMatch(/^[A-Za-z0-9/-]{1,16}$/);
  });

  it('TC-COM-INV-04 numbers run consecutively within a financial year', async () => {
    const { service } = harness();
    const first = await service.buildLenderCommissionInvoice(tx, ctx(), { lenderId: LENDER, month: '2026-11' });
    const second = await service.buildLenderCommissionInvoice(tx, ctx(), { lenderId: 'lnd_other', month: '2026-11' });

    expect(first.number).toBe('CI/26-27/000001');
    expect(second.number).toBe('CI/26-27/000002');
  });

  it('TC-COM-INV-05 the financial year turns on 1 April, not 1 January', async () => {
    expect(financialYearLabel('2026-04')).toBe('26-27');
    expect(financialYearLabel('2026-11')).toBe('26-27');
    expect(financialYearLabel('2027-03')).toBe('26-27');
    expect(financialYearLabel('2027-04')).toBe('27-28');
  });

  it('TC-COM-INV-06 a lender cannot be invoiced twice for the same month', async () => {
    const { service } = harness();
    await service.buildLenderCommissionInvoice(tx, ctx(), { lenderId: LENDER, month: '2026-11' });

    await expect(
      service.buildLenderCommissionInvoice(tx, ctx(), { lenderId: LENDER, month: '2026-11' }),
    ).rejects.toThrowError(/already invoiced/i);
  });

  it('TC-COM-INV-07 a month with nothing earned raises instead of billing zero', async () => {
    const { service } = harness({ lines: [] });

    await expect(
      service.buildLenderCommissionInvoice(tx, ctx(), { lenderId: LENDER, month: '2026-11' }),
    ).rejects.toThrowError(/No earned commission/);
  });

  it('TC-COM-INV-08 the total equals the sum of the lines to the paisa', async () => {
    // Amounts chosen so a float sum would drift: 0.1 + 0.2 is the classic case.
    const { service } = harness({
      lines: [
        line({ grossAmount: '0.10' }),
        line({ grossAmount: '0.20' }),
        line({ grossAmount: '1234.56' }),
        line({ grossAmount: '7891.01' }),
      ],
    });
    const invoice = await service.buildLenderCommissionInvoice(tx, ctx(), { lenderId: LENDER, month: '2026-11' });

    expect(invoice.amount).toBe(9125.87);
    expect(invoice.taxFields?.gstAmount).toBe(1642.66); // 18% of 9,125.87 = 1642.6566, half-up
  });

  it('TC-COM-INV-09 the invoice records every calculation it bills, so the export can trace it', async () => {
    const lines = [line(), line(), line()];
    const { service } = harness({ lines });
    const invoice = await service.buildLenderCommissionInvoice(tx, ctx(), { lenderId: LENDER, month: '2026-11' });

    expect(invoice.calculationIds).toEqual(lines.map((l) => l.calculationId));
    expect(invoice.periodMonth).toBe('2026-11');
    expect(invoice.direction).toBe('TO_LENDER');
  });

  it('TC-COM-INV-10 generating an invoice needs invoice.manage', async () => {
    const { service } = harness();
    const viewer: RequestContext = {
      ...ctx(),
      principal: testPrincipal({
        tenantId: TENANT,
        grants: [{ code: 'invoice.view', scope: 'TENANT', branchIds: [] }],
      }),
    };

    await expect(
      service.buildLenderCommissionInvoice(tx, viewer, { lenderId: LENDER, month: '2026-11' }),
    ).rejects.toThrowError(/invoice\.manage/);
  });
});
