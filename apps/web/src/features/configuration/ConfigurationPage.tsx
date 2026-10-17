import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { createBranch, fetchBranches, fetchTenantConfig, updateBranch, updateTenantConfig } from './api';
import type {
  BranchConfig,
  CreateBranchInput,
  OrganisationConstitution,
  RoutingMode,
  TenantConfigSummary,
} from './types';

export function ConfigurationPage() {
  const [activeTab, setActiveTab] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Tenant Config State
  const [config, setConfig] = useState<TenantConfigSummary | null>(null);
  const [configEtag, setConfigEtag] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState<boolean>(false);

  // Form editable state for config
  const [orgName, setOrgName] = useState<string>('');
  const [constitution, setConstitution] = useState<OrganisationConstitution>('PVT_LTD');
  const [timezone, setTimezone] = useState<string>('Asia/Kolkata');
  const [defaultSla, setDefaultSla] = useState<number>(15);
  const [routingMode, setRoutingMode] = useState<RoutingMode>('ROUND_ROBIN');
  const [hoursStart, setHoursStart] = useState<string>('09:30');
  const [hoursEnd, setHoursEnd] = useState<string>('18:30');
  const [retentionDays, setRetentionDays] = useState<number>(365);

  // Branches State
  const [branches, setBranches] = useState<BranchConfig[]>([]);
  const [branchModalOpen, setBranchModalOpen] = useState<boolean>(false);
  const [editingBranch, setEditingBranch] = useState<BranchConfig | null>(null);
  const [branchFormCode, setBranchFormCode] = useState<string>('');
  const [branchFormName, setBranchFormName] = useState<string>('');
  const [branchFormPincode, setBranchFormPincode] = useState<string>('');
  const [branchFormTimezone, setBranchFormTimezone] = useState<string>('Asia/Kolkata');
  const [branchFormStatus, setBranchFormStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [branchModalError, setBranchModalError] = useState<string | null>(null);
  const [savingBranch, setSavingBranch] = useState<boolean>(false);

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [cfgRes, branchRes] = await Promise.all([fetchTenantConfig(), fetchBranches()]);

      setConfig(cfgRes.data);
      setConfigEtag(cfgRes.etag);

      // Populate config edit form
      setOrgName(cfgRes.data.organisation.legalName);
      setConstitution(cfgRes.data.organisation.constitution);
      setTimezone(cfgRes.data.tenant.timezone);
      setDefaultSla(cfgRes.data.operationalSettings.defaultSlaMinutes);
      setRoutingMode(cfgRes.data.operationalSettings.leadRoutingMode);
      setHoursStart(cfgRes.data.operationalSettings.businessHoursStart);
      setHoursEnd(cfgRes.data.operationalSettings.businessHoursEnd);
      setRetentionDays(cfgRes.data.operationalSettings.dataRetentionDays);

      setBranches(branchRes.data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load configuration data.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    try {
      setSavingConfig(true);
      setError(null);
      setSuccessMsg(null);

      const updated = await updateTenantConfig(
        {
          organisationName: orgName.trim(),
          constitution,
          timezone: timezone.trim(),
          operationalSettings: {
            defaultSlaMinutes: Number(defaultSla),
            leadRoutingMode: routingMode,
            businessHoursStart: hoursStart,
            businessHoursEnd: hoursEnd,
            dataRetentionDays: Number(retentionDays),
          },
        },
        configEtag,
      );

      setConfig(updated.data);
      setConfigEtag(updated.etag);
      setSuccessMsg('Configuration successfully updated.');
    } catch (err: any) {
      setError(err?.message || 'Failed to update configuration.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleOpenAddBranch = () => {
    setEditingBranch(null);
    setBranchFormCode('');
    setBranchFormName('');
    setBranchFormPincode('');
    setBranchFormTimezone('Asia/Kolkata');
    setBranchFormStatus('ACTIVE');
    setBranchModalError(null);
    setBranchModalOpen(true);
  };

  const handleOpenEditBranch = (b: BranchConfig) => {
    setEditingBranch(b);
    setBranchFormCode(b.code);
    setBranchFormName(b.name);
    setBranchFormPincode(b.pincode || '');
    setBranchFormTimezone(b.timezone || 'Asia/Kolkata');
    setBranchFormStatus(b.status);
    setBranchModalError(null);
    setBranchModalOpen(true);
  };

  const handleSaveBranch = async () => {
    try {
      setSavingBranch(true);
      setBranchModalError(null);

      // Validate inputs
      if (!editingBranch) {
        if (!/^[A-Z0-9_-]{2,20}$/.test(branchFormCode.trim())) {
          setBranchModalError(
            'Branch code must be 2-20 uppercase letters, numbers, hyphens, or underscores (e.g. MUM01).',
          );
          setSavingBranch(false);
          return;
        }
      }

      if (branchFormName.trim().length < 2) {
        setBranchModalError('Branch name must be at least 2 characters long.');
        setSavingBranch(false);
        return;
      }

      if (branchFormPincode.trim() && !/^[1-9][0-9]{5}$/.test(branchFormPincode.trim())) {
        setBranchModalError('Pincode must be 6 digits and start with 1-9 (e.g. 400001).');
        setSavingBranch(false);
        return;
      }

      if (editingBranch) {
        // Update branch
        await updateBranch(
          editingBranch.id,
          {
            name: branchFormName.trim(),
            pincode: branchFormPincode.trim() || null,
            timezone: branchFormTimezone.trim(),
            status: branchFormStatus,
          },
          `"${editingBranch.lockVersion}"`,
        );
        setSuccessMsg(`Branch '${editingBranch.code}' updated successfully.`);
      } else {
        // Create branch
        await createBranch({
          code: branchFormCode.trim(),
          name: branchFormName.trim(),
          pincode: branchFormPincode.trim() || null,
          timezone: branchFormTimezone.trim(),
        });
        setSuccessMsg(`Branch '${branchFormCode.trim()}' created successfully.`);
      }

      setBranchModalOpen(false);
      // Reload branch list
      const branchRes = await fetchBranches();
      setBranches(branchRes.data);
    } catch (err: any) {
      setBranchModalError(err?.message || 'Failed to save branch.');
    } finally {
      setSavingBranch(false);
    }
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" fontWeight={700} gutterBottom>
          Tenant Configuration & Settings
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Module 6: Manage organization parameters, operational SLAs, lead routing, and branches.
        </Typography>
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

      <Paper sx={{ mb: 3 }}>
        <Tabs
          value={activeTab}
          onChange={(_e, v) => setActiveTab(v)}
          indicatorColor="primary"
          textColor="primary"
          variant="fullWidth"
        >
          <Tab label="Organization & Operations" />
          <Tab label="Branch Management" />
          <Tab label="Security & Data Governance" />
        </Tabs>
      </Paper>

      {/* Tab 0: Organization & Operations */}
      {activeTab === 0 && config && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={5}>
            <Card sx={{ height: '100%', borderRadius: 2 }}>
              <CardHeader title="Tenant Profile" subheader="Multi-tenant registration & identity" />
              <Divider />
              <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Tenant ID
                  </Typography>
                  <Typography variant="body1" fontFamily="monospace">
                    {config.tenant.id}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Slug
                  </Typography>
                  <Typography variant="body1" fontWeight={600}>
                    {config.tenant.slug}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Tenant Type
                  </Typography>
                  <Typography variant="body1">
                    <Chip label={config.tenant.tenantType} color="primary" size="small" />
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Data Region
                  </Typography>
                  <Typography variant="body1">
                    {config.tenant.dataRegion} (India - Local Residency)
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Account Status
                  </Typography>
                  <Typography variant="body1">
                    <Chip
                      label={config.tenant.status}
                      color={config.tenant.status === 'ACTIVE' ? 'success' : 'default'}
                      size="small"
                    />
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Created At
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {new Date(config.tenant.createdAt).toLocaleString()}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={7}>
            <Card sx={{ borderRadius: 2 }}>
              <CardHeader
                title="Organization & Operational Settings"
                subheader="Configure legal entity and operational defaults"
              />
              <Divider />
              <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                <TextField
                  label="Organisation Legal Name"
                  fullWidth
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  helperText="Full registered company name (min 2 characters)"
                />

                <FormControl fullWidth>
                  <InputLabel id="constitution-label">Legal Constitution</InputLabel>
                  <Select
                    labelId="constitution-label"
                    value={constitution}
                    label="Legal Constitution"
                    onChange={(e) => setConstitution(e.target.value as OrganisationConstitution)}
                  >
                    <MenuItem value="PROPRIETORSHIP">Proprietorship</MenuItem>
                    <MenuItem value="PARTNERSHIP">Partnership</MenuItem>
                    <MenuItem value="LLP">Limited Liability Partnership (LLP)</MenuItem>
                    <MenuItem value="PVT_LTD">Private Limited Company (Pvt Ltd)</MenuItem>
                    <MenuItem value="PUBLIC_LTD">Public Limited Company</MenuItem>
                    <MenuItem value="TRUST">Trust</MenuItem>
                    <MenuItem value="OTHER">Other</MenuItem>
                  </Select>
                </FormControl>

                <TextField
                  label="Primary Timezone"
                  fullWidth
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  helperText="IANA timezone string (e.g. Asia/Kolkata)"
                />

                <Divider sx={{ my: 1 }}>
                  <Chip label="Operational Parameters" size="small" />
                </Divider>

                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Default SLA (Minutes)"
                      type="number"
                      fullWidth
                      value={defaultSla}
                      onChange={(e) => setDefaultSla(Number(e.target.value))}
                      helperText="Response SLA for new leads (1-1440 min)"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel id="routing-mode-label">Lead Routing Mode</InputLabel>
                      <Select
                        labelId="routing-mode-label"
                        value={routingMode}
                        label="Lead Routing Mode"
                        onChange={(e) => setRoutingMode(e.target.value as RoutingMode)}
                      >
                        <MenuItem value="ROUND_ROBIN">Round Robin (Automatic)</MenuItem>
                        <MenuItem value="MANUAL">Manual Assignment</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={6}>
                    <TextField
                      label="Business Hours Start"
                      fullWidth
                      value={hoursStart}
                      onChange={(e) => setHoursStart(e.target.value)}
                      placeholder="09:30"
                      helperText="HH:MM format (24-hour)"
                    />
                  </Grid>
                  <Grid item xs={6}>
                    <TextField
                      label="Business Hours End"
                      fullWidth
                      value={hoursEnd}
                      onChange={(e) => setHoursEnd(e.target.value)}
                      placeholder="18:30"
                      helperText="HH:MM format (24-hour)"
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      label="Data Retention (Days)"
                      type="number"
                      fullWidth
                      value={retentionDays}
                      onChange={(e) => setRetentionDays(Number(e.target.value))}
                      helperText="Compliance archive retention window (min 30 days)"
                    />
                  </Grid>
                </Grid>

                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 1 }}>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={handleSaveConfig}
                    disabled={savingConfig}
                  >
                    {savingConfig ? 'Saving...' : 'Save Configuration'}
                  </Button>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Tab 1: Branch Management */}
      {activeTab === 1 && (
        <Card sx={{ borderRadius: 2 }}>
          <CardHeader
            title="Branch Network"
            subheader="Manage physical offices and service hubs across India"
            action={
              <Button variant="contained" color="primary" onClick={handleOpenAddBranch}>
                + Add New Branch
              </Button>
            }
          />
          <Divider />
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Branch Code</TableCell>
                  <TableCell>Branch Name</TableCell>
                  <TableCell>Pincode</TableCell>
                  <TableCell>Timezone</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {branches.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      No branches found for this tenant.
                    </TableCell>
                  </TableRow>
                ) : (
                  branches.map((b) => (
                    <TableRow key={b.id} hover>
                      <TableCell sx={{ fontWeight: 600, fontFamily: 'monospace' }}>{b.code}</TableCell>
                      <TableCell>{b.name}</TableCell>
                      <TableCell>{b.pincode || '—'}</TableCell>
                      <TableCell>{b.timezone}</TableCell>
                      <TableCell>
                        <Chip
                          label={b.status}
                          color={b.status === 'ACTIVE' ? 'success' : 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Button variant="outlined" size="small" onClick={() => handleOpenEditBranch(b)}>
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      {/* Tab 2: Security & Data Governance */}
      {activeTab === 2 && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card sx={{ borderRadius: 2 }}>
              <CardHeader
                title="Data Residency & Isolation"
                subheader="Gate-0 certified architectural guarantees"
              />
              <Divider />
              <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Typography variant="body2">
                  <strong>Tenant Partitioning:</strong> All tables enforce PostgreSQL Row-Level Security (RLS)
                  with fail-closed tenant scoping (<code>app_tenant()</code>).
                </Typography>
                <Typography variant="body2">
                  <strong>Data Residency:</strong> Tenant data is strictly stored in Region <code>IN</code>{' '}
                  (India), compliant with RBI Digital Lending guidelines.
                </Typography>
                <Typography variant="body2">
                  <strong>Cryptographic Tokens:</strong> Sensitive credentials, IDP secrets, and bearer tokens
                  are never returned across API interfaces or stored on browser clients.
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={6}>
            <Card sx={{ borderRadius: 2 }}>
              <CardHeader
                title="Audit & Compliance Safeguards"
                subheader="Governance policies and change traceability"
              />
              <Divider />
              <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Typography variant="body2">
                  <strong>Optimistic Concurrency:</strong> Changes use version locks (
                  <code>lock_version</code> with <code>If-Match</code> headers) to prevent concurrent write
                  collisions.
                </Typography>
                <Typography variant="body2">
                  <strong>Access Segregation:</strong> Configuration modifications are strictly guarded by the{' '}
                  <code>config.manage</code> role grant.
                </Typography>
                <Typography variant="body2">
                  <strong>Audit Log:</strong> Every profile update records <code>updated_by</code> and{' '}
                  <code>updated_at</code> timestamps in the immutable schema.
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Branch Modal (Add / Edit) */}
      <Dialog open={branchModalOpen} onClose={() => setBranchModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingBranch ? `Edit Branch (${editingBranch.code})` : 'Add New Branch'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {branchModalError && (
            <Alert severity="error" onClose={() => setBranchModalError(null)}>
              {branchModalError}
            </Alert>
          )}

          {!editingBranch && (
            <TextField
              label="Branch Code"
              fullWidth
              value={branchFormCode}
              onChange={(e) => setBranchFormCode(e.target.value.toUpperCase())}
              helperText="2-20 uppercase chars matching ^[A-Z0-9_-]{2,20}$ (e.g. MUM01)"
            />
          )}

          <TextField
            label="Branch Name"
            fullWidth
            value={branchFormName}
            onChange={(e) => setBranchFormName(e.target.value)}
            helperText="e.g. Mumbai Central"
          />

          <TextField
            label="Postal Pincode"
            fullWidth
            value={branchFormPincode}
            onChange={(e) => setBranchFormPincode(e.target.value)}
            helperText="6-digit Indian PIN code (e.g. 400001)"
          />

          <TextField
            label="Timezone"
            fullWidth
            value={branchFormTimezone}
            onChange={(e) => setBranchFormTimezone(e.target.value)}
            helperText="e.g. Asia/Kolkata"
          />

          {editingBranch && (
            <FormControl fullWidth>
              <InputLabel id="branch-status-label">Branch Status</InputLabel>
              <Select
                labelId="branch-status-label"
                value={branchFormStatus}
                label="Branch Status"
                onChange={(e) => setBranchFormStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
              >
                <MenuItem value="ACTIVE">Active</MenuItem>
                <MenuItem value="INACTIVE">Inactive</MenuItem>
              </Select>
            </FormControl>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBranchModalOpen(false)} disabled={savingBranch}>
            Cancel
          </Button>
          <Button variant="contained" color="primary" onClick={handleSaveBranch} disabled={savingBranch}>
            {savingBranch ? 'Saving...' : editingBranch ? 'Save Changes' : 'Create Branch'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
