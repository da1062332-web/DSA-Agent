// Whether the project's authenticator sign-in is off, as the auth service reports it. Pure functions, no network.
import { describe, expect, it } from 'vitest';
import { isMfaDisabledError, mfaProjectState } from './mfa-project';

describe('isMfaDisabledError', () => {
  it('TEST-MFAP-01 the auth service code for authenticator set-up or verification being off is recognised', () => {
    expect(isMfaDisabledError({ code: 'mfa_totp_enroll_not_enabled', message: 'x' })).toBe(true);
    expect(isMfaDisabledError({ code: 'mfa_totp_verify_not_enabled', message: 'x' })).toBe(true);
  });

  it('TEST-MFAP-02 other failures are not read as "off": a bad session, a network error, or another factor type', () => {
    expect(isMfaDisabledError({ code: 'session_not_found', message: 'invalid JWT' })).toBe(false);
    expect(isMfaDisabledError({ message: 'Failed to fetch' })).toBe(false);
    expect(isMfaDisabledError({ code: 'mfa_phone_enroll_not_enabled', message: 'phone' })).toBe(false);
    expect(isMfaDisabledError(undefined)).toBe(false);
  });

  it('TEST-MFAP-03 a response with only a message still counts when it says TOTP is not enabled', () => {
    expect(isMfaDisabledError({ message: 'TOTP enrollment is not enabled for this project' })).toBe(true);
  });

  it('TEST-MFAP-05 the "disabled" wording used for multi-factor sign-in is recognised too', () => {
    expect(isMfaDisabledError({ message: 'Multi-factor authentication is disabled for this project' })).toBe(true);
    expect(isMfaDisabledError({ message: 'Authenticator verification is disabled' })).toBe(true);
  });
});

describe('mfaProjectState', () => {
  it('TEST-MFAP-04 with no browser storage the state is unknown, so the app asks the auth service', () => {
    expect(mfaProjectState()).toBe('unknown');
  });
});
