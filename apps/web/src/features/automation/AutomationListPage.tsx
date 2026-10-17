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
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ color: 'primary.main', mb: 0.5 }}>
            Workflow Automation Engine
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Module 24 (MOD-WFA): Design multi-step workflows, configure event triggers, and supervise
            execution pipelines.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData} disabled={loading}>
            Refresh
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateDialogOpen(true)}>
            New Automation Rule
          </Button>
        </Box>
      </Box>

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
            <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
              <TextField
                size="small"
                placeholder="Search rules by name or code..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
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
                  <MenuItem value="DISABLED">DISABLED</MenuItem>
                  <MenuItem value="SUSPENDED">SUSPENDED</MenuItem>
                </Select>
              </FormControl>
            </Box>

            <TableContainer>
              <Table size="medium">
                <TableHead sx={{ backgroundColor: 'action.hover' }}>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Rule Code</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Entity</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Trigger</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Pinned Version</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>
                      Actions
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredDefinitions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                        <Typography color="text.secondary">No automation rules found.</Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredDefinitions.map((d) => (
                      <TableRow key={d.id} hover>
                        <TableCell>
                          <Typography variant="body2" fontFamily="monospace" fontWeight={600}>
                            {d.code}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>
                            {d.name}
                          </Typography>
                          {d.description && (
                            <Typography variant="caption" color="text.secondary" display="block">
                              {d.description}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip size="small" label={d.entityType} variant="outlined" />
                        </TableCell>
                        <TableCell>
                          <Chip size="small" label={d.triggerType} color="primary" variant="outlined" />
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" fontFamily="monospace">
                            {d.pinnedVersionId ? d.pinnedVersionId.slice(0, 12) + '...' : 'None (Draft)'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={d.status}
                            color={
                              d.status === 'ACTIVE' ? 'success' : d.status === 'DRAFT' ? 'warning' : 'default'
                            }
                          />
                        </TableCell>
                        <TableCell align="right">
                          <Tooltip title="Trigger / Execute">
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => {
                                setSelectedDefForExec(d);
                                setExecuteDialogOpen(true);
                              }}
                            >
                              <PlayArrowIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="View Details & Versions">
                            <IconButton size="small" onClick={() => navigate(`/automations/${d.id}`)}>
                              <VisibilityIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {/* Tab 1: Execution Logs */}
        {tabIndex === 1 && (
          <Box sx={{ p: 2 }}>
            <TableContainer>
              <Table size="medium">
                <TableHead sx={{ backgroundColor: 'action.hover' }}>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Execution ID</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Definition ID</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Subject</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Triggered At</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Completed At</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {executions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                        <Typography color="text.secondary">No execution logs recorded yet.</Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    executions.map((e) => (
                      <TableRow key={e.id} hover>
                        <TableCell>
                          <Typography variant="body2" fontFamily="monospace">
                            {e.id}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" fontFamily="monospace">
                            {e.definitionId}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {e.subjectType}: {e.subjectId}
                          </Typography>
                        </TableCell>
                        <TableCell>
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
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption">
                            {new Date(e.startedAt ?? e.createdAt).toLocaleString()}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption">
                            {e.completedAt ? new Date(e.completedAt).toLocaleString() : 'In Progress'}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
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
              <TableContainer>
                <Table size="medium">
                  <TableHead sx={{ backgroundColor: 'action.hover' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Dead Letter ID</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Execution ID</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Step Execution ID</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Reason</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        Operator Actions
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {deadLetters.map((dl) => (
                      <TableRow key={dl.id} hover>
                        <TableCell>
                          <Typography variant="body2" fontFamily="monospace">
                            {dl.id}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" fontFamily="monospace">
                            {dl.executionId}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{dl.stepExecutionId}</Typography>
                        </TableCell>
                        <TableCell>
                          <Chip size="small" color="error" label={dl.reason} />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{dl.resolutionStatus}</Typography>
                        </TableCell>
                        <TableCell align="right">
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
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
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
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!newCode.trim() || !newName.trim() || loading}
            onClick={handleCreate}
          >
            Create Rule
          </Button>
        </DialogActions>
      </Dialog>

      {/* Manual Execution Dialog */}
      <Dialog open={executeDialogOpen} onClose={() => setExecuteDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Launch Automation</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Trigger rule: <strong>{selectedDefForExec?.name}</strong> ({selectedDefForExec?.code})
          </Typography>
          <TextField
            label={`${selectedDefForExec?.entityType ?? 'Subject'} ID`}
            placeholder="e.g. lead_01JTEST00000000000000"
            value={execSubjectId}
            onChange={(e) => setExecSubjectId(e.target.value)}
            fullWidth
            required
          />
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
          <Button onClick={() => setExecuteDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!execSubjectId.trim() || loading}
            onClick={handleExecuteTrigger}
          >
            Trigger Now
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
