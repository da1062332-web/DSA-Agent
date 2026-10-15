// packages/contracts/src/partner-api.spec.ts — owner: Akash (Module 37: API Development)
import { describe, expect, it } from 'vitest';
import {
  CreateApiKeySchema,
  PartnerApplicantSchema,
  PartnerCreateLeadSchema,
  PartnerListLeadsQuerySchema,
  CreateWebhookSubscriptionSchema,
  WebhookPayloadEnvelopeSchema,
  SandboxSimulateEventRequestSchema,
} from './partner-api';

describe('Module 37 — Partner API Contracts (Zod Schemas)', () => {
  describe('CreateApiKeySchema', () => {
    it('accepts valid API key input', () => {
      const input = {
        partnerId: 'partner_fintech_01',
        name: 'Fintech Prod Key',
        scopes: ['partner.lead_ingest', 'partner.application_read'],
        rateLimitRpm: 200,
      };
      const parsed = CreateApiKeySchema.parse(input);
      expect(parsed.partnerId).toBe('partner_fintech_01');
      expect(parsed.rateLimitRpm).toBe(200);
    });

    it('rejects empty partnerId or name', () => {
      expect(() =>
        CreateApiKeySchema.parse({
          partnerId: '',
          name: 'A',
        }),
      ).toThrow();
    });
  });

  describe('PartnerApplicantSchema', () => {
    it('validates a valid partner applicant', () => {
      const applicant = {
        firstName: 'Rahul',
        lastName: 'Sharma',
        mobile: '+919876543210',
        email: 'rahul.sharma@example.com',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        employmentType: 'SALARIED',
      };
      const parsed = PartnerApplicantSchema.parse(applicant);
      expect(parsed.firstName).toBe('Rahul');
      expect(parsed.pincode).toBe('400001');
    });
  });

  describe('PartnerCreateLeadSchema', () => {
    const validLead = {
      externalReferenceId: 'EXT-LEAD-991',
      loanProductCode: 'HL-PRIME-01',
      requestedAmount: { amount: '2500000.00', currency: 'INR' },
      applicant: {
        firstName: 'Rahul',
        lastName: 'Sharma',
        mobile: '+919876543210',
        email: 'rahul.sharma@example.com',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        employmentType: 'SALARIED',
      },
      consent: {
        consentArtifactRef: 'TNC-V2.1-DIGITAL',
        consentPurpose: 'LOAN_APPLICATION',
        optInTimestamp: '2026-10-14T10:00:00Z',
      },
    };

    it('validates a complete partner lead input', () => {
      const parsed = PartnerCreateLeadSchema.parse(validLead);
      expect(parsed.applicant.firstName).toBe('Rahul');
      expect(parsed.requestedAmount.amount).toBe('2500000.00');
    });

    it('rejects invalid mobile number', () => {
      const invalid = {
        ...validLead,
        applicant: {
          ...validLead.applicant,
          mobile: 'not-a-phone',
        },
      };
      expect(() => PartnerCreateLeadSchema.parse(invalid)).toThrow();
    });

    it('rejects invalid pincode', () => {
      const invalid = {
        ...validLead,
        applicant: {
          ...validLead.applicant,
          pincode: '4000', // too short
        },
      };
      expect(() => PartnerCreateLeadSchema.parse(invalid)).toThrow();
    });
  });

  describe('PartnerListLeadsQuerySchema', () => {
    it('parses and applies query defaults', () => {
      const query = PartnerListLeadsQuerySchema.parse({});
      expect(query.limit).toBe(20);
      expect(query.status).toBeUndefined();
    });

    it('accepts filter parameters', () => {
      const query = PartnerListLeadsQuerySchema.parse({
        status: 'QUALIFIED',
        limit: '50',
      });
      expect(query.status).toBe('QUALIFIED');
      expect(query.limit).toBe(50);
    });
  });

  describe('CreateWebhookSubscriptionSchema', () => {
    it('validates HTTPS target URL and subscribed events', () => {
      const sub = CreateWebhookSubscriptionSchema.parse({
        name: 'Partner Production Webhook',
        targetUrl: 'https://api.partner.com/webhooks/dsa',
        subscribedEvents: ['lead.created', 'sanction.approved'],
      });
      expect(sub.name).toBe('Partner Production Webhook');
      expect(sub.subscribedEvents).toContain('lead.created');
    });

    it('rejects insecure HTTP target URL in production', () => {
      expect(() =>
        CreateWebhookSubscriptionSchema.parse({
          name: 'Partner Insecure Webhook',
          targetUrl: 'http://api.partner.com/webhooks',
          subscribedEvents: ['lead.created'],
        }),
      ).toThrow();
    });
  });

  describe('WebhookPayloadEnvelopeSchema & Sandbox Simulation', () => {
    it('validates standard webhook payload envelope', () => {
      const envelope = WebhookPayloadEnvelopeSchema.parse({
        eventId: 'evt_01JTESTEVENT00000000000000',
        eventType: 'lead.created',
        occurredAt: '2026-10-14T10:00:00Z',
        tenantId: 'ten_01JTESTTENANT00000000000000',
        data: { leadId: 'lead_01JTESTLEAD00000000000000' },
      });
      expect(envelope.eventType).toBe('lead.created');
    });

    it('validates sandbox event simulation request', () => {
      const sim = SandboxSimulateEventRequestSchema.parse({
        subscriptionId: 'whs_01JTEST0000000000000000000',
        eventType: 'sanction.approved',
        customData: { testMode: true },
      });
      expect(sim.eventType).toBe('sanction.approved');
    });
  });
});
