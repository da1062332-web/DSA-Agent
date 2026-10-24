// apps/web/src/features/automation/AutomationListPage.tsx — owner: Akash (Module 24: Workflow Automation MOD-WFA)
import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  Paper,
  Alert,
  CircularProgress,
} from '@mui/material';
import {
  PlayArrowIcon,
  AddIcon,
  RefreshIcon,
  CheckCircleOutlineIcon,
  VisibilityIcon,
} from '../../shell/icons';
import { useNavigate } from 'react-router-dom';
import { ApplicationSelect, LeadSelect } from '../../shell/selectors';
import { DataTable, PageHeader, AppButton, SearchInput } from '../../ui';
import type {
  AutomationDefinition,
  AutomationExecution,
  DeadLetterRecord,
  CreateAutomationDefinitionInput,
  TriggerType,
  WfaEntityType,
} from '@dsa/contracts';
import {
  listAutomations,
  createAutomation,
  listExecutions,
  listDeadLetters,
  executeAutomation,
  resolveDeadLetter,
} from './api';

export function AutomationListPage() {
  const navigate = useNavigate();
  const [tabIndex, setTabIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [definitions, setDefinitions] = useState<AutomationDefinition[]>([]);
  const [executions, setExecutions] = useState<AutomationExecution[]>([]);
  const [deadLetters, setDeadLetters] = useState<DeadLetterRecord[]>([]);

  // Search & Filter
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Modals
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [executeDialogOpen, setExecuteDialogOpen] = useState(false);
  const [selectedDefForExec, setSelectedDefForExec] = useState<AutomationDefinition | null>(null);
  const [execSubjectId, setExecSubjectId] = useState('');
  const [isDryRun, setIsDryRun] = useState(false);
  const [execSuccessMsg, setExecSuccessMsg] = useState<string | null>(null);

  // Form State
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newTriggerType, setNewTriggerType] = useState<TriggerType>('EVENT');
  const [newEntityType, setNewEntityType] = useState<WfaEntityType>('LEAD');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [defs, execs, dls] = await Promise.all([
        listAutomations(),
        listExecutions({ limit: 50 }),
        listDeadLetters(),
      ]);
      setDefinitions(defs);
      setExecutions(execs);
      setDeadLetters(dls);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load automation data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreate = async () => {
    try {
      setLoading(true);
      const payload: CreateAutomationDefinitionInput & { initialSteps?: unknown[] } = {
        code: newCode.trim(),
        name: newName.trim(),
        description: newDesc.trim() || undefined,
        triggerType: newTriggerType,
        entityType: newEntityType,
      };
      await createAutomation(payload);
      setCreateDialogOpen(false);
      setNewCode('');
      setNewName('');
      setNewDesc('');
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create automation');
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteTrigger = async () => {
    if (!selectedDefForExec || !execSubjectId.trim()) return;
    try {
      setLoading(true);
      const res = await executeAutomation(selectedDefForExec.id, {
        subjectType: selectedDefForExec.entityType,
        subjectId: execSubjectId.trim(),
        triggerPayload: { triggeredVia: 'UI_MANUAL_TRIGGER' },
        dryRun: isDryRun,
      });
      setExecSuccessMsg(`Execution launched: ${res.executionId} (${res.status})`);
      setExecuteDialogOpen(false);
      setExecSubjectId('');
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResolveDeadLetter = async (id: string, action: 'RETRY' | 'SKIP' | 'CANCEL') => {
    try {
      setLoading(true);
      await resolveDeadLetter(id, action, 'Resolved via Automation Console');
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to resolve dead letter');
    } finally {
      setLoading(false);
    }
  };

  const filteredDefinitions = definitions.filter((d) => {
    const matchesSearch =
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.code.toLowerCase().includes(search.toLowerCase());
    const matchesEntity = entityFilter === 'ALL' || d.entityType === entityFilter;
    const matchesStatus = statusFilter === 'ALL' || d.status === statusFilter;
    return matchesSearch && matchesEntity && matchesStatus;
  });

  const activeCount = definitions.filter((d) => d.status === 'ACTIVE').length;
  const runningExecutionsCount = executions.filter(
    (e) => e.status === 'RUNNING' || e.status === 'WAITING',
  ).length;

  return (
    <Box>
      <PageHeader
        title="Workflow Automation Engine"
        subtitle="Design multi-step workflows, configure event triggers, and supervise execution pipelines."
        actions={
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <AppButton variant="outlined" startIcon={<RefreshIcon />} onClick={loadData} loading={loading}>
              Refresh
            </AppButton>
            <AppButton variant="primary" startIcon={<AddIcon />} onClick={() => setCreateDialogOpen(true)}>
              New Automation Rule
            </AppButton>
          </Box>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {execSuccessMsg && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setExecSuccessMsg(null)}>
          {execSuccessMsg}
        </Alert>
      )}

      {/* Metrics Row */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={2}>
            <CardContent>
              <Typography variant="caption" color="text.secondary" textTransform="uppercase">
                Total Automation Rules
              </Typography>
              <Typography variant="h4" fontWeight={700}>
                {definitions.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={2}>
            <CardContent>
              <Typography variant="caption" color="text.secondary" textTransform="uppercase">
                Active Rules
              </Typography>
              <Typography variant="h4" fontWeight={700} color="success.main">
                {activeCount}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={2}>
            <CardContent>
              <Typography variant="caption" color="text.secondary" textTransform="uppercase">
                Active Executions
              </Typography>
              <Typography variant="h4" fontWeight={700} color="info.main">
                {runningExecutionsCount}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={2}>
            <CardContent>
              <Typography variant="caption" color="text.secondary" textTransform="uppercase">
                Dead-Letter Failures
              </Typography>
              <Typography
                variant="h4"
                fontWeight={700}
                color={deadLetters.length > 0 ? 'error.main' : 'text.secondary'}
              >
                {deadLetters.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Tabs */}
      <Paper elevation={2} sx={{ mb: 3 }}>
        <Tabs
          value={tabIndex}
          onChange={(_, v) => setTabIndex(v)}
          indicatorColor="primary"
          textColor="primary"
          sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
        >
          <Tab label={`Automation Rules (${definitions.length})`} />
          <Tab label={`Execution Logs (${executions.length})`} />
          <Tab label={`Dead Letter Queue (${deadLetters.length})`} />
        </Tabs>

        {/* Tab 0: Automation Rules */}
        {tabIndex === 0 && (
          <Box sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
              <SearchInput
                placeholder="Search rules by name or code..."
                value={search}
                onSearchChange={setSearch}
                sx={{ minWidth: 260 }}
              />
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel>Entity Type</InputLabel>
                <Select
                  value={entityFilter}
                  label="Entity Type"
                  onChange={(e) => setEntityFilter(e.target.value)}
                >
                  <MenuItem value="ALL">All Entities</MenuItem>
                  <MenuItem value="LEAD">Lead</MenuItem>
                  <MenuItem value="CUSTOMER">Customer</MenuItem>
                  <MenuItem value="LOAN_APPLICATION">Loan Application</MenuItem>
                  <MenuItem value="LENDER_CASE">Lender Case</MenuItem>
                  <MenuItem value="TASK">Task</MenuItem>
                  <MenuItem value="VERIFICATION">Verification</MenuItem>
                  <MenuItem value="SYSTEM">System</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel>Status</InputLabel>
                <Select value={statusFilter} label="Status" onChange={(e) => setStatusFilter(e.target.value)}>
                  <MenuItem value="ALL">All Statuses</MenuItem>
                  <MenuItem value="ACTIVE">ACTIVE</MenuItem>
                  <MenuItem value="DRAFT">DRAFT</MenuItem>
                  <MenuItem value="INACTIVE">INACTIVE</MenuItem>
                  <MenuItem value="SUSPENDED">SUSPENDED</MenuItem>
                </Select>
              </FormControl>
            </Box>

            <DataTable<(typeof filteredDefinitions)[number]>
              dataTestId="wfa.table.rules"
              data={filteredDefinitions}
              keyExtractor={(d) => d.id}
              emptyMessage="No automation rules found."
              columns={[
                {
                  id: 'code',
                  header: 'Rule Code',
                  render: (d) => (
                    <Typography variant="body2" fontFamily="monospace" fontWeight={600}>
                      {d.code}
                    </Typography>
                  ),
                },
                {
                  id: 'name',
                  header: 'Name',
                  render: (d) => (
                    <>
                      <Typography variant="body2" fontWeight={600}>
                        {d.name}
                      </Typography>
                      {d.description && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {d.description}
                        </Typography>
                      )}
                    </>
                  ),
                },
                { id: 'entity', header: 'Entity', render: (d) => <Chip size="small" label={d.entityType} variant="outlined" /> },
                {
                  id: 'trigger',
                  header: 'Trigger',
                  render: (d) => <Chip size="small" label={d.triggerType} color="primary" variant="outlined" />,
                },
                {
                  id: 'pinned',
                  header: 'Pinned Version',
                  render: (d) => (
                    <Typography variant="caption" fontFamily="monospace">
                      {d.pinnedVersionId ? d.pinnedVersionId.slice(0, 12) + '...' : 'None (Draft)'}
                    </Typography>
                  ),
                },
                {
                  id: 'status',
                  header: 'Status',
                  render: (d) => (
                    <Chip
                      size="small"
                      label={d.status}
                      color={d.status === 'ACTIVE' ? 'success' : d.status === 'DRAFT' ? 'warning' : 'default'}
                    />
                  ),
                },
                {
                  id: 'actions',
                  header: 'Actions',
                  align: 'right',
                  render: (d) => {
                    const canExecute = d.status === 'ACTIVE' && Boolean(d.pinnedVersionId);
                    return (
                      <>
                        <Tooltip
                          title={
                            canExecute
                              ? 'Trigger / Execute'
                              : !d.pinnedVersionId
                                ? 'No pinned active version. Publish and approve a version first.'
                                : `Automation is currently in ${d.status} status.`
                          }
                        >
                          <span>
                            <IconButton
                              size="small"
                              color="primary"
                              disabled={!canExecute}
                              onClick={() => {
                                setSelectedDefForExec(d);
                                setExecuteDialogOpen(true);
                              }}
                            >
                              <PlayArrowIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="View Details & Versions">
                          <IconButton size="small" onClick={() => navigate(`/automations/${d.id}`)}>
                            <VisibilityIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </>
                    );
                  },
                },
              ]}
            />
          </Box>
        )}

        {/* Tab 1: Execution Logs */}
        {tabIndex === 1 && (
          <Box sx={{ p: 2 }}>
            <DataTable<(typeof executions)[number]>
              dataTestId="wfa.table.executions"
              data={executions}
              keyExtractor={(e) => e.id}
              emptyMessage="No execution logs recorded yet."
              columns={[
                {
                  id: 'id',
                  header: 'Execution ID',
                  render: (e) => (
                    <Typography variant="body2" fontFamily="monospace">
                      {e.id}
                    </Typography>
                  ),
                },
                {
                  id: 'definition',
                  header: 'Definition ID',
                  render: (e) => (
                    <Typography variant="caption" fontFamily="monospace">
                      {e.definitionId}
                    </Typography>
                  ),
                },
                {
                  id: 'subject',
                  header: 'Subject',
                  render: (e) => (
                    <Typography variant="body2">
                      {e.subjectType}: {e.subjectId}
                    </Typography>
                  ),
                },
                {
                  id: 'status',
                  header: 'Status',
                  render: (e) => (
                    <Chip
                      size="small"
                      label={e.status}
                      color={
                        e.status === 'SUCCEEDED'
                          ? 'success'
                          : e.status === 'FAILED'
                            ? 'error'
                            : e.status === 'RUNNING'
                              ? 'info'
                              : 'warning'
                      }
                    />
                  ),
                },
                {
                  id: 'started',
                  header: 'Triggered At',
                  render: (e) => (
                    <Typography variant="caption">{new Date(e.startedAt ?? e.createdAt).toLocaleString()}</Typography>
                  ),
                },
                {
                  id: 'completed',
                  header: 'Completed At',
                  render: (e) => (
                    <Typography variant="caption">
                      {e.completedAt ? new Date(e.completedAt).toLocaleString() : 'In Progress'}
                    </Typography>
                  ),
                },
              ]}
            />
          </Box>
        )}

        {/* Tab 2: Dead Letter Queue */}
        {tabIndex === 2 && (
          <Box sx={{ p: 2 }}>
            {deadLetters.length === 0 ? (
              <Box sx={{ p: 4, textAlign: 'center' }}>
                <CheckCircleOutlineIcon color="success" sx={{ fontSize: 48, mb: 1 }} />
                <Typography variant="h6" color="success.main">
                  Dead Letter Queue is Clean
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  All automation workflow steps are operating normally without unhandled exceptions.
                </Typography>
              </Box>
            ) : (
              <DataTable<(typeof deadLetters)[number]>
                dataTestId="wfa.table.dead-letters"
                data={deadLetters}
                keyExtractor={(dl) => dl.id}
                columns={[
                  {
                    id: 'id',
                    header: 'Dead Letter ID',
                    render: (dl) => (
                      <Typography variant="body2" fontFamily="monospace">
                        {dl.id}
                      </Typography>
                    ),
                  },
                  {
                    id: 'execution',
                    header: 'Execution ID',
                    render: (dl) => (
                      <Typography variant="caption" fontFamily="monospace">
                        {dl.executionId}
                      </Typography>
                    ),
                  },
                  {
                    id: 'step',
                    header: 'Step Execution ID',
                    render: (dl) => <Typography variant="body2">{dl.stepExecutionId}</Typography>,
                  },
                  { id: 'reason', header: 'Reason', render: (dl) => <Chip size="small" color="error" label={dl.reason} /> },
                  { id: 'status', header: 'Status', render: (dl) => <Typography variant="body2">{dl.resolutionStatus}</Typography> },
                  {
                    id: 'actions',
                    header: 'Operator Actions',
                    align: 'right',
                    render: (dl) => (
                      <>
                        <Button
                          size="small"
                          variant="outlined"
                          color="primary"
                          sx={{ mr: 1 }}
                          onClick={() => handleResolveDeadLetter(dl.id, 'RETRY')}
                        >
                          Retry
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="secondary"
                          onClick={() => handleResolveDeadLetter(dl.id, 'SKIP')}
                        >
                          Skip
                        </Button>
                      </>
                    ),
                  },
                ]}
              />
            )}
          </Box>
        )}
      </Paper>

      {/* Create Automation Rule Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Workflow Automation Rule</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField
            label="Rule Code"
            placeholder="e.g. auto_lead_welcome_sms"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            helperText="Alphanumeric with underscores or hyphens"
            fullWidth
            required
          />
          <TextField
            label="Rule Name"
            placeholder="e.g. Lead Welcome Notification & Document Request"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            fullWidth
            required
          />
          <TextField
            label="Description"
            placeholder="Explain the purpose of this workflow..."
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            multiline
            rows={3}
            fullWidth
          />
          <FormControl fullWidth>
            <InputLabel>Trigger Type</InputLabel>
            <Select
              value={newTriggerType}
              label="Trigger Type"
              onChange={(e) => setNewTriggerType(e.target.value as TriggerType)}
            >
              <MenuItem value="EVENT">EVENT (Domain Event, e.g. lead.created)</MenuItem>
              <MenuItem value="SCHEDULE">SCHEDULE (Cron Schedule)</MenuItem>
              <MenuItem value="TIMER">TIMER (Relative Time delay)</MenuItem>
              <MenuItem value="WATCH">WATCH (State transition watcher)</MenuItem>
              <MenuItem value="MANUAL">MANUAL (Staff Triggered)</MenuItem>
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel>Subject Entity Type</InputLabel>
            <Select
              value={newEntityType}
              label="Subject Entity Type"
              onChange={(e) => setNewEntityType(e.target.value as WfaEntityType)}
            >
              <MenuItem value="LEAD">LEAD</MenuItem>
              <MenuItem value="CUSTOMER">CUSTOMER</MenuItem>
              <MenuItem value="LOAN_APPLICATION">LOAN_APPLICATION</MenuItem>
              <MenuItem value="LENDER_CASE">LENDER_CASE</MenuItem>
              <MenuItem value="TASK">TASK</MenuItem>
              <MenuItem value="VERIFICATION">VERIFICATION</MenuItem>
              <MenuItem value="SYSTEM">SYSTEM</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <AppButton variant="ghost" onClick={() => setCreateDialogOpen(false)}>Cancel</AppButton>
          <AppButton
            variant="primary"
            disabled={!newCode.trim() || !newName.trim()}
            loading={loading}
            onClick={handleCreate}
          >
            Create Rule
          </AppButton>
        </DialogActions>
      </Dialog>

      {/* Manual Execution Dialog */}
      <Dialog open={executeDialogOpen} onClose={() => setExecuteDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Launch Automation</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Trigger rule: <strong>{selectedDefForExec?.name}</strong> ({selectedDefForExec?.code})
          </Typography>
          {(!selectedDefForExec?.pinnedVersionId || selectedDefForExec?.status !== 'ACTIVE') && (
            <Alert severity="warning">
              This automation cannot be triggered because it{' '}
              {selectedDefForExec?.status !== 'ACTIVE'
                ? `is currently in ${selectedDefForExec?.status} status`
                : 'has no pinned active version'}
              . Publish and approve a version in its details page first (Maker-Checker).
            </Alert>
          )}
          {selectedDefForExec?.entityType === 'LEAD' ? (
            <LeadSelect
              label="Select Lead"
              value={execSubjectId || null}
              onChange={(id) => setExecSubjectId(id ?? '')}
              fullWidth
              required
            />
          ) : selectedDefForExec?.entityType === 'LOAN_APPLICATION' ? (
            <ApplicationSelect
              label="Select Loan Application"
              value={execSubjectId || null}
              onChange={(id) => setExecSubjectId(id ?? '')}
              fullWidth
              required
            />
          ) : (
            <TextField
              label={`${selectedDefForExec?.entityType ?? 'Subject'} ID`}
              placeholder="e.g. lead_01JTEST00000000000000"
              value={execSubjectId}
              onChange={(e) => setExecSubjectId(e.target.value)}
              fullWidth
              required
            />
          )}
          <FormControl fullWidth>
            <InputLabel>Execution Mode</InputLabel>
            <Select
              value={isDryRun ? 'DRY_RUN' : 'LIVE'}
              label="Execution Mode"
              onChange={(e) => setIsDryRun(e.target.value === 'DRY_RUN')}
            >
              <MenuItem value="LIVE">Live Run (Produce side-effects)</MenuItem>
              <MenuItem value="DRY_RUN">Dry Run (Simulate execution steps)</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <AppButton variant="ghost" onClick={() => setExecuteDialogOpen(false)}>Cancel</AppButton>
          <AppButton
            variant="primary"
            disabled={
              !execSubjectId.trim() ||
              !selectedDefForExec?.pinnedVersionId ||
              selectedDefForExec?.status !== 'ACTIVE'
            }
            loading={loading}
            onClick={handleExecuteTrigger}
          >
            Trigger Now
          </AppButton>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
