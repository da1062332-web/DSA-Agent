import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useList } from '../admin/api';
import { fetchLeads } from '../leads/api';
import type { LeadResource } from '../leads/types';
import type { Application } from '../applications/ApplicationsPage';
import {
  DashboardDateFilter,
  type DateRangeScope,
  KpiMetricCard,
  PipelineFunnelChart,
  TaskWorkQueue,
  type TaskWorkQueueItem,
} from './components';
import { NotSet } from '../../ui/NotSet';

export function RMDashboard() {
  const [dateScope, setDateScope] = useState<DateRangeScope>('month');

  const { data: leadsData, isLoading: leadsLoading, isError: leadsError } = useQuery({
    queryKey: ['rm-dashboard-qualified-leads', dateScope],
    queryFn: () => fetchLeads({ state: 'QUALIFIED', limit: 50 }),
  });

  const { data: appsData, isLoading: appsLoading, isError: appsError } = useList<Application>(
    '/v1/applications',
    {},
    50,
  );

  const leads: LeadResource[] = leadsData?.data ?? [];
  const applications = appsData?.pages.flatMap((p) => p.data) ?? [];

  // KPI Calculations from real backend data
  const qualifiedCount = leads.length;
  const activeAppsCount = applications.length;

  const totalPipelineAmount = applications.reduce((sum, app) => {
    const amt = parseFloat(app.requestedAmount) || 0;
    return sum + amt;
  }, 0);

  const averageLoanSize = activeAppsCount > 0 ? totalPipelineAmount / activeAppsCount : 0;

  // Status progression funnel
  const draftCount = applications.filter((a) => a.status === 'DRAFT').length;
  const underReviewCount = applications.filter(
    (a) => a.status === 'UNDER_REVIEW' || a.status === 'READY_FOR_SUBMISSION',
  ).length;
  const submittedCount = applications.filter((a) => a.status === 'SUBMITTED').length;
  const sanctionedCount = applications.filter(
    (a) => a.status === 'SANCTIONED' || a.status === 'DISBURSED',
  ).length;

  const appFunnelStages = [
    { key: 'draft', label: 'Draft Files', count: draftCount, color: '#215988', to: '/applications?status=DRAFT' },
    {
      key: 'review',
      label: 'Under Review',
      count: underReviewCount,
      color: '#3876BE',
      to: '/applications?status=UNDER_REVIEW',
    },
    {
      key: 'submitted',
      label: 'Submitted to Lenders',
      count: submittedCount,
      color: '#f59e0b',
      to: '/applications?status=SUBMITTED',
    },
    {
      key: 'sanctioned',
      label: 'Sanctioned / Approved',
      count: sanctionedCount,
      color: '#16A34A',
      to: '/applications?status=SANCTIONED',
    },
  ];

  // Map active applications to actionable task queue items
  const actionableItems: TaskWorkQueueItem[] = applications.slice(0, 8).map((app) => ({
    id: app.id,
    title: `Loan File: ${app.productCategory || 'Unsecured Loan'}`,
    category: app.status,
    priority: app.onHold ? 'URGENT' : 'HIGH',
    isOverdue: Boolean(app.onHold),
    entityLink: {
      label: `APP-${app.id.slice(0, 6)}`,
      to: `/applications/${app.id}`,
    },
    actionLabel: 'Open File',
  }));

  return (
    <Box sx={{ width: '100%', py: 1 }} data-testid="rm-dashboard">
      {/* Executive Command Header */}
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2, sm: 2.5 },
          mb: 2.5,
          borderRadius: 2.5,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2,
        }}
      >
        <Box>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="h5" fontWeight={700} sx={{ letterSpacing: '-0.02em' }}>
              Relationship Manager Portal
            </Typography>
            <Chip
              label="RM Portfolio"
              color="primary"
              size="small"
              sx={{ fontWeight: 700, fontSize: 11 }}
            />
            <Chip
              label="● Origination Sync"
              color="success"
              size="small"
              variant="outlined"
              sx={{ fontWeight: 600, fontSize: 11 }}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Nurture borrower relationships, convert qualified leads into origination files, and track partner connectors.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
          <DashboardDateFilter value={dateScope} onChange={setDateScope} />
          <Button variant="contained" color="primary" component={RouterLink} to="/applications" sx={{ fontWeight: 700 }}>
            + New Loan File
          </Button>
          <Button variant="outlined" component={RouterLink} to="/leads">
            Qualified Leads
          </Button>
          <Button variant="outlined" component={RouterLink} to="/connectors">
            Connectors
          </Button>
        </Stack>
      </Paper>

      {/* KPI Overview Cards */}
      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Qualified Leads"
            value={qualifiedCount}
            format="number"
            subtitle="Ready to convert"
            status="primary"
            isLoading={leadsLoading}
            isError={leadsError}
            to="/leads?filter[state]=QUALIFIED"
            dataTestId="kpi-rm-qualified"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Active Origination Files"
            value={activeAppsCount}
            format="number"
            subtitle="In underwriting pipeline"
            status="info"
            isLoading={appsLoading}
            isError={appsError}
            to="/applications"
            dataTestId="kpi-rm-apps"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Total Pipeline Value"
            value={totalPipelineAmount}
            format="currency"
            subtitle="Requested borrow volume"
            status="success"
            isLoading={appsLoading}
            isError={appsError}
            to="/applications"
            dataTestId="kpi-rm-pipeline-val"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Avg Loan Size"
            value={averageLoanSize}
            format="currency"
            subtitle="Per borrower application"
            status="primary"
            isLoading={appsLoading}
            isError={appsError}
            dataTestId="kpi-rm-avg-loan"
          />
        </Grid>
      </Grid>

      {/* Middle Row: Balanced Funnel & Work Queue */}
      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
        <Grid item xs={12} lg={7}>
          <PipelineFunnelChart
            variant="columns"
            title="Origination Stage Progression"
            subtitle="Borrower application files by underwriting status"
            stages={appFunnelStages}
            isLoading={appsLoading}
            dataTestId="rm-origination-funnel"
          />
        </Grid>
        <Grid item xs={12} lg={5}>
          <TaskWorkQueue
            title="Actionable Loan Files"
            subtitle="Applications needing documents, verifications or lender follow-up"
            items={actionableItems}
            isLoading={appsLoading}
            viewAllTo="/applications"
            dataTestId="rm-work-queue"
          />
        </Grid>
      </Grid>

      {/* Full-Width Operational Table: Qualified Leads Awaiting Conversion */}
      <Paper
        elevation={0}
        sx={{
          p: 2.5,
          borderRadius: 2.5,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>
              Qualified Leads Awaiting Conversion
            </Typography>
            <Typography variant="caption" color="text.secondary">
              High-intent borrower leads ready for immediate loan file creation
            </Typography>
          </Box>
          <Button size="small" component={RouterLink} to="/leads" sx={{ fontWeight: 600 }}>
            View All &rarr;
          </Button>
        </Box>
        {leadsError && <Alert severity="error">Unable to load qualified leads.</Alert>}
        {leadsLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress size={32} />
          </Box>
        ) : leads.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
            No qualified leads waiting for loan file conversion right now.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Borrower</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Product</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Mobile</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>State</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {leads.slice(0, 8).map((l: LeadResource) => (
                  <TableRow key={l.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{l.fullName}</TableCell>
                    <TableCell>{l.productCategory || 'LOAN'}</TableCell>
                    <TableCell>{l.mobileMasked || <NotSet />}</TableCell>
                    <TableCell>
                      <Chip label="QUALIFIED" size="small" color="success" sx={{ height: 22, fontSize: 11, fontWeight: 700 }} />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant="outlined"
                        component={RouterLink}
                        to={`/leads/${l.id}`}
                        sx={{ fontSize: 11, py: 0.25, px: 1.25, height: 26 }}
                      >
                        Start File
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Box>
  );
}
