// apps/api/src/modules/finance/repository.ts — owner: Developer 5 (Bhushan)
import type { Tx } from '@dsa/contracts';
import { sql } from 'kysely';

export interface CommissionPlanRow {
  id: string;
  tenant_id: string;
  lender_id: string;
  qualifying_event: string;
  basis: string;
  rounding_mode: string;
  clawback_window_days: number;
  rule_set_id: string | null;
  status: string;
  lock_version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}

export interface CommissionCalculationRow {
  id: string;
  tenant_id: string;
  lender_id: string;
  tranche_id: string;
  application_id: string | null;
  lender_case_id: string | null;
  event_date: Date;
  basis_amount: string;
  rate: string;
  rate_type: string;
  cap: string | null;
  gross_amount: string;
  currency: string;
  calc_kind: string;
  rule_set_version_id: string | null;
  decision_record_id: string | null;
  inputs_hash: string | null;
  status: string;
  supersedes_id: string | null;
  lock_version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}

export interface CommissionPayableRow {
  id: string;
  tenant_id: string;
  calculation_id: string;
  connector_id: string;
  share_rate: string;
  amount: string;
  currency: string;
  state: string;
  hold_reasons: any;
  eligibility_decision_id: string | null;
  lock_version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}

export interface PayoutRequestRow {
  id: string;
  tenant_id: string;
  connector_id: string;
  origin: string;
  status: string;
  total: string;
  currency: string;
  payment_ref_ciphertext: string | null;
  payment_ref_masked: string | null;
  paid_on: Date | null;
  failure_reason: string | null;
  retry_of_payout_id: string | null;
  submitted_by: string | null;
  submitted_at: Date | null;
  lock_version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}

export interface PayoutLineRow {
  id: string;
  tenant_id: string;
  payout_id: string;
  payable_id: string;
  amount: string;
  currency: string;
  status: string;
  created_at: Date;
  created_by: string;
}

export interface PayoutApprovalRow {
  id: string;
  tenant_id: string;
  payout_id: string;
  approver_id: string;
  seat: string;
  decision: string;
  comment: string | null;
  approved_at: Date;
}

export interface PayoutBatchRow {
  id: string;
  tenant_id: string;
  payout_ids: string[];
  file_object_key: string | null;
  file_sha256: string | null;
  status: string;
  generated_by: string;
  generated_at: Date;
}

export interface AdjustmentRow {
  id: string;
  tenant_id: string;
  adjustment_type: string;
  calculation_id: string | null;
  payable_id: string | null;
  amount: string;
  reason: string;
  evidence_ref: string | null;
  status: string;
  created_at: Date;
  created_by: string;
  approved_at: Date | null;
  approved_by: string | null;
}

export interface RecalculationProposalRow {
  id: string;
  tenant_id: string;
  reason: string;
  affected_calculation_ids: string[];
  preview: any;
  status: string;
  approved_by: string | null;
  approved_at: Date | null;
  lock_version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}

export interface FinanceRepository {
  // Commission Plans
  insertCommissionPlan(tx: Tx, row: CommissionPlanRow): Promise<void>;
  findCommissionPlanById(tx: Tx, tenantId: string, id: string): Promise<CommissionPlanRow | null>;
  findActiveCommissionPlan(tx: Tx, tenantId: string, lenderId: string): Promise<CommissionPlanRow | null>;
  listCommissionPlans(tx: Tx, tenantId: string, lenderId?: string): Promise<CommissionPlanRow[]>;
  updateCommissionPlan(
    tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<CommissionPlanRow>,
  ): Promise<CommissionPlanRow | null>;
  approveCommissionPlan(
    tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    approverId: string,
  ): Promise<CommissionPlanRow | null>;

