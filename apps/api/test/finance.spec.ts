// apps/api/test/finance.spec.ts — owner: Developer 5 (Bhushan)
// Test coverage for Module 30: Commission and Payouts (MOD-COM / MOD-PAY)
import type { PermissionCode, RequestContext, Tx, TxRunner } from '@dsa/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FinanceService } from '../src/modules/finance/finance-service';
import type {
  AdjustmentRow,
  CommissionCalculationRow,
  CommissionPayableRow,
  CommissionPlanRow,
  FinanceRepository,
  PayoutApprovalRow,
  PayoutBatchRow,
  PayoutLineRow,
  PayoutRequestRow,
  RecalculationProposalRow,
} from '../src/modules/finance/repository';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const fakeTxRunner: TxRunner = {
  withTenantTx: async (_ctx, fn) => fn({} as any),
};

const appWith = (...grants: PermissionCode[]) =>
  createTestApp({
    auth: fakeAuth(
      testPrincipal({
        grants: grants.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })),
      }),
    ),
    deps: { txRunner: fakeTxRunner },
  });

class InMemoryFinanceRepository implements FinanceRepository {
  plans: CommissionPlanRow[] = [];
  calculations: CommissionCalculationRow[] = [];
  payables: CommissionPayableRow[] = [];
  adjustments: AdjustmentRow[] = [];
  payouts: PayoutRequestRow[] = [];
  payoutLines: PayoutLineRow[] = [];
  payoutApprovals: PayoutApprovalRow[] = [];
  batches: PayoutBatchRow[] = [];

  async insertCommissionPlan(_tx: Tx, row: CommissionPlanRow): Promise<void> {
    this.plans.push(row);
  }

  async findCommissionPlanById(_tx: Tx, tenantId: string, id: string): Promise<CommissionPlanRow | null> {
    return this.plans.find((p) => p.tenant_id === tenantId && p.id === id) ?? null;
  }

