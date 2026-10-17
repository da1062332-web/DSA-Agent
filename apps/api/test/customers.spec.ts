// apps/api/test/customers.spec.ts — owner: Dev 5 (MOD-CUST Customers test suite)
import type { RequestContext, Tx, TxRunner } from '@dsa/contracts';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryCustomerRepository } from '../src/modules/crm/customers/repository';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const inMemoryTxRunner: TxRunner = {
  async withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tx = {} as any;
    tx.tenantId = ctx.principal.tenantId;
    return fn(tx as Tx);
  },
};

describe('Module 8 — Customers (MOD-CUST)', () => {
  let repository: InMemoryCustomerRepository;

  const tenantA = 'ten_01JTESTTENANTA0000000000000';
  const tenantB = 'ten_01JTESTTENANTB0000000000000';

  const principalA = testPrincipal({
    tenantId: tenantA,
    grants: [
      { code: 'customer.create', scope: 'TENANT', branchIds: [] },
      { code: 'customer.read', scope: 'TENANT', branchIds: [] },
      { code: 'customer.update', scope: 'TENANT', branchIds: [] },
      { code: 'consent.record', scope: 'TENANT', branchIds: [] },
    ],
  });

  const principalB = testPrincipal({
    tenantId: tenantB,
    grants: [
      { code: 'customer.read', scope: 'TENANT', branchIds: [] },
      { code: 'customer.create', scope: 'TENANT', branchIds: [] },
    ],
  });

  const _branchUser = testPrincipal({
    tenantId: tenantA,
    primaryBranchId: 'br_01JTESTBRANCH00000000000001',
    grants: [
      { code: 'customer.read', scope: 'BRANCH', branchIds: ['br_01JTESTBRANCH00000000000001'] },
      { code: 'customer.create', scope: 'BRANCH', branchIds: ['br_01JTESTBRANCH00000000000001'] },
      { code: 'customer.update', scope: 'BRANCH', branchIds: ['br_01JTESTBRANCH00000000000001'] },
    ],
  });

  beforeEach(() => {
    repository = new InMemoryCustomerRepository();
  });

  function getApp(principal = principalA) {
    return createTestApp({
      auth: fakeAuth(principal),
      deps: {
        txRunner: inMemoryTxRunner,
        customerRepository: repository,
      },
    });
  }

  const validCustomerPayload = {
    partyType: 'INDIVIDUAL',
    fullName: 'Rahul Sharma',
    homeBranchId: 'br_01JTESTBRANCH00000000000001',
    primaryMobile: '9876543210',
    primaryEmail: 'rahul.sharma@example.com',
  };

  describe('SUB-CUST.01: Customer Creation (POST /v1/customers)', () => {
    it('creates an INDIVIDUAL customer profile successfully with masked mobile/email and ETag', async () => {
      const app = getApp();
      const res = await request(app)
        .post('/v1/customers')
        .set('Idempotency-Key', 'idem_cust_create_001')
        .send(validCustomerPayload);

      expect(res.status).toBe(201);
      expect(res.headers.etag).toBe('"0"');
      expect(res.body.id).toMatch(/^cust_/);
      expect(res.body.partyType).toBe('INDIVIDUAL');
      expect(res.body.fullName).toBe('Rahul Sharma');
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.primaryMobileMasked).toBe('+91 ****** 3210');
      expect(res.body.primaryEmailMasked).toBe('r***a@example.com');

      // Check events written
      expect(repository.outboxEvents.some((e) => e.event_type === 'customer.created')).toBe(true);
      expect(repository.auditEvents.some((e) => e.action === 'customer.created')).toBe(true);
    });

    it('creates an ENTITY customer profile successfully', async () => {
      const app = getApp();
      const res = await request(app)
        .post('/v1/customers')
        .set('Idempotency-Key', 'idem_cust_create_002')
        .send({
          partyType: 'ENTITY',
          fullName: 'Acme Enterprises Private Limited',
          homeBranchId: 'br_01JTESTBRANCH00000000000001',
        });

      expect(res.status).toBe(201);
      expect(res.body.partyType).toBe('ENTITY');
      expect(res.body.fullName).toBe('Acme Enterprises Private Limited');
      expect(res.body.primaryMobileMasked).toBeNull();
    });

    it('returns cached result on idempotent replay with Idempotent-Replayed header', async () => {
      const app = getApp();
      const res1 = await request(app)
        .post('/v1/customers')
        .set('Idempotency-Key', 'idem_cust_replay_001')
        .send(validCustomerPayload);
      expect(res1.status).toBe(201);

      const res2 = await request(app)
        .post('/v1/customers')
        .set('Idempotency-Key', 'idem_cust_replay_001')
        .send(validCustomerPayload);
      expect(res2.status).toBe(201);
      expect(res2.headers['idempotent-replayed']).toBe('true');
      expect(res2.body.id).toBe(res1.body.id);
    });

    it('rejects creation when missing required fields with 422 VALIDATION_ERROR', async () => {
      const app = getApp();
      const res = await request(app)
        .post('/v1/customers')
        .set('Idempotency-Key', 'idem_cust_err_001')
        .send({ fullName: 'Only Name' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects creation when missing Idempotency-Key header', async () => {
      const app = getApp();
      const res = await request(app).post('/v1/customers').send(validCustomerPayload);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects creation containing S3-class fields (PAN, Aadhaar, DOB, bankAccount) with 422', async () => {
      const app = getApp();
      const res = await request(app)
        .post('/v1/customers')
        .set('Idempotency-Key', 'idem_cust_s3_001')
        .send({
          ...validCustomerPayload,
          pan: 'ABCDE1234F',
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toMatch(/S3-class data/);
    });

    it('rejects free-text PAN or Aadhaar patterns in fullName with 422', async () => {
      const app = getApp();
      const res = await request(app)
        .post('/v1/customers')
        .set('Idempotency-Key', 'idem_cust_s3_002')
        .send({
          ...validCustomerPayload,
          fullName: 'Customer ABCDE1234F',
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toMatch(/prohibited PAN pattern/);
    });

    it('denies customer creation if principal lacks customer.create permission', async () => {
      const readOnlyUser = testPrincipal({
        tenantId: tenantA,
        grants: [{ code: 'customer.read', scope: 'TENANT', branchIds: [] }],
      });
      const app = getApp(readOnlyUser);
      const res = await request(app)
        .post('/v1/customers')
        .set('Idempotency-Key', 'idem_cust_perm_001')
        .send(validCustomerPayload);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('SUB-CUST.01: Customer Update (PATCH /v1/customers/:id)', () => {
    let customerId: string;

    beforeEach(async () => {
      const app = getApp();
      const res = await request(app)
        .post('/v1/customers')
        .set('Idempotency-Key', 'idem_cust_setup_update')
        .send(validCustomerPayload);
      customerId = res.body.id;
    });

    it('updates customer profile and advances lock_version with valid If-Match', async () => {
      const app = getApp();
      const res = await request(app)
        .patch(`/v1/customers/${customerId}`)
        .set('If-Match', '"0"')
        .send({ fullName: 'Rahul S. Sharma' });

      expect(res.status).toBe(200);
      expect(res.headers.etag).toBe('"1"');
      expect(res.body.fullName).toBe('Rahul S. Sharma');
      expect(res.body.lockVersion).toBe(1);

      expect(repository.outboxEvents.some((e) => e.event_type === 'customer.updated')).toBe(true);
      expect(repository.auditEvents.some((e) => e.action === 'customer.updated')).toBe(true);
    });

    it('rejects update without If-Match header with 422 VALIDATION_ERROR', async () => {
      const app = getApp();
      const res = await request(app)
        .patch(`/v1/customers/${customerId}`)
        .send({ fullName: 'Rahul S. Sharma' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects update with stale ETag with 409 VERSION_CONFLICT', async () => {
      const app = getApp();
      const res = await request(app)
        .patch(`/v1/customers/${customerId}`)
        .set('If-Match', '"99"')
        .send({ fullName: 'Rahul S. Sharma' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('rejects update containing prohibited S3 fields with 422', async () => {
      const app = getApp();
      const res = await request(app)
        .patch(`/v1/customers/${customerId}`)
        .set('If-Match', '"0"')
        .send({ dob: '1990-01-01' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('SUB-CUST.01: Customer Detail & List (GET /v1/customers, GET /v1/customers/:id)', () => {
    let customerIdA: string;

    beforeEach(async () => {
      const app = getApp();
      const res = await request(app)
        .post('/v1/customers')
        .set('Idempotency-Key', 'idem_cust_detail_001')
        .send(validCustomerPayload);
      customerIdA = res.body.id;
    });

    it('retrieves customer detail with ETag and masked contact points', async () => {
      const app = getApp();
      const res = await request(app).get(`/v1/customers/${customerIdA}`);

      expect(res.status).toBe(200);
      expect(res.headers.etag).toBe('"0"');
      expect(res.body.id).toBe(customerIdA);
      expect(res.body.fullName).toBe('Rahul Sharma');
      expect(res.body.primaryMobileMasked).toBe('+91 ****** 3210');
      expect(res.body.primaryEmailMasked).toBe('r***a@example.com');
    });

    it('returns 404 NOT_FOUND for cross-tenant access', async () => {
      const appB = getApp(principalB);
      const res = await request(appB).get(`/v1/customers/${customerIdA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('enforces branch-level scoping on customer retrieval', async () => {
      const otherBranchUser = testPrincipal({
        tenantId: tenantA,
        primaryBranchId: 'br_OTHER_BRANCH',
        grants: [{ code: 'customer.read', scope: 'BRANCH', branchIds: ['br_OTHER_BRANCH'] }],
      });
      const app = getApp(otherBranchUser);
      const res = await request(app).get(`/v1/customers/${customerIdA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('lists customers with cursor pagination and metadata', async () => {
      const app = getApp();
      // Create second customer
      await request(app).post('/v1/customers').set('Idempotency-Key', 'idem_cust_list_002').send({
        partyType: 'ENTITY',
        fullName: 'Global Finance Corp',
        homeBranchId: 'br_01JTESTBRANCH00000000000001',
      });

      const res = await request(app).get('/v1/customers?limit=1');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.meta.nextCursor).toBeDefined();
    });

    it('filters customer list by partyType', async () => {
      const app = getApp();
      const res = await request(app).get('/v1/customers?filter[partyType]=INDIVIDUAL');
      expect(res.status).toBe(200);
      expect(res.body.data.every((c: { partyType: string }) => c.partyType === 'INDIVIDUAL')).toBe(true);
    });
  });

  describe('SUB-CUST.01: Sensitive Field Reveal (API-CUST-006)', () => {
    it('returns 403 FORBIDDEN indicating reveal is disabled awaiting privacy infrastructure', async () => {
      const app = getApp();
      const res = await request(app).post('/v1/customers/cust_001/reveal').send();

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toMatch(/TASK-421/);
    });
  });

  describe('SUB-CUST.03: Consent Registration & Withdrawal (API-CUST-004, API-CUST-005)', () => {
    let customerId: string;

    beforeEach(async () => {
      const app = getApp();
      const res = await request(app)
        .post('/v1/customers')
        .set('Idempotency-Key', 'idem_cust_consent_setup')
        .send(validCustomerPayload);
      customerId = res.body.id;
    });

    it('records valid customer consent successfully with consent.granted event', async () => {
      const app = getApp();
      const res = await request(app)
        .post(`/v1/customers/${customerId}/consents`)
        .set('Idempotency-Key', 'idem_cnst_rec_001')
        .send({
          purpose: 'CONTACT',
          noticeVersion: 'NV-2026.1',
          channel: 'WEB_FORM',
          evidenceRef: 'ev_01JTESTEVIDENCE0000000000',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^cnst_/);
      expect(res.body.subjectType).toBe('CUSTOMER');
      expect(res.body.subjectId).toBe(customerId);
      expect(res.body.purpose).toBe('CONTACT');
      expect(res.body.status).toBe('ACTIVE');

      expect(repository.outboxEvents.some((e) => e.event_type === 'consent.granted')).toBe(true);
      expect(repository.auditEvents.some((e) => e.action === 'consent.granted')).toBe(true);
    });

    it('requires purposeTarget when purpose is SHARE_WITH_LENDER', async () => {
      const app = getApp();
      const res = await request(app)
        .post(`/v1/customers/${customerId}/consents`)
        .set('Idempotency-Key', 'idem_cnst_target_err')
        .send({
          purpose: 'SHARE_WITH_LENDER',
          noticeVersion: 'NV-2026.1',
          channel: 'OTP',
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts SHARE_WITH_LENDER when purposeTarget is provided', async () => {
      const app = getApp();
      const res = await request(app)
        .post(`/v1/customers/${customerId}/consents`)
        .set('Idempotency-Key', 'idem_cnst_target_ok')
        .send({
          purpose: 'SHARE_WITH_LENDER',
          purposeTarget: 'lender_HDFC_001',
          noticeVersion: 'NV-2026.1',
          channel: 'OTP',
        });

      expect(res.status).toBe(201);
      expect(res.body.purposeTarget).toBe('lender_HDFC_001');
    });

    it('replays consent creation idempotently', async () => {
      const app = getApp();
      const res1 = await request(app)
        .post(`/v1/customers/${customerId}/consents`)
        .set('Idempotency-Key', 'idem_cnst_replay_001')
        .send({
          purpose: 'MARKETING',
          noticeVersion: 'NV-2026.1',
          channel: 'EMAIL',
        });
      expect(res1.status).toBe(201);

      const res2 = await request(app)
        .post(`/v1/customers/${customerId}/consents`)
        .set('Idempotency-Key', 'idem_cnst_replay_001')
        .send({
          purpose: 'MARKETING',
          noticeVersion: 'NV-2026.1',
          channel: 'EMAIL',
        });
      expect(res2.status).toBe(201);
      expect(res2.headers['idempotent-replayed']).toBe('true');
      expect(res2.body.id).toBe(res1.body.id);
    });

    it('withdraws active consent successfully and emits consent.withdrawn event', async () => {
      const app = getApp();
      const createRes = await request(app)
        .post(`/v1/customers/${customerId}/consents`)
        .set('Idempotency-Key', 'idem_cnst_to_withdraw')
        .send({
          purpose: 'LOAN_PROCESSING',
          noticeVersion: 'NV-2026.1',
          channel: 'IN_PERSON',
        });
      const consentId = createRes.body.id;

      const withdrawRes = await request(app)
        .post(`/v1/consents/${consentId}/withdrawal`)
        .set('Idempotency-Key', 'idem_cnst_withdraw_001')
        .send({ withdrawalReason: 'Customer opted out' });

      expect(withdrawRes.status).toBe(200);
      expect(withdrawRes.body.status).toBe('WITHDRAWN');
      expect(withdrawRes.body.withdrawnAt).toBeDefined();
      expect(withdrawRes.body.withdrawalReason).toBe('Customer opted out');

      expect(repository.outboxEvents.some((e) => e.event_type === 'consent.withdrawn')).toBe(true);
      expect(repository.auditEvents.some((e) => e.action === 'consent.withdrawn')).toBe(true);
    });

    it('rejects withdrawal of an already withdrawn consent with 409 INVALID_STATE', async () => {
      const app = getApp();
      const createRes = await request(app)
        .post(`/v1/customers/${customerId}/consents`)
        .set('Idempotency-Key', 'idem_cnst_twice_setup')
        .send({
          purpose: 'CONTACT',
          noticeVersion: 'NV-2026.1',
          channel: 'PHONE',
        });
      const consentId = createRes.body.id;

      await request(app)
        .post(`/v1/consents/${consentId}/withdrawal`)
        .set('Idempotency-Key', 'idem_withdraw_1')
        .send();

      const res2 = await request(app)
        .post(`/v1/consents/${consentId}/withdrawal`)
        .set('Idempotency-Key', 'idem_withdraw_2')
        .send();

      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('INVALID_STATE');
    });

    it('returns 404 NOT_FOUND for withdrawal of unknown consent ID', async () => {
      const app = getApp();
      const res = await request(app)
        .post('/v1/consents/cnst_UNKNOWN/withdrawal')
        .set('Idempotency-Key', 'idem_withdraw_404')
        .send();

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('SUB-CUST.03: Preferences Endpoint (API-CUST-009)', () => {
    it('returns 409 INVALID_STATE confirming communication preferences is deferred to TASK-410', async () => {
      const app = getApp();
      const res = await request(app).put('/v1/customers/cust_001/preferences').send();

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATE');
      expect(res.body.error.message).toMatch(/TASK-410/);
    });
  });

  describe('SUB-CUST.03: List Consents (GET /v1/customers/:id/consents)', () => {
    let customerId: string;

    beforeEach(async () => {
      const app = getApp();
      const res = await request(app)
        .post('/v1/customers')
        .set('Idempotency-Key', 'idem_cust_list_consent_setup')
        .send(validCustomerPayload);
      customerId = res.body.id;
    });

    it('returns empty list when no consents recorded for customer', async () => {
      const app = getApp();
      const res = await request(app).get(`/v1/customers/${customerId}/consents`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('returns recorded consents for customer', async () => {
      const app = getApp();
      await request(app)
        .post(`/v1/customers/${customerId}/consents`)
        .set('Idempotency-Key', 'idem_rec_list_c1')
        .send({
          purpose: 'CONTACT',
          noticeVersion: 'NV-2026.1',
          channel: 'WEB_FORM',
        });

      const res = await request(app).get(`/v1/customers/${customerId}/consents`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].purpose).toBe('CONTACT');
      expect(res.body.data[0].status).toBe('ACTIVE');
    });
  });

  describe('Idempotency & Concurrency Edge Cases', () => {
    it('rejects idempotent replay with different payload using 422 IDEMPOTENCY_KEY_REUSED', async () => {
      const app = getApp();
      const res1 = await request(app)
        .post('/v1/customers')
        .set('Idempotency-Key', 'idem_diff_payload_001')
        .send(validCustomerPayload);
      expect(res1.status).toBe(201);

      // Same key, different fullName
      const res2 = await request(app)
        .post('/v1/customers')
        .set('Idempotency-Key', 'idem_diff_payload_001')
        .send({
          ...validCustomerPayload,
          fullName: 'Completely Different Name',
        });

      expect(res2.status).toBe(422);
      expect(res2.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('rejects malformed pagination cursor with 422 VALIDATION_ERROR', async () => {
      const app = getApp();
      const res = await request(app).get('/v1/customers?cursor=NOT_A_VALID_BASE64_CURSOR_!!!');

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toMatch(/Invalid pagination cursor/);
    });
  });

  describe('PartyPort and ConsentPort Implementations', () => {
    it('implements PartyPort.getParty correctly with masked display name', async () => {
      const app = getApp();
      const res = await request(app)
        .post('/v1/customers')
        .set('Idempotency-Key', 'idem_party_test')
        .send(validCustomerPayload);
      const customerId = res.body.id;

      const { CustomerService } = await import('../src/modules/crm/customers/customer-service');
      const service = new CustomerService({ repository });
      const party = await service.getParty({ tenantId: tenantA } as unknown as Tx, customerId);

      expect(party).not.toBeNull();
      expect(party?.customerId).toBe(customerId);
      expect(party?.partyType).toBe('INDIVIDUAL');
      expect(party?.displayNameMasked).toBe('R***l S****a');
      expect(party?.homeBranchId).toBe(validCustomerPayload.homeBranchId);

      // Calling PartyPort across tenants or without tenant context returns null (fail-closed)
      const partyOtherTenant = await service.getParty({ tenantId: tenantB } as unknown as Tx, customerId);
      expect(partyOtherTenant).toBeNull();
      const partyNoTenant = await service.getParty({} as Tx, customerId);
      expect(partyNoTenant).toBeNull();
    });

    it('implements ConsentPort.findActive correctly for customer consent', async () => {
      const app = getApp();
      const custRes = await request(app)
        .post('/v1/customers')
        .set('Idempotency-Key', 'idem_consent_port_cust')
        .send(validCustomerPayload);
      const customerId = custRes.body.id;

      await request(app)
        .post(`/v1/customers/${customerId}/consents`)
        .set('Idempotency-Key', 'idem_consent_port_rec')
        .send({
          purpose: 'LOAN_PROCESSING',
          noticeVersion: 'NV-2026.1',
          channel: 'OTP',
        });

      const { CustomerService } = await import('../src/modules/crm/customers/customer-service');
      const service = new CustomerService({ repository });

      const active = await service.findActive({ tenantId: tenantA } as unknown as Tx, {
        customerId,
        purpose: 'LOAN_PROCESSING',
      });
      expect(active).not.toBeNull();
      expect(active?.consentId).toMatch(/^cnst_/);

      const notFound = await service.findActive({ tenantId: tenantA } as unknown as Tx, {
        customerId,
        purpose: 'MARKETING',
      });
      expect(notFound).toBeNull();

      // Calling ConsentPort across tenants or without tenant context returns null (fail-closed)
      const crossConsent = await service.findActive({ tenantId: tenantB } as unknown as Tx, {
        customerId,
        purpose: 'LOAN_PROCESSING',
      });
      expect(crossConsent).toBeNull();
      const noTenantConsent = await service.findActive({} as Tx, {
        customerId,
        purpose: 'LOAN_PROCESSING',
      });
      expect(noTenantConsent).toBeNull();
    });

    it('enforces strict tenant isolation on customer repository and port lookups', async () => {
      const tenantA = 'ten_tenant_A';
      const tenantB = 'ten_tenant_B';
      const custAId = 'cust_sec_tenant_a';
      const custBId = 'cust_sec_tenant_b';

      // Seed Customer A under Tenant A
      await repository.insertCustomer({} as Tx, {
        id: custAId,
        tenant_id: tenantA,
        party_type: 'INDIVIDUAL',
        full_name: 'Tenant A Customer',
        home_branch_id: 'br_01',
        status: 'ACTIVE',
        lock_version: 0,
        created_at: new Date(),
        created_by: 'user_a',
        updated_at: new Date(),
        updated_by: 'user_a',
      });

      // Seed Customer B under Tenant B
      await repository.insertCustomer({} as Tx, {
        id: custBId,
        tenant_id: tenantB,
        party_type: 'INDIVIDUAL',
        full_name: 'Tenant B Customer',
        home_branch_id: 'br_02',
        status: 'ACTIVE',
        lock_version: 0,
        created_at: new Date(),
        created_by: 'user_b',
        updated_at: new Date(),
        updated_by: 'user_b',
      });

      // 1. Tenant A can retrieve Tenant A's customer
      const foundA = await repository.findCustomerById({} as Tx, tenantA, custAId);
      expect(foundA).not.toBeNull();
      expect(foundA?.id).toBe(custAId);

      // 2. Tenant A CANNOT retrieve Tenant B's customer (even knowing ID)
      const crossTenant = await repository.findCustomerById({} as Tx, tenantA, custBId);
      expect(crossTenant).toBeNull();

      // 3. Tenant B CANNOT retrieve Tenant A's customer
      const crossTenantReverse = await repository.findCustomerById({} as Tx, tenantB, custAId);
      expect(crossTenantReverse).toBeNull();

      // 4. Consent isolation across tenants
      const cnstAId = 'cnst_sec_tenant_a';
      await repository.insertConsentRecord({} as Tx, {
        id: cnstAId,
        tenant_id: tenantA,
        subject_type: 'CUSTOMER',
        subject_id: custAId,
        purpose: 'CONTACT',
        purpose_target: null,
        notice_version: 'NV-2026.1',
        channel: 'WEB_FORM',
        evidence_ref: null,
        captured_by: 'user_a',
        captured_at: new Date(),
        status: 'ACTIVE',
      });

      // Tenant A can retrieve Tenant A's consent
      const foundCnstA = await repository.findConsentById({} as Tx, tenantA, cnstAId);
      expect(foundCnstA).not.toBeNull();
      expect(foundCnstA?.id).toBe(cnstAId);

      // Tenant B CANNOT retrieve Tenant A's consent
      const crossConsent = await repository.findConsentById({} as Tx, tenantB, cnstAId);
      expect(crossConsent).toBeNull();

      // Active consent check for Tenant B on custAId must return null
      const crossActive = await repository.findActiveConsent(
        {} as Tx,
        tenantB,
        'CUSTOMER',
        custAId,
        'CONTACT',
      );
      expect(crossActive).toBeNull();
    });
  });
});
