// apps/web/src/features/integrations/IntegrationsPage.tsx
// Module 28: Integration Management (MOD-INT) — SUB-INT.01: Adapter Framework Workbench

import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  SvgIcon,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tab,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { DataTable, PageHeader } from '../../ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ConfigureIntegrationRequest,
  IntegrationConnection,
  IntegrationEnvironment,
  IntegrationStatus,
} from '@dsa/contracts';
import { configureIntegration, fetchCapabilities, fetchIntegrations, pingIntegration } from './api';
import { useMe } from '../../api/useMe';

function RefreshIcon(props: React.ComponentProps<typeof SvgIcon>) {
  return (
    <SvgIcon {...props}>
      <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
    </SvgIcon>
  );
}

function SecurityIcon(props: React.ComponentProps<typeof SvgIcon>) {
  return (
    <SvgIcon {...props}>
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" />
    </SvgIcon>
  );
}

function HubIcon(props: React.ComponentProps<typeof SvgIcon>) {
  return (
    <SvgIcon {...props}>
      <path d="M12 2a3 3 0 00-3 3c0 .35.07.69.18 1H7.82A3 3 0 005 5a3 3 0 00-3 3 3 3 0 003 3c.35 0 .69-.07 1-.18v2.36c-.31-.11-.65-.18-1-.18a3 3 0 00-3 3 3 3 0 003 3 3 3 0 003-3c0-.35-.07-.69-.18-1h1.36c.11.31.18.65.18 1a3 3 0 003 3 3 3 0 003-3 3 3 0 00-3-3c-.35 0-.69.07-1 .18V10.82c.31.11.65.18 1 .18a3 3 0 003-3 3 3 0 00-3-3 3 3 0 00-3 3c0 .35.07.69.18 1H10.82c-.11-.31-.18-.65-.18-1a3 3 0 00-3-3 3 3 0 00-3 3c0 .35.07.69.18 1h1.36c.11-.31.18-.65.18-1a3 3 0 003-3z" />
    </SvgIcon>
  );
}

function FlashIcon(props: React.ComponentProps<typeof SvgIcon>) {
  return (
    <SvgIcon {...props}>
      <path d="M7 2v11h3v9l7-12h-4l4-8z" />
    </SvgIcon>
  );
}

