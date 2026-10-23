import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
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
    <Box sx={{ width: '100%', py: 1 }} data-testid={testId}>
      {/* SOD-09 Dual Control Governance Banner */}
      <Alert severity={isApprover ? 'warning' : 'info'} sx={{ mb: 2.5, borderRadius: 2.5, fontWeight: 500 }}>
        {isApprover
          ? 'Dual-Control Governance (SOD-09): Rule approvers cannot approve rule versions they authored. Production deployments require step-up MFA verification.'
          : 'Authoring Policy: Versions must pass syntax validation and test simulations before submitting for dual-control approval.'}
      </Alert>

      {/* Executive Command Header */}
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2, sm: 2.5 },
          mb: 2.5,
          borderRadius: 2.5,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2,
        }}
      >
        <Box>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="h5" fontWeight={800} sx={{ letterSpacing: '-0.02em' }}>
              {isApprover ? 'Rule Engine Approver Portal' : 'Business Rule Authoring Studio'}
            </Typography>
            <Chip
              label={isApprover ? 'BRE Governance' : 'BRE Author'}
              color="primary"
              size="small"
              sx={{ fontWeight: 700, fontSize: 11 }}
            />
            <Chip
              label="● Evaluation Active"
              color="success"
              size="small"
              variant="outlined"
              sx={{ fontWeight: 600, fontSize: 11 }}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {isApprover
              ? 'Review business rule changes, evaluate simulation test results, and govern production deployment.'
              : 'Design eligibility rule sets, run test simulations, and submit versions for governance review.'}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
          <DashboardDateFilter value={dateScope} onChange={setDateScope} />
          <Can action="rule.author">
            <Button variant="contained" color="primary" component={RouterLink} to="/rules" sx={{ fontWeight: 700 }}>
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
      </Paper>

      {/* KPI Overview Cards */}
      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
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

      {/* Middle Row: Balanced Funnel & Work Queue */}
      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
        <Grid item xs={12} lg={7}>
          <PipelineFunnelChart
            title="Rule Lifecycle Pipeline"
            stages={[
              { key: 'drafts', label: 'Draft Versions', count: draftVersionsTotal, color: '#f59e0b' },
              { key: 'active', label: 'Active Rule Sets', count: activeCount, color: '#10b981' },
              { key: 'archived', label: 'Archived Rules', count: archivedCount, color: '#6b7280' },
              { key: 'records', label: 'Evaluated Records', count: decisionRecords.length, color: '#1d5fd1' },
            ]}
          />
        </Grid>
        <Grid item xs={12} lg={5}>
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

      {/* Full-Width Operational Table: Tenant Business Rule Sets */}
      <Paper
        elevation={0}
        sx={{
          p: 2.5,
          borderRadius: 2.5,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>
              Tenant Business Rule Sets
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Catalog of decision tables, eligibility matrices, and scoring criteria
            </Typography>
          </Box>
          <Button size="small" component={RouterLink} to="/rules" sx={{ fontWeight: 600 }}>
            View All Rules &rarr;
          </Button>
        </Box>
        {rulesError && <Alert severity="error">Unable to load rule sets.</Alert>}
        {rulesLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress size={32} />
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
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Rule Set Name</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Decision Key</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Scope</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Drafts</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {ruleSets.slice(0, 8).map((r: RuleSetResponse) => (
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
                        sx={{ height: 22, fontSize: 11, fontWeight: 700 }}
                      />
                    </TableCell>
                    <TableCell>{r.draftVersionCount ?? 0}</TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant="outlined"
                        component={RouterLink}
                        to={`/rules/${r.id}`}
                        sx={{ fontSize: 11, py: 0.25, px: 1.25, height: 26 }}
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
    </Box>
  );
}
