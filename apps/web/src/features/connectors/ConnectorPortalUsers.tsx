// apps/web/src/features/connectors/ConnectorPortalUsers.tsx
// Portal Access & Users tab of the connector workbench (MOD-CON). A connector business profile and its portal logins are separate:
// a connector may have no portal login, or several. A portal login holds no role; it is invited through the standard invitation
// pipeline (the provisioning service sends the e-mail) and becomes ACTIVE only when the invitee sets a password.
// Every state shown here comes from GET /v1/connectors/:id/users; nothing is inferred in the browser.

import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConnectorPortalUser, ConnectorResource } from '@dsa/contracts';
import { apiFetch, errorText } from '../../api/client';
import { hasPermission, useMe } from '../../api/useMe';

export interface PortalInviteInput {
  displayName: string;
  email: string;
  mobileE164?: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164 = /^\+[1-9]\d{6,14}$/;

/** Field errors for an invitation, or an empty object when it can be sent. The server checks the same rules again. */
export function invitationErrors(input: PortalInviteInput): Partial<Record<keyof PortalInviteInput, string>> {
  const errors: Partial<Record<keyof PortalInviteInput, string>> = {};
  if (input.displayName.trim().length < 2) errors.displayName = 'Enter the person’s full name.';
  if (!EMAIL.test(input.email.trim())) errors.email = 'Enter a valid e-mail address.';
  if (input.mobileE164 && !E164.test(input.mobileE164.trim()))
    errors.mobileE164 = 'Use the international format, e.g. +919876543210.';
  return errors;
}

export const newIdempotencyKey = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

/** Invites a portal login. The same key for a retried request returns the same login instead of creating a second one. */
export function invitePortalUser(connectorId: string, input: PortalInviteInput, idempotencyKey: string) {
  return apiFetch<ConnectorPortalUser>(`/v1/connectors/${connectorId}/users`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      displayName: input.displayName.trim(),
      email: input.email.trim(),
      ...(input.mobileE164 ? { mobileE164: input.mobileE164.trim() } : {}),
    }),
  });
}

const STATUS_COLOR: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  INVITED: 'info',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  DEACTIVATED: 'default',
};

/** What the invitation column says, from the latest invitation's state and its delivery. */
export function invitationLabel(user: ConnectorPortalUser): string {
  const { state, deliveryState } = user.invitation;
  if (state === 'ACCEPTED') return 'Accepted';
  if (state === 'NONE') return user.status === 'DEACTIVATED' ? 'Withdrawn' : 'None';
  if (state === 'EXPIRED') return 'Expired';
  if (deliveryState === 'QUEUED' || deliveryState === 'SENDING') return 'Queued, not yet sent';
  if (deliveryState === 'FAILED') return 'Delivery failed';
  if (deliveryState === 'SENT') return 'Sent, awaiting password';
  return 'Pending';
}

type ActionKind = 'SUSPEND' | 'REACTIVATE' | 'REVOKE';

const ACTION_TEXT: Record<ActionKind, { title: string; confirm: string; body: string }> = {
  SUSPEND: {
    title: 'Suspend portal access',
    confirm: 'Suspend',
    body: 'The person can no longer use the portal from their next request. Their sign-in sessions are not ended by this action.',
  },
  REACTIVATE: {
    title: 'Reactivate portal access',
    confirm: 'Reactivate',
    body: 'The person can use the portal again. This is possible only while the connector is active.',
  },
  REVOKE: {
    title: 'Withdraw invitation',
    confirm: 'Withdraw',
    body: 'The invitation is withdrawn and the login can never be activated. To give access later, invite the person again.',
  },
};

export interface ConnectorPortalUsersProps {
  connector: ConnectorResource;
  /** An invitation that failed right after the connector was created, offered here for a retry with the same key. */
  failedInvite?: { input: PortalInviteInput; idempotencyKey: string; message: string } | null;
  onFailedInviteResolved?: () => void;
}

