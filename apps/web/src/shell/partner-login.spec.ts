// Which logins the API refuses internal endpoints to (CONNECTOR_IDENTITY_NOT_ALLOWED), and so which the shell must not call them for.
import { describe, expect, it } from 'vitest';
import { isPartnerPortalLogin } from './partner-login';

describe('isPartnerPortalLogin', () => {
  it('is true for a partner portal login', () => {
    expect(isPartnerPortalLogin({ userType: 'CONNECTOR' })).toBe(true);
  });

  it('is false for internal staff', () => {
    expect(isPartnerPortalLogin({ userType: 'STAFF' })).toBe(false);
  });

  it('is false while the user is not loaded yet, so the shell waits for /v1/me instead of guessing', () => {
    expect(isPartnerPortalLogin(undefined)).toBe(false);
    expect(isPartnerPortalLogin(null)).toBe(false);
    expect(isPartnerPortalLogin({})).toBe(false);
  });
});
