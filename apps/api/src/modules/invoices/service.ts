// apps/api/src/modules/invoices/service.ts — Module 33: Invoices & Statements Service
import { redactSecrets } from '../../http/redact';
import {
  AppError,
  withLegacy,
  type AccountingExportRow,
  type AuditPort,
  type Authz,
  type ConnectorStatement,
  type ConnectorStatementLine,
  type CreateInvoiceInput,
  type IdGenerator,
  type InvoiceListQuery,
  type InvoiceRecord,
  type InvoiceStatus,
  type PermissionCode,
  type RequestContext,
  type StatementQuery,
  type Tx,
} from '@dsa/contracts';
import { randomUUID } from 'node:crypto';
import type { InvoiceRepository } from './repository';
import { requireFinancialStepUp } from '../../http/financial-step-up';

export interface InvoiceServiceDeps {
  repository: InvoiceRepository;
  authz: Authz;
  audit?: AuditPort;
  ids?: IdGenerator;
}


/** Inclusive first and last day of a YYYY-MM month, as ISO dates. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

const money = (n: number): string => (Number.isFinite(n) ? n : 0).toFixed(2);

const ACCOUNTING_EXPORT_HEADER = [
  'Record type',
  'Number',
  'Date',
  'Party',
  'Taxable value',
  'GST',
  'TDS',
  'Total',
  'Payment status',
] as const;

const csvCell = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** RFC 4180 CSV for the accounting export. Exported so it can be unit tested without a database. */
export function accountingExportToCsv(rows: AccountingExportRow[]): string {
  const lines = [ACCOUNTING_EXPORT_HEADER.join(',')];
  for (const r of rows) {
    // Every cell goes through the shared redactor: a party name or reference typed with a PAN or Aadhaar number is masked in the
    // export, including rows stored before the write-side check (TEST-SECRETS-04).
    lines.push(
      [r.recordType, r.number, r.date, r.party, r.taxableValue, r.gst, r.tds, r.total, r.paymentStatus]
        .map((cell) => csvCell(redactSecrets(String(cell))))
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

export class InvoiceService {
  constructor(private readonly deps: InvoiceServiceDeps) {}

  private generateId(prefix: string): string {
    const raw = randomUUID().replace(/-/g, '').toLowerCase().slice(0, 20);
    return `${prefix}_${raw}`;
  }

  /** Viewing invoices: invoice.view, or finance.view / invoice.manage (its legacy parents) until the role matrix is applied. */
  private checkViewPermission(ctx: RequestContext): void {
    const allowed: PermissionCode[] = withLegacy('invoice.view');
    if (ctx.principal.grants.some((g) => allowed.includes(g.code))) {
      return;
    }
    // Fall back to Authz check which throws 403
    this.deps.authz.requirePermission(ctx, 'invoice.view');
  }

  /**
   * API-INV-001: POST /v1/invoices — Record invoice
   */
  async recordInvoice(tx: Tx, ctx: RequestContext, input: CreateInvoiceInput): Promise<InvoiceRecord> {
    this.deps.authz.requirePermission(ctx, 'invoice.manage');

    const tenantId = ctx.principal.tenantId;
    const userId = ctx.principal.id;

    // Check duplicate (tenant_id, direction, number)
    const existing = await this.deps.repository.findInvoiceByNumber(
      tx,
      tenantId,
      input.direction,
      input.number,
    );
    if (existing) {
      throw AppError.of(
        'VERSION_CONFLICT',
        `Invoice with number "${input.number}" and direction "${input.direction}" already exists in this tenant.`,
      );
    }

    const id = this.deps.ids ? this.deps.ids.next('inv' as any) : this.generateId('inv');

    const invoice = await this.deps.repository.createInvoice(tx, tenantId, {
      ...input,
      id,
      createdBy: userId,
    });

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: 'invoice.recorded',
        entityType: 'invoice',
        entityId: invoice.id,
        after: {
          direction: invoice.direction,
          number: invoice.number,
          amount: invoice.amount,
          partyId: invoice.partyId,
          status: invoice.status,
        },
        permissionUsed: 'invoice.manage',
      });
    }

    return invoice;
  }

  /**
   * API-INV-002: GET /v1/invoices — List invoices
   */
  async listInvoices(
    tx: Tx,
    ctx: RequestContext,
    query: InvoiceListQuery,
  ): Promise<{ data: InvoiceRecord[]; nextCursor: string | null }> {
    this.checkViewPermission(ctx);

    const tenantId = ctx.principal.tenantId;
    const result = await this.deps.repository.listInvoices(tx, tenantId, query);
    return {
      data: result.items,
      nextCursor: result.nextCursor,
    };
  }

  /**
   * GET /v1/invoices/:id — Get invoice by ID
   */
  async getInvoice(tx: Tx, ctx: RequestContext, id: string): Promise<InvoiceRecord> {
    this.checkViewPermission(ctx);

    const tenantId = ctx.principal.tenantId;
    const invoice = await this.deps.repository.findInvoiceById(tx, tenantId, id);
    if (!invoice) {
      throw AppError.of('NOT_FOUND', `Invoice "${id}" not found.`);
    }
    return invoice;
  }

  /**
   * API-INV-003: POST /v1/invoices/:id/status — Issue, pay, or void
   */
  async updateInvoiceStatus(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    newStatus: InvoiceStatus,
    expectedLockVersion?: number,
    notes?: string,
  ): Promise<InvoiceRecord> {
    this.deps.authz.requirePermission(ctx, 'invoice.manage');
    // FIN-04: paying or voiding changes money state, so it needs a fresh second factor, and is refused while the project has none.
    if (newStatus === 'PAID' || newStatus === 'VOID') requireFinancialStepUp(this.deps.authz, ctx);

    const tenantId = ctx.principal.tenantId;
    const userId = ctx.principal.id;

    const existing = await this.deps.repository.findInvoiceById(tx, tenantId, id);
    if (!existing) {
      throw AppError.of('NOT_FOUND', `Invoice "${id}" not found.`);
    }

    if (existing.status === newStatus) {
      return existing;
    }

    // State machine check
    if (existing.status === 'VOID') {
      throw AppError.of('INVALID_STATE', 'Cannot change the status of a VOID invoice.');
    }
    // FIN-04: separation of duties. The user who raised an invoice cannot void it.
    if (newStatus === 'VOID' && existing.createdBy === userId) {
      throw AppError.of('SOD_VIOLATION', 'The user who raised this invoice cannot void it.', [
        { issue: 'CREATOR_CANNOT_VOID' },
      ]);
    }

    const validTransitions: Record<InvoiceStatus, InvoiceStatus[]> = {
      DRAFT: ['ISSUED', 'VOID'],
      ISSUED: ['PAID', 'VOID'],
      PAID: ['VOID'],
      VOID: [],
    };

    const allowed = validTransitions[existing.status] ?? [];
    if (!allowed.includes(newStatus)) {
      throw AppError.of(
        'INVALID_TRANSITION',
        `Invalid status transition from "${existing.status}" to "${newStatus}". Allowed: ${allowed.join(', ')}`,
      );
    }

    const updated = await this.deps.repository.updateInvoiceStatus(
      tx,
      tenantId,
      id,
      newStatus,
      expectedLockVersion,
      userId,
      notes,
    );

    // If connector invoice was marked as PAID, post a payout ledger entry
    if (newStatus === 'PAID' && updated.direction === 'FROM_CONNECTOR') {
      const priorBalance = await this.deps.repository.getOpeningBalance(
        tx,
        tenantId,
        updated.partyId,
        new Date().toISOString().split('T')[0]!,
      );
      const balanceAfter = priorBalance - updated.amount;

      await this.deps.repository.createLedgerEntry(tx, tenantId, {
        id: this.generateId('led'),
        connectorId: updated.partyId,
        entryType: 'PAYOUT_DISBURSED',
        amount: updated.amount,
        currency: updated.currency,
        referenceId: updated.number,
        description: `Disbursement against connector invoice ${updated.number}`,
        entryDate: updated.date,
        balanceAfter,
        createdBy: userId,
      });
    }

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: `invoice.${newStatus.toLowerCase()}`,
        entityType: 'invoice',
        entityId: updated.id,
        before: { status: existing.status, lockVersion: existing.lockVersion },
        after: { status: updated.status, lockVersion: updated.lockVersion },
        reason: notes,
        permissionUsed: 'invoice.manage',
      });
    }

    return updated;
  }

  /**
   * SUB-INV.02 GET /v1/connectors/:id/invoice-statements and API-CPT-004 GET /v1/portal/connectors/:id/statements
   * Generates periodic statement derived from ENT-081 ledger_entry and ENT-078 commission_payable
   */
  /**
   * P0-06: GET /v1/invoices/accounting-export?month=YYYY-MM
   *
   * The CRM no longer keeps its own ledger — a DSA's books live in Tally or Zoho. This hands the
   * accountant one month in a form they can import: every invoice dated in the month, plus the
   * partner payouts recorded on the connector statement ledger.
   *
   * Needs invoice.view (to see the invoices) and export.run (to take data out of the system).
   */
  async buildAccountingExport(
    tx: Tx,
    ctx: RequestContext,
    month: string,
  ): Promise<{ filename: string; rows: AccountingExportRow[] }> {
    this.checkViewPermission(ctx);
    const allowedExport: PermissionCode[] = withLegacy('export.run');
    if (!ctx.principal.grants.some((g) => allowedExport.includes(g.code))) {
      this.deps.authz.requirePermission(ctx, 'export.run');
    }

    const tenantId = ctx.principal.tenantId;
    const { from, to } = monthBounds(month);

    const [invoices, payouts] = await Promise.all([
      this.deps.repository.listInvoicesBetween(tx, tenantId, from, to),
      this.deps.repository.listPayoutEntriesBetween(tx, tenantId, from, to),
    ]);

    const invoiceRows: AccountingExportRow[] = invoices.map((inv) => {
      const gst = Number(inv.taxFields?.gstAmount ?? 0);
      const tds = Number(inv.taxFields?.tdsAmount ?? 0);
      // Indian invoice arithmetic: the recorded amount is the taxable value, GST is added, TDS withheld.
      return {
        recordType: 'INVOICE',
        number: inv.number,
        date: inv.date,
        party: inv.partyName ?? inv.partyId,
        taxableValue: money(inv.amount),
        gst: money(gst),
        tds: money(tds),
        total: money(inv.amount + gst - tds),
        paymentStatus: inv.status,
      };
    });

    const payoutRows: AccountingExportRow[] = payouts.map((entry) => ({
      recordType: 'PAYOUT',
      number: entry.referenceId ?? entry.id,
      date: entry.entryDate,
      party: entry.connectorId,
      taxableValue: money(entry.amount),
      gst: money(0),
      tds: money(0),
      total: money(entry.amount),
      paymentStatus: 'DISBURSED',
    }));

    const rows = [...invoiceRows, ...payoutRows].sort(
      (a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number),
    );

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: 'invoice.export_run',
        entityType: 'invoice_export',
        entityId: month,
        after: { month, invoiceRows: invoiceRows.length, payoutRows: payoutRows.length },
        permissionUsed: 'export.run',
      });
    }

    return { filename: `accounting-${month}.csv`, rows };
  }

  async generateConnectorStatement(
    tx: Tx,
    ctx: RequestContext,
    connectorId: string,
    query: StatementQuery,
  ): Promise<ConnectorStatement> {
    const allowedView: PermissionCode[] = withLegacy('invoice.view');
    const hasFinanceView = ctx.principal.grants.some((g) => allowedView.includes(g.code));
    const isConnectorOwn = ctx.principal.id === connectorId;

    if (!hasFinanceView && !isConnectorOwn) {
      throw AppError.of('FORBIDDEN', 'Access denied to connector statement.');
    }

    const tenantId = ctx.principal.tenantId;

    const toDate = query.toDate ?? new Date().toISOString().split('T')[0]!;
    const fromDate =
      query.fromDate ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!;

    // 1. Opening balance before fromDate
    const openingBalance = await this.deps.repository.getOpeningBalance(tx, tenantId, connectorId, fromDate);

    // 2. Ledger entries within date range
    const ledgerEntries = await this.deps.repository.listLedgerEntries(
      tx,
      tenantId,
      connectorId,
      fromDate,
      toDate,
      query.limit ?? 200,
    );

    // 3. Commission payables within range
    const payables = await this.deps.repository.getConnectorCommissionPayables(
      tx,
      tenantId,
      connectorId,
      fromDate,
      toDate,
    );

    const statementLines: ConnectorStatementLine[] = [];
    const recordedRefs = new Set<string>();

    let currentBalance = openingBalance;
    let totalCredits = 0;
    let totalDebits = 0;

    for (const le of ledgerEntries) {
      let credit = 0;
      let debit = 0;

      if (le.entryType === 'COMMISSION_EARNED' || le.entryType === 'OPENING_BALANCE') {
        credit = le.amount;
        currentBalance += credit;
        totalCredits += credit;
      } else if (le.entryType === 'PAYOUT_DISBURSED' || le.entryType === 'TAX_DEDUCTION') {
        debit = le.amount;
        currentBalance -= debit;
        totalDebits += debit;
      } else if (le.entryType === 'ADJUSTMENT') {
        if (le.amount >= 0) {
          credit = le.amount;
          currentBalance += credit;
          totalCredits += credit;
        } else {
          debit = Math.abs(le.amount);
          currentBalance -= debit;
          totalDebits += debit;
        }
      }

      if (le.referenceId) {
        recordedRefs.add(le.referenceId);
      }

      statementLines.push({
        id: le.id,
        date: le.entryDate,
        type: le.entryType,
        description: le.description ?? le.entryType,
        referenceId: le.referenceId,
        credit,
        debit,
        runningBalance: Number(currentBalance.toFixed(2)),
      });
    }

    // Incorporate unposted commission payables if any
    for (const p of payables) {
      if (!recordedRefs.has(p.id) && !recordedRefs.has(p.calculationId)) {
        const credit = p.amount;
        currentBalance += credit;
        totalCredits += credit;

        statementLines.push({
          id: p.id,
          date: p.createdAt.split('T')[0]!,
          type: 'COMMISSION_EARNED',
          description: `Commission payable (${p.state})`,
          referenceId: p.calculationId,
          credit,
          debit: 0,
          runningBalance: Number(currentBalance.toFixed(2)),
        });
      }
    }

    // Sort by date ascending
    statementLines.sort((a, b) => a.date.localeCompare(b.date));

    // Recompute running balance in sorted order
    let running = openingBalance;
    for (const line of statementLines) {
      running = running + line.credit - line.debit;
      line.runningBalance = Number(running.toFixed(2));
    }

    const netChange = Number((totalCredits - totalDebits).toFixed(2));
    const closingBalance = Number((openingBalance + netChange).toFixed(2));

    return {
      connectorId,
      fromDate,
      toDate,
      currency: 'INR',
      openingBalance: Number(openingBalance.toFixed(2)),
      totalCredits: Number(totalCredits.toFixed(2)),
      totalDebits: Number(totalDebits.toFixed(2)),
      netChange,
      closingBalance,
      entries: statementLines,
    };
  }
}
