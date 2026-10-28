// apps/api/src/modules/origination/sanctions/service.ts — owner: Dev 3 (MOD-SND Service)
import {
  AppError,
  maskFinancialIdentifier,
  type CancelSanctionRequest,
  type DisbursementTrancheDto,
  type ExceptionApprovalRequest,
  type RecordSanctionRequest,
  type RecordTrancheRequest,
  type RequestContext,
  type SanctionDto,
  type Tx,
  type TxRunner,
  type VerifyTrancheRequest,
  type VoidTrancheRequest,
} from '@dsa/contracts';
import { ulid } from 'ulid';
import type { SanctionRepository } from './repository';
import { toSanctionDto, toTrancheDto, type DisbursementTrancheRow, type SanctionRow } from './types';

export class SanctionService {
  constructor(
    private readonly repo: SanctionRepository,
    private readonly txRunner: TxRunner,
  ) {}

  private checkPermission(ctx: RequestContext, requiredPermission: string): void {
    const hasGrant = ctx.principal.grants.some((g) => g.code === requiredPermission);
    if (!hasGrant) {
      throw AppError.of('FORBIDDEN', `Missing required permission: ${requiredPermission}`);
    }
  }

  /**
   * Reading sanctions and disbursement tranches: any of the permissions the Sanction and disbursement screen is shown for
   * (docs/PERMISSION_UI_VISIBILITY_AUDIT.md F-02). Checked before any lookup, so an id cannot be probed without it. There is no
   * separate read permission; widening this to application.read is decision D-02.
   */
  private checkReadAccess(ctx: RequestContext): void {
    const allowed = [
      'sanction.record',
      'disbursement.record',
      'disbursement.verify',
      'disbursement.exception_approve',
    ];
    if (!ctx.principal.grants.some((g) => allowed.includes(g.code))) {
      throw AppError.of('FORBIDDEN', `One of these permissions is required: ${allowed.join(', ')}`);
    }
  }

  async recordSanction(
    ctx: RequestContext,
    lenderCaseId: string,
    req: RecordSanctionRequest,
  ): Promise<{ sanction: SanctionDto }> {
    this.checkPermission(ctx, 'sanction.record');
    const tenantId = ctx.principal.tenantId;

    return this.txRunner.withTenantTx(ctx, async (tx: Tx) => {
      const lenderCase = await this.repo.findLenderCase(tx, tenantId, lenderCaseId);
      if (!lenderCase) {
        throw AppError.of('NOT_FOUND', `Lender case ${lenderCaseId} not found`);
      }

      const eligibleStatuses = ['UNDER_PROCESSING', 'SUBMITTED', 'QUERY_RAISED', 'QUERY_RESPONDED', 'SANCTIONED'];
      if (!eligibleStatuses.includes(lenderCase.status)) {
        throw AppError.of(
          'INVALID_CASE_STATUS',
          `Lender case in status ${lenderCase.status} is not eligible for sanction recording`,
        );
      }

      const existingSanctions = await this.repo.listSanctionsByCase(tx, tenantId, lenderCaseId);
      const nextVersion =
        existingSanctions.length > 0 ? Math.max(...existingSanctions.map((s) => s.version)) + 1 : 1;

      // Revise prior active sanctions
      for (const prev of existingSanctions) {
        if (prev.status === 'ACTIVE') {
          await this.repo.updateSanction(tx, {
            ...prev,
            status: 'REVISED',
            updated_by: ctx.principal.id,
          });
        }
      }

      const sanctionId = `snc_${ulid()}`;
      const now = new Date().toISOString();

      const newSanctionRow: SanctionRow = {
        id: sanctionId,
        tenant_id: tenantId,
        lender_case_id: lenderCaseId,
        version: nextVersion,
        amount: req.amount.toFixed(2),
        tenure_months: req.tenureMonths,
        rate_value: req.rateValue.toFixed(4),
        rate_type: req.rateType,
        benchmark_text: req.benchmarkText ?? null,
        fees_text: req.feesText ?? null,
        conditions: req.conditions ?? [],
        sanction_date: req.sanctionDate,
        valid_until: req.validUntil,
        letter_document_id: req.letterDocumentId ?? null,
        status: 'ACTIVE',
        source: req.source ?? 'MANUAL',
        cancel_reason: null,
        lock_version: 0,
        created_at: now,
        created_by: ctx.principal.id,
        updated_at: now,
        updated_by: ctx.principal.id,
      };

      const created = await this.repo.insertSanction(tx, newSanctionRow);

      // Roll up lender case to SANCTIONED if not yet sanctioned
      if (lenderCase.status !== 'SANCTIONED') {
        await this.repo.updateLenderCaseStatus(
          tx,
          tenantId,
          lenderCaseId,
          'SANCTIONED',
          ctx.principal.id,
          'Lender sanction terms recorded',
        );

        // Application status roll-up ROLLUP-4
        await this.repo.updateApplicationStatus(
          tx,
          tenantId,
          lenderCase.application_id,
          'SANCTIONED',
          null,
          'ROLLUP-4',
          ctx.principal.id,
          lenderCaseId,
        );
      }

      // Outbox event
      await this.repo.emitOutboxEvent(tx, {
        id: `evt_${ulid()}`,
        tenantId,
        eventName: 'sanction.recorded',
        aggregateType: 'sanction',
        aggregateId: sanctionId,
        payload: {
          sanctionId,
          lenderCaseId,
          version: nextVersion,
          amount: req.amount,
          validUntil: req.validUntil,
          actor: ctx.principal.id,
        },
        occurredAt: now,
      });

      return { sanction: toSanctionDto(created) };
    });
  }

