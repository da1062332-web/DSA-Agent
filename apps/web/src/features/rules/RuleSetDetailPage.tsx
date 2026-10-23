// apps/web/src/features/rules/RuleSetDetailPage.tsx — owner: Developer 6 (Module 23: Business Rule Engine)
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
import { DataTable } from '../../ui';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  createRuleSetVersion,
  createTestCase,
  fetchRuleSet,
  fetchRuleSetVersions,
  fetchTestCases,
} from './api';
import type {
  HitPolicy,
  RuleSetResponse,
  RuleSetVersionResponse,
  TestCaseResponse,
  VersionStatus,
} from './types';

function getStatusColor(
  status: VersionStatus,
): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'APPROVED':
      return 'primary';
    case 'IN_REVIEW':
      return 'warning';
    case 'SCHEDULED':
      return 'info';
    case 'SUSPENDED':
      return 'error';
    case 'SUPERSEDED':
    case 'RETIRED':
    case 'ABANDONED':
      return 'default';
    case 'DRAFT':
    default:
      return 'secondary';
  }
}

export function RuleSetDetailPage() {
  const { ruleSetId } = useParams<{ ruleSetId: string }>();
  const navigate = useNavigate();

  const [tabIndex, setTabIndex] = useState(0);
  const [ruleSet, setRuleSet] = useState<RuleSetResponse | null>(null);
  const [versions, setVersions] = useState<RuleSetVersionResponse[]>([]);
  const [testCases, setTestCases] = useState<TestCaseResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New Draft modal
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftHitPolicy, setDraftHitPolicy] = useState<HitPolicy>('FIRST');
  const [draftReason, setDraftReason] = useState('');
  const [cloneVersionId, setCloneVersionId] = useState('');
  const [draftSubmitting, setDraftSubmitting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  // New Test Case modal
  const [tcOpen, setTcOpen] = useState(false);
  const [tcName, setTcName] = useState('');
  const [tcInputJson, setTcInputJson] = useState('{\n  \n}');
  const [tcExpectedStatus, setTcExpectedStatus] = useState<'MATCHED' | 'NO_MATCH' | 'ERROR'>('MATCHED');
  const [tcExpectedOutputJson, setTcExpectedOutputJson] = useState('{\n  \n}');
  const [tcSubmitting, setTcSubmitting] = useState(false);
  const [tcError, setTcError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!ruleSetId) return;
    try {
      setLoading(true);
      setError(null);
      const [rsRes, vList, tcList] = await Promise.all([
        fetchRuleSet(ruleSetId),
        fetchRuleSetVersions(ruleSetId),
        fetchTestCases(ruleSetId),
      ]);
      setRuleSet(rsRes.data);
      setVersions(vList);
      setTestCases(tcList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rule set details');
    } finally {
      setLoading(false);
    }
  }, [ruleSetId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateDraft = async () => {
    if (!ruleSetId) return;
    try {
      setDraftSubmitting(true);
      setDraftError(null);
      const created = await createRuleSetVersion(ruleSetId, {
        hitPolicy: draftHitPolicy,
        changeReason: draftReason.trim() || undefined,
        cloneFromVersionId: cloneVersionId || undefined,
      });
      setDraftOpen(false);
      navigate(`/rules/versions/${created.id}`);
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Failed to create draft version');
    } finally {
      setDraftSubmitting(false);
    }
  };

  const handleCreateTestCase = async () => {
    if (!ruleSetId) return;
    try {
      setTcSubmitting(true);
      setTcError(null);
      let parsedInput: Record<string, unknown> = {};
      let parsedOutput: Record<string, unknown> = {};
      try {
        parsedInput = JSON.parse(tcInputJson);
        parsedOutput = JSON.parse(tcExpectedOutputJson);
      } catch {
        throw new Error('Invalid JSON format in test case input or expected output.');
      }

      await createTestCase(ruleSetId, {
        name: tcName.trim(),
        input: parsedInput,
        expectedStatus: tcExpectedStatus,
        expectedOutput: parsedOutput,
      });
      setTcOpen(false);
      loadData();
    } catch (err) {
      setTcError(err instanceof Error ? err.message : 'Failed to create test case');
    } finally {
      setTcSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ py: 8, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (error || !ruleSet) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Alert severity="error">{error || 'Rule set not found'}</Alert>
        <Button sx={{ mt: 2 }} onClick={() => navigate('/rules')}>
          Back to Rule Sets
        </Button>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={3}>
        <Box>
          <Button size="small" onClick={() => navigate('/rules')} sx={{ mb: 1 }}>
            ← All Rule Sets
          </Button>
          <Typography variant="h4" fontWeight={700}>
            {ruleSet.name}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" mt={0.5}>
            <Chip size="small" label={ruleSet.decisionKey} color="primary" variant="outlined" />
            <Chip size="small" label={ruleSet.scopeType} />
            {ruleSet.scopeRef && <Chip size="small" label={`Ref: ${ruleSet.scopeRef}`} variant="outlined" />}
            <Chip
              size="small"
              label={ruleSet.status}
              color={ruleSet.status === 'ACTIVE' ? 'success' : 'default'}
            />
          </Stack>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button variant="contained" onClick={() => setDraftOpen(true)}>
            New Draft Version
          </Button>
        </Stack>
      </Stack>

      {/* Meta cards */}
      <Grid container spacing={2} mb={3}>
        <Grid item xs={12} sm={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="text.secondary">
                Active Production Version
              </Typography>
              <Typography variant="h6" fontWeight={600} mt={0.5}>
                {ruleSet.activeVersionId ? (
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => navigate(`/rules/versions/${ruleSet.activeVersionId}`)}
                  >
                    {ruleSet.activeVersionId}
                  </Button>
                ) : (
                  'No active version'
                )}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="text.secondary">
                Open Drafts (Limit: 5)
              </Typography>
              <Typography variant="h6" fontWeight={600} mt={0.5}>
                {ruleSet.draftVersionCount ?? 0} / 5
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="text.secondary">
                Rule Set ID
              </Typography>
              <Typography variant="body2" fontFamily="monospace" mt={0.5}>
                {ruleSet.id}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={tabIndex} onChange={(_, val) => setTabIndex(val)}>
          <Tab label={`Versions (${versions.length})`} />
          <Tab label={`Test Suite (${testCases.length})`} />
        </Tabs>
      </Box>

      {tabIndex === 0 && (
        <DataTable<(typeof versions)[number]>
          dataTestId="rules.table.versions"
          data={versions}
          keyExtractor={(ver) => ver.id}
          onRowClick={(ver) => navigate(`/rules/versions/${ver.id}`)}
          columns={[
            {
              id: 'version',
              header: 'Version',
              render: (ver) => (
                <>
                  <Typography variant="subtitle2" fontWeight={700}>
                    v{ver.versionNo}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {ver.id}
                  </Typography>
                </>
              ),
            },
            { id: 'status', header: 'Status', render: (ver) => <Chip size="small" label={ver.status} color={getStatusColor(ver.status)} /> },
            { id: 'hit', header: 'Hit Policy', render: (ver) => <Chip size="small" label={ver.hitPolicy} variant="outlined" /> },
            {
              id: 'hash',
              header: 'Content Hash',
              render: (ver) => (
                <Typography variant="caption" fontFamily="monospace">
                  {ver.contentHash.slice(0, 16)}...
                </Typography>
              ),
            },
            {
              id: 'rules',
              header: 'Rules Count',
              render: (ver) => <Typography variant="body2">{ver.definition?.rules?.length ?? 0}</Typography>,
            },
            {
              id: 'reason',
              header: 'Change Reason',
              render: (ver) => (
                <Typography variant="body2" color="text.secondary">
                  {ver.changeReason || '—'}
                </Typography>
              ),
            },
            {
              id: 'range',
              header: 'Effective Range',
              render: (ver) => (
                <Typography variant="caption">
                  {ver.effectiveFrom
                    ? `${ver.effectiveFrom.slice(0, 10)} → ${ver.effectiveTo ? ver.effectiveTo.slice(0, 10) : 'active'}`
                    : '—'}
                </Typography>
              ),
            },
            {
              id: 'actions',
              header: 'Actions',
              align: 'right',
              render: (ver) => (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/rules/versions/${ver.id}`);
                  }}
                >
                  {ver.status === 'DRAFT' ? 'Edit Draft' : 'View Rules'}
                </Button>
              ),
            },
          ]}
        />
      )}

      {tabIndex === 1 && (
        <Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="subtitle1" fontWeight={600}>
              Automated Rule Test Cases
            </Typography>
            <Button variant="contained" size="small" onClick={() => setTcOpen(true)}>
              Add Test Case
            </Button>
          </Stack>

          {testCases.length === 0 ? (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                No automated test cases configured for this rule set yet.
              </Typography>
            </Paper>
          ) : (
            <DataTable<(typeof testCases)[number]>
              dataTestId="rules.table.test-cases"
              data={testCases}
              keyExtractor={(tc) => tc.id}
              columns={[
                {
                  id: 'name',
                  header: 'Test Case Name',
                  render: (tc) => (
                    <>
                      <Typography variant="subtitle2" fontWeight={600}>
                        {tc.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {tc.id}
                      </Typography>
                    </>
                  ),
                },
                {
                  id: 'expected',
                  header: 'Expected Status',
                  render: (tc) => <Chip size="small" label={tc.expectedStatus} color="primary" variant="outlined" />,
                },
                {
                  id: 'output',
                  header: 'Expected Output',
                  render: (tc) => (
                    <Typography variant="caption" fontFamily="monospace">
                      {JSON.stringify(tc.expectedOutput)}
                    </Typography>
                  ),
                },
                {
                  id: 'active',
                  header: 'Active',
                  render: (tc) => <Chip size="small" label={tc.active ? 'YES' : 'NO'} color={tc.active ? 'success' : 'default'} />,
                },
                {
                  id: 'created',
                  header: 'Created',
                  render: (tc) => <Typography variant="caption">{new Date(tc.createdAt).toLocaleDateString()}</Typography>,
                },
              ]}
            />
          )}
        </Box>
      )}

      {/* New Draft Version Dialog */}
      <Dialog
        open={draftOpen}
        onClose={() => !draftSubmitting && setDraftOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create New Draft Version</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={3} pt={1}>
            {draftError && <Alert severity="error">{draftError}</Alert>}
            <FormControl fullWidth>
              <InputLabel id="draft-hit-policy-label">Hit Policy</InputLabel>
              <Select
                labelId="draft-hit-policy-label"
                value={draftHitPolicy}
                label="Hit Policy"
                onChange={(e) => setDraftHitPolicy(e.target.value as HitPolicy)}
              >
                <MenuItem value="UNIQUE">UNIQUE</MenuItem>
                <MenuItem value="FIRST">FIRST</MenuItem>
                <MenuItem value="PRIORITY">PRIORITY</MenuItem>
                <MenuItem value="COLLECT">COLLECT</MenuItem>
                <MenuItem value="RULE_ORDER">RULE_ORDER</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel id="clone-from-label">Clone from Existing Version</InputLabel>
              <Select
                labelId="clone-from-label"
                value={cloneVersionId}
                label="Clone from Existing Version"
                onChange={(e) => setCloneVersionId(e.target.value)}
              >
                <MenuItem value="">
                  <em>Start with Blank Definition</em>
                </MenuItem>
                {versions.map((v) => (
                  <MenuItem key={v.id} value={v.id}>
                    v{v.versionNo} ({v.status}) — {v.definition?.rules?.length ?? 0} rule(s)
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Change Reason"
              fullWidth
              value={draftReason}
              onChange={(e) => setDraftReason(e.target.value)}
              placeholder="e.g. Updating credit threshold guidelines for Q4"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraftOpen(false)} disabled={draftSubmitting}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleCreateDraft} disabled={draftSubmitting}>
            {draftSubmitting ? 'Creating...' : 'Create Draft'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create Test Case Dialog */}
      <Dialog open={tcOpen} onClose={() => !tcSubmitting && setTcOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Add Automated Test Case</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={3} pt={1}>
            {tcError && <Alert severity="error">{tcError}</Alert>}
            <TextField
              label="Test Case Name"
              fullWidth
              required
              value={tcName}
              onChange={(e) => setTcName(e.target.value)}
              placeholder="e.g. High credit score Mumbai salaried PL lead"
            />
            <FormControl fullWidth required>
              <InputLabel id="expected-status-label">Expected Status</InputLabel>
              <Select
                labelId="expected-status-label"
                value={tcExpectedStatus}
                label="Expected Status"
                onChange={(e) => setTcExpectedStatus(e.target.value as 'MATCHED' | 'NO_MATCH' | 'ERROR')}
              >
                <MenuItem value="MATCHED">MATCHED</MenuItem>
                <MenuItem value="NO_MATCH">NO_MATCH</MenuItem>
                <MenuItem value="ERROR">ERROR</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Input Facts (JSON)"
              fullWidth
              multiline
              rows={4}
              value={tcInputJson}
              onChange={(e) => setTcInputJson(e.target.value)}
              helperText="Synthetic fact payload evaluated against the rule set"
            />
            <TextField
              label="Expected Outputs (JSON)"
              fullWidth
              multiline
              rows={4}
              value={tcExpectedOutputJson}
              onChange={(e) => setTcExpectedOutputJson(e.target.value)}
              helperText="Expected outputs object matching the decision evaluation"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTcOpen(false)} disabled={tcSubmitting}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleCreateTestCase} disabled={tcSubmitting}>
            {tcSubmitting ? 'Saving...' : 'Save Test Case'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
