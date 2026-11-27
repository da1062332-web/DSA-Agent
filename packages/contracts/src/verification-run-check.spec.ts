// P1-06: the request of POST /v1/verifications/checks (API-VER-003). The caller states who and what to check; never the result.
import { describe, expect, it } from 'vitest';
import {
  CreateVerificationSchema,
  KYC_RUNNABLE_CHECKS,
  RunVerificationCheckSchema,
  VERIFICATION_CHECK_TYPES,
} from './verification';

const CONSENT = 'cnst_01M4V6DFM0TFA9D04QJTW32ETD';
const base = {
  subjectType: 'CUSTOMER',
  subjectId: 'cus_01M4V6DFM0TFA9D04QJTW32ETD',
  consentRecordId: CONSENT,
};
const pan = { ...base, check: 'PAN', idNumber: 'ABCDE1234F' };
const gst = { ...base, check: 'GST', idNumber: '27ABCDE1234F1Z5' };
const bank = { ...base, check: 'BANK_ACCOUNT', accountNumber: '123456789012', ifsc: 'HDFC0001234' };

describe('P1-06 RunVerificationCheckSchema (API-VER-003)', () => {
  it('P1-06 runs the PAN, GST and bank-account checks, and nothing else yet', () => {
    expect([...KYC_RUNNABLE_CHECKS]).toEqual(['PAN', 'GST', 'BANK_ACCOUNT']);
    expect(RunVerificationCheckSchema.safeParse(pan).success).toBe(true);
    expect(RunVerificationCheckSchema.safeParse(gst).success).toBe(true);
    expect(RunVerificationCheckSchema.safeParse(bank).success).toBe(true);
    for (const check of ['BANK_STATEMENT', 'BUREAU', 'ITR', '']) {
      expect(RunVerificationCheckSchema.safeParse({ ...pan, check }).success, check).toBe(false);
    }
    expect(RunVerificationCheckSchema.safeParse({ ...pan, check: undefined }).success).toBe(false);
  });

  it('P1-06 BANK_ACCOUNT is a stored check type of its own, next to BANK_STATEMENT (the statement analysis, P4-15)', () => {
    expect(VERIFICATION_CHECK_TYPES).toContain('BANK_ACCOUNT');
    expect(VERIFICATION_CHECK_TYPES).toContain('BANK_STATEMENT');
    // Every check the server can run is also a type a verification record can hold.
    for (const check of KYC_RUNNABLE_CHECKS) expect(VERIFICATION_CHECK_TYPES).toContain(check);
    // The earlier nine are all still there, in their order.
    expect(VERIFICATION_CHECK_TYPES.slice(0, 9)).toEqual([
      'PAN',
      'GST',
      'CIN',
      'ITR',
      'BANK_STATEMENT',
      'BUREAU',
      'IDENTITY_DOCUMENT',
      'EMPLOYMENT',
      'ADDRESS',
    ]);
    const manual = {
      subjectType: 'CUSTOMER',
      subjectId: 'cus_01M4V6DFM0TFA9D04QJTW32ETD',
      checkType: 'BANK_ACCOUNT',
      method: 'MANUAL',
      purpose: 'KYC',
      consentRecordId: CONSENT,
      result: 'VERIFIED',
      minimalResult: { statusDescription: 'Checked by hand', maskedIdentifier: '********9012' },
      evidenceRef: 'manual:passbook-1',
    };
    expect(CreateVerificationSchema.safeParse(manual).success).toBe(true);
  });

  it('P1-06 a bank-account request takes the account number and the IFSC, trims and normalises them, and the purpose defaults to KYC', () => {
    const parsed = RunVerificationCheckSchema.parse({
      ...bank,
      accountNumber: ' 1234 5678-9012 ',
      ifsc: '  hdfc0001234 ',
      name: 'Ravi Kumar Sharma',
    });

    expect(parsed).toMatchObject({
      check: 'BANK_ACCOUNT',
      accountNumber: '123456789012',
      ifsc: 'HDFC0001234',
      name: 'Ravi Kumar Sharma',
      purpose: 'KYC',
    });
    // Nine and eighteen digits are the two ends of the allowed length.
    for (const accountNumber of ['123456789', '123456789012345678']) {
      expect(RunVerificationCheckSchema.safeParse({ ...bank, accountNumber }).success, accountNumber).toBe(
        true,
      );
    }
    expect(RunVerificationCheckSchema.safeParse({ ...bank, ifsc: 'SBIN0ABC123' }).success).toBe(true);
  });

  it('P1-06 refuses a bank account or IFSC of the wrong shape, and never echoes what was typed', () => {
    const bad: [string, Record<string, unknown>][] = [
      ['an account of 8 digits', { accountNumber: '12345678' }],
      ['an account of 19 digits', { accountNumber: '1234567890123456789' }],
      ['an account with letters', { accountNumber: '1234ABCD5678' }],
      ['an account of spaces only', { accountNumber: '         ' }],
      ['an account typed as a number', { accountNumber: 123456789012 }],
      ['no account', { accountNumber: undefined }],
      ['an absurdly long account', { accountNumber: '1'.repeat(500) }],
      ['an IFSC whose fifth character is not zero', { ifsc: 'HDFC1001234' }],
      ['an IFSC that is too short', { ifsc: 'HDFC000123' }],
      ['an IFSC that is too long', { ifsc: 'HDFC00012345' }],
      ['an IFSC with a symbol', { ifsc: 'HDFC000123-' }],
      ['no IFSC', { ifsc: undefined }],
      ['a PAN in place of an IFSC', { ifsc: 'ABCDE1234F' }],
    ];
    for (const [label, change] of bad) {
      const input = { ...bank, ...change };
      const result = RunVerificationCheckSchema.safeParse(input);
      expect(result.success, label).toBe(false);
      if (!result.success) {
        const message = JSON.stringify(result.error.issues);
        for (const typed of Object.values(change)) {
          if (typeof typed === 'string' && typed.trim() !== '') expect(message, label).not.toContain(typed);
        }
      }
    }
  });

  it('P1-06 each check takes only its own identifier: an account on a PAN check, or a PAN on a bank check, is refused', () => {
    expect(RunVerificationCheckSchema.safeParse({ ...pan, accountNumber: '123456789012' }).success).toBe(
      false,
    );
    expect(RunVerificationCheckSchema.safeParse({ ...pan, ifsc: 'HDFC0001234' }).success).toBe(false);
    expect(RunVerificationCheckSchema.safeParse({ ...bank, idNumber: 'ABCDE1234F' }).success).toBe(false);
    expect(RunVerificationCheckSchema.safeParse({ ...bank, aadhaar: '123456789012' }).success).toBe(false);
    expect(RunVerificationCheckSchema.safeParse({ ...bank, result: 'VERIFIED' }).success).toBe(false);
    expect(RunVerificationCheckSchema.safeParse({ ...bank, method: 'PROVIDER_AUTOMATED' }).success).toBe(
      false,
    );
    expect(RunVerificationCheckSchema.safeParse({ ...bank, ifscCode: 'HDFC0001234' }).success).toBe(false);
  });

  it('P1-06 the account holder name on a bank check is free text: a PAN, an Aadhaar or an account number in it is refused', () => {
    for (const name of ['Ravi ABCDE1234F', 'Ravi 123456789012', 'Ravi 1234 5678 9012', 'account 123456789']) {
      expect(RunVerificationCheckSchema.safeParse({ ...bank, name }).success, name).toBe(false);
    }
    expect(RunVerificationCheckSchema.safeParse({ ...bank, name: 'Sharma Traders (HUF)' }).success).toBe(
      true,
    );
    expect(RunVerificationCheckSchema.safeParse({ ...bank, name: '' }).success).toBe(false);
  });

  it('P1-06 trims and upper-cases the identifier, and the purpose defaults to KYC', () => {
    const parsed = RunVerificationCheckSchema.parse({ ...pan, idNumber: '  abcde1234f ' });

    expect(parsed).toMatchObject({ check: 'PAN', idNumber: 'ABCDE1234F', purpose: 'KYC' });
    expect(RunVerificationCheckSchema.parse({ ...gst, idNumber: '27abcde1234f1z5' })).toMatchObject({
      check: 'GST',
      idNumber: '27ABCDE1234F1Z5',
    });
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
