// apps/api/src/modules/invoices/repository.ts — Module 33: Invoices & Statements repository
import {
  AppError,
  type CreateInvoiceInput,
  type InvoiceDirection,
  type InvoiceListQuery,
  type InvoiceRecord,
  type InvoiceStatus,
  type LedgerEntryRecord,
  type LedgerEntryType,
  type TaxFields,
  type Tx,
} from '@dsa/contracts';
import { sql } from 'kysely';
import type { InvoiceRow, LedgerEntryRow } from './types';

export type CreateInvoiceData = Omit<CreateInvoiceInput, 'taxFields' | 'calculationIds'> & {
  id: string;
  createdBy: string;
  taxFields?: TaxFields;
  calculationIds?: string[];
};

export interface InvoiceRepository {
  createInvoice(
    tx: Tx,
    tenantId: string,
    invoice: CreateInvoiceData,
  ): Promise<InvoiceRecord>;
  findInvoiceById(tx: Tx, tenantId: string, id: string): Promise<InvoiceRecord | null>;
  findInvoiceByNumber(
    tx: Tx,
    tenantId: string,
    direction: InvoiceDirection,
    number: string,
  ): Promise<InvoiceRecord | null>;
  listInvoices(
    tx: Tx,
    tenantId: string,
    query: InvoiceListQuery,
  ): Promise<{ items: InvoiceRecord[]; nextCursor: string | null }>;
  updateInvoiceStatus(
    tx: Tx,
    tenantId: string,
    id: string,
    status: InvoiceStatus,
    expectedLockVersion: number | undefined,
    updatedBy: string,
    notes?: string,
  ): Promise<InvoiceRecord>;
  createLedgerEntry(
    tx: Tx,
    tenantId: string,
    entry: {
      id: string;
      connectorId: string;
      entryType: LedgerEntryType;
      amount: number;
      currency?: string;
      referenceId?: string | null;
      description?: string | null;
      entryDate?: string;
      balanceAfter: number;
      createdBy: string;
    },
  ): Promise<LedgerEntryRecord>;
  listLedgerEntries(
    tx: Tx,
    tenantId: string,
    connectorId: string,
    fromDate?: string,
    toDate?: string,
    limit?: number,
  ): Promise<LedgerEntryRecord[]>;
  getOpeningBalance(tx: Tx, tenantId: string, connectorId: string, beforeDate: string): Promise<number>;
  getConnectorCommissionPayables(
    tx: Tx,
    tenantId: string,
    connectorId: string,
    fromDate?: string,
    toDate?: string,
  ): Promise<Array<{ id: string; calculationId: string; amount: number; state: string; createdAt: string }>>;
}

function toIsoDate(val: string | Date | null | undefined): string | null {
  if (!val) return null;
  if (typeof val === 'string') return val.split('T')[0] ?? val;
  return val.toISOString().split('T')[0] ?? null;
}

function toIsoTimestamp(val: string | Date): string {
  if (typeof val === 'string') return val;
  return val.toISOString();
}

function mapInvoiceRow(row: InvoiceRow): InvoiceRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    direction: row.direction,
    number: row.number,
    date: toIsoDate(row.date) ?? '',
    dueDate: toIsoDate(row.due_date),
    amount: Number(row.amount),
    currency: row.currency || 'INR',
    taxFields: typeof row.tax_fields === 'string' ? JSON.parse(row.tax_fields) : (row.tax_fields ?? {}),
    status: row.status,
    calculationIds: row.calculation_ids ?? [],
    partyId: row.party_id,
    partyName: row.party_name,
    notes: row.notes,
    lockVersion: row.lock_version,
    createdAt: toIsoTimestamp(row.created_at),
    createdBy: row.created_by,
    updatedAt: toIsoTimestamp(row.updated_at),
    updatedBy: row.updated_by,
  };
}

function mapLedgerEntryRow(row: LedgerEntryRow): LedgerEntryRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    connectorId: row.connector_id,
    entryType: row.entry_type,
    amount: Number(row.amount),
    currency: row.currency || 'INR',
    referenceId: row.reference_id,
    description: row.description,
    entryDate: toIsoDate(row.entry_date) ?? '',
    balanceAfter: Number(row.balance_after),
    lockVersion: row.lock_version,
    createdAt: toIsoTimestamp(row.created_at),
    createdBy: row.created_by,
    updatedAt: toIsoTimestamp(row.updated_at),
    updatedBy: row.updated_by,
  };
}

