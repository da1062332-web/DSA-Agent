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
import { useList } from '../admin/api';
import { fetchLeads } from '../leads/api';
import type { LeadResource } from '../leads/types';
import type { Application } from '../applications/ApplicationsPage';

export function RMDashboard() {
  const { data: leadsData, isLoading: leadsLoading, isError: leadsError } = useQuery({
    queryKey: ['rm-dashboard-qualified-leads'],
    queryFn: () => fetchLeads({ state: 'QUALIFIED', limit: 5 }),
  });

  const { data: appsData, isLoading: appsLoading } = useList<Application>('/v1/applications', {}, 5);

  const leads: LeadResource[] = leadsData?.data ?? [];
  const applications = appsData?.pages.flatMap((p) => p.data) ?? [];

  return (
    <Container maxWidth="xl" sx={{ py: 4 }} data-testid="rm-dashboard">
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Relationship Manager Portal
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Nurture borrower relationships, convert qualified leads into origination files, and track partner connectors.
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button variant="contained" color="primary" component={RouterLink} to="/applications">
            + New Loan File
          </Button>
          <Button variant="outlined" component={RouterLink} to="/leads">
            Qualified Leads
          </Button>
          <Button variant="outlined" component={RouterLink} to="/connectors">
            Connectors
          </Button>
        </Stack>
      </Box>

      {/* KPI Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                Qualified Leads Ready to Convert
              </Typography>
              <Typography variant="h3" fontWeight={700} color="primary.main">
                {leadsLoading ? <CircularProgress size={28} /> : leads.length}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Awaiting application file initiation
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                Applications in Origination
              </Typography>
              <Typography variant="h3" fontWeight={700} color="secondary.main">
                {appsLoading ? <CircularProgress size={28} /> : applications.length}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Active borrower files in pipeline
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                Pipeline Health
              </Typography>
              <Typography variant="h3" fontWeight={700} color="success.main">
                100%
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Customer verification SLA adherence
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        {/* Qualified Leads Widget */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" fontWeight={600}>
                Qualified Leads (Ready to Convert)
              </Typography>
              <Button size="small" component={RouterLink} to="/leads">
                View All
              </Button>
            </Box>
            {leadsError && <Alert severity="error">Unable to load qualified leads.</Alert>}
            {leadsLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
              </Box>
            ) : leads.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                No qualified leads awaiting conversion right now.
              </Typography>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Borrower</TableCell>
                      <TableCell>Product</TableCell>
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
                        <TableCell align="right">
                          <Button size="small" variant="outlined" component={RouterLink} to={`/leads/${l.id}`}>
                            Convert
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

        {/* Applications Pipeline Widget */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" fontWeight={600}>
                My Origination Applications
              </Typography>
              <Button size="small" component={RouterLink} to="/applications">
                View All
              </Button>
            </Box>
            {appsLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
              </Box>
            ) : applications.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                No active applications in flight.
              </Typography>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>File ID</TableCell>
                      <TableCell>Amount</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {applications.map((app) => (
                      <TableRow key={app.id} hover>
                        <TableCell sx={{ fontWeight: 600 }}>
                          <RouterLink to={`/applications/${app.id}`}>{app.id}</RouterLink>
                        </TableCell>
                        <TableCell>
                          {app.currency} {Number(app.requestedAmount || 0).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Chip label={app.status} size="small" color="primary" variant="outlined" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
}
