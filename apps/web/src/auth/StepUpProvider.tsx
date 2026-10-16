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
          if (import.meta.env?.VITE_DISABLE_MFA === 'true') {
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
      const [factor] = await verifiedTotpFactors();
      if (!factor) {
        finish(false);
        navigate('/mfa');
        return;
      }
      await verifyTotp(factor.id, code);
      await refreshAal();
      finish(true);
    } catch (err) {
      setError((err as Error).message);
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
