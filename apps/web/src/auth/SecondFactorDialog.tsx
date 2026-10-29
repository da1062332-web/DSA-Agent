// The one second-factor screen, shown on the sign-in page. It sets up an authenticator (QR code and secret key) when the account has none,
// and asks for a code when it has one. The fixed test code and the test sign-in exist only in test builds.
import { Alert, Box, Button, CircularProgress, Dialog, DialogContent, Stack, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { readConfig } from '../config';
import { isMfaDisabledError, setMfaProjectState } from './mfa-project';
import { qrImageSource } from './qr-image';
import { getSupabase, saveBypassSession } from './supabase';
import { testAuthEnabled, testOtp } from './test-auth';
import { setAuthToken } from './token';
import { isTotpCode, verifyTotp } from './totp';
import { resolveSafeRedirect } from './redirect';

// The set-up is started by the sign-in page, which learns from the auth service whether the project takes authenticator sign-in.
export interface Enrolment {
  factorId: string;
  qrCode: string;
  secret: string;
}

export type SecondFactorState =
  | { mode: 'enrol'; resetExisting: boolean; enrolment: Enrolment }
  | { mode: 'challenge'; factorId: string }
  | { mode: 'test' };

interface Props {
  /** Null when the dialog is closed. */
  state: SecondFactorState | null;
  email: string;
  from: string;
  onVerified: () => Promise<void>;
  onCancel: () => void;
}

const INVALID_SESSION = /invalid JWT|signature is invalid/i;

export function SecondFactorDialog({ state, email, from, onVerified, onCancel }: Props) {
  const mode = state?.mode;
  const enrolment = state?.mode === 'enrol' ? state.enrolment : null;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isTotpCode(code)) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Test builds only: the fixed code, and any code on the test-only path, go to the test sign-in.
      if (testAuthEnabled() && (mode === 'test' || code === testOtp())) {
        await signInWithTestCode(email, code, from);
        return;
      }
      if (state?.mode === 'enrol') {
        await verifyTotp(state.enrolment.factorId, code);
        if (state.resetExisting) await retireOtherFactors(state.enrolment.factorId);
        await onVerified();
        return;
      }
      if (state?.mode === 'challenge') {
        await verifyTotp(state.factorId, code);
        await onVerified();
        return;
      }
      throw new Error(
        mode === 'enrol'
          ? 'The barcode is not ready yet. Wait for it to appear, then enter the code.'
          : 'That code did not match. Please try again.',
      );
    } catch (err) {
      // The project has authenticator sign-in off, so there is no code to check. The sign-in continues without one.
      if (isMfaDisabledError(err)) {
        setMfaProjectState('disabled');
        await onVerified();
        return;
      }
      const msg = (err as Error).message || '';
      setError(
        INVALID_SESSION.test(msg)
          ? 'Your sign-in session could not be verified. Sign in again to continue.'
          : msg || 'That code did not match. Please try again.',
      );
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const enrolling = mode === 'enrol';
  const qrSrc = qrImageSource(enrolment?.qrCode);

  return (
    <Dialog
      open={state !== null}
      onClose={() => {
        if (!busy) onCancel();
      }}
      slotProps={{
        backdrop: {
          sx: {
            bgcolor: 'rgba(15, 23, 42, 0.55)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
          },
        },
      }}
      PaperProps={{
        sx: {
          borderRadius: { xs: 3, sm: 4.5 },
          bgcolor: '#ffffff',
          border: '1px solid #e2e8f0',
          boxShadow: '0 30px 80px -15px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(226, 232, 240, 0.8)',
          p: { xs: 2.5, sm: 4 },
          maxWidth: 440,
          width: '100%',
          mx: 2,
          overflow: 'hidden',
        },
      }}
    >
      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 58,
              height: 58,
              borderRadius: '50%',
              bgcolor: 'rgba(248, 147, 68, 0.12)',
              border: '1.5px solid rgba(248, 147, 68, 0.35)',
              mb: 2,
            }}
          >
            <Box component="img" src="/logo.png" alt="DSA Logo" sx={{ width: 32, height: 32, objectFit: 'contain' }} />
          </Box>
          <Typography
            variant="h5"
            sx={{
              fontWeight: 700,
              color: '#0f172a',
              fontSize: { xs: '1.35rem', sm: '1.5rem' },
              fontFamily: '"Playfair Display", Georgia, "Times New Roman", serif',
              letterSpacing: '-0.02em',
              mb: 0.75,
            }}
          >
            {enrolling ? 'Set up two-step verification' : 'Two-Step Verification'}
          </Typography>
          <Typography variant="body2" sx={{ color: '#475569', fontSize: '0.875rem', lineHeight: 1.5 }}>
            {enrolling ? (
              'Your role requires an authenticator app. Scan the barcode, then enter the 6 digits it shows.'
            ) : (
              <>
                Enter the 6-digit security code from your authenticator app for{' '}
                <Box component="span" sx={{ fontWeight: 600, color: '#0f172a' }}>
                  {email}
                </Box>
              </>
            )}
          </Typography>
        </Box>

        {enrolling && (
          <Stack alignItems="center" spacing={1.5} sx={{ mb: 2.5 }}>
            {qrSrc ? (
              <Box
                component="img"
                src={qrSrc}
                alt="Barcode for your authenticator app"
                sx={{
                  width: 180,
                  height: 180,
                  bgcolor: '#ffffff',
                  p: 1.2,
                  borderRadius: 2.5,
                  border: '1px solid #e2e8f0',
                }}
              />
            ) : (
              <Stack
                alignItems="center"
                justifyContent="center"
                sx={{ width: 180, height: 180, borderRadius: 2.5, border: '1px dashed #cbd5e1' }}
              >
                {error ? (
                  <Typography variant="caption" color="text.secondary">
                    Barcode unavailable
                  </Typography>
                ) : (
                  <CircularProgress size={28} />
                )}
              </Stack>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', px: 1 }}>
              Can’t scan the barcode? Enter this secret key:{' '}
              <Box
                component="code"
                data-testid="auth.mfa.secret"
                sx={{ bgcolor: '#f1f5f9', px: 1, py: 0.5, borderRadius: 1, fontWeight: 600, color: '#1e293b' }}
              >
                {enrolment?.secret ?? ''}
              </Box>
            </Typography>
          </Stack>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2, fontSize: '0.85rem' }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Box component="form" onSubmit={submit} noValidate>
          <Stack spacing={2.5}>
            <Box>
              <Typography
                component="label"
                htmlFor="mfa-auth-code-input"
                sx={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#334155', mb: 1, textAlign: 'center' }}
              >
                Security Code
              </Typography>
              <TextField
                id="mfa-auth-code-input"
                fullWidth
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                disabled={busy}
                placeholder="000000"
                inputProps={{
                  'data-testid': 'mfa.code',
                  maxLength: 6,
                  inputMode: 'numeric',
                  autoComplete: 'one-time-code',
                  pattern: '[0-9]*',
                  style: {
                    textAlign: 'center',
                    fontSize: '1.75rem',
                    fontWeight: 700,
                    letterSpacing: '0.38em',
                    fontFamily: 'monospace',
                    color: '#0f172a',
                  },
                }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2.5,
                    bgcolor: 'rgba(255, 255, 255, 0.95)',
                    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.04)',
                    '& fieldset': { borderColor: 'rgba(33, 89, 136, 0.28)', borderWidth: 1.5 },
                    '&:hover fieldset': { borderColor: '#215988' },
                    '&.Mui-focused fieldset': { borderColor: '#215988', borderWidth: 2 },
                  },
                  '& .MuiOutlinedInput-input': { py: 1.5 },
                }}
              />
            </Box>

            <Button
              type="submit"
              data-testid="mfa.submit"
              fullWidth
              variant="contained"
              size="large"
              disabled={busy || code.length !== 6}
              sx={{
                py: 1.35,
                fontWeight: 700,
                textTransform: 'none',
                fontSize: '0.975rem',
                borderRadius: 2,
                bgcolor: '#000000',
                color: '#ffffff',
                boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)',
                '&:hover': { bgcolor: '#1e293b', boxShadow: '0 6px 20px rgba(0, 0, 0, 0.35)' },
                '&:disabled': { bgcolor: 'rgba(0, 0, 0, 0.12)', color: 'rgba(0, 0, 0, 0.3)' },
              }}
            >
              {busy ? (
                <Stack direction="row" alignItems="center" spacing={1}>
                  <CircularProgress size={20} color="inherit" />
                  <span>Verifying...</span>
                </Stack>
              ) : (
                'Verify & Continue'
              )}
            </Button>

            <Button
              fullWidth
              variant="text"
              size="small"
              disabled={busy}
              onClick={onCancel}
              sx={{
                color: '#64748b',
                fontSize: '0.85rem',
                fontWeight: 600,
                textTransform: 'none',
                '&:hover': { color: '#0f172a', bgcolor: 'transparent' },
              }}
            >
              Cancel and return to sign in
            </Button>
          </Stack>
        </Box>
      </DialogContent>
    </Dialog>
  );
}

