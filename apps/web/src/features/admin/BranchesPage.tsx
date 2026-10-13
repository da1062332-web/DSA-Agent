// /admin/branches (owner: Dev 1) — list, create, edit, deactivate (config.manage).
import {
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import { hasPermission, useMe } from '../../api/useMe';
import { useCommand, useList, type Branch } from './api';
import { ConfirmDialog, ErrorAlert, LoadMore, Loading, PageHeader, StatusChip } from './components';

export function BranchesPage() {
  const me = useMe();
  const canEdit = hasPermission(me.data, 'config.manage');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const list = useList<Branch>('/v1/branches', { q: search || undefined, status: status || undefined });
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  const [deactivating, setDeactivating] = useState<Branch | null>(null);

  const deactivate = useCommand<undefined, Branch>(
    () => ({
      path: `/v1/branches/${deactivating!.id}/deactivation`,
      method: 'POST',
      version: deactivating!.version,
    }),
    [['/v1/branches'], ['/v1/work-queues']],
  );

  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <>
      <PageHeader
        title="Branches"
        subtitle="Branches own leads, applications and their intake queues."
        action={
          canEdit && (
            <Button variant="contained" onClick={() => setEditing('new')} data-testid="admin.branches.new">
              New branch
            </Button>
          )
        }
      />
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <TextField
          size="small"
          label="Search code or name"
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
                  <TableCell>Code</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>PIN code</TableCell>
                  <TableCell>Time zone</TableCell>
                  <TableCell>Status</TableCell>
                  {canEdit && <TableCell align="right">Actions</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      No branches match.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((b) => (
                  <TableRow key={b.id} hover>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{b.code}</TableCell>
                    <TableCell>{b.name}</TableCell>
                    <TableCell>{b.pincode ?? '—'}</TableCell>
                    <TableCell>{b.timezone}</TableCell>
                    <TableCell>
                      <StatusChip active={b.status === 'ACTIVE'} />
                    </TableCell>
                    {canEdit && (
                      <TableCell align="right">
                        <Button size="small" onClick={() => setEditing(b)} disabled={b.status !== 'ACTIVE'}>
                          Edit
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          onClick={() => setDeactivating(b)}
                          disabled={b.status !== 'ACTIVE'}
                        >
                          Deactivate
                        </Button>
                      </TableCell>
                    )}
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

      {editing && (
        <BranchDialog branch={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      <ConfirmDialog
        open={!!deactivating}
        title={`Deactivate ${deactivating?.code ?? ''}?`}
        text="The branch and its work queues stop receiving new work. Users whose primary branch it is must be moved first."
        confirmLabel="Deactivate"
        busy={deactivate.isPending}
        error={deactivate.error}
        onClose={() => {
          setDeactivating(null);
          deactivate.reset();
        }}
        onConfirm={() => deactivate.mutate(undefined, { onSuccess: () => setDeactivating(null) })}
      />
    </>
  );
}

function BranchDialog({ branch, onClose }: { branch: Branch | null; onClose: () => void }) {
  const [code, setCode] = useState(branch?.code ?? '');
  const [name, setName] = useState(branch?.name ?? '');
  const [pincode, setPincode] = useState(branch?.pincode ?? '');
  const [timezone, setTimezone] = useState(branch?.timezone ?? 'Asia/Kolkata');

  const create = useCommand<object, Branch>(
    () => ({ path: '/v1/branches', method: 'POST' }),
    [['/v1/branches']],
  );
  const update = useCommand<object, Branch>(
    () => ({ path: `/v1/branches/${branch?.id}`, method: 'PATCH', version: branch?.version }),
    [['/v1/branches']],
  );
  const cmd = branch ? update : create;

  const submit = () => {
    const body = branch
      ? { name: name.trim(), pincode: pincode || null, timezone }
      : { code: code.trim().toUpperCase(), name: name.trim(), pincode: pincode || null, timezone };
    cmd.mutate(body, { onSuccess: onClose });
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{branch ? `Edit ${branch.code}` : 'New branch'}</DialogTitle>
      <DialogContent>
        <ErrorAlert error={cmd.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            disabled={!!branch}
            required
            helperText="2–20 characters: A–Z, 0–9, _ or -. Cannot be changed later."
            inputProps={{ 'data-testid': 'admin.branch.code' }}
          />
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            inputProps={{ 'data-testid': 'admin.branch.name' }}
          />
          <TextField
            label="PIN code"
            value={pincode}
            onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            helperText="Optional, 6 digits"
          />
          <TextField
            label="Time zone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            helperText="IANA name, e.g. Asia/Kolkata"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={cmd.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={cmd.isPending || !name.trim() || (!branch && !code.trim())}
          data-testid="admin.branch.save"
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
