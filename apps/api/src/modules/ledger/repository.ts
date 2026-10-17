// apps/api/src/modules/ledger/repository.ts — MOD-LED Ledger Management
import type { Tx } from '@dsa/contracts';
import { sql } from 'kysely';
import type { LedgerAccountRow, LedgerEntryRow, LedgerJournalRow, LedgerPeriodRow } from './types';

export interface LedgerRepository {
  // Accounts (SUB-LED.01)
  insertAccount(tx: Tx, row: LedgerAccountRow): Promise<void>;
  findAccountById(tx: Tx, tenantId: string, id: string): Promise<LedgerAccountRow | null>;
  findAccountByCode(tx: Tx, tenantId: string, code: string): Promise<LedgerAccountRow | null>;
  listAccounts(
    tx: Tx,
    tenantId: string,
    filters?: { counterpartyType?: string; counterpartyId?: string; type?: string; isActive?: boolean },
  ): Promise<LedgerAccountRow[]>;

  // Journals & Postings (SUB-LED.02)
  insertJournal(tx: Tx, row: LedgerJournalRow): Promise<void>;
  findJournalById(tx: Tx, tenantId: string, id: string): Promise<LedgerJournalRow | null>;
  findJournalByIdempotencyKey(tx: Tx, tenantId: string, key: string): Promise<LedgerJournalRow | null>;
  listJournals(
    tx: Tx,
    tenantId: string,
    filters: {
      cursor?: string;
      limit: number;
      period?: string;
      referenceType?: string;
      referenceId?: string;
    },
  ): Promise<{ rows: LedgerJournalRow[]; nextCursor: string | null }>;
  countJournals(tx: Tx, tenantId: string, period?: string): Promise<number>;

  // Entries (SUB-LED.02 / SUB-LED.03)
  insertEntries(tx: Tx, rows: LedgerEntryRow[]): Promise<void>;
  listEntriesForJournal(tx: Tx, tenantId: string, journalId: string): Promise<LedgerEntryRow[]>;
  listEntriesForAccount(
    tx: Tx,
    tenantId: string,
    accountId: string,
    asOfDate?: Date,
  ): Promise<LedgerEntryRow[]>;
  listEntriesForConnector(
    tx: Tx,
    tenantId: string,
    connectorId: string,
    fromPeriod?: string,
    toPeriod?: string,
    limit?: number,
  ): Promise<
    Array<
      LedgerEntryRow & {
        journal_number: string;
        reference_type: string;
        reference_id: string;
        period: string;
      }
    >
  >;

  // Periods (SUB-LED.02)
  getPeriodStatus(tx: Tx, tenantId: string, period: string): Promise<LedgerPeriodRow | null>;
  closePeriod(
    tx: Tx,
    tenantId: string,
    period: string,
    closedBy: string,
    note?: string,
  ): Promise<LedgerPeriodRow>;

  // Trial Balance (SUB-LED.03)
  calculateTrialBalance(
    tx: Tx,
    tenantId: string,
    period?: string,
  ): Promise<{ totalDebit: number; totalCredit: number; variance: number }>;
}

export class SqlLedgerRepository implements LedgerRepository {
  async insertAccount(tx: Tx, row: LedgerAccountRow): Promise<void> {
    await sql`
      INSERT INTO app.ledger_account (
        id, tenant_id, code, name, type, counterparty_type, counterparty_id,
        currency, is_active, lock_version, created_at, updated_at
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.code}, ${row.name}, ${row.type},
        ${row.counterparty_type}, ${row.counterparty_id}, ${row.currency},
        ${row.is_active}, ${row.lock_version}, ${row.created_at}, ${row.updated_at}
      )
    `.execute(tx);
  }

