// apps/web/src/features/performance/LeaderboardPage.tsx — CMP-PERF.03.1
import React, { useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  Typography,
  SvgIcon,
  type SvgIconProps,
} from '@mui/material';
import { DataTable, DetailCard, PageHeader, StatusBadge } from '../../ui';
import type { ColumnDef } from '../../ui';
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

function ExpandMoreIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" />
    </SvgIcon>
  );
}

function ExpandLessIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z" />
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

type LeaderboardEntry = NonNullable<NonNullable<ReturnType<typeof useLeaderboardDashboard>['data']>['entries']>[number];

export function LeaderboardPage() {
  const [filters, setFilters] = useState<DashboardFilterState>({
    period: '2026-10',
  });
  const [isBannerExpanded, setIsBannerExpanded] = useState<boolean>(false);

  const { data: leaderboard, isLoading, isError, error } = useLeaderboardDashboard(filters);

  const columns: ColumnDef<LeaderboardEntry>[] = [
    {
      id: 'rank',
      header: 'Rank',
      render: () => (
        <Chip size="small" label="Pending" variant="outlined" sx={{ color: 'text.secondary', borderStyle: 'dashed' }} />
      ),
    },
    {
      id: 'participant',
      header: 'Participant',
      render: (row) => <Typography sx={{ fontWeight: 600 }}>{row.entityName}</Typography>,
    },
    {
      id: 'branch',
      header: 'Branch',
      render: (row) => (
        <Typography color="text.secondary">{row.branchName || 'Unassigned'}</Typography>
      ),
    },
    { id: 'volume', header: 'Lead Volume', align: 'right', render: (row) => row.volume },
    { id: 'sanctions', header: 'Sanctions', align: 'right', render: (row) => row.sanctionCount },
    {
      id: 'disbursed',
      header: 'Disbursed Amount',
      align: 'right',
      render: (row) => <Typography sx={{ fontWeight: 600 }}>{formatCurrency(row.disbursementAmount)}</Typography>,
    },
    { id: 'conversion', header: 'Conversion %', align: 'right', render: (row) => `${row.conversionRate}%` },
    {
      id: 'score',
      header: 'Calculated Score',
      align: 'center',
      render: () => (
        <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
          — (Pending Formula)
        </Typography>
      ),
    },
    {
      id: 'guardrail',
      header: 'Guardrail',
      align: 'center',
      render: (row) => (
        <StatusBadge
          label={row.guardrailStatus}
          status={row.guardrailStatus === 'NORMAL' ? 'success' : 'warning'}
        />
      ),
    },
  ];

  return (
    <Box sx={{ py: 3, maxWidth: 1400, margin: '0 auto' }}>
      <PageHeader
        title="Performance Leaderboards"
        subtitle="CMP-PERF.03.1 — Balanced scorecard rankings and quality guardrails."
        actions={
          <FormControl size="small" sx={{ minWidth: 170 }}>
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
        }
      />

      {/* Governance & Business-Rule Blocker Banner (Collapsible) */}
      <Alert
        severity="warning"
        icon={<WarningAmberIcon fontSize="large" />}
        sx={{
          mb: 3,
          borderRadius: 2.5,
          alignItems: 'flex-start',
          '& .MuiAlert-message': { width: '100%' },
        }}
        action={
          <Button
            size="small"
            color="warning"
            variant="outlined"
            onClick={() => setIsBannerExpanded(!isBannerExpanded)}
            endIcon={isBannerExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '0.8rem',
              whiteSpace: 'nowrap',
              mt: { xs: 1, sm: 0 },
            }}
          >
            {isBannerExpanded
              ? 'Hide Governance Decisions'
              : `View ${leaderboard?.unresolvedDecisions?.length ?? 9} Decisions`}
          </Button>
        }
      >
        <AlertTitle sx={{ fontWeight: 'bold', fontSize: '1.02rem', mb: 0.5 }}>
          Competitive Ranking Calculation Blocked Pending Business-Rule Sign-Off
        </AlertTitle>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          In accordance with the Master Implementation Prompt and NBFC domain governance,
          leaderboard scoring formulas, weights, and quality guardrails must not be invented.
          Participant operational volumes are tracked below, but competitive scores and ordinal
          ranks remain blocked until product leadership approves the following 9 governance
          decisions:
        </Typography>

        <Collapse in={isBannerExpanded}>
          <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px dashed rgba(237, 108, 2, 0.35)' }}>
            <List dense sx={{ pl: 0.5 }}>
              {leaderboard?.unresolvedDecisions ? (
                leaderboard.unresolvedDecisions.map((decision, idx) => (
                  <ListItem key={idx} disableGutters sx={{ py: 0.2 }}>
                    <ListItemIcon sx={{ minWidth: 28 }}>
                      <ErrorOutlineIcon color="warning" fontSize="small" />
                    </ListItemIcon>
                    <ListItemText primary={<Typography variant="caption">{decision}</Typography>} />
                  </ListItem>
                ))
              ) : (
                <ListItem disableGutters>
                  <ListItemText
                    primary={<Typography variant="caption">Loading unresolved business decisions...</Typography>}
                  />
                </ListItem>
              )}
            </List>
          </Box>
        </Collapse>
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

      {/* Participant Operational Metrics Overview */}
      {leaderboard && (
        <DetailCard
          title="Participant Operational Activity (Unranked)"
          subtitle={`Operational records for eligible loan officers during period ${leaderboard.period}.`}
          badge={<Chip label="Ranking Status: Blocked" color="warning" variant="outlined" size="small" />}
        >
          <DataTable<LeaderboardEntry>
            columns={columns}
            data={leaderboard.entries}
            keyExtractor={(row) => row.entityId}
            emptyMessage="No active participants recorded for the selected period."
          />
        </DetailCard>
      )}
    </Box>
  );
}
