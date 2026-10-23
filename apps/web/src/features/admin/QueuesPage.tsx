// /admin/queues and /admin/queues/:id (owner: Dev 1) — work queues and their members (config.manage).
// Members with "Can pick" take turns in round-robin assignment; "Can assign" may hand records to others.
import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Link,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { hasPermission, useMe } from '../../api/useMe';
import {
  QUEUE_KINDS,
  RECORD_TYPES,
  useCommand,
  useList,
  useLookup,
  useResource,
  type Branch,
  type QueueKind,
  type RecordType,
  type Team,
  type WorkQueue,
  type WorkQueueDetail,
} from './api';
import {
  BranchSelect,
  ErrorAlert,
  LoadMore,
  Loading,
  PageHeader,
  StatusChip,
  UserPicker,
  formatDate,
} from './components';
import { DataTable, FilterToolbar, type ColumnDef } from '../../ui';

function RecordTypePicker({
  value,
  onChange,
  disabled,
}: {
  value: RecordType[];
  onChange: (v: RecordType[]) => void;
  disabled?: boolean;
}) {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Typography variant="body2" color="text.secondary">
        Record types:
      </Typography>
      {RECORD_TYPES.map((t) => (
        <FormControlLabel
          key={t}
          label={t}
          disabled={disabled}
          control={
            <Checkbox
              size="small"
              checked={value.includes(t)}
              onChange={(e) => onChange(e.target.checked ? [...value, t] : value.filter((v) => v !== t))}
            />
          }
        />
      ))}
    </Stack>
  );
}

