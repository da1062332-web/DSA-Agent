// apps/web/src/features/tasks/TaskList.tsx — owner: Dev 6 — UI-TASK-001 Task Management
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Paper,
} from '@mui/material';
import { createTask, completeTask, listTasks } from './api';
import { getStoredAuthToken } from '../../auth/token';
import { useMe } from '../../api/useMe';
import { Can } from '../../shell/Can';
import type {
  CompleteTaskPayload,
  CreateTaskPayload,
  TaskLinkedType,
  TaskOutcomeCode,
  TaskPriority,
  TaskResource,
  TaskType,
} from './types';

function parseJwtPayload(token: string | undefined): any {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length >= 2 && parts[1]) {
      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join(''),
      );
      return JSON.parse(jsonPayload);
    }
  } catch {
    // Ignore parse error and fallback
  }
  return null;
}

function getInitialUserId(): string {
  const token = getStoredAuthToken();
  const payload = parseJwtPayload(token);
  if (payload?.sub) return payload.sub;
  if (payload?.user_id) return payload.user_id;
  if (payload?.id) return payload.id;
  return 'usr_demo_01';
}

function getInitialBranchId(): string {
  const token = getStoredAuthToken();
  const payload = parseJwtPayload(token);
  if (payload?.primaryBranchId) return payload.primaryBranchId;
  if (payload?.branch_id) return payload.branch_id;
  if (payload?.app_metadata?.primaryBranchId) return payload.app_metadata.primaryBranchId;
  return 'br_demo_01';
}

