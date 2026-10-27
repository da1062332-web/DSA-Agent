// /admin/branches (owner: Dev 1) — list, create, edit, deactivate (config.manage).
import {
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
import { hasPermission, useMe } from '../../api/useMe';
import { useCommand, useList, type Branch } from './api';
import { ConfirmDialog, ErrorAlert, LoadMore, PageHeader, StatusChip } from './components';
import { DataTable, FilterToolbar, type ColumnDef } from '../../ui';
import { NotSet } from '../../ui/NotSet';

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

  const branchColumns: ColumnDef<Branch>[] = [
    {
      id: 'code',
      header: 'Code',
      accessor: (b) => b.code,
    },
    {
      id: 'name',
      header: 'Name',
      accessor: (b) => b.name,
    },
    {
      id: 'pincode',
      header: 'PIN code',
      accessor: (b) => b.pincode ?? <NotSet />,
    },
    {
      id: 'timezone',
      header: 'Time zone',
      accessor: (b) => b.timezone,
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (b) => <StatusChip active={b.status === 'ACTIVE'} />,
    },
    ...(canEdit
      ? [
          {
            id: 'actions',
            header: 'Actions',
            align: 'right' as const,
            accessor: (b: Branch) => (
              <Stack direction="row" spacing={1} justifyContent="flex-end">
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
              </Stack>
            ),
          },
        ]
      : []),
  ];

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
      <FilterToolbar
        searchPlaceholder="Search code or name..."
        searchValue={search}
        onSearchChange={setSearch}
        filters={
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Status</InputLabel>
            <Select
              value={status}
              label="Status"
              onChange={(e) => setStatus(e.target.value)}
            >
              <MenuItem value="">All</MenuItem>
              <MenuItem value="ACTIVE">Active</MenuItem>
              <MenuItem value="INACTIVE">Inactive</MenuItem>
            </Select>
          </FormControl>
        }
      />
      <ErrorAlert error={list.error} />
      <DataTable<Branch>
        columns={branchColumns}
        data={rows}
        loading={list.isPending}
        emptyTitle="No branches match."
      />
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
