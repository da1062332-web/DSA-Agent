// /lenders/:id (owner: Dev 3; DSA Notion MODULE 14). Lender details, status with reason, empanelments and the
// contact list. Writes need config.manage. Nothing is deleted: an empanelment is deactivated (suspended, reversible)
// or terminated (ended today, final), and a contact is removed but kept as history. Every save sends the version it
// was based on (If-Match), so a stale save shows the API's version conflict instead of overwriting someone else.
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { DataTable } from '../../ui';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { hasPermission, useMe } from '../../api/useMe';
import { useCommand, useList, useResource } from './api';
import { ConfirmDialog, ErrorAlert, Loading, PageHeader, StatusChip, formatDate } from './components';
import type { Lender } from './LendersPage';

interface Empanelment {
  id: string;
  lenderId: string;
  dsaCode: string;
  validFrom: string;
  validTo: string | null;
  permittedCategories: string[];
  permittedGeos: string[];
  agreementDocumentId: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
  version: number;
}

interface Contact {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  channel: string | null;
  escalationLevel: number;
}

type EmpAction = 'deactivate' | 'reactivate' | 'terminate';

const CATEGORIES = ['PL', 'BL', 'MSME', 'LAP', 'HL', 'VL', 'GL', 'EL', 'OTHER'];
const LENDER_TYPES = ['BANK', 'NBFC', 'HFC', 'SFB', 'OTHER'];
const ACTION_STATUS: Record<EmpAction, Empanelment['status']> = {
  deactivate: 'SUSPENDED',
  reactivate: 'ACTIVE',
  terminate: 'EXPIRED',
};

export function LenderDetailPage() {
  const { id } = useParams();
  const me = useMe();
  const canEdit = hasPermission(me.data, 'config.manage');
  const lender = useResource<Lender>(id ? `/v1/lenders/${id}` : null);
  const emps = useList<Empanelment>(`/v1/lenders/${id}/empanelments`, {}, 200);
  const contacts = useList<Contact>(`/v1/lenders/${id}/contacts`, {}, 200);

  if (lender.isPending) return <Loading />;
  if (!lender.data) return <ErrorAlert error={lender.error} />;
  const l = lender.data;

  return (
    <>
      <PageHeader
        title={l.name}
        subtitle={`${l.lenderType} · version ${l.version} · created ${formatDate(l.createdAt)}`}
        action={<StatusChip active={l.status === 'ACTIVE'} label={l.status} />}
      />
      {l.status !== 'ACTIVE' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {l.status === 'PAUSED' ? 'Paused' : 'Terminated'}: {l.statusReason ?? 'no reason recorded'}. New
          lender cases are refused.
        </Alert>
      )}

      <DetailsCard lender={l} canEdit={canEdit} />
      <StatusCard lender={l} canEdit={canEdit} />
      <EmpanelmentsCard
        lenderId={l.id}
        rows={emps.data?.pages.flatMap((p) => p.data) ?? []}
        loading={emps.isPending}
        canEdit={canEdit}
      />
      <ContactsCard
        lender={l}
        rows={contacts.data?.pages.flatMap((p) => p.data) ?? []}
        loading={contacts.isPending}
        canEdit={canEdit}
      />
    </>
  );
}

