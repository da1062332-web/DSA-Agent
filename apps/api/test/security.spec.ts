// apps/api/test/security.spec.ts — Module 39: Security (MOD-SEC, DOM-N) Integration & Route Tests
import crypto from 'node:crypto';
import type { RequestContext } from '@dsa/contracts';
import { describe, expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, fakeAuth, testPrincipal, testDeps } from './support/fake-auth';
import { createMockSecurityStore } from './support/mock-security-db';
import { BufferedSiemClient, type SiemPort, type SiemEvent } from '../src/modules/security/siem';
import { EnvelopeEncryptionService, DeferredKmsPort, type KmsPort } from '../src/modules/security/kms';
import {
  validateRetentionPurge,
  assertRetentionCompliance,
  RETENTION_RULES,
} from '../src/modules/security/retention';
import { SecurityService } from '../src/modules/security/service';

describe('Module 39: Security (MOD-SEC) Integration & Security Tests', () => {
  let store: ReturnType<typeof createMockSecurityStore>;
  const tenantA = 'ten_01J00000000000000000000000';
  const tenantB = 'ten_01J99999999999999999999999';

  // Compliance / InfoSec Lead principal with security permissions
  const compliancePrincipal = testPrincipal({
    tenantId: tenantA,
    id: 'usr_infosec_lead_01',
    grants: [
      { code: 'security.incident', scope: 'TENANT', branchIds: [] },
      { code: 'security.vuln', scope: 'TENANT', branchIds: [] },
    ],
  });

  // Regular staff principal without security permissions
  const regularPrincipal = testPrincipal({
    tenantId: tenantA,
    id: 'usr_regular_staff_01',
    grants: [{ code: 'lead.read', scope: 'TENANT', branchIds: [] }],
  });

  // Tenant B compliance principal for cross-tenant tests
  const tenantBCompliancePrincipal = testPrincipal({
    tenantId: tenantB,
    id: 'usr_tenant_b_compliance',
    grants: [
      { code: 'security.incident', scope: 'TENANT', branchIds: [] },
      { code: 'security.vuln', scope: 'TENANT', branchIds: [] },
    ],
  });

  beforeEach(() => {
    store = createMockSecurityStore();
  });

  function getApp(principal?: ReturnType<typeof testPrincipal>) {
    return createTestApp({
      auth: principal ? fakeAuth(principal) : undefined,
      deps: testDeps({ txRunner: store.txRunner }),
    });
  }

  // ==========================================================================
  // SUB-SEC.01: Security Monitoring & Event Redaction (ENT-096)
  // ==========================================================================
  describe('SUB-SEC.01 — Security Monitoring (ENT-096)', () => {
    it('records security events with strict credential and secret redaction', async () => {
      const app = getApp(compliancePrincipal);

      const payload = {
        type: 'AUTH_FAILURE',
        principal: 'usr_target_01',
        ip: '203.0.113.42',
        severity: 'HIGH',
        details: {
          attemptCount: 3,
          password: 'SuperSecretPassword123!',
          token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.fake_jwt',
          apiKey: 'sec_live_api_key_1234567890',
          cleanMetadata: 'Normal diagnostic info',
        },
      };

      const res = await request(app).post('/v1/security/events').send(payload).expect(201);

      expect(res.body.id).toMatch(/^sec_[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(res.body.type).toBe('AUTH_FAILURE');
      expect(res.body.severity).toBe('HIGH');

      // Assert credentials are redacted
      expect(res.body.details.password).toBe('[REDACTED]');
      expect(res.body.details.token).toBe('[REDACTED]');
      expect(res.body.details.apiKey).toBe('[REDACTED]');
      expect(res.body.details.cleanMetadata).toBe('Normal diagnostic info');

      // Verify stored row in mock DB
      const storedEvent = store.securityEvents.find((e) => e.id === res.body.id);
      expect(storedEvent).toBeDefined();
      expect(storedEvent?.details.password).toBe('[REDACTED]');
      expect(storedEvent?.details.token).toBe('[REDACTED]');
    });

    it('rejects invalid security event severity or missing required fields', async () => {
      const app = getApp(compliancePrincipal);

      await request(app)
        .post('/v1/security/events')
        .send({
          type: 'INVALID_EVENT_TYPE',
          principal: 'usr_01',
          ip: '127.0.0.1',
          severity: 'SUPER_URGENT',
        })
        .expect(422);
    });

    it('allows authorized InfoSec users to list security events in their tenant', async () => {
      const app = getApp(compliancePrincipal);

      // Record 2 events
      await request(app)
        .post('/v1/security/events')
        .send({
          type: 'AUTH_FAILURE',
          principal: 'usr_01',
          ip: '10.0.0.1',
          severity: 'MEDIUM',
          details: { attempt: 1 },
        })
        .expect(201);

      await request(app)
        .post('/v1/security/events')
        .send({
          type: 'RATE_LIMIT_EXCEEDED',
          principal: 'usr_02',
          ip: '10.0.0.2',
          severity: 'LOW',
          details: { endpoint: '/v1/leads' },
        })
        .expect(201);

      const res = await request(app).get('/v1/security/events').expect(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.data[0].tenantId).toBe(tenantA);
    });

    it('forbids ordinary users without security.incident from reading security events', async () => {
      const app = getApp(regularPrincipal);
      await request(app).get('/v1/security/events').expect(403);
    });

    it('enforces tenant isolation on security event queries', async () => {
      // Record event in Tenant A
      const appA = getApp(compliancePrincipal);
      await request(appA)
        .post('/v1/security/events')
        .send({
          type: 'SUSPICIOUS_ACCESS',
          principal: 'usr_tenant_a_actor',
          ip: '10.1.1.1',
          severity: 'CRITICAL',
          details: {},
        })
        .expect(201);

      // Query with Tenant B principal
      const appB = getApp(tenantBCompliancePrincipal);
      const resB = await request(appB).get('/v1/security/events').expect(200);
      expect(resB.body.data.length).toBe(0);
    });
  });

  // ==========================================================================
  // SUB-SEC.02: Incident and Breach Management (ENT-102, API-SEC-001, API-SEC-002)
  // ==========================================================================
  describe('SUB-SEC.02 — Incident Management (API-SEC-001 & API-SEC-002)', () => {
    const validIncidentPayload = {
      type: 'DATA_BREACH',
      severity: 'CRITICAL',
      detectedAt: '2026-10-15T08:30:00.000Z',
      personalDataInvolved: true,
      affectedTenants: [tenantA],
      notifications: {
        authority: {
          notified: true,
          notifiedAt: '2026-10-15T09:00:00.000Z',
          evidenceRef: 'CERT-IN-2026-0042',
          recipient: 'incident@cert-in.org.in',
        },
        tenant: {
          notified: false,
          notifiedAt: null,
        },
      },
      status: 'INVESTIGATING',
      postMortemRef: 'https://infosec.internal/incidents/inc-42',
    };

    it('API-SEC-001: records a security incident with Idempotency-Key and returns ETag', async () => {
      const app = getApp(compliancePrincipal);
      const idemKey = 'idem-inc-create-001';

      const res = await request(app)
        .post('/v1/incidents')
        .set('Idempotency-Key', idemKey)
        .send(validIncidentPayload)
        .expect(201);

      expect(res.body.id).toMatch(/^inc_[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(res.body.tenantId).toBe(tenantA);
      expect(res.body.type).toBe('DATA_BREACH');
      expect(res.body.severity).toBe('CRITICAL');
      expect(res.body.status).toBe('INVESTIGATING');
      expect(res.body.lockVersion).toBe(0);
      expect(res.headers.etag).toBe('"0"');

      // Verify audit trail recorded
      expect(store.auditEvents.length).toBeGreaterThan(0);
      expect(store.auditEvents[0]?.action).toBe('incident.created');
    });

    it('API-SEC-001: replays stored response when identical Idempotency-Key is reused', async () => {
      const app = getApp(compliancePrincipal);
      const idemKey = 'idem-inc-replay-001';

      const firstRes = await request(app)
        .post('/v1/incidents')
        .set('Idempotency-Key', idemKey)
        .send(validIncidentPayload)
        .expect(201);

      // Replay same request
      const replayRes = await request(app)
        .post('/v1/incidents')
        .set('Idempotency-Key', idemKey)
        .send(validIncidentPayload)
        .expect(201);

      expect(replayRes.body.id).toBe(firstRes.body.id);
      expect(replayRes.headers['idempotent-replayed']).toBe('true');
      expect(store.incidents.length).toBe(1);
    });

    it('API-SEC-001: rejects duplicate Idempotency-Key with different payload (422 IDEMPOTENCY_KEY_REUSED)', async () => {
      const app = getApp(compliancePrincipal);
      const idemKey = 'idem-inc-conflict-001';

      await request(app)
        .post('/v1/incidents')
        .set('Idempotency-Key', idemKey)
        .send(validIncidentPayload)
        .expect(201);

      // Different payload with same key
      const conflictRes = await request(app)
        .post('/v1/incidents')
        .set('Idempotency-Key', idemKey)
        .send({
          ...validIncidentPayload,
          severity: 'LOW',
        })
        .expect(422);

      expect(conflictRes.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('API-SEC-001: requires Idempotency-Key header (400 MALFORMED_REQUEST)', async () => {
      const app = getApp(compliancePrincipal);
      await request(app).post('/v1/incidents').send(validIncidentPayload).expect(400);
    });

    it('API-SEC-002: updates incident assessment and notification timestamps with If-Match', async () => {
      const app = getApp(compliancePrincipal);

      const createRes = await request(app)
        .post('/v1/incidents')
        .set('Idempotency-Key', 'idem-inc-update-001')
        .send(validIncidentPayload)
        .expect(201);

      const incidentId = createRes.body.id;

      // Update incident with valid If-Match
      const updateRes = await request(app)
        .patch(`/v1/incidents/${incidentId}`)
        .set('If-Match', '"0"')
        .send({
          status: 'CONTAINED',
          notifications: {
            tenant: {
              notified: true,
              notifiedAt: '2026-10-15T09:45:00.000Z',
              evidenceRef: 'TENANT-ADVISORY-01',
            },
          },
        })
        .expect(200);

      expect(updateRes.body.status).toBe('CONTAINED');
      expect(updateRes.body.lockVersion).toBe(1);
      expect(updateRes.headers.etag).toBe('"1"');
      expect(updateRes.body.notifications.tenant.notified).toBe(true);
      expect(updateRes.body.notifications.authority.notified).toBe(true); // preserved merged

      // Verify audit update event
      const updateAuditEvent = store.auditEvents.find((e) => e.action === 'incident.updated');
      expect(updateAuditEvent).toBeDefined();
    });

    it('API-SEC-002: rejects stale updates with 409 VERSION_CONFLICT', async () => {
      const app = getApp(compliancePrincipal);

      const createRes = await request(app)
        .post('/v1/incidents')
        .set('Idempotency-Key', 'idem-inc-stale-001')
        .send(validIncidentPayload)
        .expect(201);

      const incidentId = createRes.body.id;

      // Stale update sending old version 99
      const staleRes = await request(app)
        .patch(`/v1/incidents/${incidentId}`)
        .set('If-Match', '"99"')
        .send({
          status: 'CONTAINED',
        })
        .expect(409);

      expect(staleRes.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('API-SEC-002: rejects update without If-Match header (400 MALFORMED_REQUEST)', async () => {
      const app = getApp(compliancePrincipal);

      const createRes = await request(app)
        .post('/v1/incidents')
        .set('Idempotency-Key', 'idem-inc-no-etag-001')
        .send(validIncidentPayload)
        .expect(201);

      await request(app).patch(`/v1/incidents/${createRes.body.id}`).send({ status: 'RESOLVED' }).expect(400);
    });

    it('API-SEC-002: validates notification evidence requires notifiedAt when notified=true', async () => {
      const app = getApp(compliancePrincipal);

      const createRes = await request(app)
        .post('/v1/incidents')
        .set('Idempotency-Key', 'idem-inc-notify-val-001')
        .send(validIncidentPayload)
        .expect(201);

      const res = await request(app)
        .patch(`/v1/incidents/${createRes.body.id}`)
        .set('If-Match', '"0"')
        .send({
          notifications: {
            authority: {
              notified: true,
              notifiedAt: null, // Invalid: notified is true but timestamp is missing
            },
          },
        })
        .expect(422);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('API-SEC-002: rejects modifying CLOSED incident status without governance reopening rules', async () => {
      const app = getApp(compliancePrincipal);

      const createRes = await request(app)
        .post('/v1/incidents')
        .set('Idempotency-Key', 'idem-inc-closed-001')
        .send({
          ...validIncidentPayload,
          status: 'CLOSED',
        })
        .expect(201);

      const res = await request(app)
        .patch(`/v1/incidents/${createRes.body.id}`)
        .set('If-Match', '"0"')
        .send({
          status: 'OPEN',
        })
        .expect(409);

      expect(res.body.error.code).toBe('INVALID_TRANSITION');
    });

    it('prevents cross-tenant access to incidents (404 NOT_FOUND)', async () => {
      // Create incident in Tenant A
      const appA = getApp(compliancePrincipal);
      const createRes = await request(appA)
        .post('/v1/incidents')
        .set('Idempotency-Key', 'idem-inc-cross-tenant-001')
        .send(validIncidentPayload)
        .expect(201);

      const incidentId = createRes.body.id;

      // Tenant B tries to GET Tenant A's incident
      const appB = getApp(tenantBCompliancePrincipal);
      await request(appB).get(`/v1/incidents/${incidentId}`).expect(404);

      // Tenant B tries to PATCH Tenant A's incident
      await request(appB)
        .patch(`/v1/incidents/${incidentId}`)
        .set('If-Match', '"0"')
        .send({ status: 'RESOLVED' })
        .expect(404);
    });

    it('rejects unauthenticated requests with 401 UNAUTHENTICATED', async () => {
      const unauthApp = getApp(undefined);
      await request(unauthApp).post('/v1/incidents').expect(401);
      await request(unauthApp).get('/v1/incidents').expect(401);
      await request(unauthApp).patch('/v1/incidents/inc_01J00000000000000000000000').expect(401);
    });

    it('rejects users without security.incident permission with 403 FORBIDDEN', async () => {
      const regularApp = getApp(regularPrincipal);
      await request(regularApp)
        .post('/v1/incidents')
        .set('Idempotency-Key', 'idem-unauth-01')
        .send(validIncidentPayload)
        .expect(403);

      await request(regularApp).get('/v1/incidents').expect(403);
    });
  });

  // ==========================================================================
  // SUB-SEC.04: Encryption, Blind Indexing & Tamper Detection
  // ==========================================================================
  describe('SUB-SEC.04 — Field-Level Encryption & Cryptographic Integrity', () => {
    const ENCRYPTION_KEY = crypto.createHash('sha256').update('dev_dsa_encryption_key_32_bytes!').digest();

    function encryptAesGcm(plaintext: string): Buffer {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, encrypted]);
    }

    function decryptAesGcm(data: Buffer): string {
      const iv = data.subarray(0, 12);
      const tag = data.subarray(12, 28);
      const ciphertext = data.subarray(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
      decipher.setAuthTag(tag);
      return decipher.update(ciphertext) + decipher.final('utf8');
    }

    it('successfully encrypts and decrypts with authenticated AES-256-GCM', () => {
      const pan = 'ABCDE1234F';
      const ciphertext = encryptAesGcm(pan);

      expect(Buffer.isBuffer(ciphertext)).toBe(true);
      expect(ciphertext.toString('utf8')).not.toBe(pan);

      const decrypted = decryptAesGcm(ciphertext);
      expect(decrypted).toBe(pan);
    });

    it('detects ciphertext tampering and fails authenticated decryption', () => {
      const pan = 'ABCDE1234F';
      const ciphertext = encryptAesGcm(pan);

      // Tamper with the ciphertext byte (past IV + tag: byte index 30)
      ciphertext[30] = (ciphertext[30] ?? 0) ^ 0xff;

      expect(() => decryptAesGcm(ciphertext)).toThrow(/Unsupported state or unable to authenticate data/);
    });

    it('detects authentication tag tampering and refuses decryption', () => {
      const pan = 'ABCDE1234F';
      const ciphertext = encryptAesGcm(pan);

      // Tamper with authentication tag (byte index 15)
      ciphertext[15] = (ciphertext[15] ?? 0) ^ 0xff;

      expect(() => decryptAesGcm(ciphertext)).toThrow(/Unsupported state or unable to authenticate data/);
    });

    it('produces deterministic tenant-scoped HMAC-SHA256 blind indexes', () => {
      const pan = 'ABCDE1234F';
      const hmacSecret = 'test_hmac_secret_key';

      const hashTenantA = crypto.createHmac('sha256', `${hmacSecret}:${tenantA}`).update(pan).digest('hex');

      const hashTenantB = crypto.createHmac('sha256', `${hmacSecret}:${tenantB}`).update(pan).digest('hex');

      // Matching within same tenant is deterministic
      const hashTenantA2 = crypto.createHmac('sha256', `${hmacSecret}:${tenantA}`).update(pan).digest('hex');

      expect(hashTenantA).toBe(hashTenantA2);
      // Blind index across different tenants must NOT match
      expect(hashTenantA).not.toBe(hashTenantB);
    });

    it('masks sensitive PAN display format safely', () => {
      function maskPan(pan: string): string {
        const clean = pan.trim().toUpperCase();
        if (clean.length !== 10) return clean;
        return `${clean.slice(0, 5)}****${clean.slice(9)}`;
      }

      expect(maskPan('ABCDE1234F')).toBe('ABCDE****F');
    });

    it('EnvelopeEncryptionService performs authenticated encryption and unwrapping with KmsPort', async () => {
      // Mock KMS key provider (TASK-421 mock test)
      const mockDek = crypto.randomBytes(32);
      const mockKms: KmsPort = {
        async generateDataKey(_tenantId: string) {
          return {
            plaintextKey: Buffer.from(mockDek),
            encryptedDataKey: Buffer.from('mock_encrypted_dek_blob'),
            keyVersion: 'v1',
          };
        },
        async decryptDataKey(_tenantId: string, _encryptedDataKey: Buffer, _keyVersion: string) {
          return Buffer.from(mockDek);
        },
      };

      const envelopeService = new EnvelopeEncryptionService(mockKms);
      const plaintext = 'SENSITIVE_CUSTOMER_PII_001';

      const envelope = await envelopeService.encrypt(tenantA, plaintext);
      expect(envelope.keyVersion).toBe('v1');
      expect(envelope.ciphertext).not.toBe(plaintext);

      const decrypted = await envelopeService.decrypt(tenantA, envelope);
      expect(decrypted).toBe(plaintext);

      // Tampering with ciphertext in envelope fails authentication
      const tamperedCipher = Buffer.from(envelope.ciphertext, 'base64');
      tamperedCipher[0] = (tamperedCipher[0] ?? 0) ^ 0xff;
      const tamperedEnvelope = { ...envelope, ciphertext: tamperedCipher.toString('base64') };

      await expect(envelopeService.decrypt(tenantA, tamperedEnvelope)).rejects.toThrow(
        /Unsupported state or unable to authenticate data/,
      );
    });

    it('DeferredKmsPort fails closed when Cloud KMS is unprovisioned (TASK-421)', async () => {
      const deferredKms = new DeferredKmsPort();
      await expect(deferredKms.generateDataKey(tenantA)).rejects.toThrow(/KMS_NOT_PROVISIONED \(TASK-421\)/);
    });
  });

  // ==========================================================================
  // SUB-SEC.01: SIEM Integration & Alerting (TASK-431)
  // ==========================================================================
  describe('SUB-SEC.01 — SIEM Forwarding & Critical Event Alerting (TASK-431)', () => {
    it('forwards security events to SIEM port without losing database durability', async () => {
      const forwarded: SiemEvent[] = [];
      const mockSiem: SiemPort = {
        async forwardEvent(event) {
          forwarded.push(event);
          return { success: true, messageId: 'siem-msg-123' };
        },
      };

      const alerted: string[] = [];
      const secService = new SecurityService(testDeps({ txRunner: store.txRunner }), {
        siemPort: mockSiem,
        onSecurityAlert: (e) => {
          alerted.push(e.id);
        },
      });

      const ctx = {
        principal: {
          id: 'usr_infosec_01',
          tenantId: tenantA,
          roles: ['ROLE-COMPLIANCE'],
          grants: [{ code: 'security.incident', scope: 'TENANT', branchIds: [] }],
        },
        requestId: 'req-siem-01',
      };

      const event = await secService.recordSecurityEvent(ctx as unknown as RequestContext, {
        type: 'SUSPICIOUS_ACCESS',
        principal: 'usr_target_01',
        ip: '198.51.100.42',
        severity: 'CRITICAL',
        details: { geoMismatch: true },
      });

      // Event is persisted in database
      expect(store.securityEvents.length).toBe(1);
      expect(store.securityEvents[0]?.type).toBe('SUSPICIOUS_ACCESS');

      // Forwarded to SIEM
      expect(forwarded.length).toBe(1);
      expect(forwarded[0]?.eventId).toBe(event.id);
      expect(forwarded[0]?.severity).toBe('CRITICAL');

      // Triggered critical alert
      expect(alerted).toContain(event.id);
    });

    it('BufferedSiemClient retries on transient transport failures', async () => {
      let attempts = 0;
      const client = new BufferedSiemClient({
        maxRetries: 3,
        transport: async () => {
          attempts++;
          if (attempts < 2) throw new Error('Network timeout');
          return { id: 'siem-ok-01' };
        },
      });

      const result = await client.forwardEvent({
        eventId: 'sec_test_01',
        tenantId: tenantA,
        type: 'DDOS_ATTEMPT',
        severity: 'HIGH',
        principal: 'anonymous',
        ip: '198.51.100.99',
        details: {},
        timestamp: new Date().toISOString(),
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('siem-ok-01');
      expect(attempts).toBe(2);
    });

    it('BufferedSiemClient returns unconfigured error when transport is unprovisioned (TASK-431)', async () => {
      const client = new BufferedSiemClient();
      const result = await client.forwardEvent({
        eventId: 'sec_test_02',
        tenantId: tenantA,
        type: 'AUTH_LOCKOUT',
        severity: 'MEDIUM',
        principal: 'usr_02',
        ip: '10.0.0.1',
        details: {},
        timestamp: new Date().toISOString(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/SIEM_NOT_CONFIGURED/);
    });
  });

  // ==========================================================================
  // Retention & CERT-In 180-Day Compliance (PHASE 6)
  // ==========================================================================
  describe('PHASE 6 — Retention & CERT-In Compliance', () => {
    it('enforces minimum 180-day retention floor and rejects early purge cutoffs', () => {
      const now = new Date('2026-10-15T00:00:00.000Z');

      // Cutoff only 90 days ago (violates 180-day rule)
      const recentCutoff = new Date('2026-07-17T00:00:00.000Z');
      const check = validateRetentionPurge(recentCutoff, now, RETENTION_RULES.CERT_IN_MINIMUM_DAYS);
      expect(check.allowed).toBe(false);
      expect(check.reason).toMatch(/violates mandatory CERT-In 180-day retention policy/);

      expect(() => assertRetentionCompliance(recentCutoff, now)).toThrow(/violates mandatory CERT-In/);
    });

    it('permits purge cutoffs that exceed the mandatory 180-day floor', () => {
      const now = new Date('2026-10-15T00:00:00.000Z');

      // Cutoff 200 days ago (exceeds 180-day requirement)
      const validCutoff = new Date('2026-03-01T00:00:00.000Z');
      const check = validateRetentionPurge(validCutoff, now, RETENTION_RULES.CERT_IN_MINIMUM_DAYS);
      expect(check.allowed).toBe(true);

      expect(() => assertRetentionCompliance(validCutoff, now)).not.toThrow();
    });
  });
});
