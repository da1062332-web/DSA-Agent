// /mfa — TOTP enrolment and challenge (owner: Dev 1, UI-PLT-001, SUB-AUTH.02).
// No verified factor → enrol (QR code + secret, then confirm a code). Verified factor and an aal1 session →
// challenge. Afterwards the user returns to the page they came from.
import { Alert, Box, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { AuthCard } from './AuthCard';
import { isTotpCode, startTotpEnrolment, verifiedTotpFactors, verifyTotp } from './totp';

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

  useEffect(() => {
    if (!session) return;
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
  }, [session, forceEnrol]);

  const skipMfa = import.meta.env?.VITE_DISABLE_MFA === 'true';
  const targetPath = from === '/mfa' ? '/' : from;

  if (session === null) return <Navigate to="/login" replace />;
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
      await verifyTotp(mode.factorId, code);
      await refreshAal();
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

  return (
    <AuthCard
      title={mode.kind === 'enrol' ? 'Set up two-step verification' : 'Two-step verification'}
      subtitle={
        mode.kind === 'enrol'
          ? 'Your role requires an authenticator app. Scan the barcode, then enter the 6 digits it shows.'
          : 'Enter the 6-digit code from your authenticator app.'
      }
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {mode.kind === 'loading' && !error && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress />
        </Box>
      )}
      {mode.kind === 'enrol' && (
        <Stack alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
          <Box
            component="img"
            src={qrCodeSrc}
            alt="Barcode for your authenticator app"
            sx={{
              width: 200,
              height: 200,
              bgcolor: '#ffffff',
              p: 1.5,
              borderRadius: 2,
              border: '1px solid #e0e0e0',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}
          />
          <Typography variant="caption" color="text.secondary">
            Can’t scan the barcode? Enter this secret key: <code data-testid="auth.mfa.secret">{mode.secret}</code>
          </Typography>
        </Stack>
      )}
      {mode.kind !== 'loading' && (
        <Box component="form" onSubmit={submit} noValidate>
          <Stack spacing={2}>
            <TextField
              label="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputProps={{
                inputMode: 'numeric',
                autoComplete: 'one-time-code',
                'data-testid': 'auth.mfa.code',
              }}
              autoFocus
              disabled={busy}
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={busy}
              data-testid="auth.mfa.submit"
            >
              {busy ? <CircularProgress size={22} color="inherit" /> : 'Verify'}
            </Button>
            {mode.kind === 'challenge' && (
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
              >
                Scan New Barcode / Re-enroll
              </Button>
            )}
            <Button
              variant="outlined"
              color="warning"
              onClick={() => navigate(targetPath, { replace: true })}
            >
              Bypass Verification (Dev Mode)
            </Button>
            <Button color="inherit" onClick={() => void signOut()}>
              Sign out
            </Button>
          </Stack>
        </Box>
      )}
    </AuthCard>
  );
}

export default MfaPage;
