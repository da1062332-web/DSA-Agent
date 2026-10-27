// Invitation status and resend for an INVITED user (API-USR-001). Shows what happened to the latest invitation e-mail, refreshes while
// the provisioning worker is still sending it, and counts down until the next resend is allowed, using the server's clock.
import { Alert, Box, Button, Stack } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { fetchInvitationStatus, resendInvitation, type InvitationStatus } from './api';

const POLL_MS = 3000;

/** Seconds left until `target`, on the server's clock: `serverTime` was the server's time when the status was fetched at `fetchedAt`. */
export function secondsUntil(
  target: string | null,
  serverTime: string,
  fetchedAt: number,
  now: number,
): number {
  if (!target) return 0;
  const serverNow = Date.parse(serverTime) + (now - fetchedAt);
  return Math.max(0, Math.ceil((Date.parse(target) - serverNow) / 1000));
}

export function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const time = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** What to tell the administrator about the latest invitation e-mail. */
export function deliveryMessage(s: InvitationStatus): {
  severity: 'info' | 'success' | 'warning' | 'error';
  text: string;
} {
  switch (s.deliveryState) {
    case null:
      return {
        severity: 'info',
        text: 'No invitation has been sent yet. Use Resend invitation to send one.',
      };
    case 'QUEUED':
    case 'SENDING':
      return s.lastFailure === 'DELIVERY_RETRY'
        ? {
            severity: 'warning',
            text: 'Sending was delayed by the e-mail service. It is retried automatically.',
          }
        : { severity: 'info', text: 'Sending the invitation e-mail…' };
    case 'SENT':
      if (s.invitationState === 'EXPIRED') {
        return { severity: 'warning', text: 'The invitation link has expired. Send a new one.' };
      }
      return {
        severity: 'success',
        text:
          `Invitation e-mail sent${s.sentAt ? ` at ${time(s.sentAt)}` : ''}. ` +
          `The link works until ${s.expiresAt ? time(s.expiresAt) : 'it expires'}. ` +
          (s.resendCount > 0
            ? 'A resent invitation arrives with the subject "Reset your password". Ask them to check spam too.'
            : 'Ask them to check spam if it has not arrived in a few minutes.'),
      };
    case 'FAILED':
      switch (s.lastFailure) {
        case 'EMAIL_NOT_AVAILABLE':
          return {
            severity: 'error',
            text: 'This address already has a sign-in account that belongs elsewhere. Use another address, or ask your system administrator.',
          };
        case 'SUBJECT_CONFLICT':
          return {
            severity: 'error',
            text: 'The sign-in account no longer matches this user. Ask your system administrator.',
          };
        case 'REQUEST_EXPIRED':
          return {
            severity: 'warning',
            text: 'The invitation was not sent within 24 hours. Send a new one.',
          };
        default:
          return {
            severity: 'error',
            text: 'The e-mail could not be sent after several tries. Try again later.',
          };
      }
    case 'CANCELLED':
      return {
        severity: 'info',
        text: 'The invitation was cancelled because the account is no longer waiting for one.',
      };
  }
}

/** The resend button's label, and whether it can be pressed now. */
export function resendButton(
  s: InvitationStatus | null,
  secondsLeft: number,
  busy: boolean,
): { label: string; enabled: boolean } {
  if (busy) return { label: 'Sending…', enabled: false };
  if (!s) return { label: 'Resend invitation', enabled: false };
  if (s.resendsLeft <= 0) return { label: 'No resends left', enabled: false };
  if (s.deliveryState === 'QUEUED' || s.deliveryState === 'SENDING')
    return { label: 'Sending…', enabled: false };
  if (secondsLeft > 0) return { label: `Resend in ${formatCountdown(secondsLeft)}`, enabled: false };
  return { label: 'Resend invitation', enabled: true };
}

export function InvitationPanel({ userId, canResend }: { userId: string; canResend: boolean }) {
  const [status, setStatus] = useState<InvitationStatus | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await fetchInvitationStatus(userId);
      setStatus(s);
      setFetchedAt(Date.now());
      setNow(Date.now());
    } catch (err) {
      setError((err as Error).message || 'The invitation status could not be loaded.');
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh while the worker is still sending, so the panel moves to "sent" (or "failed") on its own.
  const sending = status?.deliveryState === 'QUEUED' || status?.deliveryState === 'SENDING';
  useEffect(() => {
    if (!sending) return;
    const timer = setTimeout(() => void load(), POLL_MS);
    return () => clearTimeout(timer);
  }, [sending, status, load]);

  const secondsLeft = status ? secondsUntil(status.nextResendAt, status.serverTime, fetchedAt, now) : 0;
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const resend = async () => {
    setBusy(true);
    setError(null);
    try {
      await resendInvitation(userId);
    } catch (err) {
      setError((err as Error).message || 'The invitation could not be sent. Try again.');
    } finally {
      setBusy(false);
      await load();
    }
  };

  const button = resendButton(status, secondsLeft, busy);
  const message = status ? deliveryMessage(status) : null;
  return (
    <Box data-testid="invitation.panel">
      <Stack spacing={1.5} sx={{ mb: 2 }}>
        {error ? (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : (
          message && <Alert severity={message.severity}>{message.text}</Alert>
        )}
      </Stack>
      {canResend && (
        <Button
          variant="outlined"
          disabled={!button.enabled}
          onClick={() => void resend()}
          data-testid="invitation.resend"
        >
          {button.label}
        </Button>
      )}
    </Box>
  );
}
