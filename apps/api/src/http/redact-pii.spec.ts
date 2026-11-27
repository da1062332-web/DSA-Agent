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

// TEST-SECRETS-04 (checklist 4.3.3): each identity pattern in the shared redactor, in the shapes they arrive in (a CSV cell, punctuation
// around the number, a driver message). Ordinary 10-digit mobiles are not identity data for this layer and stay unchanged.
describe('TEST-SECRETS-04 each identity pattern is masked where it is written', () => {
  it('TEST-SECRETS-04 masks a PAN inside a CSV cell and next to punctuation', () => {
    expect(redactSecrets('ABCDE1234F,valid@example.com')).toBe('ABCDE****F,valid@example.com');
    expect(redactSecrets('(PAN:ABCDE1234F).')).toBe('(PAN:ABCDE****F).');
  });

  it('TEST-SECRETS-04 masks a lowercase PAN in a CSV cell', () => {
    expect(redactSecrets('abcde1234f')).toBe('abcde****f');
  });

  it('TEST-SECRETS-04 masks a spaced and a hyphenated Aadhaar number in a sentence', () => {
    expect(redactSecrets('Aadhaar 2345 6789 0123 was shared')).toBe('Aadhaar **** **** 0123 was shared');
    expect(redactSecrets('Aadhaar 2345-6789-0123 was shared')).toBe('Aadhaar **** **** 0123 was shared');
  });

  it('TEST-SECRETS-04 masks a date of birth written with an equals sign inside a message', () => {
    expect(redactSecrets('lookup failed for dob=01/01/1990 (retry)')).toBe('lookup failed for dob=[redacted] (retry)');
  });

  it('TEST-SECRETS-04 masks a date of birth after a dob-style key followed by a space and a date', () => {
    expect(redactSecrets('dob 01/01/1990')).toBe('dob [redacted]');
    expect(redactSecrets('date of birth 1990-01-01 on file')).toBe('date of birth [redacted] on file');
    expect(redactSecrets('dateOfBirth 01.01.90')).toBe('dateOfBirth [redacted]');
  });

  it('TEST-SECRETS-04 leaves a bare date, and a dob key followed by ordinary words, unchanged', () => {
    expect(redactSecrets('visit on 01/01/1990')).toBe('visit on 01/01/1990');
    expect(redactSecrets('dob was checked on 01/01/1990')).toBe('dob was checked on 01/01/1990');
  });

  it('TEST-SECRETS-04 leaves a 10-digit mobile unchanged', () => {
    expect(redactSecrets('mobile 9876543210')).toBe('mobile 9876543210');
  });
});
