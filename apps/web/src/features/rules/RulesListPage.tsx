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
  Paper,
  Select,
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
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRuleSet, fetchDecisionDefinitions, fetchRuleSets } from './api';
import type {
  DecisionDefinitionResponse,
  DecisionKey,
  RuleSetResponse,
  ScopeType,
} from './types';

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
    if (tabIndex === 1 && definitions.length === 0) {
      loadDefinitions();
    }
  }, [tabIndex, definitions.length, loadDefinitions]);

  const handleCreate = async () => {
    if (!newName.trim()) {
      setCreateError('Name is required');
      return;
    }
    try {
      setCreateSubmitting(true);
      setCreateError(null);
      const created = await createRuleSet({
        decisionKey: newDecisionKey,
        scopeType: newScopeType,
        scopeRef: newScopeRef.trim() || null,
        name: newName.trim(),
      });
      setCreateOpen(false);
      navigate(`/rules/${created.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create rule set');
    } finally {
      setCreateSubmitting(false);
    }
  };

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Business Rule Engine
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage, author, validate, and simulate decision rule sets and review audit records
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button variant="outlined" onClick={() => navigate('/decisions')}>
            View Execution Logs
          </Button>
          <Button variant="contained" onClick={() => setCreateOpen(true)}>
            New Rule Set
          </Button>
        </Stack>
      </Stack>

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
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={4}>
                  <FormControl fullWidth size="small">
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
                </Grid>
                <Grid item xs={12} sm={3}>
                  <FormControl fullWidth size="small">
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
                </Grid>
                <Grid item xs={12} sm={3}>
                  <FormControl fullWidth size="small">
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
                </Grid>
                <Grid item xs={12} sm={2}>
                  <Button
                    fullWidth
                    variant="outlined"
                    onClick={() => {
                      setDecisionFilter('');
                      setScopeFilter('');
                      setStatusFilter('');
                    }}
                  >
                    Reset
                  </Button>
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          {loading ? (
            <Box display="flex" justifyContent="center" py={8}>
              <CircularProgress />
            </Box>
          ) : ruleSets.length === 0 ? (
            <Paper sx={{ p: 6, textAlign: 'center' }}>
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No rule sets found
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={3}>
                Get started by creating a new rule set for one of the registered decision keys.
              </Typography>
              <Button variant="contained" onClick={() => setCreateOpen(true)}>
                Create First Rule Set
              </Button>
            </Paper>
          ) : (
            <TableContainer component={Paper}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Rule Set Name</TableCell>
                    <TableCell>Decision Key</TableCell>
                    <TableCell>Scope</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Active Version</TableCell>
                    <TableCell>Open Drafts</TableCell>
                    <TableCell>Updated</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ruleSets.map((rs) => (
                    <TableRow key={rs.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/rules/${rs.id}`)}>
                      <TableCell>
                        <Typography variant="subtitle2" fontWeight={600}>
                          {rs.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {rs.id}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={rs.decisionKey} variant="outlined" color="primary" />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {rs.scopeType}
                          {rs.scopeRef ? ` (${rs.scopeRef})` : ''}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={rs.status}
                          color={rs.status === 'ACTIVE' ? 'success' : 'default'}
                        />
                      </TableCell>
                      <TableCell>
                        {rs.activeVersionId ? (
                          <Chip size="small" label={rs.activeVersionId.slice(0, 12) + '...'} color="success" variant="outlined" />
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            None
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={`${rs.draftVersionCount ?? 0} draft(s)`} />
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption">
                          {new Date(rs.updatedAt).toLocaleDateString()}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="text"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/rules/${rs.id}`);
                          }}
                        >
                          View Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}

      {tabIndex === 1 && (
        <Box>
          <Typography variant="h6" fontWeight={600} mb={2}>
            Registered Decision Definitions (Read-Only Global MVP)
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            These definitions are platform-managed specifications defining input/output contracts, tier risk, hit policies, and fallback policies.
          </Typography>

          {loadingDefs ? (
            <Box display="flex" justifyContent="center" py={8}>
              <CircularProgress />
            </Box>
          ) : (
            <Grid container spacing={3}>
              {definitions.map((def) => (
                <Grid item xs={12} md={6} key={def.key}>
                  <Card variant="outlined" sx={{ height: '100%' }}>
                    <CardContent>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={1}>
                        <Typography variant="subtitle1" fontWeight={700} color="primary">
                          {def.key}
                        </Typography>
                        <Chip size="small" label={`Tier ${def.tier}`} color={def.tier === 'T1' ? 'error' : def.tier === 'T2' ? 'warning' : 'info'} />
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
                          {def.dependencies.map((dep) => (
                            <Chip key={dep} size="small" label={dep} sx={{ mr: 0.5, mt: 0.5 }} />
                          ))}
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

      {/* Create Rule Set Dialog */}
      <Dialog open={createOpen} onClose={() => !createSubmitting && setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create New Rule Set</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={3} pt={1}>
            {createError && <Alert severity="error">{createError}</Alert>}
            <TextField
              label="Rule Set Name"
              fullWidth
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Regional Lead Distribution Policy"
            />
            <FormControl fullWidth required>
              <InputLabel id="create-decision-key-label">Decision Key</InputLabel>
              <Select
                labelId="create-decision-key-label"
                value={newDecisionKey}
                label="Decision Key"
                onChange={(e) => setNewDecisionKey(e.target.value as DecisionKey)}
              >
                {MVP_DECISION_KEYS.map((k) => (
                  <MenuItem key={k} value={k}>
                    {k}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth required>
              <InputLabel id="create-scope-type-label">Scope Type</InputLabel>
              <Select
                labelId="create-scope-type-label"
                value={newScopeType}
                label="Scope Type"
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
                label="Scope Reference"
                fullWidth
                value={newScopeRef}
                onChange={(e) => setNewScopeRef(e.target.value)}
                placeholder="e.g. br_mumbai or len_hdfc"
                helperText="Identifier for the targeted branch, lender, or product version"
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
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
