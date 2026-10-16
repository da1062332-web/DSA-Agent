import {
  AppError,
  type AuditPort,
  type AutoIngestBankFeedInput,
  type AutoIngestBankFeedResponse,
  type OutboxPort,
  type PermissionCode,
  type RequestContext,
  type Tx,
} from '@dsa/contracts';
import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import { hashLoanAccount, maskCustomerName } from './crypto';
import { parseCsvFeed, parseMt940Feed } from './statement-parser';

import type { ReconciliationRepository } from './repository';
import type {
  AdjustmentApprovalInput,
  AdjustmentProposalInput,
  AdjustmentResponse,
  AdjustmentRow,
  BankReconcilePayoutInput,
  CreateDisputeInput,
  DisputeResponse,
  DisputeRow,
  ImportLenderStatementInput,
  LenderStatementLineResponse,
  LenderStatementLineRow,
  LenderStatementResponse,
  LenderStatementRow,
  ListExceptionsQuery,
  ReconciliationExceptionResponse,
  ReconciliationExceptionRow,
  ReconciliationMatchResponse,
  ReconciliationMatchRow,
  ResolveExceptionInput,
  UpdateDisputeInput,
} from './types';

export interface ReconciliationServiceDeps {
  repository: ReconciliationRepository;
  audit?: AuditPort;
  outbox?: OutboxPort;
}

export class ReconciliationService {
  constructor(private readonly deps: ReconciliationServiceDeps) {}

  private nextId(prefix: string): string {
    return `${prefix}_${ulid()}`;
  }

  private assertPermission(ctx: RequestContext, permission: PermissionCode): void {
    const hasGrant = ctx.principal.grants.some((g) => g.code === permission);
    if (!hasGrant) {
      throw AppError.of('FORBIDDEN', `Permission '${permission}' is required.`);
    }
  }

  private async emitEvent(
    tx: Tx,
    ctx: RequestContext,
    event: { type: string; subject: { type: string; id: string }; data: Record<string, unknown> },
  ): Promise<void> {
    if (this.deps.outbox) {
      await this.deps.outbox.emit(tx, ctx, {
        type: event.type,
        subject: event.subject,
        data: event.data,
        causationId: ctx.correlationId,
      });
    }
  }

  // --- SUB-REC.01: LENDER STATEMENT IMPORT ---

