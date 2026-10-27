import { useState } from 'react';
import type { IncidentRecord } from '@dsa/contracts';
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
import { searchAuditEvents } from '../audit/api';
import { listIncidents } from '../security/api';
import {
  DashboardDateFilter,
  type DateRangeScope,
  KpiMetricCard,
  PipelineFunnelChart,
  TaskWorkQueue,
  type TaskWorkQueueItem,
} from './components';
import { NotSet } from '../../ui/NotSet';

export function ComplianceDashboard() {
  const [dateScope, setDateScope] = useState<DateRangeScope>('month');

  const { data: incidentsData, isLoading: incidentsLoading, isError: incidentsError } = useQuery({
    queryKey: ['compliance-dashboard-incidents', dateScope],
    queryFn: () => listIncidents({}),
  });

  const { data: auditData, isLoading: auditLoading, isError: auditError } = useQuery({
    queryKey: ['compliance-dashboard-audit', dateScope],
    queryFn: () => searchAuditEvents({ limit: 50 }),
  });

  const incidents: IncidentRecord[] = incidentsData?.data ?? [];
  const auditEvents = auditData?.data ?? [];

  const openIncidents = incidents.filter(
    (i: IncidentRecord) => i.status === 'OPEN' || i.status === 'INVESTIGATING' || i.status === 'CONTAINED',
  );
  const openIncidentsCount = openIncidents.length;
  const criticalCount = incidents.filter(
    (i: IncidentRecord) => i.severity === 'CRITICAL' || i.severity === 'HIGH',
  ).length;
  const resolvedCount = incidents.filter(
    (i: IncidentRecord) => i.status === 'RESOLVED' || i.status === 'CLOSED',
  ).length;

  const totalIncidents = incidents.length;
  const resolutionRate = totalIncidents > 0 ? (resolvedCount / totalIncidents) * 100 : 100;

  // Stages for security incidents
  const incidentStages = [
    {
      key: 'open',
      label: 'Open / Triage',
      count: incidents.filter((i) => i.status === 'OPEN').length,
      color: '#ef4444',
      to: '/security',
    },
    {
      key: 'investigating',
      label: 'Under Investigation',
      count: incidents.filter((i) => i.status === 'INVESTIGATING').length,
      color: '#f59e0b',
      to: '/security',
    },
    {
      key: 'contained',
      label: 'Contained',
      count: incidents.filter((i) => i.status === 'CONTAINED').length,
      color: '#0288d1',
      to: '/security',
    },
    {
      key: 'resolved',
      label: 'Resolved & Closed',
      count: resolvedCount,
      color: '#10b981',
      to: '/security',
    },
  ];

  // Map open incidents to TaskWorkQueueItem
  const queueItems: TaskWorkQueueItem[] = openIncidents.slice(0, 8).map((inc) => ({
    id: inc.id,
    title: `Security Event: ${inc.type.replace(/_/g, ' ')} #${inc.id.slice(0, 6)}`,
    category: inc.type,
    priority: inc.severity === 'CRITICAL' ? 'URGENT' : inc.severity === 'HIGH' ? 'HIGH' : 'MEDIUM',
    isOverdue: inc.severity === 'CRITICAL',
    slaMinutesRemaining: inc.severity === 'CRITICAL' ? 30 : 180,
    entityLink: {
      label: `INC-${inc.id.slice(0, 6)}`,
      to: `/security`,
    },
    actionLabel: 'Investigate',
  }));

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
            <Typography variant="h5" fontWeight={800} sx={{ letterSpacing: '-0.02em' }}>
              Compliance &amp; Security Command Center
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
            Regulatory compliance, DPDP consent tracking, audit surveillance, and security incident response.
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
          <Button variant="outlined" component={RouterLink} to="/security">
            Security Incidents
          </Button>
        </Stack>
      </Paper>

      {/* KPI Overview Cards */}
      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Open Incidents"
            value={openIncidentsCount}
            format="number"
            subtitle="Under active response"
            status={openIncidentsCount > 0 ? 'error' : 'success'}
            isLoading={incidentsLoading}
            isError={incidentsError}
            to="/security"
            dataTestId="kpi-comp-open-incidents"
          />
        </Grid>
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
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="High / Critical Severity"
            value={criticalCount}
            format="number"
            subtitle="Urgent containment priority"
            status={criticalCount > 0 ? 'warning' : 'success'}
            isLoading={incidentsLoading}
            isError={incidentsError}
            to="/security"
            dataTestId="kpi-comp-critical"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Resolution Rate"
            value={resolutionRate}
            format="percent"
            subtitle="Resolved / Total Reported"
            status="info"
            isLoading={incidentsLoading}
            isError={incidentsError}
            dataTestId="kpi-comp-resolution-rate"
          />
        </Grid>
      </Grid>

      {/* Middle Row: Balanced Funnel & Work Queue */}
      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
        <Grid item xs={12} lg={7}>
          <PipelineFunnelChart
            title="Security Incident Lifecycle"
            subtitle="Incident resolution pipeline from reporting to closure"
            stages={incidentStages}
            isLoading={incidentsLoading}
            dataTestId="compliance-incident-funnel"
          />
        </Grid>
        <Grid item xs={12} lg={5}>
          <TaskWorkQueue
            title="Compliance Action Items"
            subtitle="Open incidents and regulatory checks needing containment"
            items={queueItems}
            isLoading={incidentsLoading}
            viewAllTo="/security"
            dataTestId="compliance-work-queue"
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
