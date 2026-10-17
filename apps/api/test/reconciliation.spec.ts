// apps/api/test/reconciliation.spec.ts
import type { PermissionCode, RequestContext, Tx, TxRunner } from '@dsa/contracts';
import request from 'supertest';
import { ulid } from 'ulid';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashLoanAccount, maskCustomerName } from '../src/modules/reconciliation/crypto';
import { ReconciliationService } from '../src/modules/reconciliation/reconciliation-service';
import type { ReconciliationRepository } from '../src/modules/reconciliation/repository';
import type {
  AdjustmentRow,
  DisputeRow,
  LenderStatementLineRow,
  LenderStatementRow,
  ReconciliationExceptionRow,
  ReconciliationMatchRow,
} from '../src/modules/reconciliation/types';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const fakeTxRunner: TxRunner = {
  withTenantTx: async (_ctx, fn) => fn({} as any),
};

class InMemoryReconciliationRepository implements ReconciliationRepository {
  statements: LenderStatementRow[] = [];
  lines: LenderStatementLineRow[] = [];
  matches: ReconciliationMatchRow[] = [];
  exceptions: ReconciliationExceptionRow[] = [];
  adjustments: AdjustmentRow[] = [];
  disputes: DisputeRow[] = [];
  heldPayableIds: Set<string> = new Set();
  payouts: any[] = [
    {
      id: 'prq_01JTESTPAYOUT000000000000',
      tenant_id: 'ten_test',
      status: 'PAYMENT_RECORDED',
      total: '150000.00',
    },
  ];

  reset() {
    this.statements = [];
    this.lines = [];
    this.matches = [];
    this.exceptions = [];
    this.adjustments = [];
    this.disputes = [];
    this.heldPayableIds.clear();
    this.payouts = [
      {
        id: 'prq_01JTESTPAYOUT000000000000',
        tenant_id: 'ten_01JTESTTENANT00000000000000',
        status: 'PAYMENT_RECORDED',
        total: '150000.00',
      },
    ];
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
    const stmt = this.statements.find((s) => s.tenant_id === tenantId && s.id === id);
    if (stmt) stmt.status = status as any;
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
    const line = this.lines.find((l) => l.tenant_id === tenantId && l.id === id);
    if (line) line.status = status as any;
  }