export function IntegrationsPage() {
  const queryClient = useQueryClient();
  // Credential references live under the caller's own tenant in the vault.
  const tenantRef = useMe().data?.tenantId ?? 'tenant';
  const [envFilter, setEnvFilter] = useState<'ALL' | IntegrationEnvironment>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState<IntegrationConnection | null>(null);

  // Form State
  const [formProvider, setFormProvider] = useState('TWILIO');
  const [formCapability, setFormCapability] = useState('MESSAGING.SMS');
  const [formEnv, setFormEnv] = useState<IntegrationEnvironment>('SANDBOX');
  const [formCredRef, setFormCredRef] = useState(`vault://tenants/${tenantRef}/sandbox/twilio/credentials`);
  const [formConfigJson, setFormConfigJson] = useState('{\n  "senderId": "DSACRM",\n  "timeoutMs": 5000\n}');
  const [formStatus, setFormStatus] = useState<IntegrationStatus>('ACTIVE');
  const [formError, setFormError] = useState<string | null>(null);

  // Queries
  const integrationsQuery = useQuery({
    queryKey: ['integrations', envFilter],
    queryFn: () => fetchIntegrations(envFilter === 'ALL' ? undefined : { environment: envFilter }),
  });

  const capabilitiesQuery = useQuery({
    queryKey: ['integration-capabilities'],
    queryFn: fetchCapabilities,
  });

  // Ping Mutation
  const pingMutation = useMutation({
    meta: { successMessage: 'Connection tested.' },
    mutationFn: ({ provider, capability }: { provider: string; capability: string }) =>
      pingIntegration(provider, capability),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });

  // Save Mutation
  const saveMutation = useMutation({
    meta: { successMessage: 'Integration saved.' },
    mutationFn: async () => {
      let parsedConfig: Record<string, unknown> = {};
      try {
        parsedConfig = JSON.parse(formConfigJson);
      } catch {
        throw new Error('Configuration must be valid JSON');
      }

      const payload: ConfigureIntegrationRequest = {
        capability: formCapability,
        environment: formEnv,
        credentialRef: formCredRef,
        config: parsedConfig,
        status: formStatus,
      };

      const etag = selectedConnection ? `"${selectedConnection.lockVersion}"` : undefined;
      return configureIntegration(formProvider, payload, etag);
    },
    onSuccess: () => {
      setConfigDialogOpen(false);
      setSelectedConnection(null);
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const handleOpenNewDialog = () => {
    setSelectedConnection(null);
    setFormProvider('TWILIO');
    setFormCapability('MESSAGING.SMS');
    setFormEnv('SANDBOX');
    setFormCredRef(`vault://tenants/${tenantRef}/sandbox/twilio/credentials`);
    setFormConfigJson('{\n  "senderId": "DSACRM",\n  "timeoutMs": 5000\n}');
    setFormStatus('ACTIVE');
    setFormError(null);
    setConfigDialogOpen(true);
  };

  const handleEdit = (conn: IntegrationConnection) => {
    setSelectedConnection(conn);
    setFormProvider(conn.provider);
    setFormCapability(conn.capability);
    setFormEnv(conn.environment);
    setFormCredRef(conn.credentialRef);
    setFormConfigJson(JSON.stringify(conn.config, null, 2));
    setFormStatus(conn.status);
    setFormError(null);
    setConfigDialogOpen(true);
  };

  const connections = integrationsQuery.data?.data ?? [];
  const filteredConnections = connections.filter((c) => {
    if (categoryFilter === 'ALL') return true;
    return c.capability.startsWith(categoryFilter);
  });

  const totalCount = connections.length;
  const activeCount = connections.filter((c) => c.status === 'ACTIVE').length;
  const healthyCount = connections.filter((c) => c.health?.healthy).length;
  const capabilitiesCount = capabilitiesQuery.data?.data.length ?? 6;

  return (
    <Box sx={{ p: 3, maxWidth: 1400, margin: '0 auto' }}>
      <PageHeader
        title="Integration Management &amp; Adapter Framework"
        badge={
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip label="MOD-INT" color="primary" variant="outlined" size="small" sx={{ fontWeight: 600, fontSize: '0.75rem' }} />
            <Chip label="DOM-M" color="secondary" variant="outlined" size="small" sx={{ fontWeight: 600, fontSize: '0.75rem' }} />
            <Chip label="SUB-INT.01" size="small" sx={{ fontWeight: 600, fontSize: '0.75rem' }} />
          </Stack>
        }
        subtitle="Centralized third-party provider adapters, capability descriptors, sandbox boundaries & zero plaintext credential management."
        actions={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Button
              variant="contained"
              color="primary"
              startIcon={<HubIcon />}
              onClick={handleOpenNewDialog}
              sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
            >
              Configure Integration
            </Button>
            <Tooltip title="Refresh Feeds">
              <IconButton
                onClick={() => queryClient.invalidateQueries({ queryKey: ['integrations'] })}
                color="primary"
                sx={{ border: '1px solid #e0e0e0' }}
              >
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          </Box>
        }
      />

      {/* Security Callout */}
      <Alert severity="info" sx={{ mb: 3 }} icon={<SecurityIcon />}>
        <strong>Classification S4 Protection:</strong> Stored configurations strictly contain opaque vault
        references (<code>credential_ref</code>). Zero passwords, API keys, or secret tokens are ever exposed
        or entered here. Live secrets resolve strictly through the platform vault port.
      </Alert>

      {/* KPI Stats */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent sx={{ pb: '16px !important' }}>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>
                CONFIGURED INTEGRATIONS
              </Typography>
              <Typography variant="h4" fontWeight={700} sx={{ mt: 0.5, color: 'primary.main' }}>
                {totalCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Across registered providers
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent sx={{ pb: '16px !important' }}>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>
                ACTIVE ADAPTERS
              </Typography>
              <Typography variant="h4" fontWeight={700} sx={{ mt: 0.5, color: 'success.main' }}>
                {activeCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Ready for live/sandbox execution
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent sx={{ pb: '16px !important' }}>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>
                OPERATIONAL HEALTH
              </Typography>
              <Typography
                variant="h4"
                fontWeight={700}
                sx={{ mt: 0.5, color: healthyCount === totalCount ? 'success.main' : 'warning.main' }}
              >
                {healthyCount} / {totalCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Passing real-time latency probes
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent sx={{ pb: '16px !important' }}>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>
                STANDARDIZED CAPABILITIES
              </Typography>
              <Typography variant="h4" fontWeight={700} sx={{ mt: 0.5, color: 'info.main' }}>
                {capabilitiesCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Messaging, KYC, Storage, Banking
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filter Tabs */}
      <Paper elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', mb: 3, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2 }}>
          <Tabs
            value={envFilter}
            onChange={(_, val) => setEnvFilter(val)}
            sx={{ '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, minHeight: 48 } }}
          >
            <Tab label="All Environments" value="ALL" />
            <Tab label="Sandbox (Isolated)" value="SANDBOX" />
            <Tab label="Production" value="PRODUCTION" />
          </Tabs>

          <Stack direction="row" spacing={1}>
            {['ALL', 'MESSAGING', 'VERIFICATION', 'STORAGE'].map((cat) => (
              <Chip
                key={cat}
                label={cat}
                clickable
                color={categoryFilter === cat ? 'primary' : 'default'}
                variant={categoryFilter === cat ? 'filled' : 'outlined'}
                size="small"
                onClick={() => setCategoryFilter(cat)}
              />
            ))}
          </Stack>
        </Box>
      </Paper>

      {/* Integrations Table */}
      <Card variant="outlined" sx={{ borderRadius: 2, mb: 4 }}>
        <CardContent sx={{ p: 0 }}>
          {integrationsQuery.isLoading ? (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <CircularProgress size={32} />
            </Box>
          ) : filteredConnections.length === 0 ? (
            <Box sx={{ p: 6, textAlign: 'center' }}>
              <Typography variant="body1" color="text.secondary">
                No integration connections match the selected environment or category filters.
              </Typography>
              <Button variant="outlined" sx={{ mt: 2, textTransform: 'none' }} onClick={handleOpenNewDialog}>
                Configure a New Provider Connection
              </Button>
            </Box>
          ) : (
            <DataTable<(typeof filteredConnections)[number]>
              dataTestId="int.table.connections"
              data={filteredConnections}
              keyExtractor={(conn) => conn.id}
              columns={[
                {
                  id: 'provider',
                  header: 'Provider & Connection ID',
                  render: (conn) => (
                    <>
                      <Typography variant="subtitle2" fontWeight={700}>
                        {conn.provider}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {conn.id} (v{conn.lockVersion})
                      </Typography>
                    </>
                  ),
                },
                {
                  id: 'capability',
                  header: 'Standard Capability',
                  render: (conn) => (
                    <Chip label={conn.capability} size="small" variant="outlined" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }} />
                  ),
                },
                {
                  id: 'environment',
                  header: 'Environment',
                  render: (conn) => (
                    <Chip
                      label={conn.environment}
                      size="small"
                      color={conn.environment === 'PRODUCTION' ? 'secondary' : 'default'}
                      sx={{ fontWeight: 600, fontSize: '0.7rem' }}
                    />
                  ),
                },
                {
                  id: 'credential',
                  header: 'Vault Credential Reference',
                  render: (conn) => (
                    <Tooltip title={conn.credentialRef} arrow>
                      <Typography
                        variant="body2"
                        sx={{
                          fontFamily: 'monospace',
                          fontSize: '0.75rem',
                          color: 'primary.dark',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {conn.credentialRef}
                      </Typography>
                    </Tooltip>
                  ),
                },
                {
                  id: 'health',
                  header: 'Health & Latency',
                  render: (conn) =>
                    conn.health ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip
                          label={conn.health.healthy ? 'HEALTHY' : 'UNHEALTHY'}
                          size="small"
                          color={conn.health.healthy ? 'success' : 'error'}
                          sx={{ fontWeight: 600, fontSize: '0.65rem' }}
                        />
                        <Typography variant="caption" color="text.secondary">
                          {conn.health.latencyMs}ms
                        </Typography>
                      </Box>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        Not pinged yet
                      </Typography>
                    ),
                },
                {
                  id: 'status',
                  header: 'Status',
                  render: (conn) => (
                    <Chip
                      label={conn.status}
                      size="small"
                      color={conn.status === 'ACTIVE' ? 'success' : conn.status === 'DEGRADED' ? 'warning' : 'default'}
                      variant="outlined"
                      sx={{ fontWeight: 600 }}
                    />
                  ),
                },
                {
                  id: 'actions',
                  header: 'Actions',
                  align: 'right',
                  render: (conn) => (
                    <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ whiteSpace: 'nowrap' }}>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<FlashIcon />}
                        onClick={() => pingMutation.mutate({ provider: conn.provider, capability: conn.capability })}
                        disabled={pingMutation.isPending}
                        sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                      >
                        Ping
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => handleEdit(conn)}
                        sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                      >
                        Edit
                      </Button>
                    </Stack>
                  ),
                },
              ]}
            />
          )}
        </CardContent>
      </Card>

      {/* Capability Descriptors Catalog Section */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="h6" fontWeight={700} gutterBottom>
          Declared Platform Capability Descriptors
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Standardized capabilities supported by the DSA CRM Adapter Framework. Every adapter explicitly
          implements one or more capabilities.
        </Typography>

        <Grid container spacing={2}>
          {(capabilitiesQuery.data?.data ?? []).map((cap) => (
            <Grid item xs={12} sm={6} md={4} key={cap.capability}>
              <Card variant="outlined" sx={{ borderRadius: 2, height: '100%' }}>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="subtitle1" fontWeight={700}>
                      {cap.displayName}
                    </Typography>
                    <Chip label={cap.category} size="small" color="primary" variant="outlined" />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    <code>{cap.capability}</code> • Class: <strong>{cap.dataClassification}</strong>
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    {cap.description}
                  </Typography>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="caption" color="text.secondary" fontWeight={600}>
                    Supported Providers:
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                    {cap.supportedProviders.map((p) => (
                      <Chip key={p} label={p} size="small" sx={{ fontSize: '0.7rem' }} />
                    ))}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* Configure Integration Modal Dialog */}
      <Dialog
        open={configDialogOpen}
        onClose={() => setConfigDialogOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          {selectedConnection ? `Edit Integration: ${formProvider}` : 'Configure New Integration Connection'}
        </DialogTitle>
        <DialogContent dividers>
          {formError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {formError}
            </Alert>
          )}

          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Provider</InputLabel>
                <Select
                  value={formProvider}
                  label="Provider"
                  disabled={!!selectedConnection}
                  onChange={(e) => {
                    const p = e.target.value;
                    setFormProvider(p);
                    setFormCredRef(
                      `vault://tenants/${tenantRef}/${formEnv.toLowerCase()}/${p.toLowerCase()}/credentials`,
                    );
                  }}
                >
                  <MenuItem value="TWILIO">Twilio (SMS / WhatsApp)</MenuItem>
                  <MenuItem value="KARZA">Karza (Identity &amp; PAN/GST Verification)</MenuItem>
                  <MenuItem value="SUREPASS">SurePass (Bureau / KYC)</MenuItem>
                  <MenuItem value="SETU">Setu (Penny-Drop Banking)</MenuItem>
                  <MenuItem value="MOCK">Mock Test Provider (Sandbox Testing)</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Standard Capability</InputLabel>
                <Select
                  value={formCapability}
                  label="Standard Capability"
                  disabled={!!selectedConnection}
                  onChange={(e) => setFormCapability(e.target.value)}
                >
                  <MenuItem value="MESSAGING.SMS">MESSAGING.SMS</MenuItem>
                  <MenuItem value="MESSAGING.WHATSAPP">MESSAGING.WHATSAPP</MenuItem>
                  <MenuItem value="VERIFICATION.PAN">VERIFICATION.PAN</MenuItem>
                  <MenuItem value="VERIFICATION.GST">VERIFICATION.GST</MenuItem>
                  <MenuItem value="VERIFICATION.BANK">VERIFICATION.BANK</MenuItem>
                  <MenuItem value="STORAGE.DOC_SCAN">STORAGE.DOC_SCAN</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Target Environment</InputLabel>
                <Select
                  value={formEnv}
                  label="Target Environment"
                  onChange={(e) => {
                    const env = e.target.value as IntegrationEnvironment;
                    setFormEnv(env);
                    setFormCredRef(
                      `vault://tenants/${tenantRef}/${env.toLowerCase()}/${formProvider.toLowerCase()}/credentials`,
                    );
                  }}
                >
                  <MenuItem value="SANDBOX">SANDBOX (Isolated Non-Production)</MenuItem>
                  <MenuItem value="PRODUCTION">PRODUCTION (Live External API)</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Connection Status</InputLabel>
                <Select
                  value={formStatus}
                  label="Connection Status"
                  onChange={(e) => setFormStatus(e.target.value as IntegrationStatus)}
                >
                  <MenuItem value="ACTIVE">ACTIVE</MenuItem>
                  <MenuItem value="INACTIVE">INACTIVE</MenuItem>
                  <MenuItem value="DEGRADED">DEGRADED</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                size="small"
                label="Opaque Vault Credential Reference (Classification S4)"
                value={formCredRef}
                onChange={(e) => setFormCredRef(e.target.value)}
                helperText="Must follow vault://tenants/{tenant_id}/{env}/{provider}/credentials. No plaintext keys allowed."
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={4}
                size="small"
                label="Provider Configuration (JSON - Non-Secret Settings)"
                value={formConfigJson}
                onChange={(e) => setFormConfigJson(e.target.value)}
                helperText="Endpoints, timeouts, and template IDs only. Raw API keys or secrets will be rejected with 422."
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setConfigDialogOpen(false)} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            {saveMutation.isPending ? 'Saving...' : 'Save Configuration'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