  async findActiveCommissionPlan(_tx: Tx, tenantId: string, lenderId: string): Promise<CommissionPlanRow | null> {
    return this.plans.find((p) => p.tenant_id === tenantId && p.lender_id === lenderId && p.status === 'ACTIVE') ?? null;
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

  async insertCommissionCalculation(_tx: Tx, row: CommissionCalculationRow): Promise<void> {
    this.calculations.push(row);
  }

  async findCommissionCalculationById(_tx: Tx, tenantId: string, id: string): Promise<CommissionCalculationRow | null> {
    return this.calculations.find((c) => c.tenant_id === tenantId && c.id === id) ?? null;
  }

  async findEarnedCalculationByTranche(_tx: Tx, tenantId: string, trancheId: string): Promise<CommissionCalculationRow | null> {
    return this.calculations.find((c) => c.tenant_id === tenantId && c.tranche_id === trancheId && c.calc_kind === 'EARNED') ?? null;
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

  async findCommissionPayableById(_tx: Tx, tenantId: string, id: string): Promise<CommissionPayableRow | null> {
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

  async approveAdjustment(_tx: Tx, tenantId: string, id: string, approverId: string): Promise<AdjustmentRow | null> {
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
      (l) => l.tenant_id === row.tenant_id && l.payable_id === row.payable_id && l.status !== 'REMOVED' && l.status !== 'PAYMENT_FAILED',
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

  async insertPayoutApproval(_tx: Tx, row: PayoutApprovalRow): Promise<void> {
    this.payoutApprovals.push(row);
  }

  async updatePayoutStatus(
    _tx: Tx,
    tenantId: string,
    id: string,
    status: string,
    updates?: { paidOn?: Date; paymentRefMasked?: string; failureReason?: string },
  ): Promise<PayoutRequestRow | null> {
    const p = this.payouts.find((x) => x.tenant_id === tenantId && x.id === id);
    if (!p) return null;
    p.status = status;
    if (updates?.paidOn) p.paid_on = updates.paidOn;
    if (updates?.paymentRefMasked) p.payment_ref_masked = updates.paymentRefMasked;
    if (updates?.failureReason) p.failure_reason = updates.failureReason;
    return p;
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

  async rejectAdjustment(_tx: Tx, tenantId: string, id: string, rejecterId: string): Promise<AdjustmentRow | null> {
    const a = this.adjustments.find((x) => x.tenant_id === tenantId && x.id === id);
    if (!a) return null;
    a.status = 'REJECTED';
    a.approved_at = new Date();
    a.approved_by = rejecterId;
    return a;
  }

  async findActivePayoutLineForPayable(_tx: Tx, tenantId: string, payableId: string): Promise<PayoutLineRow | null> {
    return (
      this.payoutLines.find(
        (l) => l.tenant_id === tenantId && l.payable_id === payableId && l.status !== 'REMOVED' && l.status !== 'PAYMENT_FAILED',
      ) ?? null
    );
  }

  recalculationProposals: RecalculationProposalRow[] = [];

  async insertRecalculationProposal(_tx: Tx, row: RecalculationProposalRow): Promise<void> {
    this.recalculationProposals.push(row);
  }

  async findRecalculationProposalById(_tx: Tx, tenantId: string, id: string): Promise<RecalculationProposalRow | null> {
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

describe('Module 30 Part A: Commission (MOD-COM)', () => {
  it('TC-COM-001 POST /v1/commission-plans enforces permission commission.plan.edit', async () => {
    const app = appWith('lead.read');
    const res = await request(app)
      .post('/v1/commission-plans')
      .send({
        lenderId: 'lnd_01J00000000000000000000000',
        qualifyingEvent: 'DISBURSEMENT',
        basis: 'DISBURSED_AMOUNT',
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('TC-COM-002 PATCH /v1/commission-plans/:id requires If-Match header', async () => {
    const app = appWith('commission.plan.edit');
    const res = await request(app)
      .patch('/v1/commission-plans/cpl_01J00000000000000000000000')
      .send({
        basis: 'NET_LOAN',
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('If-Match');
  });

  it('TC-COM-003 POST /v1/commission-plans/:id/approval requires commission.plan.approve', async () => {
    const app = appWith('commission.plan.edit');
    const res = await request(app)
      .post('/v1/commission-plans/cpl_01J00000000000000000000000/approval')
      .set('If-Match', '"0"')
      .send({
        comment: 'Approved for Q4',
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('TC-COM-004 POST /v1/clawbacks requires adjustment.create permission', async () => {
    const app = appWith('lead.read');
    const res = await request(app)
      .post('/v1/clawbacks')
      .send({
        amount: '15000.00',
        reason: 'Early foreclosure within 60 days',
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('TC-COM-005 Full Commission Workflow: plan creation, SOD-02 approval, disbursement calculation and clawback', async () => {
    const repo = new InMemoryFinanceRepository();
    const service = new FinanceService({ repository: repo });
    const editorCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_editor0000000000000000001',
        grants: [
          { code: 'commission.plan.edit', scope: 'TENANT', branchIds: [] },
          { code: 'commission.plan.approve', scope: 'TENANT', branchIds: [] },
          { code: 'finance.view', scope: 'TENANT', branchIds: [] },
          { code: 'adjustment.create', scope: 'TENANT', branchIds: [] },
          { code: 'adjustment.approve', scope: 'TENANT', branchIds: [] },
        ],
      }),
      correlationId: 'corr-com-01',
      now: new Date(),
    };
    const approverCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_approver000000000000000002',
        grants: [
          { code: 'commission.plan.approve', scope: 'TENANT', branchIds: [] },
          { code: 'adjustment.approve', scope: 'TENANT', branchIds: [] },
        ],
      }),
      correlationId: 'corr-com-02',
      now: new Date(),
    };
    const tx = {} as Tx;

    // 1. Create commission plan in DRAFT
    const plan = await service.createCommissionPlan(tx, editorCtx, {
      lenderId: 'lnd_01J00000000000000000000000',
      qualifyingEvent: 'DISBURSEMENT',
      basis: 'DISBURSED_AMOUNT',
      roundingMode: 'ROUND_HALF_UP',
      clawbackWindowDays: 90,
      defaultRate: 0.02, // 2%
      status: 'DRAFT',
    });
    expect(plan.id).toMatch(/^cpl_/);
    expect(plan.status).toBe('DRAFT');

    // 2. SOD-02 Check: Editor cannot approve their own plan!
    await expect(
      service.approveCommissionPlan(tx, editorCtx, plan.id, 0, { comment: 'Self approve' }),
    ).rejects.toThrowError(/SOD-02/);

    // 3. Different approver approves the plan
    const approvedPlan = await service.approveCommissionPlan(tx, approverCtx, plan.id, 0, {
      comment: 'Approved by Finance Head',
    });
    expect(approvedPlan.status).toBe('ACTIVE');

    // 4. Disbursement Event from Adwait triggers commission calculation
    // Disbursed Rs. 5,000,000; Lender rate 2%; Connector split 70%
    const calcResult = await service.calculateCommission(tx, editorCtx, {
      lenderId: 'lnd_01J00000000000000000000000',
      trancheId: 'tranche_01J0000000000000001',
      eventDate: '2026-10-13',
      currency: 'INR',
      basisAmount: '5000000.00',
      customRate: 0.02,
      connectorId: 'con_01J00000000000000000000000',
      connectorShareRate: 0.7,
    });
    expect(calcResult.calculation.id).toMatch(/^ccal_/);
    expect(calcResult.calculation.grossAmount).toBe('100000.00'); // 2% of 5,000,000 = 100,000
    expect(calcResult.payable?.amount).toBe('70000.00'); // 70% of 100,000 = 70,000
    expect(calcResult.payable?.state).toBe('ELIGIBLE');

    // 5. Clawback flow: Borrower defaults within 90 days
    const clawback = await service.createClawback(tx, editorCtx, {
      calculationId: calcResult.calculation.id,
      payableId: calcResult.payable?.id,
      amount: '70000.00',
      reason: 'Loan defaulted on Day 45',
      evidenceRef: 'doc_evidence_default_01',
    });
    expect(clawback.id).toMatch(/^adj_/);
    expect(clawback.status).toBe('PENDING');

    // Payable should be put ON_HOLD
    const heldPayable = await repo.findCommissionPayableById(tx, editorCtx.principal.tenantId, calcResult.payable!.id);
    expect(heldPayable?.state).toBe('ON_HOLD');

    // SOD-07 Check: Editor cannot approve their own clawback
    await expect(service.approveClawback(tx, editorCtx, clawback.id)).rejects.toThrowError(/SOD-07/);

    // Approver approves clawback
    const approvedClawback = await service.approveClawback(tx, approverCtx, clawback.id);
    expect(approvedClawback.status).toBe('APPROVED');

    // Payable should now be REVERSED
    const reversedPayable = await repo.findCommissionPayableById(tx, editorCtx.principal.tenantId, calcResult.payable!.id);
    expect(reversedPayable?.state).toBe('REVERSED');
  });

  it('TC-COM-008 Commission plan tenant isolation: Tenant B cannot access Tenant A\'s plan', async () => {
    const repo = new InMemoryFinanceRepository();
    const service = new FinanceService({ repository: repo });
    const ctxA: RequestContext = {
      principal: testPrincipal({
        tenantId: 'ten_tenantA000000000000000001',
        grants: [{ code: 'commission.plan.edit', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-cpl-iso-01',
      now: new Date(),
    };
    const ctxB: RequestContext = {
      principal: testPrincipal({
        tenantId: 'ten_tenantB000000000000000002',
        grants: [{ code: 'commission.plan.edit', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-cpl-iso-02',
      now: new Date(),
    };
    const tx = {} as Tx;

    const plan = await service.createCommissionPlan(tx, ctxA, {
      lenderId: 'lnd_01J00000000000000000000001',
      qualifyingEvent: 'DISBURSEMENT',
      basis: 'DISBURSED_AMOUNT',
    });

    // Tenant B cannot retrieve it -> 404 NOT_FOUND
    await expect(service.getCommissionPlan(tx, ctxB, plan.id)).rejects.toThrowError(/not found/i);

    // Tenant B cannot update it -> 404 VERSION_CONFLICT / NOT_FOUND
    await expect(
      service.updateCommissionPlan(tx, ctxB, plan.id, 0, { basis: 'NET_LOAN' }),
    ).rejects.toThrowError(/version conflict|not found/i);
  });

  it('TC-COM-009 Stale version handling on commission plan update and approval throws VERSION_CONFLICT', async () => {
    const repo = new InMemoryFinanceRepository();
    const service = new FinanceService({ repository: repo });
    const editorCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_editor0000000000000000001',
        grants: [{ code: 'commission.plan.edit', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-cpl-occ-01',
      now: new Date(),
    };
    const approverCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_approver000000000000000002',
        grants: [{ code: 'commission.plan.approve', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-cpl-occ-02',
      now: new Date(),
    };
    const tx = {} as Tx;

    const plan = await service.createCommissionPlan(tx, editorCtx, {
      lenderId: 'lnd_01J00000000000000000000001',
      qualifyingEvent: 'DISBURSEMENT',
      basis: 'DISBURSED_AMOUNT',
    });

    // Update with wrong lock version (e.g. 5 instead of 0) throws VERSION_CONFLICT
    await expect(
      service.updateCommissionPlan(tx, editorCtx, plan.id, 5, { basis: 'NET_LOAN' }),
    ).rejects.toThrowError(/version conflict/i);

    // Approval with wrong lock version (e.g. 5 instead of 0) throws VERSION_CONFLICT
    await expect(
      service.approveCommissionPlan(tx, approverCtx, plan.id, 5, { comment: 'Approved' }),
    ).rejects.toThrowError(/version conflict/i);
  });

  it('TC-COM-010 Commission calculation rejected if plan is in DRAFT (not ACTIVE)', async () => {
    const repo = new InMemoryFinanceRepository();
    const service = new FinanceService({ repository: repo });
    const ctx: RequestContext = {
      principal: testPrincipal({
        grants: [
          { code: 'commission.plan.edit', scope: 'TENANT', branchIds: [] },
          { code: 'finance.view', scope: 'TENANT', branchIds: [] },
        ],
      }),
      correlationId: 'corr-calc-draft-01',
      now: new Date(),
    };
    const tx = {} as Tx;

    // Create plan in DRAFT status
    await service.createCommissionPlan(tx, ctx, {
      lenderId: 'lnd_draft_01',
      qualifyingEvent: 'DISBURSEMENT',
      basis: 'DISBURSED_AMOUNT',
      status: 'DRAFT',
    });

    // Calling calculateCommission without active plan MUST throw INVALID_STATE
    await expect(
      service.calculateCommission(tx, ctx, {
        lenderId: 'lnd_draft_01',
        trancheId: 'trn_01',
        basisAmount: '1000000.00',
        currency: 'INR',
      }),
    ).rejects.toThrowError(/No active commission plan found/);
  });

  it('TC-COM-011 Financial precision and half-up rounding test without floating-point drift', async () => {
    const repo = new InMemoryFinanceRepository();
    const service = new FinanceService({ repository: repo });
    const creatorCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_maker001',
        grants: [
          { code: 'commission.plan.edit', scope: 'TENANT', branchIds: [] },
          { code: 'finance.view', scope: 'TENANT', branchIds: [] },
        ],
      }),
      correlationId: 'corr-round-01',
      now: new Date(),
    };
    const approverCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_approver002',
        grants: [{ code: 'commission.plan.approve', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-round-02',
      now: new Date(),
    };
    const tx = {} as Tx;

    const plan = await service.createCommissionPlan(tx, creatorCtx, {
      lenderId: 'lnd_round_01',
      qualifyingEvent: 'DISBURSEMENT',
      basis: 'DISBURSED_AMOUNT',
      roundingMode: 'ROUND_HALF_UP',
      defaultRate: 0.012345, // 1.2345%
    });
    await service.approveCommissionPlan(tx, approverCtx, plan.id, 0, {});

    // Disbursed Rs. 1,234,567.89, Lender Rate: 1.2345% (0.012345), Connector Share Rate: 67.89% (0.6789)
    // 1234567.89 * 0.012345 = 15240.74060195 => 15240.74 INR (1524074 paise)
    // 15240.74 * 0.6789 = 10346.938386 => 10346.94 INR (1034694 paise)
    const result = await service.calculateCommission(tx, creatorCtx, {
      lenderId: 'lnd_round_01',
      trancheId: 'trn_round_01',
      basisAmount: '1234567.89',
      customRate: 0.012345,
      currency: 'INR',
      connectorId: 'con_round_01',
      connectorShareRate: 0.6789,
    });

    expect(result.calculation.grossAmount).toBe('15240.74');
    expect(result.payable?.amount).toBe('10346.94');
  });
});

describe('Module 30 Part B: Payouts (MOD-PAY)', () => {
  it('TC-PAY-001 POST /v1/payout-requests enforces payout.request permission', async () => {
    const app = appWith('lead.read');
    const res = await request(app)
      .post('/v1/payout-requests')
      .send({
        connectorId: 'con_01J00000000000000000000000',
        payableIds: ['cpay_01J00000000000000000000000'],
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('TC-PAY-002 POST /v1/payout-requests validates payableIds array is non-empty', async () => {
    const app = appWith('payout.request');
    const res = await request(app)
      .post('/v1/payout-requests')
      .send({
        connectorId: 'con_01J00000000000000000000000',
        payableIds: [],
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('TC-PAY-003 POST /v1/payout-requests/:id/approval requires payout.approve', async () => {
    const app = appWith('payout.request');
    const res = await request(app)
      .post('/v1/payout-requests/prq_01J00000000000000000000000/approval')
      .send({
        decision: 'APPROVED',
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('TC-PAY-004 POST /v1/payout-requests/:id/payment requires payout.record_payment', async () => {
    const app = appWith('payout.approve');
    const res = await request(app)
      .post('/v1/payout-requests/prq_01J00000000000000000000000/payment')
      .send({
        paymentRef: 'UTR987654321',
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('TC-PAY-005 Full Payout Workflow: request, SOD-03 approval, payment recording, and batch generation', async () => {
    const repo = new InMemoryFinanceRepository();
    const service = new FinanceService({ repository: repo });
    const creatorCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_payout_maker000000000001',
        grants: [
          { code: 'payout.request', scope: 'TENANT', branchIds: [] },
          { code: 'payout.approve', scope: 'TENANT', branchIds: [] },
          { code: 'payout.record_payment', scope: 'TENANT', branchIds: [] },
        ],
      }),
      correlationId: 'corr-pay-01',
      now: new Date(),
    };
    const checkerCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_payout_checker0000000002',
        grants: [{ code: 'payout.approve', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-pay-02',
      now: new Date(),
    };
    const tx = {} as Tx;

    // Seed 2 eligible payables for a connector
    const payable1Id = 'cpay_01J00000000000000000000001';
    const payable2Id = 'cpay_01J00000000000000000000002';
    await repo.insertCommissionPayable(tx, {
      id: payable1Id,
      tenant_id: creatorCtx.principal.tenantId,
      calculation_id: 'ccal_01J00000000000000000000001',
      connector_id: 'con_01J00000000000000000000000',
      share_rate: '0.700000',
      amount: '25000.00',
      currency: 'INR',
      state: 'ELIGIBLE',
      hold_reasons: null,
      eligibility_decision_id: null,
      lock_version: 0,
      created_at: new Date(),
      created_by: creatorCtx.principal.id,
      updated_at: new Date(),
      updated_by: creatorCtx.principal.id,
    });
    await repo.insertCommissionPayable(tx, {
      id: payable2Id,
      tenant_id: creatorCtx.principal.tenantId,
      calculation_id: 'ccal_01J00000000000000000000002',
      connector_id: 'con_01J00000000000000000000000',
      share_rate: '0.700000',
      amount: '15000.00',
      currency: 'INR',
      state: 'ELIGIBLE',
      hold_reasons: null,
      eligibility_decision_id: null,
      lock_version: 0,
      created_at: new Date(),
      created_by: creatorCtx.principal.id,
      updated_at: new Date(),
      updated_by: creatorCtx.principal.id,
    });

    // 1. Create Payout Request
    const payoutReq = await service.createPayoutRequest(tx, creatorCtx, {
      connectorId: 'con_01J00000000000000000000000',
      origin: 'FINANCE',
      payableIds: [payable1Id as any, payable2Id as any],
    });
    expect(payoutReq.id).toMatch(/^prq_/);
    expect(payoutReq.total).toBe('40000.00'); // 25,000 + 15,000
    expect(payoutReq.status).toBe('SUBMITTED');

    // Payables should be set to IN_PAYOUT
    const p1 = await repo.findCommissionPayableById(tx, creatorCtx.principal.tenantId, payable1Id);
    expect(p1?.state).toBe('IN_PAYOUT');

    // 2. SOD-03 Check: Creator cannot approve their own payout request!
    await expect(
      service.approvePayoutRequest(tx, creatorCtx, payoutReq.id, { decision: 'APPROVED' }),
    ).rejects.toThrowError(/SOD-03/);

    // 3. Checker approves
    const approval = await service.approvePayoutRequest(tx, checkerCtx, payoutReq.id, {
      decision: 'APPROVED',
      comment: 'Verified KYC and bank details',
    });
    expect(approval.decision).toBe('APPROVED');

    // 4. Record payment (Maker records UTR reference)
    const paidPayout = await service.recordPayoutPayment(tx, creatorCtx, payoutReq.id, {
      paymentRef: 'HDFCN26101389472',
      paidOn: new Date().toISOString(),
    });
    expect(paidPayout.status).toBe('PAYMENT_RECORDED');
    expect(paidPayout.paymentRefMasked).toBe('******9472');

    // Payables should now be marked PAID
    const p1Paid = await repo.findCommissionPayableById(tx, creatorCtx.principal.tenantId, payable1Id);
    expect(p1Paid?.state).toBe('PAID');

    // 5. Generate Bank Batch
    const batch = await service.createPayoutBatch(tx, creatorCtx, {
      payoutIds: [payoutReq.id as any],
    });
    expect(batch.id).toMatch(/^pbt_/);
    expect(batch.fileSha256).toBeDefined();
    expect(batch.status).toBe('GENERATED');
  });

  it('TC-COM-006 Recalculation proposal lifecycle: creation, SOD-07 rejection on self-approval, and checker approval with supersession', async () => {
    const repo = new InMemoryFinanceRepository();
    const service = new FinanceService({ repository: repo });
    const proposerCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_proposer000000000001',
        grants: [
          { code: 'commission.plan.edit', scope: 'TENANT', branchIds: [] },
          { code: 'commission.plan.approve', scope: 'TENANT', branchIds: [] },
          { code: 'adjustment.approve', scope: 'TENANT', branchIds: [] },
          { code: 'finance.view', scope: 'TENANT', branchIds: [] },
        ],
      }),
      correlationId: 'corr-recp-01',
      now: new Date(),
    };
    const approverCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_approver000000000002',
        grants: [
          { code: 'commission.plan.approve', scope: 'TENANT', branchIds: [] },
          { code: 'adjustment.approve', scope: 'TENANT', branchIds: [] },
        ],
      }),
      correlationId: 'corr-recp-02',
      now: new Date(),
    };
    const tx = {} as Tx;

    // Seed existing calculation and payable
    const calcId = 'ccal_01J00000000000000000000010';
    const payId = 'cpay_01J00000000000000000000010';
    await repo.insertCommissionCalculation(tx, {
      id: calcId,
      tenant_id: proposerCtx.principal.tenantId,
      lender_id: 'lnd_01J00000000000000000000001',
      tranche_id: 'trn_01J00000000000000000000010',
      application_id: null,
      lender_case_id: 'case_01J00000000000000000000010',
      event_date: new Date(),
      basis_amount: '1000000.00',
      rate: '0.015000',
      rate_type: 'PERCENTAGE',
      cap: null,
      gross_amount: '15000.00',
      currency: 'INR',
      calc_kind: 'EARNED',
      rule_set_version_id: null,
      decision_record_id: null,
      inputs_hash: null,
      status: 'CALCULATED',
      supersedes_id: null,
      lock_version: 0,
      created_at: new Date(),
      created_by: proposerCtx.principal.id,
      updated_at: new Date(),
      updated_by: proposerCtx.principal.id,
    });
    await repo.insertCommissionPayable(tx, {
      id: payId,
      tenant_id: proposerCtx.principal.tenantId,
      calculation_id: calcId,
      connector_id: 'con_01J00000000000000000000010',
      share_rate: '0.700000',
      amount: '10500.00',
      currency: 'INR',
      state: 'ELIGIBLE',
      hold_reasons: null,
      eligibility_decision_id: null,
      lock_version: 0,
      created_at: new Date(),
      created_by: proposerCtx.principal.id,
      updated_at: new Date(),
      updated_by: proposerCtx.principal.id,
    });

    // 1. Create Recalculation Proposal
    const proposal = await service.createRecalculationProposal(tx, proposerCtx, {
      reason: 'Slab tier adjustment retroactive to disbursement',
      affectedCalculationIds: [calcId as any],
      preview: { proposedGrossAmount: '20000.00' },
    });
    expect(proposal.id).toMatch(/^recp_/);
    expect(proposal.status).toBe('PENDING');

    // 2. SOD-07 Enforcement: Proposer cannot approve their own proposal!
    await expect(
      service.approveRecalculationProposal(tx, proposerCtx, proposal.id, { comment: 'Self approval attempt' }),
    ).rejects.toThrowError(/SOD-07/);

    // 3. Checker approves proposal
    const approvalResult = await service.approveRecalculationProposal(tx, approverCtx, proposal.id, {
      comment: 'Approved by Finance VP',
    });
    expect(approvalResult.status).toBe('APPROVED');
    expect(approvalResult.approvedBy).toBe(approverCtx.principal.id);
    expect(approvalResult.approvedAt).toBeDefined();

    // Old calculation should be SUPERSEDED and old payable REVERSED
    const oldCalc = await repo.findCommissionCalculationById(tx, proposerCtx.principal.tenantId, calcId);
    expect(oldCalc?.status).toBe('SUPERSEDED');
    const oldPayable = await repo.findCommissionPayableById(tx, proposerCtx.principal.tenantId, payId);
    expect(oldPayable?.state).toBe('REVERSED');
  });

  it('TC-PAY-006 Payout approval blocks if any constituent payable is placed ON_HOLD', async () => {
    const repo = new InMemoryFinanceRepository();
    const service = new FinanceService({ repository: repo });
    const makerCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_maker0000000000000001',
        grants: [{ code: 'payout.request', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-hold-01',
      now: new Date(),
    };
    const checkerCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_checker00000000000002',
        grants: [{ code: 'payout.approve', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-hold-02',
      now: new Date(),
    };
    const tx = {} as Tx;

    const pId = 'cpay_01J00000000000000000000099';
    await repo.insertCommissionPayable(tx, {
      id: pId,
      tenant_id: makerCtx.principal.tenantId,
      calculation_id: 'ccal_01J00000000000000000000099',
      connector_id: 'con_01J00000000000000000000099',
      share_rate: '0.700000',
      amount: '5000.00',
      currency: 'INR',
      state: 'ELIGIBLE',
      hold_reasons: null,
      eligibility_decision_id: null,
      lock_version: 0,
      created_at: new Date(),
      created_by: makerCtx.principal.id,
      updated_at: new Date(),
      updated_by: makerCtx.principal.id,
    });

    const payout = await service.createPayoutRequest(tx, makerCtx, {
      connectorId: 'con_01J00000000000000000000099',
      origin: 'CONNECTOR',
      payableIds: [pId as any],
    });

    // An external dispute places the payable ON_HOLD before approval
    await repo.updateCommissionPayableState(tx, makerCtx.principal.tenantId, pId, 'ON_HOLD');

    // Checker tries to approve -> MUST throw 409 INVALID_STATE / PAYABLE_ON_HOLD
    await expect(
      service.approvePayoutRequest(tx, checkerCtx, payout.id, { decision: 'APPROVED' }),
    ).rejects.toThrowError(/PAYABLE_ON_HOLD/);
  });

  it('TC-PAY-007 Duplicate payout prevention: cannot include payable already in live payout (BR-DOM-025)', async () => {
    const repo = new InMemoryFinanceRepository();
    const service = new FinanceService({ repository: repo });
    const makerCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_maker0000000000000001',
        grants: [{ code: 'payout.request', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-dup-01',
      now: new Date(),
    };
    const tx = {} as Tx;

    const pId = 'cpay_01J00000000000000000000088';
    await repo.insertCommissionPayable(tx, {
      id: pId,
      tenant_id: makerCtx.principal.tenantId,
      calculation_id: 'ccal_01J00000000000000000000088',
      connector_id: 'con_01J00000000000000000000088',
      share_rate: '0.700000',
      amount: '5000.00',
      currency: 'INR',
      state: 'ELIGIBLE',
      hold_reasons: null,
      eligibility_decision_id: null,
      lock_version: 0,
      created_at: new Date(),
      created_by: makerCtx.principal.id,
      updated_at: new Date(),
      updated_by: makerCtx.principal.id,
    });

    // Create first payout
    await service.createPayoutRequest(tx, makerCtx, {
      connectorId: 'con_01J00000000000000000000088',
      origin: 'FINANCE',
      payableIds: [pId as any],
    });

    // Second payout with same payable MUST fail
    await expect(
      service.createPayoutRequest(tx, makerCtx, {
        connectorId: 'con_01J00000000000000000000088',
        origin: 'FINANCE',
        payableIds: [pId as any],
      }),
    ).rejects.toThrowError(/already included/);
  });

  it('TC-PAY-008 Payout cancellation returns payables to ELIGIBLE', async () => {
    const repo = new InMemoryFinanceRepository();
    const service = new FinanceService({ repository: repo });
    const makerCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_maker0000000000000001',
        grants: [{ code: 'payout.request', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-cancel-01',
      now: new Date(),
    };
    const tx = {} as Tx;

    const pId = 'cpay_01J00000000000000000000077';
    await repo.insertCommissionPayable(tx, {
      id: pId,
      tenant_id: makerCtx.principal.tenantId,
      calculation_id: 'ccal_01J00000000000000000000077',
      connector_id: 'con_01J00000000000000000000077',
      share_rate: '0.700000',
      amount: '5000.00',
      currency: 'INR',
      state: 'ELIGIBLE',
      hold_reasons: null,
      eligibility_decision_id: null,
      lock_version: 0,
      created_at: new Date(),
      created_by: makerCtx.principal.id,
      updated_at: new Date(),
      updated_by: makerCtx.principal.id,
    });

    const payout = await service.createPayoutRequest(tx, makerCtx, {
      connectorId: 'con_01J00000000000000000000077',
      origin: 'FINANCE',
      payableIds: [pId as any],
    });

    // Cancel payout
    const res = await service.cancelPayoutRequest(tx, makerCtx, payout.id, { reason: 'Incorrect batching' });
    expect(res.status).toBe('CANCELLED');

    // Payable should be returned to ELIGIBLE
    const payableAfter = await repo.findCommissionPayableById(tx, makerCtx.principal.tenantId, pId);
    expect(payableAfter?.state).toBe('ELIGIBLE');
  });

  it('TC-COM-007 Clawback rejection returns payable to ELIGIBLE', async () => {
    const repo = new InMemoryFinanceRepository();
    const service = new FinanceService({ repository: repo });
    const makerCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_maker0000000000000001',
        grants: [
          { code: 'adjustment.create', scope: 'TENANT', branchIds: [] },
          { code: 'adjustment.approve', scope: 'TENANT', branchIds: [] },
        ],
      }),
      correlationId: 'corr-claw-01',
      now: new Date(),
    };
    const checkerCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_checker00000000000002',
        grants: [{ code: 'adjustment.approve', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-claw-02',
      now: new Date(),
    };
    const tx = {} as Tx;

    const pId = 'cpay_01J00000000000000000000066';
    await repo.insertCommissionPayable(tx, {
      id: pId,
      tenant_id: makerCtx.principal.tenantId,
      calculation_id: 'ccal_01J00000000000000000000066',
      connector_id: 'con_01J00000000000000000000066',
      share_rate: '0.700000',
      amount: '5000.00',
      currency: 'INR',
      state: 'ELIGIBLE',
      hold_reasons: null,
      eligibility_decision_id: null,
      lock_version: 0,
      created_at: new Date(),
      created_by: makerCtx.principal.id,
      updated_at: new Date(),
      updated_by: makerCtx.principal.id,
    });

    // Create clawback
    const clawback = await service.createClawback(tx, makerCtx, {
      payableId: pId as any,
      amount: '5000.00',
      reason: 'Premature loan prepayment',
    });
    expect(clawback.status).toBe('PENDING');

    // Payable should be placed ON_HOLD
    const pOnHold = await repo.findCommissionPayableById(tx, makerCtx.principal.tenantId, pId);
    expect(pOnHold?.state).toBe('ON_HOLD');

    // Reject clawback
    const rej = await service.rejectClawback(tx, checkerCtx, clawback.id);
    expect(rej.status).toBe('REJECTED');

    // Payable should be returned to ELIGIBLE
    const pEligible = await repo.findCommissionPayableById(tx, makerCtx.principal.tenantId, pId);
    expect(pEligible?.state).toBe('ELIGIBLE');
  });

  it('TC-PAY-009 Payout request and payable tenant isolation: Tenant B cannot access Tenant A\'s payout', async () => {
    const repo = new InMemoryFinanceRepository();
    const service = new FinanceService({ repository: repo });
    const ctxA: RequestContext = {
      principal: testPrincipal({
        tenantId: 'ten_tenantA000000000000000001',
        grants: [
          { code: 'payout.request', scope: 'TENANT', branchIds: [] },
          { code: 'finance.view', scope: 'TENANT', branchIds: [] },
        ],
      }),
      correlationId: 'corr-pay-iso-01',
      now: new Date(),
    };
    const ctxB: RequestContext = {
      principal: testPrincipal({
        tenantId: 'ten_tenantB000000000000000002',
        grants: [
          { code: 'payout.request', scope: 'TENANT', branchIds: [] },
          { code: 'finance.view', scope: 'TENANT', branchIds: [] },
        ],
      }),
      correlationId: 'corr-pay-iso-02',
      now: new Date(),
    };
    const tx = {} as Tx;

    const pId = 'cpay_01J00000000000000000000055';
    await repo.insertCommissionPayable(tx, {
      id: pId,
      tenant_id: ctxA.principal.tenantId,
      calculation_id: 'ccal_01J00000000000000000000055',
      connector_id: 'con_01J00000000000000000000055',
      share_rate: '0.700000',
      amount: '5000.00',
      currency: 'INR',
      state: 'ELIGIBLE',
      hold_reasons: null,
      eligibility_decision_id: null,
      lock_version: 0,
      created_at: new Date(),
      created_by: ctxA.principal.id,
      updated_at: new Date(),
      updated_by: ctxA.principal.id,
    });

    const payout = await service.createPayoutRequest(tx, ctxA, {
      connectorId: 'con_01J00000000000000000000055',
      origin: 'FINANCE',
      payableIds: [pId as any],
    });

    // Tenant B cannot retrieve Tenant A's payout -> NOT_FOUND
    await expect(service.getPayoutRequest(tx, ctxB, payout.id)).rejects.toThrowError(/not found/i);

    // Tenant B cannot create payout using Tenant A's payable -> NOT_FOUND
    await expect(
      service.createPayoutRequest(tx, ctxB, {
        connectorId: 'con_01J00000000000000000000055',
        origin: 'FINANCE',
        payableIds: [pId as any],
      }),
    ).rejects.toThrowError(/not found/i);
  });

  it('TC-PAY-010 Invalid state transitions on payout requests and payable states', async () => {
    const repo = new InMemoryFinanceRepository();
    const service = new FinanceService({ repository: repo });
    const makerCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_maker_trans_01',
        grants: [
          { code: 'payout.request', scope: 'TENANT', branchIds: [] },
          { code: 'payout.record_payment', scope: 'TENANT', branchIds: [] },
        ],
      }),
      correlationId: 'corr-trans-01',
      now: new Date(),
    };
    const checkerCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_checker_trans_02',
        grants: [{ code: 'payout.approve', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-trans-02',
      now: new Date(),
    };
    const tx = {} as Tx;

    const pId = 'cpay_01J00000000000000000000044';
    await repo.insertCommissionPayable(tx, {
      id: pId,
      tenant_id: makerCtx.principal.tenantId,
      calculation_id: 'ccal_01J00000000000000000000044',
      connector_id: 'con_01J00000000000000000000044',
      share_rate: '0.700000',
      amount: '5000.00',
      currency: 'INR',
      state: 'ELIGIBLE',
      hold_reasons: null,
      eligibility_decision_id: null,
      lock_version: 0,
      created_at: new Date(),
      created_by: makerCtx.principal.id,
      updated_at: new Date(),
      updated_by: makerCtx.principal.id,
    });

    const payout = await service.createPayoutRequest(tx, makerCtx, {
      connectorId: 'con_01J00000000000000000000044',
      origin: 'FINANCE',
      payableIds: [pId as any],
    });

    // 1. Payment recording on SUBMITTED (unapproved) payout MUST fail with INVALID_STATE
    await expect(
      service.recordPayoutPayment(tx, makerCtx, payout.id, { paymentRef: 'UTR12345', paidOn: new Date().toISOString() }),
    ).rejects.toThrowError(/not APPROVED/);

    // Cancel the payout
    await service.cancelPayoutRequest(tx, makerCtx, payout.id, { reason: 'Cancelled by test' });

    // 2. Approving a CANCELLED payout MUST fail with INVALID_STATE
    await expect(
      service.approvePayoutRequest(tx, checkerCtx, payout.id, { decision: 'APPROVED' }),
    ).rejects.toThrowError(/Only SUBMITTED payout requests can be approved/);

    // 3. Creating payout with payable in ON_HOLD state MUST fail with INVALID_STATE
    await repo.updateCommissionPayableState(tx, makerCtx.principal.tenantId, pId, 'ON_HOLD');
    await expect(
      service.createPayoutRequest(tx, makerCtx, {
        connectorId: 'con_01J00000000000000000000044',
        origin: 'FINANCE',
        payableIds: [pId as any],
      }),
    ).rejects.toThrowError(/not in ELIGIBLE state/);
  });

  it('TC-PAY-011 Duplicate payable detection in payout request creation throws VALIDATION_ERROR', async () => {
    const repo = new InMemoryFinanceRepository();
    const service = new FinanceService({ repository: repo });
    const ctx: RequestContext = {
      principal: testPrincipal({
        grants: [{ code: 'payout.request', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-dup-in-req-01',
      now: new Date(),
    };
    const tx = {} as Tx;

    const pId = 'cpay_01J00000000000000000000033';
    await repo.insertCommissionPayable(tx, {
      id: pId,
      tenant_id: ctx.principal.tenantId,
      calculation_id: 'ccal_01J00000000000000000000033',
      connector_id: 'con_01J00000000000000000000033',
      share_rate: '0.700000',
      amount: '5000.00',
      currency: 'INR',
      state: 'ELIGIBLE',
      hold_reasons: null,
      eligibility_decision_id: null,
      lock_version: 0,
      created_at: new Date(),
      created_by: ctx.principal.id,
      updated_at: new Date(),
      updated_by: ctx.principal.id,
    });

    // Same payable specified twice in the array
    await expect(
      service.createPayoutRequest(tx, ctx, {
        connectorId: 'con_01J00000000000000000000033',
        origin: 'FINANCE',
        payableIds: [pId as any, pId as any],
      }),
    ).rejects.toThrowError(/Duplicate payable IDs provided/);
  });

  it('TC-PAY-012 Maker-Checker segregation of duties violations (SOD-02, SOD-03, SOD-07)', async () => {
    const repo = new InMemoryFinanceRepository();
    const service = new FinanceService({ repository: repo });
    const userCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_dual_role_user',
        grants: [
          { code: 'commission.plan.edit', scope: 'TENANT', branchIds: [] },
          { code: 'commission.plan.approve', scope: 'TENANT', branchIds: [] },
          { code: 'payout.request', scope: 'TENANT', branchIds: [] },
          { code: 'payout.approve', scope: 'TENANT', branchIds: [] },
          { code: 'adjustment.create', scope: 'TENANT', branchIds: [] },
          { code: 'adjustment.approve', scope: 'TENANT', branchIds: [] },
        ],
      }),
      correlationId: 'corr-sod-01',
      now: new Date(),
    };
    const tx = {} as Tx;

    // 1. SOD-02: User creates plan, tries to approve own plan -> throws SOD_VIOLATION
    const plan = await service.createCommissionPlan(tx, userCtx, {
      lenderId: 'lnd_sod_01',
      qualifyingEvent: 'DISBURSEMENT',
      basis: 'DISBURSED_AMOUNT',
    });
    await expect(
      service.approveCommissionPlan(tx, userCtx, plan.id, 0, {}),
    ).rejects.toThrowError(/SOD-02/);

    // 2. SOD-03: User creates payout request, tries to approve own payout -> throws SOD_VIOLATION
    const pId = 'cpay_01J00000000000000000000022';
    await repo.insertCommissionPayable(tx, {
      id: pId,
      tenant_id: userCtx.principal.tenantId,
      calculation_id: 'ccal_01J00000000000000000000022',
      connector_id: 'con_sod_01',
      share_rate: '0.700000',
      amount: '5000.00',
      currency: 'INR',
      state: 'ELIGIBLE',
      hold_reasons: null,
      eligibility_decision_id: null,
      lock_version: 0,
      created_at: new Date(),
      created_by: userCtx.principal.id,
      updated_at: new Date(),
      updated_by: userCtx.principal.id,
    });
    const payout = await service.createPayoutRequest(tx, userCtx, {
      connectorId: 'con_sod_01',
      origin: 'FINANCE',
      payableIds: [pId as any],
    });
    await expect(
      service.approvePayoutRequest(tx, userCtx, payout.id, { decision: 'APPROVED' }),
    ).rejects.toThrowError(/SOD-03/);

    // 3. SOD-07: User creates recalculation proposal, tries to approve own proposal -> throws SOD_VIOLATION
    const proposal = await service.createRecalculationProposal(tx, userCtx, {
      reason: 'Testing SOD',
      affectedCalculationIds: ['ccal_01J00000000000000000000022' as any],
      preview: {},
    });
    await expect(
      service.approveRecalculationProposal(tx, userCtx, proposal.id, {}),
    ).rejects.toThrowError(/SOD-07/);
  });

  it('TC-COM-012 Large amount calculations and boundary conditions (100 Crore)', async () => {
    const repo = new InMemoryFinanceRepository();
    const service = new FinanceService({ repository: repo });
    const ctx: RequestContext = {
      principal: testPrincipal({
        grants: [
          { code: 'commission.plan.edit', scope: 'TENANT', branchIds: [] },
          { code: 'commission.plan.approve', scope: 'TENANT', branchIds: [] },
          { code: 'finance.view', scope: 'TENANT', branchIds: [] },
        ],
      }),
      correlationId: 'corr-large-01',
      now: new Date(),
    };
    const tx = {} as Tx;

    const plan = await service.createCommissionPlan(tx, ctx, {
      lenderId: 'lnd_large_01',
      qualifyingEvent: 'DISBURSEMENT',
      basis: 'DISBURSED_AMOUNT',
    });
    const checkerCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_large_checker_01',
        grants: [{ code: 'commission.plan.approve', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-large-02',
      now: new Date(),
    };
    await service.approveCommissionPlan(tx, checkerCtx, plan.id, 0, {});

    // Rs. 100 Crore = 1,000,000,000.00 INR (10^11 paise)
    const result = await service.calculateCommission(tx, ctx, {
      lenderId: 'lnd_large_01',
      trancheId: 'trn_large_01',
      basisAmount: '1000000000.00',
      customRate: 0.02,
      currency: 'INR',
      connectorId: 'con_large_01',
      connectorShareRate: 0.70,
    });

    expect(result.calculation.grossAmount).toBe('20000000.00'); // 2 Crore
    expect(result.payable?.amount).toBe('14000000.00'); // 1.4 Crore
  });

  it('TC-COM-013 Duplicate commission calculation rejection on same tranche (BR-DOM-023)', async () => {
    const repo = new InMemoryFinanceRepository();
    const service = new FinanceService({ repository: repo });
    const ctx: RequestContext = {
      principal: testPrincipal({
        grants: [
          { code: 'commission.plan.edit', scope: 'TENANT', branchIds: [] },
          { code: 'commission.plan.approve', scope: 'TENANT', branchIds: [] },
          { code: 'finance.view', scope: 'TENANT', branchIds: [] },
        ],
      }),
      correlationId: 'corr-dup-tranche-01',
      now: new Date(),
    };
    const checkerCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_dup_checker_01',
        grants: [{ code: 'commission.plan.approve', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-dup-tranche-02',
      now: new Date(),
    };
    const tx = {} as Tx;

    const plan = await service.createCommissionPlan(tx, ctx, {
      lenderId: 'lnd_dup_01',
      qualifyingEvent: 'DISBURSEMENT',
      basis: 'DISBURSED_AMOUNT',
    });
    await service.approveCommissionPlan(tx, checkerCtx, plan.id, 0, {});

    // First calculation succeeds
    await service.calculateCommission(tx, ctx, {
      lenderId: 'lnd_dup_01',
      trancheId: 'trn_dup_01',
      basisAmount: '500000.00',
      currency: 'INR',
    });

    // Second calculation for identical tranche MUST reject with DUPLICATE_ENTRY
    await expect(
      service.calculateCommission(tx, ctx, {
        lenderId: 'lnd_dup_01',
        trancheId: 'trn_dup_01',
        basisAmount: '500000.00',
        currency: 'INR',
      }),
    ).rejects.toThrowError(/already exists for tranche/i);
  });

  it('TC-PAY-013 Concurrent race conditions: Promise.all parallel payout requests for same payable', async () => {
    const repo = new InMemoryFinanceRepository();
    const service = new FinanceService({ repository: repo });
    const ctx: RequestContext = {
      principal: testPrincipal({
        grants: [{ code: 'payout.request', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-race-01',
      now: new Date(),
    };
    const tx = {} as Tx;

    const pId = 'cpay_race_001';
    await repo.insertCommissionPayable(tx, {
      id: pId,
      tenant_id: ctx.principal.tenantId,
      calculation_id: 'ccal_race_001',
      connector_id: 'con_race_001',
      share_rate: '0.700000',
      amount: '10000.00',
      currency: 'INR',
      state: 'ELIGIBLE',
      hold_reasons: null,
      eligibility_decision_id: null,
      lock_version: 0,
      created_at: new Date(),
      created_by: ctx.principal.id,
      updated_at: new Date(),
      updated_by: ctx.principal.id,
    });

    // Dispatch two concurrent payout requests attempting to claim the exact same payable
    const results = await Promise.allSettled([
      service.createPayoutRequest(tx, ctx, {
        connectorId: 'con_race_001',
        origin: 'FINANCE',
        payableIds: [pId as any],
      }),
      service.createPayoutRequest(tx, ctx, {
        connectorId: 'con_race_001',
        origin: 'FINANCE',
        payableIds: [pId as any],
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one must succeed and one must be rejected
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const rejReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejReason.message).toMatch(/already included in live payout request|not in ELIGIBLE state|already included in an active payout line|uq_payout_line_once/i);
  });

  it('TC-PAY-014 Complete lifecycle state tracking: rejection path and payment failure path verify consistent states', async () => {
    const repo = new InMemoryFinanceRepository();
    const service = new FinanceService({ repository: repo });
    const makerCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_lifecycle_maker',
        grants: [
          { code: 'payout.request', scope: 'TENANT', branchIds: [] },
          { code: 'payout.record_payment', scope: 'TENANT', branchIds: [] },
        ],
      }),
      correlationId: 'corr-lc-01',
      now: new Date(),
    };
    const checkerCtx: RequestContext = {
      principal: testPrincipal({
        id: 'usr_lifecycle_checker',
        grants: [{ code: 'payout.approve', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-lc-02',
      now: new Date(),
    };
    const tx = {} as Tx;

    // --- Path A: Rejection Path ---
    const p1Id = 'cpay_lc_01';
    await repo.insertCommissionPayable(tx, {
      id: p1Id,
      tenant_id: makerCtx.principal.tenantId,
      calculation_id: 'ccal_lc_01',
      connector_id: 'con_lc_01',
      share_rate: '0.700000',
      amount: '8000.00',
      currency: 'INR',
      state: 'ELIGIBLE',
      hold_reasons: null,
      eligibility_decision_id: null,
      lock_version: 0,
      created_at: new Date(),
      created_by: makerCtx.principal.id,
      updated_at: new Date(),
      updated_by: makerCtx.principal.id,
    });

    const payoutA = await service.createPayoutRequest(tx, makerCtx, {
      connectorId: 'con_lc_01',
      origin: 'FINANCE',
      payableIds: [p1Id as any],
    });
    expect(payoutA.status).toBe('SUBMITTED');

    // Checker rejects
    const rejectedAppr = await service.approvePayoutRequest(tx, checkerCtx, payoutA.id, {
      decision: 'REJECTED',
      comment: 'Bank IFSC code mismatch',
    });
    expect(rejectedAppr.status).toBe('REJECTED');

    // Verify consistency: lines REMOVED and payable back to ELIGIBLE
    const p1After = await repo.findCommissionPayableById(tx, makerCtx.principal.tenantId, p1Id);
    expect(p1After?.state).toBe('ELIGIBLE');
    const linesA = await repo.listPayoutLines(tx, makerCtx.principal.tenantId, payoutA.id);
    expect(linesA[0]?.status).toBe('REMOVED');

    // --- Path B: Payment Failure Path ---
    const payoutB = await service.createPayoutRequest(tx, makerCtx, {
      connectorId: 'con_lc_01',
      origin: 'FINANCE',
      payableIds: [p1Id as any],
    });
    await service.approvePayoutRequest(tx, checkerCtx, payoutB.id, { decision: 'APPROVED' });

    // Payment failed at bank
    const failedPayout = await service.recordPayoutFailure(tx, makerCtx, payoutB.id, {
      failureReason: 'Beneficiary account frozen',
    });
    expect(failedPayout.status).toBe('PAYMENT_FAILED');
    expect(failedPayout.failureReason).toBe('Beneficiary account frozen');

    // Verify consistency: lines PAYMENT_FAILED and payable back to ELIGIBLE
    const p1Failed = await repo.findCommissionPayableById(tx, makerCtx.principal.tenantId, p1Id);
    expect(p1Failed?.state).toBe('ELIGIBLE');
    const linesB = await repo.listPayoutLines(tx, makerCtx.principal.tenantId, payoutB.id);
    expect(linesB[0]?.status).toBe('PAYMENT_FAILED');
  });
});
