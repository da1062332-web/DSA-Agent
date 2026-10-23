import { useState } from 'react';
import type { IncidentRecord } from '@dsa/contracts';
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

export function ComplianceDashboard() {
  const [dateScope, setDateScope] = useState<DateRangeScope>('month');

  const { data: incidentsData, isLoading: incidentsLoading, isError: incidentsError } = useQuery({
    queryKey: ['compliance-dashboard-incidents', dateScope],
    queryFn: () => listIncidents({}),
  });

  const { data: auditData, isLoading: auditLoading, isError: auditError } = useQuery({
    queryKey: ['compliance-dashboard-audit', dateScope],
    queryFn: () => searchAuditEvents({ limit: 15 }),
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
      color: '#d32f2f',
      to: '/security',
    },
    {
      key: 'investigating',
      label: 'Under Investigation',
      count: incidents.filter((i) => i.status === 'INVESTIGATING').length,
      color: '#ed6c02',
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
      color: '#2e7d32',
      to: '/security',
    },
  ];

  // Map open incidents to TaskWorkQueueItem
  const queueItems: TaskWorkQueueItem[] = openIncidents.slice(0, 5).map((inc) => ({
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
    onAction: () => {
      window.location.href = `/security`;
    },
  }));

  return (
    <Container maxWidth="xl" sx={{ py: 4 }} data-testid="compliance-dashboard">
      {/* Header & Controls */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Compliance & Security Command Center
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Regulatory compliance, DPDP consent tracking, audit surveillance, and security incident response.
          </Typography>
        </Box>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
          <DashboardDateFilter value={dateScope} onChange={setDateScope} />
          <Button variant="contained" color="primary" component={RouterLink} to="/audit">
            Audit Trail
          </Button>
          <Button variant="outlined" component={RouterLink} to="/privacy">
            Privacy & Consent
          </Button>
          <Button variant="outlined" component={RouterLink} to="/security">
            Security Incidents
          </Button>
        </Stack>
      </Box>

      {/* KPI Overview Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
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

      {/* Main Content Layout */}
      <Grid container spacing={3}>
        {/* Left Column: Funnel & Recent Audit Trail */}
        <Grid item xs={12} md={7}>
          <Stack spacing={3}>
            <PipelineFunnelChart
              title="Security Incident Lifecycle"
              subtitle="Incident resolution pipeline from reporting to closure"
              stages={incidentStages}
              isLoading={incidentsLoading}
              dataTestId="compliance-incident-funnel"
            />

            <Paper sx={{ p: 3, borderRadius: 2, border: '1px solid', borderColor: 'divider', boxShadow: 'none' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" fontWeight={700}>
                  Recent Audit Trail Events
                </Typography>
                <Button size="small" component={RouterLink} to="/audit">
                  View All &rarr;
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
                        <TableCell sx={{ fontWeight: 600 }}>Action</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Entity</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Actor</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Timestamp</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {auditEvents.slice(0, 5).map((evt: any) => (
                        <TableRow key={evt.id} hover>
                          <TableCell sx={{ fontWeight: 600 }}>{evt.action || 'MUTATION'}</TableCell>
                          <TableCell>{evt.entityType || 'SYSTEM'}</TableCell>
                          <TableCell>{evt.actorUserId ? `User #${evt.actorUserId.slice(0, 6)}` : 'System'}</TableCell>
                          <TableCell align="right">
                            <Typography variant="caption" color="text.secondary">
                              {evt.createdAt ? new Date(evt.createdAt).toLocaleTimeString() : '—'}
                            </Typography>
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
            title="Compliance Action Items"
            subtitle="Open incidents and regulatory checks needing containment"
            items={queueItems}
            isLoading={incidentsLoading}
            viewAllTo="/security"
            dataTestId="compliance-work-queue"
          />
        </Grid>
      </Grid>
    </Container>
  );
}
