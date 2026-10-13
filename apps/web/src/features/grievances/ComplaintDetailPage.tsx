// /complaints/:id (owner: Dev 3; DSA Notion MODULE 13, SUB-GRV.02). Assign, start work, refer, resolve and reopen. Every
// change sends the version the screen was based on (If-Match), so a stale screen shows the conflict instead of overwriting.
import {
  Alert,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { hasPermission, useMe } from '../../api/useMe';
import { useCommand, useLookup, useResource } from '../admin/api';
import { ErrorAlert, Loading, PageHeader, StatusChip, UserPicker, formatDate } from '../admin/components';
import type { Lender } from '../admin/LendersPage';
import {
  CATEGORY_LABELS,
  CHANNEL_LABELS,
  COMPLAINT_CATEGORIES,
  canReopen,
  canResolve,
  canStartWork,
  isEditable,
  isValidReason,
  isValidReference,
  isValidResolution,
} from './rules';
import type { Complaint } from './ComplaintsPage';

const STATUS_LABELS = { OPEN: 'Open', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved' } as const;

export function ComplaintDetailPage() {
  const { id } = useParams();
  const me = useMe();
  const canManage = hasPermission(me.data, 'complaint.manage');
  const complaint = useResource<Complaint>(id ? `/v1/complaints/${id}` : null);

  if (complaint.isPending) return <Loading />;
  if (!complaint.data) return <ErrorAlert error={complaint.error} />;
  const c = complaint.data;

  return (
    <>
      <PageHeader
        title={c.ackRef}
        subtitle={`${CATEGORY_LABELS[c.category]} · ${CHANNEL_LABELS[c.channel]} · logged ${formatDate(c.createdAt)} · version ${c.version}`}
        action={<StatusChip active={c.status !== 'RESOLVED'} label={STATUS_LABELS[c.status]} />}
      />
      {!isEditable(c.status) && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Resolved. This complaint is read-only until it is reopened.
        </Alert>
      )}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Complaint
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: 2 }}>
            {c.description}
          </Typography>
          <Stack spacing={0.5}>
            <Typography variant="body2">
              <strong>Raised against:</strong> {c.complainantType === 'APPLICATION' ? 'Application' : 'Lead'}{' '}
              {c.complainantId}
            </Typography>
            <Typography variant="body2">
              <strong>Owner:</strong> {c.ownerUserId ?? 'Unassigned'}
            </Typography>
            <Typography variant="body2">
              <strong>Due:</strong> {c.dueAt ? formatDate(c.dueAt) : 'Not set'}
            </Typography>
            <Typography variant="body2">
              <strong>Lender referral:</strong>{' '}
              {c.lenderReferral.lenderId
                ? `${String(c.lenderReferral.lenderId)} · ${String(c.lenderReferral.reference)}`
                : 'None'}
            </Typography>
            {c.resolution && (
              <Typography variant="body2">
                <strong>Resolution{c.resolvedAt ? ` (${formatDate(c.resolvedAt)})` : ''}:</strong>{' '}
                {c.resolution}
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>

      {canManage && isEditable(c.status) && <AssignCard complaint={c} />}
      {canManage && canStartWork(c.status) && <StartWorkCard complaint={c} />}
      {canManage && isEditable(c.status) && <ReferCard complaint={c} />}
      {canManage && canResolve(c.status) && <ResolveCard complaint={c} />}
      {canManage && canReopen(c.status) && <ReopenCard complaint={c} />}
    </>
  );
}

const invalidate = (c: Complaint) => [['/v1/complaints'], [`/v1/complaints/${c.id}`]];

function AssignCard({ complaint }: { complaint: Complaint }) {
  const [owner, setOwner] = useState<string | null>(complaint.ownerUserId);
  const [category, setCategory] = useState<Complaint['category']>(complaint.category);
  const [due, setDue] = useState(complaint.dueAt ? complaint.dueAt.slice(0, 10) : '');
  const save = useCommand<object, Complaint>(
    () => ({ path: `/v1/complaints/${complaint.id}`, method: 'PATCH', version: complaint.version }),
    invalidate(complaint),
  );
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Owner and due date
        </Typography>
        <ErrorAlert error={save.error} />
        <Stack spacing={2} sx={{ maxWidth: 520 }}>
          <UserPicker
            multiple={false}
            label="Owner"
            value={owner}
            onChange={(v) => setOwner(v as string | null)}
          />
          <TextField
            select
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value as Complaint['category'])}
          >
            {COMPLAINT_CATEGORIES.map((cat) => (
              <MenuItem key={cat} value={cat}>
                {CATEGORY_LABELS[cat]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Due date"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <Stack direction="row">
            <Button
              variant="contained"
              disabled={save.isPending}
              onClick={() =>
                save.mutate({
                  ownerUserId: owner,
                  category,
                  dueAt: due ? `${due}T00:00:00Z` : null,
                })
              }
            >
              Save
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

function StartWorkCard({ complaint }: { complaint: Complaint }) {
  const start = useCommand<object, Complaint>(
    () => ({ path: `/v1/complaints/${complaint.id}`, method: 'PATCH', version: complaint.version }),
    invalidate(complaint),
  );
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography variant="h6">Work on it</Typography>
          <Button
            variant="outlined"
            disabled={start.isPending}
            onClick={() => start.mutate({ status: 'IN_PROGRESS' })}
          >
            Start work
          </Button>
        </Stack>
        <ErrorAlert error={start.error} />
      </CardContent>
    </Card>
  );
}

function ReferCard({ complaint }: { complaint: Complaint }) {
  const lenders = useLookup<Lender>('/v1/lenders');
  const [lenderId, setLenderId] = useState('');
  const [reference, setReference] = useState('');
  const refer = useCommand<object, Complaint>(
    () => ({ path: `/v1/complaints/${complaint.id}`, method: 'PATCH', version: complaint.version }),
    invalidate(complaint),
  );
  const clear = useCommand<object, Complaint>(
    () => ({ path: `/v1/complaints/${complaint.id}`, method: 'PATCH', version: complaint.version }),
    invalidate(complaint),
  );
  const hasReferral = !!complaint.lenderReferral.lenderId;
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Refer to lender
        </Typography>
        <ErrorAlert error={refer.error ?? clear.error} />
        <Stack spacing={2} sx={{ maxWidth: 520 }}>
          <TextField select label="Lender" value={lenderId} onChange={(e) => setLenderId(e.target.value)}>
            {(lenders.data ?? []).map((l) => (
              <MenuItem key={l.id} value={l.id}>
                {l.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Lender's reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            error={reference !== '' && !isValidReference(reference)}
            helperText="No PAN, Aadhaar or account numbers."
          />
          <Stack direction="row" spacing={2}>
            <Button
              variant="contained"
              disabled={refer.isPending || !lenderId || !isValidReference(reference)}
              onClick={() => refer.mutate({ lenderReferral: { lenderId, reference: reference.trim() } })}
            >
              Refer
            </Button>
            {hasReferral && (
              <Button
                color="warning"
                disabled={clear.isPending}
                onClick={() => clear.mutate({ lenderReferral: null })}
              >
                Clear referral
              </Button>
            )}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

function ResolveCard({ complaint }: { complaint: Complaint }) {
  const [text, setText] = useState('');
  const resolve = useCommand<{ action: 'RESOLVE'; resolution: string }, Complaint>(
    () => ({ path: `/v1/complaints/${complaint.id}/resolution`, method: 'POST', version: complaint.version }),
    invalidate(complaint),
  );
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Resolve
        </Typography>
        <ErrorAlert error={resolve.error} />
        <Stack spacing={2} sx={{ maxWidth: 620 }}>
          <TextField
            label="Written resolution"
            value={text}
            onChange={(e) => setText(e.target.value)}
            multiline
            minRows={3}
            error={text !== '' && !isValidResolution(text)}
            helperText="10 to 2000 characters. Say what was done for the customer."
          />
          <Stack direction="row">
            <Button
              variant="contained"
              disabled={resolve.isPending || !isValidResolution(text)}
              onClick={() => resolve.mutate({ action: 'RESOLVE', resolution: text.trim() })}
            >
              Resolve complaint
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

function ReopenCard({ complaint }: { complaint: Complaint }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const reopen = useCommand<{ action: 'REOPEN'; reason: string }, Complaint>(
    () => ({ path: `/v1/complaints/${complaint.id}/resolution`, method: 'POST', version: complaint.version }),
    invalidate(complaint),
  );
  const close = () => {
    setOpen(false);
    setReason('');
    reopen.reset();
  };
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography variant="h6">Reopen</Typography>
          <Button variant="outlined" color="warning" onClick={() => setOpen(true)}>
            Reopen complaint
          </Button>
        </Stack>
      </CardContent>
      {open && (
        <Dialog open onClose={close} maxWidth="xs" fullWidth>
          <DialogTitle>Reopen complaint</DialogTitle>
          <DialogContent>
            <ErrorAlert error={reopen.error} />
            <TextField
              autoFocus
              fullWidth
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              error={reason !== '' && !isValidReason(reason)}
              helperText="The previous resolution is cleared. The reason is kept in the audit trail."
              sx={{ mt: 1 }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={close} disabled={reopen.isPending}>
              Cancel
            </Button>
            <Button
              variant="contained"
              color="warning"
              disabled={reopen.isPending || !isValidReason(reason)}
              onClick={() => reopen.mutate({ action: 'REOPEN', reason: reason.trim() }, { onSuccess: close })}
            >
              Reopen
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Card>
  );
}