export function TaskList(): React.ReactElement {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [view, setView] = useState<'MINE' | 'QUEUES' | 'ALL'>('MINE');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Dialogs
  const [openCreateDialog, setOpenCreateDialog] = useState(false);
  const [openCompleteDialog, setOpenCompleteDialog] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskResource | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Create form state
  const [type, setType] = useState<TaskType>('FOLLOW_UP');
  const [title, setTitle] = useState('');
  const [linkedType, setLinkedType] = useState<TaskLinkedType>('LEAD');
  const [linkedId, setLinkedId] = useState('');
  const [branchId, setBranchId] = useState(getInitialBranchId);
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [dueAt] = useState('');
  const [slaClass, setSlaClass] = useState<string>('CUSTOMER_FIRST_CONTACT');

  // Complete form state
  const [outcomeCode, setOutcomeCode] = useState<TaskOutcomeCode>('CONNECTED');
  const [completionNote, setCompletionNote] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['tasks', view, statusFilter],
    queryFn: () => listTasks({ view, status: statusFilter || undefined }),
  });

  const createMutation = useMutation({
    meta: { successMessage: 'Task created.' },
    mutationFn: (payload: CreateTaskPayload) => createTask(payload),
    onSuccess: () => {
      setOpenCreateDialog(false);
      setActionError(null);
      setTitle('');
      setLinkedId('');
      setBranchId(getInitialBranchId());
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err: Error) => {
      setActionError(err.message);
    },
  });

  const completeMutation = useMutation({
    meta: { successMessage: 'Task completed.' },
    mutationFn: ({ id, etag, payload }: { id: string; etag: string; payload: CompleteTaskPayload }) =>
      completeTask(id, etag, payload),
    onSuccess: () => {
      setOpenCompleteDialog(false);
      setSelectedTask(null);
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err: Error) => {
      setActionError(err.message);
    },
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveBranch = branchId.trim() || me?.primaryBranchId || getInitialBranchId();
    const effectiveLinkedId = linkedId.trim() || 'lead_01M4V6DFJWWB25K8X7QNAXTSC0';
    if (!title.trim()) {
      setActionError('Title is required.');
      return;
    }
    createMutation.mutate({
      type,
      title: title.trim(),
      ownerUserId: me?.id || getInitialUserId(),
      linkedType,
      linkedId: effectiveLinkedId,
      branchId: effectiveBranch,
      priority,
      slaClass: slaClass || undefined,
      dueAt: dueAt || undefined,
    });
  };

  const handleCompleteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask) return;
    const etag = `"${selectedTask.lockVersion}"`;
    completeMutation.mutate({
      id: selectedTask.id,
      etag,
      payload: {
        outcomeCode,
        completionNote: completionNote || undefined,
      },
    });
  };

  const tasks = data?.data ?? [];

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack spacing={3}>
        {/* Header */}
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h5" sx={{ fontWeight: 600 }}>
            Task Management (UI-TASK-001)
          </Typography>
          <Can action="task.create">
            <Button variant="contained" onClick={() => setOpenCreateDialog(true)}>
              + Create Task
            </Button>
          </Can>
        </Stack>

        {actionError && <Alert severity="error">{actionError}</Alert>}
        {error && <Alert severity="error">Failed to load tasks: {(error as Error).message}</Alert>}

        {/* View Tabs */}
        <Card elevation={2}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
            <Tabs
              value={view}
              onChange={(_, val) => setView(val)}
              indicatorColor="primary"
              textColor="primary"
            >
              <Tab label="Mine" value="MINE" />
              <Tab label="Queues" value="QUEUES" />
              <Tab label="All Visible" value="ALL" />
            </Tabs>
          </Box>
          <CardContent>
            {/* Filters */}
            <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel>Status</InputLabel>
                <Select value={statusFilter} label="Status" onChange={(e) => setStatusFilter(e.target.value)}>
                  <MenuItem value="">All Statuses</MenuItem>
                  <MenuItem value="OPEN">Open</MenuItem>
                  <MenuItem value="IN_PROGRESS">In Progress</MenuItem>
                  <MenuItem value="COMPLETED">Completed</MenuItem>
                  <MenuItem value="CANCELLED">Cancelled</MenuItem>
                </Select>
              </FormControl>
            </Stack>

            {isLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ backgroundColor: 'action.hover' }}>
                      <TableCell>Title</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Priority</TableCell>
                      <TableCell>Linked Subject</TableCell>
                      <TableCell>Due Time</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tasks.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                          No tasks found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      tasks.map((task: TaskResource) => (
                        <TableRow key={task.id}>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {task.title}
                            </Typography>
                          </TableCell>
                          <TableCell>{task.type}</TableCell>
                          <TableCell>
                            <Chip
                              label={task.priority}
                              size="small"
                              color={
                                task.priority === 'HIGH'
                                  ? 'error'
                                  : task.priority === 'MEDIUM'
                                    ? 'warning'
                                    : 'default'
                              }
                            />
                          </TableCell>
                          <TableCell>
                            {task.linkedType}: {task.linkedId}
                          </TableCell>
                          <TableCell>{new Date(task.dueAt).toLocaleString()}</TableCell>
                          <TableCell>
                            <Chip
                              label={task.status}
                              size="small"
                              color={task.status === 'COMPLETED' ? 'success' : 'default'}
                            />
                          </TableCell>
                          <TableCell align="right">
                            {task.status !== 'COMPLETED' && task.status !== 'CANCELLED' && (
                              <Can action="task.update">
                                <Button
                                  size="small"
                                  variant="outlined"
                                  onClick={() => {
                                    setSelectedTask(task);
                                    setOpenCompleteDialog(true);
                                  }}
                                >
                                  Complete
                                </Button>
                              </Can>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>

        {/* Create Task Dialog */}
        <Dialog open={openCreateDialog} onClose={() => setOpenCreateDialog(false)} maxWidth="sm" fullWidth>
          <form onSubmit={handleCreateSubmit}>
            <DialogTitle>Create New Task</DialogTitle>
            <DialogContent dividers>
              {actionError && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
                  {actionError}
                </Alert>
              )}
              <Stack spacing={2} sx={{ mt: 1 }}>
                <TextField
                  label="Title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  fullWidth
                />
                <FormControl fullWidth size="small">
                  <InputLabel>Type</InputLabel>
                  <Select value={type} label="Type" onChange={(e) => setType(e.target.value as TaskType)}>
                    <MenuItem value="FOLLOW_UP">Follow Up</MenuItem>
                    <MenuItem value="CALL">Call</MenuItem>
                    <MenuItem value="MEETING">Meeting</MenuItem>
                    <MenuItem value="DOCUMENT_COLLECTION">Document Collection</MenuItem>
                    <MenuItem value="LENDER_QUERY">Lender Query</MenuItem>
                    <MenuItem value="REVIEW">Review</MenuItem>
                    <MenuItem value="GENERAL">General</MenuItem>
                  </Select>
                </FormControl>
                <Stack direction="row" spacing={2}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Linked Type</InputLabel>
                    <Select
                      value={linkedType}
                      label="Linked Type"
                      onChange={(e) => setLinkedType(e.target.value as TaskLinkedType)}
                    >
                      <MenuItem value="LEAD">Lead</MenuItem>
                      <MenuItem value="LOAN_APPLICATION">Loan Application</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField
                    label="Linked ID"
                    value={linkedId}
                    onChange={(e) => setLinkedId(e.target.value)}
                    required
                    fullWidth
                    size="small"
                  />
                </Stack>
                <Stack direction="row" spacing={2}>
                  <TextField
                    label="Branch ID"
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    required
                    fullWidth
                    size="small"
                  />
                  <FormControl fullWidth size="small">
                    <InputLabel>Priority</InputLabel>
                    <Select
                      value={priority}
                      label="Priority"
                      onChange={(e) => setPriority(e.target.value as TaskPriority)}
                    >
                      <MenuItem value="HIGH">High</MenuItem>
                      <MenuItem value="MEDIUM">Medium</MenuItem>
                      <MenuItem value="LOW">Low</MenuItem>
                    </Select>
                  </FormControl>
                </Stack>
                <FormControl fullWidth size="small">
                  <InputLabel>SLA Class</InputLabel>
                  <Select value={slaClass} label="SLA Class" onChange={(e) => setSlaClass(e.target.value)}>
                    <MenuItem value="CUSTOMER_FIRST_CONTACT">Customer First Contact (2h)</MenuItem>
                    <MenuItem value="CUSTOMER_FOLLOW_UP">Customer Follow-up (24h)</MenuItem>
                    <MenuItem value="LENDER_QUERY">Lender Query (4h)</MenuItem>
                    <MenuItem value="DOCUMENT_REVIEW">Document Review (6h)</MenuItem>
                    <MenuItem value="INTERNAL_REVIEW">Internal Review (8h)</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setOpenCreateDialog(false)}>Cancel</Button>
              <Button type="submit" variant="contained" disabled={createMutation.isPending}>
                Create Task
              </Button>
            </DialogActions>
          </form>
        </Dialog>

        {/* Complete Task Dialog */}
        <Dialog
          open={openCompleteDialog}
          onClose={() => setOpenCompleteDialog(false)}
          maxWidth="sm"
          fullWidth
        >
          <form onSubmit={handleCompleteSubmit}>
            <DialogTitle>Complete Task: {selectedTask?.title}</DialogTitle>
            <DialogContent dividers>
              {actionError && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
                  {actionError}
                </Alert>
              )}
              <Stack spacing={2} sx={{ mt: 1 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Outcome Code</InputLabel>
                  <Select
                    value={outcomeCode}
                    label="Outcome Code"
                    onChange={(e) => setOutcomeCode(e.target.value as TaskOutcomeCode)}
                  >
                    <MenuItem value="CONNECTED">Connected</MenuItem>
                    <MenuItem value="NO_ANSWER">No Answer</MenuItem>
                    <MenuItem value="BUSY">Busy</MenuItem>
                    <MenuItem value="CALLBACK_REQUESTED">Callback Requested</MenuItem>
                    <MenuItem value="DONE">Done</MenuItem>
                    <MenuItem value="NOT_INTERESTED">Not Interested</MenuItem>
                    <MenuItem value="OTHER">Other</MenuItem>
                  </Select>
                </FormControl>
                <TextField
                  label="Completion Note"
                  value={completionNote}
                  onChange={(e) => setCompletionNote(e.target.value)}
                  multiline
                  rows={3}
                  fullWidth
                />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setOpenCompleteDialog(false)}>Cancel</Button>
              <Button type="submit" variant="contained" color="success" disabled={completeMutation.isPending}>
                Submit Completion
              </Button>
            </DialogActions>
          </form>
        </Dialog>
      </Stack>
    </Container>
  );
}
