// The test sign-in is compiled in only for a test build (owner: Dev 1). These tests set the build flags directly.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mfaSkipRequested, testAuthEnabled, testOtp } from './test-auth';

describe('test sign-in is available only in a test build', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('TEST-WEB-01 is off unless VITE_TEST_AUTH is exactly true', () => {
    vi.stubEnv('PROD', false);
    for (const value of ['', '1', 'TRUE', 'yes']) {
      vi.stubEnv('VITE_TEST_AUTH', value);
      expect(testAuthEnabled()).toBe(false);
    }
  });

  it('TEST-WEB-02 is on in a non-production build that sets VITE_TEST_AUTH=true', () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('VITE_TEST_AUTH', 'true');
    expect(testAuthEnabled()).toBe(true);
  });

  it('TEST-WEB-03 is off in a production build even when VITE_TEST_AUTH=true', () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_TEST_AUTH', 'true');
    expect(testAuthEnabled()).toBe(false);
  });

  it('TEST-WEB-04 the fixed code is 000000 unless a test build overrides it', () => {
    vi.stubEnv('VITE_TEST_BYPASS_OTP', '');
    expect(testOtp()).toBe('000000');
    vi.stubEnv('VITE_TEST_BYPASS_OTP', '135790');
    expect(testOtp()).toBe('135790');
  });

  it('TEST-WEB-05 the MFA step is skipped only in a test build that asks for it', () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('VITE_TEST_AUTH', '');
    vi.stubEnv('VITE_DISABLE_MFA', 'true');
    expect(mfaSkipRequested()).toBe(false);

    vi.stubEnv('VITE_TEST_AUTH', 'true');
    expect(mfaSkipRequested()).toBe(true);

    vi.stubEnv('PROD', true);
    expect(mfaSkipRequested()).toBe(false);
  });
});