export function ConnectorPortalUsers({
  connector,
  failedInvite,
  onFailedInviteResolved,
}: ConnectorPortalUsersProps) {
  const me = useMe();
  const queryClient = useQueryClient();
  const canManage = hasPermission(me.data, 'connector.manage');
  const queryKey = ['connector-portal-users', connector.id];
  const inviteAllowed = connector.status !== 'SUSPENDED' && connector.status !== 'TERMINATED';

  const usersQuery = useQuery({
    queryKey,
    queryFn: async () =>
      (await apiFetch<{ items: ConnectorPortalUser[] }>(`/v1/connectors/${connector.id}/users`)).items,
    enabled: canManage,
  });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState<PortalInviteInput>({ displayName: '', email: '', mobileE164: '' });
  const [inviteKey, setInviteKey] = useState('');
  const [touched, setTouched] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<{ kind: ActionKind; user: ConnectorPortalUser } | null>(null);
  const [reason, setReason] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const inviteMutation = useMutation({
    mutationFn: ({ input, key }: { input: PortalInviteInput; key: string }) =>
      invitePortalUser(connector.id, input, key),
    onSuccess: (user) => {
      setInviteOpen(false);
      setNotice(
        `Invitation for ${user.email} is queued. The e-mail is sent shortly; the person becomes active after setting a password.`,
      );
      onFailedInviteResolved?.();
      void refresh();
    },
  });

  const resendMutation = useMutation({
    mutationFn: (user: ConnectorPortalUser) =>
      apiFetch<ConnectorPortalUser>(`/v1/connectors/${connector.id}/users/${user.id}/invitation/resend`, {
        method: 'POST',
      }),
    onSuccess: (user) => {
      setNotice(`A new invitation e-mail for ${user.email} is queued.`);
      void refresh();
    },
  });

  const actionMutation = useMutation({
    mutationFn: ({ kind, user, why }: { kind: ActionKind; user: ConnectorPortalUser; why: string }) =>
      kind === 'REVOKE'
        ? apiFetch<ConnectorPortalUser>(
            `/v1/connectors/${connector.id}/users/${user.id}/invitation/revocation`,
            {
              method: 'POST',
              body: JSON.stringify({ reason: why }),
            },
          )
        : apiFetch<ConnectorPortalUser>(`/v1/connectors/${connector.id}/users/${user.id}/access`, {
            method: 'POST',
            body: JSON.stringify({ action: kind, reason: why }),
          }),
    onSuccess: () => {
      setPending(null);
      setReason('');
      void refresh();
    },
  });

  const openInvite = () => {
    setInvite({ displayName: '', email: '', mobileE164: '' });
    setInviteKey(newIdempotencyKey('cpu'));
    setTouched(false);
    inviteMutation.reset();
    setInviteOpen(true);
  };
  const errors = invitationErrors(invite);
  const users = usersQuery.data ?? [];

  if (!canManage) {
    return (
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="h6" fontWeight={700} gutterBottom>
            Portal Access & Users
          </Typography>
          <Alert severity="info">Portal users are managed by connector managers.</Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>
              Portal Access & Users
            </Typography>
            <Typography variant="caption" color="text.secondary">
              External people who sign in to the connector portal for {connector.legalName}. They are not
              staff and hold no role; the relationship manager is an internal staff member, shown on the
              profile.
            </Typography>
          </Box>
          <Button variant="contained" onClick={openInvite} disabled={!inviteAllowed} data-testid="cpu.invite">
            Invite Portal User
          </Button>
        </Stack>

        {!inviteAllowed && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Portal users cannot be invited while the connector is {connector.status.toLowerCase()}.
          </Alert>
        )}
        {connector.status !== 'ACTIVE' && inviteAllowed && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Invited people can set a password now, but the portal opens for them only once the connector is
            active.
          </Alert>
        )}
        {failedInvite && (
          <Alert
            severity="warning"
            sx={{ mb: 2 }}
            action={
              <Button
                color="inherit"
                size="small"
                disabled={inviteMutation.isPending}
                onClick={() =>
                  inviteMutation.mutate({ input: failedInvite.input, key: failedInvite.idempotencyKey })
                }
                data-testid="cpu.retry"
              >
                Retry invitation
              </Button>
            }
          >
            The connector was saved, but the invitation for {failedInvite.input.email} was not created:{' '}
            {failedInvite.message}
          </Alert>
        )}
        {notice && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        )}
        {(resendMutation.isError || (inviteMutation.isError && !inviteOpen)) && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {errorText(resendMutation.error ?? inviteMutation.error)}
          </Alert>
        )}

        {usersQuery.isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : usersQuery.isError ? (
          <Alert severity="error">{errorText(usersQuery.error)}</Alert>
        ) : users.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ py: 3, textAlign: 'center' }}
            data-testid="cpu.empty"
          >
            No portal users yet. A connector can operate without portal access.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small" data-testid="cpu.table">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Linked connector</TableCell>
                  <TableCell>Account status</TableCell>
                  <TableCell>Invitation</TableCell>
                  <TableCell>Invitation sent</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>{user.displayName}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>{connector.legalName}</TableCell>
                    <TableCell>
                      <Chip size="small" label={user.status} color={STATUS_COLOR[user.status] ?? 'default'} />
                    </TableCell>
                    <TableCell>
                      {invitationLabel(user)}
                      {user.invitation.lastFailure ? ` (${user.invitation.lastFailure})` : ''}
                    </TableCell>
                    <TableCell>
                      {user.invitation.sentAt ? new Date(user.invitation.sentAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        {user.status === 'INVITED' && (
                          <>
                            <Button
                              size="small"
                              disabled={resendMutation.isPending}
                              onClick={() => resendMutation.mutate(user)}
                            >
                              Resend invitation
                            </Button>
                            <Button
                              size="small"
                              color="error"
                              onClick={() => setPending({ kind: 'REVOKE', user })}
                            >
                              Withdraw
                            </Button>
                          </>
                        )}
                        {user.status === 'ACTIVE' && (
                          <Button
                            size="small"
                            color="warning"
                            onClick={() => setPending({ kind: 'SUSPEND', user })}
                          >
                            Suspend
                          </Button>
                        )}
                        {user.status === 'SUSPENDED' && (
                          <Button
                            size="small"
                            disabled={connector.status !== 'ACTIVE'}
                            onClick={() => setPending({ kind: 'REACTIVATE', user })}
                          >
                            Reactivate
                          </Button>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>

      {/* Invite dialog: no password is ever asked for here; the invitee sets one from the e-mail. */}
      <Dialog
        open={inviteOpen}
        onClose={() => !inviteMutation.isPending && setInviteOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Invite Portal User</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              size="small"
              label="Full name"
              required
              value={invite.displayName}
              onChange={(e) => setInvite({ ...invite, displayName: e.target.value })}
              error={touched && !!errors.displayName}
              helperText={touched ? errors.displayName : undefined}
            />
            <TextField
              size="small"
              label="Email"
              type="email"
              required
              value={invite.email}
              onChange={(e) => setInvite({ ...invite, email: e.target.value })}
              error={touched && !!errors.email}
              helperText={touched ? errors.email : 'The invitation e-mail is sent here.'}
            />
            <TextField
              size="small"
              label="Mobile (optional)"
              value={invite.mobileE164 ?? ''}
              onChange={(e) => setInvite({ ...invite, mobileE164: e.target.value })}
              error={touched && !!errors.mobileE164}
              helperText={touched ? errors.mobileE164 : undefined}
            />
            {inviteMutation.isError && <Alert severity="error">{errorText(inviteMutation.error)}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInviteOpen(false)} disabled={inviteMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={inviteMutation.isPending}
            onClick={() => {
              setTouched(true);
              if (Object.keys(errors).length === 0) inviteMutation.mutate({ input: invite, key: inviteKey });
            }}
            data-testid="cpu.invite.submit"
          >
            {inviteMutation.isPending ? 'Sending…' : 'Send invitation'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirmation for suspend, reactivate and withdraw: each needs a reason, which goes into the audit trail. */}
      <Dialog
        open={!!pending}
        onClose={() => !actionMutation.isPending && setPending(null)}
        maxWidth="xs"
        fullWidth
      >
        {pending && (
          <>
            <DialogTitle>{ACTION_TEXT[pending.kind].title}</DialogTitle>
            <DialogContent>
              <Typography variant="body2" sx={{ mb: 2 }}>
                {pending.user.displayName} ({pending.user.email}). {ACTION_TEXT[pending.kind].body}
              </Typography>
              <TextField
                size="small"
                fullWidth
                label="Reason"
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                helperText="At least 5 characters. Recorded in the audit trail."
              />
              {actionMutation.isError && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {errorText(actionMutation.error)}
                </Alert>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPending(null)} disabled={actionMutation.isPending}>
                Cancel
              </Button>
              <Button
                variant="contained"
                color={pending.kind === 'REACTIVATE' ? 'primary' : 'error'}
                disabled={actionMutation.isPending || reason.trim().length < 5}
                onClick={() =>
                  actionMutation.mutate({ kind: pending.kind, user: pending.user, why: reason.trim() })
                }
              >
                {ACTION_TEXT[pending.kind].confirm}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Card>
  );
}
