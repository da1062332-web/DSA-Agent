import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
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
import { Can } from '../../shell/Can';
import { fetchCommissionPlans } from '../commission/api';
import { fetchPayoutRequests } from '../payouts/api';

export function FinanceDashboard() {
  const { data: payoutsData, isLoading: payoutsLoading, isError: payoutsError } = useQuery({
    queryKey: ['finance-dashboard-payouts'],
    queryFn: () => fetchPayoutRequests({ limit: 5 }),
  });

  const { data: plansData, isLoading: plansLoading } = useQuery({
    queryKey: ['finance-dashboard-plans'],
    queryFn: () => fetchCommissionPlans({ limit: 5 }),
  });

  const payouts = payoutsData?.data ?? [];
  const plans = plansData?.data ?? [];

  const pendingPayoutsCount = payouts.filter(
    (p) => p.status === 'SUBMITTED' || p.status === 'DRAFT',
  ).length;
  const approvedPayoutsCount = payouts.filter((p) => p.status === 'APPROVED').length;
  const activePlansCount = plans.filter((p) => p.status === 'ACTIVE').length;

  return (
    <Container maxWidth="xl" sx={{ py: 4 }} data-testid="finance-dashboard">
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Finance & Commission Management
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Oversee partner payouts, commission accruals, period close, and ledger reconciliation.
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
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

      {/* KPI Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                Payouts Awaiting Approval
              </Typography>
              <Typography variant="h3" fontWeight={700} color="warning.main">
                {payoutsLoading ? <CircularProgress size={28} /> : pendingPayoutsCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Partner payout runs pending dual-control approval
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                Approved Payout Batches
              </Typography>
              <Typography variant="h3" fontWeight={700} color="success.main">
                {payoutsLoading ? <CircularProgress size={28} /> : approvedPayoutsCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Ready for bank disbursement execution
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                Active Commission Plans
              </Typography>
              <Typography variant="h3" fontWeight={700} color="primary.main">
                {plansLoading ? <CircularProgress size={28} /> : activePlansCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Lender commission rule schedules
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        {/* Payout Runs Table */}
        <Grid item xs={12} md={7}>
          <Paper sx={{ p: 3, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" fontWeight={600}>
                Recent Payout Requests
              </Typography>
              <Button size="small" component={RouterLink} to="/payouts">
                View All Payouts
              </Button>
            </Box>
            {payoutsError && <Alert severity="error">Unable to load payout runs.</Alert>}
            {payoutsLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
              </Box>
            ) : payouts.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                No payout runs currently pending.
              </Typography>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Payout ID</TableCell>
                      <TableCell>Connector</TableCell>
                      <TableCell>Amount</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {payouts.map((p) => (
                      <TableRow key={p.id} hover>
                        <TableCell sx={{ fontWeight: 600 }}>{p.id}</TableCell>
                        <TableCell>{p.connectorId}</TableCell>
                        <TableCell>
                          {p.currency} {Number(p.total || 0).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={p.status}
                            size="small"
                            color={p.status === 'APPROVED' ? 'success' : 'warning'}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <Button size="small" component={RouterLink} to="/payouts">
                            Inspect
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Grid>

        {/* Commission Plans */}
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 3, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" fontWeight={600}>
                Active Commission Plans
              </Typography>
              <Button size="small" component={RouterLink} to="/commission">
                View All Plans
              </Button>
            </Box>
            {plansLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
              </Box>
            ) : plans.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                No active plans configured.
              </Typography>
            ) : (
              <Stack spacing={1.5}>
                {plans.map((plan) => (
                  <Card key={plan.id} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Box>
                        <Typography variant="subtitle2" fontWeight={600}>
                          {plan.id}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Lender: {plan.lenderId} · v{plan.lockVersion}
                        </Typography>
                      </Box>
                      <Chip label={plan.status} size="small" color={plan.status === 'ACTIVE' ? 'success' : 'default'} />
                    </Box>
                  </Card>
                ))}
              </Stack>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
}
