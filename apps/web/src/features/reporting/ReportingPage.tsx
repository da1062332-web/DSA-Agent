// apps/web/src/features/reporting/ReportingPage.tsx — Enterprise Reporting & Analytics Suite (MOD-RPT)
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  MenuItem,
  Paper,
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
} from '@mui/material';
import React, { useState } from 'react';
import {
  useBranchDashboard,
  useConnectorDashboard,
  useControlTotals,
  useCreateExport,
  useCreateReportSchedule,
  useDeleteReportSchedule,
  useExecutiveDashboard,
  useExports,
  useFinanceDashboard,
  useMetricDefinitions,
  useOperationsDashboard,
  useRefreshProjections,
  useReportCatalogue,
  useReportRuns,
  useReportSchedules,
  useStartReportRun,
} from './api';
import type {
  CreateExportDto,
  CreateReportRunDto,
  CreateReportScheduleDto,
  MetricDefinitionDto,
  ReportCatalogueItem,
} from '@dsa/contracts';
import { apiDownload, errorText } from '../../api/client';

export function ReportingPage() {
  const [activeTab, setActiveTab] = useState(0);
  const [selectedPeriod, setSelectedPeriod] = useState('2026-10');
  const [selectedDate, setSelectedDate] = useState('2026-10-12');
  const [dashboardCategory, setDashboardCategory] = useState<
    'EXECUTIVE' | 'BRANCH' | 'OPERATIONS' | 'FINANCE' | 'CONNECTOR'
  >('EXECUTIVE');

  // Dialog States
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<ReportCatalogueItem | null>(null);
  const [runFormat, setRunFormat] = useState<'CSV' | 'XLSX' | 'JSON'>('CSV');
  const [runBranchId, setRunBranchId] = useState('');

  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportType, setExportType] = useState('METRICS');
  const [exportFormat, setExportFormat] = useState<'CSV' | 'XLSX' | 'JSON'>('CSV');

  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [scheduleReportCode, setScheduleReportCode] = useState('RPT_DISBURSEMENT_REGISTER');
  const [scheduleFreq, setScheduleFreq] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>('WEEKLY');
  const [scheduleEmail, setScheduleEmail] = useState('');

  const [formulaModalDef, setFormulaModalDef] = useState<MetricDefinitionDto | null>(null);
  const [notification, setNotification] = useState<{
    severity: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // Queries
  const { data: metricDefsData, isLoading: metricDefsLoading } = useMetricDefinitions();
  const { data: catalogueData, isLoading: catalogueLoading } = useReportCatalogue();
  const { data: reportRunsData, isLoading: reportRunsLoading } = useReportRuns();
  const { data: exportsData, isLoading: exportsLoading } = useExports();
  const { data: schedulesData, isLoading: schedulesLoading } = useReportSchedules();
  const { data: controlTotalsData, isLoading: controlTotalsLoading } = useControlTotals(selectedDate);

  // Dashboard Queries
  const { data: execData, isLoading: execLoading } = useExecutiveDashboard(selectedPeriod);
  const { data: branchData, isLoading: branchLoading } = useBranchDashboard(selectedPeriod);
  const { data: opsData, isLoading: opsLoading } = useOperationsDashboard(selectedPeriod);
  const { data: finData, isLoading: finLoading } = useFinanceDashboard(selectedPeriod);
  const { data: conData, isLoading: conLoading } = useConnectorDashboard(selectedPeriod);

  // Mutations
  const startRunMutation = useStartReportRun();
  const createExportMutation = useCreateExport();
  const createScheduleMutation = useCreateReportSchedule();
  const deleteScheduleMutation = useDeleteReportSchedule();
  const refreshProjMutation = useRefreshProjections();

  const handleStartRun = () => {
    if (!selectedReport) return;
    const dto: CreateReportRunDto = {
      format: runFormat,
      parameters: runBranchId.trim() ? { branchId: runBranchId.trim() } : {},
    };
    startRunMutation.mutate(
      { code: selectedReport.code, dto },
      {
        onSuccess: () => {
          setRunDialogOpen(false);
          setRunBranchId('');
          setNotification({
            severity: 'success',
            message: `Report run for "${selectedReport.title}" queued successfully.`,
          });
        },
        onError: (err: any) => {
          setNotification({ severity: 'error', message: err?.message || 'Failed to start report run.' });
        },
      },
    );
  };

  const handleCreateExport = () => {
    const dto: CreateExportDto = {
      exportType,
      fileFormat: exportFormat,
      filters: { period: selectedPeriod },
      scopeType: 'TENANT',
    };
    createExportMutation.mutate(dto, {
      onSuccess: () => {
        setExportDialogOpen(false);
        setNotification({ severity: 'success', message: `${exportType} export job requested successfully.` });
      },
      onError: (err: any) => {
        setNotification({ severity: 'error', message: err?.message || 'Failed to create export job.' });
      },
    });
  };

  const handleCreateSchedule = () => {
    if (!scheduleEmail) return;
    const dto: CreateReportScheduleDto = {
      reportCode: scheduleReportCode,
      frequency: scheduleFreq,
      filters: {},
      recipientEmails: [scheduleEmail.trim()],
      recipientScope: 'TENANT',
    };
    createScheduleMutation.mutate(dto, {
      onSuccess: () => {
        setScheduleDialogOpen(false);
        setScheduleEmail('');
        setNotification({
          severity: 'success',
          message: `Report schedule for "${scheduleReportCode}" created.`,
        });
      },
      onError: (err: any) => {
        setNotification({ severity: 'error', message: err?.message || 'Failed to create report schedule.' });
      },
    });
  };

  const handleDeleteSchedule = (id: string) => {
    deleteScheduleMutation.mutate(id, {
      onSuccess: () => {
        setNotification({ severity: 'success', message: 'Report schedule deleted successfully.' });
      },
      onError: (err: any) => {
        setNotification({ severity: 'error', message: err?.message || 'Failed to delete report schedule.' });
      },
    });
  };

  const handleRefreshProjections = () => {
    refreshProjMutation.mutate(
      {
        startDate: `${selectedPeriod}-01`,
        endDate: `${selectedPeriod}-31`,
      },
      {
        onSuccess: () => {
          setNotification({ severity: 'success', message: 'Projections and control totals refreshed.' });
        },
        onError: (err: any) => {
          setNotification({ severity: 'error', message: err?.message || 'Failed to refresh projections.' });
        },
      },
    );
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
      {notification && (
        <Alert severity={notification.severity} onClose={() => setNotification(null)} sx={{ mb: 3 }}>
          {notification.message}
        </Alert>
      )}
      {/* Header */}
      <Box
        sx={{
          mb: 3,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 2,
        }}
      >
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Reporting and Analytics (MOD-RPT)
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Canonical reporting engine, metric registry (ENT-094), multi-category dashboards, automated
            schedules, and daily control totals (FR-RPT-008).
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Chip label="TASK-414 Complete" color="success" size="small" variant="outlined" />
          <Chip label="Data Squad" color="primary" size="small" />
          <Chip label="RLS Enforced" color="secondary" size="small" />
        </Box>
      </Box>

      {/* Tabs */}
      <Paper sx={{ mb: 3 }} elevation={1}>
        <Tabs
          value={activeTab}
          onChange={(_, val) => setActiveTab(val)}
          indicatorColor="primary"
          textColor="primary"
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab label="Report Catalogue & Runner" />
          <Tab label="Multi-Category Dashboards" />
          <Tab label="Metric Registry (ENT-094)" />
          <Tab label="Exports & Schedules (ENT-111)" />
          <Tab label="Daily Control Totals (FR-RPT-008)" />
        </Tabs>
      </Paper>

      {/* ======================================================== */}
      {/* Tab 0: Standard Reports & Runner (SUB-RPT.04) */}
      {/* ======================================================== */}
      {activeTab === 0 && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" fontWeight={600}>
              Standard Report Catalogue
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Canonical asynchronous report runner with CSV, XLSX, and JSON generation.
            </Typography>
          </Box>

          {catalogueLoading ? (
            <CircularProgress />
          ) : (
            <Grid container spacing={2} sx={{ mb: 4 }}>
              {catalogueData?.data.map((report) => (
                <Grid item xs={12} sm={6} md={4} key={report.code}>
                  <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <CardHeader
                      title={report.title}
                      titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
                      subheader={<Chip label={report.category} size="small" sx={{ mt: 0.5 }} />}
                    />
                    <CardContent sx={{ flexGrow: 1, pt: 0 }}>
                      <Typography variant="body2" color="text.secondary" paragraph>
                        {report.description}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
                        {report.supportedFormats.map((fmt) => (
                          <Chip key={fmt} label={fmt} size="small" variant="outlined" />
                        ))}
                      </Box>
                      <Button
                        variant="contained"
                        size="small"
                        fullWidth
                        onClick={() => {
                          setSelectedReport(report);
                          setRunDialogOpen(true);
                        }}
                      >
                        Run Report
                      </Button>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}

          <Divider sx={{ my: 3 }} />

          <Typography variant="h6" fontWeight={600} gutterBottom>
            Recent Report Runs
          </Typography>
          {reportRunsLoading ? (
            <CircularProgress />
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell>
                      <strong>Run ID</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Report Code</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Status</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Row Count</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Created At</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Action</strong>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {reportRunsData?.data && reportRunsData.data.length > 0 ? (
                    reportRunsData.data.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell>
                          <code>{run.id}</code>
                        </TableCell>
                        <TableCell>{run.reportCode}</TableCell>
                        <TableCell>
                          <Chip
                            label={run.status}
                            size="small"
                            color={
                              run.status === 'COMPLETED'
                                ? 'success'
                                : run.status === 'RUNNING'
                                  ? 'primary'
                                  : 'default'
                            }
                          />
                        </TableCell>
                        <TableCell>{run.rowCount}</TableCell>
                        <TableCell>{new Date(run.createdAt).toLocaleString()}</TableCell>
                        <TableCell>
                          {run.downloadUrl ? (
                            <Button
                              size="small"
                              onClick={() => {
                                void apiDownload(
                                  run.downloadUrl!,
                                  `report_${run.reportCode.toLowerCase()}_${run.id}.csv`,
                                );
                              }}
                            >
                              Download
                            </Button>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              Ready in Store
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} align="center">
                        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                          No report runs generated yet. Select a standard report above to trigger execution.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      )}

      {/* ======================================================== */}
      {/* Tab 1: Multi-Category Dashboards (SUB-RPT.03) */}
      {/* ======================================================== */}
      {activeTab === 1 && (
        <Box>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              mb: 3,
              flexWrap: 'wrap',
              gap: 2,
            }}
          >
            <Box sx={{ display: 'flex', gap: 1 }}>
              {(['EXECUTIVE', 'BRANCH', 'OPERATIONS', 'FINANCE', 'CONNECTOR'] as const).map((cat) => (
                <Button
                  key={cat}
                  variant={dashboardCategory === cat ? 'contained' : 'outlined'}
                  size="small"
                  onClick={() => setDashboardCategory(cat)}
                >
                  {cat}
                </Button>
              ))}
            </Box>
            <TextField
              label="Period (YYYY-MM)"
              size="small"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              sx={{ width: 150 }}
            />
          </Box>

          {/* EXECUTIVE DASHBOARD */}
          {dashboardCategory === 'EXECUTIVE' && (
            <Box>
              {execLoading ? (
                <CircularProgress />
              ) : execData ? (
                <Box>
                  <Grid container spacing={2} sx={{ mb: 3 }}>
                    <Grid item xs={12} sm={6} md={3}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="caption" color="text.secondary">
                            Total Lead Intake
                          </Typography>
                          <Typography variant="h5" fontWeight={700}>
                            {execData.portfolioSummary.totalLeads}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="caption" color="text.secondary">
                            Conversion Rate
                          </Typography>
                          <Typography variant="h5" fontWeight={700}>
                            {execData.portfolioSummary.conversionRate}%
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="caption" color="text.secondary">
                            Sanctioned Amount
                          </Typography>
                          <Typography variant="h5" fontWeight={700}>
                            ₹{execData.portfolioSummary.sanctionedAmount.toLocaleString('en-IN')}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="caption" color="text.secondary">
                            Disbursed Volume
                          </Typography>
                          <Typography variant="h5" fontWeight={700} color="primary.main">
                            ₹{execData.portfolioSummary.disbursedAmount.toLocaleString('en-IN')}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  </Grid>

                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    Top Performing Branches
                  </Typography>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: 'action.hover' }}>
                          <TableCell>
                            <strong>Branch</strong>
                          </TableCell>
                          <TableCell>
                            <strong>Disbursed Volume</strong>
                          </TableCell>
                          <TableCell>
                            <strong>Target</strong>
                          </TableCell>
                          <TableCell>
                            <strong>Achievement %</strong>
                          </TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {execData.topBranches.map((b) => (
                          <TableRow key={b.branchId}>
                            <TableCell>{b.branchName}</TableCell>
                            <TableCell>₹{b.disbursedAmount.toLocaleString('en-IN')}</TableCell>
                            <TableCell>
                              {b.targetAmount ? `₹${b.targetAmount.toLocaleString('en-IN')}` : '—'}
                            </TableCell>
                            <TableCell>
                              {b.achievementRate !== null ? (
                                <Chip
                                  label={`${b.achievementRate}%`}
                                  size="small"
                                  color={
                                    b.achievementRate >= 100
                                      ? 'success'
                                      : b.achievementRate >= 80
                                        ? 'warning'
                                        : 'default'
                                  }
                                />
                              ) : (
                                '—'
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              ) : null}
            </Box>
          )}

          {/* BRANCH DASHBOARD */}
          {dashboardCategory === 'BRANCH' && (
            <Box>
              {branchLoading ? (
                <CircularProgress />
              ) : branchData ? (
                <Box>
                  <Card variant="outlined" sx={{ mb: 3 }}>
                    <CardHeader
                      title={`Branch Performance: ${branchData.branchName}`}
                      subheader={`Branch Code: ${branchData.branchId}`}
                    />
                    <CardContent>
                      <Grid container spacing={2}>
                        <Grid item xs={6} sm={3}>
                          <Typography variant="caption" color="text.secondary">
                            Leads
                          </Typography>
                          <Typography variant="h6">{branchData.summary.leadCount}</Typography>
                        </Grid>
                        <Grid item xs={6} sm={3}>
                          <Typography variant="caption" color="text.secondary">
                            Conversion Rate
                          </Typography>
                          <Typography variant="h6">{branchData.summary.conversionRate}%</Typography>
                        </Grid>
                        <Grid item xs={6} sm={3}>
                          <Typography variant="caption" color="text.secondary">
                            Sanction Amount
                          </Typography>
                          <Typography variant="h6">
                            ₹{branchData.summary.sanctionAmount.toLocaleString('en-IN')}
                          </Typography>
                        </Grid>
                        <Grid item xs={6} sm={3}>
                          <Typography variant="caption" color="text.secondary">
                            Disbursement Amount
                          </Typography>
                          <Typography variant="h6" color="primary.main">
                            ₹{branchData.summary.disbursementAmount.toLocaleString('en-IN')}
                          </Typography>
                        </Grid>
                      </Grid>
                    </CardContent>
                  </Card>

                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    Loan Officer Activity & Breakdown
                  </Typography>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: 'action.hover' }}>
                          <TableCell>
                            <strong>Officer Name</strong>
                          </TableCell>
                          <TableCell>
                            <strong>Leads Sourced</strong>
                          </TableCell>
                          <TableCell>
                            <strong>Sanctions</strong>
                          </TableCell>
                          <TableCell>
                            <strong>Disbursed Volume</strong>
                          </TableCell>
                          <TableCell>
                            <strong>Conversion Rate</strong>
                          </TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {branchData.officerPerformance.map((officer) => (
                          <TableRow key={officer.userId}>
                            <TableCell>{officer.userName}</TableCell>
                            <TableCell>{officer.leadCount}</TableCell>
                            <TableCell>{officer.sanctionCount}</TableCell>
                            <TableCell>₹{officer.disbursementAmount.toLocaleString('en-IN')}</TableCell>
                            <TableCell>{officer.conversionRate}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              ) : null}
            </Box>
          )}

          {/* OPERATIONS DASHBOARD */}
          {dashboardCategory === 'OPERATIONS' && (
            <Box>
              {opsLoading ? (
                <CircularProgress />
              ) : opsData ? (
                <Grid container spacing={3}>
                  <Grid item xs={12} md={6}>
                    <Card variant="outlined">
                      <CardHeader title="Operational Pipeline Throughput" />
                      <CardContent>
                        <Typography variant="body2" gutterBottom>
                          Leads Processed: <strong>{opsData.throughput.leadsProcessed}</strong>
                        </Typography>
                        <Typography variant="body2" gutterBottom>
                          Active Applications: <strong>{opsData.throughput.activeApplications}</strong>
                        </Typography>
                        <Typography variant="body2" gutterBottom>
                          Pending Verifications: <strong>{opsData.throughput.pendingVerifications}</strong>
                        </Typography>
                        <Typography variant="body2" gutterBottom>
                          Underwriting Stage: <strong>{opsData.throughput.casesInUnderwriting}</strong>
                        </Typography>
                        <Typography variant="body2">
                          Sanctions Awaiting Tranche:{' '}
                          <strong>{opsData.throughput.sanctionsAwaitingDisbursement}</strong>
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Card variant="outlined">
                      <CardHeader title="SLA & Velocity Metrics" />
                      <CardContent>
                        <Typography variant="body2" gutterBottom>
                          Total Tasks: <strong>{opsData.slaPerformance.totalTasks}</strong>
                        </Typography>
                        <Typography variant="body2" gutterBottom>
                          Completed On-Time: <strong>{opsData.slaPerformance.completedOnTime}</strong>
                        </Typography>
                        <Typography variant="body2" gutterBottom>
                          SLA Breached Tasks: <strong>{opsData.slaPerformance.breachedTasks}</strong>
                        </Typography>
                        <Typography variant="h6" color="success.main" sx={{ mt: 2 }}>
                          On-Time SLA Delivery: {opsData.slaPerformance.onTimeRate}%
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>
              ) : null}
            </Box>
          )}

          {/* FINANCE DASHBOARD */}
          {dashboardCategory === 'FINANCE' && (
            <Box>
              {finLoading ? (
                <CircularProgress />
              ) : finData ? (
                <Box>
                  <Grid container spacing={2} sx={{ mb: 3 }}>
                    <Grid item xs={12} sm={4}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="caption" color="text.secondary">
                            Gross Sanctioned
                          </Typography>
                          <Typography variant="h5">
                            ₹{finData.disbursements.grossSanctionedAmount.toLocaleString('en-IN')}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="caption" color="text.secondary">
                            Net Disbursed
                          </Typography>
                          <Typography variant="h5" color="primary.main">
                            ₹{finData.disbursements.netDisbursedAmount.toLocaleString('en-IN')}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="caption" color="text.secondary">
                            Average Ticket Size
                          </Typography>
                          <Typography variant="h5">
                            ₹{finData.disbursements.averageTicketSize.toLocaleString('en-IN')}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  </Grid>

                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    Product Portfolio Breakdown
                  </Typography>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: 'action.hover' }}>
                          <TableCell>
                            <strong>Product</strong>
                          </TableCell>
                          <TableCell>
                            <strong>Sanction Count</strong>
                          </TableCell>
                          <TableCell>
                            <strong>Disbursed Volume</strong>
                          </TableCell>
                          <TableCell>
                            <strong>Portfolio Share</strong>
                          </TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {finData.productBreakdown.map((p) => (
                          <TableRow key={p.productId}>
                            <TableCell>{p.productName}</TableCell>
                            <TableCell>{p.sanctionCount}</TableCell>
                            <TableCell>₹{p.disbursedAmount.toLocaleString('en-IN')}</TableCell>
                            <TableCell>{p.sharePercentage}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              ) : null}
            </Box>
          )}

          {/* CONNECTOR DASHBOARD */}
          {dashboardCategory === 'CONNECTOR' && (
            <Box>
              {conLoading ? (
                <CircularProgress />
              ) : conData ? (
                <Box>
                  <Alert severity="info" sx={{ mb: 3 }}>
                    MOD-CPT (Connector Portal) remains deferred to Release 3. Connector metrics below reflect
                    canonical core channel reporting without third-party connector dependencies.
                  </Alert>
                  <Grid container spacing={2} sx={{ mb: 3 }}>
                    <Grid item xs={6} sm={3}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="caption" color="text.secondary">
                            Total Connectors
                          </Typography>
                          <Typography variant="h5">{conData.channelSummary.totalConnectors}</Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid item xs={6} sm={3}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="caption" color="text.secondary">
                            Active Connectors
                          </Typography>
                          <Typography variant="h5">{conData.channelSummary.activeConnectors}</Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid item xs={6} sm={3}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="caption" color="text.secondary">
                            Leads Sourced
                          </Typography>
                          <Typography variant="h5">{conData.channelSummary.leadsSourced}</Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid item xs={6} sm={3}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="caption" color="text.secondary">
                            Disbursed Volume
                          </Typography>
                          <Typography variant="h5">
                            ₹{conData.channelSummary.disbursedVolume.toLocaleString('en-IN')}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  </Grid>

                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    Top Connector Partners
                  </Typography>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: 'action.hover' }}>
                          <TableCell>
                            <strong>Partner Name</strong>
                          </TableCell>
                          <TableCell>
                            <strong>Leads Sourced</strong>
                          </TableCell>
                          <TableCell>
                            <strong>Disbursed Volume</strong>
                          </TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {conData.topPartners.map((p) => (
                          <TableRow key={p.connectorId}>
                            <TableCell>{p.connectorName}</TableCell>
                            <TableCell>{p.leadsCount}</TableCell>
                            <TableCell>₹{p.disbursedAmount.toLocaleString('en-IN')}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              ) : null}
            </Box>
          )}
        </Box>
      )}

      {/* ======================================================== */}
      {/* Tab 2: Metric Registry (SUB-RPT.01 ENT-094) */}
      {/* ======================================================== */}
      {activeTab === 2 && (
        <Box>
          <Box sx={{ mb: 2 }}>
            <Typography variant="h6" fontWeight={600}>
              Canonical Metric Registry (ENT-094)
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Central catalog of tenant metric definitions with AST formula expressions, grain, date bases,
              and audit versioning.
            </Typography>
          </Box>

          {metricDefsLoading ? (
            <CircularProgress />
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell>
                      <strong>Code</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Name</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Category</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Unit</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Grain</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Date Basis</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Version</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Formula AST</strong>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {metricDefsData?.data.map((def) => (
                    <TableRow key={def.code}>
                      <TableCell>
                        <code>{def.code}</code>
                      </TableCell>
                      <TableCell>{def.name}</TableCell>
                      <TableCell>
                        <Chip label={def.category} size="small" />
                      </TableCell>
                      <TableCell>{def.unit}</TableCell>
                      <TableCell>{def.grain}</TableCell>
                      <TableCell>{def.dateBasis}</TableCell>
                      <TableCell>v{def.version}</TableCell>
                      <TableCell>
                        <Button size="small" variant="outlined" onClick={() => setFormulaModalDef(def)}>
                          View AST
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      )}

      {/* ======================================================== */}
      {/* Tab 3: Exports & Schedules (SUB-RPT.05 ENT-111) */}
      {/* ======================================================== */}
      {activeTab === 3 && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Box>
              <Typography variant="h6" fontWeight={600}>
                Data Exports & Automated Schedules (ENT-111)
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Secure asynchronous exports with 24-hour expiration and automated recurring email schedules.
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button variant="outlined" onClick={() => setExportDialogOpen(true)}>
                New Export
              </Button>
              <Button variant="contained" onClick={() => setScheduleDialogOpen(true)}>
                New Schedule
              </Button>
            </Box>
          </Box>

          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            Export Jobs
          </Typography>
          {exportsLoading ? (
            <CircularProgress />
          ) : (
            <TableContainer component={Paper} variant="outlined" sx={{ mb: 4 }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell>
                      <strong>ID</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Export Type</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Format</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Status</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Row Count</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Expires At (24h)</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Download</strong>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {exportsData?.data && exportsData.data.length > 0 ? (
                    exportsData.data.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell>
                          <code>{job.id}</code>
                        </TableCell>
                        <TableCell>{job.exportType}</TableCell>
                        <TableCell>
                          <Chip label={job.fileFormat} size="small" />
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={job.status}
                            size="small"
                            color={job.status === 'COMPLETED' ? 'success' : 'default'}
                          />
                        </TableCell>
                        <TableCell>{job.rowCount}</TableCell>
                        <TableCell>{new Date(job.expiresAt).toLocaleString()}</TableCell>
                        <TableCell>
                          {job.downloadUrl ? (
                            <Button
                              size="small"
                              onClick={() => {
                                void apiDownload(
                                  job.downloadUrl!,
                                  `export_${job.id}.${job.fileFormat.toLowerCase()}`,
                                );
                              }}
                            >
                              Download
                            </Button>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} align="center">
                        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                          No recent export jobs. Click &quot;New Export&quot; to initiate a data export.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            Scheduled Reports
          </Typography>
          {schedulesLoading ? (
            <CircularProgress />
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell>
                      <strong>ID</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Report Code</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Frequency</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Recipients</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Next Run</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Status</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Action</strong>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {schedulesData?.data && schedulesData.data.length > 0 ? (
                    schedulesData.data.map((sch) => (
                      <TableRow key={sch.id}>
                        <TableCell>
                          <code>{sch.id}</code>
                        </TableCell>
                        <TableCell>{sch.reportCode}</TableCell>
                        <TableCell>
                          <Chip label={sch.frequency} size="small" color="primary" />
                        </TableCell>
                        <TableCell>{sch.recipientEmails.join(', ')}</TableCell>
                        <TableCell>{new Date(sch.nextRunAt).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <Chip
                            label={sch.isActive ? 'ACTIVE' : 'PAUSED'}
                            size="small"
                            color={sch.isActive ? 'success' : 'default'}
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            size="small"
                            color="error"
                            disabled={deleteScheduleMutation.isPending}
                            onClick={() => handleDeleteSchedule(sch.id)}
                          >
                            Delete
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} align="center">
                        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                          No recurring report schedules configured. Click &quot;New Schedule&quot; to add one.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      )}

      {/* ======================================================== */}
      {/* Tab 4: Daily Control Totals (SUB-RPT.02 FR-RPT-008) */}
      {/* ======================================================== */}
      {activeTab === 4 && (
        <Box>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              mb: 3,
              flexWrap: 'wrap',
              gap: 2,
            }}
          >
            <Box>
              <Typography variant="h6" fontWeight={600}>
                Daily Control Totals & Ledger Reconciliation (FR-RPT-008)
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Mathematical reconciliation between OLTP primary tables and daily operational summary
                projections (`app.rpt_daily_operational_summary`).
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <TextField
                label="Summary Date (YYYY-MM-DD)"
                size="small"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                sx={{ width: 180 }}
              />
              <Button
                variant="contained"
                onClick={handleRefreshProjections}
                disabled={refreshProjMutation.isPending}
              >
                {refreshProjMutation.isPending ? 'Refreshing...' : 'Refresh Projections'}
              </Button>
            </Box>
          </Box>

          {refreshProjMutation.isSuccess && (
            <Alert severity="success" sx={{ mb: 3 }}>
              {refreshProjMutation.data?.message || 'Projections refreshed successfully.'}
            </Alert>
          )}

          {controlTotalsLoading ? (
            <CircularProgress />
          ) : controlTotalsData ? (
            <Box>
              <Card variant="outlined" sx={{ mb: 3 }}>
                <CardHeader
                  title={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Typography variant="h6">
                        Reconciliation Status for {controlTotalsData.summaryDate}
                      </Typography>
                      <Chip
                        label={controlTotalsData.reconciled ? 'RECONCILED (0 VARIANCE)' : 'VARIANCE DETECTED'}
                        color={controlTotalsData.reconciled ? 'success' : 'error'}
                        sx={{ fontWeight: 700 }}
                      />
                    </Box>
                  }
                  subheader={`Tenant ID: ${controlTotalsData.tenantId} • Reconciled As Of: ${new Date(controlTotalsData.asOf).toLocaleString()}`}
                />
                <CardContent>
                  <TableContainer component={Paper} variant="outlined">
                    <Table>
                      <TableHead>
                        <TableRow sx={{ bgcolor: 'action.hover' }}>
                          <TableCell>
                            <strong>Metric Domain</strong>
                          </TableCell>
                          <TableCell align="right">
                            <strong>OLTP Primary Tables</strong>
                          </TableCell>
                          <TableCell align="right">
                            <strong>Reporting Projection Store</strong>
                          </TableCell>
                          <TableCell align="right">
                            <strong>Variance Difference</strong>
                          </TableCell>
                          <TableCell align="center">
                            <strong>Status</strong>
                          </TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        <TableRow>
                          <TableCell>Leads Created</TableCell>
                          <TableCell align="right">{controlTotalsData.oltpTotals.leads}</TableCell>
                          <TableCell align="right">{controlTotalsData.projectionTotals.leads}</TableCell>
                          <TableCell align="right">{controlTotalsData.variance.leadsDiff}</TableCell>
                          <TableCell align="center">
                            <Chip
                              label={controlTotalsData.variance.leadsDiff === 0 ? 'MATCH' : 'DIFF'}
                              size="small"
                              color={controlTotalsData.variance.leadsDiff === 0 ? 'success' : 'error'}
                            />
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Sanction Count</TableCell>
                          <TableCell align="right">{controlTotalsData.oltpTotals.sanctions}</TableCell>
                          <TableCell align="right">{controlTotalsData.projectionTotals.sanctions}</TableCell>
                          <TableCell align="right">{controlTotalsData.variance.sanctionsDiff}</TableCell>
                          <TableCell align="center">
                            <Chip
                              label={controlTotalsData.variance.sanctionsDiff === 0 ? 'MATCH' : 'DIFF'}
                              size="small"
                              color={controlTotalsData.variance.sanctionsDiff === 0 ? 'success' : 'error'}
                            />
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Sanction Amount</TableCell>
                          <TableCell align="right">
                            ₹{controlTotalsData.oltpTotals.sanctionAmount.toLocaleString('en-IN')}
                          </TableCell>
                          <TableCell align="right">
                            ₹{controlTotalsData.projectionTotals.sanctionAmount.toLocaleString('en-IN')}
                          </TableCell>
                          <TableCell align="right">
                            ₹{controlTotalsData.variance.sanctionAmountDiff.toLocaleString('en-IN')}
                          </TableCell>
                          <TableCell align="center">
                            <Chip
                              label={controlTotalsData.variance.sanctionAmountDiff === 0 ? 'MATCH' : 'DIFF'}
                              size="small"
                              color={
                                controlTotalsData.variance.sanctionAmountDiff === 0 ? 'success' : 'error'
                              }
                            />
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Disbursement Count</TableCell>
                          <TableCell align="right">{controlTotalsData.oltpTotals.disbursements}</TableCell>
                          <TableCell align="right">
                            {controlTotalsData.projectionTotals.disbursements}
                          </TableCell>
                          <TableCell align="right">{controlTotalsData.variance.disbursementsDiff}</TableCell>
                          <TableCell align="center">
                            <Chip
                              label={controlTotalsData.variance.disbursementsDiff === 0 ? 'MATCH' : 'DIFF'}
                              size="small"
                              color={controlTotalsData.variance.disbursementsDiff === 0 ? 'success' : 'error'}
                            />
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Disbursement Volume</TableCell>
                          <TableCell align="right">
                            ₹{controlTotalsData.oltpTotals.disbursementAmount.toLocaleString('en-IN')}
                          </TableCell>
                          <TableCell align="right">
                            ₹{controlTotalsData.projectionTotals.disbursementAmount.toLocaleString('en-IN')}
                          </TableCell>
                          <TableCell align="right">
                            ₹{controlTotalsData.variance.disbursementAmountDiff.toLocaleString('en-IN')}
                          </TableCell>
                          <TableCell align="center">
                            <Chip
                              label={
                                controlTotalsData.variance.disbursementAmountDiff === 0 ? 'MATCH' : 'DIFF'
                              }
                              size="small"
                              color={
                                controlTotalsData.variance.disbursementAmountDiff === 0 ? 'success' : 'error'
                              }
                            />
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            </Box>
          ) : null}
        </Box>
      )}

      {/* ======================================================== */}
      {/* DIALOGS */}
      {/* ======================================================== */}

      {/* Run Report Dialog */}
      <Dialog open={runDialogOpen} onClose={() => setRunDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Run Standard Report: {selectedReport?.title}</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {startRunMutation.isError && <Alert severity="error">{errorText(startRunMutation.error)}</Alert>}
            <Typography variant="body2" color="text.secondary">
              {selectedReport?.description}
            </Typography>
            <TextField
              select
              label="Output Format"
              value={runFormat}
              onChange={(e) => setRunFormat(e.target.value as any)}
              fullWidth
            >
              {selectedReport?.supportedFormats.map((fmt) => (
                <MenuItem key={fmt} value={fmt}>
                  {fmt}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Branch Scoping ID (optional)"
              placeholder="e.g. brn_mumbai_01"
              value={runBranchId}
              onChange={(e) => setRunBranchId(e.target.value)}
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRunDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleStartRun} disabled={startRunMutation.isPending}>
            {startRunMutation.isPending ? 'Starting...' : 'Execute Run'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create Export Dialog */}
      <Dialog open={exportDialogOpen} onClose={() => setExportDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Initiate Data Export</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Alert severity="warning">
              Exports expire automatically after 24 hours per RBI data retention guidelines (ENT-111).
            </Alert>
            <TextField
              select
              label="Export Entity Type"
              value={exportType}
              onChange={(e) => setExportType(e.target.value)}
              fullWidth
            >
              <MenuItem value="METRICS">Performance Metrics</MenuItem>
              <MenuItem value="OPERATIONAL_SUMMARY">Daily Operational Summary</MenuItem>
              <MenuItem value="LEADS">Lead Pipeline Dump</MenuItem>
              <MenuItem value="DISBURSEMENTS">Disbursement Register</MenuItem>
            </TextField>
            <TextField
              select
              label="File Format"
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as any)}
              fullWidth
            >
              <MenuItem value="CSV">CSV</MenuItem>
              <MenuItem value="XLSX">Excel (XLSX)</MenuItem>
              <MenuItem value="JSON">JSON</MenuItem>
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExportDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateExport} disabled={createExportMutation.isPending}>
            {createExportMutation.isPending ? 'Generating...' : 'Export'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create Report Schedule Dialog */}
      <Dialog open={scheduleDialogOpen} onClose={() => setScheduleDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Automated Report Schedule</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              select
              label="Report"
              value={scheduleReportCode}
              onChange={(e) => setScheduleReportCode(e.target.value)}
              fullWidth
            >
              {catalogueData?.data.map((r) => (
                <MenuItem key={r.code} value={r.code}>
                  {r.title} ({r.code})
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Delivery Frequency"
              value={scheduleFreq}
              onChange={(e) => setScheduleFreq(e.target.value as any)}
              fullWidth
            >
              <MenuItem value="DAILY">Daily (06:00 AM)</MenuItem>
              <MenuItem value="WEEKLY">Weekly (Monday 08:00 AM)</MenuItem>
              <MenuItem value="MONTHLY">Monthly (1st Day 09:00 AM)</MenuItem>
            </TextField>
            <TextField
              label="Recipient Email Address"
              type="email"
              value={scheduleEmail}
              onChange={(e) => setScheduleEmail(e.target.value)}
              placeholder="e.g. operations@dsa-nbfc.com"
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setScheduleDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateSchedule}
            disabled={createScheduleMutation.isPending || !scheduleEmail}
          >
            {createScheduleMutation.isPending ? 'Scheduling...' : 'Save Schedule'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Formula AST Modal */}
      <Dialog open={!!formulaModalDef} onClose={() => setFormulaModalDef(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Formula Expression AST: {formulaModalDef?.name}</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Metric Code: <code>{formulaModalDef?.code}</code> • Grain: {formulaModalDef?.grain} • Date
              Basis: {formulaModalDef?.dateBasis}
            </Typography>
            <Paper
              variant="outlined"
              sx={{ p: 2, bgcolor: 'grey.900', color: 'common.white', overflow: 'auto' }}
            >
              <pre style={{ margin: 0, fontFamily: 'monospace' }}>
                {JSON.stringify(formulaModalDef?.formula, null, 2)}
              </pre>
            </Paper>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFormulaModalDef(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
