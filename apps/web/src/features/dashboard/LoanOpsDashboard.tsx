import { useState } from 'react';
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

  const { data, isLoading, isError } = useList<Application>('/v1/applications', {}, 50);
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
      color: '#3876BE',
      to: '/applications?status=UNDER_REVIEW',
    },
    {
      key: 'ready_submission',
      label: 'Ready for Lender',
      count: applications.filter((a) => a.status === 'READY_FOR_SUBMISSION').length,
      color: '#215988',
      to: '/applications?status=READY_FOR_SUBMISSION',
    },
    {
      key: 'submitted',
      label: 'Submitted to Lenders',
      count: applications.filter((a) => a.status === 'SUBMITTED').length,
      color: '#f59e0b',
      to: '/applications?status=SUBMITTED',
    },
    {
      key: 'sanctioned',
      label: 'Sanctioned / Disbursed',
      count: sanctionedCount,
      color: '#16A34A',
      to: '/sanctions',
    },
  ];

  // Map operational applications to task queue items
  const queueItems: TaskWorkQueueItem[] = applications
    .filter((a) => a.onHold || a.status === 'READY_FOR_SUBMISSION' || a.status === 'SUBMITTED')
    .slice(0, 8)
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
    }));

  return (
    <Box sx={{ width: '100%', py: 1 }} data-testid="loan-ops-dashboard">
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
              Loan Operations Workbench
            </Typography>
            <Chip
              label="Loan Ops"
              color="primary"
              size="small"
              sx={{ fontWeight: 700, fontSize: 11 }}
            />
            <Chip
              label="● Underwriting Engine"
              color="success"
              size="small"
              variant="outlined"
              sx={{ fontWeight: 600, fontSize: 11 }}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Process origination queues, verify borrower documents, and coordinate lender submissions.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
          <DashboardDateFilter value={dateScope} onChange={setDateScope} />
          <Button variant="contained" color="primary" component={RouterLink} to="/applications" sx={{ fontWeight: 700 }}>
            Origination Queue
          </Button>
          <Button variant="outlined" component={RouterLink} to="/verifications">
            Verification Queue
          </Button>
          <Button variant="outlined" component={RouterLink} to="/sanctions">
            Sanctions &amp; Disbursals
          </Button>
        </Stack>
      </Paper>

      {/* KPI Overview Cards */}
      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
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

      {/* Middle Row: Balanced Funnel & Work Queue */}
      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
        <Grid item xs={12} lg={7}>
          <PipelineFunnelChart
            variant="columns"
            title="Lender Operations Stage Progression"
            subtitle="Application distribution across lender submission pipeline"
            stages={opsStages}
            isLoading={isLoading}
            dataTestId="ops-lender-funnel"
          />
        </Grid>
        <Grid item xs={12} lg={5}>
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

      {/* Full-Width Operational Table: Active Origination Pipeline */}
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
              Active Origination Pipeline
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Borrower files actively undergoing underwriting and lender review
            </Typography>
          </Box>
          <Button size="small" component={RouterLink} to="/applications" sx={{ fontWeight: 600 }}>
            View All Applications &rarr;
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
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>File ID</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Borrower Category</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Amount</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Status</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {applications.slice(0, 8).map((app: Application) => (
                  <TableRow key={app.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>#{app.id.slice(0, 8)}</TableCell>
                    <TableCell>{app.applicantType?.replace(/_/g, ' ') || 'INDIVIDUAL'}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>₹{(parseFloat(app.requestedAmount) / 100000).toFixed(2)}L</TableCell>
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
                        sx={{ height: 22, fontSize: 11, fontWeight: 700 }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant="outlined"
                        component={RouterLink}
                        to={`/applications/${app.id}`}
                        sx={{ fontSize: 11, py: 0.25, px: 1.25, height: 26 }}
                      >
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
    </Box>
  );
}
