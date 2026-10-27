// The provisioning worker's output: the key is redacted from anything printed, and an outcome line carries ids and codes only.
import { describe, expect, it } from 'vitest';
import { describeOutcome, redact } from './provisioning-worker';

const KEY = 'service-role-key-that-must-never-leak-0123456789';

describe('provisioning worker output', () => {
  it('TEST-PWRK-01 the key is replaced wherever it appears in a line', () => {
    expect(redact(`fetch failed with apikey=${KEY} and ${KEY}`, [KEY])).toBe(
      'fetch failed with apikey=[redacted] and [redacted]',
    );
  });

  it('TEST-PWRK-02 an outcome line names the invitation, the tenant, the result and the code, nothing else', () => {
    expect(
      describeOutcome({
        invitationId: 'inv_1',
        tenantId: 'ten_1',
        result: 'FAILED',
        failure: 'EMAIL_NOT_AVAILABLE',
      }),
    ).toBe('FAILED invitation=inv_1 tenant=ten_1 failure=EMAIL_NOT_AVAILABLE');
    expect(
      describeOutcome({ invitationId: 'inv_2', tenantId: 'ten_1', result: 'SENT', authAccount: 'CREATED' }),
    ).toBe('SENT invitation=inv_2 tenant=ten_1 account=CREATED');
  });

  it('TEST-PWRK-03 a refused send shows Supabase’s status and code, so the cause is read from the log, not guessed', () => {
    expect(
      describeOutcome({
        invitationId: 'inv_3',
        tenantId: 'ten_1',
        result: 'RETRY',
        failure: 'DELIVERY_RETRY',
        provider: '429 over_email_send_rate_limit',
      }),
    ).toBe(
      'RETRY invitation=inv_3 tenant=ten_1 failure=DELIVERY_RETRY supabase=429:over_email_send_rate_limit',
    );
  });
});