  async findCalculationsForMatching(_tx: Tx, tenantId: string, _lenderId: string): Promise<any[]> {
    return [
      {
        id: 'ccal_01JCALCULATION00000000000',
        tenant_id: tenantId,
        loan_account_no: 'LN902148',
        gross_amount: '22500.00',
        decision_record_id: 'dr_01JDECISION00000000000',
      },
      {
        id: 'ccal_01JCALCULATION00000000001',
        tenant_id: tenantId,
        loan_account_no: 'LN902149',
        gross_amount: '40000.00', // statement is 37500 -> variance
        decision_record_id: 'dr_01JDECISION00000000001',
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
    const filtered = this.exceptions.filter(
      (e) =>
        e.tenant_id === tenantId &&
        (!filters.status || e.status === filters.status) &&
        (!filters.classification || e.classification === filters.classification),
    );
    return { rows: filtered.slice(0, filters.limit), nextCursor: null };
  }

  async findExceptionById(_tx: Tx, tenantId: string, id: string): Promise<ReconciliationExceptionRow | null> {
    return this.exceptions.find((e) => e.tenant_id === tenantId && e.id === id) ?? null;
  }

  async updateException(
    _tx: Tx,
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
    const exc = this.exceptions.find((e) => e.tenant_id === tenantId && e.id === id);
    if (!exc) return null;
    exc.status = updates.status as any;
    exc.resolution_note = updates.resolutionNote;
    exc.resolved_by = updates.resolvedBy;
    exc.resolved_at = updates.resolvedAt;
    if (updates.evidenceRef) exc.evidence_ref = updates.evidenceRef;
    return exc;
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

  async updateAdjustmentApproval(
    _tx: Tx,
    tenantId: string,
    id: string,
    status: 'APPROVED' | 'REJECTED',
    approverId: string,
  ): Promise<AdjustmentRow | null> {
    const adj = this.adjustments.find((a) => a.tenant_id === tenantId && a.id === id);
    if (!adj) return null;
    adj.status = status;
    adj.approved_by = approverId;
    adj.approved_at = new Date();
    adj.lock_version += 1;
    return adj;
  }

  async insertDispute(_tx: Tx, row: DisputeRow): Promise<void> {
    this.disputes.push(row);
  }

  async findDisputeById(_tx: Tx, tenantId: string, id: string): Promise<DisputeRow | null> {
    return this.disputes.find((d) => d.tenant_id === tenantId && d.id === id) ?? null;
  }

  async listDisputes(
    _tx: Tx,
    tenantId: string,
    filters?: { status?: string; partyType?: string },
  ): Promise<DisputeRow[]> {
    return this.disputes.filter(
      (d) =>
        d.tenant_id === tenantId &&
        (!filters?.status || d.status === filters.status) &&
        (!filters?.partyType || d.party_type === filters.partyType),
    );
  }

  async updateDispute(
    _tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: { status: string; resolution?: string; outcomeAdjustmentId?: string; updatedBy: string },
  ): Promise<DisputeRow | null> {
    const disp = this.disputes.find((d) => d.tenant_id === tenantId && d.id === id);
    if (!disp || disp.lock_version !== expectedLockVersion) return null;
    disp.status = updates.status as any;
    if (updates.resolution) disp.resolution = updates.resolution;
    if (updates.outcomeAdjustmentId) disp.outcome_adjustment_id = updates.outcomeAdjustmentId;
    disp.lock_version += 1;
    disp.updated_at = new Date();
    disp.updated_by = updates.updatedBy;
    return disp;
  }

  async holdPayables(_tx: Tx, _tenantId: string, payableIds: string[], _reason: string): Promise<void> {
    for (const pid of payableIds) {
      this.heldPayableIds.add(pid);
    }
  }

  async releasePayables(_tx: Tx, _tenantId: string, payableIds: string[]): Promise<void> {
    for (const pid of payableIds) {
      this.heldPayableIds.delete(pid);
    }
  }

  async findPayoutRequestById(_tx: Tx, tenantId: string, payoutId: string): Promise<any | null> {
    return this.payouts.find((p) => p.tenant_id === tenantId && p.id === payoutId) ?? null;
  }

  async reconcilePayoutRequest(_tx: Tx, tenantId: string, payoutId: string): Promise<any | null> {
    const p = this.payouts.find((p) => p.tenant_id === tenantId && p.id === payoutId);
    if (p) p.status = 'RECONCILED';
    return p;
  }
}

const sharedRepo = new InMemoryReconciliationRepository();

const fakeAudit: any = {
  record: async () => 'aud_mock',
};

const fakeOutbox: any = {
  emit: async () => 'evt_mock',
};

const appWith = (...grants: PermissionCode[]) =>
  createTestApp({
    auth: fakeAuth(
      testPrincipal({
        grants: grants.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })),
      }),
    ),
    deps: {
      txRunner: fakeTxRunner,
      reconciliationRepository: sharedRepo,
      audit: fakeAudit,
      outboxPort: fakeOutbox,
    } as any,
  });

const appWithUser = (userId: string, ...grants: PermissionCode[]) =>
  createTestApp({
    auth: fakeAuth({
      ...testPrincipal({
        grants: grants.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })),
      }),
      id: userId,
    }),
    deps: {
      txRunner: fakeTxRunner,
      reconciliationRepository: sharedRepo,
      audit: fakeAudit,
      outboxPort: fakeOutbox,
    } as any,
  });

