// Whether the Supabase project has authenticator (TOTP) sign-in turned on. The answer comes from the auth service when a sign-in asks
// for a second factor, not from a build flag, so a change in the dashboard applies at the next sign-in. The answer is kept for the
// browser tab so the app shell can read it without another call.
const KEY = 'dsa_mfa_project';

export type MfaProjectState = 'enabled' | 'disabled' | 'unknown';

export function mfaProjectState(): MfaProjectState {
  try {
    const value = sessionStorage.getItem(KEY);
    return value === 'enabled' || value === 'disabled' ? value : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function setMfaProjectState(state: 'enabled' | 'disabled'): void {
  try {
    sessionStorage.setItem(KEY, state);
  } catch {
    // storage unavailable (private mode or blocked); the answer is asked again at the next sign-in
  }
}

// The auth service's answer when authenticator sign-in is off for the project, on set-up or on verification. The error code is the
// reliable signal. The message check covers responses that carry no code.
export function isMfaDisabledError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (typeof e?.code === 'string' && /^mfa_totp_(enroll|verify)_not_enabled$/.test(e.code)) return true;
  const factor = 'totp|mfa|multi-factor|two-factor|authenticator';
  return typeof e?.message === 'string' && (new RegExp(`(${factor})[^.]*(not enabled|disabled)|(not enabled|disabled)[^.]*(${factor})`, 'i').test(e.message));
}
