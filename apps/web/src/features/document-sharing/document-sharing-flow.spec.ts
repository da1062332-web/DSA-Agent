// apps/web/src/features/document-sharing/document-sharing-flow.spec.ts
// Frontend integration & validation tests for Document Sharing (MOD-DSH).
import { describe, expect, it } from 'vitest';
import {
  CreateUploadLinkSchema,
  PublicUploadLinkStatusSchema,
  VerifyUploadOtpSchema,
  CreateShareSchema,
  UploadFileResponseSchema,
} from '@dsa/contracts';

describe('Frontend Document Sharing Flow Tests (MOD-DSH)', () => {
  it('FE-DSH-001: validates CreateUploadLink form values', () => {
    const valid = {
      applicationId: 'app_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      checklistItemIds: ['chk_bank_statement', 'chk_salary_slip'],
      expiresInHours: 48,
      maxUses: 5,
      otpRequired: true,
    };
    const parsed = CreateUploadLinkSchema.parse(valid);
    expect(parsed.applicationId).toBe('app_01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(parsed.checklistItemIds).toEqual(['chk_bank_statement', 'chk_salary_slip']);
    expect(parsed.expiresInHours).toBe(48);
  });

  it('FE-DSH-002: rejects invalid application id on link creation', () => {
    expect(() =>
      CreateUploadLinkSchema.parse({
        applicationId: 'invalid-id-format',
        checklistItemIds: ['chk_pan'],
      }),
    ).toThrow();
  });

  it('FE-DSH-003: validates PublicUploadLinkStatus schema', () => {
    const statusPayload = {
      status: 'PENDING_OTP',
      expiresAt: '2026-10-15T12:00:00.000Z',
      otpRequired: true,
      maskedContact: '+91 ******3456',
      requestedItems: [
        {
          checklistItemId: 'chk_bank_statement',
          documentTypeCode: 'BANK_STATEMENT',
          ordinal: 1,
          mandatory: true,
        },
      ],
    };

    const parsed = PublicUploadLinkStatusSchema.parse(statusPayload);
    expect(parsed.status).toBe('PENDING_OTP');
    expect(parsed.requestedItems[0]?.mandatory).toBe(true);
    expect(parsed.maskedContact).toBe('+91 ******3456');
  });

  it('FE-DSH-004: validates 6-digit OTP schema', () => {
    expect(() => VerifyUploadOtpSchema.parse({ otp: '12345' })).toThrow();
    expect(() => VerifyUploadOtpSchema.parse({ otp: '1234567' })).toThrow();
    expect(() => VerifyUploadOtpSchema.parse({ otp: 'abcdef' })).toThrow();
    expect(VerifyUploadOtpSchema.parse({ otp: '123456' })).toEqual({ otp: '123456' });
  });

  it('FE-DSH-005: validates CreateShare package form schema', () => {
    const shareForm = {
      applicationId: 'app_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      recipientType: 'LENDER',
      recipientId: 'len_hdfc_bank',
      recipientContact: {
        name: 'Pooja Sharma',
        email: 'pooja.sharma@hdfcbank.com',
      },
      purpose: 'LENDER_SUBMISSION',
      expiresInDays: 7,
      documentIds: ['doc_01ARZ3NDEKTSV4RRFFQ69G5FAV'],
      watermarkText: 'HDFC_SUBMISSION',
    };

    const parsed = CreateShareSchema.parse(shareForm);
    expect(parsed.recipientType).toBe('LENDER');
    expect(parsed.purpose).toBe('LENDER_SUBMISSION');
    expect(parsed.recipientContact.email).toBe('pooja.sharma@hdfcbank.com');
  });

  it('FE-DSH-006: parses UploadFileResponse correctly', () => {
    const responsePayload = {
      documentId: 'doc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      checklistItemId: 'chk_bank_statement',
      filename: 'salary_statement.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 245010,
      status: 'SUBMITTED',
      uploadedAt: '2026-10-13T10:00:00.000Z',
    };

    const parsed = UploadFileResponseSchema.parse(responsePayload);
    expect(parsed.status).toBe('SUBMITTED');
    expect(parsed.fileSizeBytes).toBe(245010);
  });
});
