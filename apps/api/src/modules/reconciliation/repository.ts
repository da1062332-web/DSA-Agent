// apps/api/src/modules/reconciliation/repository.ts
import type { Tx } from '@dsa/contracts';
import { sql } from 'kysely';
import type {
  AdjustmentRow,
  DisputeRow,
  LenderStatementLineRow,
  LenderStatementRow,
  ReconciliationExceptionRow,
  ReconciliationMatchRow,
} from './types';

export interface ReconciliationRepository {
  // SUB-REC.01: Statement Ingestion
  insertLenderStatement(tx: Tx, row: LenderStatementRow): Promise<void>;
  insertLenderStatementLines(tx: Tx, rows: LenderStatementLineRow[]): Promise<void>;
  findLenderStatementById(tx: Tx, tenantId: string, id: string): Promise<LenderStatementRow | null>;
  findDuplicateLenderStatement(
    tx: Tx,
    tenantId: string,
    lenderId: string,
    period: string,
    fileSha256: string,
  ): Promise<LenderStatementRow | null>;
  listLenderStatements(tx: Tx, tenantId: string, lenderId?: string): Promise<LenderStatementRow[]>;
  updateLenderStatementStatus(tx: Tx, tenantId: string, id: string, status: string): Promise<void>;
  listStatementLines(tx: Tx, tenantId: string, statementId: string): Promise<LenderStatementLineRow[]>;
  findStatementLineById(tx: Tx, tenantId: string, id: string): Promise<LenderStatementLineRow | null>;
  updateStatementLineStatus(tx: Tx, tenantId: string, id: string, status: string): Promise<void>;

  // SUB-REC.02: Matching
  findCalculationsForMatching(tx: Tx, tenantId: string, lenderId: string): Promise<any[]>;
  insertReconciliationMatch(tx: Tx, row: ReconciliationMatchRow): Promise<void>;
  findActiveMatchForLine(tx: Tx, tenantId: string, statementLineId: string): Promise<ReconciliationMatchRow | null>;
  listMatchesForStatement(tx: Tx, tenantId: string, statementId: string): Promise<ReconciliationMatchRow[]>;

  // SUB-REC.03: Exceptions & Adjustments
  insertReconciliationException(tx: Tx, row: ReconciliationExceptionRow): Promise<void>;
  listExceptions(
    tx: Tx,
    tenantId: string,
    filters: { cursor?: string; limit: number; status?: string; classification?: string },
  ): Promise<{ rows: ReconciliationExceptionRow[]; nextCursor: string | null }>;
  findExceptionById(tx: Tx, tenantId: string, id: string): Promise<ReconciliationExceptionRow | null>;
  updateException(
    tx: Tx,
    tenantId: string,
    id: string,
    updates: {
      status: string;
      classification?: string;
      resolutionNote: string;
      resolvedBy: string;
      resolvedAt: Date;
      evidenceRef?: string;
    },
  ): Promise<ReconciliationExceptionRow | null>;

  insertAdjustment(tx: Tx, row: AdjustmentRow): Promise<void>;
  findAdjustmentById(tx: Tx, tenantId: string, id: string): Promise<AdjustmentRow | null>;
  listAdjustments(tx: Tx, tenantId: string): Promise<AdjustmentRow[]>;
  updateAdjustmentApproval(
    tx: Tx,
    tenantId: string,
    id: string,
    status: 'APPROVED' | 'REJECTED',
    approverId: string,
  ): Promise<AdjustmentRow | null>;

  // SUB-REC.04: Disputes & Holds
  insertDispute(tx: Tx, row: DisputeRow): Promise<void>;
  findDisputeById(tx: Tx, tenantId: string, id: string): Promise<DisputeRow | null>;
  listDisputes(tx: Tx, tenantId: string, filters?: { status?: string; partyType?: string }): Promise<DisputeRow[]>;
  updateDispute(
    tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: {
      status: string;
      resolution?: string;
      outcomeAdjustmentId?: string;
      updatedBy: string;
    },
  ): Promise<DisputeRow | null>;
  holdPayables(tx: Tx, tenantId: string, payableIds: string[], reason: string): Promise<void>;
  releasePayables(tx: Tx, tenantId: string, payableIds: string[]): Promise<void>;

  // SUB-REC.05: Bank Payout Reconciliation
  findPayoutRequestById(tx: Tx, tenantId: string, payoutId: string): Promise<any | null>;
  reconcilePayoutRequest(tx: Tx, tenantId: string, payoutId: string): Promise<any | null>;
}

