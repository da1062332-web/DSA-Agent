// apps/web/src/features/lender-cases/LenderCaseListPage.tsx — owner: Dev 4 (MOD-LCS Case Overview)
import React, { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import { ApplicationSelect } from '../../shell/selectors';
import { Can } from '../../shell/Can';
import {
  PageHeader,
  StatCard,
  StatCardGrid,
  FilterToolbar,
  DataTable,
  StatusBadge,
  type ColumnDef,
} from '../../ui';
import { NotSet } from '../../ui/NotSet';

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
  const [newOpen, setNewOpen] = useState(false);
  const [newApplicationId, setNewApplicationId] = useState('');

  // Cases come 50 at a time, newest first. The status filter is applied by the server; the channel and search
  // filters below apply to the cases loaded so far.
  const casesQuery = useInfiniteQuery({
    queryKey: ['lender-cases', statusFilter],
    queryFn: ({ pageParam }) =>
      fetchAllLenderCases({ status: statusFilter || undefined, cursor: pageParam ?? undefined, limit: 50 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? null,
  });
  const cases = useMemo(() => casesQuery.data?.pages.flatMap((page) => page.data) ?? [], [casesQuery.data]);
  const { isLoading, error, refetch } = casesQuery;

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
      header: 'Lender case',
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
              color: 'primary.main',
              textDecoration: 'none',
              fontFamily: 'monospace',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            Open case
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
      accessor: (c) => c.submissionChannel || <NotSet />,
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (c) => <StatusBadge status={c.status} />,
    },
    {
      id: 'createdAt',
      header: 'Created Date',
      accessor: (c) => (c.createdAt ? new Date(c.createdAt).toLocaleDateString() : <NotSet />),
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
          <Can action="sanction.record">
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
          </Can>
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
          <Stack direction="row" spacing={1}>
          <Can action="lender_case.submit">
            <Button
              variant="contained"
              size="small"
              onClick={() => setNewOpen(true)}
              data-testid="lender-case.list.new"
              sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
            >
              + New Lender Attempt
            </Button>
          </Can>
          <Button
            variant="outlined"
            size="small"
            onClick={() => refetch()}
            startIcon={<FilterListIcon />}
            sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
          >
            Refresh
          </Button>
          </Stack>
        }
      />

      {/* Metric Cards */}
      <StatCardGrid columns={{ xs: 12, sm: 4, md: 4 }}>
        <StatCard
          title="Cases Loaded"
          value={totalCount}
          subtitle="Loaded so far"
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
      {casesQuery.hasNextPage && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Button
            variant="outlined"
            onClick={() => casesQuery.fetchNextPage()}
            disabled={casesQuery.isFetchingNextPage}
            data-testid="lender-case.list.more"
          >
            {casesQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </Box>
      )}
      <Dialog open={newOpen} onClose={() => setNewOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Lender Attempt</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
            Choose the application. Its attempts screen lets you pick the lender and the product.
          </Typography>
          <ApplicationSelect
            size="small"
            fullWidth
            label="Application"
            placeholder="Select application..."
            value={newApplicationId || null}
            onChange={(id) => setNewApplicationId(id ?? '')}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!newApplicationId}
            onClick={() => {
              setNewOpen(false);
              navigate(`/applications/${newApplicationId}/lender-cases`);
            }}
            data-testid="lender-case.list.new.continue"
          >
            Continue
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
