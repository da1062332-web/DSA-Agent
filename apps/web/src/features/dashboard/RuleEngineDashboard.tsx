import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Grid,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useMe } from '../../api/useMe';
import { Can } from '../../shell/Can';
import {
  fetchDecisionDefinitions,
  fetchDecisionRecords,
  fetchRuleSets,
} from '../rules/api';
import type { RuleSetResponse } from '../rules/types';
import {
  DashboardDateFilter,
  type DateRangeScope,
  KpiMetricCard,
  PipelineFunnelChart,
  TaskWorkQueue,
  type TaskWorkQueueItem,
} from './components';

interface RuleEngineDashboardProps {
  mode?: 'author' | 'approver';
}

export function RuleEngineDashboard({ mode }: RuleEngineDashboardProps) {
  const me = useMe();
  const [dateScope, setDateScope] = useState<DateRangeScope>('month');

  // Determine role perspective
  const userRoles = me.data?.roles ?? [];
  const isApprover =
    mode === 'approver' ||
    userRoles.includes('ROLE-RULE-APPROVER') ||
    me.data?.grants?.some((g) => g.code === 'rule.approve');

  // Fetch Rule Sets
  const {
    data: ruleSetsData,
    isLoading: rulesLoading,
    isError: rulesError,
  } = useQuery({
    queryKey: ['rule-engine-rule-sets', dateScope],
    queryFn: () => fetchRuleSets({ limit: 100 }),
  });

  // Fetch Decision Definitions
  const {
    data: definitionsData,
    isLoading: defsLoading,
    isError: defsError,
  } = useQuery({
    queryKey: ['rule-engine-decision-definitions'],
    queryFn: () => fetchDecisionDefinitions(),
  });

  // Fetch Decision Records (Audit / evaluation logs)
  const {
    data: recordsData,
    isLoading: recordsLoading,
    isError: recordsError,
  } = useQuery({
    queryKey: ['rule-engine-decision-records', dateScope],
    queryFn: () => fetchDecisionRecords({ limit: 50 }),
  });

  const ruleSets: RuleSetResponse[] = ruleSetsData?.data ?? [];
  const definitions = definitionsData ?? [];
  const decisionRecords = recordsData?.data ?? [];

  // Metrics
  const activeCount = ruleSets.filter((r) => r.status === 'ACTIVE').length;
  const archivedCount = ruleSets.filter((r) => r.status === 'ARCHIVED').length;
  const draftVersionsTotal = ruleSets.reduce((sum, r) => sum + (r.draftVersionCount ?? 0), 0);

  // Work queue items for pending rule activities
  const queueItems: TaskWorkQueueItem[] = ruleSets
    .filter((r) => (isApprover ? r.status === 'ACTIVE' : (r.draftVersionCount ?? 0) > 0))
    .slice(0, 8)
    .map((r) => ({
      id: r.id,
      title: `${r.name} (${r.decisionKey})`,
      category: r.scopeType,
      priority: isApprover ? 'HIGH' : 'MEDIUM',
      dueDate: r.updatedAt,
      entityLink: {
        label: r.decisionKey,
        to: `/rules/${r.id}`,
      },
      actionLabel: isApprover ? 'Review & Govern' : 'Edit Rule Set',
    }));

  const testId = isApprover ? 'rule-approver-dashboard' : 'rule-author-dashboard';

  return (
    <Container maxWidth="xl" sx={{ py: 4 }} data-testid={testId}>
      {/* SOD-09 Dual Control Governance Banner */}
      <Alert severity={isApprover ? 'warning' : 'info'} sx={{ mb: 3 }}>
        {isApprover
          ? 'Dual-Control Governance (SOD-09): Rule approvers cannot approve rule versions they authored. Production deployments require step-up MFA verification.'
          : 'Authoring Policy: Versions must pass syntax validation and test simulations before submitting for dual-control approval.'}
      </Alert>

      {/* Header & Controls */}
      <Box
        sx={{
          mb: 4,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2,
        }}
      >
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            {isApprover ? 'Rule Engine Approver Portal' : 'Business Rule Authoring Studio'}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {isApprover
              ? 'Review business rule changes, evaluate simulation test results, and govern production deployment.'
              : 'Design eligibility rule sets, run test simulations, and submit versions for governance review.'}
          </Typography>
        </Box>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" gap={1}>
          <DashboardDateFilter value={dateScope} onChange={setDateScope} />
          <Can action="rule.author">
            <Button variant="contained" color="primary" component={RouterLink} to="/rules">
              Rules Studio
            </Button>
          </Can>
          <Button variant="outlined" component={RouterLink} to="/decisions">
            Decision Definitions
          </Button>
          {isApprover && (
            <Can action="audit.read">
              <Button variant="outlined" component={RouterLink} to="/audit">
                Audit Trail
              </Button>
            </Can>
          )}
        </Stack>
      </Box>

      {/* KPI Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title={isApprover ? 'Active Production Rules' : 'Draft Versions'}
            value={isApprover ? activeCount : draftVersionsTotal}
            subtitle={isApprover ? 'Evaluating live application policies' : 'Drafts in authoring pipeline'}
            isLoading={rulesLoading}
            isError={rulesError}
            to="/rules"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Total Rule Sets"
            value={ruleSets.length}
            subtitle="Configured tenant decision sets"
            isLoading={rulesLoading}
            isError={rulesError}
            to="/rules"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Decision Definitions"
            value={definitions.length}
            subtitle="Registered decision schemas"
            isLoading={defsLoading}
            isError={defsError}
            to="/decisions"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title={isApprover ? 'Archived Rule Sets' : 'Evaluation Logs'}
            value={isApprover ? archivedCount : decisionRecords.length}
            subtitle={isApprover ? 'Historical retired rule sets' : 'Decisions logged this period'}
            isLoading={isApprover ? rulesLoading : recordsLoading}
            isError={isApprover ? rulesError : recordsError}
            to={isApprover ? '/rules' : '/decisions'}
          />
        </Grid>
      </Grid>

      {/* Funnel Chart & Work Queue */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} md={7}>
          <PipelineFunnelChart
            title="Rule Lifecycle Pipeline"
            stages={[
              { key: 'drafts', label: 'Draft Versions', count: draftVersionsTotal, color: '#f59e0b' },
              { key: 'active', label: 'Active Rule Sets', count: activeCount, color: '#10b981' },
              { key: 'archived', label: 'Archived Rules', count: archivedCount, color: '#6b7280' },
              { key: 'records', label: 'Evaluated Records', count: decisionRecords.length, color: '#6366f1' },
            ]}
          />
        </Grid>
        <Grid item xs={12} md={5}>
          <TaskWorkQueue
            title={isApprover ? 'Governed Rules Queue' : 'Authoring Backlog'}
            items={queueItems}
            isLoading={rulesLoading}
            emptyMessage={
              isApprover
                ? 'No rule sets currently awaiting approval.'
                : 'No pending draft versions require action.'
            }
            viewAllTo="/rules"
          />
        </Grid>
      </Grid>

      {/* Rule Sets Overview Table */}
      <Paper sx={{ p: 3, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={600}>
              Tenant Business Rule Sets
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Catalog of decision tables, eligibility matrices, and scoring criteria
            </Typography>
          </Box>
          <Button size="small" component={RouterLink} to="/rules">
            View All Rules
          </Button>
        </Box>
        {rulesError && <Alert severity="error">Unable to load rule sets.</Alert>}
        {rulesLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : ruleSets.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
            No rule sets configured yet. Create one to begin.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Rule Set Name</TableCell>
                  <TableCell>Decision Key</TableCell>
                  <TableCell>Scope</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Drafts</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {ruleSets.slice(0, 10).map((r: RuleSetResponse) => (
                  <TableRow key={r.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{r.name}</TableCell>
                    <TableCell>
                      <code>{r.decisionKey}</code>
                    </TableCell>
                    <TableCell>{r.scopeType}</TableCell>
                    <TableCell>
                      <Chip
                        label={r.status}
                        size="small"
                        color={r.status === 'ACTIVE' ? 'success' : 'default'}
                      />
                    </TableCell>
                    <TableCell>{r.draftVersionCount ?? 0}</TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant="outlined"
                        component={RouterLink}
                        to={`/rules/${r.id}`}
                      >
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Container>
  );
}