function DetailsCard({ lender, canEdit }: { lender: Lender; canEdit: boolean }) {
  const [name, setName] = useState(lender.name);
  const [lenderType, setLenderType] = useState(lender.lenderType);
  const [regulatorRef, setRegulatorRef] = useState(lender.regulatorRef ?? '');
  const [globalLenderRef, setGlobalLenderRef] = useState(lender.globalLenderRef ?? '');
  useEffect(() => {
    setName(lender.name);
    setLenderType(lender.lenderType);
    setRegulatorRef(lender.regulatorRef ?? '');
    setGlobalLenderRef(lender.globalLenderRef ?? '');
  }, [lender]);

  const save = useCommand<object, Lender>(
    () => ({ path: `/v1/lenders/${lender.id}`, method: 'PATCH', version: lender.version }),
    [['/v1/lenders'], [`/v1/lenders/${lender.id}`]],
  );
  const dirty =
    name.trim() !== lender.name ||
    lenderType !== lender.lenderType ||
    (regulatorRef.trim() || null) !== lender.regulatorRef ||
    (globalLenderRef.trim() || null) !== lender.globalLenderRef;

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Details
        </Typography>
        <ErrorAlert error={save.error} />
        <Stack spacing={2} sx={{ maxWidth: 520 }}>
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
          />
          <TextField
            select
            label="Type"
            value={lenderType}
            onChange={(e) => setLenderType(e.target.value as Lender['lenderType'])}
            disabled={!canEdit}
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
            disabled={!canEdit}
          />
          <TextField
            label="Global lender reference"
            value={globalLenderRef}
            onChange={(e) => setGlobalLenderRef(e.target.value)}
            disabled={!canEdit}
          />
          {canEdit && (
            <Stack direction="row">
              <Button
                variant="contained"
                disabled={!dirty || save.isPending || name.trim().length < 2}
                onClick={() =>
                  save.mutate({
                    name: name.trim(),
                    lenderType,
                    regulatorRef: regulatorRef.trim() || null,
                    globalLenderRef: globalLenderRef.trim() || null,
                  })
                }
              >
                Save details
              </Button>
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

function StatusCard({ lender, canEdit }: { lender: Lender; canEdit: boolean }) {
  const [status, setStatus] = useState<Lender['status']>(lender.status);
  const [reason, setReason] = useState('');
  const save = useCommand<object, Lender>(
    () => ({ path: `/v1/lenders/${lender.id}`, method: 'PATCH', version: lender.version }),
    [['/v1/lenders'], [`/v1/lenders/${lender.id}`]],
  );
  const needsReason = status !== 'ACTIVE';

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Status
        </Typography>
        <ErrorAlert error={save.error} />
        <Stack spacing={2} sx={{ maxWidth: 520 }}>
          <TextField
            select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as Lender['status'])}
            disabled={!canEdit}
          >
            <MenuItem value="ACTIVE">Active</MenuItem>
            <MenuItem value="PAUSED">Paused</MenuItem>
            <MenuItem value="TERMINATED">Terminated</MenuItem>
          </TextField>
          {needsReason && (
            <TextField
              label="Reason (required)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={!canEdit}
              helperText="Recorded in the audit log."
            />
          )}
          {canEdit && (
            <Stack direction="row">
              <Button
                variant="contained"
                disabled={
                  save.isPending || status === lender.status || (needsReason && reason.trim().length < 2)
                }
                onClick={() =>
                  save.mutate({
                    status,
                    statusReason: needsReason ? reason.trim() : null,
                  })
                }
              >
                Change status
              </Button>
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

const ACTION_TEXT: Record<EmpAction, { title: string; text: string; button: string; needsReason: boolean }> =
  {
    deactivate: {
      title: 'Deactivate empanelment',
      text: 'The DSA code stops taking new cases until it is reactivated. Nothing is deleted.',
      button: 'Deactivate',
      needsReason: true,
    },
    reactivate: {
      title: 'Reactivate empanelment',
      text: 'The DSA code can take new cases again, if its validity dates still cover today.',
      button: 'Reactivate',
      needsReason: false,
    },
    terminate: {
      title: 'Terminate empanelment',
      text: 'This ends the empanelment today. It cannot be reactivated afterwards. The record is kept for history.',
      button: 'Terminate',
      needsReason: true,
    },
  };

function EmpanelmentsCard({
  lenderId,
  rows,
  loading,
  canEdit,
}: {
  lenderId: string;
  rows: Empanelment[];
  loading: boolean;
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Empanelment | null>(null);
  const [acting, setActing] = useState<{ empanelment: Empanelment; action: EmpAction } | null>(null);

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6">Empanelments</Typography>
          {canEdit && (
            <Button variant="outlined" onClick={() => setAdding(true)} data-testid="admin.emp.new">
              Add empanelment
            </Button>
          )}
        </Stack>
        {loading ? (
          <Loading />
        ) : (
          <DataTable<(typeof rows)[number]>
            dataTestId="admin.table.empanelments"
            data={rows}
            keyExtractor={(e) => e.id}
            emptyMessage="No empanelments yet."
            columns={[
              { id: 'code', header: 'DSA code', render: (e) => <Box sx={{ fontFamily: 'monospace' }}>{e.dsaCode}</Box> },
              { id: 'from', header: 'Valid from', render: (e) => e.validFrom },
              { id: 'to', header: 'Valid to', render: (e) => e.validTo ?? 'open-ended' },
              {
                id: 'categories',
                header: 'Categories',
                render: (e) => e.permittedCategories.map((c) => <Chip key={c} label={c} size="small" sx={{ mr: 0.5 }} />),
              },
              { id: 'geos', header: 'Geographies', render: (e) => e.permittedGeos.join(', ') || '—' },
              { id: 'status', header: 'Status', render: (e) => <StatusChip active={e.status === 'ACTIVE'} label={e.status} /> },
              ...(canEdit
                ? [
                    {
                      id: 'actions',
                      header: 'Actions',
                      align: 'right' as const,
                      render: (e: (typeof rows)[number]) => (
                        <Box sx={{ whiteSpace: 'nowrap' }}>
                          {e.status !== 'EXPIRED' && (
                            <Button size="small" onClick={() => setEditing(e)}>
                              Edit
                            </Button>
                          )}
                          {e.status === 'ACTIVE' && (
                            <Button size="small" color="warning" onClick={() => setActing({ empanelment: e, action: 'deactivate' })}>
                              Deactivate
                            </Button>
                          )}
                          {e.status === 'SUSPENDED' && (
                            <Button size="small" onClick={() => setActing({ empanelment: e, action: 'reactivate' })}>
                              Reactivate
                            </Button>
                          )}
                          {e.status !== 'EXPIRED' && (
                            <Button size="small" color="error" onClick={() => setActing({ empanelment: e, action: 'terminate' })}>
                              Terminate
                            </Button>
                          )}
                        </Box>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </CardContent>
      {adding && <AddEmpanelmentDialog lenderId={lenderId} onClose={() => setAdding(false)} />}
      {editing && <EditEmpanelmentDialog empanelment={editing} onClose={() => setEditing(null)} />}
      {acting && (
        <EmpanelmentActionDialog
          empanelment={acting.empanelment}
          action={acting.action}
          onClose={() => setActing(null)}
        />
      )}
    </Card>
  );
}

function EmpanelmentActionDialog({
  empanelment,
  action,
  onClose,
}: {
  empanelment: Empanelment;
  action: EmpAction;
  onClose: () => void;
}) {
  const copy = ACTION_TEXT[action];
  const [reason, setReason] = useState('');
  const save = useCommand<object, Empanelment>(
    () => ({ path: `/v1/empanelments/${empanelment.id}`, method: 'PATCH', version: empanelment.version }),
    [[`/v1/lenders/${empanelment.lenderId}/empanelments`]],
  );
  const ready = !copy.needsReason || reason.trim().length >= 2;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {copy.title}: {empanelment.dsaCode}
      </DialogTitle>
      <DialogContent>
        <ErrorAlert error={save.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Alert severity={action === 'reactivate' ? 'info' : 'warning'}>{copy.text}</Alert>
          {copy.needsReason && (
            <TextField
              label="Reason (required)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              helperText="Recorded in the audit log."
              inputProps={{ 'data-testid': 'admin.emp.reason' }}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={action === 'reactivate' ? 'primary' : 'error'}
          disabled={!ready || save.isPending}
          data-testid="admin.emp.confirm"
          onClick={() =>
            save.mutate(
              {
                status: ACTION_STATUS[action],
                ...(copy.needsReason ? { reason: reason.trim() } : {}),
              },
              { onSuccess: onClose },
            )
          }
        >
          {copy.button}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function AddEmpanelmentDialog({ lenderId, onClose }: { lenderId: string; onClose: () => void }) {
  const [dsaCode, setDsaCode] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [geos, setGeos] = useState('');
  const [agreement, setAgreement] = useState('');
  const create = useCommand<object, Empanelment>(
    () => ({ path: `/v1/lenders/${lenderId}/empanelments`, method: 'POST' }),
    [[`/v1/lenders/${lenderId}/empanelments`]],
  );
  const ready = /^[A-Z0-9_-]{3,30}$/.test(dsaCode) && !!validFrom && categories.length > 0;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add empanelment</DialogTitle>
      <DialogContent>
        <ErrorAlert error={create.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="DSA code"
            value={dsaCode}
            onChange={(e) => setDsaCode(e.target.value.toUpperCase())}
            helperText="3–30 characters: A–Z, 0–9, _ or -"
          />
          <TextField
            label="Valid from"
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            label="Valid to (optional)"
            type="date"
            value={validTo}
            onChange={(e) => setValidTo(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            select
            SelectProps={{ multiple: true }}
            label="Permitted categories"
            value={categories}
            onChange={(e) => setCategories(e.target.value as unknown as string[])}
          >
            {CATEGORIES.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Permitted geographies"
            value={geos}
            onChange={(e) => setGeos(e.target.value)}
            helperText="Comma-separated, for example MH-MUM, MH-PUN. Optional."
          />
          <TextField
            label="Agreement document reference"
            value={agreement}
            onChange={(e) => setAgreement(e.target.value)}
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
          disabled={!ready || create.isPending}
          onClick={() =>
            create.mutate(
              {
                dsaCode,
                validFrom,
                validTo: validTo || null,
                permittedCategories: categories,
                permittedGeos: geos
                  .split(',')
                  .map((g) => g.trim())
                  .filter(Boolean),
                agreementDocumentId: agreement.trim() || null,
              },
              { onSuccess: onClose },
            )
          }
        >
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Edits the end date and permitted categories only. Status changes go through the deactivate/terminate actions. */
function EditEmpanelmentDialog({ empanelment, onClose }: { empanelment: Empanelment; onClose: () => void }) {
  const [validTo, setValidTo] = useState(empanelment.validTo ?? '');
  const [categories, setCategories] = useState<string[]>(empanelment.permittedCategories);
  const save = useCommand<object, Empanelment>(
    () => ({ path: `/v1/empanelments/${empanelment.id}`, method: 'PATCH', version: empanelment.version }),
    [[`/v1/lenders/${empanelment.lenderId}/empanelments`]],
  );
  const changed =
    (validTo || null) !== empanelment.validTo ||
    categories.slice().sort().join(',') !== empanelment.permittedCategories.slice().sort().join(',');

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit {empanelment.dsaCode}</DialogTitle>
      <DialogContent>
        <ErrorAlert error={save.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Valid to (empty = open-ended)"
            type="date"
            value={validTo}
            onChange={(e) => setValidTo(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            select
            SelectProps={{ multiple: true }}
            label="Permitted categories"
            value={categories}
            onChange={(e) => setCategories(e.target.value as unknown as string[])}
          >
            {CATEGORIES.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>
          <Alert severity="info">Start date and DSA code cannot be changed after creation.</Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={!changed || save.isPending || categories.length === 0}
          onClick={() =>
            save.mutate({ validTo: validTo || null, permittedCategories: categories }, { onSuccess: onClose })
          }
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ContactsCard({
  lender,
  rows,
  loading,
  canEdit,
}: {
  lender: Lender;
  rows: Contact[];
  loading: boolean;
  canEdit: boolean;
}) {
  const [draft, setDraft] = useState<Omit<Contact, 'id'>[]>([]);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<Contact | null>(null);
  const save = useCommand<{ contacts: Omit<Contact, 'id'>[] }, unknown>(
    () => ({ path: `/v1/lenders/${lender.id}/contacts`, method: 'PUT', version: lender.version }),
    [[`/v1/lenders/${lender.id}/contacts`], [`/v1/lenders/${lender.id}`]],
  );
  const remove = useCommand<object, unknown>(
    () => ({
      path: `/v1/lenders/${lender.id}/contacts/${removing?.id ?? ''}`,
      method: 'DELETE',
      version: lender.version,
    }),
    [[`/v1/lenders/${lender.id}/contacts`], [`/v1/lenders/${lender.id}`]],
  );

  const start = () => {
    setDraft(rows.map(({ id: _id, ...c }) => c));
    setEditing(true);
  };
  const update = (i: number, patch: Partial<Omit<Contact, 'id'>>) =>
    setDraft((d) => d.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const validRow = (c: Omit<Contact, 'id'>) =>
    c.name.trim().length >= 2 &&
    c.escalationLevel >= 1 &&
    c.escalationLevel <= 3 &&
    (!c.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) &&
    (!c.phone || /^\+?[0-9 ]{8,15}$/.test(c.phone));

  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6">Contacts</Typography>
          {canEdit && !editing && (
            <Button variant="outlined" onClick={start} data-testid="admin.lender.contacts.edit">
              Edit contacts
            </Button>
          )}
        </Stack>
        {!editing ? (
          loading ? (
            <Loading />
          ) : (
            <DataTable<(typeof rows)[number]>
              dataTestId="admin.table.contacts"
              data={rows}
              keyExtractor={(c) => c.id}
              emptyMessage="No contacts yet."
              columns={[
                { id: 'name', header: 'Name', render: (c) => c.name },
                { id: 'role', header: 'Role', render: (c) => c.role ?? '—' },
                { id: 'email', header: 'Email', render: (c) => c.email ?? '—' },
                { id: 'phone', header: 'Phone', render: (c) => c.phone ?? '—' },
                { id: 'channel', header: 'Channel', render: (c) => c.channel ?? '—' },
                { id: 'escalation', header: 'Escalation', render: (c) => `Level ${c.escalationLevel}` },
                ...(canEdit
                  ? [
                      {
                        id: 'actions',
                        header: 'Actions',
                        align: 'right' as const,
                        render: (c: (typeof rows)[number]) => (
                          <Button size="small" color="error" onClick={() => setRemoving(c)} data-testid="admin.contact.remove">
                            Remove
                          </Button>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          )
        ) : (
          <Stack spacing={2}>
            <ErrorAlert error={save.error} />
            {draft.map((c, i) => (
              <Stack key={i} direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems="center">
                <TextField
                  size="small"
                  label="Name"
                  value={c.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
                <TextField
                  size="small"
                  label="Role"
                  value={c.role ?? ''}
                  onChange={(e) => update(i, { role: e.target.value || null })}
                />
                <TextField
                  size="small"
                  label="Email"
                  value={c.email ?? ''}
                  onChange={(e) => update(i, { email: e.target.value || null })}
                />
                <TextField
                  size="small"
                  label="Phone"
                  value={c.phone ?? ''}
                  onChange={(e) => update(i, { phone: e.target.value || null })}
                />
                <TextField
                  size="small"
                  label="Channel"
                  value={c.channel ?? ''}
                  onChange={(e) => update(i, { channel: e.target.value || null })}
                />
                <TextField
                  size="small"
                  select
                  label="Level"
                  value={c.escalationLevel}
                  onChange={(e) => update(i, { escalationLevel: Number(e.target.value) })}
                  sx={{ minWidth: 100 }}
                >
                  {[1, 2, 3].map((n) => (
                    <MenuItem key={n} value={n}>
                      {n}
                    </MenuItem>
                  ))}
                </TextField>
                <Button
                  color="error"
                  onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
                  aria-label="drop from list"
                >
                  Drop
                </Button>
              </Stack>
            ))}
            <Stack direction="row" spacing={1}>
              <Button
                onClick={() =>
                  setDraft((d) => [
                    ...d,
                    { name: '', role: null, email: null, phone: null, channel: null, escalationLevel: 1 },
                  ])
                }
              >
                Add contact
              </Button>
              <Button
                variant="contained"
                disabled={save.isPending || draft.some((c) => !validRow(c))}
                onClick={() => save.mutate({ contacts: draft }, { onSuccess: () => setEditing(false) })}
              >
                Save contacts
              </Button>
              <Button onClick={() => setEditing(false)} disabled={save.isPending}>
                Cancel
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Saving replaces the list and keeps the previous contacts as history. To remove one contact on
              its own, use Remove in the table. Contact details are never written to the audit log.
            </Typography>
          </Stack>
        )}
      </CardContent>
      <ConfirmDialog
        open={!!removing}
        title={`Remove ${removing?.name ?? 'contact'}?`}
        text="The contact is removed from this lender. It stays in the history, and the audit log records the removal without personal details."
        confirmLabel="Remove"
        busy={remove.isPending}
        error={remove.error}
        onClose={() => {
          setRemoving(null);
          remove.reset();
        }}
        onConfirm={() => remove.mutate({}, { onSuccess: () => setRemoving(null) })}
      />
    </Card>
  );
}
