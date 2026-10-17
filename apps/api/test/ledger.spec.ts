// apps/api/test/ledger.spec.ts — MOD-LED Ledger Management Tests
import type { PermissionCode, RequestContext, Tx, TxRunner } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import { LedgerService } from '../src/modules/ledger/ledger-service';
import { InMemoryLedgerRepository } from '../src/modules/ledger/repository';
import { LedgerSettlementJournalAdapter } from '../src/modules/ledger/adapter';
import { testPrincipal } from './support/fake-auth';

const fakeTxRunner: TxRunner = {
  withTenantTx: async (_ctx, fn) => fn({} as any),
};

const makeCtx = (
  tenantId = 'ten_01JTESTTENANT00000000000000',
  ...grants: PermissionCode[]
): RequestContext => ({
  principal: testPrincipal({
    tenantId,
    grants: grants.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })),
  }),
  correlationId: 'corr-led-test-01',
  now: new Date(),
});

describe('MOD-LED: Ledger Management (Domain DOM-K)', () => {
  // =========================================================================
  // SUB-LED.01: ACCOUNTS & CHART OF ACCOUNTS REGISTRY
  // =========================================================================
  describe('SUB-LED.01: Accounts Registry', () => {
    it('TC-LED-001: listAccounts enforces finance.view permission', async () => {
      const repo = new InMemoryLedgerRepository();
      const service = new LedgerService({ repository: repo });
      const unauthCtx = makeCtx('ten_01', 'payout.request'); // lacking finance.view

      await expect(service.listAccounts({} as Tx, unauthCtx, {})).rejects.toThrow(/finance.view required/);
    });

    it('TC-LED-002: Successfully lists default chart of accounts with type filter', async () => {
      const repo = new InMemoryLedgerRepository();
      const service = new LedgerService({ repository: repo });
      const ctx = makeCtx('ten_01', 'finance.view');

      repo.seedDefaultAccounts('ten_01');
      const allAccounts = await service.listAccounts({} as Tx, ctx, {});
      expect(allAccounts.length).toBeGreaterThanOrEqual(5);

      const assets = await service.listAccounts({} as Tx, ctx, { type: 'ASSET' });
      expect(assets.every((a) => a.type === 'ASSET')).toBe(true);
      expect(assets.some((a) => a.code === '1010-SETTLEMENT-BANK')).toBe(true);
    });

    it('TC-LED-003: Creates new account with unique code constraint per tenant', async () => {
      const repo = new InMemoryLedgerRepository();
      const service = new LedgerService({ repository: repo });
      const ctx = makeCtx('ten_01', 'finance.view');

      const created = await service.createAccount({} as Tx, ctx, {
        code: '1020-OPERATING-BANK',
        name: 'Operating Bank Account',
        type: 'ASSET',
        currency: 'INR',
        isActive: true,
      });

      expect(created.code).toBe('1020-OPERATING-BANK');
      expect(created.type).toBe('ASSET');

      // Duplicate code in same tenant throws conflict
      await expect(
        service.createAccount({} as Tx, ctx, {
          code: '1020-OPERATING-BANK',
          name: 'Duplicate Account',
          type: 'ASSET',
        }),
      ).rejects.toThrow(/already exists/);
    });

    it('TC-LED-004: Invariant OD-021: TAX_PAYABLE and TAX_RECEIVABLE must remain inactive', async () => {
      const repo = new InMemoryLedgerRepository();
      const service = new LedgerService({ repository: repo });
      const ctx = makeCtx('ten_01', 'finance.view');

      // Attempting to create an active tax payable account is rejected under OD-021
      await expect(
        service.createAccount({} as Tx, ctx, {
          code: '2210-ACTIVE-GST',
          name: 'Active GST Account',
          type: 'TAX_PAYABLE',
          isActive: true,
        }),
      ).rejects.toThrow(/OD-021/);

      // Inactive tax accounts are permitted
      const inactiveTax = await service.createAccount({} as Tx, ctx, {
        code: '2210-DORMANT-GST',
        name: 'Dormant GST Account',
        type: 'TAX_PAYABLE',
        isActive: false,
      });
      expect(inactiveTax.isActive).toBe(false);
    });

    it('TC-LED-005: Multi-tenant account isolation: Tenant B cannot access Tenant A accounts', async () => {
      const repo = new InMemoryLedgerRepository();
      const service = new LedgerService({ repository: repo });
      const ctxA = makeCtx('ten_A', 'finance.view');
      const ctxB = makeCtx('ten_B', 'finance.view');

      await service.createAccount({} as Tx, ctxA, {
        code: '1099-SECRET-BANK-A',
        name: 'Tenant A Private Bank',
        type: 'ASSET',
      });

      const listB = await service.listAccounts({} as Tx, ctxB, {});
      expect(listB.some((a) => a.code === '1099-SECRET-BANK-A')).toBe(false);
    });
  });

  // =========================================================================
  // SUB-LED.02: JOURNAL POSTINGS & DOUBLE-ENTRY BALANCING
  // =========================================================================
  describe('SUB-LED.02: Journal Postings', () => {
    it('TC-LED-006: listJournals enforces finance.view permission', async () => {
      const repo = new InMemoryLedgerRepository();
      const service = new LedgerService({ repository: repo });
      const unauthCtx = makeCtx('ten_01', 'commission.calculate');

      await expect(service.listJournals({} as Tx, unauthCtx, {})).rejects.toThrow(/finance.view required/);
    });

    it('TC-LED-007: Atomic balanced journal posting (DEBIT = CREDIT)', async () => {
      const repo = new InMemoryLedgerRepository();
      const service = new LedgerService({ repository: repo });
      const ctx = makeCtx('ten_01', 'finance.view');

      const journal = await service.postJournal({} as Tx, ctx, {
        referenceType: 'PAYOUT_RECORDING',
        referenceId: 'pay_001',
        period: '2026-10',
        currency: 'INR',
        narration: 'Settlement payout test',
        lines: [
          { accountCode: '2100-COMMISSION-PAYABLE', entryType: 'DEBIT', amount: '50000.00' },
          { accountCode: '1010-SETTLEMENT-BANK', entryType: 'CREDIT', amount: '50000.00' },
        ],
      });

      expect(journal.journalNumber).toMatch(/^JRN-2026-10-\d{5}$/);
      expect(journal.status).toBe('POSTED');
      expect(journal.lines).toHaveLength(2);
      expect(journal.lines![0]!.entryType).toBe('DEBIT');
      expect(journal.lines![1]!.entryType).toBe('CREDIT');
    });

    it('TC-LED-008: Reject unbalanced journal posting (DEBIT != CREDIT)', async () => {
      const repo = new InMemoryLedgerRepository();
      const service = new LedgerService({ repository: repo });
      const ctx = makeCtx('ten_01', 'finance.view');

      await expect(
        service.postJournal({} as Tx, ctx, {
          referenceType: 'PAYOUT_RECORDING',
          referenceId: 'pay_unbal_01',
          period: '2026-10',
          lines: [
            { accountCode: '2100-COMMISSION-PAYABLE', entryType: 'DEBIT', amount: '50000.00' },
            { accountCode: '1010-SETTLEMENT-BANK', entryType: 'CREDIT', amount: '45000.00' }, // Variance of 5000!
          ],
        }),
      ).rejects.toThrow(/LEDGER_UNBALANCED/);
    });

    it('TC-LED-009: Reject negative or zero amount entries', async () => {
      const repo = new InMemoryLedgerRepository();
      const service = new LedgerService({ repository: repo });
      const ctx = makeCtx('ten_01', 'finance.view');

      await expect(
        service.postJournal({} as Tx, ctx, {
          referenceType: 'PAYOUT_RECORDING',
          referenceId: 'pay_zero',
          period: '2026-10',
          lines: [
            { accountCode: '2100-COMMISSION-PAYABLE', entryType: 'DEBIT', amount: '0.00' },
            { accountCode: '1010-SETTLEMENT-BANK', entryType: 'CREDIT', amount: '0.00' },
          ],
        }),
      ).rejects.toThrow(/positive/);
    });

    it('TC-LED-010: Idempotency-Key support: duplicate request returns existing journal', async () => {
      const repo = new InMemoryLedgerRepository();
      const service = new LedgerService({ repository: repo });
      const ctx = makeCtx('ten_01', 'finance.view');
      const idempotencyKey = 'idem_led_tx_999';

      const postInput = {
        referenceType: 'PAYOUT_RECORDING' as const,
        referenceId: 'pay_002',
        idempotencyKey,
        period: '2026-10',
        lines: [
          { accountCode: '2100-COMMISSION-PAYABLE', entryType: 'DEBIT' as const, amount: '12500.00' },
          { accountCode: '1010-SETTLEMENT-BANK', entryType: 'CREDIT' as const, amount: '12500.00' },
        ],
      };

      const first = await service.postJournal({} as Tx, ctx, postInput);
      const second = await service.postJournal({} as Tx, ctx, postInput);

      expect(first.id).toBe(second.id);
      expect(first.journalNumber).toBe(second.journalNumber);
      expect(repo.journals.length).toBe(1);
    });

    it('TC-LED-011: Period close requires finance.period_close permission', async () => {
      const repo = new InMemoryLedgerRepository();
      const service = new LedgerService({ repository: repo });
      const unauthCtx = makeCtx('ten_01', 'finance.view'); // lacking finance.period_close

      await expect(
        service.closePeriod({} as Tx, unauthCtx, '2026-10', { note: 'Monthly close' }),
      ).rejects.toThrow(/finance.period_close required/);
    });

    it('TC-LED-012: Period close succeeds on zero-sum trial balance and subsequently blocks postings', async () => {
      const repo = new InMemoryLedgerRepository();
      const service = new LedgerService({ repository: repo });
      const ctxPost = makeCtx('ten_01', 'finance.view');
      const ctxClose = makeCtx('ten_01', 'finance.period_close');

      // 1. Post balanced journal
      await service.postJournal({} as Tx, ctxPost, {
        referenceType: 'PAYOUT_RECORDING',
        referenceId: 'pay_close_test',
        period: '2026-09',
        lines: [
          { accountCode: '2100-COMMISSION-PAYABLE', entryType: 'DEBIT', amount: '10000.00' },
          { accountCode: '1010-SETTLEMENT-BANK', entryType: 'CREDIT', amount: '10000.00' },
        ],
      });

      // 2. Close period
      const closed = await service.closePeriod({} as Tx, ctxClose, '2026-09', { note: 'September close' });
      expect(closed.status).toBe('CLOSED');
      expect(closed.trialBalanceZeroSum).toBe(true);

      // 3. New postings to 2026-09 are now blocked
      await expect(
        service.postJournal({} as Tx, ctxPost, {
          referenceType: 'PAYOUT_RECORDING',
          referenceId: 'pay_after_close',
          period: '2026-09',
          lines: [
            { accountCode: '2100-COMMISSION-PAYABLE', entryType: 'DEBIT', amount: '500.00' },
            { accountCode: '1010-SETTLEMENT-BANK', entryType: 'CREDIT', amount: '500.00' },
          ],
        }),
      ).rejects.toThrow(/Cannot post to closed accounting period/);
    });
  });

  // =========================================================================
  // SUB-LED.03: BALANCES, STATEMENTS, EXPORTS, AND TRIAL BALANCE
  // =========================================================================
  describe('SUB-LED.03: Balances and Statements', () => {
    it('TC-LED-014: Calculates account balance by account type (Asset debit-credit, Liability credit-debit)', async () => {
      const repo = new InMemoryLedgerRepository();
      const service = new LedgerService({ repository: repo });
      const ctx = makeCtx('ten_01', 'finance.view');

      repo.seedDefaultAccounts('ten_01');
      const bankAcc = repo.accounts.find(
        (a) => a.tenant_id === 'ten_01' && a.code === '1010-SETTLEMENT-BANK',
      )!;
      const payAcc = repo.accounts.find(
        (a) => a.tenant_id === 'ten_01' && a.code === '2100-COMMISSION-PAYABLE',
      )!;

      // Post 1: Credit Bank 30,000, Debit Payable 30,000
      await service.postJournal({} as Tx, ctx, {
        referenceType: 'PAYOUT_RECORDING',
        referenceId: 'pay_bal_01',
        period: '2026-10',
        lines: [
          { accountCode: '2100-COMMISSION-PAYABLE', entryType: 'DEBIT', amount: '30000.00' },
          { accountCode: '1010-SETTLEMENT-BANK', entryType: 'CREDIT', amount: '30000.00' },
        ],
      });

      const bankBalance = await service.getAccountBalance({} as Tx, ctx, bankAcc.id, {});
      // ASSET normal balance: Debit - Credit = 0 - 30000 = -30000.00
      expect(bankBalance.balance).toBe('-30000.00');

      const payBalance = await service.getAccountBalance({} as Tx, ctx, payAcc.id, {});
      // LIABILITY normal balance: Credit - Debit = 0 - 30000 = -30000.00
      expect(payBalance.balance).toBe('-30000.00');
    });

    it('TC-LED-015: Connector sub-ledger statements compute running balance', async () => {
      const repo = new InMemoryLedgerRepository();
      const service = new LedgerService({ repository: repo });
      const ctx = makeCtx('ten_01', 'finance.view');

      // Create connector sub-ledger account
      const connectorAccount = await service.createAccount({} as Tx, ctx, {
        code: '2110-CON-001',
        name: 'Connector 001 Payable',
        type: 'LIABILITY',
        counterpartyType: 'CONNECTOR',
        counterpartyId: 'con_001',
      });

      // Post 1: Commission earned by connector (Credit 15,000)
      await service.postJournal({} as Tx, ctx, {
        referenceType: 'COMMISSION_ACCRUAL',
        referenceId: 'accrual_01',
        period: '2026-10',
        lines: [
          { accountCode: '5100-COMMISSION-EXPENSE', entryType: 'DEBIT', amount: '15000.00' },
          { accountCode: '2110-CON-001', entryType: 'CREDIT', amount: '15000.00' },
        ],
      });

      // Post 2: Payout disbursed to connector (Debit 10,000)
      await service.postJournal({} as Tx, ctx, {
        referenceType: 'PAYOUT_RECORDING',
        referenceId: 'payout_01',
        period: '2026-10',
        lines: [
          { accountCode: '2110-CON-001', entryType: 'DEBIT', amount: '10000.00' },
          { accountCode: '1010-SETTLEMENT-BANK', entryType: 'CREDIT', amount: '10000.00' },
        ],
      });

      const statement = await service.getConnectorStatements({} as Tx, ctx, 'con_001', {});
      expect(statement.connectorId).toBe('con_001');
      expect(statement.totalCredits).toBe('15000.00');
      expect(statement.totalDebits).toBe('10000.00');
      expect(statement.closingBalance).toBe('5000.00'); // 15,000 - 10,000 = 5,000 net payable
      expect(statement.lines).toHaveLength(2);
    });

    it('TC-LED-016: Exports require both finance.view and export.run', async () => {
      const repo = new InMemoryLedgerRepository();
      const service = new LedgerService({ repository: repo });
      const unauthCtx = makeCtx('ten_01', 'finance.view'); // missing export.run

      await expect(service.createExport({} as Tx, unauthCtx, { format: 'CSV' })).rejects.toThrow(
        /export.run required/,
      );

      const authCtx = makeCtx('ten_01', 'finance.view', 'export.run');
      const exp = await service.createExport({} as Tx, authCtx, { format: 'CSV', period: '2026-10' });
      expect(exp.status).toBe('QUEUED');
      expect(exp.format).toBe('CSV');
    });

    it('TC-LED-017: Trial balance aggregates all debits and credits and verifies zero variance', async () => {
      const repo = new InMemoryLedgerRepository();
      const service = new LedgerService({ repository: repo });
      const ctx = makeCtx('ten_01', 'finance.view');

      await service.postJournal({} as Tx, ctx, {
        referenceType: 'MANUAL',
        referenceId: 'tb_test_01',
        period: '2026-10',
        lines: [
          { accountCode: '5100-COMMISSION-EXPENSE', entryType: 'DEBIT', amount: '75000.00' },
          { accountCode: '2100-COMMISSION-PAYABLE', entryType: 'CREDIT', amount: '75000.00' },
        ],
      });

      const tb = await service.getTrialBalance({} as Tx, ctx, '2026-10');
      expect(tb.totalDebit).toBe('75000.00');
      expect(tb.totalCredit).toBe('75000.00');
      expect(tb.variance).toBe('0.00');
      expect(tb.isBalanced).toBe(true);
    });
  });

  // =========================================================================
  // UPSTREAM ADAPTER INTEGRATION
  // =========================================================================
  describe('Upstream Adapter Integration (MOD-PAY)', () => {
    it('TC-LED-018: LedgerSettlementJournalAdapter automatically posts balanced double-entry journal', async () => {
      const repo = new InMemoryLedgerRepository();
      const service = new LedgerService({ repository: repo });
      const adapter = new LedgerSettlementJournalAdapter(service);

      const res = await adapter.postSettlementJournal({} as Tx, 'ten_01', {
        payoutId: 'pay_settle_001',
        currency: 'INR',
        paidOn: new Date('2026-10-15'),
        lines: [
          { accountCode: '2100-COMMISSION-PAYABLE', entryType: 'DEBIT', amount: '85000.00' },
          { accountCode: '1010-SETTLEMENT-BANK', entryType: 'CREDIT', amount: '85000.00' },
        ],
      });

      expect(res.entryId).toBeDefined();
      const posted = await repo.findJournalById({} as Tx, 'ten_01', res.entryId);
      expect(posted).not.toBeNull();
      expect(posted?.reference_type).toBe('PAYOUT_RECORDING');
      expect(posted?.reference_id).toBe('pay_settle_001');

      const entries = await repo.listEntriesForJournal({} as Tx, 'ten_01', res.entryId);
      expect(entries).toHaveLength(2);
      expect(entries[0]!.entry_type).toBe('DEBIT');
      expect(entries[1]!.entry_type).toBe('CREDIT');
    });
  });
});
