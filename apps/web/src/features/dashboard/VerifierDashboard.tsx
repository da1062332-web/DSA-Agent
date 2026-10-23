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
import { fetchVerifications } from '../verifications/api';
import type { VerificationRequest } from '../verifications/types';
import {
  DashboardDateFilter,
  type DateRangeScope,
  KpiMetricCard,
  PipelineFunnelChart,
  TaskWorkQueue,
  type TaskWorkQueueItem,
} from './components';

export function VerifierDashboard() {
  const [dateScope, setDateScope] = useState<DateRangeScope>('month');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['verifier-dashboard-items', dateScope],
    queryFn: () => fetchVerifications({ limit: 25 }),
  });

  const items: VerificationRequest[] = data?.data ?? [];

  const pendingCount = items.filter(
    (v: VerificationRequest) =>
      v.status === 'INITIATED' || v.status === 'ASSIGNED' || v.status === 'IN_PROGRESS',
  ).length;
  const verifiedCount = items.filter((v: VerificationRequest) => v.status === 'VERIFIED').length;
  const rejectedCount = items.filter((v: VerificationRequest) => v.status === 'REJECTED').length;
  const completedTotal = verifiedCount + rejectedCount;
  const passRate = completedTotal > 0 ? (verifiedCount / completedTotal) * 100 : 100;

  // Funnel breakdown of verification pipeline
  const verificationStages = [
    { key: 'pending', label: 'Pending Review', count: pendingCount, color: '#ed6c02', to: '/verifications' },
    { key: 'verified', label: 'Verified & Attested', count: verifiedCount, color: '#2e7d32', to: '/verifications' },
    { key: 'rejected', label: 'Rejected / Discrepancy', count: rejectedCount, color: '#d32f2f', to: '/verifications' },
  ];

  // Map verification requests to TaskWorkQueueItem contract
  const queueItems: TaskWorkQueueItem[] = items
    .filter((v) => v.status !== 'VERIFIED' && v.status !== 'REJECTED')
    .slice(0, 5)
    .map((v) => ({
      id: v.id,
      title: `${v.verificationType || 'Verification'}: Case #${v.id.slice(0, 6)}`,
      category: v.verificationType,
      priority: v.priority as TaskWorkQueueItem['priority'],
      slaMinutesRemaining: 90,
      entityLink: {
        label: `APP-${v.applicationId ? v.applicationId.slice(0, 6) : v.id.slice(0, 6)}`,
        to: `/verifications/workbench?caseId=${v.id}`,
      },
      actionLabel: 'Workbench',
      onAction: () => {
        window.location.href = `/verifications/workbench?caseId=${v.id}`;
      },
    }));

  return (
    <Container maxWidth="xl" sx={{ py: 4 }} data-testid="verifier-dashboard">
      {/* Header & Controls */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Document Verification Workbench
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Perform KYC checks, document attestations, field verification, and fraud assessment.
          </Typography>
        </Box>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
          <DashboardDateFilter value={dateScope} onChange={setDateScope} />
          <Button variant="contained" color="primary" component={RouterLink} to="/verifications">
            Verification Queue
          </Button>
          <Button variant="outlined" component={RouterLink} to="/verifications/workbench">
            Verification Workbench
          </Button>
        </Stack>
      </Box>

      {/* KPI Overview Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Pending Verification"
            value={pendingCount}
            format="number"
            subtitle="Awaiting review & attestation"
            status="warning"
            isLoading={isLoading}
            isError={isError}
            to="/verifications"
            dataTestId="kpi-verifier-pending"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Verified & Completed"
            value={verifiedCount}
            format="number"
            subtitle="Successfully attested"
            status="success"
            isLoading={isLoading}
            isError={isError}
            to="/verifications"
            dataTestId="kpi-verifier-verified"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Rejected / Discrepancy"
            value={rejectedCount}
            format="number"
            subtitle="Flagged fraud or mismatch"
            status="error"
            isLoading={isLoading}
            isError={isError}
            to="/verifications"
            dataTestId="kpi-verifier-rejected"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Attestation Pass Rate"
            value={passRate}
            format="percent"
            subtitle="Verified / Total Completed"
            status="info"
            isLoading={isLoading}
            isError={isError}
            dataTestId="kpi-verifier-passrate"
          />
        </Grid>
      </Grid>

      {/* Main Content Layout */}
      <Grid container spacing={3}>
        {/* Left Column: Funnel & Active Cases */}
        <Grid item xs={12} md={7}>
          <Stack spacing={3}>
            <PipelineFunnelChart
              title="Verification Case Throughput"
              subtitle="Verification status distribution across incoming borrower checks"
              stages={verificationStages}
              isLoading={isLoading}
              dataTestId="verifier-throughput-funnel"
            />

            <Paper sx={{ p: 3, borderRadius: 2, border: '1px solid', borderColor: 'divider', boxShadow: 'none' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" fontWeight={700}>
                  Active Verification Cases
                </Typography>
                <Button size="small" component={RouterLink} to="/verifications">
                  View All &rarr;
                </Button>
              </Box>
              {isError && <Alert severity="error">Unable to load verification records.</Alert>}
              {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                  <CircularProgress size={32} />
                </Box>
              ) : items.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                  No active verification cases assigned right now.
                </Typography>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Case ID</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Check Type</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {items.slice(0, 5).map((v: VerificationRequest) => (
                        <TableRow key={v.id} hover>
                          <TableCell sx={{ fontWeight: 600 }}>#{v.id.slice(0, 8)}</TableCell>
                          <TableCell>{v.verificationType}</TableCell>
                          <TableCell>
                            <Chip
                              label={v.status}
                              size="small"
                              color={v.status === 'VERIFIED' ? 'success' : v.status === 'REJECTED' ? 'error' : 'warning'}
                              sx={{ height: 22, fontSize: 11, fontWeight: 600 }}
                            />
                          </TableCell>
                          <TableCell align="right">
                            <Button size="small" variant="outlined" component={RouterLink} to={`/verifications/workbench?caseId=${v.id}`}>
                              Workbench
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
            title="Priority Verification Queue"
            subtitle="Cases pending immediate underwriter attestation"
            items={queueItems}
            isLoading={isLoading}
            viewAllTo="/verifications"
            dataTestId="verifier-work-queue"
          />
        </Grid>
      </Grid>
    </Container>
  );
}