export function QueuesPage() {
  const me = useMe();
  const canEdit = hasPermission(me.data, 'config.manage');
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState<string | null>(null);
  const list = useList<WorkQueue>('/v1/work-queues', {
    q: search || undefined,
    branchId: branchId ?? undefined,
  });
  const branches = useLookup<Branch>('/v1/branches');
  const branchName = new Map((branches.data ?? []).map((b) => [b.id, b.code]));
  const [creating, setCreating] = useState(false);
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];

  const queueColumns: ColumnDef<WorkQueue>[] = [
    {
      id: 'code',
      header: 'Code',
      accessor: (q) => (
        <Link component={RouterLink} to={`/admin/queues/${q.id}`} sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
          {q.code}
        </Link>
      ),
    },
    {
      id: 'name',
      header: 'Name',
      accessor: (q) => q.name,
    },
    {
      id: 'kind',
      header: 'Kind',
      accessor: (q) => q.kind,
    },
    {
      id: 'branch',
      header: 'Branch',
      accessor: (q) => (q.branchId ? (branchName.get(q.branchId) ?? q.branchId) : '—'),
    },
    {
      id: 'recordTypes',
      header: 'Record types',
      accessor: (q) => q.recordTypes.join(', '),
    },
    {
      id: 'members',
      header: 'Members',
      align: 'right',
      accessor: (q) => q.memberCount,
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (q) => <StatusChip active={q.active} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Work queues"
        subtitle="Intake, unassigned and team queues route new work to people."
        action={
          canEdit && (
            <Button variant="contained" onClick={() => setCreating(true)} data-testid="admin.queues.new">
              New queue
            </Button>
          )
        }
      />
      <FilterToolbar
        searchPlaceholder="Search code or name..."
        searchValue={search}
        onSearchChange={setSearch}
        filters={
          <Box sx={{ minWidth: 200 }}>
            <BranchSelect value={branchId} onChange={setBranchId} allowNone label="Branch" />
          </Box>
        }
      />
      <ErrorAlert error={list.error} />
      <DataTable<WorkQueue>
        columns={queueColumns}
        data={rows}
        loading={list.isPending}
        emptyTitle="No queues match."
      />
      <LoadMore
        hasNext={!!list.hasNextPage}
        loading={list.isFetchingNextPage}
        onClick={() => void list.fetchNextPage()}
      />
      {creating && <CreateQueueDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateQueueDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const teams = useLookup<Team>('/v1/teams', { status: 'ACTIVE' });
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<QueueKind>('INTAKE');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [recordTypes, setRecordTypes] = useState<RecordType[]>(['LEAD']);
  const create = useCommand<object, WorkQueueDetail>(
    () => ({ path: '/v1/work-queues', method: 'POST' }),
    [['/v1/work-queues']],
  );
  const needsBranch = kind === 'INTAKE' || kind === 'UNASSIGNED';
  const valid =
    code.trim() &&
    name.trim() &&
    recordTypes.length &&
    (!needsBranch || branchId) &&
    (kind !== 'TEAM' || teamId);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New work queue</DialogTitle>
      <DialogContent>
        <ErrorAlert error={create.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
            helperText="2–40 characters: A–Z, 0–9, _ or -"
            inputProps={{ 'data-testid': 'admin.queue.code' }}
          />
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <TextField select label="Kind" value={kind} onChange={(e) => setKind(e.target.value as QueueKind)}>
            {QUEUE_KINDS.map((k) => (
              <MenuItem key={k} value={k}>
                {k}
              </MenuItem>
            ))}
          </TextField>
          <BranchSelect
            value={branchId}
            onChange={setBranchId}
            allowNone={!needsBranch}
            required={needsBranch}
          />
          <TextField
            select
            label="Team"
            value={teamId ?? ''}
            onChange={(e) => setTeamId(e.target.value || null)}
            required={kind === 'TEAM'}
          >
            <MenuItem value="">
              <em>None</em>
            </MenuItem>
            {(teams.data ?? []).map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.name}
              </MenuItem>
            ))}
          </TextField>
          <RecordTypePicker value={recordTypes} onChange={setRecordTypes} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={create.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={create.isPending || !valid}
          onClick={() =>
            create.mutate(
              { code: code.trim(), name: name.trim(), kind, branchId, teamId, recordTypes },
              { onSuccess: (q) => navigate(`/admin/queues/${q.id}`) },
            )
          }
          data-testid="admin.queue.save"
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface MemberDraft {
  userId: string;
  displayName: string;
  canPick: boolean;
  canAssign: boolean;
}

export function QueueDetailPage() {
  const { id } = useParams();
  const me = useMe();
  const canEdit = hasPermission(me.data, 'config.manage');
  // Members: user.manage (API-ORG-014); a branch manager only for queues of their branch.
  const canEditMembers = hasPermission(me.data, 'user.manage');
  const queue = useResource<WorkQueueDetail>(`/v1/work-queues/${id}`);
  const [name, setName] = useState('');
  const [recordTypes, setRecordTypes] = useState<RecordType[]>([]);
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    if (!queue.data) return;
    setName(queue.data.name);
    setRecordTypes(queue.data.recordTypes);
    setMembers(
      queue.data.members.map(({ userId, displayName, canPick, canAssign }) => ({
        userId,
        displayName,
        canPick,
        canAssign,
      })),
    );
  }, [queue.data]);

  const invalidate = [['/v1/work-queues'], [`/v1/work-queues/${id}`]];
  const patch = useCommand<object, WorkQueueDetail>(
    () => ({ path: `/v1/work-queues/${id}`, method: 'PATCH', version: queue.data?.version }),
    invalidate,
  );
  const saveMembers = useCommand<object, WorkQueueDetail>(
    () => ({ path: `/v1/work-queues/${id}/members`, method: 'PUT', version: queue.data?.version }),
    invalidate,
  );

  if (queue.isPending) return <Loading />;
  if (!queue.data) return <ErrorAlert error={queue.error} />;
  const q = queue.data;
  const detailsDirty =
    name.trim() !== q.name || recordTypes.slice().sort().join() !== q.recordTypes.slice().sort().join();
  const key = (m: { userId: string; canPick: boolean; canAssign: boolean }) =>
    `${m.userId}:${m.canPick}:${m.canAssign}`;
  const membersDirty = members.map(key).sort().join() !== q.members.map(key).sort().join();

  return (
    <>
      <PageHeader
        title={`${q.code} — ${q.name}`}
        subtitle={`${q.kind} queue · version ${q.version} · created ${formatDate(q.createdAt)}`}
        action={<StatusChip active={q.active} />}
      />
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Details
          </Typography>
          <ErrorAlert error={patch.error} />
          <Stack spacing={2} sx={{ maxWidth: 560 }}>
            <TextField
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit}
            />
            <RecordTypePicker value={recordTypes} onChange={setRecordTypes} disabled={!canEdit} />
            {canEdit && (
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  disabled={!detailsDirty || !recordTypes.length || patch.isPending}
                  onClick={() => patch.mutate({ name: name.trim(), recordTypes })}
                >
                  Save details
                </Button>
                <Button
                  color={q.active ? 'error' : 'primary'}
                  disabled={patch.isPending}
                  onClick={() => patch.mutate({ active: !q.active })}
                >
                  {q.active ? 'Deactivate queue' : 'Reactivate queue'}
                </Button>
              </Stack>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Members ({q.memberCount})
          </Typography>
          <ErrorAlert error={saveMembers.error} />
          <DataTable<(typeof members)[number]>
            dataTestId="queues.table.members"
            data={members}
            keyExtractor={(m) => m.userId}
            emptyMessage="No members."
            columns={[
              { id: 'user', header: 'User', render: (m) => m.displayName },
              ...(['canPick', 'canAssign'] as const).map((flag) => ({
                id: flag,
                header: flag === 'canPick' ? 'Can pick' : 'Can assign',
                align: 'center' as const,
                render: (m: (typeof members)[number]) => (
                  <Switch
                    size="small"
                    checked={m[flag]}
                    disabled={!canEditMembers}
                    onChange={(e) =>
                      setMembers((all) =>
                        all.map((x) => (x.userId === m.userId ? { ...x, [flag]: e.target.checked } : x)),
                      )
                    }
                  />
                ),
              })),
              ...(canEditMembers
                ? [
                    {
                      id: 'remove',
                      header: '',
                      align: 'right' as const,
                      render: (m: (typeof members)[number]) => (
                        <IconButton
                          size="small"
                          aria-label={`Remove ${m.displayName}`}
                          onClick={() => setMembers((all) => all.filter((x) => x.userId !== m.userId))}
                        >
                          ✕
                        </IconButton>
                      ),
                    },
                  ]
                : []),
            ]}
          />
          {canEditMembers && (
            <Stack spacing={2} sx={{ mt: 2 }}>
              <AddMember
                exclude={members.map((m) => m.userId)}
                value={adding}
                onChange={setAdding}
                onAdd={(u) => {
                  setMembers((all) => [
                    ...all,
                    { userId: u.id, displayName: u.displayName, canPick: true, canAssign: false },
                  ]);
                  setAdding(null);
                }}
              />
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  disabled={!membersDirty || saveMembers.isPending}
                  onClick={() =>
                    saveMembers.mutate({
                      members: members.map(({ userId, canPick, canAssign }) => ({
                        userId,
                        canPick,
                        canAssign,
                      })),
                    })
                  }
                >
                  Save members
                </Button>
                <Button
                  disabled={!membersDirty || saveMembers.isPending}
                  onClick={() =>
                    setMembers(
                      q.members.map(({ userId, displayName, canPick, canAssign }) => ({
                        userId,
                        displayName,
                        canPick,
                        canAssign,
                      })),
                    )
                  }
                >
                  Discard
                </Button>
              </Stack>
            </Stack>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function AddMember(props: {
  exclude: string[];
  value: string | null;
  onChange: (id: string | null) => void;
  onAdd: (user: { id: string; displayName: string }) => void;
}) {
  const users = useLookup<{ id: string; displayName: string }>('/v1/users', { status: 'ACTIVE' });
  const user = (users.data ?? []).find((u) => u.id === props.value);
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <div style={{ flex: 1 }}>
        <UserPicker
          multiple={false}
          value={props.value}
          onChange={props.onChange}
          label="Add member"
          exclude={props.exclude}
        />
      </div>
      <Button variant="outlined" disabled={!user} onClick={() => user && props.onAdd(user)}>
        Add
      </Button>
    </Stack>
  );
}
