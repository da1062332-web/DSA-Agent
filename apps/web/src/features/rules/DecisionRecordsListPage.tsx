// apps/web/src/features/rules/DecisionRecordsListPage.tsx — owner: Developer 6 (Module 23: Business Rule Engine)
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchDecisionRecords } from './api';
import { ApplicationName, CustomerName, LeadName } from '../../shell/display';
import {
  DataTable,
  FilterToolbar,
  PageHeader,
  StatCard,
  StatCardGrid,
  StatusBadge,
  type ColumnDef,
} from '../../ui';
import type { DecisionKey, DecisionRecordResponse } from './types';
import { NotSet } from '../../ui/NotSet';

const MVP_DECISION_KEYS: DecisionKey[] = [
  'DK-lead.duplicate',
  'DK-customer.duplicate',
  'DK-lead.assignment',
  'DK-sla.target',
  'DK-document.requirements',
  'DK-application.completeness',
];

export function DecisionRecordsListPage() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<DecisionRecordResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [decisionFilter, setDecisionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const loadRecords = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchDecisionRecords({
        decisionKey: decisionFilter || undefined,
        status: statusFilter || undefined,
      });
      setRecords(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load decision execution records');
    } finally {
      setLoading(false);
    }
  }, [decisionFilter, statusFilter]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const recordColumns: ColumnDef<DecisionRecordResponse>[] = [
    {
      id: 'decisionKey',
      header: 'Decision Key',
      accessor: (r) => (
        <Chip size="small" label={r.decisionKey} color="primary" variant="outlined" />
      ),
    },
    {
      id: 'subject',
      header: 'Subject',
      accessor: (r) => {
        if (!r.subjectType || !r.subjectId) return <NotSet />;
        let subjectNode = null;
        if (r.subjectType === 'LEAD') {
          subjectNode = <LeadName id={r.subjectId} linkToLead />;
        } else if (r.subjectType === 'CUSTOMER') {
          subjectNode = <CustomerName id={r.subjectId} linkToProfile />;
        } else if (r.subjectType === 'APPLICATION' || r.subjectType === 'LOAN_APPLICATION') {
          subjectNode = <ApplicationName id={r.subjectId} linkToApp />;
        }

        return (
          <Box>
            {subjectNode && (
              <Box sx={{ fontWeight: 600, color: 'text.primary', mb: 0.25 }}>
                {subjectNode}
              </Box>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
              {r.subjectType} • {r.subjectId}
            </Typography>
          </Box>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (r) => (
        <StatusBadge status={r.status} />
      ),
    },
    {
      id: 'matchedRules',
      header: 'Matched Rules',
      accessor: (r) => (
        <Typography variant="body2">
          {r.matchedRuleUids.length > 0 ? r.matchedRuleUids.join(', ') : 'None'}
        </Typography>
      ),
    },
    {
      id: 'duration',
      header: 'Duration',
      accessor: (r) => (
        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
          {r.durationUs ? `${r.durationUs} µs` : <NotSet />}
        </Typography>
      ),
    },
    {
      id: 'evaluatedAt',
      header: 'Evaluated At',
      accessor: (r) => (
        <Typography variant="caption" color="text.secondary">
          {new Date(r.evaluationTime).toLocaleString()}
        </Typography>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      accessor: (r) => (
        <Button
          size="small"
          variant="outlined"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/decisions/${r.id}`);
          }}
          sx={{ textTransform: 'none', borderRadius: 1.5 }}
        >
          View Trace
        </Button>
      ),
    },
  ];

  return (
    <Container maxWidth={false} disableGutters>
      <PageHeader
        title="Decision Execution Audit Records"
        subtitle="Immutable audit log of all live decisions evaluated by the rule engine"
        backTo="/rules"
      />

      <StatCardGrid columns={{ xs: 1, sm: 3, md: 3 }} sx={{ mb: 3 }}>
        <StatCard
          title="Total Evaluated"
          value={records.length}
          subtext="Captured decision runs"
        />
        <StatCard
          title="Successful Matches"
          value={records.filter((r) => r.status === 'OK').length}
          subtext="Executed business rules"
          colorVariant="success"
        />
        <StatCard
          title="Errors / No-Matches"
          value={records.filter((r) => r.status === 'NO_MATCH' || r.status === 'ERROR').length}
          subtext="Fallbacks triggered"
          colorVariant="warning"
        />
      </StatCardGrid>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Filter Toolbar */}
      <FilterToolbar
        actions={
          <Button
            variant="outlined"
            onClick={() => {
              setDecisionFilter('');
              setStatusFilter('');
            }}
          >
            Reset Filters
          </Button>
        }
        filters={
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel id="decision-filter-label">Decision Key</InputLabel>
              <Select
                labelId="decision-filter-label"
                value={decisionFilter}
                label="Decision Key"
                onChange={(e) => setDecisionFilter(e.target.value)}
              >
                <MenuItem value="">
                  <em>All Decisions</em>
                </MenuItem>
                {MVP_DECISION_KEYS.map((k) => (
                  <MenuItem key={k} value={k}>
                    {k}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="status-filter-label">Status</InputLabel>
              <Select
                labelId="status-filter-label"
                value={statusFilter}
                label="Status"
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <MenuItem value="">
                  <em>All Statuses</em>
                </MenuItem>
                <MenuItem value="MATCHED">MATCHED</MenuItem>
                <MenuItem value="NO_MATCH">NO_MATCH</MenuItem>
                <MenuItem value="ERROR">ERROR</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        }
      />

      <DataTable<DecisionRecordResponse>
        columns={recordColumns}
        data={records}
        loading={loading}
        emptyTitle="No decision execution records found"
        onRowClick={(r) => navigate(`/decisions/${r.id}`)}
      />
    </Container>
  );
}
