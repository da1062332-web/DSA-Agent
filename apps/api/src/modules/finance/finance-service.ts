// apps/api/src/modules/finance/finance-service.ts — owner: Developer 5 (Bhushan) (MOD-COM / MOD-PAY)
import {
  AppError,
  type AdjustmentResponse,
  type ApproveCommissionPlanInput,
  type RetireCommissionPlanInput,
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
  type DisbursePayoutGatewayInput,
  type DisbursePayoutGatewayResponse,
  type PayoutApprovalInput,
  type PayoutApprovalResponse,
  type PayoutBatchResponse,
  type PayoutLineResponse,
  type PayoutRequestResponse,
  type PermissionCode,
  type RecalculationProposalResponse,
  type OutboxPort,
  type RecordPaymentFailureInput,
  type RecordPaymentInput,
  type RequestContext,
  type Tx,
  type UpdateCommissionPlanInput,
  withLegacy,
} from '@dsa/contracts';
import { createHash } from 'crypto';
import { ulid } from 'ulid';
import { encryptPaymentRef, maskPaymentRef } from './crypto';
import { paymentGatewayService } from './payment-gateway';
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
import { generateBankFileCsv, InMemoryFinancialStorage, type FinancialStoragePort } from './storage';

export interface FinanceServiceDeps {
  repository: FinanceRepository;
  audit?: AuditPort;
  outbox?: OutboxPort;
  storage?: FinancialStoragePort;
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

/**
 * Integer division honouring commission_plan.rounding_mode (P2-01). Every amount here is non-negative, so rounding
 * down is the same as truncating. An unknown mode falls back to half-up, which is the column's default.
 */
function divideWithRounding(numerator: bigint, denominator: bigint, roundingMode: string): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  switch (roundingMode) {
    case 'ROUND_DOWN':
      return quotient;
    case 'ROUND_UP':
      return quotient + 1n;
    case 'ROUND_HALF_EVEN': {
      const twice = remainder * 2n;
      if (twice > denominator) return quotient + 1n;
      if (twice < denominator) return quotient;
      return quotient % 2n === 0n ? quotient : quotient + 1n;
    }
    case 'ROUND_HALF_UP':
    default:
      return remainder * 2n >= denominator ? quotient + 1n : quotient;
  }
}

/** Basis points are exact integers, so this never goes through a float the way computeAmountWithRate does. */
function computeAmountWithBps(amountPaise: bigint, rateBps: number, roundingMode: string): bigint {
  return divideWithRounding(amountPaise * BigInt(rateBps), 10_000n, roundingMode);
}

/** The calendar month containing `date`, in UTC, as [start, endExclusive). event_date is a DATE column. */
function monthBoundsUtc(date: Date): { start: Date; endExclusive: Date } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const endExclusive = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { start, endExclusive };
}

/**
 * Only the approval route makes a commission plan ACTIVE (containment report 5.7, P0). A create or an edit that names a status is refused,
 * whoever asks, so no edit permission can activate or retire a plan without the approval that the route checks.
 */
function commissionStatusRefused(): AppError {
  return AppError.of(
    'VALIDATION_ERROR',
    'A commission plan status cannot be set here. A plan becomes ACTIVE only through its approval route.',
    [{ field: 'status', issue: 'USE_APPROVAL_ROUTE' }],
  );
}

/** A plan's terms can change only while it is a DRAFT. A live plan is changed by a new plan that is approved again. */
function commissionPlanNotDraft(id: string, status: string): AppError {
  return AppError.of(
    'INVALID_STATE',
    `Commission plan ${id} is ${status}. Only a DRAFT plan can be edited.`,
    [{ issue: 'PLAN_NOT_DRAFT' }],
  );
}

export class FinanceService {
  private readonly storage: FinancialStoragePort;

  constructor(private readonly deps: FinanceServiceDeps) {
    this.storage = deps.storage || new InMemoryFinancialStorage();
  }

