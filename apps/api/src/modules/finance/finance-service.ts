// apps/api/src/modules/finance/finance-service.ts — owner: Developer 5 (Bhushan) (MOD-COM / MOD-PAY)
import {
  AppError,
  type AdjustmentResponse,
  type ApproveCommissionPlanInput,
  type ApproveRecalculationProposalInput,
  type AuditPort,
  type CalculateCommissionInput,
  type CancelPayoutRequestInput,
  type CommissionCalculationResponse,
  type CommissionPayableResponse,
  type CommissionPlanResponse,
  type CreateClawbackInput,
  type CreateCommissionPlanInput,
  type CreatePayoutBatchInput,
  type CreatePayoutRequestInput,
  type CreateRecalculationProposalInput,
  type PayoutApprovalInput,
  type PayoutApprovalResponse,
  type PayoutBatchResponse,
  type PayoutLineResponse,
  type PayoutRequestResponse,
  type PermissionCode,
  type RecalculationProposalResponse,
  type RecordPaymentFailureInput,
  type RecordPaymentInput,
  type RequestContext,
  type Tx,
  type UpdateCommissionPlanInput,
} from '@dsa/contracts';
import { createHash } from 'crypto';
import { ulid } from 'ulid';
import type {
  AdjustmentRow,
  CommissionCalculationRow,
  CommissionPayableRow,
  CommissionPlanRow,
  FinanceRepository,
  PayoutBatchRow,
  PayoutLineRow,
  PayoutRequestRow,
  RecalculationProposalRow,
} from './repository';

export interface FinanceServiceDeps {
  repository: FinanceRepository;
  audit?: AuditPort;
}

// Deterministic fixed-point integer math (scale: paise = 1/100 INR)
function parseMoneyToPaise(amountStr: string): bigint {
  const parts = amountStr.split('.');
  const whole = BigInt(parts[0] || '0');
  const frac = (parts[1] || '').padEnd(2, '0').slice(0, 2);
  return whole * 100n + BigInt(frac);
}

function formatPaiseToMoney(paise: bigint): string {
  const whole = paise / 100n;
  const frac = (paise % 100n).toString().padStart(2, '0');
  return `${whole}.${frac}`;
}

function computeAmountWithRate(amountPaise: bigint, rate: number): bigint {
  // Scale rate by 1,000,000 (parts per million) with half-up rounding
  const ratePPM = BigInt(Math.round(rate * 1_000_000));
  return (amountPaise * ratePPM + 500_000n) / 1_000_000n;
}

export class FinanceService {
  constructor(private readonly deps: FinanceServiceDeps) {}

  private nextId(prefix: string): string {
    return `${prefix}_${ulid()}`;
  }

  private assertPermission(ctx: RequestContext, permission: PermissionCode): void {
    const hasGrant = ctx.principal.grants.some((g) => g.code === permission);
    if (!hasGrant) {
      throw AppError.of('FORBIDDEN', `Permission '${permission}' is required.`);
    }
  }

  // --- COMMISSION PLANS ---

