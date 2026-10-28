// TOTP helpers over Supabase Auth MFA (owner: Dev 1, SUB-AUTH.02). Factors live in Supabase Auth only
// (Doc 10.1: no factor table in the application database). A test sign-in stands in for the authenticator app only in a test build.
import type { Factor } from '@supabase/supabase-js';
import { getSupabase, isBypassActive } from './supabase';
import { BYPASS_FACTOR_ID, testAuthEnabled, testOtp } from './test-auth';

const PLACEHOLDER_QR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><rect width="100" height="100" fill="#f8fafc"/><rect x="12" y="12" width="28" height="28" rx="4" fill="#0f172a"/><rect x="60" y="12" width="28" height="28" rx="4" fill="#0f172a"/><rect x="12" y="60" width="28" height="28" rx="4" fill="#0f172a"/><rect x="18" y="18" width="16" height="16" rx="2" fill="#ffffff"/><rect x="66" y="18" width="16" height="16" rx="2" fill="#ffffff"/><rect x="18" y="66" width="16" height="16" rx="2" fill="#ffffff"/><circle cx="50" cy="50" r="14" fill="#2563eb"/><path d="M46 50l3 3 6-6" stroke="#ffffff" stroke-width="2.5" fill="none"/></svg>`;

export async function verifiedTotpFactors(): Promise<Factor[]> {
  if (isBypassActive()) {
    return [
      {
        id: BYPASS_FACTOR_ID,
        friendly_name: 'Test Authenticator',
        factor_type: 'totp',
        status: 'verified',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as Factor,
    ];
  }
  // A failed lookup is an error, not "no authenticator": reporting no factor would send the person to enrol again.
  const { data, error } = await getSupabase().auth.mfa.listFactors();
  if (error) throw error;
  return data.totp ?? [];
}

/** Starts enrolment. Leftover unverified factors (or existing factors when resetting) are removed first. */
export async function startTotpEnrolment(friendlyName: string, resetExisting = false) {
  if (isBypassActive()) {
    return {
      factorId: BYPASS_FACTOR_ID,
      qrCode: PLACEHOLDER_QR,
      secret: 'TEST-MFA-BYPASS-000000',
    };
  }
  const supabase = getSupabase();
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) throw listError;
  for (const f of factors?.all ?? []) {
    if (f.factor_type === 'totp' && (resetExisting || f.status === 'unverified')) {
      try {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      } catch {
        // ignore if unenroll fails or already removed
      }
    }
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName });
  if (error) throw error;
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/** Verifies a 6-digit code; on success the session is upgraded to aal2 (and step-up is fresh for 900 s). */
/** What the set-up screen says when enrolment fails. A session problem asks for a new sign-in; anything else is shown as Supabase reports it. */
export function enrolmentErrorMessage(err: unknown): string {
  const raw = (err as { message?: unknown })?.message;
  const text = typeof raw === 'string' ? raw : '';
  if (/invalid JWT|signature is invalid|jwt expired/i.test(text)) {
    return 'Your sign-in session has expired. Sign in again to set up your authenticator app.';
  }
  return text || 'Could not start two-step verification set-up. Try again.';
}

export async function verifyTotp(factorId: string, code: string): Promise<void> {
  // Only a test build accepts the fixed code or a test sign-in without Supabase. Every other build verifies with Supabase.
  if (testAuthEnabled() && (code === testOtp() || isBypassActive() || factorId === BYPASS_FACTOR_ID)) {
    return;
  }
  const { error } = await getSupabase().auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    if (/invalid JWT|signature is invalid/i.test(error.message)) {
      throw new Error('Your session could not be verified. Sign in again to continue.');
    }
    throw new Error('That code did not match. Check the time on your phone and try again.');
  }
}

export const isTotpCode = (code: string) => /^\d{6}$/.test(code);
