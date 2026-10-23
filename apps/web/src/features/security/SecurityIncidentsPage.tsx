// /security (owner: Akash, Module 39: Security events and incidents). Needs security.incident; every call is tenant-scoped by the API.
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Can } from '../../shell/Can';
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  SECURITY_EVENT_SEVERITIES,
  SECURITY_EVENT_TYPES,
  type IncidentRecord,
  type IncidentStatus,
} from '@dsa/contracts';
import { useState } from 'react';
import { errorText } from '../../api/client';
import { hasPermission, useMe } from '../../api/useMe';
import { useToast } from '../../shell/toast';
import { ErrorAlert, LoadMore, Loading, PageHeader } from '../admin/components';
import { DataTable } from '../../ui';
import { createIncident, listIncidents, listSecurityEvents, updateIncident } from './api';
import { label, needsAuthorityNotice, nextStatuses, severityTone } from './model';

const when = (iso: string) => new Date(iso).toLocaleString();

export function SecurityIncidentsPage() {
  const me = useMe();
  const [tab, setTab] = useState<'incidents' | 'events'>('incidents');

  if (me.data && !hasPermission(me.data, 'security.incident')) {
    return (
      <Alert severity="warning" data-testid="security-no-access">
        You do not have access to security events and incidents. This needs the security incident permission.
      </Alert>
    );
  }

  return (
    <Box>
      <PageHeader
        title="Security events and incidents"
        subtitle="Events recorded for your organisation and incidents under investigation. Notification evidence is kept for the DPDP Act and CERT-In."
      />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab value="incidents" label="Incidents" />
        <Tab value="events" label="Security events" />
      </Tabs>
      {tab === 'incidents' ? <IncidentsTab /> : <EventsTab />}
    </Box>
  );
}

function SelectFilter(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  width?: number;
}) {
  return (
    <TextField
      select
      size="small"
      label={props.label}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      sx={{ minWidth: props.width ?? 160 }}
    >
      <MenuItem value="">All</MenuItem>
      {props.options.map((o) => (
        <MenuItem key={o} value={o}>
          {label(o)}
        </MenuItem>
      ))}
    </TextField>
  );
}

function IncidentsTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [type, setType] = useState('');
  const filters = { status, severity, type };
  const list = useInfiniteQuery({
    queryKey: ['security-incidents', filters],
    queryFn: ({ pageParam }) => listIncidents(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.nextCursor,
  });
  const [creating, setCreating] = useState(false);
  const [noticeFor, setNoticeFor] = useState<IncidentRecord | null>(null);

  const change = useMutation({
    meta: { handled: true },
    mutationFn: (v: { incident: IncidentRecord; status: IncidentStatus }) =>
      updateIncident(v.incident.id, { status: v.status }, v.incident.lockVersion),
    onSuccess: async () => {
      toast.success('Incident updated.');
      await qc.invalidateQueries({ queryKey: ['security-incidents'] });
    },
    onError: async (err) => {
      toast.error(errorText(err));
      await qc.invalidateQueries({ queryKey: ['security-incidents'] });
    },
  });

  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <>
      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 2 }} alignItems="center">
        <SelectFilter label="Status" value={status} onChange={setStatus} options={INCIDENT_STATUSES} />
        <SelectFilter
          label="Severity"
          value={severity}
          onChange={setSeverity}
          options={INCIDENT_SEVERITIES}
        />
        <SelectFilter label="Type" value={type} onChange={setType} options={INCIDENT_TYPES} width={220} />
        <Box sx={{ flexGrow: 1 }} />
        <Can action="security.incident">
          <Button variant="contained" onClick={() => setCreating(true)}>
            Record incident
          </Button>
        </Can>
      </Stack>

      <ErrorAlert error={list.error} />
      {list.isLoading ? (
        <Loading />
      ) : rows.length === 0 && !list.error ? (
        <Card sx={{ p: 3 }} data-testid="incidents-empty">
          <Typography color="text.secondary">No incidents match these filters.</Typography>
        </Card>
      ) : (
        <DataTable<(typeof rows)[number]>
          dataTestId="sec.table.incidents"
          data={rows}
          keyExtractor={(i) => i.id}
          columns={[
            { id: 'detected', header: 'Detected', render: (i) => when(i.detectedAt) },
            { id: 'type', header: 'Type', render: (i) => label(i.type) },
            {
              id: 'severity',
              header: 'Severity',
              render: (i) => <Chip size="small" color={severityTone(i.severity)} label={label(i.severity)} />,
            },
            { id: 'status', header: 'Status', render: (i) => label(i.status) },
            {
              id: 'personal',
              header: 'Personal data',
              render: (i) =>
                i.personalDataInvolved ? (
                  needsAuthorityNotice(i) ? (
                    <Tooltip title="Personal data is involved and no authority notification is recorded yet">
                      <Chip size="small" color="warning" label="Authority not notified" />
                    </Tooltip>
                  ) : (
                    <Chip size="small" label="Yes" />
                  )
                ) : (
                  'No'
                ),
            },
            {
              id: 'actions',
              header: 'Actions',
              align: 'right',
              render: (i) => (
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <Can action="security.incident">
                    {i.personalDataInvolved && i.status !== 'CLOSED' && (
                      <Button size="small" onClick={() => setNoticeFor(i)}>
                        Record notice
                      </Button>
                    )}
                    {nextStatuses(i.status).map((s) => (
                      <Button key={s} size="small" disabled={change.isPending} onClick={() => change.mutate({ incident: i, status: s })}>
                        {label(s)}
                      </Button>
                    ))}
                  </Can>
                </Stack>
              ),
            },
          ]}
        />
      )}
      <LoadMore
        hasNext={!!list.hasNextPage}
        loading={list.isFetchingNextPage}
        onClick={() => list.fetchNextPage()}
      />

      {creating && <CreateIncidentDialog onClose={() => setCreating(false)} />}
      {noticeFor && <NoticeDialog incident={noticeFor} onClose={() => setNoticeFor(null)} />}
    </>
  );
}

function CreateIncidentDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [type, setType] = useState<(typeof INCIDENT_TYPES)[number]>('OTHER');
  const [severity, setSeverity] = useState<(typeof INCIDENT_SEVERITIES)[number]>('MEDIUM');
  const [detected, setDetected] = useState(() => new Date().toISOString().slice(0, 16));
  const [personal, setPersonal] = useState(false);
  const create = useMutation({
    meta: { handled: true },
    mutationFn: () =>
      createIncident({
        type,
        severity,
        detectedAt: new Date(detected).toISOString(),
        personalDataInvolved: personal,
        affectedTenants: [],
        notifications: {},
        status: 'OPEN',
      }),
    onSuccess: async () => {
      toast.success('Incident recorded.');
      await qc.invalidateQueries({ queryKey: ['security-incidents'] });
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Record an incident</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <ErrorAlert error={create.error} />
          <TextField
            select
            label="Type"
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            {INCIDENT_TYPES.map((t) => (
              <MenuItem key={t} value={t}>
                {label(t)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as typeof severity)}
          >
            {INCIDENT_SEVERITIES.map((t) => (
              <MenuItem key={t} value={t}>
                {label(t)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            type="datetime-local"
            label="Detected at"
            value={detected}
            onChange={(e) => setDetected(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <FormControlLabel
            control={<Checkbox checked={personal} onChange={(e) => setPersonal(e.target.checked)} />}
            label="Personal data is involved"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={create.isPending || !detected} onClick={() => create.mutate()}>
          Record
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function NoticeDialog({ incident, onClose }: { incident: IncidentRecord; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [at, setAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [ref, setRef] = useState('');
  const save = useMutation({
    meta: { handled: true },
    mutationFn: () =>
      updateIncident(
        incident.id,
        {
          notifications: {
            ...incident.notifications,
            authority: { notified: true, notifiedAt: new Date(at).toISOString(), evidenceRef: ref || null },
          },
        },
        incident.lockVersion,
      ),
    onSuccess: async () => {
      toast.success('Notification recorded.');
      await qc.invalidateQueries({ queryKey: ['security-incidents'] });
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Record notification to the authority</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <ErrorAlert error={save.error} />
          <TextField
            type="datetime-local"
            label="Notified at"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            label="Evidence reference"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            helperText="For example the acknowledgement number. Do not paste personal data."
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={save.isPending || !at} onClick={() => save.mutate()}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function EventsTab() {
  const [type, setType] = useState('');
  const [severity, setSeverity] = useState('');
  const [principal, setPrincipal] = useState('');
  const filters = { type, severity, principal };
  const list = useInfiniteQuery({
    queryKey: ['security-events', filters],
    queryFn: ({ pageParam }) => listSecurityEvents(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.nextCursor,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 2 }}>
        <SelectFilter
          label="Type"
          value={type}
          onChange={setType}
          options={SECURITY_EVENT_TYPES}
          width={220}
        />
        <SelectFilter
          label="Severity"
          value={severity}
          onChange={setSeverity}
          options={SECURITY_EVENT_SEVERITIES}
        />
        <TextField
          size="small"
          label="Principal"
          value={principal}
          onChange={(e) => setPrincipal(e.target.value)}
        />
      </Stack>
      <ErrorAlert error={list.error} />
      {list.isLoading ? (
        <Loading />
      ) : rows.length === 0 && !list.error ? (
        <Card sx={{ p: 3 }} data-testid="events-empty">
          <Typography color="text.secondary">No security events match these filters.</Typography>
        </Card>
      ) : (
        <DataTable<(typeof rows)[number]>
          dataTestId="sec.table.events"
          data={rows}
          keyExtractor={(e) => e.id}
          columns={[
            { id: 'when', header: 'When', render: (e) => when(e.createdAt) },
            { id: 'type', header: 'Type', render: (e) => label(e.type) },
            {
              id: 'severity',
              header: 'Severity',
              render: (e) => <Chip size="small" color={severityTone(e.severity)} label={label(e.severity)} />,
            },
            { id: 'principal', header: 'Principal', render: (e) => e.principal },
            { id: 'ip', header: 'IP', render: (e) => e.ip },
          ]}
        />
      )}
      <LoadMore
        hasNext={!!list.hasNextPage}
        loading={list.isFetchingNextPage}
        onClick={() => list.fetchNextPage()}
      />
    </>
  );
}
