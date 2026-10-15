// apps/api/test/sanctions.spec.ts — owner: Dev 3 (MOD-SND Sanctions & Disbursement Unit Tests)
import type { RequestContext, Tx, TxRunner } from '@dsa/contracts';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemorySanctionRepository } from '../src/modules/origination/sanctions/repository';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const inMemoryTxRunner: TxRunner = {
  async withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tx = {} as any;
    tx.tenantId = ctx.principal.tenantId;
    return fn(tx as Tx);
  },
};

describe('Module 19 — Sanction and Disbursement (MOD-SND)', () => {
  let repository: InMemorySanctionRepository;

  const tenantA = 'ten_01JTESTTENANTA0000000000000';
  const tenantB = 'ten_01JTESTTENANTB0000000000000';
  const branchA = 'br_01JTESTBRANCH00000000000001';

  // Loan Ops user (can record sanctions & tranches)
  const userOps = testPrincipal({
    tenantId: tenantA,
    id: 'usr_ops_01',
    primaryBranchId: branchA,
    grants: [
      { code: 'sanction.record', scope: 'TENANT', branchIds: [] },
      { code: 'disbursement.record', scope: 'TENANT', branchIds: [] },
      { code: 'application.read', scope: 'TENANT', branchIds: [] },
    ],
  });

  // Finance Executive / Branch Manager (can verify tranches & approve exceptions)
  const userVerifier = testPrincipal({
    tenantId: tenantA,
    id: 'usr_verifier_02',
    primaryBranchId: branchA,
    grants: [
      { code: 'disbursement.verify', scope: 'TENANT', branchIds: [] },
      { code: 'disbursement.exception_approve', scope: 'TENANT', branchIds: [] },
      { code: 'application.read', scope: 'TENANT', branchIds: [] },
    ],
  });

  // User from other tenant
  const userTenantB = testPrincipal({
    tenantId: tenantB,
    id: 'usr_other_tenant',
    grants: [
      { code: 'sanction.record', scope: 'TENANT', branchIds: [] },
      { code: 'disbursement.record', scope: 'TENANT', branchIds: [] },
      { code: 'disbursement.verify', scope: 'TENANT', branchIds: [] },
    ],
  });

  const appId = 'app_01JTESTAPP0000000000000001';
  const caseId = 'lcs_01JTESTCASE000000000000001';

  beforeEach(() => {
    repository = new InMemorySanctionRepository();

    // Seed eligible lender case
    repository.lenderCases.set(`${tenantA}:${caseId}`, {
      id: caseId,
      tenant_id: tenantA,
      application_id: appId,
      lender_id: 'lnd_hdfc_01',
      status: 'UNDER_PROCESSING',
      lock_version: 0,
    });

    // Seed application
    repository.applications.set(`${tenantA}:${appId}`, {
      id: appId,
      tenant_id: tenantA,
      status: 'SUBMITTED',
      sub_status: null,
      lock_version: 0,
    });
  });

  function getApp(principal = userOps) {
    return createTestApp({
      auth: fakeAuth(principal),
      deps: {
        txRunner: inMemoryTxRunner,
        sanctionRepository: repository,
      } as any,
    });
  }

  const validSanctionPayload = {
    amount: 2500000,
    tenureMonths: 180,
    rateValue: 8.75,
    rateType: 'FLOATING',
    benchmarkText: 'Repo + 2.25%',
    feesText: '0.5% Processing Fee',
    conditions: ['Original property documents verification', 'CIBIL score check'],
    sanctionDate: '2026-10-01',
    validUntil: '2027-01-01',
    letterDocumentId: 'doc_sanction_letter_01',
    source: 'MANUAL',
  };

  describe('API-SND-001: Record & Revise Sanction', () => {
    it('records a new sanction version 1 and rolls up lender case and application to SANCTIONED', async () => {
      const app = getApp();
      const res = await request(app)
        .post(`/v1/lender-cases/${caseId}/sanctions`)
        .send(validSanctionPayload);

      expect(res.status).toBe(201);
      expect(res.headers.etag).toBe('"0"');
      expect(res.body.id).toMatch(/^snc_/);
      expect(res.body.version).toBe(1);
      expect(res.body.amount).toBe(2500000);
      expect(res.body.status).toBe('ACTIVE');

      // Verify lender case was updated to SANCTIONED
      const updatedCase = await repository.findLenderCase({} as Tx, tenantA, caseId);
      expect(updatedCase?.status).toBe('SANCTIONED');

      // Verify application was updated to SANCTIONED (ROLLUP-4)
      const updatedApp = await repository.findApplication({} as Tx, tenantA, appId);
      expect(updatedApp?.status).toBe('SANCTIONED');

      // Outbox event
      expect(repository.outboxEvents.some((e) => e.eventName === 'sanction.recorded')).toBe(true);
    });

    it('creates version 2 on revision and sets version 1 to REVISED without losing history', async () => {
      const app = getApp();

      // Version 1
      const v1Res = await request(app)
        .post(`/v1/lender-cases/${caseId}/sanctions`)
        .send(validSanctionPayload);
      expect(v1Res.status).toBe(201);
      expect(v1Res.body.version).toBe(1);

      // Version 2 revision
      const v2Res = await request(app)
        .post(`/v1/lender-cases/${caseId}/sanctions`)
        .send({
          ...validSanctionPayload,
          amount: 3000000,
          rateValue: 8.5,
        });

      expect(v2Res.status).toBe(201);
      expect(v2Res.body.version).toBe(2);
      expect(v2Res.body.amount).toBe(3000000);
      expect(v2Res.body.status).toBe('ACTIVE');

      // Check version 1 is REVISED
      const v1Check = await repository.findSanctionById({} as Tx, tenantA, v1Res.body.id);
      expect(v1Check?.status).toBe('REVISED');

      // Both versions preserved
      const listRes = await request(app).get(`/v1/lender-cases/${caseId}/sanctions`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data).toHaveLength(2);
    });

    it('rejects sanction recording when lender case is in ineligible status (e.g. DRAFT)', async () => {
      repository.lenderCases.set(`${tenantA}:${caseId}`, {
        id: caseId,
        tenant_id: tenantA,
        application_id: appId,
        lender_id: 'lnd_hdfc_01',
        status: 'DRAFT',
        lock_version: 0,
      });

      const app = getApp();
      const res = await request(app)
        .post(`/v1/lender-cases/${caseId}/sanctions`)
        .send(validSanctionPayload);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_CASE_STATUS');
    });

    it('rejects sanction when validUntil is earlier than sanctionDate with 422 VALIDATION_ERROR', async () => {
      const app = getApp();
      const res = await request(app)
        .post(`/v1/lender-cases/${caseId}/sanctions`)
        .send({
          ...validSanctionPayload,
          sanctionDate: '2026-10-01',
          validUntil: '2026-09-01', // earlier!
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('API-SND-005: Cancel Sanction', () => {
    it('cancels active sanction and transitions lender case to SANCTION_CANCELLED', async () => {
      const app = getApp();
      const createRes = await request(app)
        .post(`/v1/lender-cases/${caseId}/sanctions`)
        .send(validSanctionPayload);
      const sanctionId = createRes.body.id;

      const cancelRes = await request(app)
        .post(`/v1/sanctions/${sanctionId}/cancellation`)
        .send({ reason: 'Customer found better terms with competitor' });

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe('CANCELLED');
      expect(cancelRes.body.cancelReason).toBe('Customer found better terms with competitor');

      // Check lender case status
      const updatedCase = await repository.findLenderCase({} as Tx, tenantA, caseId);
      expect(updatedCase?.status).toBe('SANCTION_CANCELLED');

      // Outbox event
      expect(repository.outboxEvents.some((e) => e.eventName === 'sanction.cancelled')).toBe(true);
    });
  });

  describe('API-SND-002: Record Disbursement Tranche', () => {
    it('records tranche 1 with masked banking identifiers and calculates remaining limit', async () => {
      const app = getApp();
      const sRes = await request(app)
        .post(`/v1/lender-cases/${caseId}/sanctions`)
        .send(validSanctionPayload);
      const sanctionId = sRes.body.id;

      const tRes = await request(app)
        .post(`/v1/sanctions/${sanctionId}/tranches`)
        .send({
          amount: 1000000,
          disbursedOn: '2026-10-05',
          utr: 'HDFCR5202610051234',
          loanAccountNumber: '987654321098',
          evidenceDocumentId: 'doc_ev_tranche_01',
        });

      expect(tRes.status).toBe(201);
      expect(tRes.body.tranche.id).toMatch(/^trn_/);
      expect(tRes.body.tranche.trancheNo).toBe(1);
      expect(tRes.body.tranche.status).toBe('RECORDED');
      expect(tRes.body.tranche.utrMasked).toBe('XXXX-XXXX-1234');
      expect(tRes.body.tranche.loanAccountMasked).toBe('XXXX-XXXX-1098');
      expect(tRes.body.remainingSanctionAmount).toBe(1500000);

      // Lender case updated to PARTIALLY_DISBURSED
      const updatedCase = await repository.findLenderCase({} as Tx, tenantA, caseId);
      expect(updatedCase?.status).toBe('PARTIALLY_DISBURSED');

      // Outbox event
      expect(repository.outboxEvents.some((e) => e.eventName === 'disbursement.recorded')).toBe(true);
    });

    it('rejects tranche exceeding remaining sanctioned limit with 422 EXCEEDS_SANCTION', async () => {
      const app = getApp();
      const sRes = await request(app)
        .post(`/v1/lender-cases/${caseId}/sanctions`)
        .send(validSanctionPayload);
      const sanctionId = sRes.body.id;

      const tRes = await request(app)
        .post(`/v1/sanctions/${sanctionId}/tranches`)
        .send({
          amount: 3000000, // Sanction is 2,500,000
          disbursedOn: '2026-10-05',
        });

      expect(tRes.status).toBe(422);
      expect(tRes.body.error.code).toBe('EXCEEDS_SANCTION');
    });
  });

  describe('API-SND-003: Verify or Return a Tranche (SOD-04)', () => {
    it('enforces SOD-04: blocks recorder from verifying own tranche with 403 SOD_VIOLATION', async () => {
      const opsApp = getApp(userOps);
      const sRes = await request(opsApp)
        .post(`/v1/lender-cases/${caseId}/sanctions`)
        .send(validSanctionPayload);
      const sanctionId = sRes.body.id;

      const tRes = await request(opsApp)
        .post(`/v1/sanctions/${sanctionId}/tranches`)
        .send({
          amount: 500000,
          disbursedOn: '2026-10-05',
          evidenceDocumentId: 'doc_ev_01',
        });
      const trancheId = tRes.body.tranche.id;

      // Ops user (who recorded) attempts verification
      const verifyAttempt = await request(opsApp)
        .post(`/v1/tranches/${trancheId}/verification`)
        .send({ decision: 'VERIFY' });

      // Must be rejected under SOD-04
      expect(verifyAttempt.status).toBe(403);
    });

    it('allows distinct authorized verifier to verify tranche and emits disbursement.verified', async () => {
      const opsApp = getApp(userOps);
      const sRes = await request(opsApp)
        .post(`/v1/lender-cases/${caseId}/sanctions`)
        .send(validSanctionPayload);
      const sanctionId = sRes.body.id;

      const tRes = await request(opsApp)
        .post(`/v1/sanctions/${sanctionId}/tranches`)
        .send({
          amount: 500000,
          disbursedOn: '2026-10-05',
          evidenceDocumentId: 'doc_ev_01',
        });
      const trancheId = tRes.body.tranche.id;

      // Distinct verifier verifies
      const verifierApp = getApp(userVerifier);
      const verifyRes = await request(verifierApp)
        .post(`/v1/tranches/${trancheId}/verification`)
        .send({ decision: 'VERIFY' });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.status).toBe('VERIFIED');
      expect(verifyRes.body.verifiedBy).toBe(userVerifier.id);

      // Verified event emitted (qualifying commission signal!)
      expect(repository.outboxEvents.some((e) => e.eventName === 'disbursement.verified')).toBe(true);
    });

    it('rejects verification with 422 EVIDENCE_MISSING when neither evidence document nor exception exists', async () => {
      const opsApp = getApp(userOps);
      const sRes = await request(opsApp)
        .post(`/v1/lender-cases/${caseId}/sanctions`)
        .send(validSanctionPayload);
      const sanctionId = sRes.body.id;

      // Tranche without evidence document
      const tRes = await request(opsApp)
        .post(`/v1/sanctions/${sanctionId}/tranches`)
        .send({
          amount: 500000,
          disbursedOn: '2026-10-05',
        });
      const trancheId = tRes.body.tranche.id;

      const verifierApp = getApp(userVerifier);
      const verifyRes = await request(verifierApp)
        .post(`/v1/tranches/${trancheId}/verification`)
        .send({ decision: 'VERIFY' });

      expect(verifyRes.status).toBe(422);
      expect(verifyRes.body.error.code).toBe('EVIDENCE_MISSING');
    });

    it('returns a tranche with comment when verifier decides RETURN', async () => {
      const opsApp = getApp(userOps);
      const sRes = await request(opsApp)
        .post(`/v1/lender-cases/${caseId}/sanctions`)
        .send(validSanctionPayload);
      const sanctionId = sRes.body.id;

      const tRes = await request(opsApp)
        .post(`/v1/sanctions/${sanctionId}/tranches`)
        .send({
          amount: 500000,
          disbursedOn: '2026-10-05',
          evidenceDocumentId: 'doc_ev_01',
        });
      const trancheId = tRes.body.tranche.id;

      const verifierApp = getApp(userVerifier);
      const returnRes = await request(verifierApp)
        .post(`/v1/tranches/${trancheId}/verification`)
        .send({
          decision: 'RETURN',
          comment: 'UTR screenshot is blurred and unreadable',
        });

      expect(returnRes.status).toBe(200);
      expect(returnRes.body.status).toBe('RETURNED');
      expect(returnRes.body.verificationComment).toBe('UTR screenshot is blurred and unreadable');

      // disbursement.verified must NOT be emitted
      expect(repository.outboxEvents.some((e) => e.eventName === 'disbursement.verified')).toBe(false);
    });
  });

  describe('API-SND-004 & API-SND-006: Exception Approval & Void-and-Replace', () => {
    it('approves evidence exception and allows subsequent independent verification', async () => {
      const opsApp = getApp(userOps);
      const sRes = await request(opsApp)
        .post(`/v1/lender-cases/${caseId}/sanctions`)
        .send(validSanctionPayload);
      const sanctionId = sRes.body.id;

      // Tranche missing evidence document
      const tRes = await request(opsApp)
        .post(`/v1/sanctions/${sanctionId}/tranches`)
        .send({
          amount: 500000,
          disbursedOn: '2026-10-05',
        });
      const trancheId = tRes.body.tranche.id;

      const verifierApp = getApp(userVerifier);

      // Approve exception
      const exRes = await request(verifierApp)
        .post(`/v1/tranches/${trancheId}/exception-approval`)
        .send({ reason: 'Bank confirmation received via verified corporate email' });

      expect(exRes.status).toBe(200);
      expect(exRes.body.exceptionApprovalId).toMatch(/^exa_/);

      // Now independent verification succeeds
      const vRes = await request(verifierApp)
        .post(`/v1/tranches/${trancheId}/verification`)
        .send({ decision: 'VERIFY' });

      expect(vRes.status).toBe(200);
      expect(vRes.body.status).toBe('VERIFIED');
    });

    it('voids tranche and creates linked replacement tranche', async () => {
      const opsApp = getApp(userOps);
      const sRes = await request(opsApp)
        .post(`/v1/lender-cases/${caseId}/sanctions`)
        .send(validSanctionPayload);
      const sanctionId = sRes.body.id;

      const tRes = await request(opsApp)
        .post(`/v1/sanctions/${sanctionId}/tranches`)
        .send({
          amount: 500000,
          disbursedOn: '2026-10-05',
        });
      const trancheId = tRes.body.tranche.id;

      // Void with replacement
      const voidRes = await request(opsApp)
        .post(`/v1/tranches/${trancheId}/void`)
        .send({
          reason: 'Erroneous account number entered by ops',
          createReplacement: true,
          replacement: {
            amount: 500000,
            disbursedOn: '2026-10-06',
            loanAccountNumber: 'CORRECT-ACC-1234',
          },
        });

      expect(voidRes.status).toBe(200);
      expect(voidRes.body.voidedTranche.status).toBe('VOIDED');
      expect(voidRes.body.voidedTranche.voidReason).toBe('Erroneous account number entered by ops');
      expect(voidRes.body.replacementTranche).toBeDefined();
      expect(voidRes.body.replacementTranche.trancheNo).toBe(2);
    });
  });

  describe('Multi-Tenant Isolation', () => {
    it('blocks Tenant B from accessing or updating Tenant A sanctions', async () => {
      const appA = getApp(userOps);
      const sRes = await request(appA)
        .post(`/v1/lender-cases/${caseId}/sanctions`)
        .send(validSanctionPayload);
      const sanctionId = sRes.body.id;

      const appB = getApp(userTenantB);
      const getRes = await request(appB).get(`/v1/sanctions/${sanctionId}`);
      expect(getRes.status).toBe(404);
      expect(getRes.body.error.code).toBe('NOT_FOUND');

      // Tenant B cannot record tranche on Tenant A sanction -> 404
      const trancheRes = await request(appB)
        .post(`/v1/sanctions/${sanctionId}/tranches`)
        .send({
          amount: 200000,
          disbursedOn: '2026-10-15',
          utr: 'HDFCCROSS001',
          loanAccountNumber: '987654321098',
          evidenceDocumentId: 'doc_ev_01',
        });
      expect(trancheRes.status).toBe(404);
      expect(trancheRes.body.error.code).toBe('NOT_FOUND');
    });

    it('verifies tenant admin (ROLE-TENANT-ADMIN / ROLE-ORG-OWNER) possesses full sanction and disbursement grants', async () => {
      const tenantAdmin = testPrincipal({
        tenantId: tenantA,
        id: 'usr_tenant_admin_alpha',
        primaryBranchId: branchA,
        grants: [
          { code: 'sanction.record', scope: 'TENANT', branchIds: [] },
          { code: 'disbursement.record', scope: 'TENANT', branchIds: [] },
          { code: 'disbursement.verify', scope: 'TENANT', branchIds: [] },
          { code: 'disbursement.exception_approve', scope: 'TENANT', branchIds: [] },
          { code: 'application.read', scope: 'TENANT', branchIds: [] },
        ],
      });

      const app = getApp(tenantAdmin);
      const sRes = await request(app)
        .post(`/v1/lender-cases/${caseId}/sanctions`)
        .send(validSanctionPayload);
      expect(sRes.status).toBe(201);
      expect(sRes.body.id).toMatch(/^snc_/);

      const tRes = await request(app)
        .post(`/v1/sanctions/${sRes.body.id}/tranches`)
        .send({
          amount: 500000,
          disbursedOn: '2026-10-15',
          utr: 'UTR-ADMIN-001',
          loanAccountNumber: '987654321098',
          evidenceDocumentId: 'doc_ev_admin',
        });
      expect(tRes.status).toBe(201);
      expect(tRes.body.tranche.id).toMatch(/^trn_/);
      expect(tRes.body.tranche.status).toBe('RECORDED');
    });
  });
});