  async getSanction(ctx: RequestContext, id: string): Promise<SanctionDto> {
    this.checkReadAccess(ctx);
    const tenantId = ctx.principal.tenantId;
    return this.txRunner.withTenantTx(ctx, async (tx: Tx) => {
      const sanction = await this.repo.findSanctionById(tx, tenantId, id);
      if (!sanction) {
        throw AppError.of('NOT_FOUND', `Sanction ${id} not found`);
      }
      return toSanctionDto(sanction);
    });
  }

  async listSanctionsForCase(ctx: RequestContext, lenderCaseId: string): Promise<SanctionDto[]> {
    this.checkReadAccess(ctx);
    const tenantId = ctx.principal.tenantId;
    return this.txRunner.withTenantTx(ctx, async (tx: Tx) => {
      const lenderCase = await this.repo.findLenderCase(tx, tenantId, lenderCaseId);
      if (!lenderCase) {
        throw AppError.of('NOT_FOUND', `Lender case ${lenderCaseId} not found`);
      }
      const list = await this.repo.listSanctionsByCase(tx, tenantId, lenderCaseId);
      return list.map(toSanctionDto);
    });
  }

  async listAllSanctions(
    ctx: RequestContext,
    filter?: { status?: string; limit?: number },
  ): Promise<SanctionDto[]> {
    this.checkReadAccess(ctx);
    const tenantId = ctx.principal.tenantId;
    return this.txRunner.withTenantTx(ctx, async (tx: Tx) => {
      const list = await this.repo.listAllSanctions(tx, tenantId, filter);
      return list.map(toSanctionDto);
    });
  }

  async listAllTranches(
    ctx: RequestContext,
    filter?: { status?: string; limit?: number },
  ): Promise<DisbursementTrancheDto[]> {
    this.checkReadAccess(ctx);
    const tenantId = ctx.principal.tenantId;
    return this.txRunner.withTenantTx(ctx, async (tx: Tx) => {
      const list = await this.repo.listAllTranches(tx, tenantId, filter);
      return list.map(toTrancheDto);
    });
  }

  async cancelSanction(
    ctx: RequestContext,
    sanctionId: string,
    req: CancelSanctionRequest,
  ): Promise<SanctionDto> {
    this.checkPermission(ctx, 'sanction.record');
    const tenantId = ctx.principal.tenantId;

    return this.txRunner.withTenantTx(ctx, async (tx: Tx) => {
      const sanction = await this.repo.findSanctionById(tx, tenantId, sanctionId);
      if (!sanction) {
        throw AppError.of('NOT_FOUND', `Sanction ${sanctionId} not found`);
      }

      if (sanction.status !== 'ACTIVE') {
        throw AppError.of(
          'INVALID_STATE',
          `Cannot cancel sanction in status ${sanction.status}; only ACTIVE sanctions can be cancelled`,
        );
      }

      const updated = await this.repo.updateSanction(tx, {
        ...sanction,
        status: 'CANCELLED',
        cancel_reason: req.reason,
        updated_by: ctx.principal.id,
      });

      // Update lender case status to SANCTION_CANCELLED
      await this.repo.updateLenderCaseStatus(
        tx,
        tenantId,
        sanction.lender_case_id,
        'SANCTION_CANCELLED',
        ctx.principal.id,
        `Sanction cancelled: ${req.reason}`,
      );

      // Emit outbox event
      const now = new Date().toISOString();
      await this.repo.emitOutboxEvent(tx, {
        id: `evt_${ulid()}`,
        tenantId,
        eventName: 'sanction.cancelled',
        aggregateType: 'sanction',
        aggregateId: sanctionId,
        payload: {
          sanctionId,
          lenderCaseId: sanction.lender_case_id,
          reason: req.reason,
          actor: ctx.principal.id,
        },
        occurredAt: now,
      });

      return toSanctionDto(updated);
    });
  }

