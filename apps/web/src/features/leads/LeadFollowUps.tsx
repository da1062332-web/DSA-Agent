// Activity and follow-ups on one record (owner: Dev 5; DSA Notion MODULE 7, 9 and 10; QA plan Modules 06 and 07). Shows the
// record's timeline (API-ACT-003) and its tasks (API-TASK-002 filtered by linked record), and lets the user log a call or visit
// (API-ACT-001, activity.create), add a follow-up task (API-TASK-001, task.create) and complete an open task with its outcome
// (API-TASK-004, task.update), which can book the next follow-up.
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import type { Activity } from '@dsa/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../api/client';
import { hasPermission, useMe } from '../../api/useMe';
import { ErrorAlert } from '../admin/components';
import { LogActivityForm } from '../activities/LogActivityForm';
import { listTasks } from '../tasks/api';
import { TaskCompleteDialog, TaskCreateDialog } from '../tasks/TaskDialogs';
import type { TaskLinkedType, TaskResource } from '../tasks/types';

const readable = (code: string) => code.toLowerCase().replace(/_/g, ' ');

export function LeadFollowUps({
  subjectType,
  subjectId,
}: {
  /** The activity subject and the task's linked type name the same record. */
  subjectType: 'LEAD' | 'LOAN_APPLICATION';
  subjectId: string;
}) {
  const me = useMe();
  const qc = useQueryClient();
  const can = (code: string) => hasPermission(me.data, code);
  const [logOpen, setLogOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [completing, setCompleting] = useState<TaskResource | null>(null);

  const timelineKey = ['timeline', subjectType, subjectId];
  const timeline = useQuery({
    queryKey: timelineKey,
    queryFn: () =>
      apiFetch<{ data: Activity[] }>('/v1/timeline', { query: { subjectType, subjectId, limit: 50 } }),
  });
  const tasks = useQuery({
    queryKey: ['tasks', 'linked', subjectType, subjectId],
    queryFn: () =>
      listTasks({ view: 'ALL', linkedType: subjectType as TaskLinkedType, linkedId: subjectId, limit: 50 }),
    enabled: can('task.read'),
  });

  const activities = timeline.data?.data ?? [];
  const taskRows = tasks.data?.data ?? [];

  return (
    <Card data-testid="lead.follow-ups">
      <CardContent>
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="h6">Activity</Typography>
              {can('activity.create') && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setLogOpen(true)}
                  data-testid="lead.log-activity"
                >
                  Log call or visit
                </Button>
              )}
            </Stack>
            <Divider sx={{ mb: 1 }} />
            <ErrorAlert error={timeline.error} />
            {activities.length === 0 && !timeline.isLoading ? (
              <Typography variant="body2" color="text.secondary">
                No activity recorded yet.
              </Typography>
            ) : (
              <List dense disablePadding>
                {activities.map((a) => (
                  <ListItem key={a.id} disableGutters divider>
                    <ListItemText
                      primary={
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Chip size="small" label={readable(a.kind)} />
                          {a.outcomeCode && (
                            <Typography variant="body2">{readable(a.outcomeCode)}</Typography>
                          )}
                        </Stack>
                      }
                      secondary={`${new Date(a.occurredAt).toLocaleString()}${a.note ? ` · ${a.note}` : ''}`}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Grid>

          <Grid item xs={12} md={6}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="h6">Follow-up tasks</Typography>
              {can('task.create') && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setTaskOpen(true)}
                  data-testid="lead.add-task"
                >
                  Add follow-up
                </Button>
              )}
            </Stack>
            <Divider sx={{ mb: 1 }} />
            {!can('task.read') ? (
              <Typography variant="body2" color="text.secondary">
                You do not have access to tasks.
              </Typography>
            ) : (
              <>
                <ErrorAlert error={tasks.error} />
                {taskRows.length === 0 && !tasks.isLoading ? (
                  <Typography variant="body2" color="text.secondary">
                    No tasks for this record.
                  </Typography>
                ) : (
                  <List dense disablePadding>
                    {taskRows.map((t) => {
                      const open = t.status !== 'COMPLETED' && t.status !== 'CANCELLED';
                      return (
                        <ListItem
                          key={t.id}
                          disableGutters
                          divider
                          secondaryAction={
                            open && can('task.update') ? (
                              <Button
                                size="small"
                                onClick={() => setCompleting(t)}
                                data-testid="lead.complete-task"
                              >
                                Complete
                              </Button>
                            ) : undefined
                          }
                        >
                          <ListItemText
                            primary={t.title}
                            secondary={
                              <Box component="span">
                                {readable(t.status)} · due {new Date(t.dueAt).toLocaleString()}
                                {t.outcomeCode ? ` · ${readable(t.outcomeCode)}` : ''}
                              </Box>
                            }
                          />
                        </ListItem>
                      );
                    })}
                  </List>
                )}
              </>
            )}
          </Grid>
        </Grid>
      </CardContent>

      {logOpen && (
        <LogActivityForm
          open
          lockSubject
          defaultSubjectType={subjectType}
          defaultSubjectId={subjectId}
          onClose={() => setLogOpen(false)}
          onSuccess={() => {
            setLogOpen(false);
            qc.invalidateQueries({ queryKey: timelineKey });
          }}
        />
      )}
      {taskOpen && (
        <TaskCreateDialog
          open
          linkedType={subjectType}
          linkedId={subjectId}
          defaultTitle="Follow up"
          onClose={() => setTaskOpen(false)}
        />
      )}
      {completing && <TaskCompleteDialog task={completing} onClose={() => setCompleting(null)} />}
    </Card>
  );
}
