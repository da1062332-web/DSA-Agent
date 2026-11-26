// Identity data in logs and error responses (task P1-01). PAN, Aadhaar and date of birth are masked; ordinary numbers are not.
import { describe, expect, it } from 'vitest';
import { redactSecrets } from './redact';

describe('identity data is masked in logs and error text', () => {
  it('TEST-SECRETS-02 masks a PAN, keeping its first five letters and last letter', () => {
    expect(redactSecrets('PAN ABCDE1234F on file')).toBe('PAN ABCDE****F on file');
  });

  it('TEST-SECRETS-02 masks a lowercase PAN the same way', () => {
    expect(redactSecrets('pan abcde1234f')).toBe('pan abcde****f');
  });

  it('TEST-SECRETS-02 masks an Aadhaar-shaped number, keeping only the last four digits', () => {
    expect(redactSecrets('aadhaar 1234 5678 9012')).toBe('aadhaar **** **** 9012');
    expect(redactSecrets('aadhaar 1234-5678-9012')).toBe('aadhaar **** **** 9012');
    expect(redactSecrets('aadhaar 123456789012')).toBe('aadhaar **** **** 9012');
  });

  it('TEST-SECRETS-02 hides a date of birth that follows a dob-style key', () => {
    expect(redactSecrets('dob=1990-01-01')).toBe('dob=[redacted]');
    expect(redactSecrets('dateOfBirth: 01/01/1990')).toBe('dateOfBirth: [redacted]');
    expect(redactSecrets('date_of_birth=1990-01-01')).toBe('date_of_birth=[redacted]');
  });

  it('TEST-SECRETS-02 leaves ordinary text and short numbers unchanged', () => {
    const text = 'pincode 411001, loan request 4521 for branch BR-07';
    expect(redactSecrets(text)).toBe(text);
  });
});