  async createCommissionPlan(
    tx: Tx,
    ctx: RequestContext,
    input: CreateCommissionPlanInput,
  ): Promise<CommissionPlanResponse> {
    this.assertPermission(ctx, 'commission.plan.edit');

    const tenantId = ctx.principal.tenantId;
    const id = this.nextId('cpl');
    const now = new Date();

    const row: CommissionPlanRow = {
      id,
      tenant_id: tenantId,
      lender_id: input.lenderId,
      qualifying_event: input.qualifyingEvent ?? 'DISBURSEMENT',
      basis: input.basis ?? 'DISBURSED_AMOUNT',
      rounding_mode: input.roundingMode ?? 'ROUND_HALF_UP',
      clawback_window_days: input.clawbackWindowDays ?? 90,
      rule_set_id: input.ruleSetId ?? null,
      status: input.status ?? 'DRAFT',
      lock_version: 0,
      created_at: now,
      created_by: ctx.principal.id,
      updated_at: now,
      updated_by: ctx.principal.id,
    };

    await this.deps.repository.insertCommissionPlan(tx, row);

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: 'commission_plan.created',
        entityType: 'commission_plan',
        entityId: id,
        after: { lenderId: row.lender_id, status: row.status },
      });
    }

    return this.toPlanResponse(row);
  }

  async getCommissionPlan(tx: Tx, ctx: RequestContext, id: string): Promise<CommissionPlanResponse> {
    const row = await this.deps.repository.findCommissionPlanById(tx, ctx.principal.tenantId, id);
    if (!row) {
      throw AppError.of('NOT_FOUND', `Commission plan ${id} not found.`);
    }
    return this.toPlanResponse(row);
  }

  async listCommissionPlans(tx: Tx, ctx: RequestContext, lenderId?: string): Promise<CommissionPlanResponse[]> {
    const rows = await this.deps.repository.listCommissionPlans(tx, ctx.principal.tenantId, lenderId);
    return rows.map((r) => this.toPlanResponse(r));
  }

  async updateCommissionPlan(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    ifMatchVersion: number,
    input: UpdateCommissionPlanInput,
  ): Promise<CommissionPlanResponse> {
    this.assertPermission(ctx, 'commission.plan.edit');

    const tenantId = ctx.principal.tenantId;
    const updated = await this.deps.repository.updateCommissionPlan(tx, tenantId, id, ifMatchVersion, {
      qualifying_event: input.qualifyingEvent,
      basis: input.basis,
      rounding_mode: input.roundingMode,
      clawback_window_days: input.clawbackWindowDays,
      status: input.status,
      updated_by: ctx.principal.id,
    });

    if (!updated) {
      throw AppError.of('VERSION_CONFLICT', `Commission plan version conflict for ${id}.`);
    }

    return this.toPlanResponse(updated);
  }

  async approveCommissionPlan(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    ifMatchVersion: number,
    _input: ApproveCommissionPlanInput,
  ): Promise<CommissionPlanResponse> {
    this.assertPermission(ctx, 'commission.plan.approve');

    const tenantId = ctx.principal.tenantId;
    const plan = await this.deps.repository.findCommissionPlanById(tx, tenantId, id);
    if (!plan) {
      throw AppError.of('NOT_FOUND', `Commission plan ${id} not found.`);
    }

    // SOD-02: Creator cannot approve their own plan
    if (plan.created_by === ctx.principal.id) {
      throw AppError.of('SOD_VIOLATION', 'SOD-02: Plan creator cannot approve the commission plan.');
    }

    const approved = await this.deps.repository.approveCommissionPlan(tx, tenantId, id, ifMatchVersion, ctx.principal.id);
    if (!approved) {
      throw AppError.of('VERSION_CONFLICT', `Commission plan version conflict for ${id}.`);
    }

    return this.toPlanResponse(approved);
  }

  // --- COMMISSION CALCULATION & PAYABLES (Disbursement Event Handlers) ---

  async calculateCommission(
    tx: Tx,
    ctx: RequestContext,
    input: CalculateCommissionInput,
  ): Promise<{ calculation: CommissionCalculationResponse; payable: CommissionPayableResponse | null }> {
    this.assertPermission(ctx, 'finance.view');

    const tenantId = ctx.principal.tenantId;
    const plan = await this.deps.repository.findActiveCommissionPlan(tx, tenantId, input.lenderId);
    if (!plan) {
      throw AppError.of('INVALID_STATE', `No active commission plan found for lender ${input.lenderId}.`);
    }

    const existingEarned = await this.deps.repository.findEarnedCalculationByTranche(tx, tenantId, input.trancheId);
    if (existingEarned) {
      throw AppError.of('INVALID_STATE', `Earned commission calculation already exists for tranche ${input.trancheId}.`);
    }

    const rate = input.customRate ?? 0.015;

    // Deterministic monetary arithmetic without floating-point errors
    const basisPaise = parseMoneyToPaise(input.basisAmount);
    const grossPaise = computeAmountWithRate(basisPaise, rate);
    const grossStr = formatPaiseToMoney(grossPaise);

    const calcId = this.nextId('ccal');
    const now = new Date();
    const eventDate = input.eventDate ? new Date(input.eventDate) : now;
    const currency = input.currency ?? 'INR';

    const calcRow: CommissionCalculationRow = {
      id: calcId,
      tenant_id: tenantId,
      lender_id: input.lenderId,
      tranche_id: input.trancheId,
      application_id: input.applicationId ?? null,
      lender_case_id: input.lenderCaseId ?? null,
      event_date: eventDate,
      basis_amount: input.basisAmount,
      rate: rate.toFixed(6),
      rate_type: 'PERCENTAGE',
      cap: null,
      gross_amount: grossStr,
      currency,
      calc_kind: 'EARNED',
      rule_set_version_id: plan?.rule_set_id ?? null,
      decision_record_id: null,
      inputs_hash: createHash('sha256').update(`${input.lenderId}:${input.trancheId}:${input.basisAmount}`).digest('hex'),
      status: 'EARNED',
      supersedes_id: null,
      lock_version: 0,
      created_at: now,
      created_by: ctx.principal.id,
      updated_at: now,
      updated_by: ctx.principal.id,
    };

    await this.deps.repository.insertCommissionCalculation(tx, calcRow);

    let payableRow: CommissionPayableRow | null = null;
    if (input.connectorId) {
      const shareRate = input.connectorShareRate ?? 0.7;
      const payablePaise = computeAmountWithRate(grossPaise, shareRate);
      const payableAmountStr = formatPaiseToMoney(payablePaise);
      const payableId = this.nextId('cpay');

      const newPayableRow: CommissionPayableRow = {
        id: payableId,
        tenant_id: tenantId,
        calculation_id: calcId,
        connector_id: input.connectorId,
        share_rate: shareRate.toFixed(6),
        amount: payableAmountStr,
        currency,
        state: 'ELIGIBLE',
        hold_reasons: null,
        eligibility_decision_id: null,
        lock_version: 0,
        created_at: now,
        created_by: ctx.principal.id,
        updated_at: now,
        updated_by: ctx.principal.id,
      };

      await this.deps.repository.insertCommissionPayable(tx, newPayableRow);
      payableRow = newPayableRow;
    }

    return {
      calculation: this.toCalculationResponse(calcRow),
      payable: payableRow ? this.toPayableResponse(payableRow) : null,
    };
  }

  async getCalculation(tx: Tx, ctx: RequestContext, id: string): Promise<CommissionCalculationResponse> {
    const row = await this.deps.repository.findCommissionCalculationById(tx, ctx.principal.tenantId, id);
    if (!row) {
      throw AppError.of('NOT_FOUND', `Commission calculation ${id} not found.`);
    }
    return this.toCalculationResponse(row);
  }

  async listCalculations(
    tx: Tx,
    ctx: RequestContext,
    filters: { lenderId?: string; status?: string; cursor?: string; limit: number },
  ): Promise<{ data: CommissionCalculationResponse[]; meta: { nextCursor: string | null; limit: number } }> {
    const { rows, nextCursor } = await this.deps.repository.listCommissionCalculations(
      tx,
      ctx.principal.tenantId,
      filters,
    );
    return {
      data: rows.map((r) => this.toCalculationResponse(r)),
      meta: { nextCursor, limit: filters.limit },
    };
  }

  async listPayables(
    tx: Tx,
    ctx: RequestContext,
    filters: { connectorId?: string; state?: string; cursor?: string; limit: number },
  ): Promise<{ data: CommissionPayableResponse[]; meta: { nextCursor: string | null; limit: number } }> {
    const { rows, nextCursor } = await this.deps.repository.listCommissionPayables(tx, ctx.principal.tenantId, filters);
    return {
      data: rows.map((r) => this.toPayableResponse(r)),
      meta: { nextCursor, limit: filters.limit },
    };
  }

  // --- CLAWBACKS & ADJUSTMENTS ---

  async createClawback(
    tx: Tx,
    ctx: RequestContext,
    input: CreateClawbackInput,
  ): Promise<AdjustmentResponse> {
    this.assertPermission(ctx, 'adjustment.create');

    const tenantId = ctx.principal.tenantId;
    const id = this.nextId('adj');
    const now = new Date();

    const row: AdjustmentRow = {
      id,
      tenant_id: tenantId,
      adjustment_type: 'CLAWBACK',
      calculation_id: input.calculationId ?? null,
      payable_id: input.payableId ?? null,
      amount: input.amount,
      reason: input.reason,
      evidence_ref: input.evidenceRef ?? null,
      status: 'PENDING',
      created_at: now,
      created_by: ctx.principal.id,
      approved_at: null,
      approved_by: null,
    };

    await this.deps.repository.insertAdjustment(tx, row);

    // When clawback is requested, put the associated payable ON_HOLD
    if (input.payableId) {
      await this.deps.repository.updateCommissionPayableState(tx, tenantId, input.payableId, 'ON_HOLD');
    }

    return this.toAdjustmentResponse(row);
  }

  async approveClawback(
    tx: Tx,
    ctx: RequestContext,
    id: string,
  ): Promise<AdjustmentResponse> {
    this.assertPermission(ctx, 'adjustment.approve');

    const tenantId = ctx.principal.tenantId;
    const adj = await this.deps.repository.findAdjustmentById(tx, tenantId, id);
    if (!adj) {
      throw AppError.of('NOT_FOUND', `Adjustment ${id} not found.`);
    }

    // SOD-07: Adjuster cannot approve their own clawback
    if (adj.created_by === ctx.principal.id) {
      throw AppError.of('SOD_VIOLATION', 'SOD-07: Clawback creator cannot approve the clawback.');
    }

    const approved = await this.deps.repository.approveAdjustment(tx, tenantId, id, ctx.principal.id);
    if (!approved) {
      throw AppError.of('INVALID_STATE', `Adjustment ${id} cannot be approved.`);
    }

    // When clawback is approved, reverse the payable
    if (approved.payable_id) {
      await this.deps.repository.updateCommissionPayableState(tx, tenantId, approved.payable_id, 'REVERSED');
    }

    return this.toAdjustmentResponse(approved);
  }

  async rejectClawback(
    tx: Tx,
    ctx: RequestContext,
    id: string,
  ): Promise<AdjustmentResponse> {
    this.assertPermission(ctx, 'adjustment.approve');

    const tenantId = ctx.principal.tenantId;
    const adj = await this.deps.repository.findAdjustmentById(tx, tenantId, id);
    if (!adj) {
      throw AppError.of('NOT_FOUND', `Adjustment ${id} not found.`);
    }

    // SOD-07: Adjuster cannot review their own clawback
    if (adj.created_by === ctx.principal.id) {
      throw AppError.of('SOD_VIOLATION', 'SOD-07: Clawback creator cannot review the clawback.');
    }

    const rejected = await this.deps.repository.rejectAdjustment(tx, tenantId, id, ctx.principal.id);
    if (!rejected) {
      throw AppError.of('INVALID_STATE', `Adjustment ${id} cannot be rejected.`);
    }

    // If rejected, return payable from ON_HOLD back to ELIGIBLE
    if (rejected.payable_id) {
      await this.deps.repository.updateCommissionPayableState(tx, tenantId, rejected.payable_id, 'ELIGIBLE');
    }

    return this.toAdjustmentResponse(rejected);
  }

  // --- RECALCULATION PROPOSALS ---

  async createRecalculationProposal(
    tx: Tx,
    ctx: RequestContext,
    input: CreateRecalculationProposalInput,
  ): Promise<RecalculationProposalResponse> {
    this.assertPermission(ctx, 'commission.plan.edit');

    const tenantId = ctx.principal.tenantId;
    const id = this.nextId('recp');
    const now = new Date();

    const row: RecalculationProposalRow = {
      id,
      tenant_id: tenantId,
      reason: input.reason,
      affected_calculation_ids: input.affectedCalculationIds,
      preview: input.preview,
      status: 'PENDING',
      approved_by: null,
      approved_at: null,
      lock_version: 0,
      created_at: now,
      created_by: ctx.principal.id,
      updated_at: now,
      updated_by: ctx.principal.id,
    };

    await this.deps.repository.insertRecalculationProposal(tx, row);
    return this.toRecalculationProposalResponse(row);
  }

  async approveRecalculationProposal(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    _input: ApproveRecalculationProposalInput,
  ): Promise<RecalculationProposalResponse> {
    this.assertPermission(ctx, 'adjustment.approve');

    const tenantId = ctx.principal.tenantId;
    const proposal = await this.deps.repository.findRecalculationProposalById(tx, tenantId, id);
    if (!proposal) {
      throw AppError.of('NOT_FOUND', `Recalculation proposal ${id} not found.`);
    }

    // SoD: Proposer cannot approve
    if (proposal.created_by === ctx.principal.id) {
      throw AppError.of('SOD_VIOLATION', 'SOD-07: Proposal creator cannot approve recalculation proposal.');
    }

    const approved = await this.deps.repository.approveRecalculationProposal(tx, tenantId, id, ctx.principal.id);
    if (!approved) {
      throw AppError.of('INVALID_STATE', `Recalculation proposal ${id} is not in PENDING state.`);
    }

    // Mark affected calculations as SUPERSEDED and reverse payables
    for (const calcId of approved.affected_calculation_ids) {
      await this.deps.repository.updateCommissionCalculationStatus(tx, tenantId, calcId, 'SUPERSEDED');
      const payables = await this.deps.repository.listCommissionPayables(tx, tenantId, { limit: 100 });
      for (const p of payables.rows) {
        if (p.calculation_id === calcId) {
          await this.deps.repository.updateCommissionPayableState(tx, tenantId, p.id, 'REVERSED');
        }
      }
    }

    return this.toRecalculationProposalResponse(approved);
  }

  async getRecalculationProposal(
    tx: Tx,
    ctx: RequestContext,
    id: string,
  ): Promise<RecalculationProposalResponse> {
    this.assertPermission(ctx, 'finance.view');
    const row = await this.deps.repository.findRecalculationProposalById(tx, ctx.principal.tenantId, id);
    if (!row) {
      throw AppError.of('NOT_FOUND', `Recalculation proposal ${id} not found.`);
    }
    return this.toRecalculationProposalResponse(row);
  }

  async listRecalculationProposals(
    tx: Tx,
    ctx: RequestContext,
  ): Promise<RecalculationProposalResponse[]> {
    this.assertPermission(ctx, 'finance.view');
    const rows = await this.deps.repository.listRecalculationProposals(tx, ctx.principal.tenantId);
    return rows.map((r) => this.toRecalculationProposalResponse(r));
  }

  // --- PAYOUT REQUESTS ---

  async createPayoutRequest(
    tx: Tx,
    ctx: RequestContext,
    input: CreatePayoutRequestInput,
  ): Promise<PayoutRequestResponse> {
    this.assertPermission(ctx, 'payout.request');

    const tenantId = ctx.principal.tenantId;
    const uniquePayableIds = new Set(input.payableIds);
    if (uniquePayableIds.size !== input.payableIds.length) {
      throw AppError.of('VALIDATION_ERROR', 'Duplicate payable IDs provided in payout request.');
    }
    let totalPaise = 0n;
    const linesToCreate: { payableId: string; amount: string; currency: string }[] = [];

    for (const pId of input.payableIds) {
      const payable = await this.deps.repository.findCommissionPayableById(tx, tenantId, pId);
      if (!payable) {
        throw AppError.of('NOT_FOUND', `Payable ${pId} not found.`);
      }
      // BR-DOM-025: A payable can belong to at most one live payout line
      const activeLine = await this.deps.repository.findActivePayoutLineForPayable(tx, tenantId, pId);
      if (activeLine) {
        throw AppError.of('INVALID_STATE', `Payable ${pId} is already included in live payout request ${activeLine.payout_id}.`);
      }

      if (payable.state !== 'ELIGIBLE') {
        throw AppError.of('INVALID_STATE', `Payable ${pId} is not in ELIGIBLE state (current: ${payable.state}).`);
      }
      if (payable.connector_id !== input.connectorId) {
        throw AppError.of('VALIDATION_ERROR', `Payable ${pId} belongs to connector ${payable.connector_id}, not ${input.connectorId}.`);
      }

      totalPaise += parseMoneyToPaise(payable.amount);
      linesToCreate.push({ payableId: payable.id, amount: payable.amount, currency: payable.currency });
    }

    const payoutId = this.nextId('prq');
    const now = new Date();
    const reqRow: PayoutRequestRow = {
      id: payoutId,
      tenant_id: tenantId,
      connector_id: input.connectorId,
      origin: input.origin,
      status: 'SUBMITTED',
      total: formatPaiseToMoney(totalPaise),
      currency: 'INR',
      payment_ref_ciphertext: null,
      payment_ref_masked: null,
      paid_on: null,
      failure_reason: null,
      retry_of_payout_id: null,
      submitted_by: ctx.principal.id,
      submitted_at: now,
      lock_version: 0,
      created_at: now,
      created_by: ctx.principal.id,
      updated_at: now,
      updated_by: ctx.principal.id,
    };

    await this.deps.repository.insertPayoutRequest(tx, reqRow);

    const createdLines: PayoutLineResponse[] = [];
    for (const line of linesToCreate) {
      const lineId = this.nextId('pln');
      const lineRow: PayoutLineRow = {
        id: lineId,
        tenant_id: tenantId,
        payout_id: payoutId,
        payable_id: line.payableId,
        amount: line.amount,
        currency: line.currency,
        status: 'INCLUDED',
        created_at: now,
        created_by: ctx.principal.id,
      };
      try {
        await this.deps.repository.insertPayoutLine(tx, lineRow);
      } catch (err: any) {
        if (err?.code === '23505' || err?.message?.includes('uq_payout_line_once')) {
          throw AppError.of('INVALID_STATE', `Payable ${line.payableId} is already included in an active payout line.`);
        }
        throw err;
      }
      await this.deps.repository.updateCommissionPayableState(tx, tenantId, line.payableId, 'IN_PAYOUT');
      createdLines.push({
        id: lineRow.id as any,
        payoutId: payoutId as any,
        payableId: lineRow.payable_id as any,
        amount: lineRow.amount,
        currency: lineRow.currency,
        status: lineRow.status,
        createdAt: lineRow.created_at.toISOString(),
      });
    }

    const response = this.toPayoutResponse(reqRow);
    response.lines = createdLines;
    return response;
  }

  async getPayoutRequest(tx: Tx, ctx: RequestContext, id: string): Promise<PayoutRequestResponse> {
    const tenantId = ctx.principal.tenantId;
    const row = await this.deps.repository.findPayoutRequestById(tx, tenantId, id);
    if (!row) {
      throw AppError.of('NOT_FOUND', `Payout request ${id} not found.`);
    }
    const lines = await this.deps.repository.listPayoutLines(tx, tenantId, id);
    const resp = this.toPayoutResponse(row);
    resp.lines = lines.map((l) => ({
      id: l.id as any,
      payoutId: l.payout_id as any,
      payableId: l.payable_id as any,
      amount: l.amount,
      currency: l.currency,
      status: l.status,
      createdAt: l.created_at.toISOString(),
    }));
    return resp;
  }

  async listPayoutRequests(
    tx: Tx,
    ctx: RequestContext,
    filters: { connectorId?: string; status?: string; cursor?: string; limit: number },
  ): Promise<{ data: PayoutRequestResponse[]; meta: { nextCursor: string | null; limit: number } }> {
    const { rows, nextCursor } = await this.deps.repository.listPayoutRequests(tx, ctx.principal.tenantId, filters);
    return {
      data: rows.map((r) => this.toPayoutResponse(r)),
      meta: { nextCursor, limit: filters.limit },
    };
  }

  async approvePayoutRequest(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    input: PayoutApprovalInput,
  ): Promise<PayoutApprovalResponse> {
    this.assertPermission(ctx, 'payout.approve');

    const tenantId = ctx.principal.tenantId;
    const payout = await this.deps.repository.findPayoutRequestById(tx, tenantId, id);
    if (!payout) {
      throw AppError.of('NOT_FOUND', `Payout request ${id} not found.`);
    }

    if (payout.status !== 'SUBMITTED') {
      throw AppError.of('INVALID_STATE', `Only SUBMITTED payout requests can be approved (current: ${payout.status}).`);
    }

    // SOD-03: Creator or submitter cannot approve the payout request
    if (payout.created_by === ctx.principal.id || payout.submitted_by === ctx.principal.id) {
      throw AppError.of('SOD_VIOLATION', 'SOD-03: Payout creator or submitter cannot approve the payout request.');
    }

    const lines = await this.deps.repository.listPayoutLines(tx, tenantId, id);

    // If any payable is ON_HOLD, reject with 409 INVALID_STATE with detail PAYABLE_ON_HOLD
    for (const line of lines) {
      const payable = await this.deps.repository.findCommissionPayableById(tx, tenantId, line.payable_id);
      if (payable && payable.state === 'ON_HOLD') {
        throw AppError.of('INVALID_STATE', '[PAYABLE_ON_HOLD] Cannot approve payout request: one or more payables are ON_HOLD', [
          { field: line.payable_id, issue: 'PAYABLE_ON_HOLD' },
        ]);
      }
    }

    const now = new Date();
    const approvalId = this.nextId('pap');
    await this.deps.repository.insertPayoutApproval(tx, {
      id: approvalId,
      tenant_id: tenantId,
      payout_id: id,
      approver_id: ctx.principal.id,
      seat: 'COMMISSION_APPROVER',
      decision: input.decision,
      comment: input.comment ?? null,
      approved_at: now,
    });

    const newStatus = input.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
    const updated = await this.deps.repository.updatePayoutStatus(tx, tenantId, id, newStatus);

    if (input.decision === 'APPROVED') {
      for (const line of lines) {
        await this.deps.repository.updateCommissionPayableState(tx, tenantId, line.payable_id, 'APPROVED');
      }
    } else {
      // If REJECTED, return payables back to ELIGIBLE and release payout lines
      for (const line of lines) {
        await this.deps.repository.updatePayoutLineStatus(tx, tenantId, line.id, 'REMOVED');
        await this.deps.repository.updateCommissionPayableState(tx, tenantId, line.payable_id, 'ELIGIBLE');
      }
    }

    return {
      id: approvalId,
      payoutId: id as any,
      approverId: ctx.principal.id,
      seat: 'COMMISSION_APPROVER',
      decision: input.decision,
      comment: input.comment ?? null,
      status: (updated?.status ?? newStatus) as any,
      total: String(updated?.total ?? payout.total),
      lineCount: lines.length,
      approvedAt: now.toISOString(),
    };
  }

  async cancelPayoutRequest(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    _input: CancelPayoutRequestInput,
  ): Promise<PayoutRequestResponse> {
    this.assertPermission(ctx, 'payout.request');

    const tenantId = ctx.principal.tenantId;
    const payout = await this.deps.repository.findPayoutRequestById(tx, tenantId, id);
    if (!payout) {
      throw AppError.of('NOT_FOUND', `Payout request ${id} not found.`);
    }
    if (payout.status !== 'DRAFT' && payout.status !== 'SUBMITTED') {
      throw AppError.of('INVALID_STATE', `Only DRAFT or SUBMITTED payouts can be cancelled (status: ${payout.status}).`);
    }

    const updated = await this.deps.repository.updatePayoutStatus(tx, tenantId, id, 'CANCELLED');
    const lines = await this.deps.repository.listPayoutLines(tx, tenantId, id);
    for (const line of lines) {
      await this.deps.repository.updatePayoutLineStatus(tx, tenantId, line.id, 'REMOVED');
      await this.deps.repository.updateCommissionPayableState(tx, tenantId, line.payable_id, 'ELIGIBLE');
    }

    return this.toPayoutResponse(updated!);
  }

  async recordPayoutPayment(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    input: RecordPaymentInput,
  ): Promise<PayoutRequestResponse> {
    this.assertPermission(ctx, 'payout.record_payment');

    const tenantId = ctx.principal.tenantId;
    const payout = await this.deps.repository.findPayoutRequestById(tx, tenantId, id);
    if (!payout) {
      throw AppError.of('NOT_FOUND', `Payout request ${id} not found.`);
    }
    if (payout.status !== 'APPROVED') {
      throw AppError.of('INVALID_STATE', `Payout ${id} is not APPROVED (status: ${payout.status}).`);
    }

    const masked = `******${input.paymentRef.slice(-4)}`;
    const paidOn = new Date(input.paidOn);

    const updated = await this.deps.repository.updatePayoutStatus(tx, tenantId, id, 'PAYMENT_RECORDED', {
      paidOn,
      paymentRefMasked: masked,
    });

    const lines = await this.deps.repository.listPayoutLines(tx, tenantId, id);
    for (const line of lines) {
      await this.deps.repository.updatePayoutLineStatus(tx, tenantId, line.id, 'PAYMENT_RECORDED');
      await this.deps.repository.updateCommissionPayableState(tx, tenantId, line.payable_id, 'PAID');
    }

    return this.toPayoutResponse(updated!);
  }

  async recordPayoutFailure(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    input: RecordPaymentFailureInput,
  ): Promise<PayoutRequestResponse> {
    this.assertPermission(ctx, 'payout.record_payment');

    const tenantId = ctx.principal.tenantId;
    const updated = await this.deps.repository.updatePayoutStatus(tx, tenantId, id, 'PAYMENT_FAILED', {
      failureReason: input.failureReason,
    });

    const lines = await this.deps.repository.listPayoutLines(tx, tenantId, id);
    for (const line of lines) {
      await this.deps.repository.updatePayoutLineStatus(tx, tenantId, line.id, 'PAYMENT_FAILED');
      await this.deps.repository.updateCommissionPayableState(tx, tenantId, line.payable_id, 'ELIGIBLE');
    }

    return this.toPayoutResponse(updated!);
  }

  // --- PAYOUT BATCHES ---

  async createPayoutBatch(
    tx: Tx,
    ctx: RequestContext,
    input: CreatePayoutBatchInput,
  ): Promise<PayoutBatchResponse> {
    this.assertPermission(ctx, 'payout.record_payment');

    const id = this.nextId('pbt');
    const now = new Date();
    const sha = createHash('sha256').update(input.payoutIds.join(',')).digest('hex');

    const row: PayoutBatchRow = {
      id,
      tenant_id: ctx.principal.tenantId,
      payout_ids: input.payoutIds,
      file_object_key: `batches/${id}.csv`,
      file_sha256: sha,
      status: 'GENERATED',
      generated_by: ctx.principal.id,
      generated_at: now,
    };

    await this.deps.repository.insertPayoutBatch(tx, row);

    return {
      id: row.id as any,
      payoutIds: row.payout_ids,
      fileObjectKey: row.file_object_key,
      fileSha256: row.file_sha256,
      status: row.status as any,
      generatedBy: row.generated_by,
      generatedAt: row.generated_at.toISOString(),
    };
  }

  async getPayoutBatch(tx: Tx, ctx: RequestContext, id: string): Promise<PayoutBatchResponse> {
    const row = await this.deps.repository.findPayoutBatchById(tx, ctx.principal.tenantId, id);
    if (!row) {
      throw AppError.of('NOT_FOUND', `Payout batch ${id} not found.`);
    }
    return {
      id: row.id as any,
      payoutIds: row.payout_ids,
      fileObjectKey: row.file_object_key,
      fileSha256: row.file_sha256,
      status: row.status as any,
      generatedBy: row.generated_by,
      generatedAt: row.generated_at.toISOString(),
    };
  }

  // --- MAPPERS ---

  private toPlanResponse(row: CommissionPlanRow): CommissionPlanResponse {
    return {
      id: row.id as any,
      lenderId: row.lender_id as any,
      qualifyingEvent: row.qualifying_event as any,
      basis: row.basis as any,
      roundingMode: row.rounding_mode,
      clawbackWindowDays: row.clawback_window_days,
      ruleSetId: row.rule_set_id,
      status: row.status as any,
      lockVersion: row.lock_version,
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by,
      updatedAt: row.updated_at.toISOString(),
      updatedBy: row.updated_by,
    };
  }

  private toCalculationResponse(row: CommissionCalculationRow): CommissionCalculationResponse {
    return {
      id: row.id as any,
      lenderId: row.lender_id as any,
      trancheId: row.tranche_id,
      applicationId: row.application_id,
      lenderCaseId: row.lender_case_id,
      eventDate: row.event_date.toISOString().slice(0, 10),
      basisAmount: String(row.basis_amount),
      rate: String(row.rate),
      rateType: row.rate_type,
      grossAmount: String(row.gross_amount),
      currency: row.currency,
      calcKind: row.calc_kind as any,
      status: row.status as any,
      lockVersion: row.lock_version,
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by,
    };
  }

  private toPayableResponse(row: CommissionPayableRow): CommissionPayableResponse {
    return {
      id: row.id as any,
      calculationId: row.calculation_id as any,
      connectorId: row.connector_id,
      shareRate: String(row.share_rate),
      amount: String(row.amount),
      currency: row.currency,
      state: row.state as any,
      holdReasons: row.hold_reasons,
      lockVersion: row.lock_version,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private toAdjustmentResponse(row: AdjustmentRow): AdjustmentResponse {
    return {
      id: row.id as any,
      adjustmentType: row.adjustment_type as any,
      calculationId: row.calculation_id,
      payableId: row.payable_id,
      amount: String(row.amount),
      reason: row.reason,
      evidenceRef: row.evidence_ref,
      status: row.status as any,
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by,
      approvedAt: row.approved_at ? row.approved_at.toISOString() : null,
      approvedBy: row.approved_by,
    };
  }

  private toPayoutResponse(row: PayoutRequestRow): PayoutRequestResponse {
    return {
      id: row.id as any,
      connectorId: row.connector_id,
      origin: row.origin as any,
      status: row.status as any,
      total: String(row.total),
      currency: row.currency,
      paymentRefMasked: row.payment_ref_masked,
      paidOn: row.paid_on ? row.paid_on.toISOString() : null,
      failureReason: row.failure_reason,
      submittedBy: row.submitted_by,
      submittedAt: row.submitted_at ? row.submitted_at.toISOString() : null,
      lockVersion: row.lock_version,
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by,
      updatedAt: row.updated_at.toISOString(),
      updatedBy: row.updated_by,
    };
  }

  private toRecalculationProposalResponse(row: RecalculationProposalRow): RecalculationProposalResponse {
    return {
      id: row.id as any,
      reason: row.reason,
      affectedCalculationIds: row.affected_calculation_ids,
      preview: typeof row.preview === 'string' ? JSON.parse(row.preview) : (row.preview ?? {}),
      status: row.status as any,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at ? row.approved_at.toISOString() : null,
      lockVersion: row.lock_version,
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by,
    };
  }
}
