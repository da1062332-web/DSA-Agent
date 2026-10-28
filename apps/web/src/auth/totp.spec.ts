// TOTP checks in each kind of build (owner: Dev 1). A production build must never accept the fixed code, a stand-in factor or a
// stand-in enrolment, whatever the browser holds. Supabase is mocked: these tests say what the app does with its answers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabase, isBypassActive } from './supabase';
import { enrolmentErrorMessage, startTotpEnrolment, verifiedTotpFactors, verifyTotp } from './totp';

vi.mock('./supabase', () => ({
  getSupabase: vi.fn(),
  isBypassActive: vi.fn(() => false),
}));

const invalidJwt = { message: 'invalid JWT: signature is invalid', status: 401 };

function supabaseWith(auth: Record<string, unknown>) {
  vi.mocked(getSupabase).mockReturnValue({ auth } as unknown as ReturnType<typeof getSupabase>);
}

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(isBypassActive).mockReturnValue(false);
  vi.unstubAllEnvs();
});

describe('TOTP in a production build', () => {
  beforeEach(() => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_TEST_AUTH', 'true');
  });

  it('TEST-WEB-06 the fixed code is checked with Supabase like any other code', async () => {
    const challengeAndVerify = vi.fn().mockResolvedValue({ error: { message: 'Invalid TOTP code entered' } });
    supabaseWith({ mfa: { challengeAndVerify } });
    await expect(verifyTotp('factor-1', '000000')).rejects.toThrow(/did not match/);
    expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: 'factor-1', code: '000000' });
  });

  it('TEST-WEB-07 a leftover test sign-in in the browser is not honoured', async () => {
    vi.mocked(isBypassActive).mockReturnValue(true);
    const challengeAndVerify = vi.fn().mockResolvedValue({ error: { message: 'Invalid TOTP code entered' } });
    supabaseWith({ mfa: { challengeAndVerify } });
    await expect(verifyTotp('factor-1', '123456')).rejects.toThrow(/did not match/);
    expect(challengeAndVerify).toHaveBeenCalled();
  });

  it('TEST-WEB-08 a real authenticator code is verified with Supabase', async () => {
    const challengeAndVerify = vi.fn().mockResolvedValue({ error: null });
    supabaseWith({ mfa: { challengeAndVerify } });
    await expect(verifyTotp('factor-1', '123456')).resolves.toBeUndefined();
    expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: 'factor-1', code: '123456' });
  });

  it('TEST-WEB-09 an invalid session is an error, not a stand-in authenticator', async () => {
    supabaseWith({ mfa: { listFactors: vi.fn().mockResolvedValue({ data: null, error: invalidJwt }) } });
    await expect(verifiedTotpFactors()).rejects.toMatchObject({ message: expect.stringMatching(/invalid JWT/) });
  });

  it('TEST-WEB-10 enrolment with an invalid session fails rather than showing a stand-in secret', async () => {
    supabaseWith({
      mfa: {
        listFactors: vi.fn().mockResolvedValue({ data: { all: [] }, error: null }),
        enroll: vi.fn().mockResolvedValue({ data: null, error: invalidJwt }),
      },
    });
    await expect(startTotpEnrolment('Authenticator')).rejects.toMatchObject({
      message: expect.stringMatching(/invalid JWT/),
    });
  });
});

describe('TOTP in a test build', () => {
  beforeEach(() => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('VITE_TEST_AUTH', 'true');
  });

  it('TEST-WEB-11 the fixed code verifies without Supabase', async () => {
    const challengeAndVerify = vi.fn();
    supabaseWith({ mfa: { challengeAndVerify } });
    await expect(verifyTotp('factor-1', '000000')).resolves.toBeUndefined();
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });

  it('TEST-WEB-12 the stand-in factor is offered only while a test sign-in is active', async () => {
    supabaseWith({ mfa: { listFactors: vi.fn().mockResolvedValue({ data: { totp: [] }, error: null }) } });
    await expect(verifiedTotpFactors()).resolves.toEqual([]);

    vi.mocked(isBypassActive).mockReturnValue(true);
    await expect(verifiedTotpFactors()).resolves.toEqual([
      expect.objectContaining({ id: 'bypass-totp-factor', status: 'verified' }),
    ]);
  });
});

describe('set-up errors shown on the authenticator screen', () => {
  it('a session problem asks the person to sign in again, without showing token details', () => {
    const message = enrolmentErrorMessage(invalidJwt);
    expect(message).toMatch(/session has expired/);
    expect(message).not.toMatch(/JWT|signature/);
  });

  it('any other failure is shown as Supabase reports it', () => {
    expect(enrolmentErrorMessage({ message: 'MFA enrolment is not enabled for this project' })).toBe(
      'MFA enrolment is not enabled for this project',
    );
  });

  it('a failure with no message still tells the person what to do next', () => {
    expect(enrolmentErrorMessage(undefined)).toMatch(/Try again/);
    expect(enrolmentErrorMessage({})).toMatch(/Try again/);
  });
});
