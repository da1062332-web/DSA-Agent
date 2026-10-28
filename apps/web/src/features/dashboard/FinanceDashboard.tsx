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
    queryFn: () => fetchPayoutRequests({ limit: 50 }),
  });

  const { data: plansData, isLoading: plansLoading, isError: plansError } = useQuery({
    queryKey: ['finance-dashboard-plans', dateScope],
    queryFn: () => fetchCommissionPlans({ limit: 50 }),
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
      color: '#215988',
      to: '/payouts',
    },
    {
      key: 'submitted',
      label: 'Submitted for Approval',
      count: payouts.filter((p) => p.status === 'SUBMITTED').length,
      amount: totalPendingAmount,
      color: '#f59e0b',
      to: '/payouts',
    },
    {
      key: 'approved',
      label: 'Approved (Bank Ready)',
      count: approvedPayoutsCount,
      amount: totalApprovedAmount,
      color: '#16A34A',
      to: '/payouts',
    },
  ];

  // Map payout requests to TaskWorkQueueItem with 4-eye SOD checker protection
  const queueItems: TaskWorkQueueItem[] = pendingPayouts.slice(0, 8).map((p) => {
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
    };
  });

  return (
    <Box sx={{ width: '100%', py: 1 }} data-testid="finance-dashboard">
      {/* 4-Eye SOD Notice Banner for Checkers */}
      {isChecker && (
        <Alert severity="warning" sx={{ mb: 2.5, borderRadius: 2.5, fontWeight: 500 }}>
          <strong>Segregation of Duties (SOD-09 Active):</strong> You are logged in with Checker authorization privileges.
          Batches submitted by your own account are locked from self-approval. Dual-control verification required before bank disbursement.
        </Alert>
      )}

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
              Finance &amp; Commission Management
            </Typography>
            <Chip
              label={isChecker ? 'Checker Mode' : 'Finance Maker'}
              color="primary"
              size="small"
              sx={{ fontWeight: 700, fontSize: 11 }}
            />
            <Chip
              label="● Ledger Synced"
              color="success"
              size="small"
              variant="outlined"
              sx={{ fontWeight: 600, fontSize: 11 }}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {isChecker
              ? 'Dual-control verification required before partner disbursement.'
              : 'Oversee partner payouts, commission accruals, period close, and ledger reconciliation.'}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
          <DashboardDateFilter value={dateScope} onChange={setDateScope} />
          <Can action="commission.calculate">
            <Button variant="contained" color="primary" component={RouterLink} to="/commission" sx={{ fontWeight: 700 }}>
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
      </Paper>

      {/* KPI Overview Cards */}
      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
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

      {/* Middle Row: Balanced Funnel & Work Queue */}
      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
        <Grid item xs={12} lg={7}>
          <PipelineFunnelChart
            variant="columns"
            title="Payout Batch Lifecycle"
            subtitle="Partner commission payout progression from draft to bank clearance"
            stages={payoutStages}
            isLoading={payoutsLoading}
            dataTestId="finance-payout-funnel"
          />
        </Grid>
        <Grid item xs={12} lg={5}>
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

      {/* Full-Width Operational Table: Recent Payout Requests */}
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
              Recent Payout Requests
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Settlement runs generated for field connectors and partners
            </Typography>
          </Box>
          <Button size="small" component={RouterLink} to="/payouts" sx={{ fontWeight: 600 }}>
            View All Payouts &rarr;
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
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Batch Ref</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Connector</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Amount</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Status</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {payouts.slice(0, 8).map((p: PayoutRequest) => (
                  <TableRow key={p.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>#{p.id.slice(0, 8)}</TableCell>
                    <TableCell>
                      <ConnectorName id={p.connectorId} />
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>
                      ₹{parseFloat(p.total).toLocaleString('en-IN')}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={p.status}
                        size="small"
                        color={p.status === 'APPROVED' ? 'success' : p.status === 'SUBMITTED' ? 'warning' : 'default'}
                        sx={{ height: 22, fontSize: 11, fontWeight: 700 }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant="outlined"
                        component={RouterLink}
                        to={`/payouts`}
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
