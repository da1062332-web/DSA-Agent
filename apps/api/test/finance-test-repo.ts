// apps/api/test/finance-test-repo.ts — owner: Devyani
// The in-memory FinanceRepository shared by the finance test suites. Extracted from finance.spec.ts in P2-01 so
// commission-slabs.spec.ts can use the same fake; importing it from a .spec file would register that file's tests twice.
import type { Tx } from '@dsa/contracts';
import type {
  AdjustmentRow,
  CommissionCalculationRow,
  CommissionPayableRow,
  CommissionPlanRow,
  CommissionPlanSlabRow,
  FinanceRepository,
  PayoutApprovalRow,
  PayoutBatchRow,
  PayoutLineRow,
  PayoutRequestRow,
  RecalculationProposalRow,
} from '../src/modules/finance/repository';

export class InMemoryFinanceRepository implements FinanceRepository {
  plans: CommissionPlanRow[] = [];
  calculations: CommissionCalculationRow[] = [];
  slabs: CommissionPlanSlabRow[] = [];
  payables: CommissionPayableRow[] = [];
  adjustments: AdjustmentRow[] = [];
  payouts: PayoutRequestRow[] = [];
  payoutLines: PayoutLineRow[] = [];
  payoutApprovals: PayoutApprovalRow[] = [];
  batches: PayoutBatchRow[] = [];
  outboxEvents: any[] = [];

  async insertCommissionPlan(_tx: Tx, row: CommissionPlanRow): Promise<void> {
    this.plans.push(row);
  }

  async findCommissionPlanById(_tx: Tx, tenantId: string, id: string): Promise<CommissionPlanRow | null> {
    return this.plans.find((p) => p.tenant_id === tenantId && p.id === id) ?? null;
  }

  async findActiveCommissionPlan(
    _tx: Tx,
    tenantId: string,
    lenderId: string,
  ): Promise<CommissionPlanRow | null> {
    return (
      this.plans.find((p) => p.tenant_id === tenantId && p.lender_id === lenderId && p.status === 'ACTIVE') ??
      null
    );
  }

  async listCommissionPlans(_tx: Tx, tenantId: string, lenderId?: string): Promise<CommissionPlanRow[]> {
    let list = this.plans.filter((p) => p.tenant_id === tenantId);
    if (lenderId) list = list.filter((p) => p.lender_id === lenderId);
    return list;
  }

  async updateCommissionPlan(
    _tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<CommissionPlanRow>,
  ): Promise<CommissionPlanRow | null> {
    const idx = this.plans.findIndex((p) => p.tenant_id === tenantId && p.id === id);
    if (idx === -1) return null;
    const p = this.plans[idx]!;
    if (p.lock_version !== expectedLockVersion) return null;
    const updated: CommissionPlanRow = {
      ...p,
      ...updates,
      id: p.id,
      tenant_id: p.tenant_id,
      lender_id: p.lender_id,
      qualifying_event: updates.qualifying_event ?? p.qualifying_event,
      basis: updates.basis ?? p.basis,
      rounding_mode: updates.rounding_mode ?? p.rounding_mode,
      clawback_window_days: updates.clawback_window_days ?? p.clawback_window_days,
      status: updates.status ?? p.status,
      lock_version: p.lock_version + 1,
      updated_by: updates.updated_by ?? p.updated_by,
      updated_at: new Date(),
    };
    this.plans[idx] = updated;
    return updated;
  }

  async retireCommissionPlan(
    _tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    actorId: string,
  ): Promise<CommissionPlanRow | null> {
    const p = this.plans.find((x) => x.tenant_id === tenantId && x.id === id);
    if (!p || p.lock_version !== expectedLockVersion || p.status !== 'ACTIVE') return null;
    p.status = 'RETIRED';
    p.lock_version += 1;
    p.updated_by = actorId;
    return { ...p };
  }

  async approveCommissionPlan(
    _tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    approverId: string,
  ): Promise<CommissionPlanRow | null> {
    const idx = this.plans.findIndex((p) => p.tenant_id === tenantId && p.id === id);
    if (idx === -1) return null;
    const p = this.plans[idx]!;
    if (p.lock_version !== expectedLockVersion) return null;
    const updated: CommissionPlanRow = {
      ...p,
      status: 'ACTIVE',
      lock_version: p.lock_version + 1,
      updated_by: approverId,
      updated_at: new Date(),
    };
    this.plans[idx] = updated;
    return updated;
  }

