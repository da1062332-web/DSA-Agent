// apps/web/src/features/performance/LeaderboardPage.tsx — CMP-PERF.03.1
import React, { useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  SvgIcon,
  type SvgIconProps,
} from '@mui/material';
import { useLeaderboardDashboard } from './api';
import type { DashboardFilterState } from './types';

function WarningAmberIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 5.99L19.53 19H4.47L12 5.99M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z" />
    </SvgIcon>
  );
}

function ErrorOutlineIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M11 15h2v2h-2zm0-8h2v6h-2zm1-5C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
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

export function LeaderboardPage() {
  const [filters, setFilters] = useState<DashboardFilterState>({
    period: '2026-10',
  });

  const { data: leaderboard, isLoading, isError, error } =
    useLeaderboardDashboard(filters);

  return (
    <Box sx={{ p: 3, maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 3,
        }}
      >
        <Box>
          <Typography variant="h4" fontWeight="bold" gutterBottom>
            Performance Leaderboards
          </Typography>
          <Typography variant="body2" color="text.secondary">
            CMP-PERF.03.1 — Balanced scorecard rankings and quality guardrails.
          </Typography>
        </Box>

        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel id="leaderboard-period-label">Period</InputLabel>
          <Select
            labelId="leaderboard-period-label"
            value={filters.period}
            label="Period"
            onChange={(e) => setFilters({ ...filters, period: e.target.value })}
          >
            <MenuItem value="2026-10">October 2026</MenuItem>
            <MenuItem value="2026-09">September 2026</MenuItem>
            <MenuItem value="2026-Q4">2026 Q4 (Oct - Dec)</MenuItem>
            <MenuItem value="2026-Q3">2026 Q3 (Jul - Sep)</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {/* Governance & Business-Rule Blocker Banner */}
      <Alert
        severity="warning"
        icon={<WarningAmberIcon fontSize="large" />}
        sx={{ mb: 4, borderRadius: 2 }}
      >
        <AlertTitle sx={{ fontWeight: 'bold', fontSize: '1.05rem' }}>
          Competitive Ranking Calculation Blocked Pending Business-Rule Sign-Off
        </AlertTitle>
        <Typography variant="body2" sx={{ mb: 1 }}>
          In accordance with the Master Implementation Prompt and NBFC domain governance,
          leaderboard scoring formulas, weights, and quality guardrails must not be invented.
          Participant operational volumes are tracked below, but competitive scores and ordinal
          ranks remain blocked until product leadership approves the following 9 governance
          decisions:
        </Typography>

        <List dense sx={{ pl: 1 }}>
          {leaderboard?.unresolvedDecisions ? (
            leaderboard.unresolvedDecisions.map((decision, idx) => (
              <ListItem key={idx} disableGutters sx={{ py: 0.2 }}>
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <ErrorOutlineIcon color="warning" fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={<Typography variant="caption">{decision}</Typography>}
                />
              </ListItem>
            ))
          ) : (
            <ListItem disableGutters>
              <ListItemText
                primary={
                  <Typography variant="caption">
                    Loading unresolved business decisions...
                  </Typography>
                }
              />
            </ListItem>
          )}
        </List>
      </Alert>

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {isError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error instanceof Error ? error.message : 'Failed to load leaderboard data.'}
        </Alert>
      )}

      {/* Participant Operational Metrics Overview Table */}
      {leaderboard && (
        <Paper sx={{ p: 3, boxShadow: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Box>
              <Typography variant="h6" fontWeight="bold">
                Participant Operational Activity (Unranked)
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Operational records for eligible loan officers during period {leaderboard.period}.
              </Typography>
            </Box>
            <Chip
              label="Ranking Status: Blocked"
              color="warning"
              variant="outlined"
              size="small"
            />
          </Box>

          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'action.hover' }}>
                  <TableCell sx={{ fontWeight: 'bold' }}>Rank</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Participant</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Branch</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                    Lead Volume
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                    Sanctions
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                    Disbursed Amount
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                    Conversion %
                  </TableCell>
                  <TableCell align="center" sx={{ fontWeight: 'bold' }}>
                    Calculated Score
                  </TableCell>
                  <TableCell align="center" sx={{ fontWeight: 'bold' }}>
                    Guardrail
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {leaderboard.entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} align="center" sx={{ py: 4 }}>
                      <Typography variant="body2" color="text.secondary">
                        No active participants recorded for the selected period.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  leaderboard.entries.map((entry) => (
                    <TableRow key={entry.entityId} hover>
                      <TableCell>
                        <Chip
                          size="small"
                          label="Pending"
                          variant="outlined"
                          sx={{ color: 'text.secondary', borderStyle: 'dashed' }}
                        />
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{entry.entityName}</TableCell>
                      <TableCell color="text.secondary">
                        {entry.branchName || 'Unassigned'}
                      </TableCell>
                      <TableCell align="right">{entry.volume}</TableCell>
                      <TableCell align="right">{entry.sanctionCount}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        {formatCurrency(entry.disbursementAmount)}
                      </TableCell>
                      <TableCell align="right">{entry.conversionRate}%</TableCell>
                      <TableCell align="center">
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ fontStyle: 'italic' }}
                        >
                          — (Pending Formula)
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Chip
                          size="small"
                          label={entry.guardrailStatus}
                          color={entry.guardrailStatus === 'NORMAL' ? 'success' : 'warning'}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Box>
  );
}
