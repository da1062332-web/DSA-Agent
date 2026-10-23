import { useState } from 'react';
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
import type { Application } from '../applications/ApplicationsPage';
import {
  DashboardDateFilter,
  type DateRangeScope,
  KpiMetricCard,
  PipelineFunnelChart,
  TaskWorkQueue,
  type TaskWorkQueueItem,
} from './components';

export function LoanOpsDashboard() {
  const [dateScope, setDateScope] = useState<DateRangeScope>('month');

  const { data, isLoading, isError } = useList<Application>('/v1/applications', {}, 25);
  const applications = data?.pages.flatMap((p) => p.data) ?? [];

  const inReviewCount = applications.filter(
    (a) =>
      a.status === 'UNDER_REVIEW' ||
      a.status === 'READY_FOR_SUBMISSION' ||
      a.status === 'SUBMITTED',
  ).length;
  const onHoldCount = applications.filter((a) => a.onHold).length;
  const sanctionedCount = applications.filter(
    (a) => a.status === 'SANCTIONED' || a.status === 'DISBURSED',
  ).length;

  const totalSanctionedAmount = applications
    .filter((a) => a.status === 'SANCTIONED' || a.status === 'DISBURSED')
    .reduce((sum, a) => sum + (parseFloat(a.requestedAmount) || 0), 0);

  // Funnel stages for loan operations
  const opsStages = [
    {
      key: 'in_review',
      label: 'Under Review',
      count: applications.filter((a) => a.status === 'UNDER_REVIEW').length,
      color: '#0288d1',
      to: '/applications?status=UNDER_REVIEW',
    },
    {
      key: 'ready_submission',
      label: 'Ready for Lender',
      count: applications.filter((a) => a.status === 'READY_FOR_SUBMISSION').length,
      color: '#7b1fa2',
      to: '/applications?status=READY_FOR_SUBMISSION',
    },
    {
      key: 'submitted',
      label: 'Submitted to Lenders',
      count: applications.filter((a) => a.status === 'SUBMITTED').length,
      color: '#ed6c02',
      to: '/applications?status=SUBMITTED',
    },
    {
      key: 'sanctioned',
      label: 'Sanctioned / Disbursed',
      count: sanctionedCount,
      color: '#2e7d32',
      to: '/sanctions',
    },
  ];

  // Map operational applications to task queue items
  const queueItems: TaskWorkQueueItem[] = applications
    .filter((a) => a.onHold || a.status === 'READY_FOR_SUBMISSION' || a.status === 'SUBMITTED')
    .slice(0, 5)
    .map((app) => ({
      id: app.id,
      title: `${app.applicantType.replace(/_/g, ' ')} · ₹${(parseFloat(app.requestedAmount) / 100000).toFixed(1)}L`,
      category: app.productCategory || 'LOAN',
      priority: app.onHold ? 'URGENT' : app.status === 'READY_FOR_SUBMISSION' ? 'HIGH' : 'MEDIUM',
      isOverdue: Boolean(app.onHold),
      entityLink: {
        label: `APP-${app.id.slice(0, 6)}`,
        to: `/applications/${app.id}`,
      },
      actionLabel: 'Review',
      onAction: () => {
        window.location.href = `/applications/${app.id}`;
      },
    }));

  return (
    <Container maxWidth="xl" sx={{ py: 4 }} data-testid="loan-ops-dashboard">
      {/* Header & Controls */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Loan Operations Workbench
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Process origination queues, verify borrower documents, and coordinate lender submissions.
          </Typography>
        </Box>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
          <DashboardDateFilter value={dateScope} onChange={setDateScope} />
          <Button variant="contained" color="primary" component={RouterLink} to="/applications">
            Origination Queue
          </Button>
          <Button variant="outlined" component={RouterLink} to="/verifications">
            Verification Queue
          </Button>
          <Button variant="outlined" component={RouterLink} to="/sanctions">
            Sanctions & Disbursals
          </Button>
        </Stack>
      </Box>

      {/* KPI Overview Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Applications In Review"
            value={inReviewCount}
            format="number"
            subtitle="Underwriting & ops queues"
            status="primary"
            isLoading={isLoading}
            isError={isError}
            to="/applications?status=UNDER_REVIEW"
            dataTestId="kpi-ops-inreview"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Applications On Hold"
            value={onHoldCount}
            format="number"
            subtitle="Blocked on queries or customer docs"
            status="error"
            isLoading={isLoading}
            isError={isError}
            to="/applications"
            dataTestId="kpi-ops-onhold"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Sanctioned / Approved"
            value={sanctionedCount}
            format="number"
            subtitle="Ready for tranche disbursal"
            status="success"
            isLoading={isLoading}
            isError={isError}
            to="/sanctions"
            dataTestId="kpi-ops-sanctioned"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Sanction Volume"
            value={totalSanctionedAmount}
            format="currency"
            subtitle="Disbursed & approved value"
            status="info"
            isLoading={isLoading}
            isError={isError}
            to="/sanctions"
            dataTestId="kpi-ops-volume"
          />
        </Grid>
      </Grid>

      {/* Main Content Layout */}
      <Grid container spacing={3}>
        {/* Left Column: Funnel & Active Files */}
        <Grid item xs={12} md={7}>
          <Stack spacing={3}>
            <PipelineFunnelChart
              title="Lender Operations Stage Progression"
              subtitle="Application distribution across lender submission pipeline"
              stages={opsStages}
              isLoading={isLoading}
              dataTestId="ops-lender-funnel"
            />

            <Paper sx={{ p: 3, borderRadius: 2, border: '1px solid', borderColor: 'divider', boxShadow: 'none' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" fontWeight={700}>
                  Active Origination Pipeline
                </Typography>
                <Button size="small" component={RouterLink} to="/applications">
                  View All &rarr;
                </Button>
              </Box>
              {isError && <Alert severity="error">Unable to load application queue.</Alert>}
              {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                  <CircularProgress size={32} />
                </Box>
              ) : applications.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                  No active loan applications in review currently.
                </Typography>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>File ID</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Amount</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {applications.slice(0, 5).map((app: Application) => (
                        <TableRow key={app.id} hover>
                          <TableCell sx={{ fontWeight: 600 }}>#{app.id.slice(0, 8)}</TableCell>
                          <TableCell>₹{(parseFloat(app.requestedAmount) / 100000).toFixed(2)}L</TableCell>
                          <TableCell>
                            <Chip
                              label={app.status}
                              size="small"
                              color={
                                app.status === 'SANCTIONED' || app.status === 'DISBURSED'
                                  ? 'success'
                                  : app.onHold
                                  ? 'error'
                                  : 'primary'
                              }
                              sx={{ height: 22, fontSize: 11, fontWeight: 600 }}
                            />
                          </TableCell>
                          <TableCell align="right">
                            <Button size="small" variant="outlined" component={RouterLink} to={`/applications/${app.id}`}>
                              Open
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
            title="Operational Action Queue"
            subtitle="Priority lender submissions, holds and condition clearances"
            items={queueItems}
            isLoading={isLoading}
            viewAllTo="/applications"
            dataTestId="ops-work-queue"
          />
        </Grid>
      </Grid>
    </Container>
  );
}