describe('MOD-REC: Reconciliation Management (Domain DOM-K)', () => {
  beforeEach(() => {
    sharedRepo.reset();
  });

  const sampleImport = {
    lenderId: 'lnd_hdfc_bank',
    period: '2026-09',
    sourceFileKey: 'statements/hdfc_2026_09.csv',
    importBatchId: 'batch_20260901',
    fileSha256: 'a'.repeat(64),
    lines: [
      {
        loanAccount: 'LN902148',
        customerName: 'Rajesh Kumar',
        disbursedAmount: 1500000,
        commissionAmount: 22500,
        taxDeducted: 2250,
        paidOn: '2026-09-15',
        rawRowRef: 'row_1',
      },
      {
        loanAccount: 'LN902149',
        customerName: 'Sunita Patel',
        disbursedAmount: 2500000,
        commissionAmount: 37500,
        taxDeducted: 3750,
        paidOn: '2026-09-16',
        rawRowRef: 'row_2',
      },
    ],
  };

  describe('SUB-REC.01: Lender Statement Import', () => {
    it('TC-REC-001: POST /v1/lender-statements requires finance.reconcile permission', async () => {
      const app = appWith('finance.view'); // missing finance.reconcile
      const res = await request(app).post('/v1/lender-statements').send(sampleImport);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('TC-REC-002: Successfully imports lender statement with S2 masking and loan account hashing', async () => {
      const app = appWith('finance.reconcile', 'finance.view');
      const res = await request(app).post('/v1/lender-statements').send(sampleImport);
      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^stm_/);
      expect(res.body.totals.totalDisbursed).toBe(4000000);
      expect(res.body.totals.totalCommission).toBe(60000);
      expect(res.body.totals.netCommission).toBe(54000);
      expect(res.body.totals.lineCount).toBe(2);

      // Verify privacy masking & hashing
      const line = res.body.lines[0];
      expect(line.loanAccountHash).toBe(hashLoanAccount('LN902148'));
      expect(line.customerNameMasked).toBe(maskCustomerName('Rajesh Kumar'));
      expect(line.status).toBe('UNMATCHED');
    });

    it('TC-REC-003: Duplicate statement import with same (tenant, lender, period, fileSha256) returns 409', async () => {
      const app = appWith('finance.reconcile', 'finance.view');
      const first = await request(app).post('/v1/lender-statements').send(sampleImport);
      expect(first.status).toBe(201);

      const duplicate = await request(app).post('/v1/lender-statements').send(sampleImport);
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('CONTENT_HASH_MISMATCH');
    });

    it('TC-REC-004: Supports Idempotency-Key on statement import', async () => {
      const app = appWith('finance.reconcile');
      const payload = { ...sampleImport, fileSha256: 'b'.repeat(64) };
      const res = await request(app)
        .post('/v1/lender-statements')
        .set('Idempotency-Key', 'idem_import_001')
        .send(payload);
      expect(res.status).toBe(201);
    });
  });

  describe('SUB-REC.02: Commission Matching', () => {
    it('TC-REC-005: Auto-matching identifies exact match and variance exceptions', async () => {
      const app = appWith('finance.reconcile', 'finance.view');
      const importRes = await request(app)
        .post('/v1/lender-statements')
        .send({ ...sampleImport, fileSha256: 'c'.repeat(64) });
      const stmtId = importRes.body.id;

      const matchRes = await request(app).post(`/v1/lender-statements/${stmtId}/match`).send();
      expect(matchRes.status).toBe(200);
      expect(matchRes.body.matchedCount).toBe(1); // LN902148 matches exactly 22500
      expect(matchRes.body.varianceCount).toBe(1); // LN902149 has variance (37500 vs 40000)
    });

    it('TC-REC-006: Invariant: Only one active match allowed per statement line', async () => {
      const app = appWith('finance.reconcile', 'finance.view');
      const importRes = await request(app)
        .post('/v1/lender-statements')
        .send({ ...sampleImport, fileSha256: 'd'.repeat(64) });
      const stmtId = importRes.body.id;

      // First run matches
      const first = await request(app).post(`/v1/lender-statements/${stmtId}/match`).send();
      expect(first.body.matchedCount).toBe(1);

      // Re-running does not create duplicate active matches
      const second = await request(app).post(`/v1/lender-statements/${stmtId}/match`).send();
      expect(second.body.matchedCount).toBe(0);
    });
  });

  describe('SUB-REC.03: Exceptions & Adjustments', () => {
    it('TC-REC-007: Lists reconciliation exceptions with cursor pagination', async () => {
      const app = appWith('finance.view');
      const res = await request(app).get('/v1/reconciliation-exceptions');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('TC-REC-008: Resolves reconciliation exception with finance.reconcile permission', async () => {
      const app = appWith('finance.reconcile', 'finance.view');
      // Create statement & match to generate exception
      const importRes = await request(app)
        .post('/v1/lender-statements')
        .send({ ...sampleImport, fileSha256: 'e'.repeat(64) });
      await request(app).post(`/v1/lender-statements/${importRes.body.id}/match`).send();

      const excList = await request(app).get('/v1/reconciliation-exceptions');
      const exceptionId = excList.body.items[0]?.id;
      expect(exceptionId).toBeDefined();

      const resolveRes = await request(app)
        .post(`/v1/reconciliation-exceptions/${exceptionId}/resolution`)
        .send({
          status: 'RESOLVED',
          resolutionNote: 'Lender confirmed shortfall will be adjusted in next cycle credit note.',
          evidenceRef: 'docs/lender_note_442.pdf',
        });
      expect(resolveRes.status).toBe(200);
      expect(resolveRes.body.status).toBe('RESOLVED');
      expect(resolveRes.body.resolutionNote).toContain('credit note');
    });

    it('TC-REC-009: Proposes financial adjustment with adjustment.create permission', async () => {
      const app = appWith('adjustment.create');
      const res = await request(app).post('/v1/adjustments').send({
        type: 'CORRECTION',
        amount: 5000,
        reason: 'Rate tier correction on loan case LN902148',
      });
      console.log('TC-REC-009 STATUS:', res.status, res.body);
      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^adj_/);
      expect(res.body.status).toBe('PENDING');
      expect(res.body.amount).toBe('5000');
    });

    it('TC-REC-010: SOD-07 Enforcement: Creator cannot approve their own adjustment', async () => {
      const userApp = appWithUser('usr_creator_01', 'adjustment.create', 'adjustment.approve');
      const createRes = await request(userApp).post('/v1/adjustments').send({
        type: 'WRITE_OFF',
        amount: 2500,
        reason: 'Immaterial variance write-off',
      });
      const adjId = createRes.body.id;

      // Creator attempts to self-approve -> Forbidden under SOD-07
      const selfApproveRes = await request(userApp)
        .post(`/v1/adjustments/${adjId}/approval`)
        .send({ approved: true });
      expect(selfApproveRes.status).toBe(403);
      expect(selfApproveRes.body.error.code).toBe('SOD_VIOLATION');
      expect(selfApproveRes.body.error.message).toContain('SOD-07');
    });

    it('TC-REC-011: Independent checker approves adjustment successfully under SOD-07', async () => {
      const creatorApp = appWithUser('usr_creator_02', 'adjustment.create');
      const createRes = await request(creatorApp).post('/v1/adjustments').send({
        type: 'CLAWBACK',
        amount: 10000,
        reason: 'Customer early foreclosure clawback',
      });
      const adjId = createRes.body.id;

      // Independent checker approves
      const checkerApp = appWithUser('usr_approver_01', 'adjustment.approve');
      const approveRes = await request(checkerApp)
        .post(`/v1/adjustments/${adjId}/approval`)
        .send({ approved: true });
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.status).toBe('APPROVED');
      expect(approveRes.body.approvedBy).toBe('usr_approver_01');
    });
  });

  describe('SUB-REC.04: Lender and Connector Disputes', () => {
    it('TC-REC-012: Dispute creation places associated payables on ON_HOLD', async () => {
      const app = appWith('finance.dispute');
      const validPayableId = `cpay_${ulid()}`;
      const res = await request(app)
        .post('/v1/disputes')
        .send({
          partyType: 'LENDER',
          partyId: 'lnd_hdfc_bank',
          subjectType: 'STATEMENT_LINE',
          subjectId: 'stl_test_line_01',
          reason: 'Short remittance of ₹2,500 disputed with lender account manager',
          payableIds: [validPayableId],
        });
      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^dsp_/);
      expect(res.body.status).toBe('OPEN');
      expect(res.body.lockVersion).toBe(1);
      expect(sharedRepo.heldPayableIds.has(validPayableId)).toBe(true);
    });

    it('TC-REC-013: Dispute update enforces If-Match optimistic concurrency locking', async () => {
      const app = appWith('finance.dispute', 'finance.reconcile');
      const createRes = await request(app).post('/v1/disputes').send({
        partyType: 'CONNECTOR',
        partyId: 'con_connector_01',
        subjectType: 'PAYOUT',
        subjectId: 'prq_payout_01',
        reason: 'Disputed calculation on connector referral',
      });
      const dispId = createRes.body.id;

      // Missing If-Match header -> 422
      const noIfMatch = await request(app).patch(`/v1/disputes/${dispId}`).send({ status: 'RESOLVED' });
      expect(noIfMatch.status).toBe(422);

      // Stale If-Match lock version -> 409
      const stale = await request(app)
        .patch(`/v1/disputes/${dispId}`)
        .set('If-Match', '"999"')
        .send({ status: 'RESOLVED' });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('VERSION_CONFLICT');

      // Valid If-Match -> 200
      const ok = await request(app)
        .patch(`/v1/disputes/${dispId}`)
        .set('If-Match', '"1"')
        .send({ status: 'RESOLVED', resolution: 'Rate adjustment credited' });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe('RESOLVED');
      expect(ok.body.lockVersion).toBe(2);
    });
  });

  describe('SUB-REC.05: Payout Bank Settlement Reconciliation', () => {
    it('TC-REC-014: Transitions recorded payout to RECONCILED upon matching bank reference and amount', async () => {
      const app = appWith('finance.reconcile');
      const res = await request(app)
        .post('/v1/reconciliation/payouts/prq_01JTESTPAYOUT000000000000/bank-reconcile')
        .send({
          bankReference: 'UTR998822110099',
          paidAmount: 150000,
          settlementDate: '2026-09-20',
        });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('RECONCILED');
      expect(res.body.bankReference).toBe('UTR998822110099');
    });

    it('TC-REC-015: Bank amount mismatch routes to reconciliation exception and throws error', async () => {
      const app = appWith('finance.reconcile');
      const res = await request(app)
        .post('/v1/reconciliation/payouts/prq_01JTESTPAYOUT000000000000/bank-reconcile')
        .send({
          bankReference: 'UTR998822110099',
          paidAmount: 140000, // payout total is 150000 -> mismatch
          settlementDate: '2026-09-20',
        });
      expect(res.status).toBe(422);
      expect(res.body.error.message).toContain('does not match payout total');
    });
  });
});