  // --- P2-01 slabs ---

  async insertCommissionPlanSlab(_tx: Tx, row: CommissionPlanSlabRow): Promise<void> {
    this.slabs.push(row);
  }

  async findCommissionPlanSlabById(
    _tx: Tx,
    tenantId: string,
    id: string,
  ): Promise<CommissionPlanSlabRow | null> {
    return this.slabs.find((sl) => sl.tenant_id === tenantId && sl.id === id) ?? null;
  }

  async listCommissionPlanSlabs(
    _tx: Tx,
    tenantId: string,
    planId: string,
  ): Promise<CommissionPlanSlabRow[]> {
    return this.slabs.filter((sl) => sl.tenant_id === tenantId && sl.plan_id === planId);
  }

  async updateCommissionPlanSlab(
    _tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<CommissionPlanSlabRow>,
  ): Promise<CommissionPlanSlabRow | null> {
    const idx = this.slabs.findIndex((sl) => sl.tenant_id === tenantId && sl.id === id);
    if (idx === -1) return null;
    const current = this.slabs[idx]!;
    if (current.lock_version !== expectedLockVersion) return null;
    const next: CommissionPlanSlabRow = {
      ...current,
      ...updates,
      id: current.id,
      tenant_id: current.tenant_id,
      plan_id: current.plan_id,
      lock_version: current.lock_version + 1,
      updated_at: new Date(),
    };
    this.slabs[idx] = next;
    return next;
  }

  async findSlabsForLookup(
    _tx: Tx,
    tenantId: string,
    planId: string,
    productCategory: string,
    onDate: Date,
  ): Promise<CommissionPlanSlabRow[]> {
    return this.slabs
      .filter(
        (sl) =>
          sl.tenant_id === tenantId &&
          sl.plan_id === planId &&
          sl.product_category === productCategory &&
          sl.effective_from <= onDate &&
          (sl.effective_to === null || sl.effective_to >= onDate),
      )
      .sort((a, b) => Number(a.volume_from) - Number(b.volume_from));
  }

  async sumEarnedBasisForLenderMonth(
    _tx: Tx,
    tenantId: string,
    lenderId: string,
    productCategory: string,
    monthStart: Date,
    monthEndExclusive: Date,
  ): Promise<string> {
    const total = this.calculations
      .filter(
        (c) =>
          c.tenant_id === tenantId &&
          c.lender_id === lenderId &&
          c.product_category === productCategory &&
          c.calc_kind === 'EARNED' &&
          c.status !== 'REVERSED' &&
          c.status !== 'SUPERSEDED' &&
          c.event_date >= monthStart &&
          c.event_date < monthEndExclusive,
      )
      .reduce((sum, c) => sum + Math.round(Number(c.basis_amount) * 100), 0);
    return (total / 100).toFixed(2);
  }

  async insertCommissionCalculation(_tx: Tx, row: CommissionCalculationRow): Promise<void> {
    this.calculations.push(row);
  }

  async findCommissionCalculationById(
    _tx: Tx,
    tenantId: string,
    id: string,
  ): Promise<CommissionCalculationRow | null> {
    return this.calculations.find((c) => c.tenant_id === tenantId && c.id === id) ?? null;
  }

  async findEarnedCalculationByTranche(
    _tx: Tx,
    tenantId: string,
    trancheId: string,
  ): Promise<CommissionCalculationRow | null> {
    return (
      this.calculations.find(
        (c) => c.tenant_id === tenantId && c.tranche_id === trancheId && c.calc_kind === 'EARNED',
      ) ?? null
    );
  }

  async listCommissionCalculations(
    _tx: Tx,
    tenantId: string,
    filters: { lenderId?: string; status?: string; cursor?: string; limit: number },
  ): Promise<{ rows: CommissionCalculationRow[]; nextCursor: string | null }> {
    let list = this.calculations.filter((c) => c.tenant_id === tenantId);
    if (filters.lenderId) list = list.filter((c) => c.lender_id === filters.lenderId);
    if (filters.status) list = list.filter((c) => c.status === filters.status);
    return { rows: list.slice(0, filters.limit), nextCursor: null };
  }

  async insertCommissionPayable(_tx: Tx, row: CommissionPayableRow): Promise<void> {
    this.payables.push(row);
  }

