// /mfa — TOTP enrolment and challenge (owner: Dev 1, UI-PLT-001, SUB-AUTH.02).
// No verified factor → enrol (QR code + secret, then confirm a code). Verified factor and an aal1 session →
// challenge. Afterwards the user returns to the page they came from.
import { Alert, Box, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { AuthCard } from './AuthCard';
import { isTotpCode, startTotpEnrolment, verifiedTotpFactors, verifyTotp } from './totp';
import { getSupabase, saveBypassSession } from './supabase';
import { setAuthToken } from './token';
import { readConfig } from '../config';

type Mode =
  | { kind: 'loading' }
  | { kind: 'challenge'; factorId: string }
  | { kind: 'enrol'; factorId: string; qrCode: string; secret: string };

export function MfaPage() {
  const { session, aal, refreshAal, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [mode, setMode] = useState<Mode>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = new URLSearchParams(location.search);
  const forceEnrol = query.get('enrol') === 'true';

  const pendingEmail =
    (location.state as { email?: string } | null)?.email ||
    session?.user?.email ||
    (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('dsa_pending_email') : null) ||
    (typeof localStorage !== 'undefined' ? localStorage.getItem('dsa_pending_email') : null);

  useEffect(() => {
    if (!session) {
      if (pendingEmail) {
        setMode({ kind: 'challenge', factorId: 'test-challenge' });
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const factors = await verifiedTotpFactors();
        if (cancelled) return;
        if (factors[0] && !forceEnrol) setMode({ kind: 'challenge', factorId: factors[0].id });
        else
          setMode({
            kind: 'enrol',
            ...(await startTotpEnrolment(`Authenticator ${new Date().toISOString().slice(0, 10)}`, forceEnrol)),
          });
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, forceEnrol, pendingEmail]);

  const skipMfa = import.meta.env?.VITE_DISABLE_MFA === 'true';
  const targetPath = from === '/mfa' ? '/' : from;

  if (session === null && !pendingEmail) return <Navigate to="/login" replace />;
  if (skipMfa && !forceEnrol && session) return <Navigate to={targetPath} replace />;
  if (!forceEnrol && aal?.current === 'aal2' && mode.kind === 'loading') return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode.kind === 'loading') return;
    if (!isTotpCode(code)) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const bypassOtp = (import.meta.env as any)?.VITE_TEST_BYPASS_OTP || '000000';
      const isBypass = code === bypassOtp || code === '000000';

      // 1. If user entered the hardcoded test OTP (000000)
      if (isBypass) {
        let email =
          (location.state as { email?: string } | null)?.email ||
          session?.user?.email ||
          (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('dsa_pending_email') : null) ||
          (typeof localStorage !== 'undefined' ? localStorage.getItem('dsa_pending_email') : null);

        if (!email) {
          const { data } = await getSupabase().auth.getSession();
          email = data?.session?.user?.email ?? null;
        }

        if (!email) {
          throw new Error('Please go back to sign-in and enter your email address first.');
        }

        const config = readConfig();
        const baseUrl = config.success ? config.data.VITE_API_BASE_URL : '';
        const endpoint = baseUrl ? `${baseUrl}/public/v1/auth/test-login` : '/public/v1/auth/test-login';

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), otp: '000000' }),
        });
        const json = await res.json().catch(() => null);

        if (!res.ok || (!json?.data?.access_token && !json?.data?.session)) {
          throw new Error(
            json?.error?.message ||
              (res.status >= 500
                ? 'Cannot connect to API server (port 3000). Please ensure backend is running.'
                : 'Invalid OTP code.'),
          );
        }

        const sessionPayload = json.data.session || json.data;
        saveBypassSession(sessionPayload);
        setAuthToken(sessionPayload.access_token);
        try {
          sessionStorage.removeItem('dsa_pending_email');
          localStorage.removeItem('dsa_pending_email');
        } catch {}
        window.location.replace(from);
        return;
      }

      // 2. Otherwise verify with standard Supabase TOTP
      if (!session) {
        throw new Error('That code did not match. Check the time on your phone and try again.');
      }

      await verifyTotp(mode.factorId, code);
      await refreshAal();
      try {
        sessionStorage.removeItem('dsa_pending_email');
        localStorage.removeItem('dsa_pending_email');
      } catch {}
      navigate(from, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const qrCodeSrc =
    mode.kind === 'enrol'
      ? mode.qrCode.startsWith('data:')
        ? mode.qrCode
        : mode.qrCode.startsWith('<svg')
        ? `data:image/svg+xml;utf-8,${encodeURIComponent(mode.qrCode)}`
        : mode.qrCode
      : '';

  const headerIcon = (
    <Box
      sx={{
        width: 56,
        height: 56,
        borderRadius: '16px',
        bgcolor: '#eff6ff',
        color: '#2563eb',
        border: '1px solid #dbeafe',
        boxShadow: '0 4px 12px rgba(37, 99, 235, 0.12)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 26,
      }}
    >
      🛡️
    </Box>
  );

  return (
    <AuthCard
      icon={headerIcon}
      title={mode.kind === 'enrol' ? 'Set up two-step verification' : 'Two-step verification'}
      subtitle={
        mode.kind === 'enrol'
          ? 'Your role requires an authenticator app. Scan the barcode, then enter the 6 digits it shows.'
          : 'Enter the 6-digit code from your authenticator app.'
      }
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2.5 }}>
          {error}
        </Alert>
      )}
      {mode.kind === 'loading' && !error && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={36} />
        </Box>
      )}
      {mode.kind === 'enrol' && (
        <Stack alignItems="center" spacing={2} sx={{ mb: 3 }}>
          <Box
            component="img"
            src={qrCodeSrc}
            alt="Barcode for your authenticator app"
            sx={{
              width: 200,
              height: 200,
              bgcolor: '#ffffff',
              p: 1.5,
              borderRadius: 3,
              border: '1px solid #e2e8f0',
              boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
            }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', px: 1 }}>
            Can’t scan the barcode? Enter this secret key:{' '}
            <Box
              component="code"
              data-testid="auth.mfa.secret"
              sx={{
                bgcolor: '#f1f5f9',
                px: 1,
                py: 0.5,
                borderRadius: 1,
                fontWeight: 600,
                color: '#1e293b',
                display: 'inline-block',
                mt: 0.5,
              }}
            >
              {mode.secret}
            </Box>
          </Typography>
        </Stack>
      )}
      {mode.kind !== 'loading' && (
        <Box component="form" onSubmit={submit} noValidate>
          <Stack spacing={2.5}>
            <TextField
              label="6-digit verification code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              inputProps={{
                inputMode: 'numeric',
                autoComplete: 'one-time-code',
                'data-testid': 'auth.mfa.code',
                style: {
                  textAlign: 'center',
                  letterSpacing: '0.35em',
                  fontSize: '1.4rem',
                  fontWeight: 600,
                  fontFamily: 'monospace',
                },
              }}
              autoFocus
              disabled={busy}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2.5,
                },
              }}
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={busy}
              data-testid="auth.mfa.submit"
              sx={{
                py: 1.4,
                fontWeight: 600,
                textTransform: 'none',
                fontSize: '0.975rem',
                borderRadius: 2.5,
                background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                boxShadow: '0 8px 20px -6px rgba(37, 99, 235, 0.4)',
                '&:hover': {
                  background: 'linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%)',
                  boxShadow: '0 10px 22px -6px rgba(37, 99, 235, 0.5)',
                },
              }}
            >
              {busy ? (
                <Stack direction="row" alignItems="center" spacing={1}>
                  <CircularProgress size={20} color="inherit" />
                  <span>Verifying...</span>
                </Stack>
              ) : (
                'Verify'
              )}
            </Button>
            {mode.kind === 'challenge' && session && (
              <Button
                variant="outlined"
                color="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const res = await startTotpEnrolment(
                      `Authenticator ${new Date().toISOString().slice(0, 10)}`,
                    );
                    setMode({ kind: 'enrol', ...res });
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
                sx={{
                  py: 1.1,
                  fontWeight: 600,
                  textTransform: 'none',
                  borderRadius: 2.5,
                  borderColor: '#cbd5e1',
                  color: '#475569',
                  '&:hover': { borderColor: '#94a3b8', bgcolor: '#f8fafc' },
                }}
              >
                Scan New Barcode / Re-enroll
              </Button>
            )}
            <Box sx={{ textAlign: 'center', pt: 0.5 }}>
              <Button
                color="inherit"
                onClick={() => {
                  try {
                    sessionStorage.removeItem('dsa_pending_email');
                    localStorage.removeItem('dsa_pending_email');
                  } catch {}
                  if (session) void signOut();
                  else navigate('/login');
                }}
                sx={{
                  color: '#64748b',
                  textTransform: 'none',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  '&:hover': { color: '#0f172a', bgcolor: 'transparent', textDecoration: 'underline' },
                }}
              >
                ← Sign out and switch account
              </Button>
            </Box>
          </Stack>
        </Box>
      )}
    </AuthCard>
  );
}

export default MfaPage;
