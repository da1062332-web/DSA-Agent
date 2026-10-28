// apps/web/src/features/tasks/TaskList.tsx — owner: Dev 6 — UI-TASK-001 Task Management (DSA Notion MODULE 9).
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { listTasks } from './api';
import { Can } from '../../shell/Can';
import { TaskCompleteDialog, TaskCreateDialog, linkedPath } from './TaskDialogs';
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
import type { TaskResource } from './types';
import { RecordLink } from '../../ui/RecordLink';
import { RowAction } from '../../shell/RowAction';

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

  const taskColumns: ColumnDef<TaskResource>[] = [
    {
      id: 'title',
      header: 'Title',
      accessor: (task) => (
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {task.title}
        </Typography>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      accessor: (task) => task.type,
    },
    {
      id: 'priority',
      header: 'Priority',
      accessor: (task) => (
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
      ),
    },
    {
      id: 'linkedSubject',
      header: 'Linked Subject',
      accessor: (task) =>
        task.linkedType === 'LEAD' ? (
          <LeadName id={task.linkedId} linkToLead />
        ) : task.linkedType === 'LOAN_APPLICATION' ? (
          <ApplicationName id={task.linkedId} linkToApp />
        ) : (
          <RecordLink to={linkedPath(task.linkedType, task.linkedId)}>
            Open {task.linkedType.replace(/_/g, ' ').toLowerCase()}
          </RecordLink>
        ),
    },
    {
      id: 'dueTime',
      header: 'Due Time',
      accessor: (task) => (
        <Typography variant="caption" color="text.secondary">
          {new Date(task.dueAt).toLocaleString()}
        </Typography>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (task) => <StatusBadge status={task.status} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      accessor: (task) =>
        <RowAction allowed={task.status !== 'COMPLETED' && task.status !== 'CANCELLED'} action="task.update">
            <Button
              size="small"
              variant="outlined"
              onClick={() => setSelectedTask(task)}
              data-testid="tasks.complete"
              sx={{ textTransform: 'none', borderRadius: 1.5 }}
            >
              Complete
            </Button>
        </RowAction>,
    },
  ];

  return (
    <Container maxWidth={false} disableGutters>
      {/* Header */}
      <PageHeader
        title="Tasks"
        subtitle="Operational action items, follow-ups, document requests, and queue management"
        actions={
          <Can action="task.create">
            <Button
              variant="contained"
              onClick={() => setOpenCreateDialog(true)}
              data-testid="tasks.create"
              sx={{ borderRadius: 2, fontWeight: 600 }}
            >
              + Create Task
            </Button>
          </Can>
        }
      />

      <StatCardGrid columns={{ xs: 1, sm: 3, md: 3 }} sx={{ mb: 3 }}>
        <StatCard
          title="Total Tasks"
          value={tasks.length}
          subtext="Current view work items"
        />
        <StatCard
          title="High Priority"
          value={tasks.filter((t) => t.priority === 'HIGH').length}
          subtext="Urgent actions required"
          colorVariant="error"
        />
        <StatCard
          title="Completed"
          value={tasks.filter((t) => t.status === 'COMPLETED').length}
          subtext="Successfully resolved"
          colorVariant="success"
        />
      </StatCardGrid>

      {error && <Alert severity="error" sx={{ mb: 3 }}>Failed to load tasks: {(error as Error).message}</Alert>}

      {/* View Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
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

      {/* Filter Toolbar */}
      <FilterToolbar
        filters={
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Status</InputLabel>
            <Select
              value={statusFilter}
              label="Status"
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <MenuItem value="">All Statuses</MenuItem>
              <MenuItem value="OPEN">Open</MenuItem>
              <MenuItem value="IN_PROGRESS">In Progress</MenuItem>
              <MenuItem value="COMPLETED">Completed</MenuItem>
              <MenuItem value="CANCELLED">Cancelled</MenuItem>
            </Select>
          </FormControl>
        }
      />

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <DataTable<TaskResource>
          columns={taskColumns}
          data={tasks}
          emptyTitle="No tasks found."
        />
      )}

      {openCreateDialog && <TaskCreateDialog open onClose={() => setOpenCreateDialog(false)} />}
      {selectedTask && <TaskCompleteDialog task={selectedTask} onClose={() => setSelectedTask(null)} />}
    </Container>
  );
}