  async findCommissionPayableById(
    _tx: Tx,
    tenantId: string,
    id: string,
  ): Promise<CommissionPayableRow | null> {
    return this.payables.find((p) => p.tenant_id === tenantId && p.id === id) ?? null;
  }

  async listCommissionPayables(
    _tx: Tx,
    tenantId: string,
    filters: { connectorId?: string; state?: string; cursor?: string; limit: number },
  ): Promise<{ rows: CommissionPayableRow[]; nextCursor: string | null }> {
    let list = this.payables.filter((p) => p.tenant_id === tenantId);
    if (filters.connectorId) list = list.filter((p) => p.connector_id === filters.connectorId);
    if (filters.state) list = list.filter((p) => p.state === filters.state);
    return { rows: list.slice(0, filters.limit), nextCursor: null };
  }

  async updateCommissionPayableState(
    _tx: Tx,
    tenantId: string,
    id: string,
    state: string,
  ): Promise<CommissionPayableRow | null> {
    const p = this.payables.find((x) => x.tenant_id === tenantId && x.id === id);
    if (!p) return null;
    p.state = state;
    return p;
  }

  async insertAdjustment(_tx: Tx, row: AdjustmentRow): Promise<void> {
    this.adjustments.push(row);
  }

  async findAdjustmentById(_tx: Tx, tenantId: string, id: string): Promise<AdjustmentRow | null> {
    return this.adjustments.find((a) => a.tenant_id === tenantId && a.id === id) ?? null;
  }

  async listAdjustments(_tx: Tx, tenantId: string): Promise<AdjustmentRow[]> {
    return this.adjustments.filter((a) => a.tenant_id === tenantId);
  }

  async approveAdjustment(
    _tx: Tx,
    tenantId: string,
    id: string,
    approverId: string,
  ): Promise<AdjustmentRow | null> {
    const a = this.adjustments.find((x) => x.tenant_id === tenantId && x.id === id);
    if (!a) return null;
    a.status = 'APPROVED';
    a.approved_at = new Date();
    a.approved_by = approverId;
    return a;
  }

  async insertPayoutRequest(_tx: Tx, row: PayoutRequestRow): Promise<void> {
    this.payouts.push(row);
  }

  async findPayoutRequestById(_tx: Tx, tenantId: string, id: string): Promise<PayoutRequestRow | null> {
    return this.payouts.find((p) => p.tenant_id === tenantId && p.id === id) ?? null;
  }

  async listPayoutRequests(
    _tx: Tx,
    tenantId: string,
    filters: { connectorId?: string; status?: string; cursor?: string; limit: number },
  ): Promise<{ rows: PayoutRequestRow[]; nextCursor: string | null }> {
    let list = this.payouts.filter((p) => p.tenant_id === tenantId);
    if (filters.connectorId) list = list.filter((p) => p.connector_id === filters.connectorId);
    if (filters.status) list = list.filter((p) => p.status === filters.status);
    return { rows: list.slice(0, filters.limit), nextCursor: null };
  }

  async insertPayoutLine(_tx: Tx, row: PayoutLineRow): Promise<void> {
    const existing = this.payoutLines.find(
      (l) =>
        l.tenant_id === row.tenant_id &&
        l.payable_id === row.payable_id &&
        l.status !== 'REMOVED' &&
        l.status !== 'PAYMENT_FAILED',
    );
    if (existing) {
      const err: any = new Error('duplicate key value violates unique constraint "uq_payout_line_once"');
      err.code = '23505';
      throw err;
    }
    this.payoutLines.push(row);
  }

  async listPayoutLines(_tx: Tx, tenantId: string, payoutId: string): Promise<PayoutLineRow[]> {
    return this.payoutLines.filter((l) => l.tenant_id === tenantId && l.payout_id === payoutId);
  }

  async updatePayoutLineStatus(
    _tx: Tx,
    tenantId: string,
    id: string,
    status: string,
  ): Promise<PayoutLineRow | null> {
    const l = this.payoutLines.find((x) => x.tenant_id === tenantId && x.id === id);
    if (!l) return null;
    l.status = status;
    return l;
  }

  async lockCommissionPayablesAscending(
    _tx: Tx,
    tenantId: string,
    ids: string[],
  ): Promise<CommissionPayableRow[]> {
    const sorted = [...ids].sort();
    const rows: CommissionPayableRow[] = [];
    for (const id of sorted) {
      const p = this.payables.find((x) => x.tenant_id === tenantId && x.id === id);
      if (p) rows.push(p);
    }
    return rows;
  }