export class SqlInvoiceRepository implements InvoiceRepository {
  async createInvoice(
    tx: Tx,
    tenantId: string,
    invoice: CreateInvoiceData,
  ): Promise<InvoiceRecord> {
    const taxFieldsJson = JSON.stringify(invoice.taxFields ?? {});
    const calculationIds = invoice.calculationIds ?? [];

    const res = await sql<InvoiceRow>`
      INSERT INTO invoice (
        id, tenant_id, direction, number, date, due_date,
        amount, currency, tax_fields, status, calculation_ids,
        party_id, party_name, notes, lock_version,
        created_at, created_by, updated_at, updated_by
      ) VALUES (
        ${invoice.id}, ${tenantId}, ${invoice.direction}, ${invoice.number}, ${invoice.date}::date,
        ${invoice.dueDate ? sql`${invoice.dueDate}::date` : null},
        ${invoice.amount}, ${invoice.currency ?? 'INR'}, ${taxFieldsJson}::jsonb, 'DRAFT', ${calculationIds},
        ${invoice.partyId}, ${invoice.partyName ?? null}, ${invoice.notes ?? null}, 0,
        now(), ${invoice.createdBy}, now(), ${invoice.createdBy}
      )
      RETURNING *
    `.execute(tx);

    const row = res.rows[0];
    if (!row) {
      throw AppError.of('INTERNAL_ERROR', 'Failed to insert invoice');
    }
    return mapInvoiceRow(row);
  }

  async findInvoiceById(tx: Tx, tenantId: string, id: string): Promise<InvoiceRecord | null> {
    const res = await sql<InvoiceRow>`
      SELECT * FROM invoice
      WHERE tenant_id = ${tenantId} AND id = ${id}
      LIMIT 1
    `.execute(tx);

    const row = res.rows[0];
    return row ? mapInvoiceRow(row) : null;
  }

  async findInvoiceByNumber(
    tx: Tx,
    tenantId: string,
    direction: InvoiceDirection,
    number: string,
  ): Promise<InvoiceRecord | null> {
    const res = await sql<InvoiceRow>`
      SELECT * FROM invoice
      WHERE tenant_id = ${tenantId} AND direction = ${direction} AND number = ${number}
      LIMIT 1
    `.execute(tx);

    const row = res.rows[0];
    return row ? mapInvoiceRow(row) : null;
  }

  async listInvoices(
    tx: Tx,
    tenantId: string,
    query: InvoiceListQuery,
  ): Promise<{ items: InvoiceRecord[]; nextCursor: string | null }> {
    const limit = query.limit ?? 50;

    let res;
    if (query.cursor) {
      res = await sql<InvoiceRow>`
        SELECT * FROM invoice
        WHERE tenant_id = ${tenantId}
          AND (${query.direction ?? null}::text IS NULL OR direction = ${query.direction})
          AND (${query.status ?? null}::text IS NULL OR status = ${query.status})
          AND (${query.partyId ?? null}::text IS NULL OR party_id = ${query.partyId})
          AND (
            ${query.search ?? null}::text IS NULL 
            OR number ILIKE ${'%' + (query.search ?? '') + '%'}
            OR party_name ILIKE ${'%' + (query.search ?? '') + '%'}
          )
          AND (date, id) < (
            (SELECT date FROM invoice WHERE id = ${query.cursor} AND tenant_id = ${tenantId}),
            ${query.cursor}
          )
        ORDER BY date DESC, id DESC
        LIMIT ${limit + 1}
      `.execute(tx);
    } else {
      res = await sql<InvoiceRow>`
        SELECT * FROM invoice
        WHERE tenant_id = ${tenantId}
          AND (${query.direction ?? null}::text IS NULL OR direction = ${query.direction})
          AND (${query.status ?? null}::text IS NULL OR status = ${query.status})
          AND (${query.partyId ?? null}::text IS NULL OR party_id = ${query.partyId})
          AND (
            ${query.search ?? null}::text IS NULL 
            OR number ILIKE ${'%' + (query.search ?? '') + '%'}
            OR party_name ILIKE ${'%' + (query.search ?? '') + '%'}
          )
        ORDER BY date DESC, id DESC
        LIMIT ${limit + 1}
      `.execute(tx);
    }

    const rows = res.rows;
    let nextCursor: string | null = null;
    let items = rows;
    if (rows.length > limit) {
      items = rows.slice(0, limit);
      nextCursor = items[items.length - 1]!.id;
    }

    return {
      items: items.map(mapInvoiceRow),
      nextCursor,
    };
  }

