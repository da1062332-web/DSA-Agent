// apps/web/src/features/rules/RulesListPage.tsx — owner: Developer 6 (Module 23: Business Rule Engine)
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRuleSet, fetchDecisionDefinitions, fetchRuleSets } from './api';
import {
  DataTable,
  FilterToolbar,
  PageHeader,
  StatCard,
  StatCardGrid,
  StatusBadge,
  type ColumnDef,
} from '../../ui';
import type { DecisionDefinitionResponse, DecisionKey, RuleSetResponse, ScopeType } from './types';

const MVP_DECISION_KEYS: DecisionKey[] = [
  'DK-lead.duplicate',
  'DK-customer.duplicate',
  'DK-lead.assignment',
  'DK-sla.target',
  'DK-document.requirements',
  'DK-application.completeness',
  'DK-application.eligibility',
];

export function RulesListPage() {
  const navigate = useNavigate();
  const [tabIndex, setTabIndex] = useState(0);

  // Rule sets state
  const [ruleSets, setRuleSets] = useState<RuleSetResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [decisionFilter, setDecisionFilter] = useState<string>('');
  const [scopeFilter, setScopeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Registry state
  const [definitions, setDefinitions] = useState<DecisionDefinitionResponse[]>([]);
  const [loadingDefs, setLoadingDefs] = useState(false);

  // Create modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [newDecisionKey, setNewDecisionKey] = useState<DecisionKey>('DK-lead.assignment');
  const [newScopeType, setNewScopeType] = useState<ScopeType>('TENANT_DEFAULT');
  const [newScopeRef, setNewScopeRef] = useState('');
  const [newName, setNewName] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadRuleSets = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchRuleSets({
        decisionKey: decisionFilter || undefined,
        scopeType: scopeFilter || undefined,
        status: statusFilter || undefined,
      });
      setRuleSets(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rule sets');
    } finally {
      setLoading(false);
    }
  }, [decisionFilter, scopeFilter, statusFilter]);

  const loadDefinitions = useCallback(async () => {
    try {
      setLoadingDefs(true);
      const res = await fetchDecisionDefinitions();
      setDefinitions(res);
    } catch {
      // non-critical error
    } finally {
      setLoadingDefs(false);
    }
  }, []);

  useEffect(() => {
    loadRuleSets();
  }, [loadRuleSets]);

  useEffect(() => {
    if (tabIndex === 1) {
      loadDefinitions();
    }
  }, [tabIndex, loadDefinitions]);

  const handleCreate = async () => {
    if (!newName.trim()) {
      setCreateError('Rule Set Name is required');
      return;
    }
    try {
      setCreateSubmitting(true);
      setCreateError(null);
      const created = await createRuleSet({
        decisionKey: newDecisionKey,
        scopeType: newScopeType,
        scopeRef: newScopeRef.trim() || undefined,
        name: newName.trim(),
      });
      setCreateOpen(false);
      setNewName('');
      setNewScopeRef('');
      navigate(`/rules/${created.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create rule set');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const ruleColumns: ColumnDef<RuleSetResponse>[] = [
    {
      id: 'name',
      header: 'Rule Set Name',
      accessor: (rs) => (
        <Box>
          <Typography variant="subtitle2" fontWeight={600} color="primary.main">
            {rs.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
            {rs.id}
          </Typography>
        </Box>
      ),
    },
    {
      id: 'decisionKey',
      header: 'Decision Key',
      accessor: (rs) => (
        <Chip size="small" label={rs.decisionKey} variant="outlined" color="primary" />
      ),
    },
    {
      id: 'scope',
      header: 'Scope',
      accessor: (rs) => (
        <Typography variant="body2">
          {rs.scopeType}
          {rs.scopeRef ? ` (${rs.scopeRef})` : ''}
        </Typography>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (rs) => <StatusBadge status={rs.status} />,
    },
    {
      id: 'activeVersion',
      header: 'Active Version',
      accessor: (rs) =>
        rs.activeVersionId ? (
          <Chip
            size="small"
            label={rs.activeVersionId.slice(0, 12) + '...'}
            color="success"
            variant="outlined"
          />
        ) : (
          <Typography variant="caption" color="text.secondary">
            None
          </Typography>
        ),
    },
    {
      id: 'drafts',
      header: 'Open Drafts',
      accessor: (rs) => <Chip size="small" label={`${rs.draftVersionCount ?? 0} draft(s)`} />,
    },
    {
      id: 'updated',
      header: 'Updated',
      accessor: (rs) => (
        <Typography variant="caption" color="text.secondary">
          {new Date(rs.updatedAt).toLocaleDateString()}
        </Typography>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      accessor: (rs) => (
        <Button
          size="small"
          variant="outlined"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/rules/${rs.id}`);
          }}
          sx={{ textTransform: 'none', borderRadius: 1.5 }}
        >
          View Details
        </Button>
      ),
    },
  ];

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <PageHeader
        title="Business Rule Engine"
        subtitle="Manage, author, validate, and simulate decision rule sets and review audit records"
        actions={
          <Stack direction="row" spacing={2}>
            <Button variant="outlined" onClick={() => navigate('/decisions')}>
              View Execution Logs
            </Button>
            <Button variant="contained" onClick={() => setCreateOpen(true)}>
              New Rule Set
            </Button>
          </Stack>
        }
      />

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={tabIndex} onChange={(_, val) => setTabIndex(val)}>
          <Tab label="Rule Sets" />
          <Tab label="Decision Registry" />
        </Tabs>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {tabIndex === 0 && (
        <>
          <StatCardGrid columns={{ xs: 1, sm: 3, md: 3 }} sx={{ mb: 3 }}>
            <StatCard
              title="Total Rule Sets"
              value={ruleSets.length}
              subtext="Configured decision packages"
            />
            <StatCard
              title="Active Rule Sets"
              value={ruleSets.filter((r) => r.status === 'ACTIVE').length}
              subtext="Live operational rules"
              colorVariant="success"
            />
            <StatCard
              title="Open Drafts"
              value={ruleSets.reduce((acc, r) => acc + (r.draftVersionCount ?? 0), 0)}
              subtext="Unpublished revisions"
              colorVariant="warning"
            />
          </StatCardGrid>

          <FilterToolbar
            onReset={() => {
              setDecisionFilter('');
              setScopeFilter('');
              setStatusFilter('');
            }}
            filters={
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} flexWrap="wrap">
                <FormControl size="small" sx={{ minWidth: 200 }}>
                  <InputLabel id="filter-decision-label">Decision Key</InputLabel>
                  <Select
                    labelId="filter-decision-label"
                    value={decisionFilter}
                    label="Decision Key"
                    onChange={(e) => setDecisionFilter(e.target.value)}
                  >
                    <MenuItem value="">
                      <em>All Decision Keys</em>
                    </MenuItem>
                    {MVP_DECISION_KEYS.map((k) => (
                      <MenuItem key={k} value={k}>
                        {k}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 170 }}>
                  <InputLabel id="filter-scope-label">Scope Type</InputLabel>
                  <Select
                    labelId="filter-scope-label"
                    value={scopeFilter}
                    label="Scope Type"
                    onChange={(e) => setScopeFilter(e.target.value)}
                  >
                    <MenuItem value="">
                      <em>All Scopes</em>
                    </MenuItem>
                    <MenuItem value="TENANT_DEFAULT">TENANT_DEFAULT</MenuItem>
                    <MenuItem value="BRANCH">BRANCH</MenuItem>
                    <MenuItem value="LENDER">LENDER</MenuItem>
                    <MenuItem value="PRODUCT_VERSION">PRODUCT_VERSION</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel id="filter-status-label">Status</InputLabel>
                  <Select
                    labelId="filter-status-label"
                    value={statusFilter}
                    label="Status"
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <MenuItem value="">
                      <em>All Statuses</em>
                    </MenuItem>
                    <MenuItem value="ACTIVE">ACTIVE</MenuItem>
                    <MenuItem value="ARCHIVED">ARCHIVED</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
            }
          />

          <DataTable<RuleSetResponse>
            columns={ruleColumns}
            data={ruleSets}
            loading={loading}
            emptyTitle="No rule sets found"
            emptyAction={
              <Button variant="contained" onClick={() => setCreateOpen(true)} sx={{ mt: 2 }}>
                Create First Rule Set
              </Button>
            }
            onRowClick={(rs) => navigate(`/rules/${rs.id}`)}
          />
        </>
      )}

      {tabIndex === 1 && (
        <Box>
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" fontWeight={700} gutterBottom>
              Registered Decision Definitions (Read-Only Global MVP)
            </Typography>
            <Typography variant="body2" color="text.secondary">
              These definitions are platform-managed specifications defining input/output contracts, tier risk,
              hit policies, and fallback policies.
            </Typography>
          </Box>

          {loadingDefs ? (
            <Box display="flex" justifyContent="center" py={8}>
              <CircularProgress />
            </Box>
          ) : (
            <Grid container spacing={3}>
              {definitions.map((def) => (
                <Grid item xs={12} md={6} key={def.key}>
                  <Card
                    variant="outlined"
                    sx={{
                      height: '100%',
                      borderRadius: 2.5,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                      border: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <CardContent>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={1}>
                        <Typography variant="subtitle1" fontWeight={700} color="primary">
                          {def.key}
                        </Typography>
                        <Chip
                          size="small"
                          label={`Tier ${def.tier}`}
                          color={def.tier === 'T1' ? 'error' : def.tier === 'T2' ? 'warning' : 'info'}
                        />
                      </Stack>
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        Registry Version: <strong>{def.registryVersion}</strong>
                      </Typography>
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        Allowed Hit Policies: <strong>{def.allowedHitPolicies.join(', ')}</strong>
                      </Typography>
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        Fallback Policy: <strong>{def.fallbackPolicy}</strong>
                      </Typography>
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        Scope Chain: <strong>{def.scopeChain.join(' → ')}</strong>
                      </Typography>
                      {def.dependencies.length > 0 && (
                        <Box mt={1}>
                          <Typography variant="caption" color="text.secondary" display="block">
                            Dependencies:
                          </Typography>
                          <Stack direction="row" spacing={0.5} mt={0.5} flexWrap="wrap">
                            {def.dependencies.map((d) => (
                              <Chip key={d} size="small" label={d} variant="outlined" />
                            ))}
                          </Stack>
                        </Box>
                      )}
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}
        </Box>
      )}

      {/* Create Rule Set Modal */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create New Rule Set</DialogTitle>
        <DialogContent dividers>
          {createError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {createError}
            </Alert>
          )}
          <Stack spacing={2.5} sx={{ mt: 0.5 }}>
            <FormControl fullWidth required>
              <InputLabel id="create-decision-key-label">Decision Key</InputLabel>
              <Select
                labelId="create-decision-key-label"
                value={newDecisionKey}
                label="Decision Key *"
                onChange={(e) => setNewDecisionKey(e.target.value as DecisionKey)}
              >
                {MVP_DECISION_KEYS.map((k) => (
                  <MenuItem key={k} value={k}>
                    {k}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="Rule Set Name"
              required
              fullWidth
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Standard Personal Loan Assignment Matrix"
            />

            <FormControl fullWidth required>
              <InputLabel id="create-scope-type-label">Scope Type</InputLabel>
              <Select
                labelId="create-scope-type-label"
                value={newScopeType}
                label="Scope Type *"
                onChange={(e) => setNewScopeType(e.target.value as ScopeType)}
              >
                <MenuItem value="TENANT_DEFAULT">TENANT_DEFAULT</MenuItem>
                <MenuItem value="BRANCH">BRANCH</MenuItem>
                <MenuItem value="LENDER">LENDER</MenuItem>
                <MenuItem value="PRODUCT_VERSION">PRODUCT_VERSION</MenuItem>
              </Select>
            </FormControl>

            {newScopeType !== 'TENANT_DEFAULT' && (
              <TextField
                label="Scope Reference ID"
                required
                fullWidth
                value={newScopeRef}
                onChange={(e) => setNewScopeRef(e.target.value)}
                placeholder="e.g. brn_01JTEST..., len_01JTEST..."
                helperText="Identifier of the entity this rule set applies to"
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setCreateOpen(false)} disabled={createSubmitting}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleCreate} disabled={createSubmitting}>
            {createSubmitting ? 'Creating...' : 'Create Rule Set'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
