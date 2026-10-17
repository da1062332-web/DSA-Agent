// packages/contracts/src/verification.spec.ts — owner: Developer 2
import { describe, expect, it } from 'vitest';
import {
  CompleteVerificationRequestSchema,
  ChecklistAttestationRequestSchema,
  CreateVerificationRequestSchema,
  UpdateVerificationRequestSchema,
  VerificationListQuerySchema,
  VerificationResponseSchema,
} from './verification';

describe('Module 19 — Verification Contracts (Zod Schemas)', () => {
  it('validates a valid CreateVerificationRequest', () => {
    const input = {
      applicationId: 'app_01JTESTAPP0000000000000000',
      branchId: 'br_mumbai',
      verificationType: 'DOCUMENT_REVIEW',
      priority: 'HIGH',
      findingsSummary: 'Initial document check',
      checklistItmIds: ['chk_1', 'chk_2'],
    };
    const parsed = CreateVerificationRequestSchema.parse(input);
    expect(parsed.applicationId).toBe(input.applicationId);
    expect(parsed.priority).toBe('HIGH');
  });

  it('rejects CompleteVerificationRequest when status is REJECTED but no rejectionReason provided', () => {
    const input = {
      outcome: 'NEGATIVE',
      findingsSummary: 'Field verification failed due to missing applicant',
      markStatus: 'REJECTED',
    };
    expect(() => CompleteVerificationRequestSchema.parse(input)).toThrow(/Rejection reason is required/);
  });

  it('validates CompleteVerificationRequest with valid rejectionReason', () => {
    const input = {
      outcome: 'NEGATIVE',
      findingsSummary: 'Field investigation: residence premises locked/untraceable',
      markStatus: 'REJECTED',
      rejectionReason: 'ADDRESS_NOT_FOUND',
    };
    const parsed = CompleteVerificationRequestSchema.parse(input);
    expect(parsed.rejectionReason).toBe('ADDRESS_NOT_FOUND');
    expect(parsed.markStatus).toBe('REJECTED');
  });

  it('validates ChecklistAttestationRequest with valid review details', () => {
    const input = {
      checklistItemId: 'chk_pan_01',
      status: 'ACCEPTED',
      attestationNote: 'PAN card verified and clear match',
    };
    const parsed = ChecklistAttestationRequestSchema.parse(input);
    expect(parsed.status).toBe('ACCEPTED');
  });

  it('rejects ChecklistAttestationRequest with REJECTED status and missing rejectReason', () => {
    const input = {
      checklistItemId: 'chk_pan_01',
      status: 'REJECTED',
    };
    expect(() => ChecklistAttestationRequestSchema.parse(input)).toThrow(/Reject reason is required/);
  });

  it('parses VerificationResponseSchema with correct vrf_ ID prefix', () => {
    const res = {
      id: 'vrf_01JTESTVRF0000000000000000',
      tenantId: 'ten_01JTESTTENANT00000000000000',
      applicationId: 'app_01JTESTAPP0000000000000000',
      partyId: null,
      customerId: null,
      verificationType: 'RESIDENCE_FI',
      status: 'INITIATED',
      outcome: null,
      assignedToUserId: null,
      assignedToQueueId: null,
      branchId: 'br_mumbai',
      priority: 'MEDIUM',
      scheduledAt: null,
      completedAt: null,
      verifiedBy: null,
      findingsSummary: null,
      rejectionReason: null,
      checklistItmIds: [],
      lockVersion: 0,
      createdAt: '2026-10-13T10:00:00.000Z',
      createdBy: 'usr_staff_01',
      updatedAt: '2026-10-13T10:00:00.000Z',
      updatedBy: 'usr_staff_01',
    };
    const parsed = VerificationResponseSchema.parse(res);
    expect(parsed.id).toBe(res.id);
  });

  it('rejects VerificationResponseSchema with non-vrf_ ID prefix', () => {
    const res = {
      id: 'app_01JTESTAPP0000000000000000', // wrong prefix
      tenantId: 'ten_01JTESTTENANT00000000000000',
      applicationId: 'app_01JTESTAPP0000000000000000',
      verificationType: 'RESIDENCE_FI',
      status: 'INITIATED',
      branchId: 'br_mumbai',
      priority: 'MEDIUM',
      checklistItmIds: [],
      lockVersion: 0,
      createdAt: '2026-10-13T10:00:00.000Z',
      createdBy: 'usr_staff_01',
      updatedAt: '2026-10-13T10:00:00.000Z',
      updatedBy: 'usr_staff_01',
    };
    expect(() => VerificationResponseSchema.parse(res)).toThrow();
  });

  it('validates UpdateVerificationRequestSchema partial updates', () => {
    const input = {
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      findingsSummary: 'Field agent currently at applicant residence',
    };
    const parsed = UpdateVerificationRequestSchema.parse(input);
    expect(parsed.status).toBe('IN_PROGRESS');
    expect(parsed.priority).toBe('HIGH');
  });

  it('validates VerificationListQuerySchema pagination defaults and coercing', () => {
    const query = {
      limit: '25',
      status: 'INITIATED',
      priority: 'HIGH',
    };
    const parsed = VerificationListQuerySchema.parse(query);
    expect(parsed.limit).toBe(25);
    expect(parsed.status).toBe('INITIATED');
    expect(parsed.priority).toBe('HIGH');
  });
});