  async updateInvoiceStatus(
    tx: Tx,
    tenantId: string,
    id: string,
    status: InvoiceStatus,
    expectedLockVersion: number | undefined,
    updatedBy: string,
    notes?: string,
  ): Promise<InvoiceRecord> {
    let res;
    if (expectedLockVersion !== undefined) {
      res = await sql<InvoiceRow>`
        UPDATE invoice
        SET status = ${status},
            notes = COALESCE(${notes ?? null}, notes),
            lock_version = lock_version + 1,
            updated_at = now(),
            updated_by = ${updatedBy}
        WHERE tenant_id = ${tenantId} AND id = ${id} AND lock_version = ${expectedLockVersion}
        RETURNING *
      `.execute(tx);
    } else {
      res = await sql<InvoiceRow>`
        UPDATE invoice
        SET status = ${status},
            notes = COALESCE(${notes ?? null}, notes),
            lock_version = lock_version + 1,
            updated_at = now(),
            updated_by = ${updatedBy}
        WHERE tenant_id = ${tenantId} AND id = ${id}
        RETURNING *
      `.execute(tx);
    }

    const row = res.rows[0];
    if (!row) {
      // Check if it was a lock version conflict or not found
      const existing = await this.findInvoiceById(tx, tenantId, id);
      if (!existing) {
        throw AppError.of('NOT_FOUND', 'Invoice not found');
      }
      throw AppError.of('VERSION_CONFLICT', 'Conflict: Invoice was modified concurrently (lock_version mismatch)');
    }
    return mapInvoiceRow(row);
  }

  async createLedgerEntry(
    tx: Tx,
    tenantId: string,
    entry: {
      id: string;
      connectorId: string;
      entryType: LedgerEntryType;
      amount: number;
      currency?: string;
      referenceId?: string | null;
      description?: string | null;
      entryDate?: string;
      balanceAfter: number;
      createdBy: string;
    },
  ): Promise<LedgerEntryRecord> {
    const entryDate = entry.entryDate ? sql`${entry.entryDate}::date` : sql`CURRENT_DATE`;

    const res = await sql<LedgerEntryRow>`
      INSERT INTO connector_statement_entry (
        id, tenant_id, connector_id, entry_type, amount,
        currency, reference_id, description, entry_date, balance_after,
        lock_version, created_at, created_by, updated_at, updated_by
      ) VALUES (
        ${entry.id}, ${tenantId}, ${entry.connectorId}, ${entry.entryType}, ${entry.amount},
        ${entry.currency ?? 'INR'}, ${entry.referenceId ?? null}, ${entry.description ?? null},
        ${entryDate}, ${entry.balanceAfter},
        0, now(), ${entry.createdBy}, now(), ${entry.createdBy}
      )
      RETURNING *
    `.execute(tx);

    const row = res.rows[0];
    if (!row) {
      throw AppError.of('INTERNAL_ERROR', 'Failed to insert ledger entry');
    }
    return mapLedgerEntryRow(row);
  }

  async listLedgerEntries(
    tx: Tx,
    tenantId: string,
    connectorId: string,
    fromDate?: string,
    toDate?: string,
    limit = 100,
  ): Promise<LedgerEntryRecord[]> {
    const res = await sql<LedgerEntryRow>`
      SELECT * FROM connector_statement_entry
      WHERE tenant_id = ${tenantId}
        AND connector_id = ${connectorId}
        AND (${fromDate ?? null}::date IS NULL OR entry_date >= ${fromDate}::date)
        AND (${toDate ?? null}::date IS NULL OR entry_date <= ${toDate}::date)
      ORDER BY entry_date ASC, created_at ASC, id ASC
      LIMIT ${limit}
    `.execute(tx);

    return res.rows.map(mapLedgerEntryRow);
  }

