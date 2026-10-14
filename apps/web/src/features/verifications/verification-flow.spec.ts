// apps/web/src/features/verifications/verification-flow.spec.ts
// Frontend integration & schema validation tests for Verification Workbench (MOD-VER).
import { describe, expect, it } from 'vitest';
import {
  CreateVerificationSchema,
  ListVerificationsQuerySchema,
  MinimalResultSchema,
  VerificationSchema,
} from '@dsa/contracts';

describe('Frontend Verification Flow Tests (MOD-VER)', () => {
  it('FE-VER-001: validates a valid manual PAN verification input', () => {
    const valid = {
      subjectType: 'LOAN_APPLICATION',
      subjectId: 'app_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      checkType: 'PAN',
      method: 'MANUAL',
      purpose: 'KYC',
      consentRecordId: 'cnst_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      result: 'VERIFIED',
      minimalResult: {
        statusDescription: 'PAN name matched borrower application record',
        maskedIdentifier: 'ABCDE****F',
        matchScore: 98,
        discrepancies: [],
      },
      evidenceRef: 'upl_pan_card_copy_01.pdf',
      validityExpiresAt: '2027-10-15T12:00:00.000Z',
      notes: 'Watermark verified and physical hologram inspected',
    };

    const parsed = CreateVerificationSchema.parse(valid);
    expect(parsed.subjectType).toBe('LOAN_APPLICATION');
    expect(parsed.checkType).toBe('PAN');
    expect(parsed.result).toBe('VERIFIED');
    expect(parsed.minimalResult.maskedIdentifier).toBe('ABCDE****F');
  });

  it('FE-VER-002: rejects invalid subject type or check type', () => {
    expect(() =>
      CreateVerificationSchema.parse({
        subjectType: 'INVALID_SUBJECT',
        subjectId: 'app_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        checkType: 'PAN',
        method: 'MANUAL',
        purpose: 'KYC',
        consentRecordId: 'cnst_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        result: 'VERIFIED',
        minimalResult: { statusDescription: 'Valid' },
        evidenceRef: 'doc_1.pdf',
      }),
    ).toThrow();
  });

  it('FE-VER-003: parses and validates MinimalResultSchema', () => {
    const result = {
      statusDescription: 'Bank statement 6-month turnover verified',
      matchScore: 95,
      maskedIdentifier: 'XXXXXXXX5678',
      discrepancies: ['Minor rounding variance in July'],
      providerReference: 'perfios_tx_12345',
      rawPayloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    };

    const parsed = MinimalResultSchema.parse(result);
    expect(parsed.matchScore).toBe(95);
    expect(parsed.rawPayloadHash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('FE-VER-004: validates ListVerificationsQuery with cursor and filters', () => {
    const query = {
      limit: '25',
      cursor: 'ver_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      checkType: 'BANK_STATEMENT',
      result: 'VERIFIED',
    };

    const parsed = ListVerificationsQuerySchema.parse(query);
    expect(parsed.limit).toBe(25);
    expect(parsed.cursor).toBe('ver_01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(parsed.checkType).toBe('BANK_STATEMENT');
  });

  it('FE-VER-005: parses complete ENT-064 verification record correctly', () => {
    const record = {
      id: 'ver_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      tenantId: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      subjectType: 'CUSTOMER',
      subjectId: 'cust_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      checkType: 'GST',
      method: 'PROVIDER_AUTOMATED',
      purpose: 'FINANCIAL_UNDERWRITING',
      consentRecordId: 'cnst_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      result: 'VERIFIED',
      minimalResult: {
        statusDescription: 'Active GSTIN registered to trading enterprise',
        maskedIdentifier: '27AAAAA0000A1Z5',
      },
      evidenceRef: 'gst_certificate.pdf',
      validityExpiresAt: null,
      performedBy: 'usr_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      performedAt: '2026-10-13T10:00:00.000Z',
      notes: null,
      lockVersion: 0,
      createdAt: '2026-10-13T10:00:00.000Z',
    };

    const parsed = VerificationSchema.parse(record);
    expect(parsed.id).toBe('ver_01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(parsed.method).toBe('PROVIDER_AUTOMATED');
    expect(parsed.lockVersion).toBe(0);
  });
});