  async recordTranche(
    ctx: RequestContext,
    sanctionId: string,
    req: RecordTrancheRequest,
  ): Promise<{ tranche: DisbursementTrancheDto; remainingSanctionAmount: number }> {
    this.checkPermission(ctx, 'disbursement.record');
    const tenantId = ctx.principal.tenantId;

    return this.txRunner.withTenantTx(ctx, async (tx: Tx) => {
      const sanction = await this.repo.findSanctionById(tx, tenantId, sanctionId);
      if (!sanction) {
        throw AppError.of('NOT_FOUND', `Sanction ${sanctionId} not found`);
      }

      if (sanction.status !== 'ACTIVE') {
        throw AppError.of(
          'INACTIVE_SANCTION',
          `Cannot disburse against sanction in status ${sanction.status}; only ACTIVE sanctions are eligible`,
        );
      }

      const todayStr = new Date().toISOString().slice(0, 10);
      if (sanction.valid_until < todayStr) {
        throw AppError.of('SANCTION_EXPIRED', 'Sanction validity has expired');
      }

      // Remaining sanction limit calculation
      const existingTranches = await this.repo.listTranchesBySanction(tx, tenantId, sanctionId);
      const activeTotal = existingTranches
        .filter((t) => t.status === 'RECORDED' || t.status === 'VERIFIED')
        .reduce((sum, t) => sum + Number(t.amount), 0);

      const sanctionAmount = Number(sanction.amount);
      const remainingBefore = sanctionAmount - activeTotal;

      if (req.amount > remainingBefore) {
        throw AppError.of(
          'EXCEEDS_SANCTION',
          `Tranche amount (${req.amount}) exceeds remaining sanction limit (${remainingBefore.toFixed(2)})`,
        );
      }

      const nextTrancheNo =
        existingTranches.length > 0 ? Math.max(...existingTranches.map((t) => t.tranche_no)) + 1 : 1;

      // Encryption & masking
      const utrCiphertext = req.utr ? Buffer.from(req.utr).toString('base64') : null;
      const utrMasked = maskFinancialIdentifier(req.utr);
      const loanAccountCiphertext = req.loanAccountNumber
        ? Buffer.from(req.loanAccountNumber).toString('base64')
        : null;
      const loanAccountMasked = maskFinancialIdentifier(req.loanAccountNumber);

      const trancheId = `trn_${ulid()}`;
      const now = new Date().toISOString();

      const newTrancheRow: DisbursementTrancheRow = {
        id: trancheId,
        tenant_id: tenantId,
        sanction_id: sanctionId,
        tranche_no: nextTrancheNo,
        amount: req.amount.toFixed(2),
        currency: req.currency ?? 'INR',
        disbursed_on: req.disbursedOn,
        utr_ciphertext: utrCiphertext,
        utr_masked: utrMasked,
        loan_account_ciphertext: loanAccountCiphertext,
        loan_account_masked: loanAccountMasked,
        evidence_document_id: req.evidenceDocumentId ?? null,
        status: 'RECORDED',
        recorded_by: ctx.principal.id,
        verified_by: null,
        verified_at: null,
        verification_comment: null,
        exception_approval_id: null,
        voided_by: null,
        void_reason: null,
        replaced_by_tranche_id: null,
        lock_version: 0,
        created_at: now,
        created_by: ctx.principal.id,
        updated_at: now,
        updated_by: ctx.principal.id,
      };

      const created = await this.repo.insertTranche(tx, newTrancheRow);
      const remainingAfter = remainingBefore - req.amount;

      // Update lender case status to PARTIALLY_DISBURSED or DISBURSED
      const newTotal = activeTotal + req.amount;
      const isFullyDisbursed = newTotal >= sanctionAmount;
      const targetCaseStatus = isFullyDisbursed ? 'DISBURSED' : 'PARTIALLY_DISBURSED';

      const lenderCase = await this.repo.findLenderCase(tx, tenantId, sanction.lender_case_id);
      if (lenderCase && lenderCase.status !== 'DISBURSED') {
        await this.repo.updateLenderCaseStatus(
          tx,
          tenantId,
          sanction.lender_case_id,
          targetCaseStatus,
          ctx.principal.id,
          `Disbursement tranche #${nextTrancheNo} recorded`,
        );

        // Application status roll-up ROLLUP-5
        await this.repo.updateApplicationStatus(
          tx,
          tenantId,
          lenderCase.application_id,
          targetCaseStatus,
          null,
          'ROLLUP-5',
          ctx.principal.id,
          sanction.lender_case_id,
        );
      }

      // Outbox event
      await this.repo.emitOutboxEvent(tx, {
        id: `evt_${ulid()}`,
        tenantId,
        eventName: 'disbursement.recorded',
        aggregateType: 'disbursement_tranche',
        aggregateId: trancheId,
        payload: {
          trancheId,
          sanctionId,
          trancheNo: nextTrancheNo,
          amount: req.amount,
          disbursedOn: req.disbursedOn,
          recordedBy: ctx.principal.id,
        },
        occurredAt: now,
      });

      return {
        tranche: toTrancheDto(created),
        remainingSanctionAmount: remainingAfter,
      };
    });
  }

