// apps/web/src/features/api-management/ApiManagementPage.tsx — owner: Akash (Module 36: API Management MOD-API)
import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
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
  OutlinedInput,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  Alert,
  CircularProgress,
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

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
      {/* Title Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ color: 'primary.main', mb: 0.5 }}>
            API Management & Credentials
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Module 36 (MOD-API): Manage partner API credentials, configure per-client rate limits, assign
            granular scopes, and rotate client secrets.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData} disabled={loading}>
            Refresh
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateDialogOpen(true)}>
            Register API Client
          </Button>
        </Box>
      </Box>

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

      {/* Metric Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={2}>
            <CardContent>
              <Typography variant="caption" color="text.secondary" textTransform="uppercase">
                Registered Clients
              </Typography>
              <Typography variant="h4" fontWeight={700}>
                {clients.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={2}>
            <CardContent>
              <Typography variant="caption" color="text.secondary" textTransform="uppercase">
                Active Integrations
              </Typography>
              <Typography variant="h4" fontWeight={700} color="success.main">
                {activeClientsCount}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={2}>
            <CardContent>
              <Typography variant="caption" color="text.secondary" textTransform="uppercase">
                Authentication Mode
              </Typography>
              <Typography variant="h6" fontWeight={700}>
                Client Credentials & HMAC
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={2}>
            <CardContent>
              <Typography variant="caption" color="text.secondary" textTransform="uppercase">
                Multi-Tenancy Isolation
              </Typography>
              <Typography variant="h6" fontWeight={700} color="primary.main">
                RLS Enforced (app.tenant_id)
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Clients Table */}
      <Paper elevation={2}>
        <TableContainer>
          <Table size="medium">
            <TableHead sx={{ backgroundColor: 'action.hover' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Client / App Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Partner Organisation</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Client ID</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Scopes</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Rate Limit</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>
                  Actions
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && clients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                    <CircularProgress size={32} />
                  </TableCell>
                </TableRow>
              ) : clients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">No API clients registered yet.</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                clients.map((client) => (
                  <TableRow key={client.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {client.name}
                      </Typography>
                      {client.allowedIps && client.allowedIps.length > 0 && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          IPs: {client.allowedIps.join(', ')}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{client.partnerName}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontFamily="monospace" fontWeight={600}>
                        {client.clientId}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {client.scopes.map((s) => (
                          <Chip key={s} size="small" variant="outlined" label={s} />
                        ))}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{client.rateLimitRpm} RPM</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={client.status}
                        color={
                          client.status === 'ACTIVE'
                            ? 'success'
                            : client.status === 'SUSPENDED'
                              ? 'warning'
                              : 'error'
                        }
                      />
                    </TableCell>
                    <TableCell align="right">
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
                      <IconButton
                        size="small"
                        color="error"
                        sx={{ ml: 1 }}
                        onClick={() => handleDeleteClient(client.id)}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

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
            onChange={(e) => setRateLimitRpm(Math.max(1, Number(e.target.value)))}
            inputProps={{ min: 1 }}
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
