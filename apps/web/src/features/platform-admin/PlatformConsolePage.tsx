// apps/web/src/features/platform-admin/PlatformConsolePage.tsx
// Module 30: Administration and Platform Operations (MOD-ADM) UI Console
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
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  SvgIcon,
} from '@mui/material';

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

function SpeedIcon(props: React.ComponentProps<typeof SvgIcon>) {
  return (
    <SvgIcon {...props}>
      <path d="M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.27-10.43zM10.59 15.41a2 2 0 1 1 2.83-2.83l5.66-8.49-8.49 5.66a2 2 0 0 1 0 2.83z" />
    </SvgIcon>
  );
}

function FlagIcon(props: React.ComponentProps<typeof SvgIcon>) {
  return (
    <SvgIcon {...props}>
      <path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z" />
    </SvgIcon>
  );
}

function StorageIcon(props: React.ComponentProps<typeof SvgIcon>) {
  return (
    <SvgIcon {...props}>
      <path d="M2 20h20v-4H2v4zm2-3h2v2H4v-2zM2 4v4h20V4H2zm4 3H4V5h2v2zm-4 7h20v-4H2v4zm2-3h2v2H4v-2z" />
    </SvgIcon>
  );
}

function WorkIcon(props: React.ComponentProps<typeof SvgIcon>) {
  return (
    <SvgIcon {...props}>
      <path d="M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z" />
    </SvgIcon>
  );
}

function HealthAndSafetyIcon(props: React.ComponentProps<typeof SvgIcon>) {
  return (
    <SvgIcon {...props}>
      <path d="M10.5 13H8v-3h2.5V7.5h3V10H16v3h-2.5v2.5h-3V13zM12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z" />
    </SvgIcon>
  );
}

function VpnKeyIcon(props: React.ComponentProps<typeof SvgIcon>) {
  return (
    <SvgIcon {...props}>
      <path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" />
    </SvgIcon>
  );
}

function NewReleasesIcon(props: React.ComponentProps<typeof SvgIcon>) {
  return (
    <SvgIcon {...props}>
      <path d="M23 12l-2.44-2.78.34-3.68-3.61-.82-1.89-3.18L12 3 8.6 1.54 6.71 4.72l-3.61.81.34 3.68L1 12l2.44 2.78-.34 3.69 3.61.82 1.89 3.18L12 21l3.4 1.46 1.89-3.18 3.61-.82-.34-3.68L23 12zm-10 5h-2v-2h2v2zm0-4h-2V7h2v6z" />
    </SvgIcon>
  );
}

function CheckCircleIcon(props: React.ComponentProps<typeof SvgIcon>) {
  return (
    <SvgIcon {...props}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </SvgIcon>
  );
}

function PauseCircleFilledIcon(props: React.ComponentProps<typeof SvgIcon>) {
  return (
    <SvgIcon {...props}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
    </SvgIcon>
  );
}

function PlayCircleFilledIcon(props: React.ComponentProps<typeof SvgIcon>) {
  return (
    <SvgIcon {...props}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
    </SvgIcon>
  );
}

function WarningAmberIcon(props: React.ComponentProps<typeof SvgIcon>) {
  return (
    <SvgIcon {...props}>
      <path d="M12 5.99L19.53 19H4.47L12 5.99M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z" />
    </SvgIcon>
  );
}
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createSupportAccessRequest,
  discardDeadLetter,
  fetchFeatureFlags,
  fetchJobsAndQueues,
  fetchMasterData,
  fetchPlatformTenants,
  fetchReleases,
  fetchSupportAccessRequests,
  fetchSystemHealth,
  importMasterData,
  pauseQueue,
  replayDeadLetter,
  resumeQueue,
  updateFeatureFlag,
} from './api';

