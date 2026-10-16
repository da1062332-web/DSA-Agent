// apps/api/test/security-compliance-kms.spec.ts — Tests for TASK-421, TASK-431, and Regulatory Compliance Rules
import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { IncidentRecord } from '@dsa/contracts';
import {
  DeferredKmsPort,
  EnvelopeEncryptionService,
  MasterKeyKmsPort,
  createKmsPortFromEnv,
} from '../src/modules/security/kms';
import {
  BufferedSiemClient,
  createDatadogLogsTransport,
  createSiemPortFromEnv,
  createSplunkHecTransport,
  createWebhookSiemTransport,
} from '../src/modules/security/siem';
import {
  evaluateCertInSla,
  generateCertInReport,
  generateDpbiBreachNotice,
  generateIndividualBreachNotice,
} from '../src/modules/security/compliance';

describe('Module 39 — Security Enhancements (TASK-421, TASK-431 & Regulatory Compliance)', () => {
  const tenantA = 'ten_01J00000000000000000000000';
  const tenantB = 'ten_01J99999999999999999999999';

  // ==========================================================================
  // TASK-421: KMS & Master Key Envelope Encryption
  // ==========================================================================
  describe('TASK-421: Master Key KEK & Envelope Encryption', () => {
    const rawMasterKey = crypto.randomBytes(32).toString('hex');

    it('MasterKeyKmsPort generates valid 256-bit DEK and unwrap matches', async () => {
      const kms = new MasterKeyKmsPort({ masterKey: rawMasterKey });
      const { plaintextKey, encryptedDataKey, keyVersion } = await kms.generateDataKey(tenantA);

      expect(plaintextKey.length).toBe(32);
      expect(encryptedDataKey.length).toBeGreaterThanOrEqual(60);
      expect(keyVersion).toBe('kek-v1');

      const unwrappedKey = await kms.decryptDataKey(tenantA, encryptedDataKey, keyVersion);
      expect(unwrappedKey).toEqual(plaintextKey);
    });

    it('MasterKeyKmsPort enforces tenant isolation in key unwrapping', async () => {
      const kms = new MasterKeyKmsPort({ masterKey: rawMasterKey });
      const { encryptedDataKey, keyVersion } = await kms.generateDataKey(tenantA);

      // Attempting to unwrap tenantA's key in tenantB context must fail
      await expect(kms.decryptDataKey(tenantB, encryptedDataKey, keyVersion)).rejects.toThrow(
        /Unsupported state or unable to authenticate data/,
      );
    });

    it('EnvelopeEncryptionService completes end-to-end encrypt/decrypt with MasterKeyKmsPort', async () => {
      const kms = new MasterKeyKmsPort({ masterKey: rawMasterKey });
      const envelopeService = new EnvelopeEncryptionService(kms);
      const secretPii = 'CUSTOMER_PAN:ABCDE1234F_AADHAAR:123456789012';

      const envelope = await envelopeService.encrypt(tenantA, secretPii);
      expect(envelope.ciphertext).not.toBe(secretPii);

      const decrypted = await envelopeService.decrypt(tenantA, envelope);
      expect(decrypted).toBe(secretPii);
    });

    it('createKmsPortFromEnv selects MasterKeyKmsPort when env var is present and DeferredKmsPort when absent', async () => {
      const activeKms = createKmsPortFromEnv({ KMS_MASTER_KEY: rawMasterKey });
      expect(activeKms).toBeInstanceOf(MasterKeyKmsPort);

      const deferredKms = createKmsPortFromEnv({});
      expect(deferredKms).toBeInstanceOf(DeferredKmsPort);
      await expect(deferredKms.generateDataKey(tenantA)).rejects.toThrow(/KMS_NOT_PROVISIONED/);
    });
  });

  // ==========================================================================
  // TASK-431: Enterprise SIEM Transports (Splunk, Datadog, Webhook)
  // ==========================================================================
  describe('TASK-431: Enterprise SIEM Transports', () => {
    const mockEvent = {
      eventId: 'sec_01TEST00000000000000000001',
      tenantId: tenantA,
      type: 'SUSPICIOUS_ACCESS',
      severity: 'CRITICAL' as const,
      principal: 'usr_malicious',
      ip: '10.0.0.1',
      details: { geoMismatch: true },
      timestamp: '2026-10-16T12:00:00.000Z',
    };

    it('createSplunkHecTransport sends formatted JSON payload with Splunk token', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ text: 'Success', code: 0 }),
      });
      globalThis.fetch = fetchMock;

      const transport = createSplunkHecTransport({
        endpoint: 'https://splunk.internal:8088',
        token: 'splunk-mock-token-xyz',
        index: 'dsa_security_events',
      });

      const res = await transport(mockEvent);
      expect(res.id).toBe(`splunk-${mockEvent.eventId}`);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://splunk.internal:8088/services/collector/event',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Splunk splunk-mock-token-xyz',
          }),
        }),
      );
    });

    it('createDatadogLogsTransport formats logs with tags and API key', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
      globalThis.fetch = fetchMock;

      const transport = createDatadogLogsTransport({
        apiKey: 'dd-api-key-test',
        site: 'datadoghq.eu',
        service: 'dsa-auth',
      });

      const res = await transport(mockEvent);
      expect(res.id).toBe(`datadog-${mockEvent.eventId}`);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://http-intake.logs.datadoghq.eu/api/v2/logs',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'DD-API-KEY': 'dd-api-key-test',
          }),
        }),
      );
    });

    it('createWebhookSiemTransport sends custom POST with bearer token', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => 'OK',
      });
      globalThis.fetch = fetchMock;

      const transport = createWebhookSiemTransport({
        url: 'https://siem-collector.internal/ingest',
        authToken: 'secret-bearer-123',
      });

      const res = await transport(mockEvent);
      expect(res.id).toBe(`webhook-${mockEvent.eventId}`);
    });

    it('createSiemPortFromEnv auto-wires configured client based on provider', () => {
      const clientSplunk = createSiemPortFromEnv({
        SIEM_PROVIDER: 'splunk',
        SIEM_ENDPOINT: 'https://splunk.corp:8088',
        SIEM_AUTH_TOKEN: 'splunk-123',
      });
      expect(clientSplunk).toBeInstanceOf(BufferedSiemClient);

      const clientEmpty = createSiemPortFromEnv({});
      expect(clientEmpty).toBeInstanceOf(BufferedSiemClient);
    });
  });

  // ==========================================================================
  // Regulatory Compliance: CERT-In 6-Hour Matrix & DPDP Act 2023 Templates
  // ==========================================================================
  describe('Regulatory Compliance: CERT-In Matrix & DPDP Act 2023', () => {
    const criticalIncident: IncidentRecord = {
      id: 'inc_01CRITICAL000000000000001' as any,
      tenantId: tenantA as any,
      type: 'DATA_BREACH',
      severity: 'CRITICAL',
      detectedAt: '2026-10-16T06:00:00.000Z',
      personalDataInvolved: true,
      affectedTenants: [tenantA, tenantB],
      notifications: {},
      status: 'INVESTIGATING',
      postMortemRef: null,
      lockVersion: 0,
      createdAt: '2026-10-16T06:01:00.000Z',
      createdBy: 'usr_sec_analyst',
      updatedAt: '2026-10-16T06:01:00.000Z',
      updatedBy: 'usr_sec_analyst',
    };

    it('evaluateCertInSla sets 6-hour statutory deadline from detection timestamp', () => {
      const nowDuringWindow = new Date('2026-10-16T09:00:00.000Z'); // 3 hours in
      const sla = evaluateCertInSla(criticalIncident, nowDuringWindow);

      expect(sla.isCritical).toBe(true);
      expect(sla.mandatoryReportingRequired).toBe(true);
      expect(sla.category.code).toBe('CAT-11');
      expect(sla.certInDeadline).toBe('2026-10-16T12:00:00.000Z'); // 06:00 + 6h
      expect(sla.isReported).toBe(false);
      expect(sla.isOverdue).toBe(false);
      expect(sla.minutesRemaining).toBe(180); // 3 hours remaining
    });

    it('evaluateCertInSla detects overdue critical incident when deadline has passed', () => {
      const nowPastWindow = new Date('2026-10-16T13:00:00.000Z'); // 7 hours in
      const sla = evaluateCertInSla(criticalIncident, nowPastWindow);

      expect(sla.isOverdue).toBe(true);
      expect(sla.minutesRemaining).toBe(0);
    });

    it('generateCertInReport creates complete statutory Annexure-1 reporting payload', () => {
      const report = generateCertInReport(criticalIncident, {
        organizationName: 'Alpha FinTech NBFC',
        contactPerson: 'Aditi Sharma (CISO)',
        contactEmail: 'ciso@alphafintech.in',
      });

      expect(report.certInReportingForm).toBe('ANNEXURE-1_INCIDENT_REPORT');
      expect(report.reportingCategory).toContain('CAT-11');
      expect(report.officialSubmissionEndpoint).toBe('incident@cert-in.org.in');
      expect(report.incidentDetails).toHaveProperty('personalDataCompromised', true);
    });

    it('generateDpbiBreachNotice creates Section 8(6) statutory notice for Data Protection Board', () => {
      const dpbiNotice = generateDpbiBreachNotice(criticalIncident, {
        estimatedAffectedPrincipals: 4500,
        compromisedDataCategories: ['Borrower PAN', 'Aadhaar Reference Token', 'Mobile Number'],
      });

      expect(dpbiNotice.statutoryNotice).toBe('DPDP_ACT_2023_SECTION_8_6_DPBI_NOTICE');
      expect(dpbiNotice.regulatoryAuthority).toBe('Data Protection Board of India (DPBI)');
      expect(dpbiNotice.breachAssessment).toHaveProperty('estimatedDataPrincipalsAffected', 4500);
      expect(Array.isArray(dpbiNotice.remedialMeasuresAdopted)).toBe(true);
    });

    it('generateIndividualBreachNotice generates customer-facing notice with grievance redressal', () => {
      const notice = generateIndividualBreachNotice(criticalIncident, {
        borrowerName: 'Rajesh Kumar',
        grievanceEmail: 'grievance@alphafintech.in',
        helplinePhone: '1800-111-2222',
      });

      expect(notice.subject).toContain('[Important Security Notice]');
      expect(notice.plainText).toContain('Rajesh Kumar');
      expect(notice.plainText).toContain('Section 8(6) of the Digital Personal Data Protection Act, 2023');
      expect(notice.plainText).toContain('1800-111-2222');
      expect(notice.bodyHtml).toContain('<h2 style="color: #c62828; margin-top: 0;">Notice of Data Security Incident</h2>');
    });
  });
});
