// packages/contracts/src/security.spec.ts — Module 39 Contracts & Validation Unit Tests
import { describe, expect, it } from 'vitest';
import {
  CreateIncidentRequestSchema,
  CreateSecurityEventRequestSchema,
  IncidentRecordSchema,
  SecurityEventSchema,
  UpdateIncidentRequestSchema,
} from './security';

describe('Module 39: Security Contracts & Validation Schemas', () => {
  const validTenant = 'ten_01J00000000000000000000000';
  const validSecId = 'sec_01J00000000000000000000000';
  const validIncId = 'inc_01J00000000000000000000000';
  const validNow = '2026-10-15T09:00:00.000Z';

  describe('SecurityEventSchema (ENT-096)', () => {
    it('validates a correct security event', () => {
      const parsed = SecurityEventSchema.safeParse({
        id: validSecId,
        tenantId: validTenant,
        type: 'AUTH_FAILURE',
        principal: 'usr_bad_actor',
        ip: '192.168.1.100',
        severity: 'HIGH',
        details: { reason: 'Invalid password', attempt: 3 },
        createdAt: validNow,
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects invalid event type or severity', () => {
      const parsed = SecurityEventSchema.safeParse({
        id: validSecId,
        tenantId: validTenant,
        type: 'NON_EXISTENT_TYPE',
        principal: 'usr_actor',
        ip: '10.0.0.1',
        severity: 'SUPER_CRITICAL',
        details: {},
        createdAt: validNow,
      });
      expect(parsed.success).toBe(false);
    });

    it('validates CreateSecurityEventRequestSchema with default details', () => {
      const parsed = CreateSecurityEventRequestSchema.safeParse({
        type: 'PERMISSION_DENIED',
        principal: 'usr_unauth',
        ip: '10.0.0.1',
        severity: 'MEDIUM',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.details).toEqual({});
      }
    });
  });

  describe('IncidentRecordSchema (ENT-102)', () => {
    it('validates a complete incident record with notification evidence', () => {
      const parsed = IncidentRecordSchema.safeParse({
        id: validIncId,
        tenantId: validTenant,
        type: 'DATA_BREACH',
        severity: 'CRITICAL',
        detectedAt: validNow,
        personalDataInvolved: true,
        affectedTenants: [validTenant],
        notifications: {
          authority: {
            notified: true,
            notifiedAt: validNow,
            evidenceRef: 'CERT-IN-REF-12345',
            recipient: 'cert-in@cert-in.org.in',
          },
          tenant: {
            notified: true,
            notifiedAt: validNow,
            evidenceRef: 'TENANT-NOTICE-01',
          },
          individual: {
            notified: false,
            notifiedAt: null,
          },
        },
        status: 'INVESTIGATING',
        postMortemRef: 'https://docs.internal/incidents/inc-01-postmortem',
        lockVersion: 1,
        createdAt: validNow,
        createdBy: 'usr_infosec_lead',
        updatedAt: validNow,
        updatedBy: 'usr_infosec_lead',
      });
      expect(parsed.success).toBe(true);
    });

    it('validates CreateIncidentRequestSchema with defaults', () => {
      const parsed = CreateIncidentRequestSchema.safeParse({
        type: 'UNAUTHORIZED_ACCESS',
        severity: 'HIGH',
        detectedAt: validNow,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.status).toBe('OPEN');
        expect(parsed.data.personalDataInvolved).toBe(false);
        expect(parsed.data.affectedTenants).toEqual([]);
        expect(parsed.data.notifications).toEqual({});
      }
    });

    it('validates UpdateIncidentRequestSchema requires at least one field', () => {
      const emptyParsed = UpdateIncidentRequestSchema.safeParse({});
      expect(emptyParsed.success).toBe(false);

      const validUpdate = UpdateIncidentRequestSchema.safeParse({
        status: 'CONTAINED',
        notifications: {
          authority: {
            notified: true,
            notifiedAt: validNow,
            evidenceRef: 'REF-001',
          },
        },
      });
      expect(validUpdate.success).toBe(true);
    });
  });
});
