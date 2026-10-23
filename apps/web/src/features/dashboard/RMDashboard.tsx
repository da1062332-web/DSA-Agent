import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
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

export function RMDashboard() {
  const [dateScope, setDateScope] = useState<DateRangeScope>('month');

  const { data: leadsData, isLoading: leadsLoading, isError: leadsError } = useQuery({
    queryKey: ['rm-dashboard-qualified-leads', dateScope],
    queryFn: () => fetchLeads({ state: 'QUALIFIED', limit: 10 }),
  });

  const { data: appsData, isLoading: appsLoading, isError: appsError } = useList<Application>(
    '/v1/applications',
    {},
    15,
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
    { key: 'draft', label: 'Draft Files', count: draftCount, color: '#757575', to: '/applications?status=DRAFT' },
    {
      key: 'review',
      label: 'Under Review',
      count: underReviewCount,
      color: '#0288d1',
      to: '/applications?status=UNDER_REVIEW',
    },
    {
      key: 'submitted',
      label: 'Submitted to Lenders',
      count: submittedCount,
      color: '#ed6c02',
      to: '/applications?status=SUBMITTED',
    },
    {
      key: 'sanctioned',
      label: 'Sanctioned / Approved',
      count: sanctionedCount,
      color: '#2e7d32',
      to: '/applications?status=SANCTIONED',
    },
  ];

  // Map active applications to actionable task queue items
  const actionableItems: TaskWorkQueueItem[] = applications.slice(0, 5).map((app) => ({
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
    onAction: () => {
      window.location.href = `/applications/${app.id}`;
    },
  }));

  return (
    <Container maxWidth="xl" sx={{ py: 4 }} data-testid="rm-dashboard">
      {/* Header & Controls */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Relationship Manager Portal
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Nurture borrower relationships, convert qualified leads into origination files, and track partner connectors.
          </Typography>
        </Box>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
          <DashboardDateFilter value={dateScope} onChange={setDateScope} />
          <Button variant="contained" color="primary" component={RouterLink} to="/applications">
            + New Loan File
          </Button>
          <Button variant="outlined" component={RouterLink} to="/leads">
            Qualified Leads
          </Button>
          <Button variant="outlined" component={RouterLink} to="/connectors">
            Connectors
          </Button>
        </Stack>
      </Box>

      {/* KPI Overview Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
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

      {/* Main Content Layout */}
      <Grid container spacing={3}>
        {/* Left Column: Funnel & Active Files */}
        <Grid item xs={12} md={7}>
          <Stack spacing={3}>
            <PipelineFunnelChart
              title="Origination Stage Progression"
              subtitle="Borrower application files by underwriting status"
              stages={appFunnelStages}
              isLoading={appsLoading}
              dataTestId="rm-origination-funnel"
            />

            <Paper sx={{ p: 3, borderRadius: 2, border: '1px solid', borderColor: 'divider', boxShadow: 'none' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" fontWeight={700}>
                  Qualified Leads Awaiting Conversion
                </Typography>
                <Button size="small" component={RouterLink} to="/leads">
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
                        <TableCell sx={{ fontWeight: 600 }}>Borrower</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Product</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>State</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {leads.slice(0, 5).map((l: LeadResource) => (
                        <TableRow key={l.id} hover>
                          <TableCell sx={{ fontWeight: 600 }}>{l.fullName}</TableCell>
                          <TableCell>{l.productCategory || 'LOAN'}</TableCell>
                          <TableCell>
                            <Chip label="QUALIFIED" size="small" color="success" sx={{ height: 22, fontSize: 11, fontWeight: 600 }} />
                          </TableCell>
                          <TableCell align="right">
                            <Button size="small" variant="outlined" component={RouterLink} to={`/leads/${l.id}`}>
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
          </Stack>
        </Grid>

        {/* Right Column: Work Queue */}
        <Grid item xs={12} md={5}>
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
    </Container>
  );
}