  async getOpeningBalance(
    tx: Tx,
    tenantId: string,
    connectorId: string,
    beforeDate: string,
  ): Promise<number> {
    interface BalRow {
      balance: string | number | null;
    }
    // Sum of amounts before the start date
    // COMMISSION_EARNED, OPENING_BALANCE, positive ADJUSTMENT = credits
    // PAYOUT_DISBURSED, TAX_DEDUCTION = debits (negative)
    const res = await sql<BalRow>`
      SELECT COALESCE(SUM(
        CASE 
          WHEN entry_type IN ('COMMISSION_EARNED', 'OPENING_BALANCE') THEN amount
          WHEN entry_type IN ('PAYOUT_DISBURSED', 'TAX_DEDUCTION') THEN -amount
          WHEN entry_type = 'ADJUSTMENT' THEN amount
          ELSE 0
        END
      ), 0) as balance
      FROM connector_statement_entry
      WHERE tenant_id = ${tenantId}
        AND connector_id = ${connectorId}
        AND entry_date < ${beforeDate}::date
    `.execute(tx);

    return Number(res.rows[0]?.balance ?? 0);
  }

  async getConnectorCommissionPayables(
    tx: Tx,
    tenantId: string,
    connectorId: string,
    fromDate?: string,
    toDate?: string,
  ): Promise<Array<{ id: string; calculationId: string; amount: number; state: string; createdAt: string }>> {
    interface PayableRow {
      id: string;
      calculation_id: string;
      amount: string | number;
      state: string;
      created_at: string | Date;
    }

    const res = await sql<PayableRow>`
      SELECT id, calculation_id, amount, state, created_at
      FROM commission_payable
      WHERE tenant_id = ${tenantId}
        AND connector_id = ${connectorId}
        AND (${fromDate ?? null}::date IS NULL OR created_at >= ${fromDate}::date)
        AND (${toDate ?? null}::date IS NULL OR created_at <= (${toDate}::date + interval '1 day'))
      ORDER BY created_at ASC
    `.execute(tx);

    return res.rows.map((r) => ({
      id: r.id,
      calculationId: r.calculation_id,
      amount: Number(r.amount),
      state: r.state,
      createdAt: toIsoTimestamp(r.created_at),
    }));
  }
}

export class InMemoryInvoiceRepository implements InvoiceRepository {
  private invoices: InvoiceRecord[] = [];
  private ledgerEntries: LedgerEntryRecord[] = [];

  async createInvoice(
    _tx: Tx,
    tenantId: string,
    invoice: CreateInvoiceData,
  ): Promise<InvoiceRecord> {
    const existing = this.invoices.find(
      (inv) => inv.tenantId === tenantId && inv.direction === invoice.direction && inv.number === invoice.number,
    );
    if (existing) {
      throw AppError.of('VERSION_CONFLICT', 'Invoice with this number and direction already exists');
    }

    const now = new Date().toISOString();
    const record: InvoiceRecord = {
      id: invoice.id,
      tenantId,
      direction: invoice.direction,
      number: invoice.number,
      date: invoice.date,
      dueDate: invoice.dueDate ?? null,
      amount: invoice.amount,
      currency: invoice.currency ?? 'INR',
      taxFields: invoice.taxFields ?? {},
      status: 'DRAFT',
      calculationIds: invoice.calculationIds ?? [],
      partyId: invoice.partyId,
      partyName: invoice.partyName ?? null,
      notes: invoice.notes ?? null,
      lockVersion: 0,
      createdAt: now,
      createdBy: invoice.createdBy,
      updatedAt: now,
      updatedBy: invoice.createdBy,
    };
    this.invoices.push(record);
    return record;
  }

  async findInvoiceById(_tx: Tx, tenantId: string, id: string): Promise<InvoiceRecord | null> {
    const found = this.invoices.find((i) => i.tenantId === tenantId && i.id === id);
    return found ? { ...found } : null;
  }

  async findInvoiceByNumber(
    _tx: Tx,
    tenantId: string,
    direction: InvoiceDirection,
    number: string,
  ): Promise<InvoiceRecord | null> {
    const found = this.invoices.find(
      (i) => i.tenantId === tenantId && i.direction === direction && i.number === number,
    );
    return found ? { ...found } : null;
  }

