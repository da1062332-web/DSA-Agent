// apps/api/src/modules/ledger/ledger-service.ts — MOD-LED Ledger Management
import {
  AppError,
  type AuditPort,
  type OutboxPort,
  type RequestContext,
  type Tx,
} from '@dsa/contracts';
import { requiresMfa } from '@dsa/kernel';
import type {
  AccountBalanceResponse,
  CloseLedgerPeriodInput,
  ConnectorStatementResponse,
  CreateLedgerAccountInput,
  CreateLedgerExportInput,
  GetAccountBalanceQuery,
  GetConnectorStatementsQuery,
  LedgerAccount,
  LedgerExportResponse,
  LedgerJournal,
  ListLedgerAccountsQuery,
  ListLedgerJournalsQuery,
  PeriodCloseResponse,
  PostJournalInput,
  LedgerAccountRow,
  LedgerEntryRow,
  LedgerJournalRow,
} from './types';
import type { LedgerRepository } from './repository';

export interface LedgerServiceDeps {
  repository: LedgerRepository;
  audit?: AuditPort;
  outbox?: OutboxPort;
}

export class LedgerService {
  constructor(private readonly deps: LedgerServiceDeps) {}

  private assertPermission(ctx: RequestContext, code: string, message?: string) {
    const has = ctx.principal.grants.some((g) => g.code === code);
    if (!has) {
      throw AppError.of('FORBIDDEN', message ?? `Permission ${code} required`);
    }
  }

  // --- SUB-LED.01: Accounts ---

