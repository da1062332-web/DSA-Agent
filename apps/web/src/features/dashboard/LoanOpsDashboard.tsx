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
import { useList } from '../admin/api';
import type { Application } from '../applications/ApplicationsPage';

export function LoanOpsDashboard() {
  const { data, isLoading, isError } = useList<Application>('/v1/applications', {}, 10);
  const applications = data?.pages.flatMap((p) => p.data) ?? [];

  const inReviewCount = applications.filter(
    (a) => a.status === 'UNDER_REVIEW' || a.status === 'READY_FOR_SUBMISSION' || a.status === 'SUBMITTED',
  ).length;
  const onHoldCount = applications.filter((a) => a.onHold).length;
  const sanctionedCount = applications.filter(
    (a) => a.status === 'SANCTIONED' || a.status === 'DISBURSED',
  ).length;

  return (
    <Container maxWidth="xl" sx={{ py: 4 }} data-testid="loan-ops-dashboard">
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Loan Operations Workbench
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Process origination queues, verify borrower documents, and coordinate lender submissions.
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
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

      {/* KPI Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                Applications In Review
              </Typography>
              <Typography variant="h3" fontWeight={700} color="primary.main">
                {isLoading ? <CircularProgress size={28} /> : inReviewCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Underwriting & ops queues
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                Applications On Hold
              </Typography>
              <Typography variant="h3" fontWeight={700} color="error.main">
                {isLoading ? <CircularProgress size={28} /> : onHoldCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Blocked on queries or customer docs
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                Sanctioned / Approved
              </Typography>
              <Typography variant="h3" fontWeight={700} color="success.main">
                {isLoading ? <CircularProgress size={28} /> : sanctionedCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Ready for disbursement tranche verification
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Main Table */}
      <Paper sx={{ p: 3, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" fontWeight={600}>
            Active Loan Files in Origination Queue
          </Typography>
          <Button size="small" component={RouterLink} to="/applications">
            View All Files
          </Button>
        </Box>
        {isError && <Alert severity="error">Failed to load loan applications.</Alert>}
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : applications.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
            No pending loan applications in your operations queue.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Application ID</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell>Requested Amount</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Hold State</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {applications.map((app) => (
                  <TableRow key={app.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{app.id}</TableCell>
                    <TableCell>{app.productCategory}</TableCell>
                    <TableCell>
                      {app.currency} {Number(app.requestedAmount || 0).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Chip label={app.status} size="small" color="primary" variant="outlined" />
                    </TableCell>
                    <TableCell>
                      {app.onHold ? (
                        <Chip label={`HOLD: ${app.holdReason ?? 'General'}`} size="small" color="error" />
                      ) : (
                        <Chip label="CLEAR" size="small" color="success" variant="outlined" />
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" component={RouterLink} to={`/applications/${app.id}`}>
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Container>
  );
}
