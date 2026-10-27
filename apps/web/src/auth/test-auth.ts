// Test sign-in (owner: Dev 1). A fixed one-time code signs a person in without a password or an authenticator app. It exists for
// automated tests and for local development against the local stack. It is compiled in only when VITE_TEST_AUTH=true, and never in a
// production build (PROD). Everything else signs in through Supabase Auth with the password and the authenticator app.
// The checks read import.meta.env when they run, so a production build folds them to false.

/** Written to sessionStorage and localStorage while a test sign-in is active. */
export const BYPASS_FLAG = 'dsa_bypass_active';
/** The refresh token of a test sign-in session. Supabase never issues it. */
export const BYPASS_REFRESH_TOKEN = 'bypass-refresh-token';
/** The stand-in authenticator factor a test sign-in shows. Supabase never issues it. */
export const BYPASS_FACTOR_ID = 'bypass-totp-factor';

// Each check below is a single expression on purpose. A production build folds the PROD test to a constant, and the bundler then drops
// the test branches behind it. A multi-statement function would keep them.
export function testAuthEnabled(): boolean {
  return !import.meta.env.PROD && import.meta.env.VITE_TEST_AUTH === 'true';
}

/** The fixed one-time code. 000000 unless VITE_TEST_BYPASS_OTP says otherwise. Used only in a test build. */
export function testOtp(): string {
  return import.meta.env.PROD ? '' : import.meta.env.VITE_TEST_BYPASS_OTP || '000000';
}

/** True only in a test build that asks to skip the authenticator step. */
export function mfaSkipRequested(): boolean {
  return testAuthEnabled() && import.meta.env.VITE_DISABLE_MFA === 'true';
}
