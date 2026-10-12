// /admin/teams and /admin/teams/:id (owner: Dev 1) — teams, managers and effective-dated members (user.manage).
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  List,
  ListItem,
  ListItemText,
  MenuItem,
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
import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { hasPermission, useMe } from '../../api/useMe';
import {
  useCommand,
  useList,
  useLookup,
  useResource,
  type Branch,
  type TeamDetail,
  type Team,
  type UserSummary,
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

function useNames() {
  const branches = useLookup<Branch>('/v1/branches');
  const users = useLookup<UserSummary>('/v1/users');
  const branch = new Map((branches.data ?? []).map((b) => [b.id, `${b.code} — ${b.name}`]));
  const user = new Map((users.data ?? []).map((u) => [u.id, u.displayName]));
  return {
    branch: (id: string | null) => (id ? (branch.get(id) ?? id) : '—'),
    user: (id: string | null) => (id ? (user.get(id) ?? id) : '—'),
  };
}

export function TeamsPage() {
  const me = useMe();
  // Branch managers hold user.manage for their own branch only; the API rejects other branches with 403.
  const canEdit = hasPermission(me.data, 'config.manage') || hasPermission(me.data, 'user.manage');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const list = useList<Team>('/v1/teams', { q: search || undefined, status: status || undefined });
  const names = useNames();
  const [creating, setCreating] = useState(false);
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <>
      <PageHeader
        title="Teams"
        subtitle="Team managers see their members’ work (TEAM scope)."
        action={
          canEdit && (
            <Button variant="contained" onClick={() => setCreating(true)} data-testid="admin.teams.new">
              New team
            </Button>
          )
        }
      />
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <TextField
          size="small"
          label="Search name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <TextField
          size="small"
          select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="ACTIVE">Active</MenuItem>
          <MenuItem value="INACTIVE">Inactive</MenuItem>
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
                  <TableCell>Name</TableCell>
                  <TableCell>Branch</TableCell>
                  <TableCell>Manager</TableCell>
                  <TableCell align="right">Members</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      No teams match.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((t) => (
                  <TableRow key={t.id} hover>
                    <TableCell>
                      <Link component={RouterLink} to={`/admin/teams/${t.id}`}>
                        {t.name}
                      </Link>
                    </TableCell>
                    <TableCell>{names.branch(t.branchId)}</TableCell>
                    <TableCell>{names.user(t.managerUserId)}</TableCell>
                    <TableCell align="right">{t.memberCount}</TableCell>
                    <TableCell>
                      <StatusChip active={t.status === 'ACTIVE'} />
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
      {creating && <CreateTeamDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateTeamDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [managerUserId, setManagerUserId] = useState<string | null>(null);
  const create = useCommand<object, TeamDetail>(
    () => ({ path: '/v1/teams', method: 'POST' }),
    [['/v1/teams']],
  );

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New team</DialogTitle>
      <DialogContent>
        <ErrorAlert error={create.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            inputProps={{ 'data-testid': 'admin.team.name' }}
          />
          <BranchSelect
            value={branchId}
            onChange={setBranchId}
            allowNone
            label="Branch (empty = cross-branch)"
          />
          <UserPicker multiple={false} value={managerUserId} onChange={setManagerUserId} label="Manager" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={create.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={create.isPending || !name.trim()}
          onClick={() =>
            create.mutate(
              { name: name.trim(), branchId, managerUserId },
              { onSuccess: (team) => navigate(`/admin/teams/${team.id}`) },
            )
          }
          data-testid="admin.team.save"
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function TeamDetailPage() {
  const { id } = useParams();
  const me = useMe();
  // Branch managers hold user.manage for their own branch only; the API rejects other branches with 403.
  const canEdit = hasPermission(me.data, 'config.manage') || hasPermission(me.data, 'user.manage');
  const team = useResource<TeamDetail>(`/v1/teams/${id}`);

  const [name, setName] = useState('');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [managerUserId, setManagerUserId] = useState<string | null>(null);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  useEffect(() => {
    if (!team.data) return;
    setName(team.data.name);
    setBranchId(team.data.branchId);
    setManagerUserId(team.data.managerUserId);
    setMemberIds(team.data.members.map((m) => m.userId));
  }, [team.data]);

  const invalidate = [['/v1/teams'], [`/v1/teams/${id}`]];
  const patch = useCommand<object, TeamDetail>(
    () => ({ path: `/v1/teams/${id}`, method: 'PATCH', version: team.data?.version }),
    invalidate,
  );
  const members = useCommand<{ userIds: string[] }, TeamDetail>(
    () => ({ path: `/v1/teams/${id}/members`, method: 'PUT', version: team.data?.version }),
    invalidate,
  );

  if (team.isPending) return <Loading />;
  if (!team.data) return <ErrorAlert error={team.error} />;
  const t = team.data;
  const detailsDirty = name.trim() !== t.name || branchId !== t.branchId || managerUserId !== t.managerUserId;
  const current = t.members.map((m) => m.userId);
  const membersDirty = memberIds.length !== current.length || memberIds.some((m) => !current.includes(m));

  return (
    <>
      <PageHeader
        title={t.name}
        subtitle={`Team · version ${t.version} · created ${formatDate(t.createdAt)}`}
        action={<StatusChip active={t.status === 'ACTIVE'} />}
      />
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Details
          </Typography>
          <ErrorAlert error={patch.error} />
          <Stack spacing={2} sx={{ maxWidth: 520 }}>
            <TextField
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit}
            />
            <BranchSelect
              value={branchId}
              onChange={setBranchId}
              allowNone
              label="Branch (empty = cross-branch)"
              disabled={!canEdit}
            />
            <UserPicker
              multiple={false}
              value={managerUserId}
              onChange={setManagerUserId}
              label="Manager"
              disabled={!canEdit}
            />
            {canEdit && (
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  disabled={!detailsDirty || patch.isPending}
                  onClick={() => patch.mutate({ name: name.trim(), branchId, managerUserId })}
                >
                  Save details
                </Button>
                <Button
                  color={t.status === 'ACTIVE' ? 'error' : 'primary'}
                  disabled={patch.isPending}
                  onClick={() => patch.mutate({ status: t.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })}
                >
                  {t.status === 'ACTIVE' ? 'Deactivate team' : 'Reactivate team'}
                </Button>
              </Stack>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Members ({t.memberCount})
          </Typography>
          <ErrorAlert error={members.error} />
          {canEdit ? (
            <Stack spacing={2}>
              <UserPicker multiple value={memberIds} onChange={setMemberIds} label="Members" />
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  disabled={!membersDirty || members.isPending}
                  onClick={() => members.mutate({ userIds: memberIds })}
                >
                  Save members
                </Button>
                <Button disabled={!membersDirty || members.isPending} onClick={() => setMemberIds(current)}>
                  Discard
                </Button>
              </Stack>
            </Stack>
          ) : null}
          <List dense>
            {t.members.length === 0 && <ListItem>No members.</ListItem>}
            {t.members.map((m) => (
              <ListItem key={m.userId}>
                <ListItemText primary={m.displayName} secondary={`Member since ${formatDate(m.since)}`} />
              </ListItem>
            ))}
          </List>
        </CardContent>
      </Card>
    </>
  );
}
