// Free-text guard for S3 data (task P1-01). The same answer on the API and the web app.
import { describe, expect, it } from 'vitest';
import { containsDateOfBirth, freeTextNoS3 } from './s3-text';

describe('free-text S3 guard', () => {
  it('TEST-SECRETS-03 refuses a PAN in any letter case', () => {
    expect(freeTextNoS3('PAN ABCDE1234F')).toBe(true);
    expect(freeTextNoS3('abcde1234f')).toBe(true);
  });

  it('TEST-SECRETS-03 refuses an Aadhaar-shaped number with or without spaces', () => {
    expect(freeTextNoS3('1234 5678 9012')).toBe(true);
    expect(freeTextNoS3('123456789012')).toBe(true);
  });

  it('TEST-SECRETS-03 refuses a 9 to 18 digit account-like number', () => {
    expect(freeTextNoS3('account 123456789')).toBe(true);
  });

  it('TEST-SECRETS-03 refuses a date of birth written after its key, with = or : or a space and a date', () => {
    expect(freeTextNoS3('DOB: 01/01/1990')).toBe(true);
    expect(freeTextNoS3('dob=1990-01-01')).toBe(true);
    expect(freeTextNoS3('date of birth 1990-01-01')).toBe(true);
    expect(freeTextNoS3('dateOfBirth 01.01.90')).toBe(true);
    expect(containsDateOfBirth('date_of_birth: 01/01/1990')).toBe(true);
  });

  it('TEST-SECRETS-03 accepts a bare date and a dob key followed by ordinary words', () => {
    expect(freeTextNoS3('Callback on 01/01/2026 at 10am')).toBe(false);
    expect(freeTextNoS3('dob was checked on 01/01/1990')).toBe(false);
    expect(containsDateOfBirth('dob was checked')).toBe(false);
  });

  it('TEST-SECRETS-03 accepts ordinary notes', () => {
    expect(freeTextNoS3('Customer asked for a callback on Monday')).toBe(false);
    expect(freeTextNoS3('Pincode 411001, ticket 4521')).toBe(false);
  });
});