  private nextId(prefix: string): string {
    return `${prefix}_${ulid()}`;
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
    } else if (this.deps.repository.emitOutboxEvent) {
      await this.deps.repository.emitOutboxEvent(tx, {
        id: `evt_${ulid()}`,
        tenantId: ctx.principal.tenantId,
        eventType: event.type,
        subjectType: event.subject.type,
        subjectId: event.subject.id,
        payload: event.data,
        correlationId: ctx.correlationId,
      });
    }
  }

  private assertPermission(ctx: RequestContext, permission: PermissionCode): void {
    const hasGrant = ctx.principal.grants.some((g) => g.code === permission);
    if (!hasGrant) {
      throw AppError.of('FORBIDDEN', `Permission '${permission}' is required.`);
    }
  }

  /** Passes with any one of the permissions (the Commission screen in the web app shows with the same set). */
  private assertAnyPermission(ctx: RequestContext, permissions: PermissionCode[]): void {
    if (!ctx.principal.grants.some((g) => permissions.includes(g.code as PermissionCode))) {
      throw AppError.of('FORBIDDEN', `One of these permissions is required: ${permissions.join(', ')}.`);
    }
  }

  /**
   * Reading commission plans, calculations and payables: commission.view, or any of the codes the Commission screen was shown for
   * before the split (LEGACY_PARENTS). Checked before any lookup, so an id cannot be probed without it.
   */
  private assertCommissionRead(ctx: RequestContext): void {
    this.assertAnyPermission(ctx, withLegacy('commission.view'));
  }

  // --- COMMISSION PLANS ---

  async createCommissionPlan(
    tx: Tx,
    ctx: RequestContext,
    input: CreateCommissionPlanInput,
  ): Promise<CommissionPlanResponse> {
    this.assertPermission(ctx, 'commission.plan.edit');

    const tenantId = ctx.principal.tenantId;
    // Refused for any status but DRAFT. The schema defaults to DRAFT, so an absent status arrives as DRAFT.
    if (input.status !== undefined && input.status !== 'DRAFT') throw commissionStatusRefused();

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
      // Forward charge at 18% GST and 2% TDS is the default. Whether an individual or proprietorship DSA should instead
      // be RCM_RECIPIENT_PAYS (Notification 13/2017-CT(R) Sl. 11) is confirmed per tenant, not inferred here.
      tax_treatment: 'FORWARD_CHARGE',
      gst_rate_bps: 1800,
      tds_rate_bps: 200,
      status: 'DRAFT',
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
    this.assertCommissionRead(ctx);
    const row = await this.deps.repository.findCommissionPlanById(tx, ctx.principal.tenantId, id);
    if (!row) {
      throw AppError.of('NOT_FOUND', `Commission plan ${id} not found.`);
    }
    return this.toPlanResponse(row);
  }

  async listCommissionPlans(
    tx: Tx,
    ctx: RequestContext,
    lenderId?: string,
  ): Promise<CommissionPlanResponse[]> {
    this.assertCommissionRead(ctx);
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
    if (input.status !== undefined) throw commissionStatusRefused();

    const tenantId = ctx.principal.tenantId;
    const plan = await this.deps.repository.findCommissionPlanById(tx, tenantId, id);
    if (!plan) {
      throw AppError.of('NOT_FOUND', `Commission plan ${id} not found.`);
    }
    if (plan.status !== 'DRAFT') throw commissionPlanNotDraft(id, plan.status);

    const updated = await this.deps.repository.updateCommissionPlan(tx, tenantId, id, ifMatchVersion, {
      qualifying_event: input.qualifyingEvent,
      basis: input.basis,
      rounding_mode: input.roundingMode,
      clawback_window_days: input.clawbackWindowDays,
      updated_by: ctx.principal.id,
    });

    if (!updated) {
      throw AppError.of('VERSION_CONFLICT', `Commission plan version conflict for ${id}.`);
    }

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: 'commission_plan.updated',
        entityType: 'commission_plan',
        entityId: id,
        before: { status: plan.status, qualifyingEvent: plan.qualifying_event, basis: plan.basis },
        after: { status: updated.status, qualifyingEvent: updated.qualifying_event, basis: updated.basis },
      });
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
    // Only a plan awaiting approval can be approved. An ACTIVE or RETIRED plan is not approved again.
    if (plan.status !== 'DRAFT' && plan.status !== 'PENDING_APPROVAL') {
      throw AppError.of('INVALID_STATE', `Commission plan ${id} is ${plan.status} and cannot be approved.`, [
        { issue: 'PLAN_NOT_AWAITING_APPROVAL' },
      ]);
    }

    // Replacement. The database keeps one ACTIVE plan per lender (uq_active_lender_plan). Approving a plan for a lender that already has one
    // retires the current plan in the same transaction, under this approval and its step-up, and records both changes. If the approval then
    // fails, the transaction rolls back and the current plan stays ACTIVE.
    const current = await this.deps.repository.findActiveCommissionPlan(tx, tenantId, plan.lender_id);
    if (current && current.id !== id) {
      const retired = await this.deps.repository.retireCommissionPlan(
        tx,
        tenantId,
        current.id,
        current.lock_version,
        ctx.principal.id,
      );
      if (!retired) {
        throw AppError.of('VERSION_CONFLICT', `Commission plan version conflict for ${current.id}.`);
      }
      if (this.deps.audit) {
        await this.deps.audit.record(tx, ctx, {
          action: 'commission_plan.retired',
          entityType: 'commission_plan',
          entityId: current.id,
          before: { status: 'ACTIVE' },
          after: { status: 'RETIRED', replacedBy: id },
          reason: `Replaced by commission plan ${id}`,
          permissionUsed: 'commission.plan.approve',
        });
      }
    }

    const approved = await this.deps.repository.approveCommissionPlan(
      tx,
      tenantId,
      id,
      ifMatchVersion,
      ctx.principal.id,
    );
    if (!approved) {
      throw AppError.of('VERSION_CONFLICT', `Commission plan version conflict for ${id}.`);
    }

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: 'commission_plan.approved',
        entityType: 'commission_plan',
        entityId: id,
        before: { status: plan.status },
        after: { status: approved.status },
        permissionUsed: 'commission.plan.approve',
      });
    }

    return this.toPlanResponse(approved);
  }

  /**
   * Retires an ACTIVE plan: it is no longer used for new calculations. Same permission as approval, with a fresh second factor (the route
   * checks it) and a reason, which is audited. A plan that is not ACTIVE cannot be retired.
   */
  async retireCommissionPlan(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    ifMatchVersion: number,
    input: RetireCommissionPlanInput,
  ): Promise<CommissionPlanResponse> {
    this.assertPermission(ctx, 'commission.plan.approve');

    const tenantId = ctx.principal.tenantId;
    const plan = await this.deps.repository.findCommissionPlanById(tx, tenantId, id);
    if (!plan) {
      throw AppError.of('NOT_FOUND', `Commission plan ${id} not found.`);
    }
    if (plan.status !== 'ACTIVE') {
      throw AppError.of(
        'INVALID_STATE',
        `Commission plan ${id} is ${plan.status}. Only an ACTIVE plan can be retired.`,
        [{ issue: 'PLAN_NOT_ACTIVE' }],
      );
    }

    const retired = await this.deps.repository.retireCommissionPlan(
      tx,
      tenantId,
      id,
      ifMatchVersion,
      ctx.principal.id,
    );
    if (!retired) {
      throw AppError.of('VERSION_CONFLICT', `Commission plan version conflict for ${id}.`);
    }

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: 'commission_plan.retired',
        entityType: 'commission_plan',
        entityId: id,
        before: { status: 'ACTIVE' },
        after: { status: 'RETIRED' },
        reason: input.reason,
        permissionUsed: 'commission.plan.approve',
      });
    }

    return this.toPlanResponse(retired);
  }

  // --- COMMISSION CALCULATION & PAYABLES (Disbursement Event Handlers) ---

  async calculateCommission(
    tx: Tx,
    ctx: RequestContext,
    input: CalculateCommissionInput,
  ): Promise<{ calculation: CommissionCalculationResponse; payable: CommissionPayableResponse | null }> {
    // FIN-01: calculating creates calculations and payables, which feed payouts. A read permission (finance.view) no longer does it.
    this.assertPermission(ctx, 'commission.calculate');

    const tenantId = ctx.principal.tenantId;
    const plan = await this.deps.repository.findActiveCommissionPlan(tx, tenantId, input.lenderId);
    if (!plan) {
      throw AppError.of('INVALID_STATE', `No active commission plan found for lender ${input.lenderId}.`);
    }

    const existingEarned = await this.deps.repository.findEarnedCalculationByTranche(
      tx,
      tenantId,
      input.trancheId,
    );
    if (existingEarned) {
      throw AppError.of(
        'INVALID_STATE',
        `Earned commission calculation already exists for tranche ${input.trancheId}.`,
      );
    }

    // Deterministic monetary arithmetic without floating-point errors
    const basisPaise = parseMoneyToPaise(input.basisAmount);

    const calcId = this.nextId('ccal');
    const now = new Date();
    const eventDate = input.eventDate ? new Date(input.eventDate) : now;

    // P2-01: the rate comes from the lender's payout grid, not from a constant. customRate still wins, for corrections.
    const resolved = await this.resolveCommissionRate(tx, tenantId, plan, input, basisPaise, eventDate);
    const rate = resolved.rate;
    const grossPaise = resolved.grossPaise;
    const grossStr = formatPaiseToMoney(grossPaise);
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
      rate_type: resolved.rateType,
      slab_id: resolved.slabId,
      product_category: input.productCategory ?? null,
      cap: null,
      gross_amount: grossStr,
      currency,
      calc_kind: 'EARNED',
      rule_set_version_id: plan?.rule_set_id ?? null,
      decision_record_id: null,
      inputs_hash: createHash('sha256')
        .update(`${input.lenderId}:${input.trancheId}:${input.basisAmount}`)
        .digest('hex'),
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
    this.assertCommissionRead(ctx);
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
    this.assertCommissionRead(ctx);
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
    this.assertCommissionRead(ctx);
    const { rows, nextCursor } = await this.deps.repository.listCommissionPayables(
      tx,
      ctx.principal.tenantId,
      filters,
    );
    return {
      data: rows.map((r) => this.toPayableResponse(r)),
      meta: { nextCursor, limit: filters.limit },
    };
  }

  // --- CLAWBACKS & ADJUSTMENTS ---

  async createClawback(tx: Tx, ctx: RequestContext, input: CreateClawbackInput): Promise<AdjustmentResponse> {
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

  async approveClawback(tx: Tx, ctx: RequestContext, id: string): Promise<AdjustmentResponse> {
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

  async rejectClawback(tx: Tx, ctx: RequestContext, id: string): Promise<AdjustmentResponse> {
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
    // FIN-06: proposing recalculated payables is an adjustment, not a plan edit. Its approval stays gated by step-up.
    this.assertPermission(ctx, 'adjustment.create');

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

    const approved = await this.deps.repository.approveRecalculationProposal(
      tx,
      tenantId,
      id,
      ctx.principal.id,
    );
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
    this.assertCommissionRead(ctx);
    const row = await this.deps.repository.findRecalculationProposalById(tx, ctx.principal.tenantId, id);
    if (!row) {
      throw AppError.of('NOT_FOUND', `Recalculation proposal ${id} not found.`);
    }
    return this.toRecalculationProposalResponse(row);
  }

  async listRecalculationProposals(tx: Tx, ctx: RequestContext): Promise<RecalculationProposalResponse[]> {
    this.assertCommissionRead(ctx);
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

    // Retry handling (SUB-PAY.04)
    if (input.retryOfPayoutId) {
      const prevPayout = await this.deps.repository.findPayoutRequestById(
        tx,
        tenantId,
        input.retryOfPayoutId,
      );
      if (!prevPayout) {
        throw AppError.of('NOT_FOUND', `Prior payout request ${input.retryOfPayoutId} for retry not found.`);
      }
      if (prevPayout.status !== 'PAYMENT_FAILED') {
        throw AppError.of(
          'INVALID_STATE',
          `Only PAYMENT_FAILED payout requests can be retried (current: ${prevPayout.status}).`,
        );
      }
      if (prevPayout.connector_id !== input.connectorId) {
        throw AppError.of(
          'VALIDATION_ERROR',
          `Prior payout belongs to connector ${prevPayout.connector_id}, not ${input.connectorId}.`,
        );
      }
    }

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
        throw AppError.of(
          'INVALID_STATE',
          `Payable ${pId} is already included in live payout request ${activeLine.payout_id}.`,
        );
      }

      if (payable.state !== 'ELIGIBLE') {
        throw AppError.of(
          'INVALID_STATE',
          `Payable ${pId} is not in ELIGIBLE state (current: ${payable.state}).`,
        );
      }
      if (payable.connector_id !== input.connectorId) {
        throw AppError.of(
          'VALIDATION_ERROR',
          `Payable ${pId} belongs to connector ${payable.connector_id}, not ${input.connectorId}.`,
        );
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
      retry_of_payout_id: input.retryOfPayoutId ?? null,
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
          throw AppError.of(
            'INVALID_STATE',
            `Payable ${line.payableId} is already included in an active payout line.`,
          );
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

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: 'payout_request.created',
        entityType: 'payout_request',
        entityId: payoutId,
        after: {
          connectorId: reqRow.connector_id,
          total: reqRow.total,
          currency: reqRow.currency,
          origin: reqRow.origin,
          lineCount: linesToCreate.length,
          retryOfPayoutId: reqRow.retry_of_payout_id,
        },
      });
    }

    await this.emitEvent(tx, ctx, {
      type: 'payout.created',
      subject: { type: 'payout_request', id: payoutId },
      data: {
        payoutId,
        connectorId: reqRow.connector_id,
        total: reqRow.total,
        currency: reqRow.currency,
        lineCount: linesToCreate.length,
      },
    });

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
    const { rows, nextCursor } = await this.deps.repository.listPayoutRequests(
      tx,
      ctx.principal.tenantId,
      filters,
    );
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
      throw AppError.of(
        'INVALID_STATE',
        `Only SUBMITTED payout requests can be approved (current: ${payout.status}).`,
      );
    }

    // SOD-03: Creator or submitter cannot approve the payout request
    if (payout.created_by === ctx.principal.id || payout.submitted_by === ctx.principal.id) {
      throw AppError.of(
        'SOD_VIOLATION',
        'SOD-03: Payout creator or submitter cannot approve the payout request.',
      );
    }

    const lines = await this.deps.repository.listPayoutLines(tx, tenantId, id);
    const payableIds = lines.map((l) => l.payable_id);

    // Concurrency hardening: Lock constituent payables deterministically in ascending ID order (SELECT ... FOR UPDATE)
    const lockedPayables = await this.deps.repository.lockCommissionPayablesAscending(
      tx,
      tenantId,
      payableIds,
    );

    // Revalidate eligibility & holds under exclusive lock
    for (const payable of lockedPayables) {
      if (payable.state === 'ON_HOLD') {
        throw AppError.of(
          'INVALID_STATE',
          '[PAYABLE_ON_HOLD] Cannot approve payout request: one or more payables are ON_HOLD',
          [{ field: payable.id, issue: 'PAYABLE_ON_HOLD' }],
        );
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

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: input.decision === 'APPROVED' ? 'payout_request.approved' : 'payout_request.rejected',
        entityType: 'payout_request',
        entityId: id,
        after: {
          decision: input.decision,
          comment: input.comment ?? null,
          total: payout.total,
          lineCount: lines.length,
        },
      });
    }

    await this.emitEvent(tx, ctx, {
      type: input.decision === 'APPROVED' ? 'payout.approved' : 'payout.rejected',
      subject: { type: 'payout_request', id },
      data: {
        payoutId: id,
        decision: input.decision,
        approverId: ctx.principal.id,
        total: payout.total,
      },
    });

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
      throw AppError.of(
        'INVALID_STATE',
        `Only DRAFT or SUBMITTED payouts can be cancelled (status: ${payout.status}).`,
      );
    }

    const updated = await this.deps.repository.updatePayoutStatus(tx, tenantId, id, 'CANCELLED');
    const lines = await this.deps.repository.listPayoutLines(tx, tenantId, id);
    for (const line of lines) {
      await this.deps.repository.updatePayoutLineStatus(tx, tenantId, line.id, 'REMOVED');
      await this.deps.repository.updateCommissionPayableState(tx, tenantId, line.payable_id, 'ELIGIBLE');
    }

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: 'payout_request.cancelled',
        entityType: 'payout_request',
        entityId: id,
        after: {
          status: 'CANCELLED',
          total: payout.total,
        },
      });
    }

    await this.emitEvent(tx, ctx, {
      type: 'payout.cancelled',
      subject: { type: 'payout_request', id },
      data: {
        payoutId: id,
        total: payout.total,
      },
    });

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

    // Encrypt payment reference using AES-256-GCM and retain masked value for display
    const ciphertext = encryptPaymentRef(input.paymentRef);
    const masked = maskPaymentRef(input.paymentRef) || `******${input.paymentRef.slice(-4)}`;
    const paidOn = input.paidOn ? new Date(input.paidOn) : ctx.now;

    const updated = await this.deps.repository.updatePayoutStatus(tx, tenantId, id, 'PAYMENT_RECORDED', {
      paidOn,
      paymentRefMasked: masked,
      paymentRefCiphertext: ciphertext,
    });

    const lines = await this.deps.repository.listPayoutLines(tx, tenantId, id);
    for (const line of lines) {
      await this.deps.repository.updatePayoutLineStatus(tx, tenantId, line.id, 'PAYMENT_RECORDED');
      await this.deps.repository.updateCommissionPayableState(tx, tenantId, line.payable_id, 'PAID');
    }

    if (this.deps.audit) {
      // Security: NEVER log plaintext paymentRef or encryption keys
      await this.deps.audit.record(tx, ctx, {
        action: 'payout_request.payment_recorded',
        entityType: 'payout_request',
        entityId: id,
        after: {
          paidOn: paidOn.toISOString(),
          paymentRefMasked: masked,
          total: payout.total,
        },
      });
    }

    await this.emitEvent(tx, ctx, {
      type: 'payout.paid',
      subject: { type: 'payout_request', id },
      data: {
        payoutId: id,
        paidOn: paidOn.toISOString(),
        paymentRefMasked: masked,
        total: payout.total,
        currency: payout.currency,
      },
    });

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
    const payout = await this.deps.repository.findPayoutRequestById(tx, tenantId, id);
    if (!payout) {
      throw AppError.of('NOT_FOUND', `Payout request ${id} not found.`);
    }

    const updated = await this.deps.repository.updatePayoutStatus(tx, tenantId, id, 'PAYMENT_FAILED', {
      failureReason: input.failureReason,
    });

    const lines = await this.deps.repository.listPayoutLines(tx, tenantId, id);
    for (const line of lines) {
      await this.deps.repository.updatePayoutLineStatus(tx, tenantId, line.id, 'PAYMENT_FAILED');
      await this.deps.repository.updateCommissionPayableState(tx, tenantId, line.payable_id, 'ELIGIBLE');
    }

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: 'payout_request.payment_failed',
        entityType: 'payout_request',
        entityId: id,
        after: {
          failureReason: input.failureReason,
          total: payout.total,
        },
      });
    }

    await this.emitEvent(tx, ctx, {
      type: 'payout.failed',
      subject: { type: 'payout_request', id },
      data: {
        payoutId: id,
        failureReason: input.failureReason,
        total: payout.total,
      },
    });

    return this.toPayoutResponse(updated!);
  }

  // --- AUTOMATED DIRECT NET-BANKING / PAYMENT GATEWAY INTEGRATION (MOD-PAY / TASK-418) ---
  async disbursePayoutViaGateway(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    input: DisbursePayoutGatewayInput,
  ): Promise<DisbursePayoutGatewayResponse> {
    this.assertAnyPermission(ctx, withLegacy('payout.disburse'));

    const tenantId = ctx.principal.tenantId;
    const payout = await this.deps.repository.findPayoutRequestById(tx, tenantId, id);
    if (!payout) {
      throw AppError.of('NOT_FOUND', `Payout request ${id} not found.`);
    }
    if (payout.status !== 'APPROVED') {
      throw AppError.of(
        'INVALID_STATE',
        `Payout ${id} is not APPROVED for gateway disbursement (status: ${payout.status}).`,
      );
    }

    // Refused until a payment-rail integration returns a bank reference. The call throws, so nothing below it runs and no payment is recorded.
    const gatewayResult = await paymentGatewayService.disburse({
      payoutId: id,
      amount: payout.total,
      currency: payout.currency,
      mode: input.mode ?? 'IMPS',
    });

    // Record the payment with the gateway generated UTR
    await this.recordPayoutPayment(tx, ctx, id, {
      paymentRef: gatewayResult.utrNumber,
      paidOn: gatewayResult.disbursedAt,
    });

    return {
      payoutId: id as any,
      status: 'PAYMENT_RECORDED',
      transferId: gatewayResult.transferId,
      utrNumber: gatewayResult.utrNumber,
      gatewayMode: gatewayResult.gatewayMode,
      amount: gatewayResult.amount,
      currency: gatewayResult.currency,
      disbursedAt: gatewayResult.disbursedAt,
    };
  }

  async dispatchPayoutBatchToGateway(
    tx: Tx,
    ctx: RequestContext,
    batchId: string,
    mode: 'IMPS' | 'NEFT' | 'RTGS' = 'IMPS',
  ): Promise<{ batchId: string; totalDisbursed: number; results: DisbursePayoutGatewayResponse[] }> {
    this.assertAnyPermission(ctx, withLegacy('payout.disburse'));
    const tenantId = ctx.principal.tenantId;
    const batch = await this.deps.repository.findPayoutBatchById(tx, tenantId, batchId);
    if (!batch) {
      throw AppError.of('NOT_FOUND', `Payout batch ${batchId} not found.`);
    }

    const results: DisbursePayoutGatewayResponse[] = [];
    let total = 0;

    for (const pid of batch.payout_ids) {
      const payout = await this.deps.repository.findPayoutRequestById(tx, tenantId, pid);
      if (payout && payout.status === 'APPROVED') {
        const res = await this.disbursePayoutViaGateway(tx, ctx, pid, { mode });
        results.push(res);
        total += Number(res.amount);
      }
    }

    if (this.deps.repository.updatePayoutBatchStatus) {
      await this.deps.repository.updatePayoutBatchStatus(tx, tenantId, batchId, 'PROCESSED');
    }

    return {
      batchId,
      totalDisbursed: Math.round(total * 100) / 100,
      results,
    };
  }

  // --- PAYOUT BATCHES ---

  async createPayoutBatch(
    tx: Tx,
    ctx: RequestContext,
    input: CreatePayoutBatchInput,
  ): Promise<PayoutBatchResponse> {
    this.assertAnyPermission(ctx, withLegacy('payout.disburse'));

    const tenantId = ctx.principal.tenantId;
    const uniqueIds = new Set(input.payoutIds);
    if (uniqueIds.size !== input.payoutIds.length) {
      throw AppError.of('VALIDATION_ERROR', 'Duplicate payout IDs provided in batch request.');
    }

    const validPayouts: PayoutRequestRow[] = [];
    for (const pid of input.payoutIds) {
      const p = await this.deps.repository.findPayoutRequestById(tx, tenantId, pid);
      if (!p) {
        throw AppError.of('NOT_FOUND', `Payout request ${pid} not found.`);
      }
      if (p.status !== 'APPROVED' && p.status !== 'PAYMENT_RECORDED') {
        throw AppError.of(
          'INVALID_STATE',
          `Payout ${pid} is not in eligible status for batching (current: ${p.status}).`,
        );
      }
      validPayouts.push(p);
    }

    const id = this.nextId('pbt');
    const now = new Date();

    // Generate real, deterministic bank file with formula injection protection
    const records = validPayouts.map((p) => ({
      id: p.id,
      connectorId: p.connector_id,
      total: String(p.total),
      currency: p.currency,
    }));
    const fileResult = generateBankFileCsv(id, records);
    const objectKey = `batches/${id}.csv`;

    // Persist file via financial storage port
    await this.storage.save(tenantId, objectKey, fileResult.buffer, 'text/csv');

    const row: PayoutBatchRow = {
      id,
      tenant_id: tenantId,
      payout_ids: input.payoutIds,
      file_object_key: objectKey,
      file_sha256: fileResult.sha256,
      status: 'GENERATED',
      generated_by: ctx.principal.id,
      generated_at: now,
    };

    await this.deps.repository.insertPayoutBatch(tx, row);

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: 'payout_batch.created',
        entityType: 'payout_batch',
        entityId: id,
        after: {
          payoutCount: input.payoutIds.length,
          fileObjectKey: objectKey,
          fileSha256: fileResult.sha256,
        },
      });
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

  async getPayoutBatchBankFile(
    tx: Tx,
    ctx: RequestContext,
    id: string,
  ): Promise<{ buffer: Buffer; filename: string; sha256: string }> {
    this.assertAnyPermission(ctx, withLegacy('payout.disburse'));

    const tenantId = ctx.principal.tenantId;
    const batch = await this.deps.repository.findPayoutBatchById(tx, tenantId, id);
    if (!batch) {
      throw AppError.of('NOT_FOUND', `Payout batch ${id} not found.`);
    }

    if (!batch.file_object_key) {
      throw AppError.of('NOT_FOUND', `Bank file object key missing for batch ${id}.`);
    }

    const buffer = await this.storage.get(tenantId, batch.file_object_key);
    if (!buffer) {
      throw AppError.of('NOT_FOUND', `Bank file not found in storage for batch ${id}.`);
    }

    // Verify cryptographic SHA-256 integrity against database record
    const sha = createHash('sha256').update(buffer).digest('hex');
    if (batch.file_sha256 && sha !== batch.file_sha256) {
      throw AppError.of('CONTENT_HASH_MISMATCH', 'Bank file checksum verification failed: SHA-256 mismatch.');
    }

    if (this.deps.audit) {
      await this.deps.audit.record(tx, ctx, {
        action: 'payout_batch.downloaded',
        entityType: 'payout_batch',
        entityId: id,
        after: {
          fileSha256: sha,
          fileSizeBytes: buffer.length,
        },
      });
    }

    return {
      buffer,
      filename: `batch-${id}.csv`,
      sha256: sha,
    };
  }

  // --- MAPPERS ---

  /**
   * The rate for one qualifying event (P2-01; replaces the hard-coded 1.5% default).
   *
   * `customRate` still wins, so the manual route can price a correction by hand. Otherwise the plan's payout grid
   * decides: the band is chosen by the lender's month-to-date disbursed volume in that product category, counting
   * this event itself, so a month's first 4,00,000 sits in the 0 to 5,00,000 band. If no band covers the volume this
   * throws rather than falling back to a default rate -- a silently wrong rate here is money the DSA never bills.
   */
  private async resolveCommissionRate(
    tx: Tx,
    tenantId: string,
    plan: CommissionPlanRow,
    input: CalculateCommissionInput,
    basisPaise: bigint,
    eventDate: Date,
  ): Promise<{ rate: number; rateType: 'PERCENTAGE' | 'FLAT'; slabId: string | null; grossPaise: bigint }> {
    if (input.customRate !== undefined && input.customRate !== null) {
      return {
        rate: input.customRate,
        rateType: 'PERCENTAGE',
        slabId: null,
        grossPaise: computeAmountWithRate(basisPaise, input.customRate),
      };
    }

    const productCategory = input.productCategory;
    if (!productCategory) {
      throw AppError.of(
        'VALIDATION_ERROR',
        'productCategory is required to choose a commission slab; pass customRate to price this event by hand.',
      );
    }

    const { start, endExclusive } = monthBoundsUtc(eventDate);
    const priorVolume = await this.deps.repository.sumEarnedBasisForLenderMonth(
      tx,
      tenantId,
      input.lenderId,
      productCategory,
      start,
      endExclusive,
    );
    const volumePaise = parseMoneyToPaise(priorVolume) + basisPaise;

    const slabs = await this.deps.repository.findSlabsForLookup(
      tx,
      tenantId,
      plan.id,
      productCategory,
      eventDate,
    );
    // volume_from is inclusive and volume_to exclusive, so a volume exactly on a boundary matches one band only.
    const slab = slabs.find((candidate) => {
      const from = parseMoneyToPaise(candidate.volume_from);
      const to = candidate.volume_to === null ? null : parseMoneyToPaise(candidate.volume_to);
      return volumePaise >= from && (to === null || volumePaise < to);
    });
    if (!slab) {
      throw AppError.of(
        'INVALID_STATE',
        `No commission slab on plan ${plan.id} covers ${productCategory} at a monthly volume of ${formatPaiseToMoney(volumePaise)}.`,
      );
    }

    if (slab.flat_amount !== null) {
      return {
        rate: 0,
        rateType: 'FLAT',
        slabId: slab.id,
        grossPaise: parseMoneyToPaise(slab.flat_amount),
      };
    }

    const rateBps = slab.rate_bps ?? 0;
    return {
      rate: rateBps / 10_000,
      rateType: 'PERCENTAGE',
      slabId: slab.id,
      grossPaise: computeAmountWithBps(basisPaise, rateBps, plan.rounding_mode),
    };
  }

  private toPlanResponse(row: CommissionPlanRow): CommissionPlanResponse {
    return {
      id: row.id as any,
      lenderId: row.lender_id as any,
      qualifyingEvent: row.qualifying_event as any,
      basis: row.basis as any,
      roundingMode: row.rounding_mode,
      clawbackWindowDays: row.clawback_window_days,
      ruleSetId: row.rule_set_id,
      taxTreatment: row.tax_treatment as any,
      gstRateBps: row.gst_rate_bps,
      tdsRateBps: row.tds_rate_bps,
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
      slabId: row.slab_id,
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
      retryOfPayoutId: row.retry_of_payout_id ?? null,
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
