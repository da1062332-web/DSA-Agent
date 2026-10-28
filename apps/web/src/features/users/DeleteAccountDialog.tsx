// Delete account (POST /v1/users/:id/erasure). Permanent: the person's name, e-mail and mobile are erased, their open work goes to
// another active user, their roles end, and they can never sign in again. A nameless record stays so history keeps its meaning.
// The administrator must pick who takes over (not needed for someone who never signed in), give a reason, and type DELETE.
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { eraseUser, fetchUsers } from './api';
import type { UserSummary } from './types';

export const CONFIRM_WORD = 'DELETE';

/** Why the Delete button cannot be pressed yet, or null when it can. */
export function deleteBlocker(input: {
  status: string;
  handoverToUserId: string;
  reason: string;
  confirmText: string;
}): string | null {
  if (input.status !== 'INVITED' && !input.handoverToUserId) return 'Choose who takes over their open work.';
  if (input.reason.trim().length < 3) return 'Give a reason (at least 3 characters).';
  if (input.confirmText.trim() !== CONFIRM_WORD) return `Type ${CONFIRM_WORD} to confirm.`;
  return null;
}

export function DeleteAccountDialog({
  open,
  user,
  onClose,
  onDeleted,
}: {
  open: boolean;
  user: UserSummary;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [candidates, setCandidates] = useState<{ id: string; displayName: string }[]>([]);
  const [handoverToUserId, setHandoverToUserId] = useState('');
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setHandoverToUserId('');
    setReason('');
    setConfirmText('');
    setError(null);
    fetchUsers({ status: 'ACTIVE', limit: 100 })
      .then((r) => setCandidates(r.data.filter((u) => u.id !== user.id)))
      .catch(() => setCandidates([]));
  }, [open, user.id]);

  const blocker = deleteBlocker({ status: user.status, handoverToUserId, reason, confirmText });

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await eraseUser(
        user.id,
        { ...(handoverToUserId ? { handoverToUserId } : {}), reason: reason.trim() },
        user.lockVersion,
      );
      onDeleted();
    } catch (err) {
      setError((err as Error).message || 'The account could not be deleted.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Delete {user.displayName}’s account?</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          This cannot be undone. Their name, e-mail and mobile number are erased, their roles end, and they
          can never sign in again. Leads, tasks and history they worked on are kept, under “Deleted user”.
        </DialogContentText>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          {user.status !== 'INVITED' && (
            <FormControl fullWidth>
              <InputLabel id="handover-label">Hand over open work to</InputLabel>
              <Select
                labelId="handover-label"
                label="Hand over open work to"
                value={handoverToUserId}
                onChange={(e) => setHandoverToUserId(String(e.target.value))}
                disabled={busy}
              >
                {candidates.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.displayName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <TextField
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            inputProps={{ maxLength: 200 }}
          />
          <TextField
            label={`Type ${CONFIRM_WORD} to confirm`}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={busy}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={() => void submit()}
          disabled={busy || blocker !== null}
          title={blocker ?? undefined}
        >
          {busy ? <CircularProgress size={20} /> : 'Delete account permanently'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