  // Calculations & Payables
  insertCommissionCalculation(tx: Tx, row: CommissionCalculationRow): Promise<void>;
  findCommissionCalculationById(tx: Tx, tenantId: string, id: string): Promise<CommissionCalculationRow | null>;
  findEarnedCalculationByTranche(tx: Tx, tenantId: string, trancheId: string): Promise<CommissionCalculationRow | null>;
  listCommissionCalculations(
    tx: Tx,
    tenantId: string,
    filters: { lenderId?: string; status?: string; cursor?: string; limit: number },
  ): Promise<{ rows: CommissionCalculationRow[]; nextCursor: string | null }>;
  updateCommissionCalculationStatus(
    tx: Tx,
    tenantId: string,
    id: string,
    status: string,
  ): Promise<CommissionCalculationRow | null>;
  insertCommissionPayable(tx: Tx, row: CommissionPayableRow): Promise<void>;
  findCommissionPayableById(tx: Tx, tenantId: string, id: string): Promise<CommissionPayableRow | null>;
  listCommissionPayables(
    tx: Tx,
    tenantId: string,
    filters: { connectorId?: string; state?: string; cursor?: string; limit: number },
  ): Promise<{ rows: CommissionPayableRow[]; nextCursor: string | null }>;
  updateCommissionPayableState(
    tx: Tx,
    tenantId: string,
    id: string,
    state: string,
  ): Promise<CommissionPayableRow | null>;

  // Adjustments / Clawbacks
  insertAdjustment(tx: Tx, row: AdjustmentRow): Promise<void>;
  findAdjustmentById(tx: Tx, tenantId: string, id: string): Promise<AdjustmentRow | null>;
  listAdjustments(tx: Tx, tenantId: string): Promise<AdjustmentRow[]>;
  approveAdjustment(tx: Tx, tenantId: string, id: string, approverId: string): Promise<AdjustmentRow | null>;
  rejectAdjustment(tx: Tx, tenantId: string, id: string, rejecterId: string): Promise<AdjustmentRow | null>;

  // Payout Requests
  insertPayoutRequest(tx: Tx, row: PayoutRequestRow): Promise<void>;
  findPayoutRequestById(tx: Tx, tenantId: string, id: string): Promise<PayoutRequestRow | null>;
  listPayoutRequests(
    tx: Tx,
    tenantId: string,
    filters: { connectorId?: string; status?: string; cursor?: string; limit: number },
  ): Promise<{ rows: PayoutRequestRow[]; nextCursor: string | null }>;
  lockCommissionPayablesAscending(tx: Tx, tenantId: string, ids: string[]): Promise<CommissionPayableRow[]>;
  insertPayoutLine(tx: Tx, row: PayoutLineRow): Promise<void>;
  listPayoutLines(tx: Tx, tenantId: string, payoutId: string): Promise<PayoutLineRow[]>;
  updatePayoutLineStatus(tx: Tx, tenantId: string, id: string, status: string): Promise<PayoutLineRow | null>;
  findActivePayoutLineForPayable(tx: Tx, tenantId: string, payableId: string): Promise<PayoutLineRow | null>;
  insertPayoutApproval(tx: Tx, row: PayoutApprovalRow): Promise<void>;
  updatePayoutStatus(
    tx: Tx,
    tenantId: string,
    id: string,
    status: string,
    updates?: { paidOn?: Date; paymentRefMasked?: string; paymentRefCiphertext?: string; failureReason?: string },
  ): Promise<PayoutRequestRow | null>;
  emitOutboxEvent?(
    tx: Tx,
    event: {
      id: string;
      tenantId: string;
      eventType: string;
      subjectType: string;
      subjectId: string;
      payload: Record<string, unknown>;
      correlationId?: string;
    },
  ): Promise<void>;

  // Payout Batches
  insertPayoutBatch(tx: Tx, row: PayoutBatchRow): Promise<void>;
  findPayoutBatchById(tx: Tx, tenantId: string, id: string): Promise<PayoutBatchRow | null>;
  listPayoutBatches(tx: Tx, tenantId: string): Promise<PayoutBatchRow[]>;
  updatePayoutBatchStatus?(tx: Tx, tenantId: string, id: string, status: string): Promise<PayoutBatchRow | null>;


  // Recalculations
  insertRecalculationProposal(tx: Tx, row: RecalculationProposalRow): Promise<void>;
  findRecalculationProposalById(tx: Tx, tenantId: string, id: string): Promise<RecalculationProposalRow | null>;
  listRecalculationProposals(tx: Tx, tenantId: string): Promise<RecalculationProposalRow[]>;
  approveRecalculationProposal(
    tx: Tx,
    tenantId: string,
    id: string,
    approverId: string,
  ): Promise<RecalculationProposalRow | null>;
}

