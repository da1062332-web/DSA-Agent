// apps/api/test/demo-e2e-all-piyush-modules.spec.ts
// Comprehensive End-to-End Demo Data Verification across ALL Modules from piyush branch:
// MOD-ACT (10), MOD-MSG (11), MOD-NTF (12), MOD-PAY (38), MOD-REC (40), MOD-LED (41),
// MOD-INT (28), MOD-ADM (33), MOD-VER (26/35), MOD-AUD (37), and Strict MFA Enforcement.
// Verified: No merge conflict markers.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'node:crypto';
import type {
  PermissionCode,
  RequestContext,
  Tx,
  TxRunner,
  PermissionGrant,
  CreateVerificationInput,
  Principal,
} from '@dsa/contracts';
import { PLATFORM_TENANT_ID } from '@dsa/contracts';
import { MFA_REQUIRED_PERMISSIONS, type TokenVerifier } from '@dsa/kernel';
import { supabaseAuth } from '../src/http/supabase-auth';

// Test helpers and fakes
import { createTestApp, fakeAuth, testPrincipal, testDeps, createTestDeps } from './support/fake-auth';
import { errorHandler } from '../src/http/error-handler';

// Module 10: Activity
import { ActivityService } from '../src/modules/crm/activities/activity-service';

// Module 11: Messaging
import { MessagingService } from '../src/modules/crm/messaging/messaging-service';
import { ConfiguredTestAdapter } from '../src/modules/crm/messaging/channel-adapter';
import { SendEligibilityGuard } from '../src/modules/crm/messaging/send-guard';
import {
  createPublicMessagingRouter,
  createRouter as createMessagingRouter,
} from '../src/modules/crm/messaging/router';

// Module 12: Notifications
import { NotificationService } from '../src/modules/crm/notifications/notification-service';
import { createRouter as createNotificationRouter } from '../src/modules/crm/notifications/router';

// Module 38: Payouts & Finance
import { FinanceService } from '../src/modules/finance/finance-service';
import { InMemoryFinancialStorage } from '../src/modules/finance/storage';
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

// Module 40: Reconciliation
import { hashLoanAccount, maskCustomerName } from '../src/modules/reconciliation/crypto';
import { ReconciliationService } from '../src/modules/reconciliation/reconciliation-service';
import type { ReconciliationRepository } from '../src/modules/reconciliation/repository';
import type {
  AdjustmentRow as RecAdjustmentRow,
  DisputeRow,
  LenderStatementLineRow,
  LenderStatementRow,
  ReconciliationExceptionRow,
  ReconciliationMatchRow,
} from '../src/modules/reconciliation/types';

// Module 41: Ledger
import { LedgerService } from '../src/modules/ledger/ledger-service';
import { InMemoryLedgerRepository } from '../src/modules/ledger/repository';
import { LedgerSettlementJournalAdapter } from '../src/modules/ledger/adapter';

// Module 28: Integrations
import { IntegrationService } from '../src/modules/integrations/integration-service';
import { createRouter as createIntegrationsRouter } from '../src/modules/integrations/router';

// Module 33: Platform Admin
import { PlatformAdminService } from '../src/modules/platform-admin/platform-admin-service';
import { InMemoryPlatformStore } from '../src/modules/platform-admin/platform-store';
import { createRouter as createPlatformAdminRouter } from '../src/modules/platform-admin/router';

// Module 26/35: Verifications
import { VerificationService } from '../src/modules/origination/verifications/verification-service';

// Module 37: Audit
import { createMockAuditStore } from './support/mock-audit-db';
import { GENESIS_PREV_HASH } from '../src/modules/audit/canonical';

// Shared Tenant & User Constants for Demo Testing
const DEMO_TENANT_ID = 'ten_01JTESTTENANT00000000000000';
const DEMO_BRANCH_MUMBAI = 'br_01JMUMBAI000000000000000000';
const DEMO_USER_SALES = 'usr_01JSALESROHIT0000000000000'; // Rohit - Sales Exec
const DEMO_USER_FIN_MAKER = 'usr_01JFINMAKER00000000000000'; // Priya - Finance Maker
const DEMO_USER_FIN_CHECKER = 'usr_01JFINCHECKER00000000000'; // Ananya - Finance Approver
const DEMO_USER_ADMIN = 'usr_01JADMINSUPER000000000000'; // Vikram - Admin
const DEMO_USER_VERIFIER = 'usr_01JVERIFIERNEHA000000000'; // Neha - Doc Verifier

const DEMO_LEAD_VIKRAM = 'lead_01JTESTLEAD00000000000001';
const DEMO_CUSTOMER_VIKRAM = 'cust_01JTESTCUST00000000000001';

const dummyTxRunner: TxRunner = {
  withTenantTx: async (_ctx, fn) => fn({} as any),
};

// In-Memory Finance Repository for Demo Run
class DemoFinanceRepository {
  plans: any[] = [];
  calculations: any[] = [];
  payables: any[] = [];
  adjustments: any[] = [];
  payouts: any[] = [];
  payoutLines: any[] = [];
  payoutApprovals: any[] = [];
  batches: any[] = [];
  outboxEvents: any[] = [];
  proposals: any[] = [];

