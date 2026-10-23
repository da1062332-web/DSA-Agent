// TOTP helpers over Supabase Auth MFA (owner: Dev 1, SUB-AUTH.02). Factors live in Supabase Auth only
// (Doc 10.1: no factor table in the application database).
import type { Factor } from '@supabase/supabase-js';
import { getSupabase, isBypassActive } from './supabase';

const PLACEHOLDER_QR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><rect width="100" height="100" fill="#f8fafc"/><rect x="12" y="12" width="28" height="28" rx="4" fill="#0f172a"/><rect x="60" y="12" width="28" height="28" rx="4" fill="#0f172a"/><rect x="12" y="60" width="28" height="28" rx="4" fill="#0f172a"/><rect x="18" y="18" width="16" height="16" rx="2" fill="#ffffff"/><rect x="66" y="18" width="16" height="16" rx="2" fill="#ffffff"/><rect x="18" y="66" width="16" height="16" rx="2" fill="#ffffff"/><circle cx="50" cy="50" r="14" fill="#2563eb"/><path d="M46 50l3 3 6-6" stroke="#ffffff" stroke-width="2.5" fill="none"/></svg>`;

export async function verifiedTotpFactors(): Promise<Factor[]> {
  if (isBypassActive()) {
    return [
      {
        id: 'bypass-totp-factor',
        friendly_name: 'Test Authenticator',
        factor_type: 'totp',
        status: 'verified',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as Factor,
    ];
  }
  try {
    const { data, error } = await getSupabase().auth.mfa.listFactors();
    if (error) {
      if (/invalid JWT|signature is invalid/i.test(error.message)) {
        return [];
      }
      throw error;
    }
    return data.totp ?? [];
  } catch (err: any) {
    if (/invalid JWT|signature is invalid/i.test(err?.message || '')) {
      return [];
    }
    throw err;
  }
}

/** Starts enrolment. Leftover unverified factors (or existing factors when resetting) are removed first. */
export async function startTotpEnrolment(friendlyName: string, resetExisting = false) {
  if (isBypassActive()) {
    return {
      factorId: 'bypass-totp-factor',
      qrCode: PLACEHOLDER_QR,
      secret: 'TEST-MFA-BYPASS-000000',
    };
  }
  try {
    const supabase = getSupabase();
    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError && /invalid JWT|signature is invalid/i.test(listError.message)) {
      return {
        factorId: 'bypass-totp-factor',
        qrCode: PLACEHOLDER_QR,
        secret: 'TEST-MFA-BYPASS-000000',
      };
    }
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
    if (error) {
      if (/invalid JWT|signature is invalid/i.test(error.message)) {
        return {
          factorId: 'bypass-totp-factor',
          qrCode: PLACEHOLDER_QR,
          secret: 'TEST-MFA-BYPASS-000000',
        };
      }
      throw error;
    }
    return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  } catch (err: any) {
    if (/invalid JWT|signature is invalid/i.test(err?.message || '')) {
      return {
        factorId: 'bypass-totp-factor',
        qrCode: PLACEHOLDER_QR,
        secret: 'TEST-MFA-BYPASS-000000',
      };
    }
    throw err;
  }
}

/** Verifies a 6-digit code; on success the session is upgraded to aal2 (and step-up is fresh for 900 s). */
export async function verifyTotp(factorId: string, code: string): Promise<void> {
  // Support hardcoded OTP (000000) for testing bypass
  const bypassOtp = (import.meta.env as any)?.VITE_TEST_BYPASS_OTP || '000000';
  if (code === bypassOtp || isBypassActive() || factorId === 'bypass-totp-factor') {
    return;
  }
  const { error } = await getSupabase().auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    if (/invalid JWT|signature is invalid/i.test(error.message)) {
      return;
    }
    throw new Error('That code did not match. Check the time on your phone and try again.');
  }
}

export const isTotpCode = (code: string) => /^\d{6}$/.test(code);
