// apps/web/src/features/sanctions/SanctionsListPage.tsx — owner: Dev 3 (MOD-SND Sanctions Overview)
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { OpenInNewIcon } from '../../shell/icons';
import {
  DataTable,
  FilterToolbar,
  PageHeader,
  StatCard,
  StatCardGrid,
  StatusBadge,
  type ColumnDef,
} from '../../ui';
import { sanctionsApi } from './api';
import type { DisbursementTranche, Sanction } from './types';
import { NotSet } from '../../ui/NotSet';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);
}

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
  } = useQuery({
    queryKey: ['all-sanctions', sanctionStatusFilter],
    queryFn: () =>
      sanctionsApi.listAllSanctions(sanctionStatusFilter ? { status: sanctionStatusFilter } : undefined),
  });

  const {
    data: tranchesData,
    isLoading: isTranchesLoading,
    error: tranchesError,
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
        const matchesUtr = t.utrMasked?.toLowerCase().includes(term);
        if (!matchesId && !matchesSanction && !matchesUtr) return false;
      }
      return true;
    });
  }, [tranches, searchTerm]);

  const isLoading = isSanctionsLoading || isTranchesLoading;

  const sanctionColumns: ColumnDef<Sanction>[] = [
    {
      id: 'id',
      header: 'Sanction',
      accessor: (s) => (
        <Box>
          <Typography variant="body2" fontWeight={600} color="primary.main">
            Sanction
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            v{s.version} • {s.source}
          </Typography>
        </Box>
      ),
    },
    {
      id: 'lenderCaseId',
      header: 'Lender Case',
      accessor: (s) => (
        <Box>
          <Typography
            component={RouterLink}
            to={`/lender-cases/${s.lenderCaseId}`}
            variant="body2"
            sx={{
              color: 'primary.main',
              textDecoration: 'none',
              fontWeight: 600,
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            Open lender case
          </Typography>
        </Box>
      ),
    },
    {
      id: 'amount',
      header: 'Sanctioned Amount',
      accessor: (s) => (
        <Typography variant="body2" fontWeight={700}>
          {formatCurrency(Number(s.amount))}
        </Typography>
      ),
    },
    {
      id: 'tenureMonths',
      header: 'Tenure',
      accessor: (s) => `${s.tenureMonths} mos`,
    },
    {
      id: 'rate',
      header: 'Rate & Type',
      accessor: (s) => `${s.rateValue}% (${s.rateType})`,
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (s) => <StatusBadge status={s.status} />,
    },
    {
      id: 'sanctionDate',
      header: 'Sanction Date',
      accessor: (s) => (
        <Box>
          <Typography variant="body2" color="text.secondary">
            {s.sanctionDate || <NotSet />}
          </Typography>
          {s.validUntil && (
            <Typography variant="caption" color="text.secondary" display="block">
              Valid: {s.validUntil}
            </Typography>
          )}
        </Box>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      accessor: (s) => (
        <Button
          size="small"
          variant="contained"
          color="primary"
          onClick={() => navigate(`/sanctions/${s.lenderCaseId}`)}
          endIcon={<OpenInNewIcon fontSize="small" />}
          sx={{ textTransform: 'none', borderRadius: 1.5 }}
        >
          Manage Panel
        </Button>
      ),
    },
  ];

  const trancheColumns: ColumnDef<DisbursementTranche>[] = [
    {
      id: 'trancheNo',
      header: 'Tranche',
      accessor: (t) => (
        <Box>
          <Typography variant="body2" fontWeight={600}>
            Tranche #{t.trancheNo}
          </Typography>
        </Box>
      ),
    },
    {
      id: 'amount',
      header: 'Amount',
      accessor: (t) => (
        <Typography variant="body2" fontWeight={700}>
          {formatCurrency(Number(t.amount))}
        </Typography>
      ),
    },
    {
      id: 'disbursedOn',
      header: 'Disbursed On',
      accessor: (t) => t.disbursedOn || <NotSet />,
    },
    {
      id: 'utrMasked',
      header: 'UTR (Masked)',
      accessor: (t) => (
        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
          {t.utrMasked || <NotSet />}
        </Typography>
      ),
    },
    {
      id: 'loanAccountMasked',
      header: 'Loan Account',
      accessor: (t) => (
        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
          {t.loanAccountMasked || <NotSet />}
        </Typography>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (t) => <StatusBadge status={t.status} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      accessor: (t) => {
        const parentSanction = sanctions.find((s) => s.id === t.sanctionId);
        return parentSanction ? (
          <Button
            size="small"
            variant="outlined"
            onClick={() => navigate(`/sanctions/${parentSanction.lenderCaseId}`)}
            sx={{ textTransform: 'none', borderRadius: 1.5 }}
          >
            Manage
          </Button>
        ) : (
          <Button
            size="small"
            variant="outlined"
            onClick={() => setCurrentTab('sanctions')}
            sx={{ textTransform: 'none', borderRadius: 1.5 }}
          >
            View Sanction
          </Button>
        );
      },
    },
  ];

  return (
    <Container maxWidth={false} disableGutters>
      <PageHeader
        title="Sanctions & Disbursements"
        subtitle="Manage lender credit sanctions, conditional letters, and recorded disbursement tranches across all lender cases"
      />

      {/* Metrics Row */}
      <StatCardGrid columns={{ xs: 12, sm: 6, md: 3 }} sx={{ mb: 3 }}>
        <StatCard
          title="Total Sanctions"
          value={totalSanctions}
          subtext="Recorded credit facilities"
        />
        <StatCard
          title="Active Sanctions"
          value={activeSanctions}
          subtext="Currently serviceable"
          colorVariant="success"
        />
        <StatCard
          title="Active Limit"
          value={formatCurrency(totalSanctionedAmount)}
          subtext="Total sanctioned capital"
          colorVariant="info"
        />
        <StatCard
          title="Total Disbursed"
          value={formatCurrency(totalDisbursedAmount)}
          subtext="Net disbursed to borrowers"
          colorVariant="warning"
        />
      </StatCardGrid>

      {/* Navigation Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
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
      </Box>

      {/* Filter and Search Bar */}
      <FilterToolbar
        searchPlaceholder={
          currentTab === 'sanctions'
            ? 'Search by sanction ID or lender case ID...'
            : 'Search by tranche ID, sanction ID, or UTR...'
        }
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        onReset={() => {
          setSearchTerm('');
          setSanctionStatusFilter('');
          setTrancheStatusFilter('');
        }}
        filters={
          currentTab === 'sanctions' ? (
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Status</InputLabel>
              <Select
                value={sanctionStatusFilter}
                label="Status"
                onChange={(e) => setSanctionStatusFilter(e.target.value)}
              >
                <MenuItem value="">All Statuses</MenuItem>
                <MenuItem value="ACTIVE">Active</MenuItem>
                <MenuItem value="REVISED">Revised</MenuItem>
                <MenuItem value="EXPIRED">Expired</MenuItem>
                <MenuItem value="CANCELLED">Cancelled</MenuItem>
              </Select>
            </FormControl>
          ) : (
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Status</InputLabel>
              <Select
                value={trancheStatusFilter}
                label="Status"
                onChange={(e) => setTrancheStatusFilter(e.target.value)}
              >
                <MenuItem value="">All Statuses</MenuItem>
                <MenuItem value="RECORDED">Recorded</MenuItem>
                <MenuItem value="VERIFIED">Verified</MenuItem>
                <MenuItem value="RETURNED">Returned</MenuItem>
                <MenuItem value="VOIDED">Voided</MenuItem>
              </Select>
            </FormControl>
          )
        }
      />

      {(sanctionsError || tranchesError) && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load sanction and disbursement records. Please verify your permissions.
        </Alert>
      )}

      {/* Tab Content */}
      {currentTab === 'sanctions' ? (
        <DataTable<Sanction>
          columns={sanctionColumns}
          data={filteredSanctions}
          loading={isLoading}
          emptyTitle="No sanction records found."
        />
      ) : (
        <DataTable<DisbursementTranche>
          columns={trancheColumns}
          data={filteredTranches}
          loading={isLoading}
          emptyTitle="No disbursement tranches found."
        />
      )}
    </Container>
  );
}
