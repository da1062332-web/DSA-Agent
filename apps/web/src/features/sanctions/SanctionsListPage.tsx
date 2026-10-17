// apps/web/src/features/sanctions/SanctionsListPage.tsx — owner: Dev 3 (MOD-SND Sanctions Overview)
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
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import {
  SearchIcon,
  OpenInNewIcon,
  AccountBalanceIcon,
  PaymentIcon,
  MonetizationOnIcon,
  CheckCircleOutlineIcon,
  FilterListIcon,
} from '../../shell/icons';
import { PageHeader } from '../admin/components';
import { sanctionsApi } from './api';
import type { DisbursementTranche, Sanction } from './types';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);
}

const SANCTION_STATUS_COLORS: Record<
  string,
  'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'
> = {
  ACTIVE: 'success',
  REVISED: 'info',
  EXPIRED: 'warning',
  CANCELLED: 'error',
};

const TRANCHE_STATUS_COLORS: Record<
  string,
  'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'
> = {
  RECORDED: 'info',
  VERIFIED: 'success',
  RETURNED: 'warning',
  VOIDED: 'error',
};

export function SanctionsListPage(): React.ReactElement {
  const navigate = useNavigate();
  const [currentTab, setCurrentTab] = useState<'sanctions' | 'tranches'>('sanctions');
  const [sanctionStatusFilter, setSanctionStatusFilter] = useState<string>('');
  const [trancheStatusFilter, setTrancheStatusFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const {
    data: sanctionsData,
    isLoading: isSanctionsLoading,
    error: sanctionsError,
    refetch: refetchSanctions,
  } = useQuery({
    queryKey: ['all-sanctions', sanctionStatusFilter],
    queryFn: () =>
      sanctionsApi.listAllSanctions(sanctionStatusFilter ? { status: sanctionStatusFilter } : undefined),
  });

  const {
    data: tranchesData,
    isLoading: isTranchesLoading,
    error: tranchesError,
    refetch: refetchTranches,
  } = useQuery({
    queryKey: ['all-tranches', trancheStatusFilter],
    queryFn: () =>
      sanctionsApi.listAllTranches(trancheStatusFilter ? { status: trancheStatusFilter } : undefined),
  });

  const sanctions: Sanction[] = sanctionsData?.data || [];
  const tranches: DisbursementTranche[] = tranchesData?.data || [];

  // Metrics
  const totalSanctions = sanctions.length;
  const activeSanctions = sanctions.filter((s) => s.status === 'ACTIVE').length;
  const totalSanctionedAmount = sanctions
    .filter((s) => s.status === 'ACTIVE')
    .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const totalDisbursedAmount = tranches
    .filter((t) => t.status !== 'VOIDED')
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

  const filteredSanctions = useMemo(() => {
    return sanctions.filter((s) => {
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesId = s.id.toLowerCase().includes(term);
        const matchesCase = s.lenderCaseId.toLowerCase().includes(term);
        if (!matchesId && !matchesCase) return false;
      }
      return true;
    });
  }, [sanctions, searchTerm]);

  const filteredTranches = useMemo(() => {
    return tranches.filter((t) => {
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesId = t.id.toLowerCase().includes(term);
        const matchesSanction = t.sanctionId.toLowerCase().includes(term);
        const matchesUtr = t.utrMasked?.toLowerCase().includes(term) ?? false;
        if (!matchesId && !matchesSanction && !matchesUtr) return false;
      }
      return true;
    });
  }, [tranches, searchTerm]);

  const isLoading = isSanctionsLoading || isTranchesLoading;

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <PageHeader
        title="Sanctions & Disbursements"
        subtitle="Manage lender sanctions, approved limits, interest terms, and verified disbursement tranches."
        action={
          <Button
            variant="outlined"
            size="small"
            onClick={() => {
              refetchSanctions();
              refetchTranches();
            }}
            startIcon={<FilterListIcon />}
          >
            Refresh
          </Button>
        }
      />

      {/* KPI / Metric Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
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
                  <AccountBalanceIcon />
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Total Sanctions
                  </Typography>
                  <Typography variant="h5" fontWeight="bold">
                    {totalSanctions}
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
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
                  <CheckCircleOutlineIcon />
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Active Sanctions
                  </Typography>
                  <Typography variant="h5" fontWeight="bold" color="success.main">
                    {activeSanctions}
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
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
                  <MonetizationOnIcon />
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Active Limit
                  </Typography>
                  <Typography variant="h6" fontWeight="bold" color="info.main">
                    {formatCurrency(totalSanctionedAmount)}
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={1} sx={{ borderRadius: 2 }}>
            <CardContent sx={{ py: 2 }}>
              <Stack direction="row" alignItems="center" spacing={2}>
                <Box
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: 'warning.50',
                    color: 'warning.main',
                    display: 'flex',
                  }}
                >
                  <PaymentIcon />
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Total Disbursed
                  </Typography>
                  <Typography variant="h6" fontWeight="bold" color="warning.dark">
                    {formatCurrency(totalDisbursedAmount)}
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Navigation Tabs */}
      <Paper elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs
          value={currentTab}
          onChange={(_, val) => setCurrentTab(val)}
          indicatorColor="primary"
          textColor="primary"
        >
          <Tab
            value="sanctions"
            label={`Sanctions (${sanctions.length})`}
            sx={{ fontWeight: 600, textTransform: 'none' }}
          />
          <Tab
            value="tranches"
            label={`Disbursement Tranches (${tranches.length})`}
            sx={{ fontWeight: 600, textTransform: 'none' }}
          />
        </Tabs>
      </Paper>

      {/* Filter and Search Bar */}
      <Paper elevation={0} sx={{ p: 2, mb: 3, border: '1px solid #e2e8f0', borderRadius: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
          <TextField
            size="small"
            placeholder={
              currentTab === 'sanctions'
                ? 'Search by sanction ID or lender case ID...'
                : 'Search by tranche ID, sanction ID, or UTR...'
            }
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

          {currentTab === 'sanctions' ? (
            <TextField
              size="small"
              select
              label="Status"
              value={sanctionStatusFilter}
              onChange={(e) => setSanctionStatusFilter(e.target.value)}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="">All Statuses</MenuItem>
              <MenuItem value="ACTIVE">Active</MenuItem>
              <MenuItem value="REVISED">Revised</MenuItem>
              <MenuItem value="EXPIRED">Expired</MenuItem>
              <MenuItem value="CANCELLED">Cancelled</MenuItem>
            </TextField>
          ) : (
            <TextField
              size="small"
              select
              label="Status"
              value={trancheStatusFilter}
              onChange={(e) => setTrancheStatusFilter(e.target.value)}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="">All Statuses</MenuItem>
              <MenuItem value="RECORDED">Recorded</MenuItem>
              <MenuItem value="VERIFIED">Verified</MenuItem>
              <MenuItem value="RETURNED">Returned</MenuItem>
              <MenuItem value="VOIDED">Voided</MenuItem>
            </TextField>
          )}

          {(searchTerm || sanctionStatusFilter || trancheStatusFilter) && (
            <Button
              size="small"
              onClick={() => {
                setSearchTerm('');
                setSanctionStatusFilter('');
                setTrancheStatusFilter('');
              }}
            >
              Clear
            </Button>
          )}
        </Stack>
      </Paper>

      {/* Loading & Error States */}
      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {(sanctionsError || tranchesError) && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load sanction and disbursement records. Please verify your permissions.
        </Alert>
      )}

      {/* Sanctions Tab Content */}
      {!isLoading && currentTab === 'sanctions' && (
        <Card elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 2 }}>
          <TableContainer>
            <Table size="medium">
              <TableHead sx={{ bgcolor: 'grey.50' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Sanction ID</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Lender Case</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Sanctioned Amount</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Tenure</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Rate & Type</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Sanction Date</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>
                    Actions
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredSanctions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} align="center" sx={{ py: 6 }}>
                      <Typography variant="body1" color="text.secondary">
                        No sanction records found.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSanctions.map((s) => {
                    const chipColor = SANCTION_STATUS_COLORS[s.status] || 'default';
                    return (
                      <TableRow key={s.id} hover>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600} color="primary.main">
                            {s.id}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" display="block">
                            v{s.version} • {s.source}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography
                            component={RouterLink}
                            to={`/lender-cases/${s.lenderCaseId}`}
                            variant="body2"
                            sx={{
                              color: 'text.primary',
                              textDecoration: 'none',
                              '&:hover': { textDecoration: 'underline', color: 'primary.main' },
                            }}
                          >
                            {s.lenderCaseId}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={700}>
                            {formatCurrency(Number(s.amount))}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{s.tenureMonths} mos</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {s.rateValue}% ({s.rateType})
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip label={s.status} color={chipColor} size="small" sx={{ fontWeight: 500 }} />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {s.sanctionDate || '—'}
                          </Typography>
                          {s.validUntil && (
                            <Typography variant="caption" color="text.secondary" display="block">
                              Valid: {s.validUntil}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            variant="contained"
                            color="primary"
                            onClick={() => navigate(`/sanctions/${s.lenderCaseId}`)}
                            endIcon={<OpenInNewIcon fontSize="small" />}
                          >
                            Manage Panel
                          </Button>
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

      {/* Tranches Tab Content */}
      {!isLoading && currentTab === 'tranches' && (
        <Card elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 2 }}>
          <TableContainer>
            <Table size="medium">
              <TableHead sx={{ bgcolor: 'grey.50' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Tranche ID</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Sanction ID</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Amount</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Disbursed On</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>UTR (Masked)</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Loan Account</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>
                    Actions
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredTranches.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} align="center" sx={{ py: 6 }}>
                      <Typography variant="body1" color="text.secondary">
                        No disbursement tranches found.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredTranches.map((t) => {
                    const chipColor = TRANCHE_STATUS_COLORS[t.status] || 'default';
                    // Find parent sanction to get lenderCaseId if available
                    const parentSanction = sanctions.find((s) => s.id === t.sanctionId);
                    return (
                      <TableRow key={t.id} hover>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>
                            Tranche #{t.trancheNo}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" display="block">
                            {t.id}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {t.sanctionId}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={700}>
                            {formatCurrency(Number(t.amount))}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{t.disbursedOn || '—'}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                            {t.utrMasked || '—'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                            {t.loanAccountMasked || '—'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip label={t.status} color={chipColor} size="small" sx={{ fontWeight: 500 }} />
                        </TableCell>
                        <TableCell align="right">
                          {parentSanction ? (
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => navigate(`/sanctions/${parentSanction.lenderCaseId}`)}
                            >
                              Manage
                            </Button>
                          ) : (
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => setCurrentTab('sanctions')}
                            >
                              View Sanction
                            </Button>
                          )}
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
