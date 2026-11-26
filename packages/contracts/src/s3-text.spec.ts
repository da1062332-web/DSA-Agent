// Free-text guard for S3 data (task P1-01). The same answer on the API and the web app.
import { describe, expect, it } from 'vitest';
import { freeTextNoS3 } from './s3-text';

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

  it('TEST-SECRETS-03 accepts ordinary notes', () => {
    expect(freeTextNoS3('Customer asked for a callback on Monday')).toBe(false);
    expect(freeTextNoS3('Pincode 411001, ticket 4521')).toBe(false);
  });
});
