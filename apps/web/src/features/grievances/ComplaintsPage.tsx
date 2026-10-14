// /complaints (owner: Dev 3; DSA Notion MODULE 13, SUB-GRV.01 and .02). The complaint queue for handlers (complaint.manage)
// and the intake form for anyone with complaint.create. Complaints are never deleted.
import {
  Alert,
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
} from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { hasPermission, useMe } from '../../api/useMe';
import { useCommand, useList } from '../admin/api';
import { ErrorAlert, LoadMore, Loading, PageHeader, StatusChip, formatDate } from '../admin/components';
import {
  CATEGORY_LABELS,
  CHANNEL_LABELS,
  COMPLAINT_CATEGORIES,
  COMPLAINT_CHANNELS,
  isValidDescription,
  type ComplaintStatus,
} from './rules';

export interface Complaint {
  id: string;
  complainantType: 'LEAD' | 'APPLICATION';
  complainantId: string;
  channel: (typeof COMPLAINT_CHANNELS)[number];
  category: (typeof COMPLAINT_CATEGORIES)[number];
  description: string;
  status: ComplaintStatus;
  ownerUserId: string | null;
  dueAt: string | null;
  ackRef: string;
  lenderReferral: Record<string, unknown>;
  resolution: string | null;
  resolvedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const STATUS_LABELS: Record<ComplaintStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
};

export function ComplaintsPage() {
  const me = useMe();
  const canManage = hasPermission(me.data, 'complaint.manage');
  const canCreate = hasPermission(me.data, 'complaint.create');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const list = useList<Complaint>(
    '/v1/complaints',
    { status: status || undefined, category: category || undefined },
    50,
  );
  const [creating, setCreating] = useState(false);
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <>
      <PageHeader
        title="Complaints"
        subtitle="Customer complaints about a lead or an application. Each one gets an acknowledgement reference."
        action={
          canCreate && (
            <Button variant="contained" onClick={() => setCreating(true)} data-testid="complaints.new">
              Record complaint
            </Button>
          )
        }
      />
      {!canManage && !canCreate && (
        <Alert severity="warning" sx={{ mb: 2 }} data-testid="complaints.noAccess">
          You need the complaint permissions to view or record complaints. Ask your administrator.
        </Alert>
      )}
      {!canManage && canCreate && (
        <Alert severity="info" sx={{ mb: 2 }}>
          You can record complaints. The queue and handling need the complaint handling permission.
        </Alert>
      )}
      {canManage && (
        <>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
            <TextField
              size="small"
              select
              label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="">All</MenuItem>
              {(Object.keys(STATUS_LABELS) as ComplaintStatus[]).map((s) => (
                <MenuItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              select
              label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="">All categories</MenuItem>
              {COMPLAINT_CATEGORIES.map((c) => (
                <MenuItem key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <ErrorAlert error={list.error} />
          {list.isPending ? (
            <Loading />
          ) : (
            <Card>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Reference</TableCell>
                      <TableCell>Category</TableCell>
                      <TableCell>Channel</TableCell>
                      <TableCell>Due</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                          No complaints match.
                        </TableCell>
                      </TableRow>
                    )}
                    {rows.map((c) => (
                      <TableRow key={c.id} hover>
                        <TableCell>
                          <Link
                            component={RouterLink}
                            to={`/complaints/${c.id}`}
                            data-testid="complaints.open"
                          >
                            {c.ackRef}
                          </Link>
                        </TableCell>
                        <TableCell>{CATEGORY_LABELS[c.category]}</TableCell>
                        <TableCell>{CHANNEL_LABELS[c.channel]}</TableCell>
                        <TableCell>{c.dueAt ? formatDate(c.dueAt) : '—'}</TableCell>
                        <TableCell>
                          <StatusChip active={c.status !== 'RESOLVED'} label={STATUS_LABELS[c.status]} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Card>
          )}
          <LoadMore
            hasNext={!!list.hasNextPage}
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          />
        </>
      )}
      {creating && <RecordComplaintDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function RecordComplaintDialog({ onClose }: { onClose: () => void }) {
  const [complainantId, setComplainantId] = useState('');
  const [channel, setChannel] = useState<Complaint['channel']>('PHONE');
  const [category, setCategory] = useState<Complaint['category']>('SERVICE');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [ack, setAck] = useState<string | null>(null);
  const create = useCommand<object, Complaint>(
    () => ({ path: '/v1/complaints', method: 'POST' }),
    [['/v1/complaints']],
  );

  const submit = () =>
    create.mutate(
      {
        complainantType: 'APPLICATION',
        complainantId: complainantId.trim(),
        channel,
        category,
        description: description.trim(),
        dueAt: dueDate ? `${dueDate}T00:00:00Z` : null,
      },
      { onSuccess: (c) => setAck(c.ackRef) },
    );

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Record complaint</DialogTitle>
      <DialogContent>
        {ack ? (
          <Alert severity="success" sx={{ mt: 1 }} data-testid="complaints.ack">
            Recorded. Give the customer this acknowledgement reference: <strong>{ack}</strong>
          </Alert>
        ) : (
          <>
            <ErrorAlert error={create.error} />
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                label="Application reference"
                value={complainantId}
                onChange={(e) => setComplainantId(e.target.value)}
                required
                helperText="Complaints about a lead are not supported yet."
                inputProps={{ 'data-testid': 'complaints.complainant' }}
              />
              <TextField
                select
                label="Channel"
                value={channel}
                onChange={(e) => setChannel(e.target.value as Complaint['channel'])}
              >
                {COMPLAINT_CHANNELS.map((c) => (
                  <MenuItem key={c} value={c}>
                    {CHANNEL_LABELS[c]}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Category"
                value={category}
                onChange={(e) => setCategory(e.target.value as Complaint['category'])}
              >
                {COMPLAINT_CATEGORIES.map((c) => (
                  <MenuItem key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="What the customer said"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                multiline
                minRows={3}
                required
                error={description !== '' && !isValidDescription(description)}
                helperText="10 to 2000 characters. Do not write PAN, Aadhaar or account numbers."
                inputProps={{ 'data-testid': 'complaints.description' }}
              />
              <TextField
                label="Due date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
                helperText="Optional until the deadline rules are confirmed."
              />
            </Stack>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{ack ? 'Close' : 'Cancel'}</Button>
        {!ack && (
          <Button
            variant="contained"
            onClick={submit}
            disabled={create.isPending || complainantId.trim().length < 3 || !isValidDescription(description)}
            data-testid="complaints.save"
          >
            Record
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
