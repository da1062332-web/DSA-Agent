// apps/api/test/automated-payouts-and-reconciliation.spec.ts
// Test suite for Automated Payment Gateway Integration (MOD-PAY) and Automated Bank Statement Ingestion Engine (MOD-REC)
import { describe, expect, it } from 'vitest';
import { paymentGatewayService } from '../src/modules/finance/payment-gateway';
import { parseCsvFeed, parseMt940Feed } from '../src/modules/reconciliation/statement-parser';

describe('MOD-PAY: Automated Direct Net-Banking / Payment Gateway Integration', () => {
  it('successfully disburses payment via IMPS and generates valid UTR and digital signature', async () => {
    const res = await paymentGatewayService.disburse({
      payoutId: 'prq_01M51TESTPAYOUT01',
      amount: 15000,
      currency: 'INR',
      mode: 'IMPS',
    });

    expect(res.status).toBe('SUCCESS');
    expect(res.gatewayMode).toBe('IMPS');
    expect(res.transferId).toMatch(/^gw_tx_/);
    expect(res.utrNumber).toMatch(/^CMS\d{8}IMPS[0-9A-F]{8}$/);
    expect(res.bankAckSignature).toBeDefined();
    expect(res.bankAckSignature.length).toBe(64);
  });

  it('enforces RBI minimum amount threshold for RTGS mode', async () => {
    await expect(
      paymentGatewayService.disburse({
        payoutId: 'prq_01M51TESTPAYOUT02',
        amount: 50000, // < 2,00,000 threshold
        currency: 'INR',
        mode: 'RTGS',
      }),
    ).rejects.toThrow(/RTGS requires a minimum transfer amount of ₹2,00,000/);
  });

  it('successfully disburses batch through payment gateway with consolidated totals', async () => {
    const payouts = [
      { id: 'prq_01', amount: '12500', currency: 'INR' },
      { id: 'prq_02', amount: '25000', currency: 'INR' },
    ];
    const res = await paymentGatewayService.disburseBatch('batch_test_01', payouts, 'NEFT');

    expect(res.batchId).toBe('batch_test_01');
    expect(res.totalDisbursed).toBe(37500);
    expect(res.results).toHaveLength(2);
    expect(res.results[0]?.utrNumber).toMatch(/^CMS\d{8}NEFT/);
    expect(res.results[1]?.utrNumber).toMatch(/^CMS\d{8}NEFT/);
  });
});

describe('MOD-REC: Automated Bank Statement Ingestion Engine (MT940 / CSV)', () => {
  it('correctly parses SWIFT MT940 bank statement feed with :61: statement and :86: narration tags', () => {
    const mt940Feed = `
:20:STMT2026093001
:25:50200012345678
:28C:1/1
:60F:C260901INR5000000,00
:61:2609150915CR22500,00NTRFNONREF//LN902148
:86:/COMM/Rajesh Kumar/LN902148/DISB/1500000/TDS/2250
:61:2609160916CR37500,00NTRFNONREF//LN902149
:86:/COMM/Sunita Patel/LN902149/DISB/2500000/TDS/3750
:62F:C260930INR5060000,00
    `.trim();

    const res = parseMt940Feed(mt940Feed);
    expect(res.format).toBe('MT940');
    expect(res.statementRef).toBe('STMT2026093001');
    expect(res.accountNumber).toBe('50200012345678');
    expect(res.lines).toHaveLength(2);

    const line0 = res.lines[0];
    const line1 = res.lines[1];
    expect(line0).toBeDefined();
    expect(line1).toBeDefined();

    expect(line0).toEqual({
      loanAccount: 'LN902148',
      customerName: 'Rajesh Kumar',
      disbursedAmount: 1500000,
      commissionAmount: 22500,
      taxDeducted: 2250,
      paidOn: '2026-09-15',
      rawRowRef: expect.any(String),
    });

    expect(line1).toEqual({
      loanAccount: 'LN902149',
      customerName: 'Sunita Patel',
      disbursedAmount: 2500000,
      commissionAmount: 37500,
      taxDeducted: 3750,
      paidOn: '2026-09-16',
      rawRowRef: expect.any(String),
    });

    expect(res.totalCommission).toBe(60000);
    expect(res.totalTaxDeducted).toBe(6000);
    expect(res.netCommission).toBe(54000);
  });

  it('correctly parses bank CSV statement feeds with varying header formats', () => {
    const csvFeed = `
Loan Account,Customer Name,Disbursed Amount,Commission Amount,TDS,Date
LN1001,Amit Sharma,2000000,30000,3000,2026-09-20
LN1002,Deepa Rao,1000000,15000,1500,2026-09-21
    `.trim();

    const res = parseCsvFeed(csvFeed);
    expect(res.format).toBe('CSV');
    expect(res.lines).toHaveLength(2);

    const firstLine = res.lines[0];
    expect(firstLine).toBeDefined();
    expect(firstLine?.loanAccount).toBe('LN1001');
    expect(firstLine?.customerName).toBe('Amit Sharma');
    expect(firstLine?.disbursedAmount).toBe(2000000);
    expect(firstLine?.commissionAmount).toBe(30000);
    expect(firstLine?.taxDeducted).toBe(3000);
    expect(res.totalCommission).toBe(45000);
    expect(res.netCommission).toBe(40500);
  });
});
