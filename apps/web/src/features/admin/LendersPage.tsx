// /admin/lenders (owner: Dev 3; DSA Notion MODULE 14, SUB-LND.01 and .05). List and create lenders. Writes need
// config.manage; the list is visible to any signed-in staff, as the API allows.
import {
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
import { useCommand, useList } from './api';
import { ErrorAlert, LoadMore, Loading, PageHeader, StatusChip } from './components';

export interface Lender {
  id: string;
  name: string;
  lenderType: 'BANK' | 'NBFC' | 'HFC' | 'SFB' | 'OTHER';
  regulatorRef: string | null;
  globalLenderRef: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'TERMINATED';
  statusReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const LENDER_TYPES = ['BANK', 'NBFC', 'HFC', 'SFB', 'OTHER'] as const;

export function LendersPage() {
  const me = useMe();
  const canEdit = hasPermission(me.data, 'config.manage');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const list = useList<Lender>('/v1/lenders', { q: search || undefined, status: status || undefined });
  const [creating, setCreating] = useState(false);
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <>
      <PageHeader
        title="Lenders"
        subtitle="Lender directory, status and empanelments. A paused lender takes no new cases."
        action={
          canEdit && (
            <Button variant="contained" onClick={() => setCreating(true)} data-testid="admin.lenders.new">
              New lender
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
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="ACTIVE">Active</MenuItem>
          <MenuItem value="PAUSED">Paused</MenuItem>
          <MenuItem value="TERMINATED">Terminated</MenuItem>
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
                  <TableCell>Type</TableCell>
                  <TableCell>Regulator ref</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Reason</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      No lenders match.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((l) => (
                  <TableRow key={l.id} hover>
                    <TableCell>
                      <Link
                        component={RouterLink}
                        to={`/admin/lenders/${l.id}`}
                        data-testid="admin.lender.open"
                      >
                        {l.name}
                      </Link>
                    </TableCell>
                    <TableCell>{l.lenderType}</TableCell>
                    <TableCell>{l.regulatorRef ?? '—'}</TableCell>
                    <TableCell>
                      <StatusChip active={l.status === 'ACTIVE'} label={l.status} />
                    </TableCell>
                    <TableCell>{l.statusReason ?? '—'}</TableCell>
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
      {creating && <CreateLenderDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateLenderDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [lenderType, setLenderType] = useState<(typeof LENDER_TYPES)[number]>('NBFC');
  const [regulatorRef, setRegulatorRef] = useState('');
  const [globalLenderRef, setGlobalLenderRef] = useState('');
  const create = useCommand<object, Lender>(
    () => ({ path: '/v1/lenders', method: 'POST' }),
    [['/v1/lenders']],
  );

  const submit = () =>
    create.mutate(
      {
        name: name.trim(),
        lenderType,
        regulatorRef: regulatorRef.trim() || null,
        globalLenderRef: globalLenderRef.trim() || null,
      },
      { onSuccess: onClose },
    );

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New lender</DialogTitle>
      <DialogContent>
        <ErrorAlert error={create.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            inputProps={{ 'data-testid': 'admin.lender.name' }}
          />
          <TextField
            select
            label="Type"
            value={lenderType}
            onChange={(e) => setLenderType(e.target.value as (typeof LENDER_TYPES)[number])}
          >
            {LENDER_TYPES.map((t) => (
              <MenuItem key={t} value={t}>
                {t}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Regulator reference"
            value={regulatorRef}
            onChange={(e) => setRegulatorRef(e.target.value)}
            helperText="For example the RBI registration number. Optional."
          />
          <TextField
            label="Global lender reference"
            value={globalLenderRef}
            onChange={(e) => setGlobalLenderRef(e.target.value)}
            helperText="Optional."
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={create.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={create.isPending || name.trim().length < 2}
          data-testid="admin.lender.save"
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}