export class PgReconciliationRepository implements ReconciliationRepository {
  // SUB-REC.01
  async insertLenderStatement(tx: Tx, row: LenderStatementRow): Promise<void> {
    await sql`
      INSERT INTO app.lender_statement (
        id, tenant_id, lender_id, period, source_file_key, import_batch_id,
        file_sha256, totals, status, created_at, created_by
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.lender_id}, ${row.period},
        ${row.source_file_key}, ${row.import_batch_id}, ${row.file_sha256},
        ${JSON.stringify(row.totals)}::jsonb, ${row.status}, ${row.created_at}, ${row.created_by}
      )
    `.execute(tx);
  }

  async insertLenderStatementLines(tx: Tx, rows: LenderStatementLineRow[]): Promise<void> {
    if (rows.length === 0) return;
    for (const r of rows) {
      await sql`
        INSERT INTO app.lender_statement_line (
          id, tenant_id, statement_id, loan_account_hash, customer_name_masked,
          disbursed_amount, commission_amount, tax_deducted, paid_on, raw_row_ref,
          status, created_at
        ) VALUES (
          ${r.id}, ${r.tenant_id}, ${r.statement_id}, ${r.loan_account_hash}, ${r.customer_name_masked},
          ${r.disbursed_amount}, ${r.commission_amount}, ${r.tax_deducted}, ${r.paid_on}, ${r.raw_row_ref},
          ${r.status}, ${r.created_at}
        )
      `.execute(tx);
    }
  }