  async findAccountById(tx: Tx, tenantId: string, id: string): Promise<LedgerAccountRow | null> {
    const res = await sql<LedgerAccountRow>`
      SELECT * FROM app.ledger_account
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async findAccountByCode(tx: Tx, tenantId: string, code: string): Promise<LedgerAccountRow | null> {
    const res = await sql<LedgerAccountRow>`
      SELECT * FROM app.ledger_account
      WHERE tenant_id = ${tenantId} AND code = ${code}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async listAccounts(
    tx: Tx,
    tenantId: string,
    filters?: { counterpartyType?: string; counterpartyId?: string; type?: string; isActive?: boolean },
  ): Promise<LedgerAccountRow[]> {
    let query = sql<LedgerAccountRow>`SELECT * FROM app.ledger_account WHERE tenant_id = ${tenantId}`;
    if (filters?.type) {
      query = sql<LedgerAccountRow>`${query} AND type = ${filters.type}`;
    }
    if (filters?.counterpartyType) {
      query = sql<LedgerAccountRow>`${query} AND counterparty_type = ${filters.counterpartyType}`;
    }
    if (filters?.counterpartyId) {
      query = sql<LedgerAccountRow>`${query} AND counterparty_id = ${filters.counterpartyId}`;
    }
    if (filters?.isActive !== undefined) {
      query = sql<LedgerAccountRow>`${query} AND is_active = ${filters.isActive}`;
    }
    query = sql<LedgerAccountRow>`${query} ORDER BY code ASC`;
    const res = await query.execute(tx);
    return res.rows as LedgerAccountRow[];
  }

  async insertJournal(tx: Tx, row: LedgerJournalRow): Promise<void> {
    await sql`
      INSERT INTO app.ledger_journal (
        id, tenant_id, journal_number, reference_type, reference_id,
        idempotency_key, period, status, reversal_of_journal_id,
        posted_at, posted_by, created_at
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.journal_number}, ${row.reference_type},
        ${row.reference_id}, ${row.idempotency_key}, ${row.period}, ${row.status},
        ${row.reversal_of_journal_id}, ${row.posted_at}, ${row.posted_by}, ${row.created_at}
      )
    `.execute(tx);
  }

  async findJournalById(tx: Tx, tenantId: string, id: string): Promise<LedgerJournalRow | null> {
    const res = await sql<LedgerJournalRow>`
      SELECT * FROM app.ledger_journal
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async findJournalByIdempotencyKey(tx: Tx, tenantId: string, key: string): Promise<LedgerJournalRow | null> {
    const res = await sql<LedgerJournalRow>`
      SELECT * FROM app.ledger_journal
      WHERE tenant_id = ${tenantId} AND idempotency_key = ${key}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async listJournals(
    tx: Tx,
    tenantId: string,
    filters: {
      cursor?: string;
      limit: number;
      period?: string;
      referenceType?: string;
      referenceId?: string;
    },
  ): Promise<{ rows: LedgerJournalRow[]; nextCursor: string | null }> {
    let query = sql<LedgerJournalRow>`SELECT * FROM app.ledger_journal WHERE tenant_id = ${tenantId}`;
    if (filters.period) {
      query = sql<LedgerJournalRow>`${query} AND period = ${filters.period}`;
    }
    if (filters.referenceType) {
      query = sql<LedgerJournalRow>`${query} AND reference_type = ${filters.referenceType}`;
    }
    if (filters.referenceId) {
      query = sql<LedgerJournalRow>`${query} AND reference_id = ${filters.referenceId}`;
    }
    if (filters.cursor) {
      query = sql<LedgerJournalRow>`${query} AND id < ${filters.cursor}`;
    }
    query = sql<LedgerJournalRow>`${query} ORDER BY posted_at DESC, id DESC LIMIT ${filters.limit + 1}`;
    const res = await query.execute(tx);
    const rows = res.rows as LedgerJournalRow[];
    let nextCursor: string | null = null;
    if (rows.length > filters.limit) {
      rows.pop();
      nextCursor = rows[rows.length - 1]?.id ?? null;
    }
    return { rows, nextCursor };
  }

  async countJournals(tx: Tx, tenantId: string, period?: string): Promise<number> {
    let query = sql<{
      count: string;
    }>`SELECT count(*) as count FROM app.ledger_journal WHERE tenant_id = ${tenantId}`;
    if (period) {
      query = sql<{ count: string }>`${query} AND period = ${period}`;
    }
    const res = await query.execute(tx);
    return parseInt(res.rows[0]?.count ?? '0', 10);
  }

  async insertEntries(tx: Tx, rows: LedgerEntryRow[]): Promise<void> {
    for (const r of rows) {
      await sql`
        INSERT INTO app.ledger_entry (
          id, tenant_id, journal_id, account_id, entry_type,
          amount, currency, narration, line_number, created_at
        ) VALUES (
          ${r.id}, ${r.tenant_id}, ${r.journal_id}, ${r.account_id}, ${r.entry_type},
          ${r.amount}, ${r.currency}, ${r.narration}, ${r.line_number}, ${r.created_at}
        )
      `.execute(tx);
    }
  }

  async listEntriesForJournal(tx: Tx, tenantId: string, journalId: string): Promise<LedgerEntryRow[]> {
    const res = await sql<LedgerEntryRow>`
      SELECT * FROM app.ledger_entry
      WHERE tenant_id = ${tenantId} AND journal_id = ${journalId}
      ORDER BY line_number ASC
    `.execute(tx);
    return res.rows as LedgerEntryRow[];
  }

  async listEntriesForAccount(
    tx: Tx,
    tenantId: string,
    accountId: string,
    asOfDate?: Date,
  ): Promise<LedgerEntryRow[]> {
    let query = sql<LedgerEntryRow>`
      SELECT * FROM app.ledger_entry
      WHERE tenant_id = ${tenantId} AND account_id = ${accountId}
    `;
    if (asOfDate) {
      query = sql<LedgerEntryRow>`${query} AND created_at <= ${asOfDate.toISOString()}`;
    }
    query = sql<LedgerEntryRow>`${query} ORDER BY created_at ASC`;
    const res = await query.execute(tx);
    return res.rows as LedgerEntryRow[];
  }

  async listEntriesForConnector(
    tx: Tx,
    tenantId: string,
    connectorId: string,
    fromPeriod?: string,
    toPeriod?: string,
    limit = 50,
  ): Promise<
    Array<
      LedgerEntryRow & {
        journal_number: string;
        reference_type: string;
        reference_id: string;
        period: string;
      }
    >
  > {
    let query = sql<any>`
      SELECT e.*, j.journal_number, j.reference_type, j.reference_id, j.period
      FROM app.ledger_entry e
      JOIN app.ledger_account a ON a.tenant_id = e.tenant_id AND a.id = e.account_id
      JOIN app.ledger_journal j ON j.tenant_id = e.tenant_id AND j.id = e.journal_id
      WHERE e.tenant_id = ${tenantId}
        AND a.counterparty_type = 'CONNECTOR'
        AND a.counterparty_id = ${connectorId}
    `;
    if (fromPeriod) {
      query = sql<any>`${query} AND j.period >= ${fromPeriod}`;
    }
    if (toPeriod) {
      query = sql<any>`${query} AND j.period <= ${toPeriod}`;
    }
    query = sql<any>`${query} ORDER BY e.created_at ASC LIMIT ${limit}`;
    const res = await query.execute(tx);
    return res.rows;
  }

  async getPeriodStatus(tx: Tx, tenantId: string, period: string): Promise<LedgerPeriodRow | null> {
    const res = await sql<LedgerPeriodRow>`
      SELECT * FROM app.ledger_period
      WHERE tenant_id = ${tenantId} AND period = ${period}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async closePeriod(
    tx: Tx,
    tenantId: string,
    period: string,
    closedBy: string,
    note?: string,
  ): Promise<LedgerPeriodRow> {
    const existing = await this.getPeriodStatus(tx, tenantId, period);
    const now = new Date();
    if (existing) {
      await sql`
        UPDATE app.ledger_period
        SET status = 'CLOSED', closed_at = ${now}, closed_by = ${closedBy}, closing_note = ${note ?? null}
        WHERE tenant_id = ${tenantId} AND period = ${period}
      `.execute(tx);
      return {
        ...existing,
        status: 'CLOSED',
        closed_at: now,
        closed_by: closedBy,
        closing_note: note ?? null,
      };
    }
    const id = `prd_${Date.now()}`;
    await sql`
      INSERT INTO app.ledger_period (id, tenant_id, period, status, closed_at, closed_by, closing_note, created_at)
      VALUES (${id}, ${tenantId}, ${period}, 'CLOSED', ${now}, ${closedBy}, ${note ?? null}, ${now})
    `.execute(tx);
    return {
      id,
      tenant_id: tenantId,
      period,
      status: 'CLOSED',
      closed_at: now,
      closed_by: closedBy,
      closing_note: note ?? null,
      created_at: now,
    };
  }

  async calculateTrialBalance(
    tx: Tx,
    tenantId: string,
    period?: string,
  ): Promise<{ totalDebit: number; totalCredit: number; variance: number }> {
    let query = sql<{ debit: string; credit: string }>`
      SELECT 
        COALESCE(SUM(CASE WHEN e.entry_type = 'DEBIT' THEN e.amount ELSE 0 END), 0) as debit,
        COALESCE(SUM(CASE WHEN e.entry_type = 'CREDIT' THEN e.amount ELSE 0 END), 0) as credit
      FROM app.ledger_entry e
      JOIN app.ledger_journal j ON j.tenant_id = e.tenant_id AND j.id = e.journal_id
      WHERE e.tenant_id = ${tenantId}
    `;
    if (period) {
      query = sql<any>`${query} AND j.period = ${period}`;
    }
    const res = await query.execute(tx);
    const totalDebit = parseFloat(res.rows[0]?.debit ?? '0');
    const totalCredit = parseFloat(res.rows[0]?.credit ?? '0');
    const variance = Math.round((totalDebit - totalCredit) * 100) / 100;
    return { totalDebit, totalCredit, variance };
  }
}

export class InMemoryLedgerRepository implements LedgerRepository {
  accounts: LedgerAccountRow[] = [];
  journals: LedgerJournalRow[] = [];
  entries: LedgerEntryRow[] = [];
  periods: LedgerPeriodRow[] = [];

  constructor() {
    // Seed default system accounts
    this.seedDefaultAccounts('test-tenant');
  }

  seedDefaultAccounts(tenantId: string) {
    const defaults: Partial<LedgerAccountRow>[] = [
      {
        id: `acc_bank_${tenantId}`,
        code: '1010-SETTLEMENT-BANK',
        name: 'Settlement Bank Account',
        type: 'ASSET',
        is_active: true,
      },
      {
        id: `acc_pay_${tenantId}`,
        code: '2100-COMMISSION-PAYABLE',
        name: 'Commission Payable',
        type: 'LIABILITY',
        is_active: true,
      },
      {
        id: `acc_inc_${tenantId}`,
        code: '4100-COMMISSION-INCOME',
        name: 'Commission Income',
        type: 'INCOME',
        is_active: true,
      },
      {
        id: `acc_exp_${tenantId}`,
        code: '5100-COMMISSION-EXPENSE',
        name: 'Commission Expense',
        type: 'EXPENSE',
        is_active: true,
      },
      {
        id: `acc_susp_${tenantId}`,
        code: '9999-SUSPENSE',
        name: 'Suspense Clearing Account',
        type: 'SUSPENSE',
        is_active: true,
      },
      {
        id: `acc_tax_pay_${tenantId}`,
        code: '2200-TAX-PAYABLE',
        name: 'Tax Payable',
        type: 'TAX_PAYABLE',
        is_active: false,
      },
      {
        id: `acc_tax_rec_${tenantId}`,
        code: '1200-TAX-RECEIVABLE',
        name: 'Tax Receivable',
        type: 'TAX_RECEIVABLE',
        is_active: false,
      },
    ];
    for (const d of defaults) {
      if (!this.accounts.some((a) => a.tenant_id === tenantId && a.code === d.code)) {
        this.accounts.push({
          id: d.id!,
          tenant_id: tenantId,
          code: d.code!,
          name: d.name!,
          type: d.type!,
          counterparty_type: null,
          counterparty_id: null,
          currency: 'INR',
          is_active: d.is_active!,
          lock_version: 1,
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
    }
  }

  async insertAccount(_tx: Tx, row: LedgerAccountRow): Promise<void> {
    if (this.accounts.some((a) => a.tenant_id === row.tenant_id && a.code === row.code)) {
      throw new Error(`UNIQUE_CONSTRAINT_VIOLATION: Account code ${row.code} already exists`);
    }
    if ((row.type === 'TAX_PAYABLE' || row.type === 'TAX_RECEIVABLE') && row.is_active) {
      throw new Error(`CHECK_CONSTRAINT_VIOLATION: chk_tax_accounts_inactive`);
    }
    this.accounts.push({ ...row });
  }

  async findAccountById(_tx: Tx, tenantId: string, id: string): Promise<LedgerAccountRow | null> {
    return this.accounts.find((a) => a.tenant_id === tenantId && a.id === id) ?? null;
  }

  async findAccountByCode(_tx: Tx, tenantId: string, code: string): Promise<LedgerAccountRow | null> {
    return this.accounts.find((a) => a.tenant_id === tenantId && a.code === code) ?? null;
  }

  async listAccounts(
    _tx: Tx,
    tenantId: string,
    filters?: { counterpartyType?: string; counterpartyId?: string; type?: string; isActive?: boolean },
  ): Promise<LedgerAccountRow[]> {
    return this.accounts.filter((a) => {
      if (a.tenant_id !== tenantId) return false;
      if (filters?.type && a.type !== filters.type) return false;
      if (filters?.counterpartyType && a.counterparty_type !== filters.counterpartyType) return false;
      if (filters?.counterpartyId && a.counterparty_id !== filters.counterpartyId) return false;
      if (filters?.isActive !== undefined && a.is_active !== filters.isActive) return false;
      return true;
    });
  }

  async insertJournal(_tx: Tx, row: LedgerJournalRow): Promise<void> {
    if (this.journals.some((j) => j.tenant_id === row.tenant_id && j.journal_number === row.journal_number)) {
      throw new Error(`UNIQUE_CONSTRAINT_VIOLATION: Journal number ${row.journal_number} already exists`);
    }
    if (
      row.idempotency_key &&
      this.journals.some((j) => j.tenant_id === row.tenant_id && j.idempotency_key === row.idempotency_key)
    ) {
      throw new Error(`UNIQUE_CONSTRAINT_VIOLATION: Idempotency key ${row.idempotency_key} already used`);
    }
    this.journals.push({ ...row });
  }

  async findJournalById(_tx: Tx, tenantId: string, id: string): Promise<LedgerJournalRow | null> {
    return this.journals.find((j) => j.tenant_id === tenantId && j.id === id) ?? null;
  }

  async findJournalByIdempotencyKey(
    _tx: Tx,
    tenantId: string,
    key: string,
  ): Promise<LedgerJournalRow | null> {
    return this.journals.find((j) => j.tenant_id === tenantId && j.idempotency_key === key) ?? null;
  }

  async listJournals(
    _tx: Tx,
    tenantId: string,
    filters: {
      cursor?: string;
      limit: number;
      period?: string;
      referenceType?: string;
      referenceId?: string;
    },
  ): Promise<{ rows: LedgerJournalRow[]; nextCursor: string | null }> {
    let list = this.journals.filter((j) => {
      if (j.tenant_id !== tenantId) return false;
      if (filters.period && j.period !== filters.period) return false;
      if (filters.referenceType && j.reference_type !== filters.referenceType) return false;
      if (filters.referenceId && j.reference_id !== filters.referenceId) return false;
      return true;
    });
    list.sort((a, b) => b.posted_at.getTime() - a.posted_at.getTime());
    if (filters.cursor) {
      const idx = list.findIndex((j) => j.id === filters.cursor);
      if (idx !== -1) list = list.slice(idx + 1);
    }
    const rows = list.slice(0, filters.limit);
    const nextCursor = list.length > filters.limit ? (rows[rows.length - 1]?.id ?? null) : null;
    return { rows, nextCursor };
  }

  async countJournals(_tx: Tx, tenantId: string, period?: string): Promise<number> {
    return this.journals.filter((j) => j.tenant_id === tenantId && (!period || j.period === period)).length;
  }

  async insertEntries(_tx: Tx, rows: LedgerEntryRow[]): Promise<void> {
    // Simulate PostgreSQL deferred trigger validation
    const byJournal: Record<string, { debits: number; credits: number }> = {};
    for (const r of rows) {
      if (parseFloat(r.amount) <= 0) {
        throw new Error('CHECK_CONSTRAINT_VIOLATION: amount must be positive');
      }
      if (!byJournal[r.journal_id]) {
        byJournal[r.journal_id] = { debits: 0, credits: 0 };
      }
      if (r.entry_type === 'DEBIT') {
        byJournal[r.journal_id]!.debits += Math.round(parseFloat(r.amount) * 100);
      } else {
        byJournal[r.journal_id]!.credits += Math.round(parseFloat(r.amount) * 100);
      }
    }
    for (const [jId, balance] of Object.entries(byJournal)) {
      if (balance.debits !== balance.credits) {
        throw new Error(
          `LEDGER_UNBALANCED: Journal ${jId} entries must balance. Debits: ${balance.debits}, Credits: ${balance.credits}`,
        );
      }
    }
    this.entries.push(...rows.map((r) => ({ ...r })));
  }

  async listEntriesForJournal(_tx: Tx, tenantId: string, journalId: string): Promise<LedgerEntryRow[]> {
    return this.entries
      .filter((e) => e.tenant_id === tenantId && e.journal_id === journalId)
      .sort((a, b) => a.line_number - b.line_number);
  }

  async listEntriesForAccount(
    _tx: Tx,
    tenantId: string,
    accountId: string,
    asOfDate?: Date,
  ): Promise<LedgerEntryRow[]> {
    return this.entries
      .filter((e) => {
        if (e.tenant_id !== tenantId || e.account_id !== accountId) return false;
        if (asOfDate && e.created_at.getTime() > asOfDate.getTime()) return false;
        return true;
      })
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  }

  async listEntriesForConnector(
    _tx: Tx,
    tenantId: string,
    connectorId: string,
    fromPeriod?: string,
    toPeriod?: string,
    limit = 50,
  ): Promise<
    Array<
      LedgerEntryRow & {
        journal_number: string;
        reference_type: string;
        reference_id: string;
        period: string;
      }
    >
  > {
    const connAccounts = this.accounts.filter(
      (a) =>
        a.tenant_id === tenantId && a.counterparty_type === 'CONNECTOR' && a.counterparty_id === connectorId,
    );
    const connAccountIds = new Set(connAccounts.map((a) => a.id));
    const results: any[] = [];
    for (const entry of this.entries) {
      if (entry.tenant_id !== tenantId || !connAccountIds.has(entry.account_id)) continue;
      const journal = this.journals.find((j) => j.tenant_id === tenantId && j.id === entry.journal_id);
      if (!journal) continue;
      if (fromPeriod && journal.period < fromPeriod) continue;
      if (toPeriod && journal.period > toPeriod) continue;
      results.push({
        ...entry,
        journal_number: journal.journal_number,
        reference_type: journal.reference_type,
        reference_id: journal.reference_id,
        period: journal.period,
      });
      if (results.length >= limit) break;
    }
    return results;
  }

  async getPeriodStatus(_tx: Tx, tenantId: string, period: string): Promise<LedgerPeriodRow | null> {
    return this.periods.find((p) => p.tenant_id === tenantId && p.period === period) ?? null;
  }

  async closePeriod(
    _tx: Tx,
    tenantId: string,
    period: string,
    closedBy: string,
    note?: string,
  ): Promise<LedgerPeriodRow> {
    let p = this.periods.find((x) => x.tenant_id === tenantId && x.period === period);
    const now = new Date();
    if (p) {
      p.status = 'CLOSED';
      p.closed_at = now;
      p.closed_by = closedBy;
      p.closing_note = note ?? null;
      return { ...p };
    }
    p = {
      id: `prd_${Date.now()}`,
      tenant_id: tenantId,
      period,
      status: 'CLOSED',
      closed_at: now,
      closed_by: closedBy,
      closing_note: note ?? null,
      created_at: now,
    };
    this.periods.push(p);
    return { ...p };
  }

  async calculateTrialBalance(
    _tx: Tx,
    tenantId: string,
    period?: string,
  ): Promise<{ totalDebit: number; totalCredit: number; variance: number }> {
    let entries = this.entries.filter((e) => e.tenant_id === tenantId);
    if (period) {
      const journalIds = new Set(
        this.journals.filter((j) => j.tenant_id === tenantId && j.period === period).map((j) => j.id),
      );
      entries = entries.filter((e) => journalIds.has(e.journal_id));
    }
    let totalDebit = 0;
    let totalCredit = 0;
    for (const e of entries) {
      if (e.entry_type === 'DEBIT') totalDebit += parseFloat(e.amount);
      else totalCredit += parseFloat(e.amount);
    }
    const variance = Math.round((totalDebit - totalCredit) * 100) / 100;
    return { totalDebit, totalCredit, variance };
  }
}
