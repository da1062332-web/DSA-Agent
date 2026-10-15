import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  FormControl,
  Grid,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { listCustomers } from './api';
import type { CustomerResource } from './types';

export function CustomerListPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [partyTypeFilter, setPartyTypeFilter] = useState<'ALL' | 'INDIVIDUAL' | 'ENTITY'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'MERGED'>('ALL');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['customers', partyTypeFilter, statusFilter],
    queryFn: () =>
      listCustomers({
        partyType: partyTypeFilter === 'ALL' ? undefined : partyTypeFilter,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        limit: 100,
      }),
  });

  const customers: CustomerResource[] = data?.data || [];

  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      const matchSearch =
        !searchTerm ||
        c.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.primaryMobileMasked && c.primaryMobileMasked.includes(searchTerm)) ||
        (c.primaryEmailMasked && c.primaryEmailMasked.toLowerCase().includes(searchTerm.toLowerCase()));

      return matchSearch;
    });
  }, [customers, searchTerm]);

  const stats = useMemo(() => {
    const total = customers.length;
    const individuals = customers.filter((c) => c.partyType === 'INDIVIDUAL').length;
    const entities = customers.filter((c) => c.partyType === 'ENTITY').length;
    const active = customers.filter((c) => c.status === 'ACTIVE').length;
    return { total, individuals, entities, active };
  }, [customers]);

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header */}
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2} sx={{ mb: 4 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Customers
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Borrower party profiles, entity records, and DPDP consented parties (MOD-CUST).
          </Typography>
        </Box>
      </Stack>

      {/* Stats Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ height: '100%', borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                Total Profiles
              </Typography>
              <Typography variant="h4" fontWeight={700} color="primary.main">
                {stats.total}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Registered borrower parties
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ height: '100%', borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                Individuals
              </Typography>
              <Typography variant="h4" fontWeight={700}>
                {stats.individuals}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Retail borrowers
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ height: '100%', borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                Entities
              </Typography>
              <Typography variant="h4" fontWeight={700}>
                {stats.entities}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Commercial / corporate borrowers
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ height: '100%', borderRadius: 2, boxShadow: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" fontWeight={600}>
                Active Status
              </Typography>
              <Typography variant="h4" fontWeight={700} color="success.main">
                {stats.active}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Verified party profiles
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filter and Search Bar */}
      <Paper sx={{ p: 2, mb: 3, borderRadius: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search by customer name, ID, phone, or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              data-testid="customer-search-input"
            />
          </Grid>
          <Grid item xs={6} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Party Type</InputLabel>
              <Select
                value={partyTypeFilter}
                label="Party Type"
                onChange={(e) => setPartyTypeFilter(e.target.value as any)}
              >
                <MenuItem value="ALL">All Types</MenuItem>
                <MenuItem value="INDIVIDUAL">Individual</MenuItem>
                <MenuItem value="ENTITY">Entity</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={6} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select
                value={statusFilter}
                label="Status"
                onChange={(e) => setStatusFilter(e.target.value as any)}
              >
                <MenuItem value="ALL">All Statuses</MenuItem>
                <MenuItem value="ACTIVE">Active</MenuItem>
                <MenuItem value="MERGED">Merged</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </Paper>

      {/* Customer List Table */}
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : isError ? (
        <Paper sx={{ p: 4, textAlign: 'center', color: 'error.main' }}>
          <Typography variant="h6" gutterBottom>
            Error loading customers
          </Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {(error as Error)?.message || 'Failed to fetch customer list from API.'}
          </Typography>
          <Button variant="outlined" onClick={() => refetch()}>
            Try Again
          </Button>
        </Paper>
      ) : filteredCustomers.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: 'center', borderRadius: 2 }}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No customers found
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {searchTerm
              ? 'Try modifying your search query or filters.'
              : 'Customers will be created automatically when qualified leads are converted.'}
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} sx={{ borderRadius: 2, boxShadow: 1 }}>
          <Table>
            <TableHead sx={{ bgcolor: 'grey.50' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Customer Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Party Type</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Contact Info</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Home Branch</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredCustomers.map((customer) => (
                <TableRow key={customer.id} hover>
                  <TableCell>
                    <Typography
                      component={RouterLink}
                      to={`/customers/${customer.id}`}
                      variant="body2"
                      fontWeight={600}
                      color="primary.main"
                      sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                    >
                      {customer.fullName}
                    </Typography>
                    <Typography variant="caption" display="block" color="text.secondary">
                      {customer.id}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={customer.partyType}
                      variant="outlined"
                      color={customer.partyType === 'INDIVIDUAL' ? 'primary' : 'secondary'}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{customer.primaryMobileMasked || '—'}</Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {customer.primaryEmailMasked || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{customer.homeBranchId || '—'}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={customer.status}
                      color={customer.status === 'ACTIVE' ? 'success' : 'default'}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(customer.createdAt).toLocaleDateString()}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button
                        size="small"
                        variant="outlined"
                        component={RouterLink}
                        to={`/customers/${customer.id}`}
                      >
                        Profile
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        color="secondary"
                        component={RouterLink}
                        to={`/customers/${customer.id}/consents`}
                      >
                        Consents
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Container>
  );
}