  async importLenderStatement(
    tx: Tx,
    ctx: RequestContext,
    input: ImportLenderStatementInput,
  ): Promise<LenderStatementResponse> {
    this.assertPermission(ctx, 'finance.reconcile');
    const tenantId = ctx.principal.tenantId;

    // Duplicate check: UNIQUE (tenant_id, lender_id, period, file_sha256)
    const existing = await this.deps.repository.findDuplicateLenderStatement(
      tx,
      tenantId,
      input.lenderId,
      input.period,
      input.fileSha256,
    );
    if (existing) {
      throw AppError.of(
        'CONTENT_HASH_MISMATCH',
        `Lender statement for lender ${input.lenderId}, period ${input.period} with file hash ${input.fileSha256} has already been imported.`,
      );
    }

    const statementId = this.nextId('stm');
    const now = new Date();

    // Calculate totals deterministically
    let totalDisbursed = 0;
    let totalCommission = 0;
    let totalTaxDeducted = 0;

    const lineRows: LenderStatementLineRow[] = [];
    for (const line of input.lines) {
      totalDisbursed += Number(line.disbursedAmount);
      totalCommission += Number(line.commissionAmount);
      const tax = Number(line.taxDeducted ?? 0);
      totalTaxDeducted += tax;

      lineRows.push({
        id: this.nextId('stl'),
        tenant_id: tenantId,
        statement_id: statementId,
        loan_account_hash: hashLoanAccount(line.loanAccount),
        customer_name_masked: maskCustomerName(line.customerName),
        disbursed_amount: line.disbursedAmount,
        commission_amount: line.commissionAmount,
        tax_deducted: tax,
        paid_on: new Date(line.paidOn),
        raw_row_ref: line.rawRowRef ?? null,
        status: 'UNMATCHED',
        created_at: now,
      });
    }

    const netCommission = totalCommission - totalTaxDeducted;
    const totals = {
      totalDisbursed: Math.round(totalDisbursed * 100) / 100,
      totalCommission: Math.round(totalCommission * 100) / 100,
      totalTaxDeducted: Math.round(totalTaxDeducted * 100) / 100,
      netCommission: Math.round(netCommission * 100) / 100,
      lineCount: lineRows.length,
    };

    const statementRow: LenderStatementRow = {
      id: statementId,
      tenant_id: tenantId,
      lender_id: input.lenderId,
      period: input.period,
      source_file_key: input.sourceFileKey,
      import_batch_id: input.importBatchId || `imp_${ulid()}`,
      file_sha256: input.fileSha256,
      totals,
      status: 'IMPORTED',
      created_at: now,
      created_by: ctx.principal.id,
    };

    await this.deps.repository.insertLenderStatement(tx, statementRow);
    await this.deps.repository.insertLenderStatementLines(tx, lineRows);

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: 'lender_statement.imported',
        entityType: 'lender_statement',
        entityId: statementId,
        after: {
          lenderId: input.lenderId,
          period: input.period,
          fileSha256: input.fileSha256,
          lineCount: lineRows.length,
          totals,
        },
      });
    }

    await this.emitEvent(tx, ctx, {
      type: 'reconciliation.statement_imported',
      subject: { type: 'lender_statement', id: statementId },
      data: {
        statementId,
        lenderId: input.lenderId,
        period: input.period,
        lineCount: lineRows.length,
      },
    });

    return this.toStatementResponse(statementRow, lineRows);
  }

  // --- AUTOMATED BANK STATEMENT INGESTION ENGINE (MT940 / CSV FEEDS) (MOD-REC / TASK-418) ---
  async autoIngestBankFeed(
    tx: Tx,
    ctx: RequestContext,
    input: AutoIngestBankFeedInput,
  ): Promise<AutoIngestBankFeedResponse> {
    this.assertPermission(ctx, 'finance.reconcile');

    const parsed =
      input.format === 'MT940'
        ? parseMt940Feed(input.rawFeedContent)
        : parseCsvFeed(input.rawFeedContent);

    // Compute SHA-256 of raw content
    const hash = createHash('sha256').update(input.rawFeedContent).digest('hex');

    // Ingest via canonical importLenderStatement logic
    const statement = await this.importLenderStatement(tx, ctx, {
      lenderId: input.lenderId,
      period: input.period,
      sourceFileKey: `feeds/${input.format.toLowerCase()}/${input.filename || 'bank_feed'}`,
      importBatchId: `auto_ingest_${Date.now()}`,
      fileSha256: hash,
      lines: parsed.lines,
    });

    return {
      statementId: statement.id as any,
      lenderId: input.lenderId,
      period: input.period,
      format: input.format,
      parsedLinesCount: parsed.lines.length,
      totalDisbursed: parsed.totalDisbursed,
      totalCommission: parsed.totalCommission,
      totalTaxDeducted: parsed.totalTaxDeducted,
      netCommission: parsed.netCommission,
      fileSha256: hash,
      status: statement.status as any,
      message: `Successfully auto-parsed and ingested ${parsed.lines.length} lines from bank ${input.format} feed.`,
    };
  }

  async getLenderStatement(
    tx: Tx,
    ctx: RequestContext,
    id: string,
  ): Promise<LenderStatementResponse> {
    this.assertPermission(ctx, 'finance.view');
    const statement = await this.deps.repository.findLenderStatementById(tx, ctx.principal.tenantId, id);
    if (!statement) {
      throw AppError.of('NOT_FOUND', `Lender statement ${id} not found.`);
    }
    const lines = await this.deps.repository.listStatementLines(tx, ctx.principal.tenantId, id);
    return this.toStatementResponse(statement, lines);
  }

  async listLenderStatements(
    tx: Tx,
    ctx: RequestContext,
    lenderId?: string,
  ): Promise<LenderStatementResponse[]> {
    this.assertPermission(ctx, 'finance.view');
    const statements = await this.deps.repository.listLenderStatements(tx, ctx.principal.tenantId, lenderId);
    return statements.map((s) => this.toStatementResponse(s));
  }

  // --- SUB-REC.02: COMMISSION MATCHING ---

  async runCommissionMatching(
    tx: Tx,
    ctx: RequestContext,
    statementId: string,
  ): Promise<{
    matchedCount: number;
    varianceCount: number;
    unmatchedCount: number;
    matches: ReconciliationMatchResponse[];
  }> {
    this.assertPermission(ctx, 'finance.reconcile');
    const tenantId = ctx.principal.tenantId;

    const statement = await this.deps.repository.findLenderStatementById(tx, tenantId, statementId);
    if (!statement) {
      throw AppError.of('NOT_FOUND', `Lender statement ${statementId} not found.`);
    }

    const lines = await this.deps.repository.listStatementLines(tx, tenantId, statementId);
    const calculations = await this.deps.repository.findCalculationsForMatching(tx, tenantId, statement.lender_id);

    let matchedCount = 0;
    let varianceCount = 0;
    let unmatchedCount = 0;
    const createdMatches: ReconciliationMatchRow[] = [];

    for (const line of lines) {
      // Invariant: Only one active match per statement line
      const existingMatch = await this.deps.repository.findActiveMatchForLine(tx, tenantId, line.id);
      if (existingMatch) {
        continue;
      }

      // Match against candidate calculations
      const candidate = calculations.find((c) => {
        if (c.loan_account_no && hashLoanAccount(c.loan_account_no) === line.loan_account_hash) {
          return true;
        }
        return Math.abs(Number(c.gross_amount) - Number(line.commission_amount)) < 0.01;
      });

      if (candidate) {
        const lineAmt = Number(line.commission_amount);
        const calcAmt = Number(candidate.gross_amount);
        const diff = Math.round((lineAmt - calcAmt) * 100) / 100;

        if (Math.abs(diff) < 0.01) {
          // Exact match
          const matchRow: ReconciliationMatchRow = {
            id: this.nextId('rmt'),
            tenant_id: tenantId,
            statement_line_id: line.id,
            calculation_id: candidate.id,
            match_type: 'EXACT',
            matched_amount: lineAmt,
            decision_record_id: candidate.decision_record_id ?? null,
            status: 'ACTIVE',
            created_at: new Date(),
            created_by: ctx.principal.id,
          };
          await this.deps.repository.insertReconciliationMatch(tx, matchRow);
          await this.deps.repository.updateStatementLineStatus(tx, tenantId, line.id, 'MATCHED');
          createdMatches.push(matchRow);
          matchedCount++;
        } else {
          // Variance match
          const classification = diff < 0 ? 'SHORT_REMITTANCE' : 'OVER_REMITTANCE';
          const matchRow: ReconciliationMatchRow = {
            id: this.nextId('rmt'),
            tenant_id: tenantId,
            statement_line_id: line.id,
            calculation_id: candidate.id,
            match_type: 'VARIANCE',
            matched_amount: lineAmt,
            decision_record_id: candidate.decision_record_id ?? null,
            status: 'ACTIVE',
            created_at: new Date(),
            created_by: ctx.principal.id,
          };
          await this.deps.repository.insertReconciliationMatch(tx, matchRow);
          await this.deps.repository.updateStatementLineStatus(tx, tenantId, line.id, 'EXCEPTION');

          // Log variance exception
          const exceptionRow: ReconciliationExceptionRow = {
            id: this.nextId('rex'),
            tenant_id: tenantId,
            statement_line_id: line.id,
            calculation_id: candidate.id,
            variance_amount: Math.abs(diff),
            classification,
            status: 'OPEN',
            owner_user_id: null,
            evidence_ref: `stmt:${statementId}:line:${line.id}`,
            resolution_note: null,
            resolved_at: null,
            resolved_by: null,
            created_at: new Date(),
            created_by: ctx.principal.id,
          };
          await this.deps.repository.insertReconciliationException(tx, exceptionRow);
          createdMatches.push(matchRow);
          varianceCount++;
        }
      } else {
        // Unmatched line
        await this.deps.repository.updateStatementLineStatus(tx, tenantId, line.id, 'EXCEPTION');
        const exceptionRow: ReconciliationExceptionRow = {
          id: this.nextId('rex'),
          tenant_id: tenantId,
          statement_line_id: line.id,
          calculation_id: null,
          variance_amount: Number(line.commission_amount),
          classification: 'UNMATCHED_STATEMENT_LINE',
          status: 'OPEN',
          owner_user_id: null,
          evidence_ref: `stmt:${statementId}:line:${line.id}`,
          resolution_note: null,
          resolved_at: null,
          resolved_by: null,
          created_at: new Date(),
          created_by: ctx.principal.id,
        };
        await this.deps.repository.insertReconciliationException(tx, exceptionRow);
        unmatchedCount++;
      }
    }

    const finalStatus = varianceCount === 0 && unmatchedCount === 0 ? 'MATCHED' : 'PARTIALLY_MATCHED';
    await this.deps.repository.updateLenderStatementStatus(tx, tenantId, statementId, finalStatus);

    return {
      matchedCount,
      varianceCount,
      unmatchedCount,
      matches: createdMatches.map((m) => this.toMatchResponse(m)),
    };
  }

  // --- SUB-REC.03: EXCEPTIONS, VARIANCES & ADJUSTMENTS ---

  async listExceptions(
    tx: Tx,
    ctx: RequestContext,
    query: ListExceptionsQuery,
  ): Promise<{ items: ReconciliationExceptionResponse[]; nextCursor: string | null }> {
    this.assertPermission(ctx, 'finance.view');
    const { rows, nextCursor } = await this.deps.repository.listExceptions(tx, ctx.principal.tenantId, query);
    return {
      items: rows.map((r) => this.toExceptionResponse(r)),
      nextCursor,
    };
  }

  async resolveException(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    input: ResolveExceptionInput,
  ): Promise<ReconciliationExceptionResponse> {
    this.assertPermission(ctx, 'finance.reconcile');
    const tenantId = ctx.principal.tenantId;

    const exception = await this.deps.repository.findExceptionById(tx, tenantId, id);
    if (!exception) {
      throw AppError.of('NOT_FOUND', `Reconciliation exception ${id} not found.`);
    }
    if (exception.status === 'RESOLVED' || exception.status === 'WRITTEN_OFF') {
      throw AppError.of('VALIDATION_ERROR', `Exception is already closed with status ${exception.status}.`);
    }

    const updated = await this.deps.repository.updateException(tx, tenantId, id, {
      status: input.status,
      classification: input.classification,
      resolutionNote: input.resolutionNote,
      resolvedBy: ctx.principal.id,
      resolvedAt: new Date(),
      evidenceRef: input.evidenceRef,
    });

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: 'reconciliation_exception.resolved',
        entityType: 'reconciliation_exception',
        entityId: id,
        before: { status: exception.status },
        after: { status: input.status, resolutionNote: input.resolutionNote },
      });
    }

    return this.toExceptionResponse(updated!);
  }

  async proposeAdjustment(
    tx: Tx,
    ctx: RequestContext,
    input: AdjustmentProposalInput,
  ): Promise<AdjustmentResponse> {
    this.assertPermission(ctx, 'adjustment.create');
    const tenantId = ctx.principal.tenantId;
    const id = this.nextId('adj');
    const now = new Date();

    const row: AdjustmentRow = {
      id,
      tenant_id: tenantId,
      adjustment_type: input.type,
      type: input.type,
      amount: input.amount,
      reason: input.reason,
      status: 'PENDING',
      calculation_id: input.calculationId ?? null,
      payable_id: input.payableId ?? null,
      exception_id: input.exceptionId ?? null,
      evidence_ref: input.evidenceRef ?? null,
      journal_id: input.journalId ?? null,
      lock_version: 1,
      created_at: now,
      created_by: ctx.principal.id,
      approved_at: null,
      approved_by: null,
    };

    await this.deps.repository.insertAdjustment(tx, row);

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: 'adjustment.proposed',
        entityType: 'adjustment',
        entityId: id,
        after: {
          type: input.type,
          amount: input.amount,
          reason: input.reason,
          calculationId: input.calculationId,
          payableId: input.payableId,
        },
      });
    }

    return this.toAdjustmentResponse(row);
  }

  async approveAdjustment(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    input: AdjustmentApprovalInput,
  ): Promise<AdjustmentResponse> {
    this.assertPermission(ctx, 'adjustment.approve');
    const tenantId = ctx.principal.tenantId;

    const adjustment = await this.deps.repository.findAdjustmentById(tx, tenantId, id);
    if (!adjustment) {
      throw AppError.of('NOT_FOUND', `Adjustment ${id} not found.`);
    }
    if (adjustment.status !== 'PENDING') {
      throw AppError.of('VALIDATION_ERROR', `Adjustment ${id} is not pending approval (status: ${adjustment.status}).`);
    }

    // SOD-07 Enforcement: Approver must differ from creator
    if (adjustment.created_by === ctx.principal.id) {
      throw AppError.of(
        'SOD_VIOLATION',
        'SOD-07 Segregation of Duties Violation: Adjustment creator cannot approve their own adjustment.',
      );
    }

    const nextStatus = input.approved ? 'APPROVED' : 'REJECTED';
    const updated = await this.deps.repository.updateAdjustmentApproval(
      tx,
      tenantId,
      id,
      nextStatus,
      ctx.principal.id,
    );

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: input.approved ? 'adjustment.approved' : 'adjustment.rejected',
        entityType: 'adjustment',
        entityId: id,
        before: { status: 'PENDING' },
        after: { status: nextStatus, approvedBy: ctx.principal.id },
      });
    }

    return this.toAdjustmentResponse(updated!);
  }

  async listAdjustments(tx: Tx, ctx: RequestContext): Promise<AdjustmentResponse[]> {
    this.assertPermission(ctx, 'finance.view');
    const list = await this.deps.repository.listAdjustments(tx, ctx.principal.tenantId);
    return list.map((a) => this.toAdjustmentResponse(a));
  }

  // --- SUB-REC.04: DISPUTES & HOLDS ---

  async createDispute(
    tx: Tx,
    ctx: RequestContext,
    input: CreateDisputeInput,
  ): Promise<DisputeResponse> {
    this.assertPermission(ctx, 'finance.dispute');
    const tenantId = ctx.principal.tenantId;
    const id = this.nextId('dsp');
    const now = new Date();

    const row: DisputeRow = {
      id,
      tenant_id: tenantId,
      party_type: input.partyType,
      party_id: input.partyId,
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      reason: input.reason,
      status: 'OPEN',
      resolution: null,
      outcome_adjustment_id: null,
      lock_version: 1,
      created_at: now,
      created_by: ctx.principal.id,
      updated_at: now,
      updated_by: ctx.principal.id,
    };

    await this.deps.repository.insertDispute(tx, row);

    // Business Rule: Open dispute places relevant payables on ON_HOLD
    if (input.payableIds && input.payableIds.length > 0) {
      await this.deps.repository.holdPayables(tx, tenantId, input.payableIds, `Dispute ${id}: ${input.reason}`);
    }

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: 'dispute.created',
        entityType: 'dispute',
        entityId: id,
        after: {
          partyType: input.partyType,
          partyId: input.partyId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          reason: input.reason,
          placedOnHoldPayableIds: input.payableIds,
        },
      });
    }

    return this.toDisputeResponse(row);
  }

  async updateDispute(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    expectedLockVersion: number,
    input: UpdateDisputeInput,
    payableIdsToRelease?: string[],
  ): Promise<DisputeResponse> {
    this.assertPermission(ctx, 'finance.reconcile');
    const tenantId = ctx.principal.tenantId;

    const dispute = await this.deps.repository.findDisputeById(tx, tenantId, id);
    if (!dispute) {
      throw AppError.of('NOT_FOUND', `Dispute ${id} not found.`);
    }

    if (dispute.lock_version !== expectedLockVersion) {
      throw AppError.of(
        'VERSION_CONFLICT',
        `Dispute ${id} lock_version conflict (expected ${expectedLockVersion}, actual ${dispute.lock_version}).`,
      );
    }

    const updated = await this.deps.repository.updateDispute(tx, tenantId, id, expectedLockVersion, {
      status: input.status,
      resolution: input.resolution,
      outcomeAdjustmentId: input.outcomeAdjustmentId,
      updatedBy: ctx.principal.id,
    });

    if (input.releaseHolds && payableIdsToRelease && payableIdsToRelease.length > 0) {
      await this.deps.repository.releasePayables(tx, tenantId, payableIdsToRelease);
    }

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: 'dispute.updated',
        entityType: 'dispute',
        entityId: id,
        before: { status: dispute.status, lockVersion: dispute.lock_version },
        after: { status: input.status, lockVersion: updated!.lock_version },
      });
    }

    return this.toDisputeResponse(updated!);
  }

  async listDisputes(
    tx: Tx,
    ctx: RequestContext,
    filters?: { status?: string; partyType?: string },
  ): Promise<DisputeResponse[]> {
    this.assertPermission(ctx, 'finance.view');
    const list = await this.deps.repository.listDisputes(tx, ctx.principal.tenantId, filters);
    return list.map((d) => this.toDisputeResponse(d));
  }

  // --- SUB-REC.05: BANK PAYOUT SETTLEMENT RECONCILIATION ---

  async reconcilePayoutWithBank(
    tx: Tx,
    ctx: RequestContext,
    payoutId: string,
    input: BankReconcilePayoutInput,
  ): Promise<{ payoutId: string; status: string; bankReference: string }> {
    this.assertPermission(ctx, 'finance.reconcile');
    const tenantId = ctx.principal.tenantId;

    const payout = await this.deps.repository.findPayoutRequestById(tx, tenantId, payoutId);
    if (!payout) {
      throw AppError.of('NOT_FOUND', `Payout request ${payoutId} not found.`);
    }

    if (payout.status !== 'PAYMENT_RECORDED') {
      throw AppError.of(
        'VALIDATION_ERROR',
        `Cannot reconcile payout in status '${payout.status}'. Payout must be in 'PAYMENT_RECORDED' status.`,
      );
    }

    const payoutTotal = Number(payout.total);
    const variance = Math.round(Math.abs(payoutTotal - input.paidAmount) * 100) / 100;

    if (variance > 0.01) {
      // Amount mismatch -> Route to reconciliation exception
      const exceptionId = this.nextId('rex');
      const classification = input.paidAmount < payoutTotal ? 'SHORT_REMITTANCE' : 'OVER_REMITTANCE';
      await this.deps.repository.insertReconciliationException(tx, {
        id: exceptionId,
        tenant_id: tenantId,
        statement_line_id: null,
        calculation_id: null,
        variance_amount: variance,
        classification,
        status: 'OPEN',
        owner_user_id: null,
        evidence_ref: `bankRef:${input.bankReference}:payout:${payoutId}`,
        resolution_note: `Bank statement paidAmount ${input.paidAmount} does not match payout total ${payoutTotal}`,
        resolved_at: null,
        resolved_by: null,
        created_at: new Date(),
        created_by: ctx.principal.id,
      });

      throw AppError.of(
        'VALIDATION_ERROR',
        `Bank remittance amount (${input.paidAmount}) does not match payout total (${payoutTotal}). Exception ${exceptionId} created.`,
      );
    }

    const reconciled = await this.deps.repository.reconcilePayoutRequest(tx, tenantId, payoutId);

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: 'payout_request.reconciled',
        entityType: 'payout_request',
        entityId: payoutId,
        before: { status: 'PAYMENT_RECORDED' },
        after: {
          status: 'RECONCILED',
          bankReference: input.bankReference,
          settlementDate: input.settlementDate,
        },
      });
    }

    await this.emitEvent(tx, ctx, {
      type: 'payout.reconciled',
      subject: { type: 'payout_request', id: payoutId },
      data: {
        payoutId,
        bankReference: input.bankReference,
        settlementDate: input.settlementDate,
        total: payout.total,
      },
    });

    return {
      payoutId,
      status: reconciled.status,
      bankReference: input.bankReference,
    };
  }

  // --- RESPONSE MAPPERS ---

  private toStatementResponse(
    row: LenderStatementRow,
    lines?: LenderStatementLineRow[],
  ): LenderStatementResponse {
    return {
      id: row.id,
      lenderId: row.lender_id,
      period: row.period,
      sourceFileKey: row.source_file_key,
      importBatchId: row.import_batch_id,
      fileSha256: row.file_sha256,
      totals: {
        totalDisbursed: Number(row.totals.totalDisbursed),
        totalCommission: Number(row.totals.totalCommission),
        totalTaxDeducted: Number(row.totals.totalTaxDeducted),
        netCommission: Number(row.totals.netCommission),
        lineCount: Number(row.totals.lineCount),
      },
      status: row.status as any,
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by,
      lines: lines?.map((l) => this.toLineResponse(l)),
    };
  }

  private toLineResponse(row: LenderStatementLineRow): LenderStatementLineResponse {
    return {
      id: row.id,
      statementId: row.statement_id,
      loanAccountHash: row.loan_account_hash,
      customerNameMasked: row.customer_name_masked,
      disbursedAmount: Number(row.disbursed_amount),
      commissionAmount: Number(row.commission_amount),
      taxDeducted: Number(row.tax_deducted),
      paidOn: typeof row.paid_on === 'string' ? row.paid_on : row.paid_on.toISOString().slice(0, 10),
      rawRowRef: row.raw_row_ref,
      status: row.status as any,
      createdAt: row.created_at.toISOString(),
    };
  }

  private toMatchResponse(row: ReconciliationMatchRow): ReconciliationMatchResponse {
    return {
      id: row.id,
      statementLineId: row.statement_line_id,
      calculationId: row.calculation_id,
      matchType: row.match_type,
      matchedAmount: Number(row.matched_amount),
      decisionRecordId: row.decision_record_id,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by,
    };
  }

  private toExceptionResponse(row: ReconciliationExceptionRow): ReconciliationExceptionResponse {
    return {
      id: row.id,
      statementLineId: row.statement_line_id,
      calculationId: row.calculation_id,
      varianceAmount: Number(row.variance_amount),
      classification: row.classification,
      status: row.status,
      ownerUserId: row.owner_user_id,
      evidenceRef: row.evidence_ref,
      resolutionNote: row.resolution_note,
      resolvedAt: row.resolved_at?.toISOString() ?? null,
      resolvedBy: row.resolved_by,
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by,
    };
  }

  private toAdjustmentResponse(row: AdjustmentRow): AdjustmentResponse {
    return {
      id: row.id,
      adjustmentType: (row.type || row.adjustment_type) as any,
      type: row.type || row.adjustment_type,
      amount: String(row.amount),
      reason: row.reason,
      status: row.status as any,
      calculationId: row.calculation_id,
      payableId: row.payable_id,
      exceptionId: row.exception_id,
      evidenceRef: row.evidence_ref,
      journalId: row.journal_id,
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by,
      approvedAt: row.approved_at?.toISOString() ?? null,
      approvedBy: row.approved_by,
    };
  }

  private toDisputeResponse(row: DisputeRow): DisputeResponse {
    return {
      id: row.id,
      partyType: row.party_type,
      partyId: row.party_id,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      reason: row.reason,
      status: row.status as any,
      resolution: row.resolution,
      outcomeAdjustmentId: row.outcome_adjustment_id,
      lockVersion: row.lock_version,
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by,
      updatedAt: row.updated_at.toISOString(),
      updatedBy: row.updated_by,
    };
  }
}
