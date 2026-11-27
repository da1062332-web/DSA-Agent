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
import { GuardedRouterLink as RouterLink } from '../../shell/GuardedRouterLink';
import { searchAuditEvents } from '../audit/api';
import {
  DashboardDateFilter,
  type DateRangeScope,
  KpiMetricCard,
} from './components';
import { NotSet } from '../../ui/NotSet';

export function ComplianceDashboard() {
  const [dateScope, setDateScope] = useState<DateRangeScope>('month');

  const { data: auditData, isLoading: auditLoading, isError: auditError } = useQuery({
    queryKey: ['compliance-dashboard-audit', dateScope],
    queryFn: () => searchAuditEvents({ limit: 50 }),
  });

  const auditEvents = auditData?.data ?? [];

  return (
    <Box sx={{ width: '100%', py: 1 }} data-testid="compliance-dashboard">
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
              Compliance Command Center
            </Typography>
            <Chip
              label="Compliance & DPDP"
              color="primary"
              size="small"
              sx={{ fontWeight: 700, fontSize: 11 }}
            />
            <Chip
              label="● Audit Cryptochain Active"
              color="success"
              size="small"
              variant="outlined"
              sx={{ fontWeight: 600, fontSize: 11 }}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Regulatory compliance, DPDP consent tracking, and audit surveillance.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
          <DashboardDateFilter value={dateScope} onChange={setDateScope} />
          <Button variant="contained" color="primary" component={RouterLink} to="/audit" sx={{ fontWeight: 700 }}>
            Audit Trail
          </Button>
          <Button variant="outlined" component={RouterLink} to="/privacy">
            Privacy &amp; Consent
          </Button>
        </Stack>
      </Paper>

      {/* KPI Overview Card */}
      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Audit Events Logged"
            value={auditEvents.length}
            format="number"
            subtitle="Recent immutable log entries"
            status="primary"
            isLoading={auditLoading}
            isError={auditError}
            to="/audit"
            dataTestId="kpi-comp-audit-count"
          />
        </Grid>
      </Grid>

      {/* Full-Width Operational Table: Recent Audit Trail Events */}
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
              Recent Audit Trail Events
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Cryptographically verified event stream across financial and administrative mutations
            </Typography>
          </Box>
          <Button size="small" component={RouterLink} to="/audit" sx={{ fontWeight: 600 }}>
            View All Audit Logs &rarr;
          </Button>
        </Box>
        {auditError && <Alert severity="error">Unable to load audit logs.</Alert>}
        {auditLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress size={32} />
          </Box>
        ) : auditEvents.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
            No recent audit events captured.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Action</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Entity Type</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Actor User</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Timestamp</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {auditEvents.slice(0, 8).map((evt: any) => (
                  <TableRow key={evt.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{evt.action || 'MUTATION'}</TableCell>
                    <TableCell>{evt.entityType || evt.resourceType || 'SYSTEM'}</TableCell>
                    <TableCell>{evt.actorUserId ? `User #${evt.actorUserId.slice(0, 6)}` : 'System Daemon'}</TableCell>
                    <TableCell align="right">
                      <Typography variant="caption" color="text.secondary" fontWeight={500}>
                        {evt.createdAt || evt.occurredAt ? new Date(evt.createdAt || evt.occurredAt).toLocaleTimeString() : <NotSet />}
                      </Typography>
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