export class SqlFinanceRepository implements FinanceRepository {
  async insertCommissionPlan(tx: Tx, row: CommissionPlanRow): Promise<void> {
    await sql`
      INSERT INTO commission_plan (
        id, tenant_id, lender_id, qualifying_event, basis, rounding_mode,
        clawback_window_days, rule_set_id, status, lock_version,
        created_at, created_by, updated_at, updated_by
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.lender_id}, ${row.qualifying_event},
        ${row.basis}, ${row.rounding_mode}, ${row.clawback_window_days},
        ${row.rule_set_id}, ${row.status}, ${row.lock_version},
        ${row.created_at}, ${row.created_by}, ${row.updated_at}, ${row.updated_by}
      )
    `.execute(tx);
  }

  async findCommissionPlanById(tx: Tx, tenantId: string, id: string): Promise<CommissionPlanRow | null> {
    const res = await sql<CommissionPlanRow>`
      SELECT * FROM commission_plan WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async findActiveCommissionPlan(tx: Tx, tenantId: string, lenderId: string): Promise<CommissionPlanRow | null> {
    const res = await sql<CommissionPlanRow>`
      SELECT * FROM commission_plan
      WHERE tenant_id = ${tenantId} AND lender_id = ${lenderId} AND status = 'ACTIVE'
      ORDER BY created_at DESC LIMIT 1
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async listCommissionPlans(tx: Tx, tenantId: string, lenderId?: string): Promise<CommissionPlanRow[]> {
    let query = sql<CommissionPlanRow>`SELECT * FROM commission_plan WHERE tenant_id = ${tenantId}`;
    if (lenderId) {
      query = sql<CommissionPlanRow>`${query} AND lender_id = ${lenderId}`;
    }
    query = sql<CommissionPlanRow>`${query} ORDER BY created_at DESC`;
    const res = await query.execute(tx);
    return res.rows;
  }

  async updateCommissionPlan(
    tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<CommissionPlanRow>,
  ): Promise<CommissionPlanRow | null> {
    const res = await sql<CommissionPlanRow>`
      UPDATE commission_plan
      SET
        qualifying_event = COALESCE(${updates.qualifying_event ?? null}, qualifying_event),
        basis = COALESCE(${updates.basis ?? null}, basis),
        rounding_mode = COALESCE(${updates.rounding_mode ?? null}, rounding_mode),
        clawback_window_days = COALESCE(${updates.clawback_window_days ?? null}, clawback_window_days),
        status = COALESCE(${updates.status ?? null}, status),
        lock_version = lock_version + 1,
        updated_at = now(),
        updated_by = COALESCE(${updates.updated_by ?? 'system'}, updated_by)
      WHERE tenant_id = ${tenantId} AND id = ${id} AND lock_version = ${expectedLockVersion}
      RETURNING *
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async approveCommissionPlan(
    tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    approverId: string,
  ): Promise<CommissionPlanRow | null> {
    const res = await sql<CommissionPlanRow>`
      UPDATE commission_plan
      SET
        status = 'ACTIVE',
        lock_version = lock_version + 1,
        updated_at = now(),
        updated_by = ${approverId}
      WHERE tenant_id = ${tenantId} AND id = ${id} AND lock_version = ${expectedLockVersion}
      RETURNING *
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async insertCommissionCalculation(tx: Tx, row: CommissionCalculationRow): Promise<void> {
    await sql`
      INSERT INTO commission_calculation (
        id, tenant_id, lender_id, tranche_id, application_id, lender_case_id,
        event_date, basis_amount, rate, rate_type, cap, gross_amount, currency,
        calc_kind, rule_set_version_id, decision_record_id, inputs_hash, status,
        supersedes_id, lock_version, created_at, created_by, updated_at, updated_by
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.lender_id}, ${row.tranche_id},
        ${row.application_id}, ${row.lender_case_id}, ${row.event_date},
        ${row.basis_amount}, ${row.rate}, ${row.rate_type}, ${row.cap},
        ${row.gross_amount}, ${row.currency}, ${row.calc_kind},
        ${row.rule_set_version_id}, ${row.decision_record_id}, ${row.inputs_hash},
        ${row.status}, ${row.supersedes_id}, ${row.lock_version},
        ${row.created_at}, ${row.created_by}, ${row.updated_at}, ${row.updated_by}
      )
    `.execute(tx);
  }

  async findCommissionCalculationById(tx: Tx, tenantId: string, id: string): Promise<CommissionCalculationRow | null> {
    const res = await sql<CommissionCalculationRow>`
      SELECT * FROM commission_calculation WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async findEarnedCalculationByTranche(tx: Tx, tenantId: string, trancheId: string): Promise<CommissionCalculationRow | null> {
    const res = await sql<CommissionCalculationRow>`
      SELECT * FROM commission_calculation 
      WHERE tenant_id = ${tenantId} AND tranche_id = ${trancheId} AND calc_kind = 'EARNED'
      LIMIT 1
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async listCommissionCalculations(
    tx: Tx,
    tenantId: string,
    filters: { lenderId?: string; status?: string; cursor?: string; limit: number },
  ): Promise<{ rows: CommissionCalculationRow[]; nextCursor: string | null }> {
    const limitPlusOne = filters.limit + 1;
    let query = sql<CommissionCalculationRow>`SELECT * FROM commission_calculation WHERE tenant_id = ${tenantId}`;
    if (filters.lenderId) query = sql<CommissionCalculationRow>`${query} AND lender_id = ${filters.lenderId}`;
    if (filters.status) query = sql<CommissionCalculationRow>`${query} AND status = ${filters.status}`;
    if (filters.cursor) query = sql<CommissionCalculationRow>`${query} AND id > ${filters.cursor}`;
    query = sql<CommissionCalculationRow>`${query} ORDER BY id ASC LIMIT ${limitPlusOne}`;

    const res = await query.execute(tx);
    const hasMore = res.rows.length > filters.limit;
    const rows = hasMore ? res.rows.slice(0, filters.limit) : res.rows;
    const nextCursor = hasMore ? (rows[rows.length - 1]?.id ?? null) : null;
    return { rows, nextCursor };
  }

  async insertCommissionPayable(tx: Tx, row: CommissionPayableRow): Promise<void> {
    await sql`
      INSERT INTO commission_payable (
        id, tenant_id, calculation_id, connector_id, share_rate, amount,
        currency, state, hold_reasons, eligibility_decision_id, lock_version,
        created_at, created_by, updated_at, updated_by
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.calculation_id}, ${row.connector_id},
        ${row.share_rate}, ${row.amount}, ${row.currency}, ${row.state},
        ${row.hold_reasons ? JSON.stringify(row.hold_reasons) : null}::jsonb,
        ${row.eligibility_decision_id}, ${row.lock_version},
        ${row.created_at}, ${row.created_by}, ${row.updated_at}, ${row.updated_by}
      )
    `.execute(tx);
  }

  async findCommissionPayableById(tx: Tx, tenantId: string, id: string): Promise<CommissionPayableRow | null> {
    const res = await sql<CommissionPayableRow>`
      SELECT * FROM commission_payable WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async listCommissionPayables(
    tx: Tx,
    tenantId: string,
    filters: { connectorId?: string; state?: string; cursor?: string; limit: number },
  ): Promise<{ rows: CommissionPayableRow[]; nextCursor: string | null }> {
    const limitPlusOne = filters.limit + 1;
    let query = sql<CommissionPayableRow>`SELECT * FROM commission_payable WHERE tenant_id = ${tenantId}`;
    if (filters.connectorId) query = sql<CommissionPayableRow>`${query} AND connector_id = ${filters.connectorId}`;
    if (filters.state) query = sql<CommissionPayableRow>`${query} AND state = ${filters.state}`;
    if (filters.cursor) query = sql<CommissionPayableRow>`${query} AND id > ${filters.cursor}`;
    query = sql<CommissionPayableRow>`${query} ORDER BY id ASC LIMIT ${limitPlusOne}`;

    const res = await query.execute(tx);
    const hasMore = res.rows.length > filters.limit;
    const rows = hasMore ? res.rows.slice(0, filters.limit) : res.rows;
    const nextCursor = hasMore ? (rows[rows.length - 1]?.id ?? null) : null;
    return { rows, nextCursor };
  }

  async updateCommissionPayableState(
    tx: Tx,
    tenantId: string,
    id: string,
    state: string,
  ): Promise<CommissionPayableRow | null> {
    const res = await sql<CommissionPayableRow>`
      UPDATE commission_payable
      SET state = ${state}, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${id}
      RETURNING *
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async insertAdjustment(tx: Tx, row: AdjustmentRow): Promise<void> {
    await sql`
      INSERT INTO adjustment (
        id, tenant_id, adjustment_type, calculation_id, payable_id, amount,
        reason, evidence_ref, status, created_at, created_by, approved_at, approved_by
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.adjustment_type}, ${row.calculation_id},
        ${row.payable_id}, ${row.amount}, ${row.reason}, ${row.evidence_ref},
        ${row.status}, ${row.created_at}, ${row.created_by}, ${row.approved_at}, ${row.approved_by}
      )
    `.execute(tx);
  }

  async findAdjustmentById(tx: Tx, tenantId: string, id: string): Promise<AdjustmentRow | null> {
    const res = await sql<AdjustmentRow>`
      SELECT * FROM adjustment WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async listAdjustments(tx: Tx, tenantId: string): Promise<AdjustmentRow[]> {
    const res = await sql<AdjustmentRow>`
      SELECT * FROM adjustment WHERE tenant_id = ${tenantId} ORDER BY created_at DESC
    `.execute(tx);
    return res.rows;
  }

  async approveAdjustment(tx: Tx, tenantId: string, id: string, approverId: string): Promise<AdjustmentRow | null> {
    const res = await sql<AdjustmentRow>`
      UPDATE adjustment
      SET status = 'APPROVED', approved_at = now(), approved_by = ${approverId}
      WHERE tenant_id = ${tenantId} AND id = ${id}
      RETURNING *
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async insertPayoutRequest(tx: Tx, row: PayoutRequestRow): Promise<void> {
    await sql`
      INSERT INTO payout_request (
        id, tenant_id, connector_id, origin, status, total, currency,
        payment_ref_ciphertext, payment_ref_masked, paid_on, failure_reason,
        retry_of_payout_id, submitted_by, submitted_at, lock_version,
        created_at, created_by, updated_at, updated_by
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.connector_id}, ${row.origin},
        ${row.status}, ${row.total}, ${row.currency}, ${row.payment_ref_ciphertext},
        ${row.payment_ref_masked}, ${row.paid_on}, ${row.failure_reason},
        ${row.retry_of_payout_id}, ${row.submitted_by}, ${row.submitted_at},
        ${row.lock_version}, ${row.created_at}, ${row.created_by}, ${row.updated_at}, ${row.updated_by}
      )
    `.execute(tx);
  }

  async findPayoutRequestById(tx: Tx, tenantId: string, id: string): Promise<PayoutRequestRow | null> {
    const res = await sql<PayoutRequestRow>`
      SELECT * FROM payout_request WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async listPayoutRequests(
    tx: Tx,
    tenantId: string,
    filters: { connectorId?: string; status?: string; cursor?: string; limit: number },
  ): Promise<{ rows: PayoutRequestRow[]; nextCursor: string | null }> {
    const limitPlusOne = filters.limit + 1;
    let query = sql<PayoutRequestRow>`SELECT * FROM payout_request WHERE tenant_id = ${tenantId}`;
    if (filters.connectorId) query = sql<PayoutRequestRow>`${query} AND connector_id = ${filters.connectorId}`;
    if (filters.status) query = sql<PayoutRequestRow>`${query} AND status = ${filters.status}`;
    if (filters.cursor) query = sql<PayoutRequestRow>`${query} AND id > ${filters.cursor}`;
    query = sql<PayoutRequestRow>`${query} ORDER BY id ASC LIMIT ${limitPlusOne}`;

    const res = await query.execute(tx);
    const hasMore = res.rows.length > filters.limit;
    const rows = hasMore ? res.rows.slice(0, filters.limit) : res.rows;
    const nextCursor = hasMore ? (rows[rows.length - 1]?.id ?? null) : null;
    return { rows, nextCursor };
  }

  async insertPayoutLine(tx: Tx, row: PayoutLineRow): Promise<void> {
    await sql`
      INSERT INTO payout_line (
        id, tenant_id, payout_id, payable_id, amount, currency, status, created_at, created_by
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.payout_id}, ${row.payable_id},
        ${row.amount}, ${row.currency}, ${row.status}, ${row.created_at}, ${row.created_by}
      )
    `.execute(tx);
  }

  async listPayoutLines(tx: Tx, tenantId: string, payoutId: string): Promise<PayoutLineRow[]> {
    const res = await sql<PayoutLineRow>`
      SELECT * FROM payout_line WHERE tenant_id = ${tenantId} AND payout_id = ${payoutId}
    `.execute(tx);
    return res.rows;
  }

  async updatePayoutLineStatus(
    tx: Tx,
    tenantId: string,
    id: string,
    status: string,
  ): Promise<PayoutLineRow | null> {
    const res = await sql<PayoutLineRow>`
      UPDATE payout_line
      SET status = ${status}
      WHERE tenant_id = ${tenantId} AND id = ${id}
      RETURNING *
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async lockCommissionPayablesAscending(
    tx: Tx,
    tenantId: string,
    ids: string[],
  ): Promise<CommissionPayableRow[]> {
    if (ids.length === 0) return [];
    const sortedIds = [...ids].sort();
    const res = await sql<CommissionPayableRow>`
      SELECT * FROM commission_payable
      WHERE tenant_id = ${tenantId} AND id = ANY(${sortedIds}::text[])
      ORDER BY id ASC
      FOR UPDATE
    `.execute(tx);
    return res.rows;
  }

  async insertPayoutApproval(tx: Tx, row: PayoutApprovalRow): Promise<void> {
    await sql`
      INSERT INTO payout_approval (
        id, tenant_id, payout_id, approver_id, seat, decision, comment, approved_at
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.payout_id}, ${row.approver_id},
        ${row.seat}, ${row.decision}, ${row.comment}, ${row.approved_at}
      )
    `.execute(tx);
  }

  async updatePayoutStatus(
    tx: Tx,
    tenantId: string,
    id: string,
    status: string,
    updates?: { paidOn?: Date; paymentRefMasked?: string; paymentRefCiphertext?: string; failureReason?: string },
  ): Promise<PayoutRequestRow | null> {
    const res = await sql<PayoutRequestRow>`
      UPDATE payout_request
      SET
        status = ${status},
        paid_on = COALESCE(${updates?.paidOn ?? null}, paid_on),
        payment_ref_masked = COALESCE(${updates?.paymentRefMasked ?? null}, payment_ref_masked),
        payment_ref_ciphertext = COALESCE(${updates?.paymentRefCiphertext ?? null}, payment_ref_ciphertext),
        failure_reason = COALESCE(${updates?.failureReason ?? null}, failure_reason),
        updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${id}
      RETURNING *
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async emitOutboxEvent(
    tx: Tx,
    event: {
      id: string;
      tenantId: string;
      eventType: string;
      subjectType: string;
      subjectId: string;
      payload: Record<string, unknown>;
      correlationId?: string;
    },
  ): Promise<void> {
    await sql`
      INSERT INTO outbox_event (
        id, tenant_id, event_type, event_version, subject_type, subject_id,
        payload, correlation_id, chain_depth, created_at
      ) VALUES (
        ${event.id}, ${event.tenantId}, ${event.eventType}, 1, ${event.subjectType}, ${event.subjectId},
        ${JSON.stringify(event.payload)}::jsonb, ${event.correlationId ?? 'system'}, 0, now()
      )
    `.execute(tx);
  }

  async insertPayoutBatch(tx: Tx, row: PayoutBatchRow): Promise<void> {
    await sql`
      INSERT INTO payout_batch (
        id, tenant_id, payout_ids, file_object_key, file_sha256, status, generated_by, generated_at
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.payout_ids}, ${row.file_object_key},
        ${row.file_sha256}, ${row.status}, ${row.generated_by}, ${row.generated_at}
      )
    `.execute(tx);
  }

  async findPayoutBatchById(tx: Tx, tenantId: string, id: string): Promise<PayoutBatchRow | null> {
    const res = await sql<PayoutBatchRow>`
      SELECT * FROM payout_batch WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async listPayoutBatches(tx: Tx, tenantId: string): Promise<PayoutBatchRow[]> {
    const res = await sql<PayoutBatchRow>`
      SELECT * FROM payout_batch WHERE tenant_id = ${tenantId} ORDER BY generated_at DESC
    `.execute(tx);
    return res.rows;
  }

  async updatePayoutBatchStatus(tx: Tx, tenantId: string, id: string, status: string): Promise<PayoutBatchRow | null> {
    const res = await sql<PayoutBatchRow>`
      UPDATE payout_batch
      SET status = ${status}
      WHERE tenant_id = ${tenantId} AND id = ${id}
      RETURNING *
    `.execute(tx);
    return res.rows[0] ?? null;
  }


  async updateCommissionCalculationStatus(
    tx: Tx,
    tenantId: string,
    id: string,
    status: string,
  ): Promise<CommissionCalculationRow | null> {
    const res = await sql<CommissionCalculationRow>`
      UPDATE commission_calculation
      SET status = ${status}, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${id}
      RETURNING *
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async rejectAdjustment(
    tx: Tx,
    tenantId: string,
    id: string,
    rejecterId: string,
  ): Promise<AdjustmentRow | null> {
    const res = await sql<AdjustmentRow>`
      UPDATE adjustment
      SET status = 'REJECTED', approved_by = ${rejecterId}, approved_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${id} AND status = 'PENDING'
      RETURNING *
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async findActivePayoutLineForPayable(
    tx: Tx,
    tenantId: string,
    payableId: string,
  ): Promise<PayoutLineRow | null> {
    const res = await sql<PayoutLineRow>`
      SELECT * FROM payout_line
      WHERE tenant_id = ${tenantId} AND payable_id = ${payableId}
        AND status NOT IN ('REMOVED', 'PAYMENT_FAILED')
      LIMIT 1
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async insertRecalculationProposal(tx: Tx, row: RecalculationProposalRow): Promise<void> {
    await sql`
      INSERT INTO recalculation_proposal (
        id, tenant_id, reason, affected_calculation_ids, preview, status,
        approved_by, approved_at, lock_version, created_at, created_by, updated_at, updated_by
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.reason}, ${row.affected_calculation_ids},
        ${JSON.stringify(row.preview)}::jsonb, ${row.status}, ${row.approved_by},
        ${row.approved_at}, ${row.lock_version}, ${row.created_at}, ${row.created_by},
        ${row.updated_at}, ${row.updated_by}
      )
    `.execute(tx);
  }

  async findRecalculationProposalById(
    tx: Tx,
    tenantId: string,
    id: string,
  ): Promise<RecalculationProposalRow | null> {
    const res = await sql<RecalculationProposalRow>`
      SELECT * FROM recalculation_proposal WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async listRecalculationProposals(tx: Tx, tenantId: string): Promise<RecalculationProposalRow[]> {
    const res = await sql<RecalculationProposalRow>`
      SELECT * FROM recalculation_proposal WHERE tenant_id = ${tenantId} ORDER BY created_at DESC
    `.execute(tx);
    return res.rows;
  }

  async approveRecalculationProposal(
    tx: Tx,
    tenantId: string,
    id: string,
    approverId: string,
  ): Promise<RecalculationProposalRow | null> {
    const res = await sql<RecalculationProposalRow>`
      UPDATE recalculation_proposal
      SET status = 'APPROVED', approved_by = ${approverId}, approved_at = now(),
          lock_version = lock_version + 1, updated_at = now(), updated_by = ${approverId}
      WHERE tenant_id = ${tenantId} AND id = ${id} AND status = 'PENDING'
      RETURNING *
    `.execute(tx);
    return res.rows[0] ?? null;
  }
}
