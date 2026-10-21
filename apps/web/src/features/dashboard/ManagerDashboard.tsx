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
import { fetchLeads } from '../leads/api';
import { listTasks } from '../tasks/api';

import type { LeadResource } from '../leads/types';

export function ManagerDashboard() {
  const { data: leadsData, isLoading: leadsLoading, isError: leadsError } = useQuery({
    queryKey: ['manager-dashboard-unassigned-leads'],
    queryFn: () => fetchLeads({ state: 'NEW', limit: 5 }),
  });

  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: ['manager-dashboard-team-tasks'],
    queryFn: () => listTasks({ view: 'QUEUES', limit: 5 }),
  });

  const unassignedLeads: LeadResource[] = leadsData?.data ?? [];
  const teamTasks = tasksData?.data ?? [];

  return (
    <Container maxWidth="xl" sx={{ py: 4 }} data-testid="manager-dashboard">
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Branch & Team Management Hub
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Supervise team task distribution, monitor unassigned lead queues, and oversee branch performance.
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
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
        </Stack>
      </Box>

      {/* KPI Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                Unassigned Inbound Leads
              </Typography>
              <Typography variant="h3" fontWeight={700} color="error.main">
                {leadsLoading ? <CircularProgress size={28} /> : unassignedLeads.length}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Awaiting distribution to sales officers
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                Team Queue Tasks Pending
              </Typography>
              <Typography variant="h3" fontWeight={700} color="warning.main">
                {tasksLoading ? <CircularProgress size={28} /> : teamTasks.length}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Work items assigned to your teams
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                Operational SLA
              </Typography>
              <Typography variant="h3" fontWeight={700} color="success.main">
                98.4%
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Within turnaround time target
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        {/* Unassigned Leads Table */}
        <Grid item xs={12} md={7}>
          <Paper sx={{ p: 3, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" fontWeight={600}>
                Unassigned Lead Intake Queue
              </Typography>
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
                    {unassignedLeads.map((l: LeadResource) => (
                      <TableRow key={l.id} hover>
                        <TableCell sx={{ fontWeight: 600 }}>
                          {l.fullName}
                        </TableCell>
                        <TableCell>{l.productCategory || 'LOAN'}</TableCell>
                        <TableCell>{l.mobileMasked || '—'}</TableCell>
                        <TableCell align="right">
                          <Button size="small" variant="contained" component={RouterLink} to={`/leads/${l.id}`}>
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
        </Grid>

        {/* Team Tasks */}
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 3, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" fontWeight={600}>
                Team Work Queue
              </Typography>
              <Button size="small" component={RouterLink} to="/tasks">
                View All
              </Button>
            </Box>
            {tasksLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
              </Box>
            ) : teamTasks.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                No active backlog in queue.
              </Typography>
            ) : (
              <Stack spacing={1.5}>
                {teamTasks.map((t) => (
                  <Card key={t.id} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                    <Typography variant="subtitle2" fontWeight={600}>
                      {t.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Queue: {t.ownerQueueId || 'Team Queue'} · Priority: {t.priority}
                    </Typography>
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