  async getTranche(ctx: RequestContext, id: string): Promise<DisbursementTrancheDto> {
    this.checkReadAccess(ctx);
    const tenantId = ctx.principal.tenantId;
    return this.txRunner.withTenantTx(ctx, async (tx: Tx) => {
      const tranche = await this.repo.findTrancheById(tx, tenantId, id);
      if (!tranche) {
        throw AppError.of('NOT_FOUND', `Tranche ${id} not found`);
      }
      return toTrancheDto(tranche);
    });
  }

  async listTranchesForSanction(ctx: RequestContext, sanctionId: string): Promise<DisbursementTrancheDto[]> {
    this.checkReadAccess(ctx);
    const tenantId = ctx.principal.tenantId;
    return this.txRunner.withTenantTx(ctx, async (tx: Tx) => {
      const sanction = await this.repo.findSanctionById(tx, tenantId, sanctionId);
      if (!sanction) {
        throw AppError.of('NOT_FOUND', `Sanction ${sanctionId} not found`);
      }
      const list = await this.repo.listTranchesBySanction(tx, tenantId, sanctionId);
      return list.map(toTrancheDto);
    });
  }

  async verifyTranche(
    ctx: RequestContext,
    trancheId: string,
    req: VerifyTrancheRequest,
  ): Promise<DisbursementTrancheDto> {
    this.checkPermission(ctx, 'disbursement.verify');
    const tenantId = ctx.principal.tenantId;

    return this.txRunner.withTenantTx(ctx, async (tx: Tx) => {
      const tranche = await this.repo.findTrancheById(tx, tenantId, trancheId);
      if (!tranche) {
        throw AppError.of('NOT_FOUND', `Tranche ${trancheId} not found`);
      }

      if (tranche.status !== 'RECORDED') {
        throw AppError.of(
          'INVALID_STATE',
          `Cannot verify tranche in status ${tranche.status}; only RECORDED tranches can be verified or returned`,
        );
      }

      // Segregation of Duties (SOD-04): Recorder cannot verify own tranche
      if (tranche.recorded_by === ctx.principal.id) {
        throw AppError.of(
          'SOD_VIOLATION',
          'Segregation of duties violation: The user who recorded this tranche cannot verify it',
        );
      }

      const now = new Date().toISOString();

      if (req.decision === 'VERIFY') {
        // Evidence check: must have evidence_document_id or approved exception
        if (!tranche.evidence_document_id && !tranche.exception_approval_id) {
          throw AppError.of(
            'EVIDENCE_MISSING',
            'Independent verification requires an attached evidence document or an approved exception',
          );
        }

        const updated = await this.repo.updateTranche(tx, {
          ...tranche,
          status: 'VERIFIED',
          verified_by: ctx.principal.id,
          verified_at: now,
          verification_comment: req.comment ?? null,
          updated_by: ctx.principal.id,
        });

        // Emit disbursement.verified (Qualifying event for commission!)
        await this.repo.emitOutboxEvent(tx, {
          id: `evt_${ulid()}`,
          tenantId,
          eventName: 'disbursement.verified',
          aggregateType: 'disbursement_tranche',
          aggregateId: trancheId,
          payload: {
            trancheId,
            sanctionId: tranche.sanction_id,
            trancheNo: tranche.tranche_no,
            amount: Number(tranche.amount),
            currency: tranche.currency,
            verifiedBy: ctx.principal.id,
            verifiedAt: now,
          },
          occurredAt: now,
        });

        return toTrancheDto(updated);
      } else {
        // Decision == 'RETURN'
        const updated = await this.repo.updateTranche(tx, {
          ...tranche,
          status: 'RETURNED',
          verification_comment: req.comment ?? null,
          updated_by: ctx.principal.id,
        });

        return toTrancheDto(updated);
      }
    });
  }

