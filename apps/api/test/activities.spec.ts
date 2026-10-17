// apps/api/test/activities.spec.ts
import { describe, expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';
import { ActivityService } from '../src/modules/crm/activities/activity-service';
import type { PermissionGrant } from '@dsa/contracts';

const TENANT_1 = 'ten_01JTESTTENANT00000000000000';
const TENANT_2 = 'ten_01JOTHERTENANT0000000000000';

const USER_1 = 'usr_01JTESTUSER0000000000000000';
const USER_2 = 'usr_01JOTHERUSER000000000000000';

const BRANCH_MUMBAI = 'br_01JMUMBAI000000000000000000';
const BRANCH_DELHI = 'br_01JDELHI0000000000000000000';

const LEAD_1 = 'lead_01JTESTLEAD000000000000001';
const LEAD_OTHER_TENANT = 'lead_01JOTHERLEAD00000000000001';
const CUSTOMER_1 = 'cust_01JTESTCUST000000000000001';
const APPLICATION_1 = 'app_01JTESTAPP0000000000000001';

const createGrants: PermissionGrant[] = [
  { code: 'activity.create', scope: 'TENANT', branchIds: [] },
  { code: 'activity.update', scope: 'TENANT', branchIds: [] },
];

describe('Module 10: Activity (MOD-ACT) API & Integration Tests', () => {
  beforeEach(() => {
    ActivityService.resetMemoryStore();

    // Seed test subjects in tenant 1
    ActivityService.seedSubject({
      id: LEAD_1,
      tenantId: TENANT_1,
      branchId: BRANCH_MUMBAI,
      ownerUserId: USER_1,
    });

    ActivityService.seedSubject({
      id: CUSTOMER_1,
      tenantId: TENANT_1,
      branchId: BRANCH_MUMBAI,
      ownerUserId: USER_1,
    });

    ActivityService.seedSubject({
      id: APPLICATION_1,
      tenantId: TENANT_1,
      branchId: BRANCH_MUMBAI,
      ownerUserId: USER_1,
    });

    // Seed cross-tenant subject in tenant 2
    ActivityService.seedSubject({
      id: LEAD_OTHER_TENANT,
      tenantId: TENANT_2,
      branchId: BRANCH_DELHI,
      ownerUserId: USER_2,
    });
  });

  it('TC-ACT-001 authorized user creates an activity against a lead', async () => {
    const principal = testPrincipal({
      tenantId: TENANT_1,
      id: USER_1,
      primaryBranchId: BRANCH_MUMBAI,
      grants: createGrants,
    });
    const app = createTestApp({ auth: fakeAuth(principal) });

    const res = await request(app).post('/v1/activities').set('Idempotency-Key', 'idem_key_001_lead').send({
      kind: 'CALL',
      subjectType: 'LEAD',
      subjectId: LEAD_1,
      outcomeCode: 'CONNECTED',
      occurredAt: '2026-10-12T10:30:00.000Z',
      durationSeconds: 95,
      note: 'Customer interested in business loan; discussed eligibility criteria.',
    });

    expect(res.status).toBe(201);
    expect(res.headers.etag).toBe('"0"');
    expect(res.body.id).toMatch(/^act_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(res.body.tenantId).toBe(TENANT_1);
    expect(res.body.subjectType).toBe('LEAD');
    expect(res.body.subjectId).toBe(LEAD_1);
    expect(res.body.actorId).toBe(USER_1);
    expect(res.body.actorBranchId).toBe(BRANCH_MUMBAI);
    expect(res.body.kind).toBe('CALL');
    expect(res.body.outcomeCode).toBe('CONNECTED');
    expect(res.body.durationSeconds).toBe(95);
    expect(res.body.lockVersion).toBe(0);
    expect(res.body.isHidden).toBe(false);

    // Verify audit event was logged
    const audits = ActivityService.getAuditLog();
    expect(audits.some((a) => a.action === 'activity.created' && a.entityId === res.body.id)).toBe(true);
  });

  it('TC-ACT-002 authorized user creates an activity against a customer', async () => {
    const principal = testPrincipal({
      tenantId: TENANT_1,
      id: USER_1,
      primaryBranchId: BRANCH_MUMBAI,
      grants: createGrants,
    });
    const app = createTestApp({ auth: fakeAuth(principal) });

    const res = await request(app).post('/v1/activities').set('Idempotency-Key', 'idem_key_002_cust').send({
      kind: 'MEETING',
      subjectType: 'CUSTOMER',
      subjectId: CUSTOMER_1,
      outcomeCode: 'CONNECTED',
      occurredAt: '2026-10-12T11:00:00.000Z',
      note: 'Branch visit completed; customer signed application forms.',
    });

    expect(res.status).toBe(201);
    expect(res.body.subjectType).toBe('CUSTOMER');
    expect(res.body.subjectId).toBe(CUSTOMER_1);
    expect(res.body.kind).toBe('MEETING');
  });

  it('TC-ACT-003 authorized user creates an activity against a loan application', async () => {
    const principal = testPrincipal({
      tenantId: TENANT_1,
      id: USER_1,
      primaryBranchId: BRANCH_MUMBAI,
      grants: createGrants,
    });
    const app = createTestApp({ auth: fakeAuth(principal) });

    const res = await request(app).post('/v1/activities').set('Idempotency-Key', 'idem_key_003_app').send({
      kind: 'NOTE',
      subjectType: 'LOAN_APPLICATION',
      subjectId: APPLICATION_1,
      occurredAt: '2026-10-12T11:30:00.000Z',
      note: 'Underwriting verification in progress; verified income docs.',
    });

    expect(res.status).toBe(201);
    expect(res.body.subjectType).toBe('LOAN_APPLICATION');
    expect(res.body.subjectId).toBe(APPLICATION_1);
    expect(res.body.kind).toBe('NOTE');
  });

  it('TC-ACT-004 invalid or missing subject is rejected with 404', async () => {
    const principal = testPrincipal({
      tenantId: TENANT_1,
      id: USER_1,
      grants: createGrants,
    });
    const app = createTestApp({ auth: fakeAuth(principal) });

    const res = await request(app)
      .post('/v1/activities')
      .set('Idempotency-Key', 'idem_key_nonexistent')
      .send({
        kind: 'NOTE',
        subjectType: 'LEAD',
        subjectId: 'lead_01JNONEXISTENT00000000000000',
        occurredAt: '2026-10-12T10:00:00.000Z',
        note: 'Attempting to log on non-existent lead',
      });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('TC-ACT-005 cross-tenant subject reference is rejected with 404 without leaking info', async () => {
    const principal = testPrincipal({
      tenantId: TENANT_1,
      id: USER_1,
      grants: createGrants,
    });
    const app = createTestApp({ auth: fakeAuth(principal) });

    // Try to link to a lead from Tenant 2 while authenticated in Tenant 1
    const res = await request(app)
      .post('/v1/activities')
      .set('Idempotency-Key', 'idem_key_cross_tenant')
      .send({
        kind: 'NOTE',
        subjectType: 'LEAD',
        subjectId: LEAD_OTHER_TENANT,
        occurredAt: '2026-10-12T10:00:00.000Z',
        note: 'Cross-tenant attack attempt',
      });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('TC-ACT-006 user without activity.create is denied with 403 FORBIDDEN', async () => {
    const principal = testPrincipal({
      tenantId: TENANT_1,
      id: USER_1,
      grants: [{ code: 'lead.read', scope: 'TENANT', branchIds: [] }], // lacks activity.create
    });
    const app = createTestApp({ auth: fakeAuth(principal) });

    const res = await request(app).post('/v1/activities').set('Idempotency-Key', 'idem_key_forbidden').send({
      kind: 'NOTE',
      subjectType: 'LEAD',
      subjectId: LEAD_1,
      occurredAt: '2026-10-12T10:00:00.000Z',
      note: 'Unauthorized note',
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('TC-ACT-007 user without activity.update cannot edit or hide (403)', async () => {
    // First create an activity
    const creator = testPrincipal({
      tenantId: TENANT_1,
      id: USER_1,
      grants: createGrants,
    });
    const appCreator = createTestApp({ auth: fakeAuth(creator) });
    const created = await request(appCreator)
      .post('/v1/activities')
      .set('Idempotency-Key', 'idem_key_to_update')
      .send({
        kind: 'NOTE',
        subjectType: 'LEAD',
        subjectId: LEAD_1,
        occurredAt: '2026-10-12T10:00:00.000Z',
        note: 'Original note',
      });
    expect(created.status).toBe(201);

    // Another user in same tenant lacks activity.update
    const readerOnly = testPrincipal({
      tenantId: TENANT_1,
      id: USER_2,
      grants: [{ code: 'lead.read', scope: 'TENANT', branchIds: [] }],
    });
    const appReader = createTestApp({ auth: fakeAuth(readerOnly) });

    const updateRes = await request(appReader)
      .patch(`/v1/activities/${created.body.id}`)
      .set('If-Match', '"0"')
      .send({ note: 'Trying to update without permission' });

    expect(updateRes.status).toBe(403);
    expect(updateRes.body.error.code).toBe('FORBIDDEN');
  });

  it('TC-ACT-008 out-of-scope subject reference is rejected with 404', async () => {
    // Subject is in BRANCH_MUMBAI; user only has BRANCH scope for BRANCH_DELHI
    const branchDelhiUser = testPrincipal({
      tenantId: TENANT_1,
      id: USER_2,
      primaryBranchId: BRANCH_DELHI,
      grants: [{ code: 'activity.create', scope: 'BRANCH', branchIds: [BRANCH_DELHI] }],
    });
    const app = createTestApp({ auth: fakeAuth(branchDelhiUser) });

    const res = await request(app).post('/v1/activities').set('Idempotency-Key', 'idem_scope_fail').send({
      kind: 'NOTE',
      subjectType: 'LEAD',
      subjectId: LEAD_1, // in BRANCH_MUMBAI
      occurredAt: '2026-10-12T10:00:00.000Z',
      note: 'Out of branch scope attempt',
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('TC-ACT-009 actor identity cannot be spoofed by client payload', async () => {
    const principal = testPrincipal({
      tenantId: TENANT_1,
      id: USER_1,
      primaryBranchId: BRANCH_MUMBAI,
      grants: createGrants,
    });
    const app = createTestApp({ auth: fakeAuth(principal) });

    const res = await request(app).post('/v1/activities').set('Idempotency-Key', 'idem_spoof_check').send({
      kind: 'NOTE',
      subjectType: 'LEAD',
      subjectId: LEAD_1,
      occurredAt: '2026-10-12T10:00:00.000Z',
      note: 'Valid note',
      actorId: 'usr_MALICIOUS_SPOOFED_ID',
      tenantId: 'ten_MALICIOUS_SPOOFED_ID',
    });

    expect(res.status).toBe(201);
    expect(res.body.actorId).toBe(USER_1); // always bound to authenticated principal
    expect(res.body.tenantId).toBe(TENANT_1);
  });

  it('TC-ACT-010 free-text note with PAN, Aadhaar, or account number rejected with 422', async () => {
    const principal = testPrincipal({
      tenantId: TENANT_1,
      id: USER_1,
      grants: createGrants,
    });
    const app = createTestApp({ auth: fakeAuth(principal) });

    // Reject PAN
    const panRes = await request(app).post('/v1/activities').set('Idempotency-Key', 'idem_pan').send({
      kind: 'NOTE',
      subjectType: 'LEAD',
      subjectId: LEAD_1,
      occurredAt: '2026-10-12T10:00:00.000Z',
      note: 'Customer PAN is ABCDE1234F',
    });
    expect(panRes.status).toBe(422);
    expect(panRes.body.error.code).toBe('VALIDATION_ERROR');

    // Reject Aadhaar
    const aadhaarRes = await request(app).post('/v1/activities').set('Idempotency-Key', 'idem_aadhaar').send({
      kind: 'NOTE',
      subjectType: 'LEAD',
      subjectId: LEAD_1,
      occurredAt: '2026-10-12T10:00:00.000Z',
      note: 'Aadhaar 2345 6789 0123 collected',
    });
    expect(aadhaarRes.status).toBe(422);

    // Reject Account number
    const acctRes = await request(app).post('/v1/activities').set('Idempotency-Key', 'idem_acct').send({
      kind: 'NOTE',
      subjectType: 'LEAD',
      subjectId: LEAD_1,
      occurredAt: '2026-10-12T10:00:00.000Z',
      note: 'Bank account number 123456789012 recorded',
    });
    expect(acctRes.status).toBe(422);
  });

  it('TC-ACT-011 idempotent retries do not duplicate records and return cached response', async () => {
    const principal = testPrincipal({
      tenantId: TENANT_1,
      id: USER_1,
      grants: createGrants,
    });
    const app = createTestApp({ auth: fakeAuth(principal) });

    const key = 'idem_key_repeatable_123';
    const payload = {
      kind: 'NOTE',
      subjectType: 'LEAD',
      subjectId: LEAD_1,
      occurredAt: '2026-10-12T10:00:00.000Z',
      note: 'Idempotency test interaction note',
    };

    // First request
    const firstRes = await request(app).post('/v1/activities').set('Idempotency-Key', key).send(payload);
    expect(firstRes.status).toBe(201);
    const originalId = firstRes.body.id;

    // Second request with same key
    const secondRes = await request(app).post('/v1/activities').set('Idempotency-Key', key).send(payload);
    expect(secondRes.status).toBe(200);
    expect(secondRes.headers['idempotent-replayed']).toBe('true');
    expect(secondRes.body.id).toBe(originalId);
  });

  it('TC-ACT-012 concurrency check: stale If-Match returns 409 VERSION_CONFLICT', async () => {
    const principal = testPrincipal({
      tenantId: TENANT_1,
      id: USER_1,
      grants: createGrants,
    });
    const app = createTestApp({ auth: fakeAuth(principal) });

    const created = await request(app)
      .post('/v1/activities')
      .set('Idempotency-Key', 'idem_conflict_test')
      .send({
        kind: 'NOTE',
        subjectType: 'LEAD',
        subjectId: LEAD_1,
        occurredAt: '2026-10-12T10:00:00.000Z',
        note: 'Before concurrent edit',
      });
    expect(created.status).toBe(201);
    expect(created.body.lockVersion).toBe(0);

    // Stale version provided (e.g. 99 instead of 0)
    const staleRes = await request(app)
      .patch(`/v1/activities/${created.body.id}`)
      .set('If-Match', '"99"')
      .send({ note: 'Attempting update with stale ETag' });

    expect(staleRes.status).toBe(409);
    expect(staleRes.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('TC-ACT-013 valid update updates record, bumps lockVersion, and updates ETag', async () => {
    const principal = testPrincipal({
      tenantId: TENANT_1,
      id: USER_1,
      grants: createGrants,
    });
    const app = createTestApp({ auth: fakeAuth(principal) });

    const created = await request(app).post('/v1/activities').set('Idempotency-Key', 'idem_update_ok').send({
      kind: 'CALL',
      subjectType: 'LEAD',
      subjectId: LEAD_1,
      outcomeCode: 'NO_ANSWER',
      occurredAt: '2026-10-12T10:00:00.000Z',
      note: 'No answer on first ring',
    });
    expect(created.status).toBe(201);

    // Valid update matching ETag "0"
    const updateRes = await request(app)
      .patch(`/v1/activities/${created.body.id}`)
      .set('If-Match', '"0"')
      .send({
        outcomeCode: 'CONNECTED',
        durationSeconds: 180,
        note: 'Customer picked up callback; scheduled loan review.',
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.headers.etag).toBe('"1"');
    expect(updateRes.body.lockVersion).toBe(1);
    expect(updateRes.body.outcomeCode).toBe('CONNECTED');
    expect(updateRes.body.durationSeconds).toBe(180);
    expect(updateRes.body.note).toBe('Customer picked up callback; scheduled loan review.');

    // Verify audit event
    const audits = ActivityService.getAuditLog();
    expect(audits.some((a) => a.action === 'activity.updated' && a.entityId === created.body.id)).toBe(true);
  });

  it('TC-ACT-014 soft hiding an activity sets isHidden and emits audit event', async () => {
    const principal = testPrincipal({
      tenantId: TENANT_1,
      id: USER_1,
      grants: createGrants,
    });
    const app = createTestApp({ auth: fakeAuth(principal) });

    const created = await request(app).post('/v1/activities').set('Idempotency-Key', 'idem_hide_test').send({
      kind: 'NOTE',
      subjectType: 'LEAD',
      subjectId: LEAD_1,
      occurredAt: '2026-10-12T10:00:00.000Z',
      note: 'To be hidden',
    });
    expect(created.status).toBe(201);

    // Hide activity
    const hideRes = await request(app)
      .patch(`/v1/activities/${created.body.id}`)
      .set('If-Match', '"0"')
      .send({ isHidden: true });

    expect(hideRes.status).toBe(200);
    expect(hideRes.body.isHidden).toBe(true);
    expect(hideRes.body.lockVersion).toBe(1);

    // Verify subsequent GET returns 404 (hidden record)
    const getRes = await request(app).get(`/v1/activities/${created.body.id}`);
    expect(getRes.status).toBe(404);

    // Verify audit event for hiding
    const audits = ActivityService.getAuditLog();
    expect(audits.some((a) => a.action === 'activity.hidden' && a.entityId === created.body.id)).toBe(true);
  });

  it('TC-ACT-015 GET /v1/activities lists activities filtered by subject', async () => {
    const principal = testPrincipal({
      tenantId: TENANT_1,
      id: USER_1,
      grants: createGrants,
    });
    const app = createTestApp({ auth: fakeAuth(principal) });

    await request(app).post('/v1/activities').set('Idempotency-Key', 'idem_list_1').send({
      kind: 'NOTE',
      subjectType: 'LEAD',
      subjectId: LEAD_1,
      occurredAt: '2026-10-12T09:00:00.000Z',
      note: 'First note',
    });

    await request(app).post('/v1/activities').set('Idempotency-Key', 'idem_list_2').send({
      kind: 'NOTE',
      subjectType: 'LEAD',
      subjectId: LEAD_1,
      occurredAt: '2026-10-12T10:00:00.000Z',
      note: 'Second note',
    });

    const listRes = await request(app)
      .get('/v1/activities')
      .query({ subjectType: 'LEAD', subjectId: LEAD_1 });

    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(2);
    expect(listRes.body.meta.limit).toBe(50);
  });
});
