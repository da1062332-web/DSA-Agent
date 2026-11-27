// P1-06: the request of POST /v1/verifications/checks (API-VER-003). The caller states who and what to check; never the result.
import { describe, expect, it } from 'vitest';
import { KYC_RUNNABLE_CHECKS, RunVerificationCheckSchema } from './verification';

const CONSENT = 'cnst_01M4V6DFM0TFA9D04QJTW32ETD';
const base = {
  subjectType: 'CUSTOMER',
  subjectId: 'cus_01M4V6DFM0TFA9D04QJTW32ETD',
  consentRecordId: CONSENT,
};
const pan = { ...base, check: 'PAN', idNumber: 'ABCDE1234F' };
const gst = { ...base, check: 'GST', idNumber: '27ABCDE1234F1Z5' };

describe('P1-06 RunVerificationCheckSchema (API-VER-003)', () => {
  it('P1-06 runs the PAN and GST checks, and nothing else yet', () => {
    expect([...KYC_RUNNABLE_CHECKS]).toEqual(['PAN', 'GST']);
    expect(RunVerificationCheckSchema.safeParse(pan).success).toBe(true);
    expect(RunVerificationCheckSchema.safeParse(gst).success).toBe(true);
    for (const check of ['BANK_ACCOUNT', 'BANK_STATEMENT', 'BUREAU', '']) {
      expect(RunVerificationCheckSchema.safeParse({ ...pan, check }).success, check).toBe(false);
    }
    expect(RunVerificationCheckSchema.safeParse({ ...pan, check: undefined }).success).toBe(false);
  });

  it('P1-06 trims and upper-cases the identifier, and the purpose defaults to KYC', () => {
    const parsed = RunVerificationCheckSchema.parse({ ...pan, idNumber: '  abcde1234f ' });

    expect(parsed.idNumber).toBe('ABCDE1234F');
    expect(parsed.purpose).toBe('KYC');
    expect(RunVerificationCheckSchema.parse({ ...gst, idNumber: '27abcde1234f1z5' }).idNumber).toBe(
      '27ABCDE1234F1Z5',
    );
    expect(RunVerificationCheckSchema.parse({ ...pan, purpose: 'FRAUD_PREVENTION' }).purpose).toBe(
      'FRAUD_PREVENTION',
    );
  });

  it('P1-06 refuses an identifier of the wrong shape for its check, and never echoes it', () => {
    const bad: [string, unknown][] = [
      ['PAN with the digits cut short', { ...pan, idNumber: 'ABCDE123F' }],
      ['PAN made of digits only', { ...pan, idNumber: '1234567890' }],
      ['a GSTIN given for a PAN check', { ...pan, idNumber: '27ABCDE1234F1Z5' }],
      ['a PAN given for a GST check', { ...gst, idNumber: 'ABCDE1234F' }],
      ['GSTIN without the Z', { ...gst, idNumber: '27ABCDE1234F1Y5' }],
      ['an identifier that is not text', { ...pan, idNumber: 1234567890 }],
      ['no identifier', { ...pan, idNumber: undefined }],
    ];
    for (const [label, input] of bad) {
      const result = RunVerificationCheckSchema.safeParse(input);
      expect(result.success, label).toBe(false);
      if (!result.success) {
        const message = JSON.stringify(result.error.issues);
        const typed = (input as { idNumber?: unknown }).idNumber;
        if (typeof typed === 'string') expect(message, label).not.toContain(typed);
      }
    }
  });

  it('P1-06 refuses a PAN, an Aadhaar or an account number typed into the free-text name', () => {
    for (const name of ['Ravi ABCDE1234F', 'Ravi 123456789012', 'Ravi 1234 5678 9012', 'account 123456789']) {
      expect(RunVerificationCheckSchema.safeParse({ ...pan, name }).success, name).toBe(false);
    }
    for (const name of ['Ravi Kumar Sharma', 'M/S Sharma & Sons', 'Rajesh K. Gupta (HUF)']) {
      expect(RunVerificationCheckSchema.safeParse({ ...pan, name }).success, name).toBe(true);
    }
  });

  it('P1-06 refuses an empty name, a name that is too long, and an unknown key such as an Aadhaar number', () => {
    expect(RunVerificationCheckSchema.safeParse({ ...pan, name: '' }).success).toBe(false);
    expect(RunVerificationCheckSchema.safeParse({ ...pan, name: '   ' }).success).toBe(false);
    expect(RunVerificationCheckSchema.safeParse({ ...pan, name: 'A'.repeat(121) }).success).toBe(false);
    expect(RunVerificationCheckSchema.safeParse({ ...pan, aadhaar: '123456789012' }).success).toBe(false);
    expect(RunVerificationCheckSchema.safeParse({ ...pan, dateOfBirth: '1990-01-01' }).success).toBe(false);
    expect(RunVerificationCheckSchema.safeParse({ ...pan, result: 'VERIFIED' }).success).toBe(false);
    expect(RunVerificationCheckSchema.safeParse({ ...pan, method: 'PROVIDER_AUTOMATED' }).success).toBe(
      false,
    );
  });

  it('P1-06 needs a consent record, a subject and a known subject type', () => {
    for (const key of ['consentRecordId', 'subjectId', 'subjectType'] as const) {
      expect(RunVerificationCheckSchema.safeParse({ ...pan, [key]: undefined }).success, key).toBe(false);
    }
    expect(RunVerificationCheckSchema.safeParse({ ...pan, consentRecordId: 'cons_123' }).success).toBe(false);
    expect(RunVerificationCheckSchema.safeParse({ ...pan, subjectType: 'PARTNER' }).success).toBe(false);
    expect(RunVerificationCheckSchema.safeParse({ ...pan, subjectType: 'LOAN_APPLICATION' }).success).toBe(
      true,
    );
    expect(RunVerificationCheckSchema.safeParse({ ...pan, subjectType: 'LEAD' }).success).toBe(true);
  });
});
