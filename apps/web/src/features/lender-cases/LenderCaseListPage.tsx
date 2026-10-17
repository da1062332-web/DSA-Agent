// apps/web/src/features/lender-cases/LenderCaseListPage.tsx — owner: Dev 4 (MOD-LCS Case Overview)
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
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
  InputAdornment,
  MenuItem,
  Paper,
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
import {
  SearchIcon,
  OpenInNewIcon,
  AccountBalanceIcon,
  AssessmentIcon,
  FilterListIcon,
} from '../../shell/icons';
import { PageHeader } from '../admin/components';
import { fetchAllLenderCases } from './api';
import type { LenderCaseResource, LenderCaseStatus } from './types';

const STATUS_CHIP_COLORS: Record<
  string,
  'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'
> = {
  DRAFT: 'default',
  PACKAGE_READY: 'primary',
  SUBMITTED: 'info',
  UNDER_PROCESSING: 'info',
  QUERY_RAISED: 'warning',
  QUERY_RESPONDED: 'info',
  SANCTIONED: 'success',
  REJECTED: 'error',
  WITHDRAWN: 'default',
  SANCTION_EXPIRED: 'error',
  SANCTION_CANCELLED: 'error',
  PARTIALLY_DISBURSED: 'success',
  DISBURSED: 'success',
  CLOSED: 'default',
};

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

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <PageHeader
        title="Lender Cases"
        subtitle="Track and manage lender submission cases, underwriting progress, and sanction milestones across applications."
        action={
          <Button variant="outlined" size="small" onClick={() => refetch()} startIcon={<FilterListIcon />}>
            Refresh
          </Button>
        }
      />

      {/* Metric Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={4}>
          <Card elevation={1} sx={{ borderRadius: 2 }}>
            <CardContent sx={{ py: 2 }}>
              <Stack direction="row" alignItems="center" spacing={2}>
                <Box
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: 'primary.50',
                    color: 'primary.main',
                    display: 'flex',
                  }}
                >
                  <AssessmentIcon />
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Total Cases
                  </Typography>
                  <Typography variant="h5" fontWeight="bold">
                    {totalCount}
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card elevation={1} sx={{ borderRadius: 2 }}>
            <CardContent sx={{ py: 2 }}>
              <Stack direction="row" alignItems="center" spacing={2}>
                <Box
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: 'info.50',
                    color: 'info.main',
                    display: 'flex',
                  }}
                >
                  <FilterListIcon />
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Under Processing
                  </Typography>
                  <Typography variant="h5" fontWeight="bold" color="info.main">
                    {underProcessingCount}
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card elevation={1} sx={{ borderRadius: 2 }}>
            <CardContent sx={{ py: 2 }}>
              <Stack direction="row" alignItems="center" spacing={2}>
                <Box
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: 'success.50',
                    color: 'success.main',
                    display: 'flex',
                  }}
                >
                  <AccountBalanceIcon />
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Sanctioned & Disbursed
                  </Typography>
                  <Typography variant="h5" fontWeight="bold" color="success.main">
                    {sanctionedCount}
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filter and Search Bar */}
      <Paper elevation={0} sx={{ p: 2, mb: 3, border: '1px solid #e2e8f0', borderRadius: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
          <TextField
            size="small"
            placeholder="Search by case ID, application ID, or lender..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
            }}
            sx={{ flex: 1, minWidth: 260 }}
          />

          <TextField
            size="small"
            select
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            sx={{ minWidth: 180 }}
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
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">All Channels</MenuItem>
            <MenuItem value="API">API</MenuItem>
            <MenuItem value="PORTAL">Portal</MenuItem>
            <MenuItem value="EMAIL">Email</MenuItem>
            <MenuItem value="PHYSICAL">Physical</MenuItem>
          </TextField>

          {(statusFilter || channelFilter || searchTerm) && (
            <Button
              size="small"
              onClick={() => {
                setStatusFilter('');
                setChannelFilter('');
                setSearchTerm('');
              }}
            >
              Clear
            </Button>
          )}
        </Stack>
      </Paper>

      {/* Error and Loading States */}
      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load lender cases. Please check permissions and network connectivity.
        </Alert>
      )}

      {/* Cases Table */}
      {!isLoading && !error && (
        <Card elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 2 }}>
          <TableContainer>
            <Table size="medium">
              <TableHead sx={{ bgcolor: 'grey.50' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Case ID</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Application</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Lender</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Attempt</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Channel</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Created Date</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>
                    Actions
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredCases.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} align="center" sx={{ py: 6 }}>
                      <Typography variant="body1" color="text.secondary">
                        No lender cases found matching the criteria.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCases.map((c) => {
                    const chipColor = STATUS_CHIP_COLORS[c.status] || 'default';
                    return (
                      <TableRow key={c.id} hover>
                        <TableCell>
                          <Typography
                            component={RouterLink}
                            to={`/lender-cases/${c.id}`}
                            variant="body2"
                            sx={{
                              color: 'primary.main',
                              textDecoration: 'none',
                              fontWeight: 600,
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
                        </TableCell>
                        <TableCell>
                          <Typography
                            component={RouterLink}
                            to={`/applications/${c.applicationId}`}
                            variant="body2"
                            sx={{
                              color: 'text.primary',
                              textDecoration: 'none',
                              '&:hover': { textDecoration: 'underline', color: 'primary.main' },
                            }}
                          >
                            {c.applicationId}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={500}>
                            {c.lenderId}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={`#${c.attemptNo}`}
                            size="small"
                            variant="outlined"
                            sx={{ height: 22, fontSize: '0.75rem' }}
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {c.submissionChannel || '—'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={c.status.replace(/_/g, ' ')}
                            color={chipColor}
                            size="small"
                            sx={{ fontWeight: 500 }}
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—'}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => navigate(`/lender-cases/${c.id}`)}
                            >
                              View Details
                            </Button>
                            <Button
                              size="small"
                              variant="text"
                              color="primary"
                              onClick={() => navigate(`/sanctions/${c.id}`)}
                              endIcon={<OpenInNewIcon fontSize="small" />}
                            >
                              Sanctions
                            </Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}
    </Container>
  );
}
