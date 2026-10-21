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

export function SalesExecDashboard() {
  const { data: leadsData, isLoading: leadsLoading, isError: leadsError } = useQuery({
    queryKey: ['sales-dashboard-leads'],
    queryFn: () => fetchLeads({ limit: 5 }),
  });

  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: ['sales-dashboard-tasks'],
    queryFn: () => listTasks({ view: 'MINE', limit: 5 }),
  });

  const leads: LeadResource[] = leadsData?.data ?? [];
  const tasks = tasksData?.data ?? [];

  const newLeadsCount = leads.filter((l: LeadResource) => l.state === 'NEW').length;
  const inProgressCount = leads.filter((l: LeadResource) => l.state === 'IN_PROGRESS' || l.state === 'CONTACT_ATTEMPTED').length;
  const qualifiedCount = leads.filter((l: LeadResource) => l.state === 'QUALIFIED').length;

  return (
    <Container maxWidth="xl" sx={{ py: 4 }} data-testid="sales-exec-dashboard">
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Sales Executive Workspace
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Manage your daily lead pipeline, borrower follow-ups, and conversion targets.
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
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

      {/* KPI Overview */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                New Inbound Leads
              </Typography>
              <Typography variant="h3" fontWeight={700} color="primary.main">
                {leadsLoading ? <CircularProgress size={28} /> : newLeadsCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Awaiting first contact attempt
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                In Follow-up / Contacted
              </Typography>
              <Typography variant="h3" fontWeight={700} color="warning.main">
                {leadsLoading ? <CircularProgress size={28} /> : inProgressCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Borrowers currently being engaged
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                Qualified Leads
              </Typography>
              <Typography variant="h3" fontWeight={700} color="success.main">
                {leadsLoading ? <CircularProgress size={28} /> : qualifiedCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Ready for loan application conversion
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        {/* Recent Leads Widget */}
        <Grid item xs={12} md={7}>
          <Paper sx={{ p: 3, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" fontWeight={600}>
                Recent Leads
              </Typography>
              <Button size="small" component={RouterLink} to="/leads">
                View All
              </Button>
            </Box>
            {leadsError && <Alert severity="error">Unable to load active leads.</Alert>}
            {leadsLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
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
                      <TableCell>Borrower</TableCell>
                      <TableCell>Product</TableCell>
                      <TableCell>State</TableCell>
                      <TableCell align="right">Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {leads.map((l: LeadResource) => (
                      <TableRow key={l.id} hover>
                        <TableCell sx={{ fontWeight: 600 }}>
                          {l.fullName}
                        </TableCell>
                        <TableCell>{l.productCategory || 'LOAN'}</TableCell>
                        <TableCell>
                          <Chip label={l.state} size="small" color={l.state === 'QUALIFIED' ? 'success' : 'default'} />
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
        </Grid>

        {/* Follow-up Tasks Widget */}
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 3, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" fontWeight={600}>
                Urgent Follow-ups & Tasks
              </Typography>
              <Button size="small" component={RouterLink} to="/tasks">
                View All
              </Button>
            </Box>
            {tasksLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
              </Box>
            ) : tasks.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                No urgent tasks pending today! 🎉
              </Typography>
            ) : (
              <Stack spacing={1.5}>
                {tasks.map((t) => (
                  <Card key={t.id} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <Box>
                        <Typography variant="subtitle2" fontWeight={600}>
                          {t.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Status: {t.status} · Priority: {t.priority}
                        </Typography>
                      </Box>
                      <Button size="small" component={RouterLink} to="/tasks">
                        Details
                      </Button>
                    </Box>
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
