// TOTP helpers over Supabase Auth MFA (owner: Dev 1, SUB-AUTH.02). Factors live in Supabase Auth only
// (Doc 10.1: no factor table in the application database).
import type { Factor } from '@supabase/supabase-js';
import { getSupabase } from './supabase';

export async function verifiedTotpFactors(): Promise<Factor[]> {
  const { data, error } = await getSupabase().auth.mfa.listFactors();
  if (error) throw error;
  return data.totp;
}

/** Starts enrolment. Leftover unverified factors (or existing factors when resetting) are removed first. */
export async function startTotpEnrolment(friendlyName: string, resetExisting = false) {
  const supabase = getSupabase();
  const { data: factors } = await supabase.auth.mfa.listFactors();
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
export async function verifyTotp(factorId: string, code: string): Promise<void> {
  const { error } = await getSupabase().auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw new Error('That code did not match. Check the time on your phone and try again.');
}

export const isTotpCode = (code: string) => /^\d{6}$/.test(code);
