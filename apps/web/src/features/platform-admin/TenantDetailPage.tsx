// apps/web/src/features/platform-admin/TenantDetailPage.tsx
// One tenant, opened from a row of the Tenants directory in the platform console: its overview and its own feature flags.
// The tenant id comes from the URL and is passed on every call; the flags written here are this tenant's overrides only (migration 0068),
// never the platform-wide flags on the Feature Flags tab of the console.
import React, { useState } from 'react';
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
  fetchTenantFeatureFlags,
  updateTenantFeatureFlag,
} from './api';
import { confirmMessage, flagState, onOff, updateRequest } from './tenant-flags-model';

const notFound = (error: unknown) => error instanceof ApiError && error.httpStatus === 404;
const forbidden = (error: unknown) => error instanceof ApiError && error.httpStatus === 403;

export function TenantDetailPage() {
  const { tenantId = '' } = useParams<{ tenantId: string }>();
  // The tab is in the URL (?tab=flags) so a link can open the flags directly and a reload keeps the place.
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'flags' ? 1 : 0;
  const setTab = (i: number) => setParams(i === 1 ? { tab: 'flags' } : {}, { replace: true });
  const [pending, setPending] = useState<{ flag: TenantFeatureFlag; next: boolean } | null>(null);
  const queryClient = useQueryClient();

  const tenantQuery = useQuery({
    queryKey: ['platform-tenant', tenantId],
    queryFn: () => fetchPlatformTenant(tenantId),
    enabled: tenantId !== '',
    retry: false,
  });
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
              <Typography variant="body2" color="text.secondary">
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
