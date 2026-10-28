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
import { NotSet } from '../../ui/NotSet';

export function SalesExecDashboard() {
  const [dateScope, setDateScope] = useState<DateRangeScope>('month');

  const { data: leadsData, isLoading: leadsLoading, isError: leadsError } = useQuery({
    queryKey: ['sales-dashboard-leads', dateScope],
    queryFn: () => fetchLeads({ limit: 50 }),
  });

  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: ['sales-dashboard-tasks', dateScope],
    queryFn: () => listTasks({ view: 'MINE', limit: 10 }),
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
  }));

  const funnelStages = [
    { key: 'new', label: 'New Leads', count: newLeadsCount, to: '/leads?filter[state]=NEW', color: '#215988' },
    {
      key: 'in_progress',
      label: 'In Follow-up',
      count: inProgressCount,
      to: '/leads?filter[state]=IN_PROGRESS',
      color: '#f59e0b',
    },
    {
      key: 'qualified',
      label: 'Qualified',
      count: qualifiedCount,
      to: '/leads?filter[state]=QUALIFIED',
      color: '#16A34A',
    },
  ];

  return (
    <Box sx={{ width: '100%', py: 1 }} data-testid="sales-exec-dashboard">
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
              Sales Executive Workspace
            </Typography>
            <Chip
              label="Field Sales"
              color="primary"
              size="small"
              sx={{ fontWeight: 700, fontSize: 11 }}
            />
            <Chip
              label="● Pipeline Active"
              color="success"
              size="small"
              variant="outlined"
              sx={{ fontWeight: 600, fontSize: 11 }}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Manage your daily lead pipeline, borrower follow-ups, and conversion targets.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
          <DashboardDateFilter value={dateScope} onChange={setDateScope} />
          <Can action="lead.create">
            <Button
              variant="contained"
              color="primary"
              component={RouterLink}
              to="/leads/new"
              data-testid="sales-create-lead-btn"
              sx={{ fontWeight: 700 }}
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
      </Paper>

      {/* KPI Overview Cards */}
      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
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

      {/* Middle Row: Balanced Funnel & Work Queue */}
      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
        <Grid item xs={12} lg={7}>
          <PipelineFunnelChart
            variant="columns"
            title="Lead Pipeline Funnel"
            subtitle="Conversion progression across lead lifecycle stages"
            stages={funnelStages}
            isLoading={leadsLoading}
            dataTestId="sales-pipeline-funnel"
          />
        </Grid>
        <Grid item xs={12} lg={5}>
          <TaskWorkQueue
            title="Urgent Follow-ups &amp; Tasks"
            subtitle="Prioritized checklist items assigned to you"
            items={queueItems}
            isLoading={tasksLoading}
            viewAllTo="/tasks"
            dataTestId="sales-task-queue"
          />
        </Grid>
      </Grid>

      {/* Full-Width Operational Table: Recent Inbound Leads */}
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
              Recent Inbound Leads
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Active loan inquiries assigned to your queue
            </Typography>
          </Box>
          <Button size="small" component={RouterLink} to="/leads" sx={{ fontWeight: 600 }}>
            View All Leads &rarr;
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
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Borrower</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Product</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Mobile</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>State</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {leads.slice(0, 8).map((l: LeadResource) => (
                  <TableRow key={l.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{l.fullName}</TableCell>
                    <TableCell>{l.productCategory || 'LOAN'}</TableCell>
                    <TableCell>{l.mobileMasked || <NotSet />}</TableCell>
                    <TableCell>
                      <Chip
                        label={l.state}
                        size="small"
                        color={l.state === 'QUALIFIED' ? 'success' : l.state === 'NEW' ? 'primary' : 'default'}
                        sx={{ height: 22, fontSize: 11, fontWeight: 700 }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant="outlined"
                        component={RouterLink}
                        to={`/leads/${l.id}`}
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