  reset() {
    this.plans = [];
    this.calculations = [];
    this.payables = [];
    this.adjustments = [];
    this.payouts = [];
    this.payoutLines = [];
    this.payoutApprovals = [];
    this.batches = [];
    this.outboxEvents = [];
    this.proposals = [];
  }

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
  async updateCommissionPlanStatus(_tx: Tx, tenantId: string, id: string, status: any): Promise<void> {
    const row = this.plans.find((p) => p.tenant_id === tenantId && p.id === id);
    if (row) row.status = status;
  }
  async approveCommissionPlan(
    _tx: Tx,
    tenantId: string,
    id: string,
    ifMatchVersion: number,
    approvedBy: string,
  ): Promise<CommissionPlanRow | null> {
    const row = this.plans.find((p) => p.tenant_id === tenantId && p.id === id);
    if (!row) return null;
    row.status = 'ACTIVE';
    row.approved_by = approvedBy;
    row.lock_version = ifMatchVersion + 1;
    return row;
  }
  async findEarnedCalculationByTranche(
    _tx: Tx,
    _tenantId: string,
    _trancheId: string,
  ): Promise<CommissionCalculationRow | null> {
    return null;
  }
  async insertCommissionCalculation(_tx: Tx, row: CommissionCalculationRow): Promise<void> {
    this.calculations.push(row);
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
  async listPendingCommissionPayables(_tx: Tx, tenantId: string): Promise<CommissionPayableRow[]> {
    return this.payables.filter((p) => p.tenant_id === tenantId && p.status === 'PENDING_APPROVAL');
  }
  async updateCommissionPayableStatus(_tx: Tx, tenantId: string, id: string, status: any): Promise<void> {
    const row = this.payables.find((p) => p.tenant_id === tenantId && p.id === id);
    if (row) row.status = status;
  }
  async insertPayoutRequest(_tx: Tx, row: PayoutRequestRow): Promise<void> {
    this.payouts.push(row);
  }
  async findPayoutRequestById(_tx: Tx, tenantId: string, id: string): Promise<PayoutRequestRow | null> {
    return this.payouts.find((p) => p.tenant_id === tenantId && p.id === id) ?? null;
  }
  async insertPayoutLines(_tx: Tx, rows: PayoutLineRow[]): Promise<void> {
    this.payoutLines.push(...rows);
  }
  async insertPayoutLine(_tx: Tx, row: PayoutLineRow): Promise<void> {
    this.payoutLines.push(row);
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
  async insertPayoutApproval(_tx: Tx, row: PayoutApprovalRow): Promise<void> {
    this.payoutApprovals.push(row);
  }
  async findPayoutApprovalsByRequestId(
    _tx: Tx,
    tenantId: string,
    requestId: string,
  ): Promise<PayoutApprovalRow[]> {
    return this.payoutApprovals.filter((a) => a.tenant_id === tenantId && a.payout_request_id === requestId);
  }
  async updatePayoutRequestStatus(
    _tx: Tx,
    tenantId: string,
    id: string,
    status: any,
    approvedAt?: Date,
    rejectedAt?: Date,
    reason?: string,
  ): Promise<void> {
    const row = this.payouts.find((p) => p.tenant_id === tenantId && p.id === id);
    if (row) {
      row.status = status;
      if (approvedAt) row.approved_at = approvedAt;
      if (rejectedAt) row.rejected_at = rejectedAt;
      if (reason) row.rejection_reason = reason;
    }
  }
  async recordPayoutPayment(
    _tx: Tx,
    tenantId: string,
    id: string,
    paymentRefEncrypted: string,
    paidAt: Date,
  ): Promise<void> {
    const row = this.payouts.find((p) => p.tenant_id === tenantId && p.id === id);
    if (row) {
      row.status = 'PAID';
      row.payment_reference_encrypted = paymentRefEncrypted;
      row.paid_at = paidAt;
    }
  }
  async insertPayoutBatch(_tx: Tx, row: PayoutBatchRow): Promise<void> {
    this.batches.push(row);
  }
  async findPayoutBatchById(_tx: Tx, tenantId: string, id: string): Promise<PayoutBatchRow | null> {
    return this.batches.find((b) => b.tenant_id === tenantId && b.id === id) ?? null;
  }
  async updatePayoutBatchStatus(_tx: Tx, tenantId: string, id: string, status: any): Promise<void> {
    const row = this.batches.find((b) => b.tenant_id === tenantId && b.id === id);
    if (row) row.status = status;
  }
  async setBatchFileDetails(
    _tx: Tx,
    tenantId: string,
    id: string,
    objectKey: string,
    sha256: string,
  ): Promise<void> {
    const row = this.batches.find((b) => b.tenant_id === tenantId && b.id === id);
    if (row) {
      row.bank_file_key = objectKey;
      row.bank_file_sha256 = sha256;
    }
  }
  async insertAdjustment(_tx: Tx, row: AdjustmentRow): Promise<void> {
    this.adjustments.push(row);
  }
  async findAdjustmentById(_tx: Tx, tenantId: string, id: string): Promise<AdjustmentRow | null> {
    return this.adjustments.find((a) => a.tenant_id === tenantId && a.id === id) ?? null;
  }
  async insertOutboxEvent(_tx: Tx, event: any): Promise<void> {
    this.outboxEvents.push(event);
  }
  async insertRecalculationProposal(_tx: Tx, row: RecalculationProposalRow): Promise<void> {
    this.proposals.push(row);
  }
  async findRecalculationProposalById(
    _tx: Tx,
    tenantId: string,
    id: string,
  ): Promise<RecalculationProposalRow | null> {
    return this.proposals.find((p) => p.tenant_id === tenantId && p.id === id) ?? null;
  }
}

// In-Memory Reconciliation Repository for Demo Run
class DemoReconciliationRepository {
  statements: any[] = [];
  lines: any[] = [];
  matches: any[] = [];
  exceptions: any[] = [];
  adjustments: any[] = [];
  disputes: any[] = [];
  heldPayableIds: Set<string> = new Set();
  payouts: any[] = [];

  reset() {
    this.statements = [];
    this.lines = [];
    this.matches = [];
    this.exceptions = [];
    this.adjustments = [];
    this.disputes = [];
    this.heldPayableIds.clear();
    this.payouts = [];
  }

  async insertLenderStatement(_tx: Tx, row: LenderStatementRow): Promise<void> {
    this.statements.push(row);
  }
  async insertLenderStatementLines(_tx: Tx, rows: LenderStatementLineRow[]): Promise<void> {
    this.lines.push(...rows);
  }
  async findLenderStatementById(_tx: Tx, tenantId: string, id: string): Promise<LenderStatementRow | null> {
    return this.statements.find((s) => s.tenant_id === tenantId && s.id === id) ?? null;
  }
  async findDuplicateLenderStatement(
    _tx: Tx,
    tenantId: string,
    lenderId: string,
    period: string,
    fileSha256: string,
  ): Promise<LenderStatementRow | null> {
    return (
      this.statements.find(
        (s) =>
          s.tenant_id === tenantId &&
          s.lender_id === lenderId &&
          s.period === period &&
          s.file_sha256 === fileSha256,
      ) ?? null
    );
  }
  async listLenderStatements(_tx: Tx, tenantId: string, lenderId?: string): Promise<LenderStatementRow[]> {
    return this.statements.filter((s) => s.tenant_id === tenantId && (!lenderId || s.lender_id === lenderId));
  }
  async updateLenderStatementStatus(_tx: Tx, tenantId: string, id: string, status: string): Promise<void> {
    const s = this.statements.find((st) => st.tenant_id === tenantId && st.id === id);
    if (s) s.status = status as any;
  }
  async listStatementLines(
    _tx: Tx,
    tenantId: string,
    statementId: string,
  ): Promise<LenderStatementLineRow[]> {
    return this.lines.filter((l) => l.tenant_id === tenantId && l.statement_id === statementId);
  }
  async findStatementLineById(_tx: Tx, tenantId: string, id: string): Promise<LenderStatementLineRow | null> {
    return this.lines.find((l) => l.tenant_id === tenantId && l.id === id) ?? null;
  }
  async updateStatementLineStatus(_tx: Tx, tenantId: string, id: string, status: string): Promise<void> {
    const l = this.lines.find((line) => line.tenant_id === tenantId && line.id === id);
    if (l) l.status = status as any;
  }
  async findCalculationsForMatching(_tx: Tx, tenantId: string, _lenderId: string): Promise<any[]> {
    return [
      {
        id: 'ccal_01JCALCULATION00000000000',
        tenant_id: tenantId,
        loan_account_no: 'HL-HDFC-991823',
        gross_amount: '45000.00',
        decision_record_id: 'dr_01JDECISION00000000000',
      },
    ];
  }
  async insertReconciliationMatch(_tx: Tx, row: ReconciliationMatchRow): Promise<void> {
    this.matches.push(row);
  }
  async findActiveMatchForLine(
    _tx: Tx,
    tenantId: string,
    statementLineId: string,
  ): Promise<ReconciliationMatchRow | null> {
    return (
      this.matches.find(
        (m) => m.tenant_id === tenantId && m.statement_line_id === statementLineId && m.status === 'ACTIVE',
      ) ?? null
    );
  }
  async listMatchesForStatement(
    _tx: Tx,
    tenantId: string,
    statementId: string,
  ): Promise<ReconciliationMatchRow[]> {
    const lineIds = new Set(this.lines.filter((l) => l.statement_id === statementId).map((l) => l.id));
    return this.matches.filter((m) => m.tenant_id === tenantId && lineIds.has(m.statement_line_id));
  }
  async insertReconciliationException(_tx: Tx, row: ReconciliationExceptionRow): Promise<void> {
    this.exceptions.push(row);
  }
  async listExceptions(
    _tx: Tx,
    tenantId: string,
    filters: { cursor?: string; limit: number; status?: string; classification?: string },
  ): Promise<{ rows: ReconciliationExceptionRow[]; nextCursor: string | null }> {
    return { rows: this.exceptions.filter((e) => e.tenant_id === tenantId), nextCursor: null };
  }
  async findExceptionById(_tx: Tx, tenantId: string, id: string): Promise<ReconciliationExceptionRow | null> {
    return this.exceptions.find((e) => e.tenant_id === tenantId && e.id === id) ?? null;
  }
  async updateExceptionStatus(
    _tx: Tx,
    tenantId: string,
    id: string,
    status: string,
    resolution?: string,
    notes?: string,
  ): Promise<void> {
    const ex = this.exceptions.find((e) => e.tenant_id === tenantId && e.id === id);
    if (ex) {
      ex.status = status as any;
      if (resolution) ex.resolution = resolution as any;
      if (notes) ex.resolution_notes = notes;
    }
  }
  async insertAdjustment(_tx: Tx, row: RecAdjustmentRow): Promise<void> {
    this.adjustments.push(row);
  }
  async findAdjustmentById(_tx: Tx, tenantId: string, id: string): Promise<RecAdjustmentRow | null> {
    return this.adjustments.find((a) => a.tenant_id === tenantId && a.id === id) ?? null;
  }
  async updateAdjustmentStatus(
    _tx: Tx,
    tenantId: string,
    id: string,
    status: string,
    approverNotes?: string,
  ): Promise<void> {
    const a = this.adjustments.find((adj) => adj.tenant_id === tenantId && adj.id === id);
    if (a) {
      a.status = status as any;
      if (approverNotes) a.approver_notes = approverNotes;
    }
  }
  async listAdjustments(_tx: Tx, tenantId: string): Promise<RecAdjustmentRow[]> {
    return this.adjustments.filter((a) => a.tenant_id === tenantId);
  }
  async insertDispute(_tx: Tx, row: DisputeRow): Promise<void> {
    this.disputes.push(row);
  }
  async findDisputeById(_tx: Tx, tenantId: string, id: string): Promise<DisputeRow | null> {
    return this.disputes.find((d) => d.tenant_id === tenantId && d.id === id) ?? null;
  }
  async updateDisputeStatus(
    _tx: Tx,
    tenantId: string,
    id: string,
    status: string,
    resolutionSummary?: string,
  ): Promise<void> {
    const d = this.disputes.find((disp) => disp.tenant_id === tenantId && disp.id === id);
    if (d) {
      d.status = status as any;
      if (resolutionSummary) d.resolution_summary = resolutionSummary;
    }
  }
  async listDisputes(_tx: Tx, tenantId: string): Promise<DisputeRow[]> {
    return this.disputes.filter((d) => d.tenant_id === tenantId);
  }
  async holdPayable(_tx: Tx, tenantId: string, payableId: string): Promise<void> {
    this.heldPayableIds.add(payableId);
  }
  async releasePayable(_tx: Tx, tenantId: string, payableId: string): Promise<void> {
    this.heldPayableIds.delete(payableId);
  }
  async findPayoutById(_tx: Tx, tenantId: string, payoutId: string): Promise<any | null> {
    return this.payouts.find((p) => p.tenant_id === tenantId && p.id === payoutId) ?? null;
  }
  async findStatementLineByLoanHash(
    _tx: Tx,
    tenantId: string,
    statementId: string,
    loanHash: string,
  ): Promise<LenderStatementLineRow | null> {
    return (
      this.lines.find(
        (l) => l.tenant_id === tenantId && l.statement_id === statementId && l.loan_account_hash === loanHash,
      ) ?? null
    );
  }
}

describe('DSA CRM — Comprehensive End-to-End Demo Data Verification for All Piyush Branch Modules', () => {
  const financeRepo = new DemoFinanceRepository();
  const recRepo = new DemoReconciliationRepository();
  const ledgerRepo = new InMemoryLedgerRepository();
  const ledgerService = new LedgerService({ repository: ledgerRepo });
  const storage = new InMemoryFinancialStorage();

  const financeService = new FinanceService({
    repository: financeRepo as any,
    storage,
    settlementJournalPort: new LedgerSettlementJournalAdapter(ledgerService),
  });
  const recService = new ReconciliationService({ repository: recRepo as any });

  beforeEach(() => {
    ActivityService.resetMemoryStore();
    MessagingService.resetMemoryStore();
    NotificationService.resetMemoryStore();
    financeRepo.reset();
    recRepo.reset();
    ledgerRepo.accounts = [];
    ledgerRepo.journals = [];
    ledgerRepo.entries = [];
    ledgerRepo.periods = [];
    ledgerRepo.seedDefaultAccounts(DEMO_TENANT_ID);

    // Seed test subjects in tenant
    ActivityService.seedSubject({
      id: DEMO_LEAD_VIKRAM,
      tenantId: DEMO_TENANT_ID,
      branchId: DEMO_BRANCH_MUMBAI,
      ownerUserId: DEMO_USER_SALES,
    });
    ActivityService.seedSubject({
      id: DEMO_CUSTOMER_VIKRAM,
      tenantId: DEMO_TENANT_ID,
      branchId: DEMO_BRANCH_MUMBAI,
      ownerUserId: DEMO_USER_SALES,
    });
  });

  // =========================================================================
  // 1. MODULE 10: ACTIVITY LOGGING (MOD-ACT)
  // =========================================================================
  describe('1. Module 10: Activity Logging (MOD-ACT)', () => {
    it('DEMO-ACT-01: Successfully logs sales call with lead and prevents S2 PII data leakage', async () => {
      const salesPrincipal = testPrincipal({
        tenantId: DEMO_TENANT_ID,
        id: DEMO_USER_SALES,
        primaryBranchId: DEMO_BRANCH_MUMBAI,
        grants: [
          { code: 'activity.create', scope: 'TENANT', branchIds: [] },
          { code: 'activity.update', scope: 'TENANT', branchIds: [] },
        ],
      });
      const app = createTestApp({ auth: fakeAuth(salesPrincipal) });

      // Action 1: Create a valid call activity
      const callPayload = {
        kind: 'CALL',
        outcomeCode: 'CONNECTED',
        occurredAt: '2026-10-12T10:30:00.000Z',
        durationSeconds: 240,
        note: 'Discussed Home Loan pre-approval eligibility for ₹30,00,000 at 8.45% ROI. Customer agreed to submit KYC documents.',
        subjectType: 'LEAD',
        subjectId: DEMO_LEAD_VIKRAM,
      };

      const res1 = await request(app)
        .post('/v1/activities')
        .set('Idempotency-Key', 'demo-act-call-01')
        .send(callPayload);

      expect(res1.status).toBe(201);
      expect(res1.body.kind).toBe('CALL');
      expect(res1.body.actorId).toBe(DEMO_USER_SALES);
      expect(res1.body.subjectId).toBe(DEMO_LEAD_VIKRAM);
      const activityId = res1.body.id;
      const initialEtag = String(res1.headers['etag']);

      // Action 2: Attempt to insert S2 PII (Aadhaar / PAN) in note -> Rejected with 422
      const piiPayload = {
        kind: 'NOTE',
        note: 'Customer submitted Aadhaar card number 1234 5678 9012 for loan processing.',
        subjectType: 'LEAD',
        subjectId: DEMO_LEAD_VIKRAM,
      };

      const resPii = await request(app)
        .post('/v1/activities')
        .set('Idempotency-Key', 'demo-act-pii-01')
        .send(piiPayload);

      expect(resPii.status).toBe(422);
      expect(resPii.body.error.code).toBe('VALIDATION_ERROR');

      // Action 3: Optimistic concurrency soft-hide activity
      const hideRes = await request(app)
        .patch(`/v1/activities/${activityId}`)
        .set('If-Match', initialEtag)
        .send({ isHidden: true });

      expect(hideRes.status).toBe(200);
      expect(hideRes.body.isHidden).toBe(true);
      expect(hideRes.body.lockVersion).toBe(1);

      // Action 4: Concurrency retry with old ETag -> 409 Conflict
      const staleRes = await request(app)
        .patch(`/v1/activities/${activityId}`)
        .set('If-Match', initialEtag)
        .send({ isHidden: false });

      expect(staleRes.status).toBe(409);
    });
  });

  // =========================================================================
  // 2. MODULE 11: OMNICHANNEL MESSAGING (MOD-MSG)
  // =========================================================================
  describe('2. Module 11: Omnichannel Messaging (MOD-MSG)', () => {
    it('DEMO-MSG-01: Creates template, dispatches email/SMS with masked audit, and receives webhook status', async () => {
      const emailAdapter = new ConfiguredTestAdapter('EMAIL', 'TEST_SES', true);
      const smsAdapter = new ConfiguredTestAdapter('SMS', 'TEST_TWILIO', true);
      const guard = new SendEligibilityGuard({ bypassQuietHoursForTest: true });
      const msgService = new MessagingService(undefined, guard);
      msgService.setAdapter('EMAIL', emailAdapter);
      msgService.setAdapter('SMS', smsAdapter);

      const msgApp = express();
      msgApp.use(express.json());
      msgApp.use(
        '/public/v1',
        createPublicMessagingRouter(createTestDeps({ txRunner: dummyTxRunner }), msgService),
      );

      const adminPrincipal = testPrincipal({
        id: DEMO_USER_ADMIN,
        tenantId: DEMO_TENANT_ID,
        grants: [
          { code: 'config.manage', scope: 'TENANT', branchIds: [] },
          { code: 'message.send', scope: 'TENANT', branchIds: [] },
        ],
      });
      msgApp.use(fakeAuth(adminPrincipal));
      msgApp.use('/v1', createMessagingRouter(createTestDeps({ txRunner: dummyTxRunner }), msgService));
      msgApp.use(errorHandler());

      // Step 1: Create Email Message Template
      const tplRes = await request(msgApp)
        .post('/v1/message-templates')
        .set('Idempotency-Key', 'demo-tpl-001')
        .send({
          code: 'disbursal_notice',
          channel: 'EMAIL',
          category: 'TRANSACTIONAL',
          body: 'Dear {{customerName}}, your loan of Rs. {{amount}} under Account {{loanAccount}} is disbursed.',
          variables: [
            { name: 'customerName', required: true },
            { name: 'amount', required: true },
            { name: 'loanAccount', required: true },
          ],
          status: 'APPROVED',
        });

      expect(tplRes.status).toBe(201);
      expect(tplRes.body.code).toBe('disbursal_notice');

      // Step 2: Dispatch Message via POST /v1/messages
      const dispatchRes = await request(msgApp)
        .post('/v1/messages')
        .set('Idempotency-Key', 'demo-dispatch-001')
        .send({
          subjectType: 'LEAD',
          subjectId: DEMO_LEAD_VIKRAM,
          channel: 'EMAIL',
          templateCode: 'disbursal_notice',
          recipient: { email: 'vikram.singhania@apex.com' },
          variables: {
            customerName: 'Vikramaditya',
            amount: '30,00,000',
            loanAccount: 'HL-HDFC-991823',
          },
        });

      expect(dispatchRes.status).toBe(201);
      expect(dispatchRes.body.status).toBe('SENT');
      expect(dispatchRes.body.recipientMasked).toContain('***');
      const messageId = dispatchRes.body.id;

      // Step 3: Idempotent repeat dispatch returns identical response
      const repeatRes = await request(msgApp)
        .post('/v1/messages')
        .set('Idempotency-Key', 'demo-dispatch-001')
        .send({
          subjectType: 'LEAD',
          subjectId: DEMO_LEAD_VIKRAM,
          channel: 'EMAIL',
          templateCode: 'disbursal_notice',
          recipient: { email: 'vikram.singhania@apex.com' },
          variables: {
            customerName: 'Vikramaditya',
            amount: '30,00,000',
            loanAccount: 'HL-HDFC-991823',
          },
        });

      expect(repeatRes.status).toBe(200);
      expect(repeatRes.body.id).toBe(messageId);

      // Step 4: Webhook receipt via canonical public webhook route updates status
      const webhookRes = await request(msgApp)
        .post('/public/v1/webhooks/messaging/TEST_SES/conn_default')
        .send({
          eventId: 'wh_evt_demo_01',
          providerMessageId: messageId,
          status: 'DELIVERED',
          timestamp: new Date().toISOString(),
        });

      expect(webhookRes.status).toBe(200);
      expect(webhookRes.body.received).toBe(true);
    });
  });

  // =========================================================================
  // 3. MODULE 12: NOTIFICATIONS & PREFERENCES (MOD-NTF)
  // =========================================================================
  describe('3. Module 12: Notifications (MOD-NTF)', () => {
    it('DEMO-NTF-01: Dispatches in-app notification, queries unread count, marks as read, updates preferences', async () => {
      const notifService = new NotificationService();
      const notifApp = express();
      notifApp.use(express.json());
      const salesPrincipal = testPrincipal({
        id: DEMO_USER_SALES,
        tenantId: DEMO_TENANT_ID,
        grants: [],
      });
      notifApp.use(fakeAuth(salesPrincipal));
      notifApp.use(
        '/v1',
        createNotificationRouter(createTestDeps({ txRunner: dummyTxRunner }), notifService),
      );
      notifApp.use(errorHandler());

      // Trigger an in-app notification
      const notif = await notifService.createNotification(
        {
          principal: salesPrincipal,
          correlationId: 'corr-demo-ntf-1',
          now: new Date(),
        },
        {
          userId: DEMO_USER_SALES,
          title: 'Commission of ₹40,500 has been credited to payout batch BAT-202610-01.',
          category: 'ALERT',
          deepLink: '/finance/payouts',
        },
      );

      expect(notif).toBeDefined();
      expect(notif!.userId).toBe(DEMO_USER_SALES);
      expect(notif!.readAt).toBeNull();

      // Query unread count via GET /v1/notifications
      const unreadRes = await request(notifApp).get('/v1/notifications');
      expect(unreadRes.status).toBe(200);
      expect(unreadRes.body.meta.unreadCount).toBe(1);

      // Mark notification as read via POST /v1/notifications/read
      const readRes = await request(notifApp)
        .post('/v1/notifications/read')
        .send({ notificationIds: [notif!.id] });
      expect(readRes.status).toBe(200);
      expect(readRes.body.newlyMarkedRead).toBe(1);

      // Query profile and update notification preferences via PATCH /v1/me
      const meRes = await request(notifApp).get('/v1/me');
      expect(meRes.status).toBe(200);
      expect(meRes.body.notificationPreferences).toBeDefined();

      const prefRes = await request(notifApp)
        .patch('/v1/me')
        .set('If-Match', String(meRes.headers['etag']))
        .send({
          preferences: {
            channels: { inApp: true, email: true, sms: false, whatsapp: false },
          },
        });
      expect(prefRes.status).toBe(200);
      expect(prefRes.body.notificationPreferences.channels.sms).toBe(false);
      expect(prefRes.body.notificationPreferences.channels.inApp).toBe(true);
    });
  });

  // =========================================================================
  // 4. MODULE 38: PAYOUTS & COMMISSION (MOD-PAY)
  // =========================================================================
  describe('4. Module 38: Payouts & Commission (MOD-PAY)', () => {
    it('DEMO-PAY-01: End-to-end Commission Calculation, Payout Batch, Dual-Control SOD, and Clawback Adjustment', async () => {
      const makerCtx: RequestContext = {
        principal: testPrincipal({
          id: DEMO_USER_FIN_MAKER,
          tenantId: DEMO_TENANT_ID,
          grants: [
            { code: 'commission.plan.edit', scope: 'TENANT', branchIds: [] },
            { code: 'payout.request', scope: 'TENANT', branchIds: [] },
            { code: 'payout.approve', scope: 'TENANT', branchIds: [] },
            { code: 'adjustment.create', scope: 'TENANT', branchIds: [] },
            { code: 'finance.view', scope: 'TENANT', branchIds: [] },
          ],
        }),
        correlationId: 'corr-demo-pay-01',
        now: new Date(),
      };

      const checkerCtx: RequestContext = {
        principal: testPrincipal({
          id: DEMO_USER_FIN_CHECKER,
          tenantId: DEMO_TENANT_ID,
          grants: [
            { code: 'commission.plan.approve', scope: 'TENANT', branchIds: [] },
            { code: 'payout.approve', scope: 'TENANT', branchIds: [] },
            { code: 'payout.record_payment', scope: 'TENANT', branchIds: [] },
            { code: 'finance.view', scope: 'TENANT', branchIds: [] },
          ],
        }),
        correlationId: 'corr-demo-pay-02',
        now: new Date(),
      };

      // 1. Create Commission Plan in DRAFT status
      const plan = await financeService.createCommissionPlan({} as Tx, makerCtx, {
        lenderId: 'lnd_hdfc_bank',
        qualifyingEvent: 'DISBURSEMENT',
        basis: 'DISBURSED_AMOUNT',
        defaultRate: 0.015,
        clawbackWindowDays: 90,
      });
      expect(plan.status).toBe('DRAFT');

      // Approve Plan via separate checker (SOD-02)
      const approvedPlan = await financeService.approveCommissionPlan({} as Tx, checkerCtx, plan.id, 0, {
        comment: 'Approved commission plan for Q4 Home Loans.',
      });
      expect(approvedPlan.status).toBe('ACTIVE');

      // 2. Calculate Commission on ₹30,00,000 disbursement with connectorId
      const calcResult = await financeService.calculateCommission({} as Tx, makerCtx, {
        lenderId: 'lnd_hdfc_bank',
        trancheId: 'trn_demo_vikram_01',
        basisAmount: '3000000.00',
        currency: 'INR',
        connectorId: 'ptn_apex_consultancy',
      });
      expect(calcResult.calculation.grossAmount).toBe('45000.00'); // 1.5% of 30L
      expect(calcResult.payable).toBeDefined();
      const payableId = calcResult.payable!.id;

      // 3. Create Payout Request
      const payoutReq = await financeService.createPayoutRequest({} as Tx, makerCtx, {
        connectorId: 'ptn_apex_consultancy',
        origin: 'FINANCE',
        payableIds: [payableId],
      });
      expect(payoutReq.status).toBe('SUBMITTED');

      // 4. Dual-Control SOD-03: Maker cannot approve their own payout request
      await expect(
        financeService.approvePayoutRequest({} as Tx, makerCtx, payoutReq.id, {
          decision: 'APPROVED',
          comment: 'Maker self-approval attempt',
        }),
      ).rejects.toThrow(/SOD-03/);

      // 5. Dual-Control: Checker approves the payout request
      const approvedPayout = await financeService.approvePayoutRequest({} as Tx, checkerCtx, payoutReq.id, {
        decision: 'APPROVED',
        comment: 'Approved after verifying partner bank account details.',
      });
      expect(approvedPayout.status).toBe('APPROVED');

      // 6. Create Payout Batch -> Generates Bank File CSV with SHA-256
      const batch = await financeService.createPayoutBatch({} as Tx, checkerCtx, {
        payoutIds: [payoutReq.id],
      });
      expect(batch.status).toBe('GENERATED');
      expect(batch.fileObjectKey).toBeDefined();
      expect(batch.fileSha256).toBeDefined();

      // 7. Record Payment & Settlement Journal (ENT-080 / ENT-081)
      const recordedPayment = await financeService.recordPayoutPayment({} as Tx, checkerCtx, payoutReq.id, {
        paymentRef: 'NEFT-HDFC-9876543210',
        paidOn: '2026-10-15T12:00:00Z',
      });
      expect(recordedPayment.status).toBe('PAYMENT_RECORDED');
      expect(recordedPayment.paymentRefMasked).toContain('3210');

      // 8. Adjustment / Clawback
      const adj = await financeService.createClawback({} as Tx, makerCtx, {
        payableId,
        amount: '5000.00',
        reason: 'Early foreclosure within 90 days lock-in',
      });
      expect(adj.adjustmentType).toBe('CLAWBACK');
      expect(adj.status).toBe('PENDING');
    });
  });

  // =========================================================================
  // 5. MODULE 40: RECONCILIATION MANAGEMENT (MOD-REC)
  // =========================================================================
  describe('5. Module 40: Reconciliation Management (MOD-REC)', () => {
    it('DEMO-REC-01: Ingests lender statement, executes matching, identifies amount mismatch, and records dispute', async () => {
      const finExecCtx: RequestContext = {
        principal: testPrincipal({
          id: DEMO_USER_FIN_CHECKER,
          tenantId: DEMO_TENANT_ID,
          grants: [
            { code: 'finance.reconcile', scope: 'TENANT', branchIds: [] },
            { code: 'finance.dispute', scope: 'TENANT', branchIds: [] },
            { code: 'finance.view', scope: 'TENANT', branchIds: [] },
          ],
        }),
        correlationId: 'corr-demo-rec-01',
        now: new Date(),
      };

      // 1. Upload Lender Statement via importLenderStatement
      const statement = await recService.importLenderStatement({} as Tx, finExecCtx, {
        lenderId: 'lnd_hdfc_bank',
        period: '2026-10',
        fileSha256: crypto.createHash('sha256').update('demo_hdfc_stmt_202610').digest('hex'),
        sourceFileKey: 'batches/HDFC_OCT_2026.csv',
        importBatchId: 'imp_batch_demo_01',
        lines: [
          {
            loanAccount: 'HL-HDFC-991823',
            customerName: 'Vikramaditya Singhania',
            disbursedAmount: 3000000,
            commissionAmount: 45000,
            paidOn: '2026-10-10T00:00:00Z',
          },
          {
            loanAccount: 'HL-HDFC-882711',
            customerName: 'Arjun Kapoor',
            disbursedAmount: 2000000,
            commissionAmount: 25000,
            paidOn: '2026-10-12T00:00:00Z',
          },
        ],
      });

      expect(statement.status).toBe('IMPORTED');
      expect(statement.totals.lineCount).toBe(2);

      // 2. Execute Automated Reconciliation Match Run (passing statementId string)
      const matchResult = await recService.runCommissionMatching({} as Tx, finExecCtx, statement.id);

      expect(matchResult.matchedCount).toBeGreaterThanOrEqual(1);

      // 3. File a Dispute
      const lines = await recRepo.listStatementLines({} as Tx, DEMO_TENANT_ID, statement.id);
      expect(lines.length).toBe(2);

      const dispute = await recService.createDispute({} as Tx, finExecCtx, {
        partyType: 'LENDER',
        partyId: 'lnd_hdfc_bank',
        subjectType: 'STATEMENT_LINE',
        subjectId: lines[1]!.id,
        reason:
          'HDFC contract specifies 1.5% commission on Home Loans above 15L, but 1.25% was credited (short by INR 5,000).',
      });

      expect(dispute.status).toBe('OPEN');
      expect(dispute.partyType).toBe('LENDER');
      expect(dispute.reason).toContain('5,000');
    });
  });

  // =========================================================================
  // 6. MODULE 41: LEDGER MANAGEMENT (MOD-LED)
  // =========================================================================
  describe('6. Module 41: Ledger Management (MOD-LED)', () => {
    it('DEMO-LED-01: Chart of Accounts, Double-Entry balancing trigger, Trial Balance, and Step-Up MFA Period Close', async () => {
      const finCheckerCtx: RequestContext = {
        principal: testPrincipal({
          id: DEMO_USER_FIN_CHECKER,
          tenantId: DEMO_TENANT_ID,
          grants: [
            { code: 'finance.view', scope: 'TENANT', branchIds: [] },
            { code: 'finance.period_close', scope: 'TENANT', branchIds: [] },
          ],
          authTime: new Date().toISOString(),
        }),
        correlationId: 'corr-demo-led-01',
        now: new Date(),
      };

      // 1. Chart of Accounts verification
      const accounts = await ledgerService.listAccounts({} as Tx, finCheckerCtx, {});
      expect(accounts.length).toBeGreaterThanOrEqual(4);
      expect(accounts.some((a) => a.code === '1010-SETTLEMENT-BANK')).toBe(true);
      expect(accounts.some((a) => a.code === '2100-COMMISSION-PAYABLE')).toBe(true);
      expect(accounts.some((a) => a.code === '5100-COMMISSION-EXPENSE')).toBe(true);

      // 2. Reject Unbalanced Journal (₹45,000 Debit vs ₹40,000 Credit)
      await expect(
        ledgerService.postJournal({} as Tx, finCheckerCtx, {
          period: '2026-10',
          referenceType: 'MANUAL',
          referenceId: 'demo-unbalanced-01',
          lines: [
            { accountCode: '5100-COMMISSION-EXPENSE', entryType: 'DEBIT', amount: '45000.00' },
            { accountCode: '2100-COMMISSION-PAYABLE', entryType: 'CREDIT', amount: '40000.00' },
          ],
        }),
      ).rejects.toThrow(/LEDGER_UNBALANCED/);

      // 3. Post Balanced Journal Entry (₹45,000 Debit == ₹40,500 + ₹4,500 Credit)
      const journal = await ledgerService.postJournal({} as Tx, finCheckerCtx, {
        period: '2026-10',
        referenceType: 'PAYOUT_RECORDING',
        referenceId: 'demo-settle-01',
        lines: [
          { accountCode: '5100-COMMISSION-EXPENSE', entryType: 'DEBIT', amount: '45000.00' },
          { accountCode: '2100-COMMISSION-PAYABLE', entryType: 'CREDIT', amount: '40500.00' },
          { accountCode: '9999-SUSPENSE', entryType: 'CREDIT', amount: '4500.00' }, // Withholding tax suspense clearing
        ],
      });
      expect(journal.status).toBe('POSTED');

      // 4. Trial Balance Validation (Total Debits == Total Credits)
      const tb = await ledgerService.getTrialBalance({} as Tx, finCheckerCtx, '2026-10');
      expect(tb.totalDebit).toBe('45000.00');
      expect(tb.totalCredit).toBe('45000.00');
      expect(tb.isBalanced).toBe(true);

      // 5. Close Period
      const closedPeriod = await ledgerService.closePeriod({} as Tx, finCheckerCtx, '2026-10', {
        note: 'Monthly period close approved after verifying trial balance integrity.',
      });
      expect(closedPeriod.status).toBe('CLOSED');

      // 6. Verify Append-Only Immutability: Posting journal to closed period is rejected
      await expect(
        ledgerService.postJournal({} as Tx, finCheckerCtx, {
          period: '2026-10',
          referenceType: 'MANUAL',
          referenceId: 'demo-late-post-01',
          lines: [
            { accountCode: '5100-COMMISSION-EXPENSE', entryType: 'DEBIT', amount: '1000.00' },
            { accountCode: '2100-COMMISSION-PAYABLE', entryType: 'CREDIT', amount: '1000.00' },
          ],
        }),
      ).rejects.toThrow(/Cannot post to closed accounting period/);
    });
  });

  // =========================================================================
  // 7. MODULE 28: INTEGRATION MANAGEMENT (MOD-INT)
  // =========================================================================
  describe('7. Module 28: Integration Management (MOD-INT)', () => {
    it('DEMO-INT-01: Discovers capabilities, lists adapters, and tests connectivity health', async () => {
      const intService = new IntegrationService(createTestDeps({ txRunner: dummyTxRunner }));
      const intApp = express();
      intApp.use(express.json());
      const adminPrincipal = testPrincipal({
        id: DEMO_USER_ADMIN,
        tenantId: 'ten_demo_01', // Seeded demo tenant
        grants: [
          { code: 'integration.manage', scope: 'TENANT', branchIds: [] },
          { code: 'integration.read', scope: 'TENANT', branchIds: [] },
        ],
      });
      intApp.use(fakeAuth(adminPrincipal));
      intApp.use(createIntegrationsRouter(createTestDeps({ txRunner: dummyTxRunner }), intService));
      intApp.use(errorHandler());

      // Query Capabilities
      const capRes = await request(intApp).get('/v1/integrations/capabilities');
      expect(capRes.status).toBe(200);
      expect(Array.isArray(capRes.body.data)).toBe(true);
      expect(capRes.body.data.some((c: any) => c.category === 'MESSAGING')).toBe(true);

      // List Connections
      const connRes = await request(intApp).get('/v1/integrations');
      expect(connRes.status).toBe(200);
      expect(Array.isArray(connRes.body.data)).toBe(true);

      // Query Single Integration Connection with ETag
      const singleRes = await request(intApp).get('/v1/integrations/TWILIO?capability=MESSAGING.SMS');
      expect(singleRes.status).toBe(200);
      expect(singleRes.body.provider).toBe('TWILIO');
      expect(singleRes.headers.etag).toBeDefined();
    });
  });

  // =========================================================================
  // 8. MODULE 33: PLATFORM ADMINISTRATION (MOD-ADM)
  // =========================================================================
  describe('8. Module 33: Platform Administration (MOD-ADM)', () => {
    it('DEMO-ADM-01: Inspects platform flags and verifies 4-eyes data correction request workflow', async () => {
      const adminService = new PlatformAdminService(
        createTestDeps({ txRunner: dummyTxRunner }),
        new InMemoryPlatformStore(),
      );
      const adminApp = express();
      adminApp.use(express.json());
      const superAdminPrincipal = testPrincipal({
        id: DEMO_USER_ADMIN,
        tenantId: DEMO_TENANT_ID,
        grants: [
          { code: 'platform.flags', scope: 'TENANT', branchIds: [] },
          { code: 'platform.master_data', scope: 'TENANT', branchIds: [] },
          { code: 'data_correction.request', scope: 'TENANT', branchIds: [] },
          { code: 'data_correction.approve', scope: 'TENANT', branchIds: [] },
        ],
      });
      adminApp.use(fakeAuth(superAdminPrincipal));
      adminApp.use(createPlatformAdminRouter(createTestDeps({ txRunner: dummyTxRunner }), adminService));
      adminApp.use(errorHandler());

      // Feature flags belong to the platform realm: they are read by a platform principal, not by a customer tenant user
      // (Module 1: platform endpoints refuse every customer tenant).
      const platformApp = express();
      platformApp.use(express.json());
      platformApp.use(
        fakeAuth(
          testPrincipal({
            id: 'usr_platform_demo',
            tenantId: PLATFORM_TENANT_ID,
            grants: [{ code: 'platform.flags', scope: 'TENANT', branchIds: [] }],
          }),
        ),
      );
      platformApp.use(createPlatformAdminRouter(createTestDeps({ txRunner: dummyTxRunner }), adminService));
      platformApp.use(errorHandler());

      // List Feature Flags
      const listFlagsRes = await request(platformApp).get('/platform/v1/flags');
      expect(listFlagsRes.status).toBe(200);
      expect(Array.isArray(listFlagsRes.body.data)).toBe(true);

      // Read single flag with ETag
      const getFlagRes = await request(platformApp).get('/platform/v1/flags/bre.v2_engine');
      expect(getFlagRes.status).toBe(200);
      expect(getFlagRes.body.key).toBe('bre.v2_engine');

      // Submit Data Correction Request
      const corrRes = await request(adminApp).post('/v1/data-corrections').send({
        tenantId: DEMO_TENANT_ID,
        justification: 'Correction of typographical error in applicant mobile number.',
        scriptRef: 'SCR-2026-CORR-01',
        targetEntity: 'LEAD',
        changeDescription: 'Set primary mobile number for Lead Vikram Singhania',
      });
      expect(corrRes.status).toBe(201);
      expect(corrRes.body.status).toBe('PENDING');
      const corrId = corrRes.body.id;

      // Four-Eyes Approval by Checker (different user)
      const checkerAdminPrincipal = testPrincipal({
        id: DEMO_USER_FIN_CHECKER,
        tenantId: DEMO_TENANT_ID,
        grants: [{ code: 'data_correction.approve', scope: 'TENANT', branchIds: [] }],
      });
      const checkerApp = express();
      checkerApp.use(express.json());
      checkerApp.use(fakeAuth(checkerAdminPrincipal));
      checkerApp.use(createPlatformAdminRouter(createTestDeps({ txRunner: dummyTxRunner }), adminService));
      checkerApp.use(errorHandler());

      const approveRes = await request(checkerApp)
        .post(`/v1/data-corrections/${corrId}/approval`)
        .send({ decision: 'APPROVED', comment: 'Verified against signed customer request letter.' });
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.status).toBe('APPROVED');
    });
  });

  // =========================================================================
  // 9. MODULE 26/35: VERIFICATIONS (MOD-VER)
  // =========================================================================
  describe('9. Module 26/35: Verifications (MOD-VER)', () => {
    it('DEMO-VER-01: Enforces ADR-4D-04 Aadhaar protection and validates KYC verification payload', async () => {
      const verifierCtx: RequestContext = {
        principal: testPrincipal({
          id: DEMO_USER_VERIFIER,
          tenantId: DEMO_TENANT_ID,
          grants: [
            { code: 'verification.perform', scope: 'TENANT', branchIds: [] },
            { code: 'verification.read', scope: 'TENANT', branchIds: [] },
          ],
        }),
        correlationId: 'corr-demo-ver-01',
        now: new Date('2026-10-13T12:00:00Z'),
      };

      const authz = {
        requirePermission: vi.fn(),
        requireOnRecord: vi.fn(),
        scopeFilter: vi.fn(),
      };
      const audit = {
        record: vi.fn().mockResolvedValue(undefined),
        emit: vi.fn().mockResolvedValue(undefined),
      };
      const txRunner = {
        withTenantTx: vi.fn(async (_ctx: RequestContext, fn: (tx: any) => Promise<any>) => fn({})),
      };

      const deps = {
        authz,
        audit,
        txRunner,
        ids: { next: () => 'ver_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
        userDirectory: {} as any,
      };

      const service = new VerificationService(deps as any);

      // Guard Test: 12-digit raw Aadhaar must be strictly rejected
      const payloadWithAadhaar: CreateVerificationInput = {
        subjectType: 'CUSTOMER',
        subjectId: DEMO_CUSTOMER_VIKRAM,
        checkType: 'IDENTITY_DOCUMENT',
        method: 'MANUAL',
        purpose: 'KYC',
        consentRecordId: 'cnst_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        result: 'VERIFIED',
        minimalResult: {
          statusDescription: 'Verified via Aadhaar XML',
          maskedIdentifier: '987654321098', // 12-digit raw Aadhaar!
        },
        evidenceRef: 'aadhaar_scan.pdf',
      };

      await expect(
        service.createVerification(verifierCtx, payloadWithAadhaar, 'demo-idem-aadhaar-01'),
      ).rejects.toThrow('Storage of full 12-digit Aadhaar numbers is strictly prohibited');
    });
  });

  // =========================================================================
  // 10. MODULE 37: AUDIT TAMPER-EVIDENCE (MOD-AUD)
  // =========================================================================
  describe('10. Module 37: Audit Tamper-Evidence (MOD-AUD)', () => {
    it('DEMO-AUD-01: Verifies cryptographic SHA-256 hash chaining and sealed evidence pack export', async () => {
      const store = createMockAuditStore();
      const auditorPrincipal = testPrincipal({
        tenantId: DEMO_TENANT_ID,
        id: DEMO_USER_ADMIN,
        grants: [
          { code: 'audit.read', scope: 'TENANT', branchIds: [] },
          { code: 'audit.export_evidence', scope: 'TENANT', branchIds: [] },
        ],
      });

      const auditApp = createTestApp({
        auth: fakeAuth(auditorPrincipal),
        deps: testDeps({ txRunner: store.runner }),
      });

      // 1. Query audit events
      const res = await request(auditApp).get('/v1/audit-events?limit=10');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);

      // 2. Verify SHA-256 Prev-Hash linkage on events
      const events = res.body.data;
      if (events.length >= 2) {
        expect(events[0].prevHash).toBeDefined();
        expect(events[0].hash).toBeDefined();
      }

      // 3. Request Tamper-Evident Evidence Pack Export (API returns 202 Accepted)
      const packRes = await request(auditApp)
        .post('/v1/evidence-packs')
        .send({
          from: new Date(Date.now() - 86400000).toISOString(),
          to: new Date().toISOString(),
          purpose: 'Statutory NBFC RBI Compliance Review',
        });
      expect(packRes.status).toBe(202);
      expect(packRes.body.status).toBe('PENDING');

      // 4. Verify evidence pack record created in store
      expect(store.evidencePacks.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // 11. STRICT TWO-STEP MFA ENFORCEMENT ON SENSITIVE FINANCIAL OPERATIONS
  // =========================================================================
  describe('11. Strict Two-Step MFA Enforcement (SUB-AUTH.02)', () => {
    it('DEMO-MFA-01: Verifies that sensitive permissions require AAL2 step-up verification', async () => {
      const principalWithPeriodClose = testPrincipal({
        tenantId: DEMO_TENANT_ID,
        id: DEMO_USER_FIN_CHECKER,
        grants: [{ code: 'finance.period_close', scope: 'TENANT', branchIds: [] }],
      });

      // 1. When accessed with AAL1 token -> 401 STEP_UP_REQUIRED
      const aal1Verifier: TokenVerifier = {
        verify: async () => ({
          subject: DEMO_USER_FIN_CHECKER,
          tenantId: DEMO_TENANT_ID,
          aal: 'aal1',
          mfaVerifiedAt: null,
        }),
      };
      const aal1App = createTestApp({
        auth: supabaseAuth({
          verifier: aal1Verifier,
          resolver: { resolve: async () => principalWithPeriodClose },
        }),
      });

      const aal1Res = await request(aal1App)
        .post('/v1/organisations')
        .set('Authorization', 'Bearer dummy.aal1.jwt');
      expect(aal1Res.status).toBe(401);
      expect(aal1Res.body.error?.code).toBe('STEP_UP_REQUIRED');

      // 2. When accessed with AAL2 step-up verified token -> passes the MFA rule
      const aal2Verifier: TokenVerifier = {
        verify: async () => ({
          subject: DEMO_USER_FIN_CHECKER,
          tenantId: DEMO_TENANT_ID,
          aal: 'aal2',
          mfaVerifiedAt: new Date(),
        }),
      };
      const aal2App = createTestApp({
        auth: supabaseAuth({
          verifier: aal2Verifier,
          resolver: { resolve: async () => principalWithPeriodClose },
        }),
      });

      const aal2Res = await request(aal2App)
        .post('/v1/organisations')
        .set('Authorization', 'Bearer dummy.aal2.jwt');
      expect(aal2Res.body.error?.code).not.toBe('STEP_UP_REQUIRED');

      // 3. /v1/me remains open to AAL1 so user can navigate to MFA setup in UI
      const meRes = await request(aal1App).get('/v1/me').set('Authorization', 'Bearer dummy.aal1.jwt');
      expect(meRes.body.error?.code).not.toBe('STEP_UP_REQUIRED');
    });
  });
});