export function PlatformConsolePage() {
  const [tabIndex, setTabIndex] = useState(0);
  const queryClient = useQueryClient();

  // Queries
  const tenantsQuery = useQuery({ queryKey: ['platform-tenants'], queryFn: () => fetchPlatformTenants() });
  const flagsQuery = useQuery({ queryKey: ['platform-flags'], queryFn: fetchFeatureFlags });
  const masterDataQuery = useQuery({ queryKey: ['platform-master-data'], queryFn: () => fetchMasterData() });
  const jobsQuery = useQuery({ queryKey: ['platform-jobs'], queryFn: fetchJobsAndQueues });
  const healthQuery = useQuery({ queryKey: ['platform-health'], queryFn: fetchSystemHealth, refetchInterval: 15000 });
  const supportQuery = useQuery({ queryKey: ['platform-support'], queryFn: () => fetchSupportAccessRequests() });
  const releasesQuery = useQuery({ queryKey: ['platform-releases'], queryFn: fetchReleases });

  // Dialog & Form States
  const [pauseDialogOpen, setPauseDialogOpen] = useState(false);
  const [selectedQueue, setSelectedQueue] = useState('');
  const [pauseReason, setPauseReason] = useState('');

  const [resumeDialogOpen, setResumeDialogOpen] = useState(false);
  const [resumeReason, setResumeReason] = useState('');

  const [supportDialogOpen, setSupportDialogOpen] = useState(false);
  const [supportTenantId, setSupportTenantId] = useState('');
  const [supportReason, setSupportReason] = useState('');
  const [supportIncident, setSupportIncident] = useState('INC-2026-');
  const [supportDuration, setSupportDuration] = useState('2.0');

  const [masterImportDialogOpen, setMasterImportDialogOpen] = useState(false);
  const [importListCode, setImportListCode] = useState('PINCODES');
  const [importCode, setImportCode] = useState('');
  const [importLabel, setImportLabel] = useState('');
  const [importPreviewData, setImportPreviewData] = useState<any>(null);

  // Mutations
  const toggleFlagMutation = useMutation({
    meta: { successMessage: 'Flag updated.' },
    mutationFn: async ({ key, value }: { key: string; value: boolean }) => {
      return updateFeatureFlag(key, { value, scope: 'GLOBAL' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['platform-flags'] }),
  });

  const pauseQueueMutation = useMutation({
    meta: { successMessage: 'Queue paused.' },
    mutationFn: () => pauseQueue(selectedQueue, pauseReason),
    onSuccess: () => {
      setPauseDialogOpen(false);
      setPauseReason('');
      queryClient.invalidateQueries({ queryKey: ['platform-jobs'] });
    },
  });

  const resumeQueueMutation = useMutation({
    meta: { successMessage: 'Queue resumed.' },
    mutationFn: () => resumeQueue(selectedQueue, resumeReason),
    onSuccess: () => {
      setResumeDialogOpen(false);
      setResumeReason('');
      queryClient.invalidateQueries({ queryKey: ['platform-jobs'] });
    },
  });

  const replayDlMutation = useMutation({
    meta: { successMessage: 'Item replayed.' },
    mutationFn: replayDeadLetter,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['platform-jobs'] }),
  });

  const discardDlMutation = useMutation({
    meta: { successMessage: 'Item discarded.' },
    mutationFn: discardDeadLetter,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['platform-jobs'] }),
  });

  const createSupportMutation = useMutation({
    meta: { successMessage: 'Support access requested.' },
    mutationFn: () =>
      createSupportAccessRequest({
        tenantId: supportTenantId,
        reason: supportReason,
        incidentRef: supportIncident,
        durationHours: parseFloat(supportDuration),
        scope: 'READ_METADATA_AND_CONFIG',
      }),
    onSuccess: () => {
      setSupportDialogOpen(false);
      setSupportReason('');
      queryClient.invalidateQueries({ queryKey: ['platform-support'] });
    },
  });

  const previewImportMutation = useMutation({
    meta: { successMessage: 'Import preview ready.' },
    mutationFn: async (dryRun: boolean) =>
      importMasterData({
        listCode: importListCode,
        dryRun,
        items: [{ code: importCode, label: importLabel, attributes: { tier: 1 } }],
      }),
    onSuccess: (data, variables) => {
      if (variables) {
        setImportPreviewData(data);
      } else {
        setMasterImportDialogOpen(false);
        setImportPreviewData(null);
        setImportCode('');
        setImportLabel('');
        queryClient.invalidateQueries({ queryKey: ['platform-master-data'] });
      }
    },
  });

  const handleRefreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['platform-tenants'] });
    queryClient.invalidateQueries({ queryKey: ['platform-flags'] });
    queryClient.invalidateQueries({ queryKey: ['platform-master-data'] });
    queryClient.invalidateQueries({ queryKey: ['platform-jobs'] });
    queryClient.invalidateQueries({ queryKey: ['platform-health'] });
    queryClient.invalidateQueries({ queryKey: ['platform-support'] });
    queryClient.invalidateQueries({ queryKey: ['platform-releases'] });
  };

  const sysStatus = healthQuery.data?.status ?? 'HEALTHY';

  return (
    <Box sx={{ p: 3, maxWidth: 1400, margin: '0 auto' }}>
      {/* Header Banner */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="h4" fontWeight={700} sx={{ letterSpacing: '-0.5px' }}>
              Platform Operations & Administration
            </Typography>
            <Chip
              label="MOD-ADM"
              color="primary"
              variant="outlined"
              size="small"
              sx={{ fontWeight: 600, fontSize: '0.75rem' }}
            />
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Operator console, feature flags, master data catalogues, background job queues, break-glass support access & governed release register.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Chip
            icon={<HealthAndSafetyIcon />}
            label={`System: ${sysStatus}`}
            color={sysStatus === 'HEALTHY' ? 'success' : sysStatus === 'DEGRADED' ? 'warning' : 'error'}
            variant="filled"
            sx={{ fontWeight: 700 }}
          />
          <Tooltip title="Refresh All Feeds">
            <IconButton onClick={handleRefreshAll} color="primary" sx={{ border: '1px solid #e0e0e0' }}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Tabs */}
      <Paper elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', mb: 3, borderRadius: 2 }}>
        <Tabs
          value={tabIndex}
          onChange={(_, idx) => setTabIndex(idx)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, minHeight: 48 } }}
        >
          <Tab icon={<StorageIcon fontSize="small" />} iconPosition="start" label="Tenants (Console)" />
          <Tab icon={<FlagIcon fontSize="small" />} iconPosition="start" label="Feature Flags" />
          <Tab icon={<SpeedIcon fontSize="small" />} iconPosition="start" label="Master Data" />
          <Tab icon={<WorkIcon fontSize="small" />} iconPosition="start" label="Background Jobs" />
          <Tab icon={<HealthAndSafetyIcon fontSize="small" />} iconPosition="start" label="System Health" />
          <Tab icon={<VpnKeyIcon fontSize="small" />} iconPosition="start" label="Support Access (Break-Glass)" />
          <Tab icon={<NewReleasesIcon fontSize="small" />} iconPosition="start" label="Release Management" />
        </Tabs>
      </Paper>

      {/* TAB 0: TENANTS / PLATFORM CONSOLE (SUB-ADM.01) */}
      {tabIndex === 0 && (
        <Box>
          <Alert severity="info" sx={{ mb: 3 }} icon={<SecurityIcon />}>
            <strong>Zero Business Data Projection:</strong> Platform console displays strictly tenant organizational metadata, entitlements, and operational health status. Under tenant isolation policies, no individual leads, loans, or customer financial records are accessed or exposed.
          </Alert>

          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent>
              <Typography variant="h6" fontWeight={600} gutterBottom>
                Registered Tenants Directory (API-TEN-002)
              </Typography>
              {tenantsQuery.isLoading ? (
                <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={32} /></Box>
              ) : (
                <TableContainer>
                  <Table>
                    <TableHead sx={{ bgcolor: 'grey.50' }}>
                      <TableRow>
                        <TableCell><strong>Slug / ID</strong></TableCell>
                        <TableCell><strong>Legal Name</strong></TableCell>
                        <TableCell><strong>Type</strong></TableCell>
                        <TableCell><strong>Region / Timezone</strong></TableCell>
                        <TableCell><strong>Health Status</strong></TableCell>
                        <TableCell><strong>Active Users</strong></TableCell>
                        <TableCell><strong>Entitlements</strong></TableCell>
                        <TableCell><strong>Status</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {tenantsQuery.data?.data.map((t) => (
                        <TableRow key={t.id} hover>
                          <TableCell>
                            <Typography variant="subtitle2" fontWeight={600}>{t.slug}</Typography>
                            <Typography variant="caption" color="text.secondary">{t.id}</Typography>
                          </TableCell>
                          <TableCell>{t.legalName}</TableCell>
                          <TableCell>
                            <Chip label={t.tenantType} size="small" variant="outlined" />
                          </TableCell>
                          <TableCell>{t.dataRegion} / {t.timezone}</TableCell>
                          <TableCell>
                            <Chip
                              label={t.healthStatus}
                              size="small"
                              color={t.healthStatus === 'HEALTHY' ? 'success' : 'warning'}
                            />
                          </TableCell>
                          <TableCell>{t.activeUsersCount} users</TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                              {t.entitlements.slice(0, 3).map((e) => (
                                <Chip key={e} label={e} size="small" sx={{ fontSize: '0.65rem' }} />
                              ))}
                              {t.entitlements.length > 3 && (
                                <Chip label={`+${t.entitlements.length - 3}`} size="small" sx={{ fontSize: '0.65rem' }} />
                              )}
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={t.status}
                              size="small"
                              color={t.status === 'ACTIVE' ? 'primary' : 'default'}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        </Box>
      )}

      {/* TAB 1: FEATURE FLAGS (SUB-ADM.02) */}
      {tabIndex === 1 && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" fontWeight={600}>
              Platform & Tenant Feature Flags (CMP-ADM.02.1)
            </Typography>
            <Chip label="Optimistic Concurrency (If-Match) Active" size="small" color="secondary" variant="outlined" />
          </Box>

          <Grid container spacing={2}>
            {flagsQuery.data?.data.map((flag) => (
              <Grid item xs={12} md={6} key={`${flag.key}:${flag.scope}`}>
                <Card variant="outlined" sx={{ borderRadius: 2, height: '100%' }}>
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <Box>
                        <Typography variant="subtitle1" fontWeight={700}>
                          {flag.key}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1, my: 0.5 }}>
                          <Chip label={`Scope: ${flag.scope}`} size="small" color="primary" variant="outlined" />
                          <Chip label={`v${flag.lockVersion}`} size="small" variant="outlined" />
                        </Box>
                      </Box>
                      <Switch
                        checked={Boolean(flag.value)}
                        onChange={(e) => toggleFlagMutation.mutate({ key: flag.key, value: e.target.checked })}
                        disabled={toggleFlagMutation.isPending}
                        color="success"
                      />
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      {flag.description || 'No description provided.'}
                    </Typography>
                    <Divider sx={{ my: 1.5 }} />
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'text.secondary' }}>
                      <span>Owner: {flag.owner}</span>
                      <span>Updated: {new Date(flag.updatedAt).toLocaleTimeString()}</span>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      {/* TAB 2: MASTER DATA (SUB-ADM.03) */}
      {tabIndex === 2 && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h6" fontWeight={600}>
              Master Data Catalogues (CMP-ADM.03.1)
            </Typography>
            <Button
              variant="contained"
              onClick={() => {
                setImportPreviewData(null);
                setMasterImportDialogOpen(true);
              }}
            >
              Import Master Data
            </Button>
          </Box>

          {masterDataQuery.isLoading ? (
            <CircularProgress size={32} />
          ) : (
            <Grid container spacing={3}>
              {Object.entries(masterDataQuery.data?.data ?? {}).map(([listCode, items]) => (
                <Grid item xs={12} md={6} key={listCode}>
                  <Card variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                        <Typography variant="subtitle1" fontWeight={700}>
                          {listCode}
                        </Typography>
                        <Chip label={`${items.length} items`} size="small" variant="outlined" />
                      </Box>
                      <TableContainer sx={{ maxHeight: 220 }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Code</TableCell>
                              <TableCell>Label</TableCell>
                              <TableCell>Version</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {items.map((i) => (
                              <TableRow key={i.id}>
                                <TableCell><code>{i.code}</code></TableCell>
                                <TableCell>{i.label}</TableCell>
                                <TableCell>v{i.version}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}
        </Box>
      )}

      {/* TAB 3: BACKGROUND JOBS (SUB-ADM.04) */}
      {tabIndex === 3 && (
        <Box>
          <Typography variant="h6" fontWeight={600} gutterBottom>
            Job Console & Queue State (CMP-ADM.04.1)
          </Typography>

          <Grid container spacing={2} sx={{ mb: 3 }}>
            {jobsQuery.data?.queues.map((q) => (
              <Grid item xs={12} md={4} key={q.queue}>
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="subtitle1" fontWeight={700}>
                        {q.queue}
                      </Typography>
                      <Chip
                        label={q.paused ? 'PAUSED' : 'ACTIVE'}
                        color={q.paused ? 'warning' : 'success'}
                        size="small"
                      />
                    </Box>
                    <Box sx={{ display: 'flex', gap: 2, my: 1.5 }}>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Active</Typography>
                        <Typography variant="h6">{q.activeJobs}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Completed</Typography>
                        <Typography variant="h6">{q.completedJobs}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Failed</Typography>
                        <Typography variant="h6" color={q.failedJobs > 0 ? 'error' : 'inherit'}>{q.failedJobs}</Typography>
                      </Box>
                    </Box>

                    {q.paused ? (
                      <Button
                        size="small"
                        color="success"
                        variant="outlined"
                        startIcon={<PlayCircleFilledIcon />}
                        onClick={() => {
                          setSelectedQueue(q.queue);
                          setResumeDialogOpen(true);
                        }}
                      >
                        Resume Queue
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        color="warning"
                        variant="outlined"
                        startIcon={<PauseCircleFilledIcon />}
                        onClick={() => {
                          setSelectedQueue(q.queue);
                          setPauseDialogOpen(true);
                        }}
                      >
                        Pause Queue
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          <Typography variant="subtitle1" fontWeight={700} gutterBottom>
            Dead Letter Store (ENT-070)
          </Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
            <Table>
              <TableHead sx={{ bgcolor: 'grey.50' }}>
                <TableRow>
                  <TableCell>ID / Queue</TableCell>
                  <TableCell>Original Job ID</TableCell>
                  <TableCell>Failure Reason</TableCell>
                  <TableCell>Retries</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {jobsQuery.data?.deadLetters.map((dl) => (
                  <TableRow key={dl.id}>
                    <TableCell>
                      <Typography variant="subtitle2"><code>{dl.id}</code></Typography>
                      <Typography variant="caption" color="text.secondary">{dl.queue}</Typography>
                    </TableCell>
                    <TableCell><code>{dl.originalJobId}</code></TableCell>
                    <TableCell sx={{ color: 'error.main', fontSize: '0.85rem' }}>{dl.errorReason}</TableCell>
                    <TableCell>{dl.retryCount}</TableCell>
                    <TableCell>
                      <Chip
                        label={dl.status}
                        size="small"
                        color={dl.status === 'REPLAYED' ? 'success' : dl.status === 'DISCARDED' ? 'default' : 'error'}
                      />
                    </TableCell>
                    <TableCell align="right">
                      {dl.status === 'UNRESOLVED' && (
                        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                          <Button size="small" variant="contained" onClick={() => replayDlMutation.mutate(dl.id)}>
                            Replay
                          </Button>
                          <Button size="small" variant="outlined" color="error" onClick={() => discardDlMutation.mutate(dl.id)}>
                            Discard
                          </Button>
                        </Box>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* TAB 4: SYSTEM HEALTH (SUB-ADM.05) */}
      {tabIndex === 4 && (
        <Box>
          <Typography variant="h6" fontWeight={600} gutterBottom>
            Real-Time Observability & System Health (CMP-ADM.05.1)
          </Typography>

          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} md={3}>
              <Card variant="outlined" sx={{ borderRadius: 2, textAlign: 'center', p: 2 }}>
                <Typography variant="caption" color="text.secondary">Database Round-Trip</Typography>
                <Typography variant="h4" fontWeight={700} color="primary" sx={{ my: 1 }}>
                  {healthQuery.data?.dependencies.database.latencyMs ?? '--'} ms
                </Typography>
                <Chip label={`Status: ${healthQuery.data?.dependencies.database.status ?? 'UP'}`} size="small" color="success" />
              </Card>
            </Grid>
            <Grid item xs={12} md={3}>
              <Card variant="outlined" sx={{ borderRadius: 2, textAlign: 'center', p: 2 }}>
                <Typography variant="caption" color="text.secondary">Process Uptime</Typography>
                <Typography variant="h4" fontWeight={700} color="primary" sx={{ my: 1 }}>
                  {Math.floor((healthQuery.data?.uptimeSeconds ?? 0) / 60)}m {(healthQuery.data?.uptimeSeconds ?? 0) % 60}s
                </Typography>
                <Chip label="Node.js Engine" size="small" variant="outlined" />
              </Card>
            </Grid>
            <Grid item xs={12} md={3}>
              <Card variant="outlined" sx={{ borderRadius: 2, textAlign: 'center', p: 2 }}>
                <Typography variant="caption" color="text.secondary">Heap Memory Used</Typography>
                <Typography variant="h4" fontWeight={700} color="primary" sx={{ my: 1 }}>
                  {healthQuery.data?.memoryUsage.heapUsedMb ?? '--'} MB
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Total: {healthQuery.data?.memoryUsage.heapTotalMb} MB
                </Typography>
              </Card>
            </Grid>
            <Grid item xs={12} md={3}>
              <Card variant="outlined" sx={{ borderRadius: 2, textAlign: 'center', p: 2 }}>
                <Typography variant="caption" color="text.secondary">Queue Pipeline</Typography>
                <Typography variant="h6" fontWeight={700} sx={{ my: 1 }}>
                  {healthQuery.data?.dependencies.redisQueue.status}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {healthQuery.data?.dependencies.redisQueue.message}
                </Typography>
              </Card>
            </Grid>
          </Grid>
        </Box>
      )}

      {/* TAB 5: SUPPORT ACCESS (SUB-ADM.06) */}
      {tabIndex === 5 && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Box>
              <Typography variant="h6" fontWeight={600}>
                Break-Glass Support Access Grants (CMP-ADM.06.1)
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Platform operators request access. The target tenant's administrator approves, denies or revokes it in their own
                approvals screen (SOD-06). Maximum duration: 4 hours.
              </Typography>
            </Box>
            <Button variant="contained" color="warning" onClick={() => setSupportDialogOpen(true)}>
              Request Break-Glass Access
            </Button>
          </Box>

          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
            <Table>
              <TableHead sx={{ bgcolor: 'grey.50' }}>
                <TableRow>
                  <TableCell>Grant ID</TableCell>
                  <TableCell>Tenant</TableCell>
                  <TableCell>Incident / Reason</TableCell>
                  <TableCell>Requester / Approver</TableCell>
                  <TableCell>Duration Window</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {supportQuery.data?.data.map((grant) => (
                  <TableRow key={grant.id}>
                    <TableCell><code>{grant.id}</code></TableCell>
                    <TableCell>
                      <Typography variant="subtitle2">{grant.tenantName}</Typography>
                      <Typography variant="caption" color="text.secondary">{grant.tenantId}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={grant.incidentRef} size="small" color="error" sx={{ mr: 1 }} />
                      <Typography variant="caption">{grant.reason}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">Req: <code>{grant.requester}</code></Typography>
                      <Typography variant="caption" color="text.secondary">Appr: <code>{grant.approver || 'Pending'}</code></Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">
                        {new Date(grant.startsAt).toLocaleTimeString()} - {new Date(grant.endsAt).toLocaleTimeString()}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={grant.status}
                        color={grant.status === 'APPROVED' ? 'success' : grant.status === 'PENDING' ? 'warning' : 'default'}
                        size="small"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* TAB 6: RELEASE MANAGEMENT (SUB-ADM.08) */}
      {tabIndex === 6 && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Box>
              <Typography variant="h6" fontWeight={600}>
                Release Register & Version Tracking (CMP-ADM.08.1)
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Rule-packs and seed data are immutable migrations; candidate v0.1.0-rc.1 checklist status.
              </Typography>
            </Box>
            <Chip label="Current Candidate: v0.1.0-rc.1" color="primary" sx={{ fontWeight: 700 }} />
          </Box>

          <Grid container spacing={3}>
            {releasesQuery.data?.releases.map((rel) => (
              <Grid item xs={12} key={rel.version}>
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Typography variant="h5" fontWeight={700}>
                        {rel.version}
                      </Typography>
                      <Chip label={rel.status} color="warning" />
                    </Box>

                    <Typography variant="body2" color="text.secondary" paragraph>
                      {rel.notesSummary}
                    </Typography>

                    <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                      Release Verification Gates:
                    </Typography>
                    <Grid container spacing={2} sx={{ mb: 2 }}>
                      <Grid item xs={6} md={3}>
                        <Paper sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                          <CheckCircleIcon color="success" />
                          <Box>
                            <Typography variant="body2" fontWeight={600}>REL-001</Typography>
                            <Typography variant="caption" color="text.secondary">DB & Auth Baseline</Typography>
                          </Box>
                        </Paper>
                      </Grid>
                      <Grid item xs={6} md={3}>
                        <Paper sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                          <CheckCircleIcon color="success" />
                          <Box>
                            <Typography variant="body2" fontWeight={600}>REL-002</Typography>
                            <Typography variant="caption" color="text.secondary">Contract OpenAPI Sync</Typography>
                          </Box>
                        </Paper>
                      </Grid>
                      <Grid item xs={6} md={3}>
                        <Paper sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                          <CheckCircleIcon color="success" />
                          <Box>
                            <Typography variant="body2" fontWeight={600}>REL-003</Typography>
                            <Typography variant="caption" color="text.secondary">Pre-Release Tests</Typography>
                          </Box>
                        </Paper>
                      </Grid>
                      <Grid item xs={6} md={3}>
                        <Paper sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                          <WarningAmberIcon color="warning" />
                          <Box>
                            <Typography variant="body2" fontWeight={600}>REL-004</Typography>
                            <Typography variant="caption" color="text.secondary">Git Tagging & Release</Typography>
                          </Box>
                        </Paper>
                      </Grid>
                    </Grid>

                    <Divider sx={{ my: 1.5 }} />
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                      <span>Rule-Pack: <strong>{rel.rulePackVersion}</strong></span>
                      <span>Target Date: <strong>{rel.targetDate}</strong></span>
                      <span>Release Notes: <code>{rel.releaseNotesRef}</code></span>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      {/* DIALOG: Pause Queue */}
      <Dialog open={pauseDialogOpen} onClose={() => setPauseDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Pause Queue: {selectedQueue}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            A detailed operational reason is required before pausing a platform queue.
          </Typography>
          <TextField
            label="Reason for Pause"
            fullWidth
            required
            multiline
            rows={3}
            value={pauseReason}
            onChange={(e) => setPauseReason(e.target.value)}
            placeholder="e.g. Database maintenance window scheduled"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPauseDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => pauseQueueMutation.mutate()}
            disabled={pauseReason.trim().length < 5 || pauseQueueMutation.isPending}
          >
            Confirm Pause
          </Button>
        </DialogActions>
      </Dialog>

      {/* DIALOG: Resume Queue */}
      <Dialog open={resumeDialogOpen} onClose={() => setResumeDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Resume Queue: {selectedQueue}</DialogTitle>
        <DialogContent>
          <TextField
            label="Reason for Resume"
            fullWidth
            required
            multiline
            rows={2}
            value={resumeReason}
            onChange={(e) => setResumeReason(e.target.value)}
            placeholder="e.g. Maintenance complete, resume workers"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResumeDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="success"
            onClick={() => resumeQueueMutation.mutate()}
            disabled={resumeReason.trim().length < 5 || resumeQueueMutation.isPending}
          >
            Resume Queue
          </Button>
        </DialogActions>
      </Dialog>

      {/* DIALOG: Request Support Access */}
      <Dialog open={supportDialogOpen} onClose={() => setSupportDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Request Break-Glass Support Access</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Access is strictly time-boxed (maximum 4.0 hours) and requires tenant admin approval.
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Target Tenant</InputLabel>
              <Select value={supportTenantId} label="Target Tenant" onChange={(e) => setSupportTenantId(e.target.value)}>
                {(tenantsQuery.data?.data ?? []).map((t) => (
                  <MenuItem key={t.id} value={t.id}>
                    {t.legalName} ({t.id})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Incident Reference"
              fullWidth
              required
              value={supportIncident}
              onChange={(e) => setSupportIncident(e.target.value)}
            />
            <TextField
              label="Access Duration (Hours - Max 4.0h)"
              type="number"
              inputProps={{ min: 0.5, max: 4.0, step: 0.5 }}
              fullWidth
              required
              value={supportDuration}
              onChange={(e) => setSupportDuration(e.target.value)}
            />
            <TextField
              label="Justification & Reason"
              multiline
              rows={3}
              fullWidth
              required
              value={supportReason}
              onChange={(e) => setSupportReason(e.target.value)}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSupportDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => createSupportMutation.mutate()}
            disabled={!supportTenantId || !supportReason || parseFloat(supportDuration) > 4.0 || createSupportMutation.isPending}
          >
            Submit Request
          </Button>
        </DialogActions>
      </Dialog>

      {/* DIALOG: Import Master Data with Preview */}
      <Dialog open={masterImportDialogOpen} onClose={() => setMasterImportDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Import Master Data Item</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Catalogue List</InputLabel>
              <Select value={importListCode} label="Catalogue List" onChange={(e) => setImportListCode(e.target.value)}>
                <MenuItem value="PINCODES">PINCODES</MenuItem>
                <MenuItem value="STATES">STATES</MenuItem>
                <MenuItem value="OCCUPATIONS">OCCUPATIONS</MenuItem>
                <MenuItem value="REASON_CODES">REASON_CODES</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Code"
              fullWidth
              required
              value={importCode}
              onChange={(e) => setImportCode(e.target.value)}
              placeholder="e.g. 400050 or SENP"
            />
            <TextField
              label="Label"
              fullWidth
              required
              value={importLabel}
              onChange={(e) => setImportLabel(e.target.value)}
              placeholder="Human readable display name"
            />

            {importPreviewData && (
              <Alert severity="success" sx={{ mt: 1 }}>
                Preview Ready: Total: {importPreviewData.totalSubmitted}, New: {importPreviewData.newItemsCount}, Updated: {importPreviewData.updatedItemsCount}
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMasterImportDialogOpen(false)}>Cancel</Button>
          <Button
            variant="outlined"
            onClick={() => previewImportMutation.mutate(true)}
            disabled={!importCode || !importLabel || previewImportMutation.isPending}
          >
            Preview Dry-Run
          </Button>
          <Button
            variant="contained"
            color="success"
            onClick={() => previewImportMutation.mutate(false)}
            disabled={!importCode || !importLabel || previewImportMutation.isPending}
          >
            Commit Import
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
