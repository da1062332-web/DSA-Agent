// apps/api/test/verification.spec.ts — owner: Developer 2 (Module 19: Verification)
import type { TxRunner } from '@dsa/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';
import { createMockVerificationStore } from './support/mock-verification-db';

describe('Module 19: Verification API & Integration Tests', () => {
  const verifierPrincipal = testPrincipal({
    id: 'usr_verifier_01',
    tenantId: 'ten_01JTESTTENANT00000000000000',
    grants: [
      { code: 'verification.read', scope: 'TENANT', branchIds: [] },
      { code: 'verification.create', scope: 'TENANT', branchIds: [] },
      { code: 'verification.update', scope: 'TENANT', branchIds: [] },
      { code: 'verification.complete', scope: 'TENANT', branchIds: [] },
      { code: 'document.review', scope: 'TENANT', branchIds: [] },
    ],
  });

  const staffWithoutPerms = testPrincipal({
    id: 'usr_staff_unauthorized',
    tenantId: 'ten_01JTESTTENANT00000000000000',
    grants: [{ code: 'lead.read', scope: 'BRANCH', branchIds: ['br_mumbai'] }],
  });

  const otherTenantVerifier = testPrincipal({
    id: 'usr_foreign_verifier',
    tenantId: 'ten_OTHER_000000000000000000',
    grants: [
      { code: 'verification.read', scope: 'TENANT', branchIds: [] },
      { code: 'verification.complete', scope: 'TENANT', branchIds: [] },
    ],
  });

  it('TEST-VRF-001 rejects unauthenticated request with 401 UNAUTHENTICATED', async () => {
    const store = createMockVerificationStore();
    const app = createTestApp({ deps: { txRunner: store.runner } });

    const res = await request(app).get('/v1/verifications');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('TEST-VRF-002 rejects unauthorized request with 403 FORBIDDEN when lacking verification.read', async () => {
    const store = createMockVerificationStore();
    const app = createTestApp({
      auth: fakeAuth(staffWithoutPerms),
      deps: { txRunner: store.runner },
    });

    const res = await request(app).get('/v1/verifications');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('TEST-VRF-003 lists verification requests for current tenant with filtering', async () => {
    const store = createMockVerificationStore();
    const app = createTestApp({
      auth: fakeAuth(verifierPrincipal),
      deps: { txRunner: store.runner },
    });

    const res = await request(app).get('/v1/verifications');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data[0].tenantId).toBe(verifierPrincipal.tenantId);

    // Filter by verificationType
    const filteredRes = await request(app).get('/v1/verifications?verificationType=RESIDENCE_FI');
    expect(filteredRes.status).toBe(200);
    expect(filteredRes.body.data.length).toBe(1);
    expect(filteredRes.body.data[0].verificationType).toBe('RESIDENCE_FI');
  });

  it('TEST-VRF-004 gets single verification details with ETag header', async () => {
    const store = createMockVerificationStore();
    const app = createTestApp({
      auth: fakeAuth(verifierPrincipal),
      deps: { txRunner: store.runner },
    });

    const res = await request(app).get('/v1/verifications/vrf_01JTESTVRF0000000000000001');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('vrf_01JTESTVRF0000000000000001');
    expect(res.body.verificationType).toBe('DOCUMENT_REVIEW');
    expect(res.header['etag']).toBe('"0"');
  });

  it('TEST-VRF-005 tenant isolation: returns 404 NOT_FOUND for another tenant record', async () => {
    const store = createMockVerificationStore();
    const app = createTestApp({
      auth: fakeAuth(verifierPrincipal), // tenant_A
      deps: { txRunner: store.runner },
    });

    // Foreign record belonging to ten_OTHER
    const res = await request(app).get('/v1/verifications/vrf_01JOTHERTENANT0000000000000');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    // Tenant B can view their own record
    const otherApp = createTestApp({
      auth: fakeAuth(otherTenantVerifier),
      deps: { txRunner: store.runner },
    });
    const otherRes = await request(otherApp).get('/v1/verifications/vrf_01JOTHERTENANT0000000000000');
    expect(otherRes.status).toBe(200);
    expect(otherRes.body.id).toBe('vrf_01JOTHERTENANT0000000000000');
  });

  it('TEST-VRF-006 creates new verification request and returns 201 with vrf_ prefix ID', async () => {
    const store = createMockVerificationStore();
    const app = createTestApp({
      auth: fakeAuth(verifierPrincipal),
      deps: { txRunner: store.runner },
    });

    const payload = {
      applicationId: 'app_01JTESTAPP0000000000000003',
      verificationType: 'EMPLOYMENT',
      branchId: 'br_mumbai',
      priority: 'HIGH',
      findingsSummary: 'Verify salary credit in bank statement and HR confirmation',
      checklistItmIds: ['chk_salary_slip'],
    };

    const res = await request(app).post('/v1/verifications').send(payload);
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^vrf_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(res.body.status).toBe('INITIATED');
    expect(res.body.verificationType).toBe('EMPLOYMENT');
    expect(res.header['etag']).toBe('"0"');
  });

  it('TEST-VRF-007 PATCH requires If-Match header and updates verification record', async () => {
    const store = createMockVerificationStore();
    const app = createTestApp({
      auth: fakeAuth(verifierPrincipal),
      deps: { txRunner: store.runner },
    });

    const targetId = 'vrf_01JTESTVRF0000000000000001';

    // Without If-Match -> 422 VALIDATION_ERROR
    const failRes = await request(app).patch(`/v1/verifications/${targetId}`).send({ priority: 'LOW' });
    expect(failRes.status).toBe(422);

    // With valid If-Match -> 200
    const successRes = await request(app).patch(`/v1/verifications/${targetId}`).set('If-Match', '"0"').send({
      status: 'IN_PROGRESS',
      findingsSummary: 'Document analysis started by underwriters',
    });
    expect(successRes.status).toBe(200);
    expect(successRes.body.status).toBe('IN_PROGRESS');
  });

  it('TEST-VRF-008 completes verification case with POSITIVE outcome', async () => {
    const store = createMockVerificationStore();
    const app = createTestApp({
      auth: fakeAuth(verifierPrincipal),
      deps: { txRunner: store.runner },
    });

    const targetId = 'vrf_01JTESTVRF0000000000000002'; // created by usr_creator_01, verifier is usr_verifier_01

    const completePayload = {
      outcome: 'POSITIVE',
      findingsSummary: 'Physical address verified in person. Met applicant and confirmed utility bill.',
      markStatus: 'VERIFIED',
    };

    const res = await request(app).post(`/v1/verifications/${targetId}/complete`).send(completePayload);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('VERIFIED');
    expect(res.body.outcome).toBe('POSITIVE');
    expect(res.body.verifiedBy).toBe(verifierPrincipal.id);
    expect(res.body.completedAt).toBeDefined();
  });

  it('TEST-VRF-009 rejects complete request when marked REJECTED without rejectionReason', async () => {
    const store = createMockVerificationStore();
    const app = createTestApp({
      auth: fakeAuth(verifierPrincipal),
      deps: { txRunner: store.runner },
    });

    const targetId = 'vrf_01JTESTVRF0000000000000002';

    const invalidPayload = {
      outcome: 'NEGATIVE',
      findingsSummary: 'Field check failed to locate applicant address.',
      markStatus: 'REJECTED',
      // rejectionReason missing
    };

    const res = await request(app).post(`/v1/verifications/${targetId}/complete`).send(invalidPayload);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('TEST-VRF-010 reviews and attests document checklist item', async () => {
    const store = createMockVerificationStore();
    const app = createTestApp({
      auth: fakeAuth(verifierPrincipal),
      deps: { txRunner: store.runner },
    });

    const targetVrfId = 'vrf_01JTESTVRF0000000000000001';

    const reviewPayload = {
      checklistItemId: 'chk_pan_01',
      status: 'ACCEPTED',
      attestationNote: 'PAN card verified with income tax records. Name and photo match primary applicant.',
    };

    const res = await request(app)
      .post(`/v1/verifications/${targetVrfId}/checklist-review`)
      .send(reviewPayload);

    expect(res.status).toBe(200);
    expect(res.body.checklistItemId).toBe('chk_pan_01');
    expect(res.body.status).toBe('ACCEPTED');
    expect(res.body.reviewedBy).toBe(verifierPrincipal.id);
  });

  it('TEST-VRF-011 rejects creating verification case with missing required fields', async () => {
    const store = createMockVerificationStore();
    const app = createTestApp({
      auth: fakeAuth(verifierPrincipal),
      deps: { txRunner: store.runner },
    });

    // Missing applicationId and branchId
    const res = await request(app).post('/v1/verifications').send({ verificationType: 'DOCUMENT_REVIEW' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');

    // Invalid verificationType enum
    const res2 = await request(app).post('/v1/verifications').send({
      applicationId: 'app_1',
      branchId: 'br_mumbai',
      verificationType: 'INVALID_TYPE',
    });

    expect(res2.status).toBe(422);
    expect(res2.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('TEST-VRF-012 security: client cannot tamper with tenantId or actor in verification creation', async () => {
    const store = createMockVerificationStore();
    const app = createTestApp({
      auth: fakeAuth(verifierPrincipal),
      deps: { txRunner: store.runner },
    });

    // Client supplies malicious foreign tenantId and created_by
    const res = await request(app).post('/v1/verifications').send({
      applicationId: 'app_1',
      branchId: 'br_mumbai',
      verificationType: 'IDENTITY_KYC',
      tenantId: 'ten_MALICIOUS',
      created_by: 'usr_hacker',
    });

    expect(res.status).toBe(201);
    expect(res.body.tenantId).toBe(verifierPrincipal.tenantId);
    expect(res.body.createdBy).toBe(verifierPrincipal.id);
  });

  it('TEST-VRF-013 returns 404 NOT_FOUND for nonexistent ID on GET /v1/verifications/:id', async () => {
    const store = createMockVerificationStore();
    const app = createTestApp({
      auth: fakeAuth(verifierPrincipal),
      deps: { txRunner: store.runner },
    });

    const res = await request(app).get('/v1/verifications/vrf_NONEXISTENT_9999999');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('TEST-VRF-014 returns 404 NOT_FOUND for nonexistent ID on PATCH /v1/verifications/:id', async () => {
    const store = createMockVerificationStore();
    const app = createTestApp({
      auth: fakeAuth(verifierPrincipal),
      deps: { txRunner: store.runner },
    });

    const res = await request(app)
      .patch('/v1/verifications/vrf_NONEXISTENT_9999999')
      .set('If-Match', '"0"')
      .send({ priority: 'LOW' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('TEST-VRF-015 returns 409 VERSION_CONFLICT when updating with stale If-Match version', async () => {
    const store = createMockVerificationStore();
    const app = createTestApp({
      auth: fakeAuth(verifierPrincipal),
      deps: { txRunner: store.runner },
    });

    // Record vrf_01JTESTVRF0000000000000001 has lockVersion 0, provide stale 99
    const res = await request(app)
      .patch('/v1/verifications/vrf_01JTESTVRF0000000000000001')
      .set('If-Match', '"99"')
      .send({ priority: 'LOW' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('TEST-VRF-016 separation of duties: submitter cannot complete their own initiated verification', async () => {
    const store = createMockVerificationStore();
    // usr_creator_01 created vrf_01JTESTVRF0000000000000001
    const creatorPrincipal = testPrincipal({
      id: 'usr_creator_01',
      tenantId: 'ten_01JTESTTENANT00000000000000',
      grants: [
        { code: 'verification.read', scope: 'TENANT', branchIds: [] },
        { code: 'verification.complete', scope: 'TENANT', branchIds: [] },
      ],
    });

    const app = createTestApp({
      auth: fakeAuth(creatorPrincipal),
      deps: { txRunner: store.runner },
    });

    const res = await request(app).post('/v1/verifications/vrf_01JTESTVRF0000000000000001/complete').send({
      outcome: 'POSITIVE',
      findingsSummary: 'Self check attempt by submitter',
      markStatus: 'VERIFIED',
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toContain('Separation of duties');
  });

  it('TEST-VRF-017 returns 404 NOT_FOUND for nonexistent ID on POST /v1/verifications/:id/complete', async () => {
    const store = createMockVerificationStore();
    const app = createTestApp({
      auth: fakeAuth(verifierPrincipal),
      deps: { txRunner: store.runner },
    });

    const res = await request(app).post('/v1/verifications/vrf_NONEXISTENT_9999999/complete').send({
      outcome: 'POSITIVE',
      findingsSummary: 'Valid findings for nonexistent',
      markStatus: 'VERIFIED',
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('TEST-VRF-018 rejects completion when findingsSummary is shorter than 5 characters', async () => {
    const store = createMockVerificationStore();
    const app = createTestApp({
      auth: fakeAuth(verifierPrincipal),
      deps: { txRunner: store.runner },
    });

    const res = await request(app).post('/v1/verifications/vrf_01JTESTVRF0000000000000002/complete').send({
      outcome: 'POSITIVE',
      findingsSummary: 'Tiny', // < 5 chars
      markStatus: 'VERIFIED',
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('TEST-VRF-019 returns 404 NOT_FOUND when attesting checklist item on nonexistent verification case', async () => {
    const store = createMockVerificationStore();
    const app = createTestApp({
      auth: fakeAuth(verifierPrincipal),
      deps: { txRunner: store.runner },
    });

    const res = await request(app).post('/v1/verifications/vrf_NONEXISTENT_9999999/checklist-review').send({
      checklistItemId: 'chk_pan_01',
      status: 'ACCEPTED',
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('TEST-VRF-020 returns 404 NOT_FOUND when attesting nonexistent checklist item ID', async () => {
    const store = createMockVerificationStore();
    const app = createTestApp({
      auth: fakeAuth(verifierPrincipal),
      deps: { txRunner: store.runner },
    });

    const res = await request(app)
      .post('/v1/verifications/vrf_01JTESTVRF0000000000000001/checklist-review')
      .send({
        checklistItemId: 'chk_DOES_NOT_EXIST',
        status: 'ACCEPTED',
      });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('TEST-VRF-021 rejects checklist attestation marked REJECTED without rejectReason', async () => {
    const store = createMockVerificationStore();
    const app = createTestApp({
      auth: fakeAuth(verifierPrincipal),
      deps: { txRunner: store.runner },
    });

    const res = await request(app)
      .post('/v1/verifications/vrf_01JTESTVRF0000000000000001/checklist-review')
      .send({
        checklistItemId: 'chk_pan_01',
        status: 'REJECTED',
        // rejectReason omitted
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('TEST-VRF-022 authorization guard: denies POST /v1/verifications without verification.create', async () => {
    const store = createMockVerificationStore();
    const readOnlyUser = testPrincipal({
      id: 'usr_readonly',
      tenantId: 'ten_01JTESTTENANT00000000000000',
      grants: [{ code: 'verification.read', scope: 'TENANT', branchIds: [] }],
    });

    const app = createTestApp({
      auth: fakeAuth(readOnlyUser),
      deps: { txRunner: store.runner },
    });

    const res = await request(app).post('/v1/verifications').send({
      applicationId: 'app_1',
      branchId: 'br_mumbai',
      verificationType: 'DOCUMENT_REVIEW',
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('TEST-VRF-023 authorization guard: denies PATCH /v1/verifications/:id without verification.update', async () => {
    const store = createMockVerificationStore();
    const readOnlyUser = testPrincipal({
      id: 'usr_readonly',
      tenantId: 'ten_01JTESTTENANT00000000000000',
      grants: [{ code: 'verification.read', scope: 'TENANT', branchIds: [] }],
    });

    const app = createTestApp({
      auth: fakeAuth(readOnlyUser),
      deps: { txRunner: store.runner },
    });

    const res = await request(app)
      .patch('/v1/verifications/vrf_01JTESTVRF0000000000000001')
      .set('If-Match', '"0"')
      .send({ priority: 'LOW' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('TEST-VRF-024 authorization guard: denies POST /v1/verifications/:id/complete without verification.complete', async () => {
    const store = createMockVerificationStore();
    const updaterUser = testPrincipal({
      id: 'usr_updater',
      tenantId: 'ten_01JTESTTENANT00000000000000',
      grants: [
        { code: 'verification.read', scope: 'TENANT', branchIds: [] },
        { code: 'verification.update', scope: 'TENANT', branchIds: [] },
      ],
    });

    const app = createTestApp({
      auth: fakeAuth(updaterUser),
      deps: { txRunner: store.runner },
    });

    const res = await request(app).post('/v1/verifications/vrf_01JTESTVRF0000000000000002/complete').send({
      outcome: 'POSITIVE',
      findingsSummary: 'Completed investigation notes',
      markStatus: 'VERIFIED',
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('TEST-VRF-025 authorization guard: denies checklist review without document.review', async () => {
    const store = createMockVerificationStore();
    const verifierWithoutReview = testPrincipal({
      id: 'usr_no_review',
      tenantId: 'ten_01JTESTTENANT00000000000000',
      grants: [
        { code: 'verification.read', scope: 'TENANT', branchIds: [] },
        { code: 'verification.complete', scope: 'TENANT', branchIds: [] },
      ],
    });

    const app = createTestApp({
      auth: fakeAuth(verifierWithoutReview),
      deps: { txRunner: store.runner },
    });

    const res = await request(app)
      .post('/v1/verifications/vrf_01JTESTVRF0000000000000001/checklist-review')
      .send({
        checklistItemId: 'chk_pan_01',
        status: 'ACCEPTED',
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('TEST-VRF-026 branch scoping: user with Mumbai branch grant cannot see Pune verification case', async () => {
    const store = createMockVerificationStore();
    const mumbaiUser = testPrincipal({
      id: 'usr_mumbai_only',
      tenantId: 'ten_01JTESTTENANT00000000000000',
      grants: [{ code: 'verification.read', scope: 'BRANCH', branchIds: ['br_mumbai'] }],
    });

    const app = createTestApp({
      auth: fakeAuth(mumbaiUser),
      deps: { txRunner: store.runner },
    });

    const res = await request(app).get('/v1/verifications');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].branchId).toBe('br_mumbai');
    expect(res.body.data[0].id).toBe('vrf_01JTESTVRF0000000000000001');
  });

  it('TEST-VRF-027 database error handling: unexpected database exception returns clean error without leaking internals', async () => {
    const failingRunner: TxRunner = {
      withTenantTx: async () => {
        throw new Error('Database connection failed at postgresql://user:secretpass@db.local:5432');
      },
    };

    const app = createTestApp({
      auth: fakeAuth(verifierPrincipal),
      deps: { txRunner: failingRunner },
    });

    const res = await request(app).get('/v1/verifications');
    expect(res.status).toBe(500);
    // Crucial security check: Error response must NOT leak database host or password
    expect(JSON.stringify(res.body)).not.toContain('secretpass');
    expect(JSON.stringify(res.body)).not.toContain('postgresql://');
  });
});
