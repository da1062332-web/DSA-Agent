// apps/web/src/features/api-management/ApiManagementPage.tsx — owner: Akash (Module 36: API Management MOD-API)
import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  TextField,
  Tooltip,
  Typography,
  Alert,
} from '@mui/material';
import {
  KeyIcon,
  AddIcon,
  RefreshIcon,
  AutorenewIcon,
  ContentCopyIcon,
  DeleteOutlineIcon,
  CheckCircleIcon,
  ShieldIcon as SecurityIcon,
} from '../../shell/icons';
import { DataTable, DetailCard, FilterToolbar, PageHeader, StatCard, StatCardGrid, StatusBadge } from '../../ui';
import type { ColumnDef } from '../../ui';
import type { ApiClientResponse, CreateApiClientInput } from '@dsa/contracts';
import { listApiClients, createApiClient, rotateClientSecret, updateApiClient, deleteApiClient } from './api';

const AVAILABLE_SCOPES = [
  'partner.lead_ingest',
  'partner.application_read',
  'webhook.manage',
  'api.read',
  'api.manage',
];

export function ApiManagementPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [clients, setClients] = useState<ApiClientResponse[]>([]);
  const [search, setSearch] = useState('');

  // Create Client Dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['partner.lead_ingest']);
  const [rateLimitRpm, setRateLimitRpm] = useState<number>(120);
  const [allowedIpsStr, setAllowedIpsStr] = useState('');

  // One-Time Secret Reveal Modal
  const [secretRevealModalOpen, setSecretRevealModalOpen] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string>('');
  const [revealedClientId, setRevealedClientId] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // Rotate Secret Dialog
  const [rotateDialogOpen, setRotateDialogOpen] = useState(false);
  const [clientToRotate, setClientToRotate] = useState<ApiClientResponse | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listApiClients();
      setClients(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load API clients');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateClient = async () => {
    if (!name.trim() || !partnerName.trim() || scopes.length === 0) return;
    try {
      setLoading(true);
      const allowedIps = allowedIpsStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const payload: CreateApiClientInput = {
        name: name.trim(),
        partnerName: partnerName.trim(),
        scopes,
        rateLimitRpm: Number(rateLimitRpm) || 120,
        allowedIps: allowedIps.length > 0 ? allowedIps : undefined,
      };

      const created = await createApiClient(payload);
      setCreateDialogOpen(false);
      setName('');
      setPartnerName('');
      setScopes(['partner.lead_ingest']);
      setRateLimitRpm(120);
      setAllowedIpsStr('');

      // Show secret reveal modal with the one-time secret
      if (created.clientSecret) {
        setRevealedSecret(created.clientSecret);
        setRevealedClientId(created.clientId);
        setCopied(false);
        setSecretRevealModalOpen(true);
      }

      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to register API client');
    } finally {
      setLoading(false);
    }
  };

  const handleRotateSecret = async () => {
    if (!clientToRotate) return;
    try {
      setLoading(true);
      const res = await rotateClientSecret(clientToRotate.id);
      setRotateDialogOpen(false);
      setRevealedSecret(res.clientSecret);
      setRevealedClientId(res.clientId);
      setCopied(false);
      setSecretRevealModalOpen(true);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to rotate client secret');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (client: ApiClientResponse) => {
    const nextStatus = client.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    try {
      setLoading(true);
      await updateApiClient(client.id, { status: nextStatus });
      setSuccessMsg(`Client status updated to ${nextStatus}`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update client status');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClient = async (id: string) => {
    try {
      setLoading(true);
      await deleteApiClient(id);
      setSuccessMsg('API client revoked and deleted.');
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to revoke API client');
    } finally {
      setLoading(false);
    }
  };

  const handleCopySecret = () => {
    navigator.clipboard.writeText(revealedSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const activeClientsCount = clients.filter((c) => c.status === 'ACTIVE').length;
  const suspendedClientsCount = clients.filter((c) => c.status !== 'ACTIVE').length;
  const usedLast24h = clients.filter(
    (c) => c.lastUsedAt && Date.now() - new Date(c.lastUsedAt).getTime() < 24 * 60 * 60 * 1000,
  ).length;
  const query = search.trim().toLowerCase();
  const visibleClients = query
    ? clients.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.partnerName.toLowerCase().includes(query) ||
          c.clientId.toLowerCase().includes(query),
      )
    : clients;

  const clientColumns: ColumnDef<ApiClientResponse>[] = [
    {
      id: 'name',
      header: 'Client / App Name',
      render: (client) => (
        <>
          <Typography variant="body2" fontWeight={600}>
            {client.name}
          </Typography>
          {client.allowedIps && client.allowedIps.length > 0 && (
            <Typography variant="caption" color="text.secondary" display="block">
              IPs: {client.allowedIps.join(', ')}
            </Typography>
          )}
        </>
      ),
    },
    { id: 'partner', header: 'Partner Organisation', render: (client) => client.partnerName },
    {
      id: 'clientId',
      header: 'Client ID',
      render: (client) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="body2" fontFamily="monospace" fontWeight={600}>
            {client.clientId}
          </Typography>
          <Tooltip title="Copy client ID">
            <IconButton
              size="small"
              aria-label={`Copy client ID ${client.clientId}`}
              onClick={() => navigator.clipboard?.writeText(client.clientId)}
            >
              <ContentCopyIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
        </Box>
      ),
    },
    {
      id: 'secret',
      header: 'Client Secret',
      render: () => (
        <Tooltip title="Secrets are stored hashed and cannot be shown again. Rotate to issue a new one.">
          <Chip size="small" variant="outlined" label="Hashed (rotate to reissue)" />
        </Tooltip>
      ),
    },
    {
      id: 'scopes',
      header: 'Scopes',
      render: (client) => (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {client.scopes.map((s) => (
            <Chip key={s} size="small" variant="outlined" label={s} />
          ))}
        </Box>
      ),
    },
    { id: 'rate', header: 'Rate Limit', render: (client) => `${client.rateLimitRpm} RPM` },
    {
      id: 'lastUsed',
      header: 'Last Used',
      render: (client) => (client.lastUsedAt ? new Date(client.lastUsedAt).toLocaleString() : 'Never'),
    },
    {
      id: 'status',
      header: 'Status',
      render: (client) => (
        <StatusBadge
          label={client.status}
          status={client.status === 'ACTIVE' ? 'success' : client.status === 'SUSPENDED' ? 'warning' : 'error'}
        />
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      render: (client) => (
        <>
          <Tooltip title="Rotate Client Secret">
            <IconButton
              size="small"
              color="primary"
              onClick={() => {
                setClientToRotate(client);
                setRotateDialogOpen(true);
              }}
            >
              <AutorenewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Button
            size="small"
            sx={{ ml: 1 }}
            variant="outlined"
            color={client.status === 'ACTIVE' ? 'warning' : 'success'}
            onClick={() => handleToggleStatus(client)}
          >
            {client.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
          </Button>
          <IconButton size="small" color="error" sx={{ ml: 1 }} onClick={() => handleDeleteClient(client.id)}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </>
      ),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="API Management & Credentials"
        subtitle="Manage partner API credentials, configure per-client rate limits, assign granular scopes, and rotate client secrets."
        actions={
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData} disabled={loading}>
              Refresh
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateDialogOpen(true)}>
              Register API Client
            </Button>
          </Box>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {successMsg && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccessMsg(null)}>
          {successMsg}
        </Alert>
      )}

      <StatCardGrid columns={{ xs: 12, sm: 6, md: 3 }}>
        <StatCard title="Registered Clients" value={clients.length} format="number" status="default" subtext={`${suspendedClientsCount} suspended`} />
        <StatCard
          title="Active Integrations"
          value={activeClientsCount}
          format="number"
          status="success"
          subtext={`${usedLast24h} used in the last 24 hours`}
        />
        <StatCard title="Authentication Mode" value="Client Credentials & HMAC" format="raw" status="info" />
        <StatCard title="Multi-Tenancy Isolation" value="RLS Enforced (app.tenant_id)" format="raw" status="primary" />
      </StatCardGrid>

      {/* Clients Table */}
      <DetailCard
        title="Registered Clients"
        subtitle="Partner API clients. Client secrets are shown once at creation and stored hashed after that."
      >
        <FilterToolbar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search by client, partner or client ID"
          searchTestId="api.search"
        />
        <DataTable<ApiClientResponse>
          dataTestId="api.table.clients"
          loading={loading}
          data={visibleClients}
          keyExtractor={(client) => client.id}
          emptyMessage={query ? 'No clients match your search.' : 'No API clients registered yet.'}
          columns={clientColumns}
        />
      </DetailCard>

      {/* Register Client Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Register New API Client</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField
            label="Client Application Name"
            placeholder="e.g. Fintech Portal Connector"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
          />
          <TextField
            label="Partner Organisation Name"
            placeholder="e.g. Alpha Fintech Solutions Ltd."
            value={partnerName}
            onChange={(e) => setPartnerName(e.target.value)}
            fullWidth
            required
          />
          <FormControl fullWidth>
            <InputLabel>Authorized Scopes</InputLabel>
            <Select
              multiple
              value={scopes}
              onChange={(e) =>
                setScopes(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)
              }
              input={<OutlinedInput label="Authorized Scopes" />}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {selected.map((value) => (
                    <Chip key={value} label={value} size="small" />
                  ))}
                </Box>
              )}
            >
              {AVAILABLE_SCOPES.map((sc) => (
                <MenuItem key={sc} value={sc}>
                  {sc}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="Rate Limit (Requests per Minute)"
            type="number"
            value={rateLimitRpm}
            onChange={(e) => setRateLimitRpm(Math.max(10, Math.min(10000, Number(e.target.value))))}
            inputProps={{ min: 10, max: 10000 }}
            onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }}
            helperText="Default 120 RPM (Allowed range: 10 - 10,000)"
            fullWidth
          />
          <TextField
            label="IP Allowlist (Optional)"
            placeholder="e.g. 203.0.113.1, 198.51.100.2"
            value={allowedIpsStr}
            onChange={(e) => setAllowedIpsStr(e.target.value)}
            helperText="Comma-separated IP addresses. Leave empty to allow any IP."
            fullWidth
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!name.trim() || !partnerName.trim() || scopes.length === 0 || loading}
            onClick={handleCreateClient}
          >
            Register Client
          </Button>
        </DialogActions>
      </Dialog>

      {/* One-Time Secret Reveal Modal */}
      <Dialog
        open={secretRevealModalOpen}
        onClose={() => setSecretRevealModalOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SecurityIcon color="warning" />
          Client Credentials Issued
        </DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <Alert severity="warning">
            <strong>Important:</strong> Copy the client secret now. For security reasons, this secret is
            hashed with SHA-256 and will <strong>never be shown again</strong>.
          </Alert>

          <Box>
            <Typography variant="caption" color="text.secondary">
              Client ID
            </Typography>
            <Typography variant="body1" fontFamily="monospace" fontWeight={700}>
              {revealedClientId}
            </Typography>
          </Box>

          <Box>
            <Typography variant="caption" color="text.secondary">
              Client Secret (Unmasked)
            </Typography>
            <Paper
              variant="outlined"
              sx={{
                p: 1.5,
                backgroundColor: 'action.hover',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                wordBreak: 'break-all',
              }}
            >
              <Typography variant="body2" fontFamily="monospace" fontWeight={700} color="primary.main">
                {revealedSecret}
              </Typography>
              <IconButton size="small" onClick={handleCopySecret} color={copied ? 'success' : 'default'}>
                {copied ? <CheckCircleIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
              </IconButton>
            </Paper>
            {copied && (
              <Typography variant="caption" color="success.main" sx={{ mt: 0.5, display: 'block' }}>
                Copied to clipboard!
              </Typography>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button variant="contained" onClick={() => setSecretRevealModalOpen(false)}>
            I Have Saved This Secret
          </Button>
        </DialogActions>
      </Dialog>

      {/* Rotate Secret Confirmation Dialog */}
      <Dialog open={rotateDialogOpen} onClose={() => setRotateDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Rotate Client Secret?</DialogTitle>
        <DialogContent dividers sx={{ pt: 2 }}>
          <Typography variant="body2">
            Are you sure you want to rotate the secret for <strong>{clientToRotate?.name}</strong>?
          </Typography>
          <Typography variant="caption" color="error.main" sx={{ mt: 1, display: 'block' }}>
            The current secret will be immediately invalidated and existing API requests using it will fail.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRotateDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="warning" onClick={handleRotateSecret}>
            Rotate Secret Now
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
