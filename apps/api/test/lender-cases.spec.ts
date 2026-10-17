// apps/api/test/lender-cases.spec.ts — owner: Dev 4 (MOD-LCS Test Suite)
import type { RequestContext, Tx, TxRunner } from '@dsa/contracts';
import { FakeConsentPort, FakeTaskPort } from '@dsa/contracts/fakes';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryLenderCaseRepository } from '../src/modules/origination/lender-cases/repository';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const inMemoryTxRunner: TxRunner = {
  async withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tx = {} as any;
    tx.tenantId = ctx.principal.tenantId;
    return fn(tx as Tx);
  },
};

describe('Module 18 — Lender Cases (MOD-LCS)', () => {
  let repository: InMemoryLenderCaseRepository;
  let consentPort: FakeConsentPort;
  let taskPort: FakeTaskPort;

  const tenantA = 'ten_01JTESTTENANTA0000000000000';
  const tenantB = 'ten_01JTESTTENANTB0000000000000';
  const branchA = 'br_01JTESTBRANCH00000000000001';
  const branchOther = 'br_01JTESTBRANCH00000000000002';

  const principalA = testPrincipal({
    tenantId: tenantA,
    primaryBranchId: branchA,
    grants: [
      { code: 'lender_case.submit', scope: 'TENANT', branchIds: [] },
      { code: 'lender_case.update_status', scope: 'TENANT', branchIds: [] },
      { code: 'application.read', scope: 'TENANT', branchIds: [] },
    ],
  });

  const branchUser = testPrincipal({
    tenantId: tenantA,
    id: 'usr_branch_user',
    primaryBranchId: branchA,
    grants: [
      { code: 'lender_case.submit', scope: 'BRANCH', branchIds: [branchA] },
      { code: 'lender_case.update_status', scope: 'BRANCH', branchIds: [branchA] },
      { code: 'application.read', scope: 'BRANCH', branchIds: [branchA] },
    ],
  });

  const otherBranchUser = testPrincipal({
    tenantId: tenantA,
    id: 'usr_other_branch_user',
    primaryBranchId: branchOther,
    grants: [
      { code: 'lender_case.submit', scope: 'BRANCH', branchIds: [branchOther] },
      { code: 'lender_case.update_status', scope: 'BRANCH', branchIds: [branchOther] },
      { code: 'application.read', scope: 'BRANCH', branchIds: [branchOther] },
    ],
  });

  const principalB = testPrincipal({
    tenantId: tenantB,
    grants: [
      { code: 'lender_case.submit', scope: 'TENANT', branchIds: [] },
      { code: 'lender_case.update_status', scope: 'TENANT', branchIds: [] },
      { code: 'application.read', scope: 'TENANT', branchIds: [] },
    ],
  });

  const appId = 'app_01JTESTAPPLICATION00000001';
  const customerId = 'cust_01JTESTCUSTOMER000000001';
  const lenderId1 = 'lnd_01JHDFC0000000000000000001';
  const lenderId2 = 'lnd_01JICICI0000000000000000002';
  const pausedLenderId = 'lnd_01JPAUSED00000000000000003';
  const productVersionId = 'lpv_01JPRODUCTVER0000000000001';
  const empanelmentId1 = 'emp_01JHDFCEMP0000000000000001';
  const empanelmentId2 = 'emp_01JICICIEMP0000000000000002';
  const inactiveEmpId = 'emp_01JINACTIVEEMP000000000003';

  beforeEach(() => {
    repository = new InMemoryLenderCaseRepository();
    consentPort = new FakeConsentPort();
    taskPort = new FakeTaskPort();

    // Seed active consent for customer
    consentPort.consents.set('cnst_01JTESTCONSENT00000000001', {
      consentId: 'cnst_01JTESTCONSENT00000000001',
      customerId,
      purpose: 'SHARE_WITH_LENDER',
      status: 'ACTIVE',
    });

    // Seed application
    repository.applications.set(`${tenantA}:${appId}`, {
      id: appId,
      tenant_id: tenantA,
      branch_id: branchA,
      customer_id: customerId,
      product_category: 'HL',
      status: 'READY_FOR_SUBMISSION',
      sub_status: null,
      lock_version: 0,
    });

    // Seed lenders
    repository.lenders.set(`${tenantA}:${lenderId1}`, {
      id: lenderId1,
      tenant_id: tenantA,
      name: 'HDFC Bank',
      status: 'ACTIVE',
    });
    repository.lenders.set(`${tenantA}:${lenderId2}`, {
      id: lenderId2,
      tenant_id: tenantA,
      name: 'ICICI Bank',
      status: 'ACTIVE',
    });
    repository.lenders.set(`${tenantA}:${pausedLenderId}`, {
      id: pausedLenderId,
      tenant_id: tenantA,
      name: 'Paused Finance',
      status: 'PAUSED',
    });

    // Seed empanelments
    repository.empanelments.set(`${tenantA}:${empanelmentId1}`, {
      id: empanelmentId1,
      tenant_id: tenantA,
      lender_id: lenderId1,
      dsa_code: 'DSA-HDFC-01',
      status: 'ACTIVE',
      permitted_categories: ['HL', 'LAP'],
    });
    repository.empanelments.set(`${tenantA}:${empanelmentId2}`, {
      id: empanelmentId2,
      tenant_id: tenantA,
      lender_id: lenderId2,
      dsa_code: 'DSA-ICICI-01',
      status: 'ACTIVE',
      permitted_categories: ['HL'],
    });
    repository.empanelments.set(`${tenantA}:${inactiveEmpId}`, {
      id: inactiveEmpId,
      tenant_id: tenantA,
      lender_id: lenderId1,
      dsa_code: 'DSA-HDFC-OLD',
      status: 'SUSPENDED',
      permitted_categories: ['HL'],
    });

    // Seed product versions
    repository.productVersions.set(`${tenantA}:${productVersionId}`, {
      id: productVersionId,
      tenant_id: tenantA,
      product_id: 'prd_01JHOMEPRD0000000000000001',
      version_no: 1,
      status: 'ACTIVE',
    });
  });

  function getApp(principal = principalA) {
    return createTestApp({
      auth: fakeAuth(principal),
      deps: {
        txRunner: inMemoryTxRunner,
        consentPort,
        taskPort,
        lenderCaseRepository: repository,
      } as any,
    });
  }

  const validPayload = {
    lenderId: lenderId1,
    productVersionId,
    empanelmentId: empanelmentId1,
    tags: ['first-placement'],
  };

  describe('API-LCS-001: Create Lender Case', () => {
    it('creates a new lender case draft with attempt_no 1 and returns 201 with ETag', async () => {
      const app = getApp();
      const res = await request(app).post(`/v1/applications/${appId}/lender-cases`).send(validPayload);

      expect(res.status).toBe(201);
      expect(res.headers.etag).toBe('"0"');
      expect(res.body.id).toMatch(/^lcs_/);
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.attemptNo).toBe(1);
      expect(res.body.applicationId).toBe(appId);
      expect(res.body.lenderId).toBe(lenderId1);
      expect(repository.outboxEvents.length).toBe(1);
      expect(repository.auditEvents.length).toBe(1);
    });

    it('rejects attempt when lender is paused with 422 LENDER_PAUSED', async () => {
      const app = getApp();
      const res = await request(app)
        .post(`/v1/applications/${appId}/lender-cases`)
        .send({
          ...validPayload,
          lenderId: pausedLenderId,
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('LENDER_PAUSED');
    });

    it('rejects attempt when empanelment is suspended with 422 EMPANELMENT_INACTIVE', async () => {
      const app = getApp();
      const res = await request(app)
        .post(`/v1/applications/${appId}/lender-cases`)
        .send({
          ...validPayload,
          empanelmentId: inactiveEmpId,
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('EMPANELMENT_INACTIVE');
    });

    it('blocks duplicate active case for the same lender with 409 ACTIVE_CASE_EXISTS', async () => {
      const app = getApp();
      const first = await request(app).post(`/v1/applications/${appId}/lender-cases`).send(validPayload);
      expect(first.status).toBe(201);

      const second = await request(app).post(`/v1/applications/${appId}/lender-cases`).send(validPayload);
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('ACTIVE_CASE_EXISTS');
    });

    it('blocks parallel attempts with different lenders when parallel attempts not enabled', async () => {
      const app = getApp();
      const first = await request(app).post(`/v1/applications/${appId}/lender-cases`).send(validPayload);
      expect(first.status).toBe(201);

      // Second lender attempt without parallel permission
      const second = await request(app)
        .post(`/v1/applications/${appId}/lender-cases`)
        .send({
          ...validPayload,
          lenderId: lenderId2,
          empanelmentId: empanelmentId2,
        });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('ACTIVE_CASE_EXISTS');
    });

    it('permits parallel attempts when allow_parallel_lender_attempts is enabled in tenant', async () => {
      const tenantSettings = new Map<string, boolean>();
      tenantSettings.set('allow_parallel_lender_attempts', true);
      repository.tenantSettings.set(tenantA, tenantSettings);

      const app = getApp();
      const first = await request(app).post(`/v1/applications/${appId}/lender-cases`).send(validPayload);
      expect(first.status).toBe(201);
      expect(first.body.attemptNo).toBe(1);

      const second = await request(app)
        .post(`/v1/applications/${appId}/lender-cases`)
        .send({
          ...validPayload,
          lenderId: lenderId2,
          empanelmentId: empanelmentId2,
        });
      expect(second.status).toBe(201);
      expect(second.body.attemptNo).toBe(2);
      expect(second.body.lenderId).toBe(lenderId2);
    });

    it('enforces branch scope authorization when user has BRANCH scope', async () => {
      const authorizedBranchApp = getApp(branchUser);
      const res1 = await request(authorizedBranchApp)
        .post(`/v1/applications/${appId}/lender-cases`)
        .send(validPayload);
      expect(res1.status).toBe(201);

      const unauthorizedBranchApp = getApp(otherBranchUser);
      const res2 = await request(unauthorizedBranchApp)
        .post(`/v1/applications/${appId}/lender-cases`)
        .send(validPayload);
      expect(res2.status).toBe(403);
      expect(res2.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('API-LCS-002: Retrieve Lender Case & Listing', () => {
    it('retrieves single lender case by ID with ETag', async () => {
      const app = getApp();
      const createRes = await request(app).post(`/v1/applications/${appId}/lender-cases`).send(validPayload);
      const caseId = createRes.body.id;

      const getRes = await request(app).get(`/v1/lender-cases/${caseId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.headers.etag).toBe('"0"');
      expect(getRes.body.id).toBe(caseId);
      expect(getRes.body.applicationId).toBe(appId);
    });

    it('returns 404 NOT_FOUND for non-existent or other-tenant case (fail-closed)', async () => {
      const otherTenantApp = getApp(principalB);
      const res = await request(otherTenantApp).get('/v1/lender-cases/lcs_non_existent');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('lists lender cases for an application ordered by attempt number', async () => {
      const tenantSettings = new Map<string, boolean>();
      tenantSettings.set('allow_parallel_lender_attempts', true);
      repository.tenantSettings.set(tenantA, tenantSettings);

      const app = getApp();
      await request(app).post(`/v1/applications/${appId}/lender-cases`).send(validPayload);
      await request(app)
        .post(`/v1/applications/${appId}/lender-cases`)
        .send({
          ...validPayload,
          lenderId: lenderId2,
          empanelmentId: empanelmentId2,
        });

      const listRes = await request(app).get(`/v1/applications/${appId}/lender-cases`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data).toHaveLength(2);
      expect(listRes.body.data[0].attemptNo).toBe(1);
      expect(listRes.body.data[1].attemptNo).toBe(2);
    });

    it('lists all lender cases in tenant scope with optional status filter', async () => {
      const app = getApp();
      await request(app).post(`/v1/applications/${appId}/lender-cases`).send(validPayload);

      const allRes = await request(app).get('/v1/lender-cases');
      expect(allRes.status).toBe(200);
      expect(Array.isArray(allRes.body.data)).toBe(true);
      expect(allRes.body.data.length).toBeGreaterThanOrEqual(1);

      const filteredRes = await request(app).get('/v1/lender-cases?status=DRAFT');
      expect(filteredRes.status).toBe(200);
      expect(filteredRes.body.data.every((c: any) => c.status === 'DRAFT')).toBe(true);
    });
  });

  describe('API-LCS-003: Build Submission Package', () => {
    it('builds frozen package with deterministic sha256 manifest and transitions case to PACKAGE_READY', async () => {
      const app = getApp();
      const createRes = await request(app).post(`/v1/applications/${appId}/lender-cases`).send(validPayload);
      const caseId = createRes.body.id;

      const pkgRes = await request(app)
        .post(`/v1/lender-cases/${caseId}/package`)
        .set('If-Match', '"0"')
        .send({ freeze: true, waivers: ['W-SALARY-SLIP-RELAX'] });

      expect(pkgRes.status).toBe(200);
      expect(pkgRes.body.package.id).toMatch(/^pkg_/);
      expect(pkgRes.body.package.manifestSha256).toHaveLength(64);
      expect(pkgRes.body.package.frozenAt).not.toBeNull();
      expect(pkgRes.body.case.status).toBe('PACKAGE_READY');
      expect(pkgRes.body.case.lockVersion).toBe(1);
    });

    it('rejects package build when SHARE_WITH_LENDER consent is missing with 422 CONSENT_REQUIRED', async () => {
      consentPort.consents.clear(); // remove consent

      const app = getApp();
      const createRes = await request(app).post(`/v1/applications/${appId}/lender-cases`).send(validPayload);
      const caseId = createRes.body.id;

      const pkgRes = await request(app).post(`/v1/lender-cases/${caseId}/package`).send({ freeze: true });

      expect(pkgRes.status).toBe(422);
      expect(pkgRes.body.error.code).toBe('CONSENT_REQUIRED');
    });
  });

  describe('API-LCS-004: Submit Lender Case', () => {
    it('submits case, rolls up application status to SUBMITTED, and records ENT-100 data sharing record', async () => {
      const app = getApp();
      const createRes = await request(app).post(`/v1/applications/${appId}/lender-cases`).send(validPayload);
      const caseId = createRes.body.id;

      await request(app).post(`/v1/lender-cases/${caseId}/package`).send({ freeze: true });

      const submitRes = await request(app)
        .post(`/v1/lender-cases/${caseId}/submission`)
        .set('Idempotency-Key', 'idem_submit_001')
        .send({
          channel: 'PORTAL',
          lenderReference: 'HDFC-REF-2026-001',
        });

      expect(submitRes.status).toBe(200);
      expect(submitRes.body.status).toBe('SUBMITTED');
      expect(submitRes.body.applicationStatus).toBe('SUBMITTED');
      expect(submitRes.body.dataSharingRecordId).toMatch(/^dsr_/);
      expect(repository.dataSharingRecords.size).toBe(1);

      // Verify application status roll-up
      const updatedApp = await repository.findApplication({} as Tx, tenantA, appId);
      expect(updatedApp?.status).toBe('SUBMITTED');
    });

    it('revalidates consent at submission time and blocks when consent was revoked after package build', async () => {
      const app = getApp();
      const createRes = await request(app).post(`/v1/applications/${appId}/lender-cases`).send(validPayload);
      const caseId = createRes.body.id;

      await request(app).post(`/v1/lender-cases/${caseId}/package`).send({ freeze: true });

      // Consent revoked after packaging!
      consentPort.consents.clear();

      const submitRes = await request(app)
        .post(`/v1/lender-cases/${caseId}/submission`)
        .send({ channel: 'PORTAL' });

      expect(submitRes.status).toBe(422);
      expect(submitRes.body.error.code).toBe('CONSENT_REQUIRED');
    });

    it('rejects submission when caller lacks lender_case.submit permission with 403 FORBIDDEN', async () => {
      const app = getApp();
      const createRes = await request(app).post(`/v1/applications/${appId}/lender-cases`).send(validPayload);
      const caseId = createRes.body.id;

      await request(app).post(`/v1/lender-cases/${caseId}/package`).send({ freeze: true });

      const unauthorizedUser = testPrincipal({
        tenantId: tenantA,
        grants: [
          { code: 'application.read', scope: 'TENANT', branchIds: [] },
          { code: 'lender_case.update_status', scope: 'TENANT', branchIds: [] },
        ],
      });
      const unauthApp = getApp(unauthorizedUser);

      const submitRes = await request(unauthApp)
        .post(`/v1/lender-cases/${caseId}/submission`)
        .send({ channel: 'PORTAL' });

      expect(submitRes.status).toBe(403);
      expect(submitRes.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('API-LCS-005: Status Updates & Application Roll-up', () => {
    it('updates status to UNDER_PROCESSING with valid If-Match', async () => {
      const app = getApp();
      const createRes = await request(app).post(`/v1/applications/${appId}/lender-cases`).send(validPayload);
      const caseId = createRes.body.id;
      await request(app).post(`/v1/lender-cases/${caseId}/package`).send({ freeze: true });
      await request(app).post(`/v1/lender-cases/${caseId}/submission`).send({ channel: 'PORTAL' });

      const getRes = await request(app).get(`/v1/lender-cases/${caseId}`);
      const lockVersion = getRes.body.lockVersion;

      const updateRes = await request(app)
        .post(`/v1/lender-cases/${caseId}/status-updates`)
        .set('If-Match', `"${lockVersion}"`)
        .send({
          toStatus: 'UNDER_PROCESSING',
          statusSource: 'MANUAL',
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.status).toBe('UNDER_PROCESSING');
    });

    it('rejects stale version update with 409 VERSION_CONFLICT', async () => {
      const app = getApp();
      const createRes = await request(app).post(`/v1/applications/${appId}/lender-cases`).send(validPayload);
      const caseId = createRes.body.id;
      await request(app).post(`/v1/lender-cases/${caseId}/package`).send({ freeze: true });
      await request(app).post(`/v1/lender-cases/${caseId}/submission`).send({ channel: 'PORTAL' });

      const updateRes = await request(app)
        .post(`/v1/lender-cases/${caseId}/status-updates`)
        .set('If-Match', '"999"')
        .send({ toStatus: 'UNDER_PROCESSING' });

      expect(updateRes.status).toBe(409);
      expect(updateRes.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('rejects invalid state transition with 409 INVALID_TRANSITION', async () => {
      const app = getApp();
      const createRes = await request(app).post(`/v1/applications/${appId}/lender-cases`).send(validPayload);
      const caseId = createRes.body.id;

      // Draft cannot jump directly to SANCTIONED
      const updateRes = await request(app)
        .post(`/v1/lender-cases/${caseId}/status-updates`)
        .set('If-Match', '"0"')
        .send({ toStatus: 'SANCTIONED' });

      expect(updateRes.status).toBe(409);
      expect(updateRes.body.error.code).toBe('INVALID_TRANSITION');
    });

    it('requires declineReasonCode when status is REJECTED', async () => {
      const app = getApp();
      const createRes = await request(app).post(`/v1/applications/${appId}/lender-cases`).send(validPayload);
      const caseId = createRes.body.id;
      await request(app).post(`/v1/lender-cases/${caseId}/package`).send({ freeze: true });
      await request(app).post(`/v1/lender-cases/${caseId}/submission`).send({ channel: 'PORTAL' });

      const getRes = await request(app).get(`/v1/lender-cases/${caseId}`);
      const lockVersion = getRes.body.lockVersion;

      // Missing reason code
      const failRes = await request(app)
        .post(`/v1/lender-cases/${caseId}/status-updates`)
        .set('If-Match', `"${lockVersion}"`)
        .send({ toStatus: 'REJECTED' });

      expect(failRes.status).toBe(422);
      expect(failRes.body.error.code).toBe('VALIDATION_ERROR');

      // Valid reason code
      const successRes = await request(app)
        .post(`/v1/lender-cases/${caseId}/status-updates`)
        .set('If-Match', `"${lockVersion}"`)
        .send({
          toStatus: 'REJECTED',
          declineReasonCode: 'POLICY',
          reasonText: 'Applicant age exceeds policy limit',
        });

      expect(successRes.status).toBe(200);
      expect(successRes.body.status).toBe('REJECTED');
      expect(successRes.body.declineReasonCode).toBe('POLICY');
    });

    it('rolls up application status to SANCTIONED when a lender case is sanctioned', async () => {
      const app = getApp();
      const createRes = await request(app).post(`/v1/applications/${appId}/lender-cases`).send(validPayload);
      const caseId = createRes.body.id;
      await request(app).post(`/v1/lender-cases/${caseId}/package`).send({ freeze: true });
      await request(app).post(`/v1/lender-cases/${caseId}/submission`).send({ channel: 'PORTAL' });

      const getRes = await request(app).get(`/v1/lender-cases/${caseId}`);
      const lockVersion = getRes.body.lockVersion;

      await request(app)
        .post(`/v1/lender-cases/${caseId}/status-updates`)
        .set('If-Match', `"${lockVersion}"`)
        .send({ toStatus: 'SANCTIONED' });

      const updatedApp = await repository.findApplication({} as Tx, tenantA, appId);
      expect(updatedApp?.status).toBe('SANCTIONED');
    });
  });

  describe('API-LCS-006 & API-LCS-007: Queries & Responses Lifecycle', () => {
    it('records lender query, sets sub_status QUERY_PENDING, and responds with QUERY_RESPONSE package', async () => {
      const app = getApp();
      const createRes = await request(app).post(`/v1/applications/${appId}/lender-cases`).send(validPayload);
      const caseId = createRes.body.id;
      await request(app).post(`/v1/lender-cases/${caseId}/package`).send({ freeze: true });
      await request(app).post(`/v1/lender-cases/${caseId}/submission`).send({ channel: 'PORTAL' });

      // Raise Query
      const queryRes = await request(app)
        .post(`/v1/lender-cases/${caseId}/queries`)
        .send({
          text: 'Please provide latest 3 months bank statements',
          requestedItems: ['BANK_STATEMENTS'],
        });

      expect(queryRes.status).toBe(201);
      expect(queryRes.body.query.text).toBe('Please provide latest 3 months bank statements');
      expect(queryRes.body.case.status).toBe('QUERY_RAISED');

      const appAfterQuery = await repository.findApplication({} as Tx, tenantA, appId);
      expect(appAfterQuery?.sub_status).toBe('QUERY_PENDING');

      // Respond to Query
      const queryId = queryRes.body.query.id;
      const respRes = await request(app)
        .post(`/v1/lender-queries/${queryId}/responses`)
        .send({
          text: 'Uploaded 3 months bank statements successfully',
          documentReferences: ['doc_statement_01'],
        });

      expect(respRes.status).toBe(200);
      expect(respRes.body.case.status).toBe('QUERY_RESPONDED');
      expect(respRes.body.query.respondedAt).not.toBeNull();

      const appAfterResp = await repository.findApplication({} as Tx, tenantA, appId);
      expect(appAfterResp?.sub_status).toBeNull();
    });
  });

  describe('Multi-Tenant Isolation', () => {
    it('strictly isolates cases between tenants (Tenant B cannot access Tenant A case)', async () => {
      const appA = getApp(principalA);
      const createRes = await request(appA).post(`/v1/applications/${appId}/lender-cases`).send(validPayload);
      const caseId = createRes.body.id;

      const appB = getApp(principalB);
      const res = await request(appB).get(`/v1/lender-cases/${caseId}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');

      // Tenant B cannot submit Tenant A case -> 404
      const submitRes = await request(appB)
        .post(`/v1/lender-cases/${caseId}/submission`)
        .send({ channel: 'PORTAL' });
      expect(submitRes.status).toBe(404);

      // Tenant B cannot update status of Tenant A case -> 404
      const statusRes = await request(appB)
        .post(`/v1/lender-cases/${caseId}/status-updates`)
        .set('If-Match', '"0"')
        .send({ toStatus: 'UNDER_PROCESSING' });
      expect(statusRes.status).toBe(404);

      // Tenant B cannot list lender cases for Tenant A application -> 404 NOT_FOUND
      const listRes = await request(appB).get(`/v1/applications/${appId}/lender-cases`);
      expect(listRes.status).toBe(404);
      expect(listRes.body.error.code).toBe('NOT_FOUND');
    });
  });
});