  async listInvoices(
    _tx: Tx,
    tenantId: string,
    query: InvoiceListQuery,
  ): Promise<{ items: InvoiceRecord[]; nextCursor: string | null }> {
    let filtered = this.invoices.filter((i) => i.tenantId === tenantId);

    if (query.direction) {
      filtered = filtered.filter((i) => i.direction === query.direction);
    }
    if (query.status) {
      filtered = filtered.filter((i) => i.status === query.status);
    }
    if (query.partyId) {
      filtered = filtered.filter((i) => i.partyId === query.partyId);
    }
    if (query.search) {
      const s = query.search.toLowerCase();
      filtered = filtered.filter(
        (i) => i.number.toLowerCase().includes(s) || (i.partyName && i.partyName.toLowerCase().includes(s)),
      );
    }

    filtered.sort((a, b) => {
      const d = b.date.localeCompare(a.date);
      if (d !== 0) return d;
      return b.id.localeCompare(a.id);
    });

    const limit = query.limit ?? 50;
    const items = filtered.slice(0, limit);
    const nextCursor = filtered.length > limit ? items[items.length - 1]!.id : null;

    return { items, nextCursor };
  }

  async updateInvoiceStatus(
    _tx: Tx,
    tenantId: string,
    id: string,
    status: InvoiceStatus,
    expectedLockVersion: number | undefined,
    updatedBy: string,
    notes?: string,
  ): Promise<InvoiceRecord> {
    const idx = this.invoices.findIndex((i) => i.tenantId === tenantId && i.id === id);
    if (idx === -1) {
      throw AppError.of('NOT_FOUND', 'Invoice not found');
    }
    const current = this.invoices[idx]!;
    if (expectedLockVersion !== undefined && current.lockVersion !== expectedLockVersion) {
      throw AppError.of('VERSION_CONFLICT', 'Conflict: Invoice was modified concurrently (lock_version mismatch)');
    }

    const updated: InvoiceRecord = {
      ...current,
      status,
      notes: notes !== undefined ? notes : current.notes,
      lockVersion: current.lockVersion + 1,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };
    this.invoices[idx] = updated;
    return updated;
  }

  async createLedgerEntry(
    _tx: Tx,
    tenantId: string,
    entry: {
      id: string;
      connectorId: string;
      entryType: LedgerEntryType;
      amount: number;
      currency?: string;
      referenceId?: string | null;
      description?: string | null;
      entryDate?: string;
      balanceAfter: number;
      createdBy: string;
    },
  ): Promise<LedgerEntryRecord> {
    const now = new Date().toISOString();
    const record: LedgerEntryRecord = {
      id: entry.id,
      tenantId,
      connectorId: entry.connectorId,
      entryType: entry.entryType,
      amount: entry.amount,
      currency: entry.currency ?? 'INR',
      referenceId: entry.referenceId ?? null,
      description: entry.description ?? null,
      entryDate: entry.entryDate ?? now.split('T')[0]!,
      balanceAfter: entry.balanceAfter,
      lockVersion: 0,
      createdAt: now,
      createdBy: entry.createdBy,
      updatedAt: now,
      updatedBy: entry.createdBy,
    };
    this.ledgerEntries.push(record);
    return record;
  }

  async listLedgerEntries(
    _tx: Tx,
    tenantId: string,
    connectorId: string,
    fromDate?: string,
    toDate?: string,
    limit = 100,
  ): Promise<LedgerEntryRecord[]> {
    let items = this.ledgerEntries.filter(
      (e) => e.tenantId === tenantId && e.connectorId === connectorId,
    );
    if (fromDate) items = items.filter((e) => e.entryDate >= fromDate);
    if (toDate) items = items.filter((e) => e.entryDate <= toDate);

    items.sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.createdAt.localeCompare(b.createdAt));
    return items.slice(0, limit);
  }

  async getOpeningBalance(
    _tx: Tx,
    tenantId: string,
    connectorId: string,
    beforeDate: string,
  ): Promise<number> {
    const prior = this.ledgerEntries.filter(
      (e) => e.tenantId === tenantId && e.connectorId === connectorId && e.entryDate < beforeDate,
    );
    let bal = 0;
    for (const e of prior) {
      if (e.entryType === 'COMMISSION_EARNED' || e.entryType === 'OPENING_BALANCE') {
        bal += e.amount;
      } else if (e.entryType === 'PAYOUT_DISBURSED' || e.entryType === 'TAX_DEDUCTION') {
        bal -= e.amount;
      } else if (e.entryType === 'ADJUSTMENT') {
        bal += e.amount;
      }
    }
    return bal;
  }

  async getConnectorCommissionPayables(
    _tx: Tx,
    _tenantId: string,
    _connectorId: string,
    _fromDate?: string,
    _toDate?: string,
  ): Promise<Array<{ id: string; calculationId: string; amount: number; state: string; createdAt: string }>> {
    return [];
  }
}
