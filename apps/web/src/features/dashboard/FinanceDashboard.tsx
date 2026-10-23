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
import { hasPermission, useMe } from '../../api/useMe';
import { Can } from '../../shell/Can';
import { ConnectorName } from '../../shell/display';
import { fetchCommissionPlans } from '../commission/api';
import { fetchPayoutRequests } from '../payouts/api';
import type { PayoutRequest } from '../payouts/types';
import {
  DashboardDateFilter,
  type DateRangeScope,
  KpiMetricCard,
  PipelineFunnelChart,
  TaskWorkQueue,
  type TaskWorkQueueItem,
} from './components';

export function FinanceDashboard() {
  const me = useMe();
  const [dateScope, setDateScope] = useState<DateRangeScope>('month');

  // Check if current user is Checker (holds payout.approve)
  const isChecker = hasPermission(me.data, 'payout.approve');

  const { data: payoutsData, isLoading: payoutsLoading, isError: payoutsError } = useQuery({
    queryKey: ['finance-dashboard-payouts', dateScope],
    queryFn: () => fetchPayoutRequests({ limit: 25 }),
  });

  const { data: plansData, isLoading: plansLoading, isError: plansError } = useQuery({
    queryKey: ['finance-dashboard-plans', dateScope],
    queryFn: () => fetchCommissionPlans({ limit: 20 }),
  });

  const payouts: PayoutRequest[] = payoutsData?.data ?? [];
  const plans = plansData?.data ?? [];

  // Payout status counts
  const pendingPayouts = payouts.filter(
    (p) => p.status === 'SUBMITTED' || p.status === 'DRAFT',
  );
  const pendingPayoutsCount = pendingPayouts.length;
  const approvedPayoutsCount = payouts.filter((p) => p.status === 'APPROVED').length;
  const activePlansCount = plans.filter((p) => p.status === 'ACTIVE').length;

  const totalPendingAmount = pendingPayouts.reduce(
    (sum, p) => sum + (parseFloat(p.total) || 0),
    0,
  );
  const totalApprovedAmount = payouts
    .filter((p) => p.status === 'APPROVED')
    .reduce((sum, p) => sum + (parseFloat(p.total) || 0), 0);

  // Funnel stages for payouts
  const payoutStages = [
    {
      key: 'draft',
      label: 'Draft Requests',
      count: payouts.filter((p) => p.status === 'DRAFT').length,
      color: '#757575',
      to: '/payouts',
    },
    {
      key: 'submitted',
      label: 'Submitted for Approval',
      count: payouts.filter((p) => p.status === 'SUBMITTED').length,
      amount: totalPendingAmount,
      color: '#ed6c02',
      to: '/payouts',
    },
    {
      key: 'approved',
      label: 'Approved (Bank Ready)',
      count: approvedPayoutsCount,
      amount: totalApprovedAmount,
      color: '#2e7d32',
      to: '/payouts',
    },
  ];

  // Map payout requests to TaskWorkQueueItem with 4-eye SOD checker protection
  const queueItems: TaskWorkQueueItem[] = pendingPayouts.slice(0, 5).map((p) => {
    const isMaker = p.submittedBy === me.data?.id;
    return {
      id: p.id,
      title: `Payout #${p.id.slice(0, 8)} · ₹${(parseFloat(p.total) / 1000).toFixed(1)}K`,
      category: p.origin === 'CONNECTOR' ? 'Sub-DSA Payout' : 'Finance Batch',
      priority: p.status === 'SUBMITTED' ? 'URGENT' : 'HIGH',
      entityLink: {
        label: `CON-${p.connectorId ? p.connectorId.slice(0, 6) : 'DSA'}`,
        to: `/connectors`,
      },
      actionLabel: isChecker && !isMaker ? 'Approve' : 'Review',
      onAction: () => {
        window.location.href = `/payouts`;
      },
    };
  });

  return (
    <Container maxWidth="xl" sx={{ py: 4 }} data-testid="finance-dashboard">
      {/* Header & Controls */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Finance & Commission Management
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {isChecker
              ? '4-Eye Authorization Mode: Dual-control verification required before bank disbursement.'
              : 'Oversee partner payouts, commission accruals, period close, and ledger reconciliation.'}
          </Typography>
        </Box>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
          <DashboardDateFilter value={dateScope} onChange={setDateScope} />
          <Can action="commission.calculate">
            <Button variant="contained" color="primary" component={RouterLink} to="/commission">
              Calculate Commissions
            </Button>
          </Can>
          <Button variant="outlined" component={RouterLink} to="/payouts">
            Payout Batches
          </Button>
          <Button variant="outlined" component={RouterLink} to="/reconciliation">
            Reconciliation
          </Button>
        </Stack>
      </Box>

      {/* 4-Eye SOD Notice Banner for Checkers */}
      {isChecker && (
        <Alert severity="info" sx={{ mb: 3, borderRadius: 2 }}>
          <strong>Segregation of Duties (SOD-09 Active):</strong> You are logged in with Checker authorization privileges.
          Batches submitted by your own account are locked from self-approval.
        </Alert>
      )}

      {/* KPI Overview Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Awaiting Approval"
            value={pendingPayoutsCount}
            format="number"
            subtitle="Dual-control pending runs"
            status="warning"
            isLoading={payoutsLoading}
            isError={payoutsError}
            to="/payouts"
            dataTestId="kpi-fin-pending-payouts"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Pending Payout Value"
            value={totalPendingAmount}
            format="currency"
            subtitle="Calculated commissions"
            status="info"
            isLoading={payoutsLoading}
            isError={payoutsError}
            to="/payouts"
            dataTestId="kpi-fin-pending-amount"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Approved Batches"
            value={approvedPayoutsCount}
            format="number"
            subtitle="Ready for bank dispatch"
            status="success"
            isLoading={payoutsLoading}
            isError={payoutsError}
            to="/payouts"
            dataTestId="kpi-fin-approved"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Active Commission Plans"
            value={activePlansCount}
            format="number"
            subtitle="Lender rule schedules"
            status="primary"
            isLoading={plansLoading}
            isError={plansError}
            to="/commission"
            dataTestId="kpi-fin-plans"
          />
        </Grid>
      </Grid>

      {/* Main Content Layout */}
      <Grid container spacing={3}>
        {/* Left Column: Funnel & Recent Payouts */}
        <Grid item xs={12} md={7}>
          <Stack spacing={3}>
            <PipelineFunnelChart
              title="Payout Batch Lifecycle"
              subtitle="Partner commission payout progression from draft to bank clearance"
              stages={payoutStages}
              isLoading={payoutsLoading}
              dataTestId="finance-payout-funnel"
            />

            <Paper sx={{ p: 3, borderRadius: 2, border: '1px solid', borderColor: 'divider', boxShadow: 'none' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" fontWeight={700}>
                  Recent Payout Requests
                </Typography>
                <Button size="small" component={RouterLink} to="/payouts">
                  View All &rarr;
                </Button>
              </Box>
              {payoutsError && <Alert severity="error">Unable to load payout requests.</Alert>}
              {payoutsLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                  <CircularProgress size={32} />
                </Box>
              ) : payouts.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                  No payout batches requested yet.
                </Typography>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Batch Ref</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Connector</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Amount</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {payouts.slice(0, 5).map((p: PayoutRequest) => (
                        <TableRow key={p.id} hover>
                          <TableCell sx={{ fontWeight: 600 }}>#{p.id.slice(0, 8)}</TableCell>
                          <TableCell>
                            <ConnectorName id={p.connectorId} />
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>
                            ₹{parseFloat(p.total).toLocaleString('en-IN')}
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={p.status}
                              size="small"
                              color={p.status === 'APPROVED' ? 'success' : p.status === 'SUBMITTED' ? 'warning' : 'default'}
                              sx={{ height: 22, fontSize: 11, fontWeight: 600 }}
                            />
                          </TableCell>
                          <TableCell align="right">
                            <Button size="small" variant="outlined" component={RouterLink} to={`/payouts`}>
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
            title={isChecker ? '4-Eye Payout Approval Queue' : 'Settlement Action Items'}
            subtitle={
              isChecker
                ? 'Dual-control payout runs awaiting checker verification'
                : 'Pending partner calculations and reconciliation tasks'
            }
            items={queueItems}
            isLoading={payoutsLoading}
            viewAllTo="/payouts"
            dataTestId="finance-work-queue"
          />
        </Grid>
      </Grid>
    </Container>
  );
}
