// apps/api/test/partner-api.spec.ts — owner: Akash (Module 37: API Development MOD-DEV)
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Principal } from '@dsa/contracts';
import { createApp } from '../src/app';
import { fakeAuth, testDeps, testPrincipal } from './support/fake-auth';
import {
  hashApiKey,
  InMemoryApiKeyStore,
  type ApiKeyRecord,
} from '../src/modules/partner-api/auth-middleware';
import { PartnerApiService } from '../src/modules/partner-api/service';
import { WebhookDeliveryService } from '../src/modules/partner-api/webhook-service';

describe('Module 37 — API Development (MOD-DEV) Test Suite', () => {
  const TENANT_A = 'ten_01JTESTTENANT00000000000001';
  const TENANT_B = 'ten_01JTESTTENANT00000000000002';

  // Seed API Keys
  const validKeySecret = 'dsa_live_abcdef1234567890abcdef1234567890';
  const revokedKeySecret = 'dsa_live_revoked123456789012345678901234';
  const expiredKeySecret = 'dsa_live_expired123456789012345678901234';
  const restrictedIpKeySecret = 'dsa_live_ipallowed12345678901234567890';

  const validKeyRecord: ApiKeyRecord = {
    id: 'apk_01JTESTKEY0000000000000001',
    tenantId: TENANT_A,
    partnerId: 'partner_fintech_alpha',
    name: 'Alpha Fintech Live Key',
    keyPrefix: 'dsa_live_abcdef12',
    keyHash: hashApiKey(validKeySecret),
    scopes: ['partner.lead_ingest', 'partner.application_read', 'webhook.manage', 'api.read', 'api.manage'],
    allowedIps: null,
    rateLimitRpm: 120,
    status: 'ACTIVE',
    expiresAt: null,
  };

  const revokedKeyRecord: ApiKeyRecord = {
    id: 'apk_01JTESTKEY0000000000000002',
    tenantId: TENANT_A,
    partnerId: 'partner_revoked',
    name: 'Revoked Key',
    keyPrefix: 'dsa_live_revoked1',
    keyHash: hashApiKey(revokedKeySecret),
    scopes: ['partner.lead_ingest'],
    allowedIps: null,
    rateLimitRpm: 60,
    status: 'REVOKED',
  };

  const expiredKeyRecord: ApiKeyRecord = {
    id: 'apk_01JTESTKEY0000000000000003',
    tenantId: TENANT_A,
    partnerId: 'partner_expired',
    name: 'Expired Key',
    keyPrefix: 'dsa_live_expired1',
    keyHash: hashApiKey(expiredKeySecret),
    scopes: ['partner.lead_ingest'],
    allowedIps: null,
    rateLimitRpm: 60,
    status: 'EXPIRED',
    expiresAt: '2020-01-01T00:00:00Z',
  };

  const restrictedIpKeyRecord: ApiKeyRecord = {
    id: 'apk_01JTESTKEY0000000000000004',
    tenantId: TENANT_A,
    partnerId: 'partner_ip_restricted',
    name: 'IP Restricted Key',
    keyPrefix: 'dsa_live_ipallowed',
    keyHash: hashApiKey(restrictedIpKeySecret),
    scopes: ['partner.lead_ingest'],
    allowedIps: ['198.51.100.1'], // Allowed IP that does not match test runner
    rateLimitRpm: 60,
    status: 'ACTIVE',
  };

  function createTestPartnerApp() {
    const apiKeyStore = new InMemoryApiKeyStore([
      validKeyRecord,
      revokedKeyRecord,
      expiredKeyRecord,
      restrictedIpKeyRecord,
    ]);
    const baseDeps = testDeps();
    const partnerService = new PartnerApiService(baseDeps, apiKeyStore);
    const webhookService = new WebhookDeliveryService(baseDeps);

    const deps = {
      ...baseDeps,
      apiKeyStore,
      partnerService,
      webhookService,
    };

    // Create Express app without default global auth so partnerAuthMiddleware handles /partner
    const app = createApp({
      deps,
      corsAllowedOrigins: ['*'],
      auth: (req, _res, next) => {
        // If request is to /partner, pass through to module router which runs partnerAuthMiddleware
        if (req.path.includes('partner') || req.url?.includes('partner')) {
          return next();
        }
        next();
      },
    });

    return { app, apiKeyStore, partnerService, webhookService };
  }

  describe('SUB-DEV.01: Partner API Gateway & Authentication', () => {
    it('TEST-API-DEV-001 rejects request without API Key with 401 UNAUTHENTICATED', async () => {
      const { app } = createTestPartnerApp();
      const res = await request(app)
        .post('/v1/partner/sandbox/echo')
        .send({ message: 'ping' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('TEST-API-DEV-002 rejects invalid or unrecognised API key with 401 UNAUTHENTICATED', async () => {
      const { app } = createTestPartnerApp();
      const res = await request(app)
        .post('/v1/partner/sandbox/echo')
        .set('X-API-Key', 'dsa_live_completely_bogus_key_1234567890')
        .send({ message: 'ping' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('TEST-API-DEV-003 rejects revoked API key with 401 UNAUTHENTICATED', async () => {
      const { app } = createTestPartnerApp();
      const res = await request(app)
        .post('/v1/partner/sandbox/echo')
        .set('X-API-Key', revokedKeySecret)
        .send({ message: 'ping' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.body.error.message).toContain('revoked');
    });

    it('TEST-API-DEV-004 rejects expired API key with 401 UNAUTHENTICATED', async () => {
      const { app } = createTestPartnerApp();
      const res = await request(app)
        .post('/v1/partner/sandbox/echo')
        .set('X-API-Key', expiredKeySecret)
        .send({ message: 'ping' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.body.error.message).toContain('expired');
    });

    it('TEST-API-DEV-005 rejects client when IP is not in configured allowlist', async () => {
      const { app } = createTestPartnerApp();
      const res = await request(app)
        .post('/v1/partner/sandbox/echo')
        .set('X-API-Key', restrictedIpKeySecret)
        .send({ message: 'ping' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('TEST-API-DEV-006 allows valid active API key via X-API-Key or Bearer header', async () => {
      const { app } = createTestPartnerApp();
      const res1 = await request(app)
        .post('/v1/partner/sandbox/echo')
        .set('X-API-Key', validKeySecret)
        .send({ message: 'hello' });

      expect(res1.status).toBe(200);
      expect(res1.body.status).toBe('ok');
      expect(res1.body.tenantId).toBe(TENANT_A);

      const res2 = await request(app)
        .post('/v1/partner/sandbox/echo')
        .set('Authorization', `Bearer ${validKeySecret}`)
        .send({ message: 'hello-bearer' });

      expect(res2.status).toBe(200);
      expect(res2.body.echo.message).toBe('hello-bearer');
    });
  });

  describe('SUB-DEV.02: Partner Lead Ingestion & Tracking (API-DEV-001 - API-DEV-003)', () => {
    const validLeadPayload = {
      externalReferenceId: 'EXT-PARTNER-101',
      loanProductCode: 'LAP-COMMERCIAL-01',
      requestedAmount: { amount: '4500000.00', currency: 'INR' },
      applicant: {
        firstName: 'Amit',
        lastName: 'Verma',
        mobile: '+919811223344',
        email: 'amit.verma@example.com',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
        employmentType: 'SELF_EMPLOYED_BUSINESS',
      },
      consent: {
        consentArtifactRef: 'AGREEMENT-DIGITAL-CONSENT-V1',
        consentPurpose: 'LOAN_APPLICATION',
        optInTimestamp: '2026-10-14T08:30:00Z',
      },
    };

    it('TEST-API-DEV-007 requires Idempotency-Key header on POST /partner/leads', async () => {
      const { app } = createTestPartnerApp();
      const res = await request(app)
        .post('/v1/partner/leads')
        .set('X-API-Key', validKeySecret)
        .send(validLeadPayload);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('Idempotency-Key header is required');
    });

    it('TEST-API-DEV-008 successfully ingests lead and returns masked applicant details', async () => {
      const { app } = createTestPartnerApp();
      const res = await request(app)
        .post('/v1/partner/leads')
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'idem_partner_lead_001')
        .send(validLeadPayload);

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^lead_/);
      expect(res.body.status).toBe('RECEIVED');
      expect(res.body.applicantName).toBe('Amit Verma');
      expect(res.body.maskedMobile).toContain('***');
      expect(res.body.maskedMobile).not.toBe('+919811223344');
      expect(res.body.maskedEmail).toContain('***');
      expect(res.body.maskedEmail).not.toBe('amit.verma@example.com');
      expect(res.body.duplicateFlag).toBe(false);
    });

    it('TEST-API-DEV-009 replaying request with same Idempotency-Key returns 200 and Idempotent-Replayed header', async () => {
      const { app } = createTestPartnerApp();
      // First call
      await request(app)
        .post('/v1/partner/leads')
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'idem_replay_test_001')
        .send(validLeadPayload);

      // Replay
      const replayRes = await request(app)
        .post('/v1/partner/leads')
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'idem_replay_test_001')
        .send(validLeadPayload);

      expect(replayRes.status).toBe(200);
      expect(replayRes.headers['idempotent-replayed']).toBe('true');
    });

    it('TEST-API-DEV-010 detects duplicate lead by phone/email and flags DUPLICATE_SUSPECTED', async () => {
      const { app } = createTestPartnerApp();
      // Ingest original lead
      await request(app)
        .post('/v1/partner/leads')
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'idem_orig_001')
        .send(validLeadPayload);

      // Ingest second lead with same mobile
      const dupRes = await request(app)
        .post('/v1/partner/leads')
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'idem_dup_002')
        .send({
          ...validLeadPayload,
          externalReferenceId: 'EXT-PARTNER-102',
        });

      expect(dupRes.status).toBe(201);
      expect(dupRes.body.status).toBe('DUPLICATE_SUSPECTED');
      expect(dupRes.body.duplicateFlag).toBe(true);
    });

    it('TEST-API-DEV-011 strictly rejects S3-class plaintext PAN or Aadhaar in lead submission', async () => {
      const { app } = createTestPartnerApp();
      const payloadWithPan = {
        ...validLeadPayload,
        externalReferenceId: 'EXT-LEAD-PAN-TEST',
        metadata: { customerPan: 'ABCDE1234F' },
      };

      const res = await request(app)
        .post('/v1/partner/leads')
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'idem_pan_test_001')
        .send(payloadWithPan);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('Plaintext PAN detected');
    });

    it('TEST-API-DEV-012 retrieves lead details and queries paginated lead list', async () => {
      const { app } = createTestPartnerApp();
      const createRes = await request(app)
        .post('/v1/partner/leads')
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'idem_get_lead_001')
        .send(validLeadPayload);

      const leadId = createRes.body.id;

      // GET /partner/leads/:id
      const getRes = await request(app)
        .get(`/v1/partner/leads/${leadId}`)
        .set('X-API-Key', validKeySecret);

      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(leadId);
      expect(getRes.body.externalReferenceId).toBe('EXT-PARTNER-101');

      // GET /partner/leads
      const listRes = await request(app)
        .get('/v1/partner/leads?limit=10')
        .set('X-API-Key', validKeySecret);

      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);
      expect(listRes.body.meta.limit).toBe(10);
    });
  });

  describe('SUB-DEV.03 - SUB-DEV.04: Applications, Offers & Upload Sessions', () => {
    it('TEST-API-DEV-013 creates application, tracks status, and retrieves sanction offers', async () => {
      const { app } = createTestPartnerApp();

      // 1. Create lead
      const leadRes = await request(app)
        .post('/v1/partner/leads')
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'idem_app_flow_lead')
        .send({
          externalReferenceId: 'EXT-APP-FLOW-01',
          loanProductCode: 'HL-01',
          requestedAmount: { amount: '3000000.00', currency: 'INR' },
          applicant: {
            firstName: 'Sunil',
            lastName: 'Patel',
            mobile: '+919988776655',
            email: 'sunil.patel@example.com',
            city: 'Ahmedabad',
            state: 'Gujarat',
            pincode: '380001',
          },
          consent: {
            consentArtifactRef: 'CONSENT-REF-01',
            consentPurpose: 'LOAN_APPLICATION',
            optInTimestamp: '2026-10-14T09:00:00Z',
          },
        });

      const leadId = leadRes.body.id;

      // 2. POST /partner/applications
      const appRes = await request(app)
        .post('/v1/partner/applications')
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'idem_app_create_001')
        .send({
          leadId,
          productId: 'prd_01JTESTPRD0000000000000000',
          appliedAmount: { amount: '3000000.00', currency: 'INR' },
          tenureMonths: 180,
        });

      expect(appRes.status).toBe(201);
      expect(appRes.body.id).toMatch(/^app_/);
      expect(appRes.body.status).toBe('SUBMITTED');

      const appId = appRes.body.id;

      // 3. GET /partner/applications/:id
      const getAppRes = await request(app)
        .get(`/v1/partner/applications/${appId}`)
        .set('X-API-Key', validKeySecret);

      expect(getAppRes.status).toBe(200);
      expect(getAppRes.body.appliedAmount.amount).toBe('3000000.00');

      // 4. GET /partner/applications/:id/offers
      const offersRes = await request(app)
        .get(`/v1/partner/applications/${appId}/offers`)
        .set('X-API-Key', validKeySecret);

      expect(offersRes.status).toBe(200);
      expect(offersRes.body.offers.length).toBeGreaterThan(0);
      expect(offersRes.body.offers[0].interestRateAnnual).toBe('8.45');

      // 5. POST /partner/applications/:id/documents/upload-session
      const uploadRes = await request(app)
        .post(`/v1/partner/applications/${appId}/documents/upload-session`)
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'idem_upload_sess_001')
        .send({
          documentChecklistCodes: ['SALARY_SLIP', 'BANK_STATEMENT_6M'],
          expiresInMinutes: 120,
        });

      expect(uploadRes.status).toBe(201);
      expect(uploadRes.body.sessionId).toMatch(/^upl_/);
      expect(uploadRes.body.uploadUrl).toContain('/public/v1/upload/');
      expect(uploadRes.body.items).toContain('SALARY_SLIP');
    });
  });

  describe('SUB-DEV.05: Webhook Subscriptions & Delivery Engine', () => {
    it('TEST-API-DEV-014 manages webhook subscription lifecycle and simulates event dispatch', async () => {
      const { app } = createTestPartnerApp();

      // 1. Create subscription
      const subRes = await request(app)
        .post('/v1/partner/webhooks/subscriptions')
        .set('X-API-Key', validKeySecret)
        .send({
          name: 'Partner Status Callback',
          targetUrl: 'https://webhook.partner.com/dsa-events',
          subscribedEvents: ['lead.created', 'sanction.approved'],
        });

      expect(subRes.status).toBe(201);
      expect(subRes.body.id).toMatch(/^whs_/);
      expect(subRes.body.signingSecret).toMatch(/^whsec_/);

      const subId = subRes.body.id;

      // 2. List subscriptions
      const listSubRes = await request(app)
        .get('/v1/partner/webhooks/subscriptions')
        .set('X-API-Key', validKeySecret);

      expect(listSubRes.status).toBe(200);
      expect(listSubRes.body.data.some((s: { id: string }) => s.id === subId)).toBe(true);

      // 3. Simulate event
      const simRes = await request(app)
        .post('/v1/partner/sandbox/simulate-event')
        .set('X-API-Key', validKeySecret)
        .send({
          subscriptionId: subId,
          eventType: 'sanction.approved',
          customData: { sanctionedAmount: '5000000.00' },
        });

      expect(simRes.status).toBe(200);
      expect(simRes.body.deliveryStatus).toBe('DELIVERED');
      expect(simRes.body.signatureHeader).toMatch(/^sha256=/);

      // 4. Delete subscription
      const delRes = await request(app)
        .delete(`/v1/partner/webhooks/subscriptions/${subId}`)
        .set('X-API-Key', validKeySecret);

      expect(delRes.status).toBe(204);
    });
  });

  describe('Tenant Isolation & Boundary Enforcement', () => {
    it('TEST-API-DEV-015 isolates leads and records between Tenant A and Tenant B', async () => {
      const { app, apiKeyStore } = createTestPartnerApp();

      // Ingest lead in Tenant A
      const leadRes = await request(app)
        .post('/v1/partner/leads')
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'idem_tenant_iso_001')
        .send({
          externalReferenceId: 'EXT-TENANT-A-01',
          loanProductCode: 'HL-01',
          requestedAmount: { amount: '1000000.00', currency: 'INR' },
          applicant: {
            firstName: 'Tenant',
            lastName: 'UserA',
            mobile: '+919111111111',
            email: 'userA@tenantA.com',
            city: 'Delhi',
            state: 'Delhi',
            pincode: '110001',
          },
          consent: {
            consentArtifactRef: 'CONSENT-A',
            consentPurpose: 'LOAN_APPLICATION',
            optInTimestamp: '2026-10-14T09:00:00Z',
          },
        });

      const leadIdTenantA = leadRes.body.id;

      // Seed Key for Tenant B
      const tenantBKeySecret = 'dsa_live_tenant_b_secret_key_1234567890';
      const tenantBKeyRecord: ApiKeyRecord = {
        id: 'apk_01JTESTKEY0000000000000005',
        tenantId: TENANT_B,
        partnerId: 'partner_tenant_b',
        name: 'Tenant B Partner Key',
        keyPrefix: 'dsa_live_tenant_b_',
        keyHash: hashApiKey(tenantBKeySecret),
        scopes: ['partner.lead_ingest', 'partner.application_read'],
        rateLimitRpm: 120,
        status: 'ACTIVE',
      };
      apiKeyStore.addKey(tenantBKeyRecord);

      // Attempt to access Tenant A's lead using Tenant B's API key -> Must return 404 NOT_FOUND
      const crossTenantRes = await request(app)
        .get(`/v1/partner/leads/${leadIdTenantA}`)
        .set('X-API-Key', tenantBKeySecret);

      expect(crossTenantRes.status).toBe(404);
      expect(crossTenantRes.body.error.code).toBe('NOT_FOUND');
    });

    it('TEST-API-DEV-016 blocks Tenant B from accessing Tenant A applications, offers, and upload sessions', async () => {
      const { app, apiKeyStore } = createTestPartnerApp();

      // Ingest lead & application in Tenant A
      const leadRes = await request(app)
        .post('/v1/partner/leads')
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'idem_tenant_iso_app_01')
        .send({
          externalReferenceId: 'EXT-TENANT-A-APP-01',
          loanProductCode: 'HL-01',
          requestedAmount: { amount: '2000000.00', currency: 'INR' },
          applicant: {
            firstName: 'Aman',
            lastName: 'Gupta',
            mobile: '+919222222222',
            email: 'aman@tenantA.com',
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '400001',
          },
          consent: {
            consentArtifactRef: 'CONSENT-APP-A',
            consentPurpose: 'LOAN_APPLICATION',
            optInTimestamp: '2026-10-14T09:00:00Z',
          },
        });

      const appRes = await request(app)
        .post('/v1/partner/applications')
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'idem_tenant_iso_app_02')
        .send({
          leadId: leadRes.body.id,
          productId: 'prd_01JTESTPRD0000000000000000',
          appliedAmount: { amount: '2000000.00', currency: 'INR' },
          tenureMonths: 120,
        });

      const appId = appRes.body.id;

      // Seed Tenant B key
      const tenantBKeySecret = 'dsa_live_tenant_b_apps_123456789012345';
      apiKeyStore.addKey({
        id: 'apk_01JTESTKEY0000000000000006',
        tenantId: TENANT_B,
        partnerId: 'partner_tenant_b',
        name: 'Tenant B Partner Key',
        keyPrefix: 'dsa_live_tenant_b_',
        keyHash: hashApiKey(tenantBKeySecret),
        scopes: ['partner.lead_ingest', 'partner.application_read'],
        rateLimitRpm: 120,
        status: 'ACTIVE',
      });

      // Tenant B GET application -> 404 NOT_FOUND
      const getAppB = await request(app)
        .get(`/v1/partner/applications/${appId}`)
        .set('X-API-Key', tenantBKeySecret);
      expect(getAppB.status).toBe(404);
      expect(getAppB.body.error.code).toBe('NOT_FOUND');

      // Tenant B GET offers -> 404 NOT_FOUND
      const getOffersB = await request(app)
        .get(`/v1/partner/applications/${appId}/offers`)
        .set('X-API-Key', tenantBKeySecret);
      expect(getOffersB.status).toBe(404);
      expect(getOffersB.body.error.code).toBe('NOT_FOUND');

      // Tenant B POST upload session -> 404 NOT_FOUND
      const uploadB = await request(app)
        .post(`/v1/partner/applications/${appId}/documents/upload-session`)
        .set('X-API-Key', tenantBKeySecret)
        .set('Idempotency-Key', 'idem_upload_b_001')
        .send({
          documentChecklistCodes: ['PAN_CARD'],
        });
      expect(uploadB.status).toBe(404);
      expect(uploadB.body.error.code).toBe('NOT_FOUND');
    });

    it('TEST-API-DEV-017 isolates webhooks and prevents cross-tenant deletion or listing', async () => {
      const { app, apiKeyStore } = createTestPartnerApp();

      // Tenant A creates webhook
      const subRes = await request(app)
        .post('/v1/partner/webhooks/subscriptions')
        .set('X-API-Key', validKeySecret)
        .send({
          name: 'Tenant A Webhook',
          targetUrl: 'https://webhook.tenant-a.com/events',
          subscribedEvents: ['lead.created'],
        });

      const subIdA = subRes.body.id;

      // Seed Tenant B key with webhook.manage
      const tenantBKeySecret = 'dsa_live_tenant_b_wh_123456789012345';
      apiKeyStore.addKey({
        id: 'apk_01JTESTKEY0000000000000007',
        tenantId: TENANT_B,
        partnerId: 'partner_tenant_b',
        name: 'Tenant B Webhook Key',
        keyPrefix: 'dsa_live_tenant_b_',
        keyHash: hashApiKey(tenantBKeySecret),
        scopes: ['webhook.manage', 'api.read'],
        rateLimitRpm: 120,
        status: 'ACTIVE',
      });

      // Tenant B lists webhooks -> must not include subIdA
      const listB = await request(app)
        .get('/v1/partner/webhooks/subscriptions')
        .set('X-API-Key', tenantBKeySecret);
      expect(listB.status).toBe(200);
      expect(listB.body.data.some((s: { id: string }) => s.id === subIdA)).toBe(false);

      // Tenant B attempts to DELETE Tenant A's webhook -> 404 NOT_FOUND
      const delB = await request(app)
        .delete(`/v1/partner/webhooks/subscriptions/${subIdA}`)
        .set('X-API-Key', tenantBKeySecret);
      expect(delB.status).toBe(404);
      expect(delB.body.error.code).toBe('NOT_FOUND');
    });

    it('TEST-API-DEV-018 ignores injected tenantId in body or query to prevent tenant spoofing', async () => {
      const { app, apiKeyStore } = createTestPartnerApp();

      // Seed Tenant B key
      const tenantBKeySecret = 'dsa_live_tenant_b_spoof_1234567890';
      apiKeyStore.addKey({
        id: 'apk_01JTESTKEY0000000000000008',
        tenantId: TENANT_B,
        partnerId: 'partner_tenant_b',
        name: 'Tenant B Partner Key',
        keyPrefix: 'dsa_live_tenant_b_',
        keyHash: hashApiKey(tenantBKeySecret),
        scopes: ['partner.lead_ingest'],
        rateLimitRpm: 120,
        status: 'ACTIVE',
      });

      // Ingest lead with body attempting to inject tenantId: TENANT_A
      const spoofRes = await request(app)
        .post('/v1/partner/leads')
        .set('X-API-Key', tenantBKeySecret)
        .set('Idempotency-Key', 'idem_spoof_001')
        .send({
          tenantId: TENANT_A, // Malicious spoof attempt
          externalReferenceId: 'EXT-SPOOF-01',
          loanProductCode: 'HL-01',
          requestedAmount: { amount: '1000000.00', currency: 'INR' },
          applicant: {
            firstName: 'Spoofer',
            lastName: 'Malicious',
            mobile: '+919333333333',
            email: 'spoofer@test.com',
            city: 'Delhi',
            state: 'Delhi',
            pincode: '110001',
          },
          consent: {
            consentArtifactRef: 'CONSENT-SPOOF',
            consentPurpose: 'LOAN_APPLICATION',
            optInTimestamp: '2026-10-14T09:00:00Z',
          },
        });

      expect(spoofRes.status).toBe(201);
      // Lead must strictly belong to TENANT_B, not the spoofed TENANT_A
      expect(spoofRes.body.tenantId).toBe(TENANT_B);
    });
  });

  describe('PHASE 2 & PHASE 3: Functional Validation, Error Handling & Granular RBAC', () => {
    it('TEST-API-DEV-019 rejects missing required fields and malformed payloads with 422 VALIDATION_ERROR', async () => {
      const { app } = createTestPartnerApp();

      // Missing applicant
      const res1 = await request(app)
        .post('/v1/partner/leads')
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'idem_val_err_01')
        .send({
          externalReferenceId: 'EXT-01',
          loanProductCode: 'HL-01',
          requestedAmount: { amount: '1000000.00', currency: 'INR' },
        });
      expect(res1.status).toBe(422);
      expect(res1.body.error.code).toBe('VALIDATION_ERROR');

      // Malformed email
      const res2 = await request(app)
        .post('/v1/partner/leads')
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'idem_val_err_02')
        .send({
          externalReferenceId: 'EXT-02',
          loanProductCode: 'HL-01',
          requestedAmount: { amount: '1000000.00', currency: 'INR' },
          applicant: {
            firstName: 'Test',
            lastName: 'User',
            mobile: '+919999999999',
            email: 'not-an-email',
            city: 'City',
            state: 'State',
            pincode: '123456',
          },
          consent: {
            consentArtifactRef: 'REF',
            consentPurpose: 'LOAN_APPLICATION',
            optInTimestamp: '2026-10-14T09:00:00Z',
          },
        });
      expect(res2.status).toBe(422);
      expect(res2.body.error.code).toBe('VALIDATION_ERROR');

      // Invalid tenure (< 3 months) on application
      const res3 = await request(app)
        .post('/v1/partner/applications')
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'idem_val_err_03')
        .send({
          leadId: 'lead_01JTESTLEAD00000000000000',
          productId: 'prd_01JTESTPRD0000000000000000',
          appliedAmount: { amount: '1000000.00', currency: 'INR' },
          tenureMonths: 1, // Invalid: min is 3
        });
      expect(res3.status).toBe(422);
      expect(res3.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('TEST-API-DEV-020 handles non-existent resources and unsupported routes safely without leaking stack traces', async () => {
      const { app } = createTestPartnerApp();

      // Non-existent application
      const res1 = await request(app)
        .get('/v1/partner/applications/app_01JNONEXISTENT000000000000')
        .set('X-API-Key', validKeySecret);
      expect(res1.status).toBe(404);
      expect(res1.body.error.code).toBe('NOT_FOUND');
      expect(res1.body.error.stack).toBeUndefined();

      // Unsupported method on lead detail (POST to GET route)
      const res2 = await request(app)
        .post('/v1/partner/leads/lead_01JTESTLEAD00000000000000')
        .set('X-API-Key', validKeySecret)
        .send({});
      expect(res2.status).toBe(404);

      // Completely unsupported route under /partner
      const res3 = await request(app)
        .get('/v1/partner/unknown-resource-route')
        .set('X-API-Key', validKeySecret);
      expect(res3.status).toBe(404);
    });

    it('TEST-API-DEV-021 allows API key with configured authorized IP address', async () => {
      const { app, apiKeyStore } = createTestPartnerApp();

      const authorizedKeySecret = 'dsa_live_authorized_ip_key_1234567890';
      apiKeyStore.addKey({
        id: 'apk_01JTESTKEY0000000000000009',
        tenantId: TENANT_A,
        partnerId: 'partner_ip_authorized',
        name: 'Authorized IP Partner Key',
        keyPrefix: 'dsa_live_authorized',
        keyHash: hashApiKey(authorizedKeySecret),
        scopes: ['partner.lead_ingest'],
        allowedIps: ['127.0.0.1', '::1', '::ffff:127.0.0.1'], // Matches loopback test client
        rateLimitRpm: 120,
        status: 'ACTIVE',
      });

      const res = await request(app)
        .post('/v1/partner/sandbox/echo')
        .set('X-API-Key', authorizedKeySecret)
        .send({ message: 'authorized-ip-ping' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('TEST-API-DEV-022 enforces granular permission scopes and returns 403 FORBIDDEN when scope is missing', async () => {
      const { app, apiKeyStore } = createTestPartnerApp();

      // Seed key with ONLY 'partner.lead_ingest' scope (no 'api.manage' or 'webhook.manage')
      const ingestOnlyKeySecret = 'dsa_live_ingest_only_key_12345678901234';
      apiKeyStore.addKey({
        id: 'apk_01JTESTKEY0000000000000010',
        tenantId: TENANT_A,
        partnerId: 'partner_ingest_only',
        name: 'Ingest Only Partner Key',
        keyPrefix: 'dsa_live_ingest_only',
        keyHash: hashApiKey(ingestOnlyKeySecret),
        scopes: ['partner.lead_ingest'],
        rateLimitRpm: 60,
        status: 'ACTIVE',
      });

      // Attempt to create API key -> requires api.manage -> 403
      const keyRes = await request(app)
        .post('/v1/partner/api-keys')
        .set('X-API-Key', ingestOnlyKeySecret)
        .send({
          partnerId: 'p2',
          name: 'Unauthorized Key',
          scopes: ['partner.lead_ingest'],
        });
      expect(keyRes.status).toBe(403);
      expect(keyRes.body.error.code).toBe('FORBIDDEN');

      // Attempt to create webhook -> requires webhook.manage -> 403
      const whRes = await request(app)
        .post('/v1/partner/webhooks/subscriptions')
        .set('X-API-Key', ingestOnlyKeySecret)
        .send({
          name: 'Unauthorized Webhook',
          targetUrl: 'https://webhook.test.com/events',
          subscribedEvents: ['lead.created'],
        });
      expect(whRes.status).toBe(403);
      expect(whRes.body.error.code).toBe('FORBIDDEN');

      // Attempt to read application -> requires partner.application_read -> 403
      const appRes = await request(app)
        .get('/v1/partner/applications/app_01JTESTAPP0000000000000000')
        .set('X-API-Key', ingestOnlyKeySecret);
      expect(appRes.status).toBe(403);
      expect(appRes.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('PHASE 4: Comprehensive Idempotency Enforcement', () => {
    it('TEST-API-DEV-023 rejects missing or invalid Idempotency-Key on mutating application routes', async () => {
      const { app } = createTestPartnerApp();

      // Missing Idempotency-Key on POST /partner/applications
      const res1 = await request(app)
        .post('/v1/partner/applications')
        .set('X-API-Key', validKeySecret)
        .send({
          leadId: 'lead_01JTESTLEAD00000000000000',
          productId: 'prd_01JTESTPRD0000000000000000',
          appliedAmount: { amount: '1000000.00', currency: 'INR' },
          tenureMonths: 60,
        });
      expect(res1.status).toBe(422);
      expect(res1.body.error.code).toBe('VALIDATION_ERROR');
      expect(res1.body.error.message).toContain('Idempotency-Key header is required');

      // Invalid format (too short < 8 chars)
      const res2 = await request(app)
        .post('/v1/partner/leads')
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'short')
        .send({
          externalReferenceId: 'EXT-IDEM-01',
          loanProductCode: 'HL-01',
          requestedAmount: { amount: '1000000.00', currency: 'INR' },
          applicant: {
            firstName: 'A',
            lastName: 'B',
            mobile: '+919999999991',
            email: 'ab@test.com',
            city: 'City',
            state: 'State',
            pincode: '400001',
          },
          consent: {
            consentArtifactRef: 'REF',
            consentPurpose: 'LOAN_APPLICATION',
            optInTimestamp: '2026-10-14T09:00:00Z',
          },
        });
      expect(res2.status).toBe(422);
      expect(res2.body.error.code).toBe('VALIDATION_ERROR');
      expect(res2.body.error.message).toContain('Invalid Idempotency-Key format');
    });

    it('TEST-API-DEV-024 replays application creation with identical response and prevents duplication', async () => {
      const { app } = createTestPartnerApp();

      // Create lead first
      const leadRes = await request(app)
        .post('/v1/partner/leads')
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'idem_lead_app_replay')
        .send({
          externalReferenceId: 'EXT-APP-REPLAY-01',
          loanProductCode: 'HL-01',
          requestedAmount: { amount: '1500000.00', currency: 'INR' },
          applicant: {
            firstName: 'Replay',
            lastName: 'User',
            mobile: '+919877777777',
            email: 'replay@test.com',
            city: 'Pune',
            state: 'Maharashtra',
            pincode: '411001',
          },
          consent: {
            consentArtifactRef: 'REF-REPLAY',
            consentPurpose: 'LOAN_APPLICATION',
            optInTimestamp: '2026-10-14T09:00:00Z',
          },
        });

      const leadId = leadRes.body.id;

      // 1st Application submission
      const appRes1 = await request(app)
        .post('/v1/partner/applications')
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'idem_app_exact_replay_key')
        .send({
          leadId,
          productId: 'prd_01JTESTPRD0000000000000000',
          appliedAmount: { amount: '1500000.00', currency: 'INR' },
          tenureMonths: 180,
        });

      expect(appRes1.status).toBe(201);
      const originalAppId = appRes1.body.id;

      // 2nd Replayed submission
      const appRes2 = await request(app)
        .post('/v1/partner/applications')
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'idem_app_exact_replay_key')
        .send({
          leadId,
          productId: 'prd_01JTESTPRD0000000000000000',
          appliedAmount: { amount: '1500000.00', currency: 'INR' },
          tenureMonths: 180,
        });

      expect(appRes2.status).toBe(200);
      expect(appRes2.headers['idempotent-replayed']).toBe('true');
      expect(appRes2.body.id).toBe(originalAppId);
    });
  });

  describe('PHASE 5: Sensitive Data & Plaintext Aadhaar Rejection', () => {
    it('TEST-API-DEV-025 strictly rejects plaintext Aadhaar number in lead submission payload', async () => {
      const { app } = createTestPartnerApp();

      const payloadWithAadhaar = {
        externalReferenceId: 'EXT-AADHAAR-TEST',
        loanProductCode: 'HL-01',
        requestedAmount: { amount: '1000000.00', currency: 'INR' },
        applicant: {
          firstName: 'Aadhaar',
          lastName: 'Tester',
          mobile: '+919876543299',
          email: 'aadhaar@test.com',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001',
        },
        consent: {
          consentArtifactRef: 'REF-AADHAAR',
          consentPurpose: 'LOAN_APPLICATION',
          optInTimestamp: '2026-10-14T09:00:00Z',
        },
        metadata: {
          applicantAadhaar: '9876 5432 1098', // Prohibited S3 Aadhaar format
        },
      };

      const res = await request(app)
        .post('/v1/partner/leads')
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'idem_aadhaar_test_01')
        .send(payloadWithAadhaar);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('Plaintext Aadhaar detected');
    });

    it('TEST-API-DEV-026 accepts valid numeric business data (Pincode, amount, phone) without false positive rejection', async () => {
      const { app } = createTestPartnerApp();

      const validPayload = {
        externalReferenceId: 'EXT-VALID-NUMBERS',
        loanProductCode: 'HL-01',
        requestedAmount: { amount: '9876543.21', currency: 'INR' },
        applicant: {
          firstName: 'Valid',
          lastName: 'Numbers',
          mobile: '+919876543210',
          email: 'valid.numbers@example.com',
          city: 'Bangalore',
          state: 'Karnataka',
          pincode: '560001',
        },
        consent: {
          consentArtifactRef: 'REF-NUMERIC-SAFE',
          consentPurpose: 'LOAN_APPLICATION',
          optInTimestamp: '2026-10-14T09:00:00Z',
        },
        metadata: {
          branchPincode: '560001',
          requestedTenure: 240,
        },
      };

      const res = await request(app)
        .post('/v1/partner/leads')
        .set('X-API-Key', validKeySecret)
        .set('Idempotency-Key', 'idem_valid_num_01')
        .send(validPayload);

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^lead_/);
      expect(res.body.status).toBe('RECEIVED');
    });
  });

  describe('PHASE 7: Webhook Cryptographic Security & URL Safety', () => {
    it('TEST-API-DEV-027 rejects insecure HTTP target URLs for production webhooks', async () => {
      const { app } = createTestPartnerApp();

      const res = await request(app)
        .post('/v1/partner/webhooks/subscriptions')
        .set('X-API-Key', validKeySecret)
        .send({
          name: 'Insecure Webhook',
          targetUrl: 'http://insecure.partner.com/events',
          subscribedEvents: ['lead.created'],
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.some((d: { field?: string }) => d.field === 'targetUrl')).toBe(true);
    });

    it('TEST-API-DEV-028 verifies that tampered payloads fail cryptographic signature verification', async () => {
      const { app, webhookService } = createTestPartnerApp();

      // Create subscription
      const subRes = await request(app)
        .post('/v1/partner/webhooks/subscriptions')
        .set('X-API-Key', validKeySecret)
        .send({
          name: 'Tamper Test Webhook',
          targetUrl: 'https://webhook.safe.com/events',
          subscribedEvents: ['sanction.approved'],
        });

      const subId = subRes.body.id;
      const signingSecret = subRes.body.signingSecret;

      // Simulate event
      const simRes = await request(app)
        .post('/v1/partner/sandbox/simulate-event')
        .set('X-API-Key', validKeySecret)
        .send({
          subscriptionId: subId,
          eventType: 'sanction.approved',
          customData: { sanctionedAmount: '2500000.00' },
        });

      const legitimateSignature = simRes.body.signatureHeader;

      // Tampered payload
      const tamperedPayload = JSON.stringify({
        eventType: 'sanction.approved',
        tamperedAmount: '9999999.00',
      });
      const tamperedSignature = webhookService.computeSignature(signingSecret, tamperedPayload);

      expect(tamperedSignature).not.toBe(legitimateSignature);
    });

    it('TEST-API-DEV-029 ensures signingSecret is never leaked in list subscriptions response', async () => {
      const { app } = createTestPartnerApp();

      // Create subscription
      const subRes = await request(app)
        .post('/v1/partner/webhooks/subscriptions')
        .set('X-API-Key', validKeySecret)
        .send({
          name: 'Secret Leak Test Webhook',
          targetUrl: 'https://webhook.leaktest.com/events',
          subscribedEvents: ['lead.created'],
        });

      expect(subRes.status).toBe(201);
      expect(subRes.body.signingSecret).toBeDefined();

      // List subscriptions
      const listRes = await request(app)
        .get('/v1/partner/webhooks/subscriptions')
        .set('X-API-Key', validKeySecret);

      expect(listRes.status).toBe(200);
      for (const item of (listRes.body.data as Record<string, unknown>[])) {
        expect(item.signingSecret).toBeUndefined();
        expect(item.secretHash).toBeUndefined();
      }
    });
  });

  // ==========================================================================
  // Module 36: API Management (MOD-API) - /v1/api-clients
  // ==========================================================================

  describe('Module 36: API Management (MOD-API) - /v1/api-clients', () => {
    function createTestAdminApp(principalOverrides: Partial<Principal> = {}) {
      const apiKeyStore = new InMemoryApiKeyStore();
      const baseDeps = testDeps();
      const partnerService = new PartnerApiService(baseDeps, apiKeyStore);
      const webhookService = new WebhookDeliveryService(baseDeps);

      const deps = {
        ...baseDeps,
        apiKeyStore,
        partnerService,
        webhookService,
      };

      const app = createApp({
        deps,
        corsAllowedOrigins: ['*'],
        auth: fakeAuth(
          testPrincipal({
            tenantId: TENANT_A,
            grants: [
              { code: 'api.manage', scope: 'TENANT', branchIds: [] },
              { code: 'api.read', scope: 'TENANT', branchIds: [] },
            ],
            ...principalOverrides,
          }),
        ),
      });

      return { app, partnerService };
    }

    it('TEST-API-MGT-001 lists api clients for tenant (initially empty)', async () => {
      const { app } = createTestAdminApp();
      const res = await request(app).get('/v1/api-clients');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(0);
    });

    it('TEST-API-MGT-002 creates api client, issues clt_ ID and one-time clientSecret', async () => {
      const { app } = createTestAdminApp();
      const payload = {
        name: 'Fintech Integration Client',
        partnerName: 'Fintech Corp India',
        scopes: ['partner.lead_ingest', 'partner.application_read'],
        rateLimitRpm: 240,
        allowedIps: ['203.0.113.15'],
      };

      const res = await request(app)
        .post('/v1/api-clients')
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^clt_/);
      expect(res.body.clientId).toMatch(/^clt_/);
      expect(res.body.clientSecret).toMatch(/^sec_/); // one-time secret returned
      expect(res.body.name).toBe(payload.name);
      expect(res.body.partnerName).toBe(payload.partnerName);
      expect(res.body.scopes).toEqual(payload.scopes);
      expect(res.body.rateLimitRpm).toBe(240);
      expect(res.body.status).toBe('ACTIVE');
    });

    it('TEST-API-MGT-003 gets api client details and ensures clientSecret is NOT exposed', async () => {
      const { app } = createTestAdminApp();
      const createRes = await request(app)
        .post('/v1/api-clients')
        .send({
          name: 'Read Test Client',
          partnerName: 'Read Partner',
          scopes: ['partner.lead_ingest'],
        });

      const clientId = createRes.body.id;
      const getRes = await request(app).get(`/v1/api-clients/${clientId}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(clientId);
      expect(getRes.body.clientSecret).toBeUndefined(); // Secret never exposed on read
      expect(getRes.body.clientSecretHash).toBeUndefined();
    });

    it('TEST-API-MGT-004 updates api client configuration and status', async () => {
      const { app } = createTestAdminApp();
      const createRes = await request(app)
        .post('/v1/api-clients')
        .send({
          name: 'Update Test Client',
          partnerName: 'Update Partner',
          scopes: ['partner.lead_ingest'],
          rateLimitRpm: 120,
        });

      const clientId = createRes.body.id;
      const patchRes = await request(app)
        .patch(`/v1/api-clients/${clientId}`)
        .send({
          status: 'SUSPENDED',
          rateLimitRpm: 300,
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.status).toBe('SUSPENDED');
      expect(patchRes.body.rateLimitRpm).toBe(300);
    });

    it('TEST-API-MGT-005 rotates client secret returning new secret', async () => {
      const { app } = createTestAdminApp();
      const createRes = await request(app)
        .post('/v1/api-clients')
        .send({
          name: 'Rotate Secret Client',
          partnerName: 'Rotate Partner',
          scopes: ['partner.lead_ingest'],
        });

      const initialSecret = createRes.body.clientSecret;
      const clientId = createRes.body.id;

      const rotateRes = await request(app)
        .post(`/v1/api-clients/${clientId}/rotate-secret`);

      expect(rotateRes.status).toBe(200);
      expect(rotateRes.body.clientId).toBe(createRes.body.clientId);
      expect(rotateRes.body.clientSecret).toMatch(/^sec_/);
      expect(rotateRes.body.clientSecret).not.toBe(initialSecret);
    });

    it('TEST-API-MGT-006 deletes api client', async () => {
      const { app } = createTestAdminApp();
      const createRes = await request(app)
        .post('/v1/api-clients')
        .send({
          name: 'Delete Test Client',
          partnerName: 'Delete Partner',
          scopes: ['partner.lead_ingest'],
        });

      const clientId = createRes.body.id;
      const delRes = await request(app).delete(`/v1/api-clients/${clientId}`);
      expect(delRes.status).toBe(204);

      const getRes = await request(app).get(`/v1/api-clients/${clientId}`);
      expect(getRes.status).toBe(404);
    });

    it('TEST-API-MGT-007 rejects creation when caller lacks api.manage with 403 FORBIDDEN', async () => {
      // User with only api.read, missing api.manage
      const { app } = createTestAdminApp({
        grants: [{ code: 'api.read', scope: 'TENANT', branchIds: [] }],
      });

      const res = await request(app)
        .post('/v1/api-clients')
        .send({
          name: 'Unauthorized Client',
          partnerName: 'Hacker Corp',
          scopes: ['partner.lead_ingest'],
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });
});
