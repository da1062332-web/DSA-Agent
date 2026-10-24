import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Button,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { listCustomers } from './api';
import type { CustomerResource } from './types';
import { BranchName } from '../../shell/display';
import {
  PageHeader,
  StatCard,
  StatCardGrid,
  FilterToolbar,
  DataTable,
  StatusBadge,
  type ColumnDef,
} from '../../ui';

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

  const columns: ColumnDef<CustomerResource>[] = [
    {
      id: 'fullName',
      header: 'Customer Name',
      accessor: (c) => (
        <Box>
          <Typography
            component={RouterLink}
            to={`/customers/${c.id}`}
            variant="body2"
            fontWeight={600}
            color="info.main"
            sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
          >
            {c.fullName}
          </Typography>
          <Typography variant="caption" display="block" color="text.secondary" fontFamily="monospace">
            {c.id}
          </Typography>
        </Box>
      ),
    },
    {
      id: 'partyType',
      header: 'Party Type',
      accessor: (c) => (
        <StatusBadge
          status={c.partyType === 'INDIVIDUAL' ? 'info' : 'warning'}
          label={c.partyType}
          variant="outlined"
          dot={false}
        />
      ),
    },
    {
      id: 'contact',
      header: 'Contact Info',
      accessor: (c) => (
        <Box>
          <Typography variant="body2">{c.primaryMobileMasked || '—'}</Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            {c.primaryEmailMasked || '—'}
          </Typography>
        </Box>
      ),
    },
    {
      id: 'homeBranchId',
      header: 'Home Branch',
      accessor: (c) => <BranchName id={c.homeBranchId} fallback="—" />,
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (c) => <StatusBadge status={c.status} />,
    },
    {
      id: 'createdAt',
      header: 'Created',
      accessor: (c) => (
        <Typography variant="caption" color="text.secondary">
          {new Date(c.createdAt).toLocaleDateString()}
        </Typography>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      accessor: (c) => (
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            component={RouterLink}
            to={`/customers/${c.id}`}
            sx={{ borderRadius: 1.5, textTransform: 'none', fontWeight: 600, fontSize: 12 }}
          >
            Profile
          </Button>
          <Button
            size="small"
            variant="contained"
            color="secondary"
            component={RouterLink}
            to={`/customers/${c.id}/consents`}
            sx={{ borderRadius: 1.5, textTransform: 'none', fontWeight: 700, fontSize: 12 }}
          >
            Consents
          </Button>
        </Stack>
      ),
    },
  ];

  return (
    <Container maxWidth={false} disableGutters>
      <PageHeader
        title="Customers"
        subtitle="Borrower party profiles, entity records, and DPDP consented parties."
      />

      <StatCardGrid>
        <StatCard
          title="Total Profiles"
          value={stats.total}
          subtitle="Registered borrower parties"
          status="primary"
        />
        <StatCard
          title="Individuals"
          value={stats.individuals}
          subtitle="Retail borrowers"
          status="info"
        />
        <StatCard
          title="Entities"
          value={stats.entities}
          subtitle="Commercial / corporate"
          status="warning"
        />
        <StatCard
          title="Active Status"
          value={stats.active}
          subtitle="Verified party profiles"
          status="success"
        />
      </StatCardGrid>

      <FilterToolbar
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="Search by customer name, ID, phone, or email..."
        searchTestId="customer-search-input"
        filters={
          <>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Party Type</InputLabel>
              <Select
                value={partyTypeFilter}
                label="Party Type"
                onChange={(e) => setPartyTypeFilter(e.target.value as any)}
                sx={{ borderRadius: 2 }}
              >
                <MenuItem value="ALL">All Types</MenuItem>
                <MenuItem value="INDIVIDUAL">Individual</MenuItem>
                <MenuItem value="ENTITY">Entity</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Status</InputLabel>
              <Select
                value={statusFilter}
                label="Status"
                onChange={(e) => setStatusFilter(e.target.value as any)}
                sx={{ borderRadius: 2 }}
              >
                <MenuItem value="ALL">All Statuses</MenuItem>
                <MenuItem value="ACTIVE">Active</MenuItem>
                <MenuItem value="MERGED">Merged</MenuItem>
              </Select>
            </FormControl>
          </>
        }
      />

      <DataTable<CustomerResource>
        columns={columns}
        data={filteredCustomers}
        keyExtractor={(c) => c.id}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        emptyTitle="No customers found"
        emptyDescription={
          searchTerm
            ? 'Try modifying your search query or filters.'
            : 'Customers will be created automatically when qualified leads are converted.'
        }
      />
    </Container>
  );
}
