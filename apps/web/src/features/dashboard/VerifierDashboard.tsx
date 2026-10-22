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
import { fetchVerifications } from '../verifications/api';
import { ApplicationName } from '../../shell/display';

import type { VerificationRequest } from '../verifications/types';

export function VerifierDashboard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['verifier-dashboard-items'],
    queryFn: () => fetchVerifications({ limit: 10 }),
  });

  const items: VerificationRequest[] = data?.data ?? [];

  const pendingCount = items.filter(
    (v: VerificationRequest) => v.status === 'INITIATED' || v.status === 'ASSIGNED' || v.status === 'IN_PROGRESS',
  ).length;
  const verifiedCount = items.filter((v: VerificationRequest) => v.status === 'VERIFIED').length;
  const rejectedCount = items.filter((v: VerificationRequest) => v.status === 'REJECTED').length;

  return (
    <Container maxWidth="xl" sx={{ py: 4 }} data-testid="verifier-dashboard">
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Document Verification Workbench
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Perform KYC checks, document attestations, field verification, and fraud assessment.
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button variant="contained" color="primary" component={RouterLink} to="/verifications">
            Verification Queue
          </Button>
          <Button variant="outlined" component={RouterLink} to="/verifications/workbench">
            Verification Workbench
          </Button>
        </Stack>
      </Box>

      {/* KPI Overview */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                Pending Verification Requests
              </Typography>
              <Typography variant="h3" fontWeight={700} color="warning.main">
                {isLoading ? <CircularProgress size={28} /> : pendingCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Awaiting verifier review & attestation
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                Verified & Completed
              </Typography>
              <Typography variant="h3" fontWeight={700} color="success.main">
                {isLoading ? <CircularProgress size={28} /> : verifiedCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Successfully attested documents
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                Rejected / Discrepancy
              </Typography>
              <Typography variant="h3" fontWeight={700} color="error.main">
                {isLoading ? <CircularProgress size={28} /> : rejectedCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Discrepant or fraudulent items
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Verification Queue Table */}
      <Paper sx={{ p: 3, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" fontWeight={600}>
            Pending Verification Queue
          </Typography>
          <Button size="small" component={RouterLink} to="/verifications">
            View All Verifications
          </Button>
        </Box>
        {isError && <Alert severity="error">Unable to load verification items.</Alert>}
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : items.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
            No verification tasks currently in queue.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Request ID</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Application</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Priority</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((v: VerificationRequest) => (
                  <TableRow key={v.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{v.id}</TableCell>
                    <TableCell>{v.verificationType}</TableCell>
                    <TableCell>
                      <ApplicationName id={v.applicationId} linkToApp />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={v.status}
                        size="small"
                        color={v.status === 'VERIFIED' ? 'success' : v.status === 'REJECTED' ? 'error' : 'warning'}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip label={v.priority || 'MEDIUM'} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" component={RouterLink} to={`/verifications/${v.id}`}>
                        Attest
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
