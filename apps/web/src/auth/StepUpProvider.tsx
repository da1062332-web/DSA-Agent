// Step-up dialog (owner: Dev 1, SUB-AUTH.02). Opens when the API answers 401 STEP_UP_REQUIRED (rule approve,
// publish, suspend and any other sensitive action). A fresh TOTP verification upgrades the session to aal2 for
// 900 s; the API client then retries the original request once.
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { registerStepUpHandler } from '../api/client';
import { useAuth } from './AuthProvider';
import { isTotpCode, verifiedTotpFactors, verifyTotp } from './totp';
import { getSupabase, saveBypassSession } from './supabase';
import { setAuthToken } from './token';
import { readConfig } from '../config';
import { mfaSkipRequested, testAuthEnabled, testOtp } from './test-auth';

export function StepUpProvider({ children }: { children: ReactNode }) {
  const { refreshAal } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<((ok: boolean) => void) | null>(null);

  const finish = useCallback((ok: boolean) => {
    pending.current?.(ok);
    pending.current = null;
    setOpen(false);
    setCode('');
    setError(null);
  }, []);

  useEffect(() => {
    registerStepUpHandler(
      () =>
        new Promise<boolean>((resolve) => {
          if (mfaSkipRequested()) {
            resolve(true);
            return;
          }
          pending.current?.(false);
          pending.current = resolve;
          setOpen(true);
        }),
    );
    return () => registerStepUpHandler(null);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isTotpCode(code)) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Test builds only: the fixed code goes to the test sign-in. Every other build verifies with Supabase.
      if (testAuthEnabled() && code === testOtp()) {
        const { data } = await getSupabase().auth.getSession();
        const email = data?.session?.user?.email;
        if (email) {
          const config = readConfig();
          const baseUrl = config.success ? config.data.VITE_API_BASE_URL : '';
          const endpoint = baseUrl ? `${baseUrl}/public/v1/auth/test-login` : '/public/v1/auth/test-login';
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim(), otp: code }),
          });
          const json = await res.json().catch(() => null);
          if (res.ok && (json?.data?.access_token || json?.data?.session)) {
            const sessionPayload = json.data.session || json.data;
            saveBypassSession(sessionPayload);
            setAuthToken(sessionPayload.access_token);
            await refreshAal();
            finish(true);
            return;
          }
        }
      }

      const [factor] = await verifiedTotpFactors();
      if (!factor) {
        finish(false);
        navigate('/login', { state: { from: window.location.pathname } });
        return;
      }
      await verifyTotp(factor.id, code);
      await refreshAal();
      finish(true);
    } catch (err) {
      setError((err as Error).message || 'That code did not match. Please try again.');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {children}
      <Dialog open={open} onClose={() => finish(false)} maxWidth="xs" fullWidth>
        <form onSubmit={submit} noValidate>
          <DialogTitle>Confirm it’s you</DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              This action needs a fresh code from your authenticator app.
            </DialogContentText>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            <TextField
              label="6-digit code"
              fullWidth
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputProps={{
                inputMode: 'numeric',
                autoComplete: 'one-time-code',
                'data-testid': 'auth.stepup.code',
              }}
              disabled={busy}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => finish(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={busy} data-testid="auth.stepup.submit">
              {busy ? <CircularProgress size={20} color="inherit" /> : 'Verify'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}
