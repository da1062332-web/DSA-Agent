// packages/contracts/src/activity.spec.ts
import { describe, expect, it } from 'vitest';
import {
  CreateActivitySchema,
  UpdateActivitySchema,
  containsS2SensitiveData,
} from './activity';

describe('activity contract unit tests', () => {
  it('TEST-ACT-001 validates allowed activity kinds and requires outcomeCode for CALL', () => {
    // Valid CALL with outcome
    const validCall = CreateActivitySchema.safeParse({
      kind: 'CALL',
      subjectType: 'LEAD',
      subjectId: 'lead_01JTEST00000000000000000001',
      outcomeCode: 'CONNECTED',
      occurredAt: '2026-10-12T10:00:00.000Z',
    });
    expect(validCall.success).toBe(true);

    // Invalid CALL without outcome
    const invalidCall = CreateActivitySchema.safeParse({
      kind: 'CALL',
      subjectType: 'LEAD',
      subjectId: 'lead_01JTEST00000000000000000001',
      occurredAt: '2026-10-12T10:00:00.000Z',
    });
    expect(invalidCall.success).toBe(false);

    // Valid NOTE without outcome
    const validNote = CreateActivitySchema.safeParse({
      kind: 'NOTE',
      subjectType: 'LEAD',
      subjectId: 'lead_01JTEST00000000000000000001',
      occurredAt: '2026-10-12T10:00:00.000Z',
      note: 'Initial follow-up discussion',
    });
    expect(validNote.success).toBe(true);

    // Invalid kind
    const invalidKind = CreateActivitySchema.safeParse({
      kind: 'INVALID_KIND',
      subjectType: 'LEAD',
      subjectId: 'lead_01JTEST00000000000000000001',
      occurredAt: '2026-10-12T10:00:00.000Z',
    });
    expect(invalidKind.success).toBe(false);
  });

  it('TEST-ACT-002 validates subject links format and requirements', () => {
    // Missing subject entirely
    const noSubject = CreateActivitySchema.safeParse({
      kind: 'NOTE',
      occurredAt: '2026-10-12T10:00:00.000Z',
    });
    expect(noSubject.success).toBe(false);

    // Valid via links array
    const validLinks = CreateActivitySchema.safeParse({
      kind: 'MEETING',
      links: [{ type: 'LOAN_APPLICATION', id: 'app_01JTEST00000000000000000001' }],
      occurredAt: '2026-10-12T10:00:00.000Z',
    });
    expect(validLinks.success).toBe(true);
  });

  it('TEST-ACT-003 S2 sensitive data detection rejects PAN, Aadhaar, and account patterns', () => {
    // Indian PAN rejection
    expect(containsS2SensitiveData('Borrower PAN is ABCDE1234F for reference')).toBe(true);
    expect(
      CreateActivitySchema.safeParse({
        kind: 'NOTE',
        subjectType: 'LEAD',
        subjectId: 'lead_01JTEST00000000000000000001',
        occurredAt: '2026-10-12T10:00:00.000Z',
        note: 'Customer provided PAN ABCDE1234F today',
      }).success,
    ).toBe(false);

    // Indian Aadhaar rejection (12 digits)
    expect(containsS2SensitiveData('Aadhaar number: 2345 6789 0123')).toBe(true);
    expect(
      CreateActivitySchema.safeParse({
        kind: 'NOTE',
        subjectType: 'LEAD',
        subjectId: 'lead_01JTEST00000000000000000001',
        occurredAt: '2026-10-12T10:00:00.000Z',
        note: 'Aadhaar 234567890123 verified',
      }).success,
    ).toBe(false);

    // 9-18 digit account number rejection
    expect(containsS2SensitiveData('Disbursed to account 123456789012')).toBe(true);
    expect(
      CreateActivitySchema.safeParse({
        kind: 'NOTE',
        subjectType: 'LEAD',
        subjectId: 'lead_01JTEST00000000000000000001',
        occurredAt: '2026-10-12T10:00:00.000Z',
        note: 'Bank account number is 9876543210',
      }).success,
    ).toBe(false);

    // Safe note allowed
    expect(containsS2SensitiveData('Followed up with borrower regarding doc checklist')).toBe(false);
    expect(
      CreateActivitySchema.safeParse({
        kind: 'NOTE',
        subjectType: 'LEAD',
        subjectId: 'lead_01JTEST00000000000000000001',
        occurredAt: '2026-10-12T10:00:00.000Z',
        note: 'Customer was polite and asked for call back tomorrow at 4 PM.',
      }).success,
    ).toBe(true);
  });

  it('TEST-ACT-004 validates update schema restrictions', () => {
    // Valid update
    const validUpdate = UpdateActivitySchema.safeParse({
      note: 'Updated notes after follow-up',
      durationSeconds: 120,
      outcomeCode: 'CONNECTED',
    });
    expect(validUpdate.success).toBe(true);

    // Strict schema rejects unpermitted fields like actorId or tenantId
    const illegalFields = UpdateActivitySchema.safeParse({
      actorId: 'usr_spoofed',
      note: 'Attempting to spoof actor',
    });
    expect(illegalFields.success).toBe(false);
  });
});