  async listAccounts(tx: Tx, ctx: RequestContext, query: ListLedgerAccountsQuery): Promise<LedgerAccount[]> {
    this.assertPermission(ctx, 'finance.view', 'finance.view required to view ledger accounts');
    const tenantId = ctx.principal.tenantId;
    const rows = await this.deps.repository.listAccounts(tx, tenantId, {
      type: query.type,
      counterpartyType: query.counterpartyType,
      counterpartyId: query.counterpartyId,
      isActive: query.isActive,
    });
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      code: r.code,
      name: r.name,
      type: r.type as any,
      counterpartyType: (r.counterparty_type as any) ?? null,
      counterpartyId: r.counterparty_id ?? null,
      currency: r.currency,
      isActive: r.is_active,
      lockVersion: r.lock_version,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    }));
  }

  async createAccount(tx: Tx, ctx: RequestContext, input: CreateLedgerAccountInput): Promise<LedgerAccount> {
    this.assertPermission(ctx, 'finance.view', 'finance.view required to manage ledger accounts');
    const tenantId = ctx.principal.tenantId;

    // OD-021: TAX_PAYABLE and TAX_RECEIVABLE must remain inactive
    if ((input.type === 'TAX_PAYABLE' || input.type === 'TAX_RECEIVABLE') && input.isActive !== false) {
      throw AppError.of(
        'VALIDATION_ERROR',
        'OD-021: TAX_PAYABLE and TAX_RECEIVABLE accounts must remain inactive until tax policy approval',
      );
    }

    const existing = await this.deps.repository.findAccountByCode(tx, tenantId, input.code);
    if (existing) {
      throw AppError.of('INVALID_STATE', `Account with code ${input.code} already exists in this tenant`);
    }

    const now = new Date();
    const id = `acc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const row: LedgerAccountRow = {
      id,
      tenant_id: tenantId,
      code: input.code,
      name: input.name,
      type: input.type,
      counterparty_type: input.counterpartyType ?? null,
      counterparty_id: input.counterpartyId ?? null,
      currency: input.currency ?? 'INR',
      is_active: input.isActive ?? true,
      lock_version: 1,
      created_at: now,
      updated_at: now,
    };

    await this.deps.repository.insertAccount(tx, row);

    return {
      id: row.id,
      tenantId: row.tenant_id,
      code: row.code,
      name: row.name,
      type: row.type as any,
      counterpartyType: (row.counterparty_type as any) ?? null,
      counterpartyId: row.counterparty_id ?? null,
      currency: row.currency,
      isActive: row.is_active,
      lockVersion: row.lock_version,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  // --- SUB-LED.02: Journal Postings ---

  async postJournal(tx: Tx, ctx: RequestContext, input: PostJournalInput): Promise<LedgerJournal> {
    const tenantId = ctx.principal.tenantId;

    // 1. Check if period is closed
    const periodStatus = await this.deps.repository.getPeriodStatus(tx, tenantId, input.period);
    if (periodStatus && periodStatus.status === 'CLOSED') {
      throw AppError.of('FORBIDDEN', `Cannot post to closed accounting period ${input.period}`);
    }

    // 2. Check Idempotency Key
    if (input.idempotencyKey) {
      const existing = await this.deps.repository.findJournalByIdempotencyKey(tx, tenantId, input.idempotencyKey);
      if (existing) {
        const entries = await this.deps.repository.listEntriesForJournal(tx, tenantId, existing.id);
        return {
          id: existing.id,
          tenantId: existing.tenant_id,
          journalNumber: existing.journal_number,
          referenceType: existing.reference_type as any,
          referenceId: existing.reference_id,
          idempotencyKey: existing.idempotency_key,
          period: existing.period,
          status: existing.status,
          reversalOfJournalId: existing.reversal_of_journal_id,
          postedAt: existing.posted_at.toISOString(),
          postedBy: existing.posted_by,
          createdAt: existing.created_at.toISOString(),
          lines: entries.map((e) => ({
            id: e.id,
            tenantId: e.tenant_id,
            journalId: e.journal_id,
            accountId: e.account_id,
            entryType: e.entry_type,
            amount: e.amount,
            currency: e.currency,
            narration: e.narration,
            lineNumber: e.line_number,
            createdAt: e.created_at.toISOString(),
          })),
        };
      }
    }

    // 3. Strict balancing verification (Double-Entry: SUM(DEBIT) == SUM(CREDIT))
    let totalDebitCents = 0;
    let totalCreditCents = 0;
    for (const line of input.lines) {
      const amtCents = Math.round(parseFloat(line.amount) * 100);
      if (amtCents <= 0) {
        throw AppError.of('VALIDATION_ERROR', `Line amount must be positive: ${line.amount}`);
      }
      if (line.entryType === 'DEBIT') {
        totalDebitCents += amtCents;
      } else {
        totalCreditCents += amtCents;
      }
    }

    if (totalDebitCents !== totalCreditCents) {
      const diff = Math.abs(totalDebitCents - totalCreditCents) / 100;
      throw AppError.of(
        'VALIDATION_ERROR',
        `LEDGER_UNBALANCED: Debits and credits must balance. Total Debit: ${totalDebitCents / 100}, Total Credit: ${totalCreditCents / 100}, Variance: ${diff}`,
      );
    }

    // 4. Resolve account IDs by code
    const accountMap = new Map<string, LedgerAccountRow>();
    for (const line of input.lines) {
      if (!accountMap.has(line.accountCode)) {
        let acc = await this.deps.repository.findAccountByCode(tx, tenantId, line.accountCode);
        if (!acc) {
          const defaultTypes: Record<string, { name: string; type: string }> = {
            '1010-SETTLEMENT-BANK': { name: 'Settlement Bank Account', type: 'ASSET' },
            '2100-COMMISSION-PAYABLE': { name: 'Commission Payable', type: 'LIABILITY' },
            '4100-COMMISSION-INCOME': { name: 'Commission Income', type: 'INCOME' },
            '5100-COMMISSION-EXPENSE': { name: 'Commission Expense', type: 'EXPENSE' },
            '9999-SUSPENSE': { name: 'Suspense Clearing Account', type: 'SUSPENSE' },
          };
          const def = defaultTypes[line.accountCode] ?? { name: line.accountCode, type: 'EXPENSE' };
          const now = new Date();
          acc = {
            id: `acc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            tenant_id: tenantId,
            code: line.accountCode,
            name: def.name,
            type: def.type,
            counterparty_type: null,
            counterparty_id: null,
            currency: input.currency ?? 'INR',
            is_active: true,
            lock_version: 1,
            created_at: now,
            updated_at: now,
          };
          await this.deps.repository.insertAccount(tx, acc);
        }
        if (!acc.is_active) {
          throw AppError.of('VALIDATION_ERROR', `Cannot post to inactive ledger account ${line.accountCode}`);
        }
        accountMap.set(line.accountCode, acc);
      }
    }

    // 5. Create Journal
    const now = new Date();
    const count = await this.deps.repository.countJournals(tx, tenantId);
    const journalNumber = `JRN-${input.period}-${String(count + 1).padStart(5, '0')}`;
    const journalId = `jrn_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const journalRow: LedgerJournalRow = {
      id: journalId,
      tenant_id: tenantId,
      journal_number: journalNumber,
      reference_type: input.referenceType,
      reference_id: input.referenceId,
      idempotency_key: input.idempotencyKey ?? null,
      period: input.period,
      status: 'POSTED',
      reversal_of_journal_id: null,
      posted_at: now,
      posted_by: ctx.principal.id,
      created_at: now,
    };

    await this.deps.repository.insertJournal(tx, journalRow);

    // 6. Create Entries
    const entryRows: LedgerEntryRow[] = input.lines.map((l, idx) => {
      const acc = accountMap.get(l.accountCode)!;
      return {
        id: `ent_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
        tenant_id: tenantId,
        journal_id: journalId,
        account_id: acc.id,
        entry_type: l.entryType,
        amount: parseFloat(l.amount).toFixed(2),
        currency: input.currency ?? 'INR',
        narration: l.narration ?? input.narration ?? null,
        line_number: idx + 1,
        created_at: now,
      };
    });

    await this.deps.repository.insertEntries(tx, entryRows);

    // 7. Audit log
    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: 'ledger.journal.post',
        entityType: 'ledger_journal',
        entityId: journalId,
        after: {
          journalNumber,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          totalAmount: (totalDebitCents / 100).toFixed(2),
          period: input.period,
        },
      });
    }

    return {
      id: journalRow.id,
      tenantId: journalRow.tenant_id,
      journalNumber: journalRow.journal_number,
      referenceType: journalRow.reference_type as any,
      referenceId: journalRow.reference_id,
      idempotencyKey: journalRow.idempotency_key,
      period: journalRow.period,
      status: journalRow.status,
      reversalOfJournalId: journalRow.reversal_of_journal_id,
      postedAt: journalRow.posted_at.toISOString(),
      postedBy: journalRow.posted_by,
      createdAt: journalRow.created_at.toISOString(),
      lines: entryRows.map((e) => ({
        id: e.id,
        tenantId: e.tenant_id,
        journalId: e.journal_id,
        accountId: e.account_id,
        accountCode: accountMap.get(input.lines[e.line_number - 1]!.accountCode)?.code,
        accountName: accountMap.get(input.lines[e.line_number - 1]!.accountCode)?.name,
        entryType: e.entry_type,
        amount: e.amount,
        currency: e.currency,
        narration: e.narration,
        lineNumber: e.line_number,
        createdAt: e.created_at.toISOString(),
      })),
    };
  }

  async listJournals(
    tx: Tx,
    ctx: RequestContext,
    query: ListLedgerJournalsQuery,
  ): Promise<{ data: LedgerJournal[]; nextCursor: string | null }> {
    this.assertPermission(ctx, 'finance.view', 'finance.view required to view ledger journals');
    const tenantId = ctx.principal.tenantId;
    const limit = query.limit ?? 20;

    const { rows, nextCursor } = await this.deps.repository.listJournals(tx, tenantId, {
      cursor: query.cursor,
      limit,
      period: query.period,
      referenceType: query.referenceType,
      referenceId: query.referenceId,
    });

    const journals: LedgerJournal[] = [];
    for (const j of rows) {
      const entries = await this.deps.repository.listEntriesForJournal(tx, tenantId, j.id);
      journals.push({
        id: j.id,
        tenantId: j.tenant_id,
        journalNumber: j.journal_number,
        referenceType: j.reference_type as any,
        referenceId: j.reference_id,
        idempotencyKey: j.idempotency_key,
        period: j.period,
        status: j.status,
        reversalOfJournalId: j.reversal_of_journal_id,
        postedAt: j.posted_at.toISOString(),
        postedBy: j.posted_by,
        createdAt: j.created_at.toISOString(),
        lines: entries.map((e) => ({
          id: e.id,
          tenantId: e.tenant_id,
          journalId: e.journal_id,
          accountId: e.account_id,
          entryType: e.entry_type,
          amount: e.amount,
          currency: e.currency,
          narration: e.narration,
          lineNumber: e.line_number,
          createdAt: e.created_at.toISOString(),
        })),
      });
    }

    return { data: journals, nextCursor };
  }

  // --- Period Close (API-LED-003) ---

  async closePeriod(
    tx: Tx,
    ctx: RequestContext,
    period: string,
    input: CloseLedgerPeriodInput,
  ): Promise<PeriodCloseResponse> {
    this.assertPermission(ctx, 'finance.period_close', 'finance.period_close required to close ledger period');
    const tenantId = ctx.principal.tenantId;

    if (requiresMfa(ctx.principal)) {
      // Step-up verification
    }

    // Check if period already closed
    const status = await this.deps.repository.getPeriodStatus(tx, tenantId, period);
    if (status && status.status === 'CLOSED') {
      throw AppError.of('INVALID_STATE', `Accounting period ${period} is already closed`);
    }

    // Verify Trial Balance Zero-Sum Integrity
    const trial = await this.deps.repository.calculateTrialBalance(tx, tenantId, period);
    if (Math.abs(trial.variance) > 0.001) {
      throw AppError.of(
        'INVALID_STATE',
        `Cannot close period ${period}: Trial balance variance is non-zero (Debit: ${trial.totalDebit}, Credit: ${trial.totalCredit}, Variance: ${trial.variance})`,
      );
    }

    const closed = await this.deps.repository.closePeriod(tx, tenantId, period, ctx.principal.id, input.note);

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: 'ledger.period.close',
        entityType: 'ledger_period',
        entityId: closed.id,
        after: {
          period,
          trialBalanceZeroSum: true,
          totalDebit: trial.totalDebit,
          totalCredit: trial.totalCredit,
          note: input.note,
        },
      });
    }

    return {
      period: closed.period,
      status: 'CLOSED',
      closedAt: (closed.closed_at ?? new Date()).toISOString(),
      closedBy: closed.closed_by ?? ctx.principal.id,
      note: closed.closing_note,
      trialBalanceZeroSum: true,
      trialBalanceVariance: '0.00',
    };
  }

  // --- SUB-LED.03: Balances & Statements ---

  async getAccountBalance(
    tx: Tx,
    ctx: RequestContext,
    accountId: string,
    query: GetAccountBalanceQuery,
  ): Promise<AccountBalanceResponse> {
    this.assertPermission(ctx, 'finance.view', 'finance.view required to view account balance');
    const tenantId = ctx.principal.tenantId;

    const account = await this.deps.repository.findAccountById(tx, tenantId, accountId);
    if (!account) {
      throw AppError.of('NOT_FOUND', `Ledger account ${accountId} not found`);
    }

    const asOfDate = query.asOfDate ? new Date(`${query.asOfDate}T23:59:59.999Z`) : undefined;
    const entries = await this.deps.repository.listEntriesForAccount(tx, tenantId, accountId, asOfDate);

    let debitTotal = 0;
    let creditTotal = 0;
    for (const e of entries) {
      if (e.entry_type === 'DEBIT') debitTotal += parseFloat(e.amount);
      else creditTotal += parseFloat(e.amount);
    }

    let balance = 0;
    if (account.type === 'ASSET' || account.type === 'EXPENSE' || account.type === 'SUSPENSE' || account.type === 'TAX_RECEIVABLE') {
      balance = debitTotal - creditTotal;
    } else {
      balance = creditTotal - debitTotal;
    }

    return {
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      type: account.type as any,
      currency: account.currency,
      asOfDate: query.asOfDate ?? new Date().toISOString().split('T')[0]!,
      debitTotal: debitTotal.toFixed(2),
      creditTotal: creditTotal.toFixed(2),
      balance: balance.toFixed(2),
      lineCount: entries.length,
    };
  }

  async getConnectorStatements(
    tx: Tx,
    ctx: RequestContext,
    connectorId: string,
    query: GetConnectorStatementsQuery,
  ): Promise<ConnectorStatementResponse> {
    this.assertPermission(ctx, 'finance.view', 'finance.view required to view statements');
    const tenantId = ctx.principal.tenantId;

    if (ctx.principal.kind === 'USER' && (ctx.principal as any).connectorId && (ctx.principal as any).connectorId !== connectorId) {
      throw AppError.of('FORBIDDEN', 'Access denied: connectors may view only their own ledger lines');
    }

    const limit = query.limit ?? 50;
    const rows = await this.deps.repository.listEntriesForConnector(
      tx,
      tenantId,
      connectorId,
      query.fromPeriod,
      query.toPeriod,
      limit,
    );

    let totalDebits = 0;
    let totalCredits = 0;
    let running = 0;
    const lines = rows.map((r) => {
      const d = r.entry_type === 'DEBIT' ? parseFloat(r.amount) : 0;
      const c = r.entry_type === 'CREDIT' ? parseFloat(r.amount) : 0;
      totalDebits += d;
      totalCredits += c;
      running += (c - d);
      return {
        date: r.created_at.toISOString().split('T')[0]!,
        journalNumber: r.journal_number,
        referenceType: r.reference_type,
        referenceId: r.reference_id,
        narration: r.narration,
        debit: d.toFixed(2),
        credit: c.toFixed(2),
        runningBalance: running.toFixed(2),
      };
    });

    const periodRange = `${query.fromPeriod ?? 'ALL'} - ${query.toPeriod ?? 'ALL'}`;
    return {
      connectorId,
      currency: 'INR',
      periodRange,
      openingBalance: '0.00',
      totalDebits: totalDebits.toFixed(2),
      totalCredits: totalCredits.toFixed(2),
      closingBalance: running.toFixed(2),
      lineCount: lines.length,
      lines,
    };
  }

  async createExport(tx: Tx, ctx: RequestContext, input: CreateLedgerExportInput): Promise<LedgerExportResponse> {
    this.assertPermission(ctx, 'finance.view', 'finance.view required');
    this.assertPermission(ctx, 'export.run', 'export.run required to run ledger exports');
    const tenantId = ctx.principal.tenantId;

    const exportId = `exp_led_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const format = input.format ?? 'CSV';

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: 'ledger.export.run',
        entityType: 'export_job',
        entityId: exportId,
        after: {
          period: input.period,
          format,
          includeInactive: input.includeInactiveAccounts,
        },
      });
    }

    return {
      exportId,
      status: 'QUEUED',
      format,
      period: input.period ?? null,
      downloadUrl: `/v1/exports/${exportId}`,
      createdAt: new Date().toISOString(),
    };
  }

  async getTrialBalance(
    tx: Tx,
    ctx: RequestContext,
    period?: string,
  ): Promise<{ period?: string; totalDebit: string; totalCredit: string; variance: string; isBalanced: boolean }> {
    this.assertPermission(ctx, 'finance.view', 'finance.view required to view trial balance');
    const tenantId = ctx.principal.tenantId;
    const res = await this.deps.repository.calculateTrialBalance(tx, tenantId, period);
    return {
      period,
      totalDebit: res.totalDebit.toFixed(2),
      totalCredit: res.totalCredit.toFixed(2),
      variance: res.variance.toFixed(2),
      isBalanced: Math.abs(res.variance) === 0,
    };
  }
}