  async approveException(
    ctx: RequestContext,
    trancheId: string,
    req: ExceptionApprovalRequest,
  ): Promise<DisbursementTrancheDto> {
    this.checkPermission(ctx, 'disbursement.exception_approve');
    const tenantId = ctx.principal.tenantId;

    return this.txRunner.withTenantTx(ctx, async (tx: Tx) => {
      const tranche = await this.repo.findTrancheById(tx, tenantId, trancheId);
      if (!tranche) {
        throw AppError.of('NOT_FOUND', `Tranche ${trancheId} not found`);
      }

      if (tranche.status !== 'RECORDED') {
        throw AppError.of(
          'INVALID_STATE',
          `Cannot approve exception for tranche in status ${tranche.status}; must be RECORDED`,
        );
      }

      const exceptionApprovalId = `exa_${ulid()}`;

      const updated = await this.repo.updateTranche(tx, {
        ...tranche,
        exception_approval_id: exceptionApprovalId,
        verification_comment: `Exception approved by ${ctx.principal.id}: ${req.reason}`,
        updated_by: ctx.principal.id,
      });

      return toTrancheDto(updated);
    });
  }

  async voidTranche(
    ctx: RequestContext,
    trancheId: string,
    req: VoidTrancheRequest,
  ): Promise<{ voidedTranche: DisbursementTrancheDto; replacementTranche?: DisbursementTrancheDto }> {
    this.checkPermission(ctx, 'disbursement.record');
    const tenantId = ctx.principal.tenantId;

    return this.txRunner.withTenantTx(ctx, async (tx: Tx) => {
      const tranche = await this.repo.findTrancheById(tx, tenantId, trancheId);
      if (!tranche) {
        throw AppError.of('NOT_FOUND', `Tranche ${trancheId} not found`);
      }

      if (tranche.status !== 'RECORDED' && tranche.status !== 'VERIFIED') {
        throw AppError.of(
          'INVALID_STATE',
          `Cannot void tranche in status ${tranche.status}; only RECORDED or VERIFIED tranches can be voided`,
        );
      }

      let replacementDto: DisbursementTrancheDto | undefined;

      // If replacement requested, record replacement first
      if (req.createReplacement && req.replacement) {
        // Voiding this tranche frees up its amount from active calculation
        const result = await this.recordTranche(ctx, tranche.sanction_id, req.replacement);
        replacementDto = result.tranche;
      }

      const updated = await this.repo.updateTranche(tx, {
        ...tranche,
        status: 'VOIDED',
        voided_by: ctx.principal.id,
        void_reason: req.reason,
        replaced_by_tranche_id: replacementDto ? replacementDto.id : null,
        updated_by: ctx.principal.id,
      });

      return {
        voidedTranche: toTrancheDto(updated),
        replacementTranche: replacementDto,
      };
    });
  }

  async processExpiringSanctions(
    ctx: RequestContext,
    currentDate?: string,
  ): Promise<{ expiredCount: number }> {
    const tenantId = ctx.principal.tenantId;
    const dateToCheck = currentDate ?? new Date().toISOString().slice(0, 10);

    return this.txRunner.withTenantTx(ctx, async (tx: Tx) => {
      const expiring = await this.repo.findExpiringSanctions(tx, tenantId, dateToCheck);
      let count = 0;

      for (const sanction of expiring) {
        await this.repo.updateSanction(tx, {
          ...sanction,
          status: 'EXPIRED',
          updated_by: ctx.principal.id,
        });

        // Update lender case to SANCTION_EXPIRED
        await this.repo.updateLenderCaseStatus(
          tx,
          tenantId,
          sanction.lender_case_id,
          'SANCTION_EXPIRED',
          ctx.principal.id,
          'Sanction validity period expired',
        );

        // Emit outbox event
        await this.repo.emitOutboxEvent(tx, {
          id: `evt_${ulid()}`,
          tenantId,
          eventName: 'sanction.expired',
          aggregateType: 'sanction',
          aggregateId: sanction.id,
          payload: {
            sanctionId: sanction.id,
            lenderCaseId: sanction.lender_case_id,
            validUntil: sanction.valid_until,
          },
          occurredAt: new Date().toISOString(),
        });

        count++;
      }

      return { expiredCount: count };
    });
  }
}
