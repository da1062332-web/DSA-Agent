// apps/web/src/features/lender-cases/LenderCaseListPage.tsx — owner: Dev 4 (MOD-LCS Case Overview)
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Chip,
  Container,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  OpenInNewIcon,
  AccountBalanceIcon,
  AssessmentIcon,
  FilterListIcon,
} from '../../shell/icons';
import { fetchAllLenderCases } from './api';
import type { LenderCaseResource, LenderCaseStatus } from './types';
import { ApplicationName, LenderName } from '../../shell/display';
import {
  PageHeader,
  StatCard,
  StatCardGrid,
  FilterToolbar,
  DataTable,
  StatusBadge,
  type ColumnDef,
} from '../../ui';

const ALL_STATUSES: LenderCaseStatus[] = [
  'DRAFT',
  'PACKAGE_READY',
  'SUBMITTED',
  'UNDER_PROCESSING',
  'QUERY_RAISED',
  'QUERY_RESPONDED',
  'SANCTIONED',
  'REJECTED',
  'WITHDRAWN',
  'SANCTION_EXPIRED',
  'SANCTION_CANCELLED',
  'PARTIALLY_DISBURSED',
  'DISBURSED',
  'CLOSED',
];

export function LenderCaseListPage(): React.ReactElement {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [channelFilter, setChannelFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const {
    data: cases = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['lender-cases', statusFilter],
    queryFn: () => fetchAllLenderCases(statusFilter ? { status: statusFilter } : undefined),
  });

  const filteredCases = useMemo(() => {
    return cases.filter((c: LenderCaseResource) => {
      if (channelFilter && c.submissionChannel !== channelFilter) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesId = c.id.toLowerCase().includes(term);
        const matchesApp = c.applicationId.toLowerCase().includes(term);
        const matchesLender = c.lenderId.toLowerCase().includes(term);
        const matchesRef = c.lenderReference?.toLowerCase().includes(term) ?? false;
        if (!matchesId && !matchesApp && !matchesLender && !matchesRef) return false;
      }
      return true;
    });
  }, [cases, channelFilter, searchTerm]);

  // Aggregate metrics
  const totalCount = cases.length;
  const underProcessingCount = cases.filter((c) =>
    ['SUBMITTED', 'UNDER_PROCESSING', 'QUERY_RAISED', 'QUERY_RESPONDED'].includes(c.status),
  ).length;
  const sanctionedCount = cases.filter((c) =>
    ['SANCTIONED', 'PARTIALLY_DISBURSED', 'DISBURSED'].includes(c.status),
  ).length;

  const columns: ColumnDef<LenderCaseResource>[] = [
    {
      id: 'caseId',
      header: 'Case ID',
      accessor: (c) => (
        <Box>
          <Box sx={{ fontWeight: 600, mb: 0.25 }}>
            <LenderName id={c.lenderId} typographyProps={{ fontWeight: 600, variant: 'body2' }} />
          </Box>
          <Typography
            component={RouterLink}
            to={`/lender-cases/${c.id}`}
            variant="caption"
            sx={{
              color: 'info.main',
              textDecoration: 'none',
              fontFamily: 'monospace',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            {c.id}
          </Typography>
          {c.lenderReference && (
            <Typography variant="caption" display="block" color="text.secondary">
              Ref: {c.lenderReference}
            </Typography>
          )}
        </Box>
      ),
    },
    {
      id: 'applicationId',
      header: 'Application',
      accessor: (c) => <ApplicationName id={c.applicationId} linkToApp />,
    },
    {
      id: 'lenderId',
      header: 'Lender',
      accessor: (c) => <LenderName id={c.lenderId} typographyProps={{ variant: 'body2', fontWeight: 500 }} />,
    },
    {
      id: 'attemptNo',
      header: 'Attempt',
      accessor: (c) => (
        <Chip
          label={`#${c.attemptNo}`}
          size="small"
          variant="outlined"
          sx={{ height: 22, fontSize: '0.75rem' }}
        />
      ),
    },
    {
      id: 'submissionChannel',
      header: 'Channel',
      accessor: (c) => c.submissionChannel || '—',
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (c) => <StatusBadge status={c.status} />,
    },
    {
      id: 'createdAt',
      header: 'Created Date',
      accessor: (c) => (c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—'),
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
            onClick={() => navigate(`/lender-cases/${c.id}`)}
            sx={{ borderRadius: 1.5, textTransform: 'none', fontWeight: 600, fontSize: 12 }}
          >
            View Details
          </Button>
          <Button
            size="small"
            variant="text"
            color="primary"
            onClick={() => navigate(`/sanctions/${c.id}`)}
            endIcon={<OpenInNewIcon fontSize="small" />}
            sx={{ borderRadius: 1.5, textTransform: 'none', fontWeight: 600, fontSize: 12 }}
          >
            Sanctions
          </Button>
        </Stack>
      ),
    },
  ];

  return (
    <Container maxWidth={false} disableGutters>
      <PageHeader
        title="Lender Cases"
        subtitle="Track and manage lender submission cases, underwriting progress, and sanction milestones across applications."
        actions={
          <Button
            variant="outlined"
            size="small"
            onClick={() => refetch()}
            startIcon={<FilterListIcon />}
            sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
          >
            Refresh
          </Button>
        }
      />

      {/* Metric Cards */}
      <StatCardGrid columns={{ xs: 12, sm: 4, md: 4 }}>
        <StatCard
          title="Total Cases"
          value={totalCount}
          subtitle="All lender submissions"
          icon={<AssessmentIcon />}
          status="primary"
        />
        <StatCard
          title="Under Processing"
          value={underProcessingCount}
          subtitle="Active lender reviews"
          icon={<FilterListIcon />}
          status="info"
        />
        <StatCard
          title="Sanctioned & Disbursed"
          value={sanctionedCount}
          subtitle="Successful outcomes"
          icon={<AccountBalanceIcon />}
          status="success"
        />
      </StatCardGrid>

      {/* Filter and Search Bar */}
      <FilterToolbar
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="Search by case ID, application ID, or lender..."
        onReset={
          statusFilter || channelFilter || searchTerm
            ? () => {
                setStatusFilter('');
                setChannelFilter('');
                setSearchTerm('');
              }
            : undefined
        }
        filters={
          <>
            <TextField
              size="small"
              select
              label="Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              sx={{ minWidth: 180, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
            >
              <MenuItem value="">All Statuses</MenuItem>
              {ALL_STATUSES.map((st) => (
                <MenuItem key={st} value={st}>
                  {st.replace(/_/g, ' ')}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              size="small"
              select
              label="Channel"
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              sx={{ minWidth: 150, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
            >
              <MenuItem value="">All Channels</MenuItem>
              <MenuItem value="API">API</MenuItem>
              <MenuItem value="PORTAL">Portal</MenuItem>
              <MenuItem value="EMAIL">Email</MenuItem>
              <MenuItem value="PHYSICAL">Physical</MenuItem>
            </TextField>
          </>
        }
      />

      {/* Cases Table */}
      <DataTable<LenderCaseResource>
        columns={columns}
        data={filteredCases}
        keyExtractor={(c) => c.id}
        isLoading={isLoading}
        isError={Boolean(error)}
        error={error}
        onRetry={refetch}
        emptyTitle="No lender cases found matching the criteria."
        emptyDescription="Try selecting a different status or channel filter."
      />
    </Container>
  );
}
