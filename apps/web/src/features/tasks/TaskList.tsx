// apps/web/src/features/tasks/TaskList.tsx — owner: Dev 6 — UI-TASK-001 Task Management (DSA Notion MODULE 9).
// Lists the caller's tasks by view and status. Creating and completing go through the shared dialogs (TaskDialogs.tsx): a new
// task has an owner, a branch and a due time, and completing one can book the next follow-up.
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  FormControl,
  InputLabel,
  Link,
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
  Typography,
  Paper,
} from '@mui/material';
import { listTasks } from './api';
import { Can } from '../../shell/Can';
import { TaskCompleteDialog, TaskCreateDialog, linkedPath } from './TaskDialogs';
import type { TaskResource } from './types';

export function TaskList(): React.ReactElement {
  const [view, setView] = useState<'MINE' | 'QUEUES' | 'ALL'>('MINE');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [openCreateDialog, setOpenCreateDialog] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskResource | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['tasks', view, statusFilter],
    queryFn: () => listTasks({ view, status: statusFilter || undefined }),
  });

  const tasks = data?.data ?? [];

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack spacing={3}>
        {/* Header */}
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h5" sx={{ fontWeight: 600 }}>
            Tasks
          </Typography>
          <Can action="task.create">
            <Button variant="contained" onClick={() => setOpenCreateDialog(true)} data-testid="tasks.create">
              + Create Task
            </Button>
          </Can>
        </Stack>

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
                            <Link component={RouterLink} to={linkedPath(task.linkedType, task.linkedId)}>
                              {task.linkedType}: {task.linkedId}
                            </Link>
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
                                  onClick={() => setSelectedTask(task)}
                                  data-testid="tasks.complete"
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

        {openCreateDialog && <TaskCreateDialog open onClose={() => setOpenCreateDialog(false)} />}
        {selectedTask && <TaskCompleteDialog task={selectedTask} onClose={() => setSelectedTask(null)} />}
      </Stack>
    </Container>
  );
}