  async findLenderStatementById(tx: Tx, tenantId: string, id: string): Promise<LenderStatementRow | null> {
    const res = await sql<LenderStatementRow>`
      SELECT * FROM app.lender_statement
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async findDuplicateLenderStatement(
    tx: Tx,
    tenantId: string,
    lenderId: string,
    period: string,
    fileSha256: string,
  ): Promise<LenderStatementRow | null> {
    const res = await sql<LenderStatementRow>`
      SELECT * FROM app.lender_statement
      WHERE tenant_id = ${tenantId} AND lender_id = ${lenderId} 
        AND period = ${period} AND file_sha256 = ${fileSha256}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async listLenderStatements(tx: Tx, tenantId: string, lenderId?: string): Promise<LenderStatementRow[]> {
    if (lenderId) {
      const res = await sql<LenderStatementRow>`
        SELECT * FROM app.lender_statement
        WHERE tenant_id = ${tenantId} AND lender_id = ${lenderId}
        ORDER BY created_at DESC
      `.execute(tx);
      return res.rows as LenderStatementRow[];
    }
    const res = await sql<LenderStatementRow>`
      SELECT * FROM app.lender_statement
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
    `.execute(tx);
    return res.rows as LenderStatementRow[];
  }

  async updateLenderStatementStatus(tx: Tx, tenantId: string, id: string, status: string): Promise<void> {
    await sql`
      UPDATE app.lender_statement
      SET status = ${status}
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
  }

  async listStatementLines(tx: Tx, tenantId: string, statementId: string): Promise<LenderStatementLineRow[]> {
    const res = await sql<LenderStatementLineRow>`
      SELECT * FROM app.lender_statement_line
      WHERE tenant_id = ${tenantId} AND statement_id = ${statementId}
      ORDER BY created_at ASC
    `.execute(tx);
    return res.rows as LenderStatementLineRow[];
  }

  async findStatementLineById(tx: Tx, tenantId: string, id: string): Promise<LenderStatementLineRow | null> {
    const res = await sql<LenderStatementLineRow>`
      SELECT * FROM app.lender_statement_line
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async updateStatementLineStatus(tx: Tx, tenantId: string, id: string, status: string): Promise<void> {
    await sql`
      UPDATE app.lender_statement_line
      SET status = ${status}
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
  }

  // SUB-REC.02: Matching
  async findCalculationsForMatching(tx: Tx, tenantId: string, lenderId: string): Promise<any[]> {
    const res = await sql`
      SELECT c.*, t.loan_account_no, t.amount as tranche_amount
      FROM app.commission_calculation c
      LEFT JOIN app.disbursement_tranche t ON t.id = c.tranche_id AND t.tenant_id = c.tenant_id
      WHERE c.tenant_id = ${tenantId} AND c.lender_id = ${lenderId} AND c.status = 'ACTIVE'
      ORDER BY c.created_at ASC
    `.execute(tx);
    return res.rows;
  }

  async insertReconciliationMatch(tx: Tx, row: ReconciliationMatchRow): Promise<void> {
    await sql`
      INSERT INTO app.reconciliation_match (
        id, tenant_id, statement_line_id, calculation_id, match_type,
        matched_amount, decision_record_id, status, created_at, created_by
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.statement_line_id}, ${row.calculation_id},
        ${row.match_type}, ${row.matched_amount}, ${row.decision_record_id},
        ${row.status}, ${row.created_at}, ${row.created_by}
      )
    `.execute(tx);
  }

  async findActiveMatchForLine(tx: Tx, tenantId: string, statementLineId: string): Promise<ReconciliationMatchRow | null> {
    const res = await sql<ReconciliationMatchRow>`
      SELECT * FROM app.reconciliation_match
      WHERE tenant_id = ${tenantId} AND statement_line_id = ${statementLineId} AND status = 'ACTIVE'
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async listMatchesForStatement(tx: Tx, tenantId: string, statementId: string): Promise<ReconciliationMatchRow[]> {
    const res = await sql<ReconciliationMatchRow>`
      SELECT m.* FROM app.reconciliation_match m
      JOIN app.lender_statement_line l ON l.id = m.statement_line_id AND l.tenant_id = m.tenant_id
      WHERE m.tenant_id = ${tenantId} AND l.statement_id = ${statementId}
      ORDER BY m.created_at ASC
    `.execute(tx);
    return res.rows as ReconciliationMatchRow[];
  }

  // SUB-REC.03: Exceptions & Adjustments
  async insertReconciliationException(tx: Tx, row: ReconciliationExceptionRow): Promise<void> {
    await sql`
      INSERT INTO app.reconciliation_exception (
        id, tenant_id, statement_line_id, calculation_id, variance_amount,
        classification, status, owner_user_id, evidence_ref, created_at, created_by
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.statement_line_id}, ${row.calculation_id},
        ${row.variance_amount}, ${row.classification}, ${row.status},
        ${row.owner_user_id}, ${row.evidence_ref}, ${row.created_at}, ${row.created_by}
      )
    `.execute(tx);
  }

  async listExceptions(
    tx: Tx,
    tenantId: string,
    filters: { cursor?: string; limit: number; status?: string; classification?: string },
  ): Promise<{ rows: ReconciliationExceptionRow[]; nextCursor: string | null }> {
    let query = sql<ReconciliationExceptionRow>`
      SELECT * FROM app.reconciliation_exception
      WHERE tenant_id = ${tenantId}
    `;

    if (filters.status) {
      query = sql`${query} AND status = ${filters.status}`;
    }
    if (filters.classification) {
      query = sql`${query} AND classification = ${filters.classification}`;
    }
    if (filters.cursor) {
      query = sql`${query} AND id > ${filters.cursor}`;
    }

    const limitPlusOne = filters.limit + 1;
    query = sql`${query} ORDER BY id ASC LIMIT ${limitPlusOne}`;

    const res = await query.execute(tx);
    const hasMore = res.rows.length > filters.limit;
    const rows = hasMore ? res.rows.slice(0, filters.limit) : res.rows;
    const nextCursor = hasMore ? rows[rows.length - 1]!.id : null;

    return { rows: rows as ReconciliationExceptionRow[], nextCursor };
  }

  async findExceptionById(tx: Tx, tenantId: string, id: string): Promise<ReconciliationExceptionRow | null> {
    const res = await sql<ReconciliationExceptionRow>`
      SELECT * FROM app.reconciliation_exception
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async updateException(
    tx: Tx,
    tenantId: string,
    id: string,
    updates: {
      status: string;
      classification?: string;
      resolutionNote: string;
      resolvedBy: string;
      resolvedAt: Date;
      evidenceRef?: string;
    },
  ): Promise<ReconciliationExceptionRow | null> {
    await sql`
      UPDATE app.reconciliation_exception
      SET status = ${updates.status},
          resolution_note = ${updates.resolutionNote},
          resolved_by = ${updates.resolvedBy},
          resolved_at = ${updates.resolvedAt},
          classification = COALESCE(${updates.classification ?? null}, classification),
          evidence_ref = COALESCE(${updates.evidenceRef ?? null}, evidence_ref)
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return this.findExceptionById(tx, tenantId, id);
  }

  async insertAdjustment(tx: Tx, row: AdjustmentRow): Promise<void> {
    await sql`
      INSERT INTO app.adjustment (
        id, tenant_id, adjustment_type, type, amount, reason, status,
        calculation_id, payable_id, exception_id, evidence_ref, journal_id,
        lock_version, created_at, created_by
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.adjustment_type}, ${row.type},
        ${row.amount}, ${row.reason}, ${row.status},
        ${row.calculation_id}, ${row.payable_id}, ${row.exception_id},
        ${row.evidence_ref}, ${row.journal_id}, ${row.lock_version},
        ${row.created_at}, ${row.created_by}
      )
    `.execute(tx);
  }

  async findAdjustmentById(tx: Tx, tenantId: string, id: string): Promise<AdjustmentRow | null> {
    const res = await sql<AdjustmentRow>`
      SELECT * FROM app.adjustment
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async listAdjustments(tx: Tx, tenantId: string): Promise<AdjustmentRow[]> {
    const res = await sql<AdjustmentRow>`
      SELECT * FROM app.adjustment
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
    `.execute(tx);
    return res.rows as AdjustmentRow[];
  }

  async updateAdjustmentApproval(
    tx: Tx,
    tenantId: string,
    id: string,
    status: 'APPROVED' | 'REJECTED',
    approverId: string,
  ): Promise<AdjustmentRow | null> {
    const now = new Date();
    await sql`
      UPDATE app.adjustment
      SET status = ${status},
          approved_by = ${approverId},
          approved_at = ${now},
          lock_version = lock_version + 1
      WHERE tenant_id = ${tenantId} AND id = ${id} AND status = 'PENDING'
    `.execute(tx);
    return this.findAdjustmentById(tx, tenantId, id);
  }

  // SUB-REC.04: Disputes
  async insertDispute(tx: Tx, row: DisputeRow): Promise<void> {
    await sql`
      INSERT INTO app.dispute (
        id, tenant_id, party_type, party_id, subject_type, subject_id,
        reason, status, lock_version, created_at, created_by, updated_at, updated_by
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.party_type}, ${row.party_id},
        ${row.subject_type}, ${row.subject_id}, ${row.reason}, ${row.status},
        ${row.lock_version}, ${row.created_at}, ${row.created_by},
        ${row.updated_at}, ${row.updated_by}
      )
    `.execute(tx);
  }

  async findDisputeById(tx: Tx, tenantId: string, id: string): Promise<DisputeRow | null> {
    const res = await sql<DisputeRow>`
      SELECT * FROM app.dispute
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async listDisputes(
    tx: Tx,
    tenantId: string,
    filters?: { status?: string; partyType?: string },
  ): Promise<DisputeRow[]> {
    let query = sql<DisputeRow>`
      SELECT * FROM app.dispute
      WHERE tenant_id = ${tenantId}
    `;
    if (filters?.status) {
      query = sql`${query} AND status = ${filters.status}`;
    }
    if (filters?.partyType) {
      query = sql`${query} AND party_type = ${filters.partyType}`;
    }
    query = sql`${query} ORDER BY created_at DESC`;
    const res = await query.execute(tx);
    return res.rows as DisputeRow[];
  }

  async updateDispute(
    tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: {
      status: string;
      resolution?: string;
      outcomeAdjustmentId?: string;
      updatedBy: string;
    },
  ): Promise<DisputeRow | null> {
    const now = new Date();
    const res = await sql<DisputeRow>`
      UPDATE app.dispute
      SET status = ${updates.status},
          resolution = COALESCE(${updates.resolution ?? null}, resolution),
          outcome_adjustment_id = COALESCE(${updates.outcomeAdjustmentId ?? null}, outcome_adjustment_id),
          lock_version = lock_version + 1,
          updated_at = ${now},
          updated_by = ${updates.updatedBy}
      WHERE tenant_id = ${tenantId} AND id = ${id} AND lock_version = ${expectedLockVersion}
      RETURNING *
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async holdPayables(tx: Tx, tenantId: string, payableIds: string[], reason: string): Promise<void> {
    if (payableIds.length === 0) return;
    for (const pid of payableIds) {
      await sql`
        UPDATE app.commission_payable
        SET state = 'ON_HOLD',
            hold_reasons = COALESCE(hold_reasons, '[]'::jsonb) || ${JSON.stringify([reason])}::jsonb,
            updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${pid} AND state != 'PAID'
      `.execute(tx);
    }
  }

  async releasePayables(tx: Tx, tenantId: string, payableIds: string[]): Promise<void> {
    if (payableIds.length === 0) return;
    for (const pid of payableIds) {
      await sql`
        UPDATE app.commission_payable
        SET state = 'ELIGIBLE',
            updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${pid} AND state = 'ON_HOLD'
      `.execute(tx);
    }
  }

  // SUB-REC.05: Bank Payout Reconciliation
  async findPayoutRequestById(tx: Tx, tenantId: string, payoutId: string): Promise<any | null> {
    const res = await sql`
      SELECT * FROM app.payout_request
      WHERE tenant_id = ${tenantId} AND id = ${payoutId}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async reconcilePayoutRequest(tx: Tx, tenantId: string, payoutId: string): Promise<any | null> {
    const res = await sql`
      UPDATE app.payout_request
      SET status = 'RECONCILED',
          updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${payoutId} AND status = 'PAYMENT_RECORDED'
      RETURNING *
    `.execute(tx);
    return res.rows[0] ?? null;
  }
}