// Removes the authenticators that a replacement set-up supersedes. This runs only after the new one is verified, so a set-up that
// is abandoned never leaves the account without one.
async function retireOtherFactors(keepId: string): Promise<void> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.mfa.listFactors();
  for (const f of data?.totp ?? []) {
    if (f.id !== keepId && f.status === 'verified') {
      try {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      } catch {
        // The new authenticator is already verified. An old one that stays can be removed on the security page.
      }
    }
  }
}

// Test builds only. Signs in through the API's test login, which is off in every other build.
async function signInWithTestCode(email: string, code: string, from: string): Promise<void> {
  const config = readConfig();
  const baseUrl = config.success ? config.data.VITE_API_BASE_URL : '';
  const endpoint = baseUrl ? `${baseUrl}/public/v1/auth/test-login` : '/public/v1/auth/test-login';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), otp: code }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || (!json?.data?.access_token && !json?.data?.session)) {
    throw new Error(
      json?.error?.message ||
        (res.status >= 500
          ? 'Cannot connect to the API server. Please ensure the backend is running.'
          : 'Invalid OTP code.'),
    );
  }
  const sessionPayload = json.data.session || json.data;
  saveBypassSession(sessionPayload);
  setAuthToken(sessionPayload.access_token);
  try {
    sessionStorage.removeItem('dsa_pending_email');
    localStorage.removeItem('dsa_pending_email');
  } catch {
    // storage unavailable (private mode or blocked); safe to ignore
  }
  window.location.replace(resolveSafeRedirect(from, sessionPayload));
}
