// apps/web/src/features/performance/PerformanceDashboardPage.tsx — CMP-PERF.02.1
import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  LinearProgress,
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
  Tooltip,
  Typography,
  SvgIcon,
  type SvgIconProps,
} from '@mui/material';
import { useTeamPerformanceDashboard } from './api';
import type { DashboardFilterState } from './types';

function RefreshIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
    </SvgIcon>
  );
}

function TrendingUpIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z" />
    </SvgIcon>
  );
}

function AccountBalanceIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4 10v7h3v-7H4zm6 0v7h3v-7h-3zM2 22h19v-3H2v3zm14-12v7h3v-7h-3zm-4.5-9L2 6v2h19V6l-9.5-5z" />
    </SvgIcon>
  );
}

function CheckCircleIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </SvgIcon>
  );
}

function PeopleIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
    </SvgIcon>
  );
}

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

function getAchievementColor(rate: number | null): 'success' | 'primary' | 'warning' {
  if (rate === null) return 'warning';
  if (rate >= 100) return 'success';
  if (rate >= 75) return 'primary';
  return 'warning';
}

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

  return (
    <Box sx={{ p: 3, maxWidth: 1400, margin: '0 auto' }}>
      {/* Header & Filter Controls */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'flex-start', md: 'center' },
          mb: 3,
          gap: 2,
        }}
      >
        <Box>
          <Typography variant="h4" fontWeight="bold" gutterBottom>
            Team Performance Dashboard
          </Typography>
          <Typography variant="body2" color="text.secondary">
            CMP-PERF.02.1 — Operational activity, conversion outcomes, and target achievement.
          </Typography>
        </Box>

        <Stack direction="row" spacing={2} alignItems="center">
          <FormControl size="small" sx={{ minWidth: 150 }}>
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
            sx={{ width: 170 }}
          />

          {filters.branchId && (
            <Button size="small" variant="outlined" onClick={clearDrilldown}>
              Reset Scope
            </Button>
          )}

          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => refetch()}
            disabled={isLoading}
          >
            Refresh
          </Button>
        </Stack>
      </Box>

      {/* Loading & Error States */}
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
        <Stack spacing={3}>
          {/* Summary KPI Cards */}
          <Grid container spacing={2}>
            {/* 1. Lead Intake & Target */}
            <Grid item xs={12} sm={6} md={3}>
              <Card sx={{ height: '100%', boxShadow: 2 }}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography color="text.secondary" variant="body2" fontWeight="600">
                      LEAD INTAKE
                    </Typography>
                    <PeopleIcon color="primary" fontSize="small" />
                  </Stack>
                  <Typography variant="h4" fontWeight="bold" sx={{ my: 1 }}>
                    {dashboard.summary.leads.actual.toLocaleString()}
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      Target:{' '}
                      {dashboard.summary.leads.target !== null
                        ? dashboard.summary.leads.target.toLocaleString()
                        : 'None'}
                    </Typography>
                    {dashboard.summary.leads.achievementPercentage !== null && (
                      <Chip
                        size="small"
                        label={`${dashboard.summary.leads.achievementPercentage}%`}
                        color={getAchievementColor(dashboard.summary.leads.achievementPercentage)}
                      />
                    )}
                  </Stack>
                  {dashboard.summary.leads.achievementPercentage !== null && (
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(dashboard.summary.leads.achievementPercentage, 100)}
                      color={getAchievementColor(dashboard.summary.leads.achievementPercentage)}
                      sx={{ height: 6, borderRadius: 3 }}
                    />
                  )}
                </CardContent>
              </Card>
            </Grid>

            {/* 2. Sanctions */}
            <Grid item xs={12} sm={6} md={3}>
              <Card sx={{ height: '100%', boxShadow: 2 }}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography color="text.secondary" variant="body2" fontWeight="600">
                      SANCTIONS ISSUED
                    </Typography>
                    <CheckCircleIcon color="success" fontSize="small" />
                  </Stack>
                  <Typography variant="h4" fontWeight="bold" sx={{ my: 1 }}>
                    {dashboard.summary.sanctions.count}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Value: {formatCurrency(dashboard.summary.sanctions.amount)}
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="caption" color="text.secondary">
                      Target:{' '}
                      {dashboard.summary.sanctions.targetCount !== null
                        ? dashboard.summary.sanctions.targetCount
                        : 'None'}
                    </Typography>
                    {dashboard.summary.sanctions.achievementPercentage !== null && (
                      <Chip
                        size="small"
                        label={`${dashboard.summary.sanctions.achievementPercentage}%`}
                        color={getAchievementColor(dashboard.summary.sanctions.achievementPercentage)}
                      />
                    )}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>

            {/* 3. Disbursements */}
            <Grid item xs={12} sm={6} md={3}>
              <Card sx={{ height: '100%', boxShadow: 2 }}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography color="text.secondary" variant="body2" fontWeight="600">
                      DISBURSEMENTS
                    </Typography>
                    <AccountBalanceIcon color="warning" fontSize="small" />
                  </Stack>
                  <Typography variant="h4" fontWeight="bold" sx={{ my: 1 }}>
                    {formatCurrency(dashboard.summary.disbursements.amount)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Tranches: {dashboard.summary.disbursements.count}
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      Target:{' '}
                      {dashboard.summary.disbursements.targetAmount !== null
                        ? formatCurrency(dashboard.summary.disbursements.targetAmount)
                        : 'None'}
                    </Typography>
                    {dashboard.summary.disbursements.achievementPercentage !== null && (
                      <Chip
                        size="small"
                        label={`${dashboard.summary.disbursements.achievementPercentage}%`}
                        color={getAchievementColor(dashboard.summary.disbursements.achievementPercentage)}
                      />
                    )}
                  </Stack>
                  {dashboard.summary.disbursements.achievementPercentage !== null && (
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(dashboard.summary.disbursements.achievementPercentage, 100)}
                      color={getAchievementColor(dashboard.summary.disbursements.achievementPercentage)}
                      sx={{ height: 6, borderRadius: 3 }}
                    />
                  )}
                </CardContent>
              </Card>
            </Grid>

            {/* 4. Efficiency & Conversion */}
            <Grid item xs={12} sm={6} md={3}>
              <Card sx={{ height: '100%', boxShadow: 2 }}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography color="text.secondary" variant="body2" fontWeight="600">
                      LEAD CONVERSION RATE
                    </Typography>
                    <TrendingUpIcon color="info" fontSize="small" />
                  </Stack>
                  <Typography variant="h4" fontWeight="bold" sx={{ my: 1 }}>
                    {dashboard.summary.conversionRate}%
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Total Activities: {dashboard.summary.activityCount}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Intake to Application conversion efficiency
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Activity-versus-Outcome Funnel */}
          <Paper sx={{ p: 3, boxShadow: 2 }}>
            <Typography variant="h6" fontWeight="bold" gutterBottom>
              Activity-versus-Outcome Conversion Funnel
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Stage-by-stage progression from initial lead intake to disbursement release.
            </Typography>

            <Grid container spacing={2}>
              {dashboard.funnel.map((step, idx) => (
                <Grid item xs={12} sm={6} md={2.4} key={step.stage}>
                  <Card
                    variant="outlined"
                    sx={{
                      p: 2,
                      textAlign: 'center',
                      bgcolor: idx === 0 ? 'action.hover' : 'background.paper',
                    }}
                  >
                    <Typography variant="caption" color="text.secondary" fontWeight="bold">
                      STAGE {idx + 1}
                    </Typography>
                    <Typography variant="subtitle2" fontWeight="600" sx={{ my: 0.5 }}>
                      {step.stage}
                    </Typography>
                    <Typography variant="h5" fontWeight="bold" color="primary.main">
                      {step.count.toLocaleString()}
                    </Typography>
                    <Divider sx={{ my: 1 }} />
                    <Typography variant="caption" color="text.secondary">
                      {idx === 0 ? 'Baseline' : `${step.rate}% from prev`}
                    </Typography>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Paper>

          {/* Dimensional Breakdown Table */}
          <Paper sx={{ p: 3, boxShadow: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Box>
                <Typography variant="h6" fontWeight="bold">
                  Dimensional Performance Breakdown
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Target versus actual comparisons across branches and teams.
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                As of: {new Date(dashboard.asOf).toLocaleString()}
              </Typography>
            </Box>

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell sx={{ fontWeight: 'bold' }}>Dimension</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Entity Name</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                      Leads
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                      Sanctions
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                      Disbursed Amount
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                      Target Amount
                    </TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>
                      Achievement
                    </TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>
                      Action
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {dashboard.breakdown.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} align="center" sx={{ py: 3 }}>
                        <Typography variant="body2" color="text.secondary">
                          No performance data found for the selected period and filters.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    dashboard.breakdown.map((row) => (
                      <TableRow key={row.dimensionId} hover>
                        <TableCell>
                          <Chip size="small" label={row.dimensionType} variant="outlined" />
                        </TableCell>
                        <TableCell sx={{ fontWeight: 500 }}>{row.dimensionName}</TableCell>
                        <TableCell align="right">{row.leadCount}</TableCell>
                        <TableCell align="right">{row.sanctionCount}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          {formatCurrency(row.disbursementAmount)}
                        </TableCell>
                        <TableCell align="right" color="text.secondary">
                          {row.disbursementTarget !== null ? formatCurrency(row.disbursementTarget) : '—'}
                        </TableCell>
                        <TableCell align="center">
                          {row.achievementPercentage !== null ? (
                            <Chip
                              size="small"
                              label={`${row.achievementPercentage}%`}
                              color={getAchievementColor(row.achievementPercentage)}
                            />
                          ) : (
                            <Tooltip title="No approved target exists for this slice">
                              <Typography variant="caption" color="text.secondary">
                                —
                              </Typography>
                            </Tooltip>
                          )}
                        </TableCell>
                        <TableCell align="center">
                          {row.dimensionType === 'BRANCH' ? (
                            <Button
                              size="small"
                              variant="text"
                              onClick={() => handleBranchFilter(row.dimensionId)}
                            >
                              Drill Down
                            </Button>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              User
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Stack>
      )}
    </Box>
  );
}
