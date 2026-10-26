// apps/web/src/features/platform-admin/TenantDetailPage.tsx
// One tenant, opened from a row of the Tenants directory in the platform console: its overview and its own feature flags.
// The tenant id comes from the URL and is passed on every call; the flags written here are this tenant's overrides only (migration 0068),
// never the platform-wide flags on the Feature Flags tab of the console.
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Stack,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Paper,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material';
import { DataTable, PageHeader } from '../../ui';
import { UserName } from '../../shell/display';
import type { TenantFeatureFlag } from '@dsa/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import {
  fetchFeatureFlags,
  fetchPlatformTenant,
  fetchSupportAccessRequests,
  fetchSupportTenantView,
  fetchSupportViewLog,
  fetchTenantFeatureFlags,
  updateTenantFeatureFlag,
} from './api';
import { confirmMessage, flagState, onOff, updateRequest } from './tenant-flags-model';

const notFound = (error: unknown) => error instanceof ApiError && error.httpStatus === 404;

/** "1 h 12 min", "4 min 9 s" or "9 s": the time left in a support window. */
function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s} s`;
  return `${s} s`;
}
const forbidden = (error: unknown) => error instanceof ApiError && error.httpStatus === 403;

export function TenantDetailPage() {
  const { tenantId = '' } = useParams<{ tenantId: string }>();
  // The tab is in the URL (?tab=flags) so a link can open the flags directly and a reload keeps the place.
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'flags' ? 1 : params.get('tab') === 'support' ? 2 : 0;
  const setTab = (i: number) =>
    setParams(i === 1 ? { tab: 'flags' } : i === 2 ? { tab: 'support' } : {}, { replace: true });
  const [pending, setPending] = useState<{ flag: TenantFeatureFlag; next: boolean } | null>(null);
  const queryClient = useQueryClient();

  const tenantQuery = useQuery({
    queryKey: ['platform-tenant', tenantId],
    queryFn: () => fetchPlatformTenant(tenantId),
    enabled: tenantId !== '',
    retry: false,
  });
  // The support view opens only on its own tab. Without an approved window the server answers 403, shown as a plain message.
  const supportQuery = useQuery({
    queryKey: ['platform-tenant-support-view', tenantId],
    queryFn: () => fetchSupportTenantView(tenantId),
    enabled: tenantId !== '' && tab === 2 && tenantQuery.isSuccess,
    retry: false,
  });
  // The window details (incident, reason, approver) come from the grant list, which the platform realm may read.
  const grantsQuery = useQuery({
    queryKey: ['platform-tenant-support-grants', tenantId],
    queryFn: () => fetchSupportAccessRequests(tenantId),
    enabled: tenantId !== '' && tab === 2 && tenantQuery.isSuccess,
    retry: false,
  });
  // Who has looked at this tenant's set-up, and when. Shown on the tab whether or not a window is open.
  const supportLogQuery = useQuery({
    queryKey: ['platform-tenant-support-log', tenantId],
    queryFn: () => fetchSupportViewLog(tenantId),
    enabled: tenantId !== '' && tab === 2 && tenantQuery.isSuccess,
    retry: false,
  });
  // Ticks once a second, so the countdown runs and an expired window closes without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const supportEndsMs = supportQuery.data ? new Date(supportQuery.data.endsAt).getTime() : 0;
  const supportWindowEnded = supportQuery.data !== undefined && now >= supportEndsMs;
  const supportRemaining = formatRemaining(supportEndsMs - now);
  const supportGrant = grantsQuery.data?.data.find((g) => g.id === supportQuery.data?.grantId);
  // The flag queries wait for the tab: an operator who may see the overview but not manage flags (support) is not shown an error up front.
  const flagsQuery = useQuery({
    queryKey: ['platform-tenant-flags', tenantId],
    queryFn: () => fetchTenantFeatureFlags(tenantId),
    enabled: tenantId !== '' && tab === 1 && tenantQuery.isSuccess,
    retry: false,
  });
  const globalQuery = useQuery({
    queryKey: ['platform-flags'],
    queryFn: fetchFeatureFlags,
    enabled: tab === 1 && flagsQuery.isSuccess,
    retry: false,
  });

  const toggleMutation = useMutation({
    meta: { successMessage: 'Tenant flag updated.' },
    mutationFn: ({ flag, next }: { flag: TenantFeatureFlag; next: boolean }) => {
      const r = updateRequest(tenantId, flag, next);
      return updateTenantFeatureFlag(r.tenantId, r.key, r.value, r.version);
    },
    onSuccess: () => setPending(null),
    // A refused or stale save (409) closes the dialog and reloads, so the operator sees what is really stored.
    onSettled: () => {
      setPending(null);
      return queryClient.invalidateQueries({ queryKey: ['platform-tenant-flags', tenantId] });
    },
  });

  const tenant = tenantQuery.data;
  const tenantName = tenant?.legalName ?? tenantId;
  const globals = (globalQuery.data?.data ?? []).filter((f) => f.scope === 'GLOBAL');

  return (
    <Box>
      <Breadcrumbs sx={{ mb: 1 }}>
        <RouterLink to="/platform-admin">Platform console</RouterLink>
        <Typography color="text.primary">Tenants</Typography>
        <Typography color="text.primary">{tenant?.slug ?? tenantId}</Typography>
      </Breadcrumbs>

      {tenantQuery.isLoading && (
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <CircularProgress size={32} />
        </Box>
      )}

      {tenantQuery.isError && (
        <Alert
          severity={notFound(tenantQuery.error) ? 'warning' : 'error'}
          data-testid="platform.tenant.error"
        >
          {notFound(tenantQuery.error)
            ? `Tenant ${tenantId} was not found. It may not exist, or it is not a customer tenant.`
            : forbidden(tenantQuery.error)
              ? 'You do not have permission to open tenants.'
              : 'The tenant could not be loaded.'}{' '}
          <RouterLink to="/platform-admin">Back to the tenants directory</RouterLink>
        </Alert>
      )}

      {tenant && (
        <>
          <PageHeader
            title={tenant.legalName}
            backTo="/platform-admin"
            badge={
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip
                  label={tenant.status}
                  size="small"
                  color={tenant.status === 'ACTIVE' ? 'primary' : 'default'}
                />
                <Chip
                  label={tenant.healthStatus}
                  size="small"
                  color={tenant.healthStatus === 'HEALTHY' ? 'success' : 'warning'}
                />
              </Stack>
            }
            subtitle={
              // component="span": the header already sits inside a paragraph, and a <p> cannot nest inside a <p>.
              <Typography component="span" variant="body2" color="text.secondary">
                <code>{tenant.id}</code>
              </Typography>
            }
          />

          <Paper elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', mb: 3, borderRadius: 2 }}>
            <Tabs
              value={tab}
              onChange={(_, i) => setTab(i)}
              sx={{ '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, minHeight: 48 } }}
            >
              <Tab label="Overview" />
              <Tab label="Feature Flags" />
              <Tab label="Support view" />
            </Tabs>
          </Paper>

          {tab === 0 && (
            <Box>
              <Alert severity="info" sx={{ mb: 3 }}>
                <strong>Zero Business Data Projection:</strong> this page shows organisational metadata only.
                No leads, loans or customer financial records of the tenant are read or shown.
              </Alert>
              <Grid container spacing={2}>
                {(
                  [
                    { label: 'Slug', value: tenant.slug },
                    { label: 'Legal name', value: tenant.legalName },
                    { label: 'Type', value: tenant.tenantType },
                    { label: 'Region / timezone', value: `${tenant.dataRegion} / ${tenant.timezone}` },
                    { label: 'Active users', value: String(tenant.activeUsersCount) },
                    { label: 'Created', value: new Date(tenant.createdAt).toLocaleDateString() },
                    { label: 'Created by', value: <UserName id={tenant.createdBy} /> },
                    {
                      label: 'Entitlements',
                      value: tenant.entitlements.length ? tenant.entitlements.join(', ') : 'None recorded',
                    },
                  ] as Array<{ label: string; value: React.ReactNode }>
                ).map(({ label, value }) => (
                  <Grid item xs={12} sm={6} md={3} key={label}>
                    <Card variant="outlined" sx={{ borderRadius: 2, height: '100%' }}>
                      <CardContent>
                        <Typography variant="caption" color="text.secondary">
                          {label}
                        </Typography>
                        <Typography variant="subtitle1" fontWeight={600}>
                          {value}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}

          {tab === 2 && (
            <Box>
              {supportQuery.isLoading && <CircularProgress size={24} />}
              {supportQuery.isError && (
                <Alert severity="warning" data-testid="support.view.closed" sx={{ mb: 2 }}>
                  {forbidden(supportQuery.error)
                    ? 'No active support window for this tenant. Request one from the Support Access tab, and the tenant administrator must approve it before it can be opened.'
                    : `The support view could not be loaded${
                        supportQuery.error instanceof ApiError
                          ? ` (${supportQuery.error.code}, HTTP ${supportQuery.error.httpStatus})`
                          : ''
                      }: ${supportQuery.error instanceof Error ? supportQuery.error.message : 'try again'}`}
                </Alert>
              )}
              {supportWindowEnded && (
                <Alert severity="warning" data-testid="support.view.ended" sx={{ mb: 2 }}>
                  This support window ended at {new Date(supportQuery.data?.endsAt ?? 0).toLocaleString()}. The view is
                  closed. Request a new window from the Support Access tab.
                </Alert>
              )}
              {supportQuery.data && !supportWindowEnded && (
                <Stack spacing={3} data-testid="support.view">
                  <Alert
                    severity="info"
                    action={
                      <Button
                        size="small"
                        onClick={() => {
                          void supportQuery.refetch();
                          void grantsQuery.refetch();
                        }}
                      >
                        Refresh
                      </Button>
                    }
                  >
                    Read-only. Metadata and configuration only. Time left:{' '}
                    <strong data-testid="support.view.remaining">{supportRemaining}</strong>. The window ends at{' '}
                    {new Date(supportQuery.data.endsAt).toLocaleString()}. Every view is recorded in the audit trail under
                    grant {supportQuery.data.grantId}.
                  </Alert>
                  {supportGrant && (
                    <Card elevation={0} sx={{ borderRadius: 2, border: 1, borderColor: 'divider' }}>
                      <CardContent>
                        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                          Window details
                        </Typography>
                        <Table size="small" data-testid="support.view.grant">
                          <TableBody>
                            {[
                              ['Incident reference', supportGrant.incidentRef],
                              ['Reason', supportGrant.reason],
                              ['Scope', supportGrant.scope],
                              ['Requested by', supportGrant.requester],
                              ['Approved by', supportGrant.approver ?? 'Not recorded'],
                              ['Starts', new Date(supportGrant.startsAt).toLocaleString()],
                              ['Ends', new Date(supportGrant.endsAt).toLocaleString()],
                              ['Status', supportGrant.status],
                            ].map(([label, value]) => (
                              <TableRow key={label}>
                                <TableCell sx={{ fontWeight: 600, width: 200 }}>{label}</TableCell>
                                <TableCell>{value}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  )}
                  <Card elevation={0} sx={{ borderRadius: 2, border: 1, borderColor: 'divider' }}>
                    <CardContent>
                      <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                        Tenant
                      </Typography>
                      <Typography variant="body2">
                        {supportQuery.data.tenant.legalName} · {supportQuery.data.tenant.slug} ·{' '}
                        {supportQuery.data.tenant.status} · {supportQuery.data.tenant.dataRegion} ·{' '}
                        {supportQuery.data.tenant.timezone}
                      </Typography>
                    </CardContent>
                  </Card>
                  <Card elevation={0} sx={{ borderRadius: 2, border: 1, borderColor: 'divider' }}>
                    <CardContent>
                      <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                        Organisations
                      </Typography>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Legal name</TableCell>
                            <TableCell>Constitution</TableCell>
                            <TableCell>Status</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {supportQuery.data.organisations.map((o) => (
                            <TableRow key={o.id}>
                              <TableCell>{o.legalName}</TableCell>
                              <TableCell>{o.constitution}</TableCell>
                              <TableCell>{o.status}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                  <Card elevation={0} sx={{ borderRadius: 2, border: 1, borderColor: 'divider' }}>
                    <CardContent>
                      <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                        Branches
                      </Typography>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Code</TableCell>
                            <TableCell>Name</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell>Timezone</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {supportQuery.data.branches.map((b) => (
                            <TableRow key={b.id}>
                              <TableCell>{b.code}</TableCell>
                              <TableCell>{b.name}</TableCell>
                              <TableCell>{b.status}</TableCell>
                              <TableCell>{b.timezone}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                  <Card elevation={0} sx={{ borderRadius: 2, border: 1, borderColor: 'divider' }}>
                    <CardContent>
                      <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                        Settings
                      </Typography>
                      <Table size="small" data-testid="support.view.settings">
                        <TableHead>
                          <TableRow>
                            <TableCell>Key</TableCell>
                            <TableCell>Scope</TableCell>
                            <TableCell>Value</TableCell>
                            <TableCell>Locked</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {supportQuery.data.settings.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={4}>No settings changed from the platform defaults.</TableCell>
                            </TableRow>
                          )}
                          {supportQuery.data.settings.map((s) => (
                            <TableRow key={`${s.scopeType}:${s.scopeId}:${s.key}`}>
                              <TableCell>{s.key}</TableCell>
                              <TableCell>
                                {s.scopeType === 'TENANT' ? 'Tenant' : `${s.scopeType}: ${s.scopeId}`}
                              </TableCell>
                              <TableCell>{JSON.stringify(s.value)}</TableCell>
                              <TableCell>{s.locked ? 'Yes' : 'No'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                  <Card elevation={0} sx={{ borderRadius: 2, border: 1, borderColor: 'divider' }}>
                    <CardContent>
                      <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                        Feature flag overrides for this tenant
                      </Typography>
                      <Table size="small" data-testid="support.view.flags">
                        <TableHead>
                          <TableRow>
                            <TableCell>Flag</TableCell>
                            <TableCell>This tenant</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {supportQuery.data.flags.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={2}>No overrides. The platform defaults apply.</TableCell>
                            </TableRow>
                          )}
                          {supportQuery.data.flags.map((f) => (
                            <TableRow key={f.key}>
                              <TableCell>{f.key}</TableCell>
                              <TableCell>{f.value ? 'On' : 'Off'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </Stack>
              )}
            </Box>
          )}

          {tab === 2 && (
            <Box sx={{ mt: 3 }}>
              <Card elevation={0} sx={{ borderRadius: 2, border: 1, borderColor: 'divider' }}>
                <CardContent>
                  <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                    Who looked at this tenant&apos;s set-up
                  </Typography>
                  {supportLogQuery.isError && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                      The view log could not be loaded.
                    </Alert>
                  )}
                  <Table size="small" data-testid="support.view.log">
                    <TableHead>
                      <TableRow>
                        <TableCell>When</TableCell>
                        <TableCell>Event</TableCell>
                        <TableCell>Operator</TableCell>
                        <TableCell>Window</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(supportLogQuery.data?.data ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4}>No views yet.</TableCell>
                        </TableRow>
                      )}
                      {(supportLogQuery.data?.data ?? []).map((e, i) => (
                        <TableRow key={`${e.occurredAt}-${i}`}>
                          <TableCell>{new Date(e.occurredAt).toLocaleString()}</TableCell>
                          <TableCell>{e.action === 'platform.support_view_read' ? 'Viewed' : 'Refused'}</TableCell>
                          <TableCell>{e.operatorName ?? e.operatorId}</TableCell>
                          <TableCell>{e.grantId ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </Box>
          )}

          {tab === 1 && (
            <Box>
              <Alert severity="info" sx={{ mb: 2 }}>
                Flags changed here apply to <strong>{tenant.legalName}</strong> only. They override the
                platform default for this tenant; the global flags and the other tenants are never touched
                from this page.
              </Alert>

              {flagsQuery.isLoading && <CircularProgress size={28} />}
              {flagsQuery.isError && (
                <Alert severity="error" data-testid="platform.tenant.flags-error">
                  {forbidden(flagsQuery.error)
                    ? 'You do not have permission to manage feature flags.'
                    : 'The tenant flags could not be loaded.'}
                </Alert>
              )}

              {flagsQuery.data && (
                <DataTable<(typeof flagsQuery.data.data)[number]>
                  dataTestId="tenant.table.flags"
                  data={flagsQuery.data.data}
                  keyExtractor={(flag) => flag.key}
                  emptyMessage="No tenant-scoped flags are defined."
                  columns={[
                    {
                      id: 'flag',
                      header: 'Flag',
                      render: (flag) => (
                        <>
                          <Typography variant="subtitle2" fontWeight={700}>
                            {flag.key}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {flag.description || 'No description provided.'}
                          </Typography>
                        </>
                      ),
                    },
                    {
                      id: 'default',
                      header: 'Platform default',
                      render: (flag) => <Chip label={onOff(flag.defaultValue)} size="small" variant="outlined" />,
                    },
                    {
                      id: 'tenant',
                      header: 'This tenant',
                      render: (flag) => (
                        <Switch
                          checked={flag.value}
                          color="success"
                          disabled={toggleMutation.isPending}
                          inputProps={{ 'aria-label': `${flag.key} for ${tenantName}` }}
                          onChange={(e) => setPending({ flag, next: e.target.checked })}
                        />
                      ),
                    },
                    {
                      id: 'state',
                      header: 'State',
                      render: (flag) => {
                        const state = flagState(flag);
                        return (
                          <Chip
                            label={state.label}
                            size="small"
                            color={state.overridden ? 'secondary' : 'default'}
                            variant={state.overridden ? 'filled' : 'outlined'}
                          />
                        );
                      },
                    },
                    { id: 'version', header: 'Version', render: (flag) => `v${flag.lockVersion}` },
                    {
                      id: 'changed',
                      header: 'Last change',
                      render: (flag) =>
                        flag.updatedAt ? `${new Date(flag.updatedAt).toLocaleString()} by ${flag.updatedBy}` : '—',
                    },
                  ]}
                />
              )}

              {globals.length > 0 && (
                <Box>
                  <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                    Global flags (same for every tenant, read-only here)
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                    {globals.map((f) => (
                      <Chip
                        key={f.key}
                        size="small"
                        variant="outlined"
                        label={`${f.key}: ${onOff(Boolean(f.value))}`}
                      />
                    ))}
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    Change a global flag on the Feature Flags tab of the platform console.
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </>
      )}

      <Dialog open={pending !== null} onClose={() => setPending(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {pending ? `Turn ${pending.flag.key} ${onOff(pending.next)} for ${tenantName}?` : ''}
        </DialogTitle>
        <DialogContent>
          {pending && (
            <Typography variant="body2">{confirmMessage(tenantName, pending.flag, pending.next)}</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={toggleMutation.isPending}
            onClick={() => pending && toggleMutation.mutate(pending)}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
