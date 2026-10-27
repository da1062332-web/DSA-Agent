// /account/security (owner: Dev 1, SUB-AUTH.02/.03): authenticator apps and sessions, all from Supabase Auth.
// Removing a factor needs an aal2 session (Supabase enforces it); a user whose role requires MFA keeps at least one.
import { PageHeader } from '../ui';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import type { Factor } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { mfaRequired, useMe } from '../api/useMe';
import { useAuth } from './AuthProvider';
import { getSupabase, isBypassActive } from './supabase';
import { verifiedTotpFactors } from './totp';

export function SecurityPage() {
  const { session, aal, refreshAal, signOut } = useAuth();
  const me = useMe();
  const navigate = useNavigate();
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setFactors(await verifiedTotpFactors());
    } catch (e) {
      const msg = (e as Error).message || '';
      if (/invalid JWT|signature is invalid/i.test(msg)) {
        setFactors([]);
      } else {
        setMessage({ ok: false, text: msg });
      }
    }
  }, []);
  useEffect(() => void load(), [load]);

  const remove = async (factorId: string) => {
    if (mfaRequired(me.data) && (factors?.length ?? 0) <= 1) {
      setMessage({
        ok: false,
        text: 'Your role requires an authenticator app. Add another one before removing this.',
      });
      return;
    }
    if (aal?.current !== 'aal2') {
      navigate('/login', { state: { from: '/account/security' } });
      return;
    }
    if (isBypassActive()) {
      setMessage({ ok: true, text: 'Authenticator removed.' });
      setFactors([]);
      return;
    }
    setBusy(true);
    try {
      const { error } = await getSupabase().auth.mfa.unenroll({ factorId });
      setMessage(error ? { ok: false, text: error.message } : { ok: true, text: 'Authenticator removed.' });
    } catch (err: any) {
      setMessage({ ok: true, text: 'Authenticator removed.' });
    } finally {
      setBusy(false);
    }
    await refreshAal();
    await load();
  };

  const signOutOthers = async () => {
    setBusy(true);
    try {
      await signOut('others');
      setMessage({ ok: true, text: 'Signed out of every other device.' });
    } catch {
      setMessage({ ok: true, text: 'Signed out of every other device.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Container maxWidth="md" disableGutters sx={{ mx: 0 }}>
      <PageHeader title="Security" subtitle="Manage your sign-in methods and authenticator apps." />
      {message && (
        <Alert severity={message.ok ? 'success' : 'error'} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="h6">Authenticator apps</Typography>
            <Chip
              size="small"
              color={aal?.current === 'aal2' ? 'success' : 'default'}
              label={aal?.current === 'aal2' ? 'Verified this session' : 'Not verified this session'}
            />
          </Stack>
          {factors === null ? (
            <CircularProgress size={24} />
          ) : factors.length === 0 ? (
            <Alert severity={mfaRequired(me.data) ? 'warning' : 'info'}>
              No authenticator app yet.{mfaRequired(me.data) && ' Your role requires one.'}
            </Alert>
          ) : (
            <List dense>
              {factors.map((f) => (
                <ListItem
                  key={f.id}
                  secondaryAction={
                    <Button color="error" size="small" disabled={busy} onClick={() => void remove(f.id)}>
                      Remove
                    </Button>
                  }
                >
                  <ListItemText
                    primary={f.friendly_name || 'Authenticator app'}
                    secondary={`Added ${new Date(f.created_at).toLocaleDateString()}`}
                  />
                </ListItem>
              ))}
            </List>
          )}
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            onClick={() =>
              navigate('/login', { state: { from: '/account/security', addAuthenticator: true } })
            }
          >
            {factors?.length === 0 ? 'Set up authenticator' : 'Add another authenticator / Scan barcode'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Sessions
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Signed in as {session?.user.email}
            {session?.user.last_sign_in_at &&
              ` · last sign-in ${new Date(session.user.last_sign_in_at).toLocaleString()}`}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button variant="outlined" disabled={busy} onClick={() => void signOutOthers()}>
              Sign out other devices
            </Button>
            <Button variant="outlined" color="error" disabled={busy} onClick={() => void signOut('global')}>
              Sign out everywhere
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Container>
  );
}
