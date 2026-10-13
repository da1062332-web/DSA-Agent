// apps/api/test/leads.spec.ts — owner: Dev 5 (MOD-04 Leads test suite)
import type { RequestContext, Tx, TxRunner } from '@dsa/contracts';
import { FakeUserDirectoryPort } from '@dsa/contracts/fakes';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryLeadRepository } from '../src/modules/crm/leads/repository';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const inMemoryTxRunner: TxRunner = {
  async withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return fn({} as Tx);
  },
};

describe('Module 7 — Leads (MOD-LEAD)', () => {
  let repository: InMemoryLeadRepository;

  const tenantA = 'ten_01JTESTTENANTA0000000000000';
  const tenantB = 'ten_01JTESTTENANTB0000000000000';

  const principalA = testPrincipal({
    tenantId: tenantA,
    grants: [
      { code: 'lead.create', scope: 'TENANT', branchIds: [] },
      { code: 'lead.read', scope: 'TENANT', branchIds: [] },
      { code: 'lead.update', scope: 'TENANT', branchIds: [] },
      { code: 'lead.qualify', scope: 'TENANT', branchIds: [] },
      { code: 'lead.assign', scope: 'TENANT', branchIds: [] },
      { code: 'application.create', scope: 'TENANT', branchIds: [] },
    ],
  });

  const principalB = testPrincipal({
    tenantId: tenantB,
    grants: [
      { code: 'lead.read', scope: 'TENANT', branchIds: [] },
      { code: 'application.create', scope: 'TENANT', branchIds: [] },
    ],
  });

  beforeEach(() => {
    repository = new InMemoryLeadRepository();
  });

  function getApp(principal = principalA, userDirectoryPort?: FakeUserDirectoryPort) {
    return createTestApp({
      auth: fakeAuth(principal),
      deps: {
        txRunner: inMemoryTxRunner,
        leadRepository: repository,
        userDirectoryPort,
      },
    });
  }

  const validLeadPayload = {
    fullName: 'John Doe',
    mobile: '9876543210',
    email: 'john.doe@example.com',
    productCategory: 'PL',
    indicativeAmount: { amount: '500000.00', currency: 'INR' },
    pincode: '560001',
    branchId: 'br_blr_01',
    source: 'WALK_IN',
    consent: {
      purpose: 'CONTACT',
      noticeVersion: 'v1.0',
      channel: 'IN_PERSON',
    },
  };

  async function createQualifiedLead(app: ReturnType<typeof getApp>): Promise<{ id: string; etag: string }> {
    const createRes = await request(app)
      .post('/v1/leads')
      .set('Idempotency-Key', `conv_setup_${Date.now()}_${Math.random().toString(36).slice(2)}`)
      .send(validLeadPayload);

    const leadId = createRes.body.id;

    const qualifyRes = await request(app)
      .post(`/v1/leads/${leadId}/transitions`)
      .set('If-Match', '"0"')
      .set('Idempotency-Key', `conv_qual_${Date.now()}_${Math.random().toString(36).slice(2)}`)
      .send({
        transitionCode: 'T-LEAD-04',
        qualification: {
          applicantType: 'SALARIED',
          requestedAmount: { amount: '450000.00', currency: 'INR' },
          tenureMonths: 36,
          purposeCode: 'PERSONAL_NEEDS',
        },
      });

    return { id: leadId, etag: (qualifyRes.headers.etag as string) || '"2"' };
  }

  describe('API-LEAD-001 POST /v1/leads — Create Lead', () => {
    it('TC-LEAD-001 creates a NEW lead with consent, ETag, and masked mobile', async () => {
      const app = getApp();
      const res = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_create_001')
        .send(validLeadPayload);

      expect(res.status).toBe(201);
      expect(res.headers.etag).toBe('"0"');
      expect(res.body.id).toMatch(/^lead_/);
      expect(res.body.state).toBe('NEW');
      expect(res.body.mobileMasked).toBe('+91 ****** 3210');
      expect(res.body.emailMasked).toBe('j***e@example.com');
      expect(res.body.productCategory).toBe('PL');
      expect(res.body.duplicateFlag).toBe('NONE');
      expect(res.body.lockVersion).toBe(0);

      // Verify persistence in repository
      const savedLead = await repository.findLeadById({} as Tx, tenantA, res.body.id);
      expect(savedLead).not.toBeNull();
      expect(savedLead?.mobile_e164).toBe('+919876543210');
      expect(savedLead?.owner_user_id).toBe(principalA.id);

      // Verify consent record
      expect(repository.consents.size).toBe(1);
      const consent = Array.from(repository.consents.values())[0];
      expect(consent?.subject_id).toBe(res.body.id);
      expect(consent?.status).toBe('ACTIVE');

      // Verify status history
      expect(repository.statusHistories.length).toBe(1);
      expect(repository.statusHistories[0]?.transition_code).toBe('CREATE');
      expect(repository.statusHistories[0]?.to_state).toBe('NEW');

      // Verify outbox & audit events
      expect(repository.outboxEvents.some((e) => e.event_type === 'lead.created')).toBe(true);
      expect(repository.outboxEvents.some((e) => e.event_type === 'consent.granted')).toBe(true);
      expect(repository.auditEvents.some((e) => e.action === 'lead.created')).toBe(true);
    });

    it('TC-LEAD-002 rejects request with 422 VALIDATION_ERROR when required fields are missing', async () => {
      const app = getApp();
      const res = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_create_invalid')
        .send({
          fullName: 'J', // too short
          mobile: 'not-a-number',
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('TC-LEAD-003 rejects S3 restricted data (PAN/Aadhaar) with 422 VALIDATION_ERROR', async () => {
      const app = getApp();
      const res = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_create_s3')
        .send({
          ...validLeadPayload,
          fullName: 'Customer with PAN ABCDE1234F',
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toMatch(/PAN pattern/i);
    });

    it('TC-LEAD-004 requires a valid Idempotency-Key header', async () => {
      const app = getApp();
      const res = await request(app).post('/v1/leads').send(validLeadPayload);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details?.[0]?.field).toBe('Idempotency-Key');
    });

    it('TC-LEAD-005 returns cached 201 response when reusing the same Idempotency-Key', async () => {
      const app = getApp();
      const first = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_create_replay_01')
        .send(validLeadPayload);
      expect(first.status).toBe(201);

      const replay = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_create_replay_01')
        .send(validLeadPayload);

      expect(replay.status).toBe(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body.id).toBe(first.body.id);
      expect(repository.leads.size).toBe(1);
    });

    it('TC-LEAD-006 detects duplicate when existing lead with same mobile exists in branch', async () => {
      const app = getApp();
      await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_first_001')
        .send(validLeadPayload);

      const second = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_second_001')
        .send({
          ...validLeadPayload,
          fullName: 'Another Person',
        });

      expect(second.status).toBe(201);
      expect(second.body.duplicateFlag).toBe('EXACT');
      expect(second.body.duplicateCandidateIds.length).toBeGreaterThan(0);
      expect(repository.outboxEvents.some((e) => e.event_type === 'lead.duplicate_flagged')).toBe(
        true,
      );
    });
  });

  describe('API-LEAD-002 GET /v1/leads — List Leads', () => {
    it('TC-LEAD-007 lists leads with cursor pagination and masked phone numbers', async () => {
      const app = getApp();
      await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_list_01')
        .send(validLeadPayload);
      await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_list_02')
        .send({ ...validLeadPayload, fullName: 'Bob Smith', mobile: '9123456780' });

      const res = await request(app).get('/v1/leads?limit=10');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.data[0].mobileMasked).toMatch(/^\+91 \*{6} \d{4}$/);
      expect(res.body.meta.limit).toBe(10);
    });

    it('TC-LEAD-008 filters leads by state', async () => {
      const app = getApp();
      await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_flt_01')
        .send(validLeadPayload);

      const res = await request(app).get('/v1/leads?filter[state]=NEW');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);

      const resEmpty = await request(app).get('/v1/leads?filter[state]=CONVERTED');
      expect(resEmpty.status).toBe(200);
      expect(resEmpty.body.data.length).toBe(0);
    });

    it('TC-LEAD-009 enforces tenant isolation on list queries', async () => {
      const appA = getApp(principalA);
      await request(appA)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_ten_01')
        .send(validLeadPayload);

      const appB = getApp(principalB);
      const resB = await request(appB).get('/v1/leads');
      expect(resB.status).toBe(200);
      expect(resB.body.data.length).toBe(0);
    });
  });

  describe('API-LEAD-003 GET /v1/leads/:id — Lead Detail', () => {
    it('TC-LEAD-010 returns lead detail with ETag header', async () => {
      const app = getApp();
      const createRes = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_get_01')
        .send(validLeadPayload);

      const leadId = createRes.body.id;
      const res = await request(app).get(`/v1/leads/${leadId}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(leadId);
      expect(res.body.fullName).toBe('John Doe');
      expect(res.body.mobileMasked).toBe('+91 ****** 3210');
    });

    it('TC-LEAD-011 returns 404 for lead in another tenant or non-existent lead', async () => {
      const appA = getApp(principalA);
      const createRes = await request(appA)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_get_02')
        .send(validLeadPayload);

      const appB = getApp(principalB);
      const resB = await request(appB).get(`/v1/leads/${createRes.body.id}`);
      expect(resB.status).toBe(404);

      const notFoundRes = await request(appA).get('/v1/leads/lead_01JDOESNOTEXIST0000000000');
      expect(notFoundRes.status).toBe(404);
    });
  });

  describe('API-LEAD-004 PATCH /v1/leads/:id — Update Lead', () => {
    it('TC-LEAD-012 updates mutable fields and bumps lock_version and ETag', async () => {
      const app = getApp();
      const createRes = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_patch_01')
        .send(validLeadPayload);

      const leadId = createRes.body.id;
      const res = await request(app)
        .patch(`/v1/leads/${leadId}`)
        .set('If-Match', '"0"')
        .send({
          priority: 'HIGH',
          tags: ['priority-customer', 'vip'],
        });

      expect(res.status).toBe(200);
      expect(res.headers.etag).toBe('"1"');
      expect(res.body.priority).toBe('HIGH');
      expect(res.body.tags).toEqual(['priority-customer', 'vip']);
      expect(res.body.lockVersion).toBe(1);
    });

    it('TC-LEAD-013 returns 409 VERSION_CONFLICT on stale If-Match', async () => {
      const app = getApp();
      const createRes = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_patch_02')
        .send(validLeadPayload);

      const leadId = createRes.body.id;
      const res = await request(app)
        .patch(`/v1/leads/${leadId}`)
        .set('If-Match', '"99"')
        .send({ priority: 'LOW' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('VERSION_CONFLICT');
    });
  });

  describe('API-LEAD-005 POST /v1/leads/:id/transitions — State Transitions', () => {
    it('TC-LEAD-014 executes T-LEAD-01 (attempt contact) and increments counter', async () => {
      const app = getApp();
      const createRes = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_trans_01')
        .send(validLeadPayload);

      const leadId = createRes.body.id;
      const res = await request(app)
        .post(`/v1/leads/${leadId}/transitions`)
        .set('If-Match', '"0"')
        .set('Idempotency-Key', 't_lead_01_step')
        .send({ transitionCode: 'T-LEAD-01' });

      expect(res.status).toBe(200);
      expect(res.body.state).toBe('CONTACT_ATTEMPTED');
      expect(res.body.contactAttempts).toBe(1);
      expect(res.headers.etag).toBe('"1"');

      // Verify status history entry
      expect(
        repository.statusHistories.some(
          (h) => h.lead_id === leadId && h.transition_code === 'T-LEAD-01',
        ),
      ).toBe(true);
    });

    it('TC-LEAD-015 executes T-LEAD-02 (in progress)', async () => {
      const app = getApp();
      const createRes = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_trans_02')
        .send(validLeadPayload);

      const leadId = createRes.body.id;
      const res = await request(app)
        .post(`/v1/leads/${leadId}/transitions`)
        .set('If-Match', '"0"')
        .set('Idempotency-Key', 't_lead_02_step')
        .send({ transitionCode: 'T-LEAD-02' });

      expect(res.status).toBe(200);
      expect(res.body.state).toBe('IN_PROGRESS');
    });

    it('TC-LEAD-016 executes T-LEAD-04 (qualify) with required qualification details', async () => {
      const app = getApp();
      const createRes = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_trans_04')
        .send(validLeadPayload);

      const leadId = createRes.body.id;
      const res = await request(app)
        .post(`/v1/leads/${leadId}/transitions`)
        .set('If-Match', '"0"')
        .set('Idempotency-Key', 't_lead_04_step')
        .send({
          transitionCode: 'T-LEAD-04',
          qualification: {
            applicantType: 'SALARIED',
            requestedAmount: { amount: '450000.00', currency: 'INR' },
            tenureMonths: 36,
            purposeCode: 'PERSONAL_NEEDS',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.state).toBe('QUALIFIED');
      expect(res.body.qualApplicantType).toBe('SALARIED');
      expect(res.body.qualRequestedAmount?.amount).toBe('450000.00');
    });

    it('TC-LEAD-017 executes T-LEAD-05 (disqualify) with disqualificationReason', async () => {
      const app = getApp();
      const createRes = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_trans_05')
        .send(validLeadPayload);

      const leadId = createRes.body.id;
      const res = await request(app)
        .post(`/v1/leads/${leadId}/transitions`)
        .set('If-Match', '"0"')
        .set('Idempotency-Key', 't_lead_05_step')
        .send({
          transitionCode: 'T-LEAD-05',
          disqualificationReason: 'NOT_INTERESTED',
        });

      expect(res.status).toBe(200);
      expect(res.body.state).toBe('DISQUALIFIED');
      expect(res.body.disqualificationReason).toBe('NOT_INTERESTED');
    });

    it('TC-LEAD-018a executes T-LEAD-06 (reopen) to move DISQUALIFIED back to NEW', async () => {
      const app = getApp();
      const createRes = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_reopen_step1')
        .send(validLeadPayload);

      const leadId = createRes.body.id;

      // Disqualify lead first
      const disqRes = await request(app)
        .post(`/v1/leads/${leadId}/transitions`)
        .set('If-Match', '"0"')
        .set('Idempotency-Key', 'lead_reopen_step2')
        .send({
          transitionCode: 'T-LEAD-05',
          disqualificationReason: 'NOT_INTERESTED',
        });
      expect(disqRes.status).toBe(200);
      expect(disqRes.body.state).toBe('DISQUALIFIED');

      // Reopen lead with T-LEAD-06
      const reopenRes = await request(app)
        .post(`/v1/leads/${leadId}/transitions`)
        .set('If-Match', disqRes.headers.etag as string)
        .set('Idempotency-Key', 'lead_reopen_step3')
        .send({
          transitionCode: 'T-LEAD-06',
          reasonCode: 'CUSTOMER_RECONNECTED',
        });

      expect(reopenRes.status).toBe(200);
      expect(reopenRes.body.state).toBe('NEW');
      expect(reopenRes.body.disqualificationReason).toBeNull();
    });

    it('TC-LEAD-018 returns 409 INVALID_TRANSITION on illegal state transition', async () => {
      const app = getApp();
      const createRes = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_trans_inv')
        .send(validLeadPayload);

      const leadId = createRes.body.id;
      // Cannot jump from NEW straight to CONVERTED
      const res = await request(app)
        .post(`/v1/leads/${leadId}/transitions`)
        .set('If-Match', '"0"')
        .set('Idempotency-Key', 't_lead_inv_step')
        .send({ transitionCode: 'T-LEAD-06' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
    });
  });

  describe('API-LEAD-006 POST /v1/leads/:id/assignments — Assignment', () => {
    it('TC-LEAD-019 assigns lead to user and appends lead_assignment', async () => {
      const app = getApp();
      const createRes = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_asg_01')
        .send(validLeadPayload);

      const leadId = createRes.body.id;
      const res = await request(app)
        .post(`/v1/leads/${leadId}/assignments`)
        .set('If-Match', '"0"')
        .set('Idempotency-Key', 'asg_step_01')
        .send({
          toUserId: 'usr_new_owner_01',
          reasonCode: 'MANUAL',
        });

      expect(res.status).toBe(200);
      expect(res.body.ownerUserId).toBe('usr_new_owner_01');
      expect(repository.assignments.length).toBe(1);
      expect(
        repository.outboxEvents.some(
          (e) => e.event_type === 'lead.assigned' || e.event_type === 'lead.reassigned',
        ),
      ).toBe(true);
    });
  });

  describe('API-LEAD-007 POST /v1/leads/:id/conversion — Atomic Conversion (TASK-110)', () => {

    it('TC-LEAD-020 converts a qualified lead into customer and loan application atomically', async () => {
      const app = getApp();
      const { id: leadId, etag } = await createQualifiedLead(app);

      const res = await request(app)
        .post(`/v1/leads/${leadId}/conversion`)
        .set('If-Match', etag)
        .set('Idempotency-Key', 'conv_exec_001')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.leadId).toBe(leadId);
      expect(res.body.customerId).toMatch(/^cust_/);
      expect(res.body.applicationId).toMatch(/^app_/);
      expect(res.body.status).toBe('CONVERTED');

      // 1. Verify lead is CONVERTED and linked
      const lead = await repository.findLeadById({} as Tx, tenantA, leadId);
      expect(lead?.state).toBe('CONVERTED');
      expect(lead?.customer_id).toBe(res.body.customerId);
      expect(lead?.application_id).toBe(res.body.applicationId);

      // 2. Verify Customer & Contact Points
      const customer = repository.customers.get(res.body.customerId);
      expect(customer).not.toBeUndefined();
      expect(customer?.full_name).toBe('John Doe');
      expect(customer?.party_type).toBe('INDIVIDUAL');
      expect(repository.contactPoints.size).toBeGreaterThanOrEqual(1);

      // 3. Verify Loan Application
      const application = repository.applications.get(res.body.applicationId);
      expect(application).not.toBeUndefined();
      expect(application?.status).toBe('DRAFT');
      expect(application?.customer_id).toBe(res.body.customerId);
      expect(application?.lead_id).toBe(leadId);
      expect(application?.requested_amount).toBe('450000.00');

      // 4. Verify Application Party link
      expect(repository.applicationParties.size).toBe(1);
      const party = Array.from(repository.applicationParties.values())[0];
      expect(party?.role).toBe('PRIMARY');
      expect(party?.customer_id).toBe(res.body.customerId);

      // 5. Verify status history (CONVERT)
      expect(
        repository.statusHistories.some(
          (h) => h.lead_id === leadId && h.transition_code === 'CONVERT',
        ),
      ).toBe(true);

      // 6. Verify Outbox events (lead.converted + application.created)
      expect(repository.outboxEvents.some((e) => e.event_type === 'lead.converted')).toBe(true);
      expect(repository.outboxEvents.some((e) => e.event_type === 'application.created')).toBe(
        true,
      );

      // 7. Verify Audit event
      expect(repository.auditEvents.some((e) => e.action === 'lead.converted')).toBe(true);
    });

    it('TC-LEAD-021 replaying with same Idempotency-Key returns cached result without duplicating customer/app', async () => {
      const app = getApp();
      const { id: leadId, etag } = await createQualifiedLead(app);

      const first = await request(app)
        .post(`/v1/leads/${leadId}/conversion`)
        .set('If-Match', etag)
        .set('Idempotency-Key', 'conv_replay_key')
        .send({});
      expect(first.status).toBe(200);

      const replay = await request(app)
        .post(`/v1/leads/${leadId}/conversion`)
        .set('If-Match', etag)
        .set('Idempotency-Key', 'conv_replay_key')
        .send({});

      expect(replay.status).toBe(200);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body.customerId).toBe(first.body.customerId);
      expect(replay.body.applicationId).toBe(first.body.applicationId);
      expect(repository.customers.size).toBe(1);
      expect(repository.applications.size).toBe(1);
    });

    it('TC-LEAD-022 rejects conversion of non-qualified lead with 409 INVALID_STATE', async () => {
      const app = getApp();
      // Fresh NEW lead
      const createRes = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'conv_fail_new')
        .send(validLeadPayload);

      const res = await request(app)
        .post(`/v1/leads/${createRes.body.id}/conversion`)
        .set('If-Match', '"0"')
        .set('Idempotency-Key', 'conv_fail_idem')
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    it('TC-LEAD-023 rejects conversion on stale If-Match with 409 VERSION_CONFLICT', async () => {
      const app = getApp();
      const { id: leadId } = await createQualifiedLead(app);

      const res = await request(app)
        .post(`/v1/leads/${leadId}/conversion`)
        .set('If-Match', '"999"')
        .set('Idempotency-Key', 'conv_stale_etag')
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('TC-LEAD-024 cross-tenant conversion is rejected with 404 NOT_FOUND', async () => {
      const appA = getApp(principalA);
      const { id: leadId, etag } = await createQualifiedLead(appA);

      const appB = getApp(principalB);
      const resB = await request(appB)
        .post(`/v1/leads/${leadId}/conversion`)
        .set('If-Match', etag)
        .set('Idempotency-Key', 'conv_cross_tenant')
        .send({});

      expect(resB.status).toBe(404);
      expect(resB.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Optimistic Concurrency, Idempotency & Authorization Edge Cases', () => {
    it('TC-LEAD-025 missing If-Match header on PATCH returns 422 VALIDATION_ERROR', async () => {
      const app = getApp();
      const createRes = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_ifmatch_01')
        .send(validLeadPayload);

      const leadId = createRes.body.id;
      const res = await request(app)
        .patch(`/v1/leads/${leadId}`)
        .send({ priority: 'HIGH' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.some((d: { field: string }) => d.field === 'If-Match')).toBe(true);
    });

    it('TC-LEAD-026 missing Idempotency-Key on transitions returns 422 VALIDATION_ERROR', async () => {
      const app = getApp();
      const createRes = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_idem_req_01')
        .send(validLeadPayload);

      const leadId = createRes.body.id;
      const res = await request(app)
        .post(`/v1/leads/${leadId}/transitions`)
        .set('If-Match', '"0"')
        .send({ transitionCode: 'T-LEAD-01' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.some((d: { field: string }) => d.field === 'Idempotency-Key')).toBe(true);
    });

    it('TC-LEAD-027 malformed non-numeric If-Match returns 409 VERSION_CONFLICT', async () => {
      const app = getApp();
      const createRes = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_malformed_etag')
        .send(validLeadPayload);

      const leadId = createRes.body.id;
      const res = await request(app)
        .patch(`/v1/leads/${leadId}`)
        .set('If-Match', '"abc"')
        .send({ priority: 'HIGH' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('TC-LEAD-028 rejects assignment when caller lacks lead.assign permission with 403 FORBIDDEN', async () => {
      const unauthorizedPrincipal = testPrincipal({
        tenantId: tenantA,
        grants: [
          { code: 'lead.create', scope: 'TENANT', branchIds: [] },
          { code: 'lead.read', scope: 'TENANT', branchIds: [] },
        ],
      });
      const app = getApp(unauthorizedPrincipal);
      const createRes = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_unauth_asg_01')
        .send(validLeadPayload);

      const leadId = createRes.body.id;
      const res = await request(app)
        .post(`/v1/leads/${leadId}/assignments`)
        .set('If-Match', '"0"')
        .set('Idempotency-Key', 'asg_unauth_step')
        .send({ toUserId: 'usr_new_owner_01', reasonCode: 'MANUAL' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('TC-LEAD-029 rejects conversion when caller lacks application.create permission with 403 FORBIDDEN', async () => {
      const appAuth = getApp(principalA);
      const { id: leadId, etag } = await createQualifiedLead(appAuth);

      const unauthorizedPrincipal = testPrincipal({
        tenantId: tenantA,
        grants: [
          { code: 'lead.read', scope: 'TENANT', branchIds: [] },
          { code: 'lead.update', scope: 'TENANT', branchIds: [] },
        ],
      });
      const appUnauth = getApp(unauthorizedPrincipal);
      const res = await request(appUnauth)
        .post(`/v1/leads/${leadId}/conversion`)
        .set('If-Match', etag)
        .set('Idempotency-Key', 'conv_unauth_step')
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('TC-LEAD-030 rejects assignment to user outside branch with 422 INVALID_ASSIGNEE when directory port is provided', async () => {
      const directory = new FakeUserDirectoryPort();
      directory.users.set('usr_other_branch', {
        userId: 'usr_other_branch',
        status: 'ACTIVE',
        availability: 'AVAILABLE',
        primaryBranchId: 'br_other_branch_99',
        branchIds: ['br_other_branch_99'],
      });

      const app = getApp(principalA, directory);
      const createRes = await request(app)
        .post('/v1/leads')
        .set('Idempotency-Key', 'lead_asg_inval_01')
        .send(validLeadPayload);

      const leadId = createRes.body.id;
      const res = await request(app)
        .post(`/v1/leads/${leadId}/assignments`)
        .set('If-Match', '"0"')
        .set('Idempotency-Key', 'asg_inval_step')
        .send({ toUserId: 'usr_other_branch', reasonCode: 'MANUAL' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INVALID_ASSIGNEE');
    });
  });
});
