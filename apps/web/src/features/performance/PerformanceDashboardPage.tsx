// apps/web/src/features/performance/PerformanceDashboardPage.tsx — CMP-PERF.02.1
import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { DataTable, DetailCard, FilterToolbar, PageHeader, StatCard, StatCardGrid } from '../../ui';
import type { ColumnDef } from '../../ui';
import { useTeamPerformanceDashboard } from './api';
import type { DashboardFilterState } from './types';
import { NotSet } from '../../ui/NotSet';
import { RowAction } from '../../shell/RowAction';

function formatCurrency(amount: number): string {
  if (amount >= 10000000) {
    return `₹${(amount / 10000000).toFixed(2)} Cr`;
  }
  if (amount >= 100000) {
    return `₹${(amount / 100000).toFixed(2)} L`;
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function achievementStatus(rate: number | null): 'success' | 'info' | 'warning' {
  if (rate === null) return 'warning';
  if (rate >= 100) return 'success';
  if (rate >= 75) return 'info';
  return 'warning';
}

type BreakdownRow = {
  dimensionType: string;
  dimensionId: string;
  dimensionName: string;
  leadCount: number;
  sanctionCount: number;
  disbursementAmount: number;
  disbursementTarget: number | null;
  achievementPercentage: number | null;
};

export function PerformanceDashboardPage() {
  const [filters, setFilters] = useState<DashboardFilterState>({
    period: '2026-10',
    branchId: '',
    userId: '',
  });

  const { data: dashboard, isLoading, isError, error, refetch } = useTeamPerformanceDashboard(filters);

  const handlePeriodChange = (period: string) => {
    setFilters((prev) => ({ ...prev, period }));
  };

  const handleBranchFilter = (branchId: string) => {
    setFilters((prev) => ({ ...prev, branchId }));
  };

  const clearDrilldown = () => {
    setFilters((prev) => ({ ...prev, branchId: '', userId: '' }));
  };

  const breakdownColumns: ColumnDef<BreakdownRow>[] = [
    {
      id: 'dimension',
      header: 'Dimension',
      render: (row) => <Chip size="small" label={row.dimensionType} variant="outlined" />,
    },
    {
      id: 'entity',
      header: 'Entity Name',
      render: (row) => <Typography sx={{ fontWeight: 500 }}>{row.dimensionName}</Typography>,
    },
    { id: 'leads', header: 'Leads', align: 'right', render: (row) => row.leadCount },
    { id: 'sanctions', header: 'Sanctions', align: 'right', render: (row) => row.sanctionCount },
    {
      id: 'disbursed',
      header: 'Disbursed Amount',
      align: 'right',
      render: (row) => <Typography sx={{ fontWeight: 600 }}>{formatCurrency(row.disbursementAmount)}</Typography>,
    },
    {
      id: 'target',
      header: 'Target Amount',
      align: 'right',
      render: (row) => (
        <Typography color="text.secondary">
          {row.disbursementTarget !== null ? formatCurrency(row.disbursementTarget) : <NotSet />}
        </Typography>
      ),
    },
    {
      id: 'achievement',
      header: 'Achievement',
      align: 'center',
      render: (row) =>
        row.achievementPercentage !== null ? (
          <Chip
            size="small"
            label={`${row.achievementPercentage}%`}
            color={achievementStatus(row.achievementPercentage) === 'success' ? 'success' : 'warning'}
          />
        ) : (
          <Tooltip title="No approved target exists for this slice">
            <NotSet />
          </Tooltip>
        ),
    },
    {
      id: 'action',
      header: 'Action',
      align: 'center',
      render: (row) =>
        <RowAction allowed={row.dimensionType === 'BRANCH'}>
          <Button size="small" variant="text" onClick={() => handleBranchFilter(row.dimensionId)}>
            Drill Down
          </Button>
        </RowAction>,
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Team Performance Dashboard"
        subtitle="Operational activity, conversion outcomes, and target achievement."
      />

      <FilterToolbar
        filters={
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel id="period-select-label">Period</InputLabel>
              <Select
                labelId="period-select-label"
                value={filters.period}
                label="Period"
                onChange={(e) => handlePeriodChange(e.target.value)}
              >
                <MenuItem value="2026-10">October 2026</MenuItem>
                <MenuItem value="2026-09">September 2026</MenuItem>
                <MenuItem value="2026-Q4">2026 Q4 (Oct - Dec)</MenuItem>
                <MenuItem value="2026-Q3">2026 Q3 (Jul - Sep)</MenuItem>
                <MenuItem value="2026-Q2">2026 Q2 (Apr - Jun)</MenuItem>
                <MenuItem value="2026-Q1">2026 Q1 (Jan - Mar)</MenuItem>
              </Select>
            </FormControl>

            <TextField
              size="small"
              label="Filter Branch ID"
              placeholder="e.g. brn_main"
              value={filters.branchId || ''}
              onChange={(e) => handleBranchFilter(e.target.value)}
              sx={{ width: 180 }}
            />

            {filters.branchId && (
              <Button size="small" variant="outlined" onClick={clearDrilldown}>
                Reset Scope
              </Button>
            )}
          </Stack>
        }
        onRefresh={() => refetch()}
      />

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {isError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error instanceof Error ? error.message : 'Failed to load performance dashboard.'}
        </Alert>
      )}

      {dashboard && (
        <>
          <StatCardGrid columns={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard
              title="LEAD INTAKE"
              value={dashboard.summary.leads.actual.toLocaleString()}
              format="raw"
              subtext={`Target: ${
                dashboard.summary.leads.target !== null ? dashboard.summary.leads.target.toLocaleString() : 'None'
              }${
                dashboard.summary.leads.achievementPercentage !== null
                  ? ` · ${dashboard.summary.leads.achievementPercentage}%`
                  : ''
              }`}
              status={achievementStatus(dashboard.summary.leads.achievementPercentage) === 'success' ? 'success' : 'primary'}
            />
            <StatCard
              title="SANCTIONS ISSUED"
              value={dashboard.summary.sanctions.count}
              format="number"
              subtext={`Value: ${formatCurrency(dashboard.summary.sanctions.amount)} · Target: ${
                dashboard.summary.sanctions.targetCount !== null ? dashboard.summary.sanctions.targetCount : 'None'
              }${
                dashboard.summary.sanctions.achievementPercentage !== null
                  ? ` · ${dashboard.summary.sanctions.achievementPercentage}%`
                  : ''
              }`}
              status="success"
            />
            <StatCard
              title="DISBURSEMENTS"
              value={formatCurrency(dashboard.summary.disbursements.amount)}
              format="raw"
              subtext={`Tranches: ${dashboard.summary.disbursements.count} · Target: ${
                dashboard.summary.disbursements.targetAmount !== null
                  ? formatCurrency(dashboard.summary.disbursements.targetAmount)
                  : 'None'
              }${
                dashboard.summary.disbursements.achievementPercentage !== null
                  ? ` · ${dashboard.summary.disbursements.achievementPercentage}%`
                  : ''
              }`}
              status="secondary"
            />
            <StatCard
              title="LEAD CONVERSION RATE"
              value={`${dashboard.summary.conversionRate}%`}
              format="raw"
              subtext={`Total Activities: ${dashboard.summary.activityCount} · Intake to application efficiency`}
              status="info"
            />
          </StatCardGrid>

          <DetailCard
            title="Activity-versus-Outcome Conversion Funnel"
            subtitle="Stage-by-stage progression from initial lead intake to disbursement release."
            dataTestId="performance-funnel"
          >
            <StatCardGrid columns={{ xs: 12, sm: 6, md: 2.4 }} sx={{ mb: 0 }}>
              {dashboard.funnel.map((step, idx) => (
                <StatCard
                  key={step.stage}
                  title={step.stage}
                  value={step.count.toLocaleString()}
                  format="raw"
                  subtext={`STAGE ${idx + 1} · ${idx === 0 ? 'Baseline' : `${step.rate}% from prev`}`}
                  status={idx === 0 ? 'default' : 'primary'}
                />
              ))}
            </StatCardGrid>
          </DetailCard>

          <DetailCard
            title="Dimensional Performance Breakdown"
            subtitle="Target versus actual comparisons across branches and teams."
            actions={
              <Typography variant="caption" color="text.secondary">
                As of: {new Date(dashboard.asOf).toLocaleString()}
              </Typography>
            }
          >
            <DataTable<BreakdownRow>
              columns={breakdownColumns}
              data={dashboard.breakdown}
              keyExtractor={(row) => row.dimensionId}
              emptyMessage="No performance data found for the selected period and filters."
            />
          </DetailCard>
        </>
      )}
    </Box>
  );
}
