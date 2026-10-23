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
import { Can } from '../../shell/Can';
import { fetchLeads } from '../leads/api';
import { listTasks } from '../tasks/api';
import type { LeadResource } from '../leads/types';
import {
  DashboardDateFilter,
  type DateRangeScope,
  KpiMetricCard,
  PipelineFunnelChart,
  TaskWorkQueue,
  type TaskWorkQueueItem,
} from './components';

export function SalesExecDashboard() {
  const [dateScope, setDateScope] = useState<DateRangeScope>('month');

  const { data: leadsData, isLoading: leadsLoading, isError: leadsError } = useQuery({
    queryKey: ['sales-dashboard-leads', dateScope],
    queryFn: () => fetchLeads({ limit: 20 }),
  });

  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: ['sales-dashboard-tasks', dateScope],
    queryFn: () => listTasks({ view: 'MINE', limit: 5 }),
  });

  const leads: LeadResource[] = leadsData?.data ?? [];
  const rawTasks = tasksData?.data ?? [];

  const newLeadsCount = leads.filter((l: LeadResource) => l.state === 'NEW').length;
  const inProgressCount = leads.filter(
    (l: LeadResource) => l.state === 'IN_PROGRESS' || l.state === 'CONTACT_ATTEMPTED',
  ).length;
  const qualifiedCount = leads.filter((l: LeadResource) => l.state === 'QUALIFIED').length;
  const totalLeads = leads.length;
  const conversionRate = totalLeads > 0 ? (qualifiedCount / totalLeads) * 100 : 0;

  // Map backend tasks to TaskWorkQueueItem contract
  const queueItems: TaskWorkQueueItem[] = rawTasks.map((t) => ({
    id: t.id,
    title: t.title,
    category: t.type,
    priority: (t.priority as TaskWorkQueueItem['priority']) || 'MEDIUM',
    dueDate: t.dueAt,
    isOverdue: new Date(t.dueAt).getTime() < Date.now() && t.status !== 'COMPLETED',
    entityLink: t.linkedId
      ? {
          label: `${t.linkedType || 'REF'}-${t.linkedId.slice(0, 6)}`,
          to: t.linkedType === 'LEAD' ? `/leads/${t.linkedId}` : `/tasks`,
        }
      : undefined,
    actionLabel: 'Details',
    onAction: () => {
      window.location.href = `/tasks`;
    },
  }));

  const funnelStages = [
    { key: 'new', label: 'New Leads', count: newLeadsCount, to: '/leads?filter[state]=NEW', color: '#1976d2' },
    {
      key: 'in_progress',
      label: 'In Follow-up',
      count: inProgressCount,
      to: '/leads?filter[state]=IN_PROGRESS',
      color: '#ed6c02',
    },
    {
      key: 'qualified',
      label: 'Qualified',
      count: qualifiedCount,
      to: '/leads?filter[state]=QUALIFIED',
      color: '#2e7d32',
    },
  ];

  return (
    <Container maxWidth="xl" sx={{ py: 4 }} data-testid="sales-exec-dashboard">
      {/* Header & Controls */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Sales Executive Workspace
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Manage your daily lead pipeline, borrower follow-ups, and conversion targets.
          </Typography>
        </Box>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
          <DashboardDateFilter value={dateScope} onChange={setDateScope} />
          <Can action="lead.create">
            <Button
              variant="contained"
              color="primary"
              component={RouterLink}
              to="/leads/new"
              data-testid="sales-create-lead-btn"
            >
              + Create Lead
            </Button>
          </Can>
          <Button variant="outlined" component={RouterLink} to="/leads">
            All Leads
          </Button>
          <Button variant="outlined" component={RouterLink} to="/tasks">
            All Tasks
          </Button>
        </Stack>
      </Box>

      {/* KPI Overview Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="New Inbound Leads"
            value={newLeadsCount}
            format="number"
            subtitle="Awaiting first contact"
            status="primary"
            isLoading={leadsLoading}
            isError={leadsError}
            to="/leads?filter[state]=NEW"
            dataTestId="kpi-new-leads"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="In Follow-up"
            value={inProgressCount}
            format="number"
            subtitle="Engaged borrowers"
            status="warning"
            isLoading={leadsLoading}
            isError={leadsError}
            to="/leads?filter[state]=IN_PROGRESS"
            dataTestId="kpi-inprogress-leads"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Qualified Leads"
            value={qualifiedCount}
            format="number"
            subtitle="Ready for origination"
            status="success"
            isLoading={leadsLoading}
            isError={leadsError}
            to="/leads?filter[state]=QUALIFIED"
            dataTestId="kpi-qualified-leads"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Conversion Rate"
            value={conversionRate}
            format="percent"
            subtitle="Qualified / Total Leads"
            status="info"
            isLoading={leadsLoading}
            isError={leadsError}
            dataTestId="kpi-conversion-rate"
          />
        </Grid>
      </Grid>

      {/* Main Content Layout */}
      <Grid container spacing={3}>
        {/* Left Column: Funnel & Recent Leads */}
        <Grid item xs={12} md={7}>
          <Stack spacing={3}>
            <PipelineFunnelChart
              title="Lead Pipeline Funnel"
              subtitle="Conversion progression across lead lifecycle stages"
              stages={funnelStages}
              isLoading={leadsLoading}
              dataTestId="sales-pipeline-funnel"
            />

            <Paper sx={{ p: 3, borderRadius: 2, border: '1px solid', borderColor: 'divider', boxShadow: 'none' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" fontWeight={700}>
                  Recent Inbound Leads
                </Typography>
                <Button size="small" component={RouterLink} to="/leads">
                  View All &rarr;
                </Button>
              </Box>
              {leadsError && <Alert severity="error">Unable to load active leads.</Alert>}
              {leadsLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                  <CircularProgress size={32} />
                </Box>
              ) : leads.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                  No active leads assigned yet. Click "+ Create Lead" to get started.
                </Typography>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Borrower</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Product</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>State</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {leads.slice(0, 5).map((l: LeadResource) => (
                        <TableRow key={l.id} hover>
                          <TableCell sx={{ fontWeight: 600 }}>{l.fullName}</TableCell>
                          <TableCell>{l.productCategory || 'LOAN'}</TableCell>
                          <TableCell>
                            <Chip
                              label={l.state}
                              size="small"
                              color={l.state === 'QUALIFIED' ? 'success' : l.state === 'NEW' ? 'primary' : 'default'}
                              sx={{ height: 22, fontSize: 11, fontWeight: 600 }}
                            />
                          </TableCell>
                          <TableCell align="right">
                            <Button size="small" component={RouterLink} to={`/leads/${l.id}`}>
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
            title="Urgent Follow-ups & Tasks"
            subtitle="Prioritized checklist items assigned to you"
            items={queueItems}
            isLoading={tasksLoading}
            viewAllTo="/tasks"
            dataTestId="sales-task-queue"
          />
        </Grid>
      </Grid>
    </Container>
  );
}
