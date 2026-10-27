// Password recovery (owner: Dev 1, SUB-AUTH.04) on Supabase Auth.
// /forgot-password always shows the same confirmation, whether or not the email exists (no enumeration).
// /reset-password is opened from the emailed link; Supabase signs the user in with a recovery session.
import { Alert, Box, Button, CircularProgress, Link, Stack, TextField } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { forgetLinkToken, readLink, redeemLink, type LinkState } from './AcceptInvitationPage';
import { AuthCard } from './AuthCard';
import { getSupabase } from './supabase';

const MIN_PASSWORD = 12;

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Enter your work email address.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    // Rate limits are the only error worth showing; everything else gets the uniform answer.
    if (err?.status === 429) setError('Too many requests. Wait a minute and try again.');
    else setSent(true);
  };

  return (
    <AuthCard title="Reset your password" subtitle="We’ll email you a link to choose a new password.">
      {sent ? (
        <Alert severity="success" data-testid="auth.forgot.sent">
          If an account exists for that email, a reset link is on its way. The link works once.
        </Alert>
      ) : (
        <Box component="form" onSubmit={submit} noValidate>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Email"
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              inputProps={{ 'data-testid': 'auth.forgot.email' }}
            />
            <Button type="submit" variant="contained" size="large" disabled={busy}>
              {busy ? <CircularProgress size={22} color="inherit" /> : 'Send reset link'}
            </Button>
          </Stack>
        </Box>
      )}
      <Box sx={{ textAlign: 'center', mt: 2 }}>
        <Link component={RouterLink} to="/login">
          Back to sign in
        </Link>
      </Box>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const { session, recovering, signOut } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A scanner-safe link (?token_hash=…&type=recovery) is redeemed only when the person presses Continue (see AcceptInvitationPage).
  const [link] = useState<LinkState>(() =>
    typeof window === 'undefined' ? { kind: 'none' } : readLink(window.location),
  );

  const redeem = async () => {
    if (link.kind !== 'token') return;
    setBusy(true);
    setError(null);
    forgetLinkToken();
    const problem = await redeemLink(getSupabase().auth, link.tokenHash, link.type);
    setBusy(false);
    if (problem) setError(problem);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) return setError('The passwords do not match.');
    setBusy(true);
    setError(null);
    const { error: err } = await getSupabase().auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    // Every other session is signed out after a password change.
    await signOut('others');
    navigate('/', { replace: true });
  };

  if (session === undefined) return null;
  if (!session && link.kind === 'token') {
    return (
      <AuthCard title="Choose a new password" subtitle="Continue to set the password you will sign in with.">
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Button onClick={() => void redeem()} variant="contained" size="large" fullWidth disabled={busy}>
          {busy ? <CircularProgress size={22} color="inherit" /> : 'Continue'}
        </Button>
      </AuthCard>
    );
  }
  if (!session || !recovering) {
    return (
      <AuthCard title="Reset link expired" subtitle="The link was already used or is too old.">
        {link.kind === 'error' && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {`Reason from the sign-in service: ${link.description} (${link.code})`}
          </Alert>
        )}
        <Button component={RouterLink} to="/forgot-password" variant="contained" fullWidth>
          Request a new link
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" subtitle={`At least ${MIN_PASSWORD} characters.`}>
      <Box component="form" onSubmit={submit} noValidate>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          <TextField
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy}
          />
          <Button type="submit" variant="contained" size="large" disabled={busy}>
            {busy ? <CircularProgress size={22} color="inherit" /> : 'Save password'}
          </Button>
        </Stack>
      </Box>
    </AuthCard>
  );
}
