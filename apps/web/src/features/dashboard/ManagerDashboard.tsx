import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
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
import { fetchLeads } from '../leads/api';
import { listTasks } from '../tasks/api';
import { useList } from '../admin/api';
import type { Application } from '../applications/ApplicationsPage';
import type { LeadResource } from '../leads/types';
import {
  DashboardDateFilter,
  type DateRangeScope,
  KpiMetricCard,
  PipelineFunnelChart,
  TaskWorkQueue,
  type TaskWorkQueueItem,
} from './components';

export function ManagerDashboard() {
  const [dateScope, setDateScope] = useState<DateRangeScope>('month');

  // Leads query: unassigned intake queue
  const {
    data: leadsData,
    isLoading: leadsLoading,
    isError: leadsError,
  } = useQuery({
    queryKey: ['manager-dashboard-unassigned-leads', dateScope],
    queryFn: () => fetchLeads({ state: 'NEW', limit: 50 }),
  });

  // Team queue tasks
  const {
    data: tasksData,
    isLoading: tasksLoading,
    isError: tasksError,
  } = useQuery({
    queryKey: ['manager-dashboard-team-tasks', dateScope],
    queryFn: () => listTasks({ view: 'QUEUES', limit: 20 }),
  });

  // Active Applications in branch pipeline
  const {
    data: appPages,
    isLoading: appsLoading,
    isError: appsError,
  } = useList<Application>('/v1/applications', {}, 100);

  const unassignedLeads: LeadResource[] = leadsData?.data ?? [];
  const teamTasks = tasksData?.data ?? [];
  const applications: Application[] = appPages?.pages?.flatMap((p) => p.data ?? []) ?? [];

  // Pipeline stage metrics
  const newAppsCount = applications.filter(
    (a) => a.status === 'DRAFT' || a.status === 'SUBMITTED',
  ).length;
  const underReviewCount = applications.filter((a) => a.status === 'UNDER_REVIEW').length;
  const sanctionedCount = applications.filter((a) => a.status === 'SANCTIONED').length;
  const disbursedCount = applications.filter(
    (a) => a.status === 'DISBURSED' || a.status === 'PARTIALLY_DISBURSED',
  ).length;

  // Total sanctioned/disbursed volume
  const disbursedTotal = applications
    .filter((a) => a.status === 'DISBURSED' || a.status === 'SANCTIONED' || a.status === 'PARTIALLY_DISBURSED')
    .reduce((sum, a) => sum + (Number(a.requestedAmount) || 0), 0);

  // Map tasks to TaskWorkQueue items
  const queueItems: TaskWorkQueueItem[] = teamTasks.slice(0, 8).map((t) => ({
    id: t.id,
    title: t.title,
    category: t.type,
    priority: t.priority as TaskWorkQueueItem['priority'],
    dueDate: t.dueAt,
    entityLink: {
      label: t.id.slice(0, 8),
      to: '/tasks',
    },
    actionLabel: 'Assign / Resolve',
  }));

  return (
    <Container maxWidth="xl" sx={{ py: 4 }} data-testid="manager-dashboard">
      {/* Header & Controls */}
      <Box
        sx={{
          mb: 4,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2,
        }}
      >
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Branch &amp; Team Management Hub
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Supervise team task distribution, monitor unassigned lead queues, and oversee branch performance.
          </Typography>
        </Box>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" gap={1}>
          <DashboardDateFilter value={dateScope} onChange={setDateScope} />
          <Can action="lead.assign">
            <Button variant="contained" color="primary" component={RouterLink} to="/leads">
              Lead Allocation
            </Button>
          </Can>
          <Can action="user.manage">
            <Button variant="outlined" component={RouterLink} to="/users">
              Staff Roster
            </Button>
          </Can>
          <Button variant="outlined" component={RouterLink} to="/tasks">
            Queue Tasks
          </Button>
          <Button variant="outlined" component={RouterLink} to="/performance">
            Performance
          </Button>
        </Stack>
      </Box>

      {/* KPI Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Unassigned Inbound Leads"
            value={unassignedLeads.length}
            subtitle="Awaiting allocation to sales officers"
            isLoading={leadsLoading}
            isError={leadsError}
            to="/leads"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Team Queue Backlog"
            value={teamTasks.length}
            subtitle="Active tasks in team work queues"
            isLoading={tasksLoading}
            isError={tasksError}
            to="/tasks"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Branch Originations"
            value={applications.length}
            subtitle="Files actively progressing in pipeline"
            isLoading={appsLoading}
            isError={appsError}
            to="/applications"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Sanctioned Volume"
            value={disbursedTotal > 0 ? disbursedTotal : null}
            format={disbursedTotal > 0 ? 'currency' : 'raw'}
            subtitle={disbursedTotal > 0 ? 'Sanctioned & disbursed total' : 'No sanctions recorded'}
            isLoading={appsLoading}
            isError={appsError}
            to="/sanctions"
          />
        </Grid>
      </Grid>

      {/* Funnel Chart & Work Queue */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} md={7}>
          <PipelineFunnelChart
            title="Branch Origination Pipeline"
            stages={[
              { key: 'leads', label: 'Unassigned Leads', count: unassignedLeads.length, color: '#f59e0b' },
              { key: 'new', label: 'New Applications', count: newAppsCount, color: '#3b82f6' },
              { key: 'review', label: 'Under Review', count: underReviewCount, color: '#8b5cf6' },
              { key: 'sanctioned', label: 'Sanctioned', count: sanctionedCount, color: '#10b981' },
              { key: 'disbursed', label: 'Disbursed', count: disbursedCount, color: '#059669' },
            ]}
          />
        </Grid>
        <Grid item xs={12} md={5}>
          <TaskWorkQueue
            title="Team Queue Backlog"
            items={queueItems}
            isLoading={tasksLoading}
            emptyMessage="No active backlog in team queue."
            viewAllTo="/tasks"
          />
        </Grid>
      </Grid>

      {/* Unassigned Lead Intake Table */}
      <Paper sx={{ p: 3, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={600}>
              Unassigned Lead Intake Queue
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Incoming borrower leads awaiting assignment to field sales officers
            </Typography>
          </Box>
          <Button size="small" component={RouterLink} to="/leads">
            Manage Queue
          </Button>
        </Box>
        {leadsError && <Alert severity="error">Unable to load intake queue.</Alert>}
        {leadsLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : unassignedLeads.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
            All inbound leads have been assigned! 🚀
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Borrower</TableCell>
                  <TableCell>Product</TableCell>
                  <TableCell>Mobile</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {unassignedLeads.slice(0, 10).map((l: LeadResource) => (
                  <TableRow key={l.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{l.fullName}</TableCell>
                    <TableCell>{l.productCategory || 'LOAN'}</TableCell>
                    <TableCell>{l.mobileMasked || '—'}</TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant="contained"
                        component={RouterLink}
                        to={`/leads/${l.id}`}
                      >
                        Assign
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
