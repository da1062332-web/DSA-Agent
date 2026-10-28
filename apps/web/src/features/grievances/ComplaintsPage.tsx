// /complaints (owner: Dev 3; DSA Notion MODULE 13, SUB-GRV.01 and .02). The complaint queue for handlers (complaint.manage)
// and the intake form for anyone with complaint.create. Complaints are never deleted.
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material';
import { useState } from 'react';
import { ApiError } from '../../api/client';
import { hasPermission, useMe } from '../../api/useMe';
import { useCommand, useList } from '../admin/api';
import { ErrorAlert, LoadMore, PageHeader, StatusChip, formatDate } from '../admin/components';
import { DataTable, FilterToolbar, StatusBadge, type ColumnDef } from '../../ui';
import {
  CATEGORY_LABELS,
  CHANNEL_LABELS,
  COMPLAINT_CATEGORIES,
  COMPLAINT_CHANNELS,
  containsSensitiveNumber,
  isValidDescription,
  type ComplaintStatus,
} from './rules';
import { ApplicationSelect, LeadSelect } from '../../shell/selectors';
import { ApplicationName, LeadName } from '../../shell/display';
import { NotSet } from '../../ui/NotSet';
import { RecordLink } from '../../ui/RecordLink';

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
    canManage,
  );
  const [creating, setCreating] = useState(false);
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const refused = list.error instanceof ApiError && list.error.httpStatus === 403;
  const denied = (!canManage && !canCreate) || refused;

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
      {denied && (
        <Alert severity="warning" sx={{ mb: 2 }} data-testid="complaints.noAccess">
          You don't have access to complaints. Ask your administrator to grant you the complaint permissions.
        </Alert>
      )}
      {!denied && !canManage && canCreate && (
        <Alert severity="info" sx={{ mb: 2 }}>
          You can record complaints. The queue and handling need the complaint handling permission.
        </Alert>
      )}
      {canManage && (
        <>
          <FilterToolbar
            filters={
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <FormControl size="small" sx={{ minWidth: 160 }}>
                  <InputLabel>Status</InputLabel>
                  <Select
                    value={status}
                    label="Status"
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <MenuItem value="">All</MenuItem>
                    {(Object.keys(STATUS_LABELS) as ComplaintStatus[]).map((s) => (
                      <MenuItem key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel>Category</InputLabel>
                  <Select
                    value={category}
                    label="Category"
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <MenuItem value="">All categories</MenuItem>
                    {COMPLAINT_CATEGORIES.map((c) => (
                      <MenuItem key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
            }
          />
          {!refused && <ErrorAlert error={list.error} />}
          <DataTable<Complaint>
            columns={[
              {
                id: 'reference',
                header: 'Reference',
                accessor: (c) => (
                  <RecordLink
                    to={`/complaints/${c.id}`}
                    data-testid="complaints.open"
                    sx={{ fontWeight: 600, fontFamily: 'monospace' }}
                  >
                    {c.ackRef}
                  </RecordLink>
                ),
              },
              {
                id: 'subject',
                header: 'Subject',
                accessor: (c) =>
                  c.complainantType === 'APPLICATION' ? (
                    <ApplicationName id={c.complainantId} linkToApp />
                  ) : (
                    <LeadName id={c.complainantId} linkToLead />
                  ),
              },
              {
                id: 'category',
                header: 'Category',
                accessor: (c) => CATEGORY_LABELS[c.category],
              },
              {
                id: 'channel',
                header: 'Channel',
                accessor: (c) => CHANNEL_LABELS[c.channel],
              },
              {
                id: 'due',
                header: 'Due',
                accessor: (c) => (c.dueAt ? formatDate(c.dueAt) : <NotSet />),
              },
              {
                id: 'status',
                header: 'Status',
                accessor: (c) => <StatusBadge status={c.status} />,
              },
            ]}
            data={rows}
            loading={list.isPending}
            emptyTitle="No complaints match."
          />
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
  const [complainantType, setComplainantType] = useState<'APPLICATION' | 'LEAD'>('APPLICATION');
  const [complainantId, setComplainantId] = useState('');
  const [channel, setChannel] = useState<Complaint['channel']>('PHONE');
  const [category, setCategory] = useState<Complaint['category']>('SERVICE');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [ack, setAck] = useState<string | null>(null);

  const descriptionError =
    description === ''
      ? null
      : description.trim().length < 10
        ? 'Description must be at least 10 characters.'
        : description.trim().length > 2000
          ? 'Description must not exceed 2000 characters.'
          : containsSensitiveNumber(description)
            ? 'Description must not contain PAN, Aadhaar or account numbers.'
            : null;
  const create = useCommand<object, Complaint>(
    () => ({ path: '/v1/complaints', method: 'POST' }),
    [['/v1/complaints']],
  );

  const submit = () =>
    create.mutate(
      {
        complainantType,
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
                select
                label="Complainant Type"
                value={complainantType}
                onChange={(e) => {
                  setComplainantType(e.target.value as 'APPLICATION' | 'LEAD');
                  setComplainantId('');
                }}
              >
                <MenuItem value="APPLICATION">Loan Application</MenuItem>
                <MenuItem value="LEAD">Lead</MenuItem>
              </TextField>
              {complainantType === 'APPLICATION' ? (
                <ApplicationSelect
                  label="Loan Application"
                  value={complainantId || null}
                  onChange={(id) => setComplainantId(id ?? '')}
                  required
                  fullWidth
                  data-testid="complaints.complainant"
                />
              ) : (
                <LeadSelect
                  label="Lead"
                  value={complainantId || null}
                  onChange={(id) => setComplainantId(id ?? '')}
                  required
                  fullWidth
                  data-testid="complaints.complainant"
                />
              )}
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
                error={Boolean(descriptionError)}
                helperText={descriptionError || '10 to 2000 characters. Do not write PAN, Aadhaar or account numbers.'}
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
