// Staff invitation acceptance (owner: platform, API-USR-001). The invitation e-mail opens this page, and the link signs the invitee in
// to Supabase for this one step. The invitee chooses a password here, then every session is ended, so the next sign-in is a password
// sign-in. The API activates the account only on a password sign-in: the link session alone never grants access.
//
// Two link formats arrive here:
//   - the default Supabase link (…/verify → here with #access_token=…): Supabase has already used the one-time token;
//   - the scanner-safe link (here with ?token_hash=…&type=invite|recovery), from the e-mail templates in
//     docs/INVITATION_HOSTED_CHECKLIST.md: the token is used only when the person presses Continue, so a mail scanner that opens the
//     link first cannot spend it.
// When Supabase sends the browser back with an error (for example otp_expired), the page shows that reason instead of a guess.
import { Alert, Box, Button, CircularProgress, Stack, TextField } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { AuthCard } from './AuthCard';
import { getSupabase } from './supabase';

const MIN_PASSWORD = 12;
const LINK_TYPES = ['invite', 'recovery', 'magiclink'] as const;
type LinkType = (typeof LINK_TYPES)[number];

/** The part of the Supabase auth client that setting the password uses. */
export interface InvitedPasswordAuth {
  updateUser(attributes: { password: string }): Promise<{ error: { message: string } | null }>;
  signOut(options: { scope: 'global' }): Promise<unknown>;
}

/** The part of the Supabase auth client that redeems a scanner-safe link. */
export interface LinkVerifier {
  verifyOtp(params: { token_hash: string; type: LinkType }): Promise<{ error: { message: string } | null }>;
}

export type LinkState =
  | { kind: 'error'; code: string; description: string }
  | { kind: 'token'; tokenHash: string; type: LinkType }
  | { kind: 'none' };

/** Reads what the e-mail link put in the address: a Supabase error, a scanner-safe token, or nothing. */
export function readLink(location: { hash: string; search: string }): LinkState {
  const params = new URLSearchParams(location.search);
  for (const [k, v] of new URLSearchParams(location.hash.replace(/^#/, ''))) params.set(k, v);
  const error = params.get('error_code') ?? params.get('error');
  if (error) {
    return {
      kind: 'error',
      code: error,
      description: params.get('error_description')?.replace(/\+/g, ' ') ?? 'The link could not be used.',
    };
  }
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  if (tokenHash && (LINK_TYPES as readonly string[]).includes(type ?? '')) {
    return { kind: 'token', tokenHash, type: type as LinkType };
  }
  return { kind: 'none' };
}

/**
 * Checks the two passwords, sets the new one, then ends every session. Returns the reason the password was not set, or null when it was.
 * The session that opened the link is ended too: only a sign-in with the new password can activate the account.
 */
export async function setInvitedPassword(
  auth: InvitedPasswordAuth,
  password: string,
  confirm: string,
): Promise<string | null> {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password !== confirm) return 'The passwords do not match.';
  const { error } = await auth.updateUser({ password });
  if (error) return error.message;
  await auth.signOut({ scope: 'global' });
  return null;
}

/** Removes the token and any link error from the address bar, keeping the page. */
export function forgetLinkToken(): void {
  if (typeof window !== 'undefined') window.history.replaceState(null, '', window.location.pathname);
}

/** Redeems a scanner-safe link. Returns the reason it failed, or null when the invitee is now signed in for this step. */
export async function redeemLink(
  auth: LinkVerifier,
  tokenHash: string,
  type: LinkType,
): Promise<string | null> {
  const { error } = await auth.verifyOtp({ token_hash: tokenHash, type });
  return error ? error.message : null;
}

export function AcceptInvitationPage() {
  const { session } = useAuth();
  // Read once, on the first render: the Supabase client clears the address after it has read it.
  const [link] = useState<LinkState>(() =>
    typeof window === 'undefined' ? { kind: 'none' } : readLink(window.location),
  );
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [redeemed, setRedeemed] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const problem = await setInvitedPassword(getSupabase().auth, password, confirm);
    setBusy(false);
    if (problem) setError(problem);
    else setDone(true);
  };

  const redeem = async () => {
    if (link.kind !== 'token') return;
    setBusy(true);
    setError(null);
    // The token is single-use: drop it from the address first, so the reload the app does when the signed-in person changes (an
    // administrator testing in their own browser) does not offer the spent token again.
    forgetLinkToken();
    const problem = await redeemLink(getSupabase().auth, link.tokenHash, link.type);
    setBusy(false);
    if (problem) setError(problem);
    else setRedeemed(true);
  };

  if (done) {
    return (
      <AuthCard
        title="Your password is set"
        subtitle="Sign in with your email address and the new password to finish setting up your account."
      >
        <Button component={RouterLink} to="/login" variant="contained" size="large" fullWidth>
          Go to sign in
        </Button>
      </AuthCard>
    );
  }

  if (session === undefined) return null;

  // A token link always asks for Continue, even when someone is already signed in in this browser: the password must be set for the
  // invitee's account, never for whoever happened to be signed in.
  if (link.kind === 'token' && !redeemed) {
    return (
      <AuthCard title="Set up your account" subtitle="Continue to choose the password you will sign in with.">
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error} Ask your administrator to send a new invitation.
          </Alert>
        )}
        <Button onClick={() => void redeem()} variant="contained" size="large" fullWidth disabled={busy}>
          {busy ? <CircularProgress size={22} color="inherit" /> : 'Continue'}
        </Button>
      </AuthCard>
    );
  }

  if (!session) {
    return (
      <AuthCard title="Invitation link expired" subtitle="The link was already used or is too old.">
        <Alert severity="info" sx={{ mb: 2 }}>
          Ask your administrator to send a new invitation.
          {link.kind === 'error' && (
            <Box component="span" sx={{ display: 'block', mt: 1 }} data-testid="accept.link-error">
              {`Reason from the sign-in service: ${link.description} (${link.code})`}
            </Box>
          )}
        </Alert>
        <Button component={RouterLink} to="/login" variant="contained" size="large" fullWidth>
          Back to sign in
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Choose your password"
      subtitle={`Setting the password for ${session.user.email ?? 'your account'}. At least ${MIN_PASSWORD} characters.`}
    >
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