  async insertPayoutApproval(_tx: Tx, row: PayoutApprovalRow): Promise<void> {
    this.payoutApprovals.push(row);
  }

  async updatePayoutStatus(
    _tx: Tx,
    tenantId: string,
    id: string,
    status: string,
    updates?: {
      paidOn?: Date;
      paymentRefMasked?: string;
      paymentRefCiphertext?: string;
      failureReason?: string;
    },
  ): Promise<PayoutRequestRow | null> {
    const p = this.payouts.find((x) => x.tenant_id === tenantId && x.id === id);
    if (!p) return null;
    p.status = status;
    if (updates?.paidOn) p.paid_on = updates.paidOn;
    if (updates?.paymentRefMasked) p.payment_ref_masked = updates.paymentRefMasked;
    if (updates?.paymentRefCiphertext) p.payment_ref_ciphertext = updates.paymentRefCiphertext;
    if (updates?.failureReason) p.failure_reason = updates.failureReason;
    return p;
  }

  async emitOutboxEvent(
    _tx: Tx,
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
    this.outboxEvents.push(event);
  }

  async updateCommissionCalculationStatus(
    _tx: Tx,
    tenantId: string,
    id: string,
    status: string,
  ): Promise<CommissionCalculationRow | null> {
    const c = this.calculations.find((x) => x.tenant_id === tenantId && x.id === id);
    if (!c) return null;
    c.status = status;
    return c;
  }

  async rejectAdjustment(
    _tx: Tx,
    tenantId: string,
    id: string,
    rejecterId: string,
  ): Promise<AdjustmentRow | null> {
    const a = this.adjustments.find((x) => x.tenant_id === tenantId && x.id === id);
    if (!a) return null;
    a.status = 'REJECTED';
    a.approved_at = new Date();
    a.approved_by = rejecterId;
    return a;
  }

  async findActivePayoutLineForPayable(
    _tx: Tx,
    tenantId: string,
    payableId: string,
  ): Promise<PayoutLineRow | null> {
    return (
      this.payoutLines.find(
        (l) =>
          l.tenant_id === tenantId &&
          l.payable_id === payableId &&
          l.status !== 'REMOVED' &&
          l.status !== 'PAYMENT_FAILED',
      ) ?? null
    );
  }

  recalculationProposals: RecalculationProposalRow[] = [];

  async insertRecalculationProposal(_tx: Tx, row: RecalculationProposalRow): Promise<void> {
    this.recalculationProposals.push(row);
  }

  async findRecalculationProposalById(
    _tx: Tx,
    tenantId: string,
    id: string,
  ): Promise<RecalculationProposalRow | null> {
    return this.recalculationProposals.find((p) => p.tenant_id === tenantId && p.id === id) ?? null;
  }

  async updateRecalculationProposal(
    _tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<RecalculationProposalRow>,
  ): Promise<RecalculationProposalRow | null> {
    const p = this.recalculationProposals.find((x) => x.tenant_id === tenantId && x.id === id);
    if (!p) return null;
    if (p.lock_version !== expectedLockVersion) return null;
    Object.assign(p, updates);
    p.lock_version += 1;
    return p;
  }

  async listRecalculationProposals(_tx: Tx, tenantId: string): Promise<RecalculationProposalRow[]> {
    return this.recalculationProposals.filter((p) => p.tenant_id === tenantId);
  }

  async approveRecalculationProposal(
    _tx: Tx,
    tenantId: string,
    id: string,
    approverId: string,
  ): Promise<RecalculationProposalRow | null> {
    const p = this.recalculationProposals.find((x) => x.tenant_id === tenantId && x.id === id);
    if (!p) return null;
    p.status = 'APPROVED';
    p.approved_at = new Date();
    p.approved_by = approverId;
    return p;
  }

  async insertPayoutBatch(_tx: Tx, row: PayoutBatchRow): Promise<void> {
    this.batches.push(row);
  }

  async findPayoutBatchById(_tx: Tx, tenantId: string, id: string): Promise<PayoutBatchRow | null> {
    return this.batches.find((b) => b.tenant_id === tenantId && b.id === id) ?? null;
  }

  async listPayoutBatches(_tx: Tx, tenantId: string): Promise<PayoutBatchRow[]> {
    return this.batches.filter((b) => b.tenant_id === tenantId);
  }
}
