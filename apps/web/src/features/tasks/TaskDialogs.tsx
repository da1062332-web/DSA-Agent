// apps/web/src/features/tasks/TaskDialogs.tsx — owner: Dev 6 (MOD-TASK; DSA Notion MODULE 9, API-TASK-001 and API-TASK-004).
// The create and complete dialogs, shared by the task list and the lead page (QA plan Module 07: "create a follow-up task with a
// due date and owner", "update the task outcome"). Completing a task can schedule the next follow-up in the same call, which is how
// a sales executive (task.update without task.create) books the next touch.
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { useMe } from '../../api/useMe';
import { BranchSelect, UserPicker } from '../admin/components';
import { completeTask, createTask } from './api';
import type {
  CreateTaskPayload,
  TaskLinkedType,
  TaskOutcomeCode,
  TaskPriority,
  TaskResource,
  TaskType,
} from './types';

export const TASK_TYPES: { value: TaskType; label: string }[] = [
  { value: 'FOLLOW_UP', label: 'Follow up' },
  { value: 'CALL', label: 'Call' },
  { value: 'MEETING', label: 'Meeting' },
  { value: 'DOCUMENT_COLLECTION', label: 'Document collection' },
  { value: 'LENDER_QUERY', label: 'Lender query' },
  { value: 'REVIEW', label: 'Review' },
  { value: 'GENERAL', label: 'General' },
];

const OUTCOMES: { value: TaskOutcomeCode; label: string }[] = [
  { value: 'CONNECTED', label: 'Connected' },
  { value: 'NO_ANSWER', label: 'No answer' },
  { value: 'BUSY', label: 'Busy' },
  { value: 'SWITCHED_OFF', label: 'Switched off' },
  { value: 'WRONG_NUMBER', label: 'Wrong number' },
  { value: 'CALLBACK_REQUESTED', label: 'Callback requested' },
  { value: 'NOT_INTERESTED', label: 'Not interested' },
  { value: 'DONE', label: 'Done' },
  { value: 'NOT_REQUIRED', label: 'Not required' },
  { value: 'OTHER', label: 'Other' },
];

/** Where a task's linked record opens. */
export function linkedPath(type: TaskLinkedType, id: string): string {
  const base = type === 'LEAD' ? '/leads' : type === 'LOAN_APPLICATION' ? '/applications' : '/lender-cases';
  return `${base}/${encodeURIComponent(id)}`;
}

/** A datetime-local value (local time, no zone) as an ISO 8601 UTC timestamp; empty stays undefined. */
export const localToIso = (local: string): string | undefined =>
  local ? new Date(local).toISOString() : undefined;

/** Tomorrow at 10:00 local time, as a datetime-local value: the usual next touch. */
export function defaultDueLocal(now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function TaskCreateDialog({
  open,
  onClose,
  linkedType: fixedType,
  linkedId: fixedId,
  defaultTitle = '',
}: {
  open: boolean;
  onClose: () => void;
  /** When given, the task is created on this record and the subject fields are locked. */
  linkedType?: TaskLinkedType;
  linkedId?: string;
  defaultTitle?: string;
}) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [title, setTitle] = useState(defaultTitle);
  const [type, setType] = useState<TaskType>('FOLLOW_UP');
  const [linkedType, setLinkedType] = useState<TaskLinkedType>(fixedType ?? 'LEAD');
  const [linkedId, setLinkedId] = useState(fixedId ?? '');
  const [branchId, setBranchId] = useState<string | null>(me?.primaryBranchId ?? null);
  const [ownerUserId, setOwnerUserId] = useState<string | null>(me?.id ?? null);
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [dueLocal, setDueLocal] = useState(defaultDueLocal());
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    meta: { successMessage: 'Task created.' },
    mutationFn: (payload: CreateTaskPayload) => createTask(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const branch = branchId ?? me?.primaryBranchId ?? '';
    if (!title.trim()) return setError('Enter a title.');
    if (!linkedId.trim()) return setError('Enter the record the task is about.');
    if (!branch) return setError('Choose a branch.');
    if (!dueLocal) return setError('Choose when the task is due.');
    setError(null);
    create.mutate({
      type,
      title: title.trim(),
      ownerUserId: ownerUserId ?? undefined,
      linkedType,
      linkedId: linkedId.trim(),
      branchId: branch,
      priority,
      dueAt: localToIso(dueLocal),
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={submit} noValidate>
        <DialogTitle>New task</DialogTitle>
        <DialogContent dividers>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              inputProps={{ maxLength: 200, 'data-testid': 'tasks.create.title' }}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                fullWidth
                label="Type"
                value={type}
                onChange={(e) => setType(e.target.value as TaskType)}
              >
                {TASK_TYPES.map((t) => (
                  <MenuItem key={t.value} value={t.value}>
                    {t.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                fullWidth
                label="Priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
              >
                <MenuItem value="HIGH">High</MenuItem>
                <MenuItem value="MEDIUM">Medium</MenuItem>
                <MenuItem value="LOW">Low</MenuItem>
              </TextField>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                fullWidth
                label="About"
                value={linkedType}
                disabled={!!fixedType}
                onChange={(e) => setLinkedType(e.target.value as TaskLinkedType)}
              >
                <MenuItem value="LEAD">Lead</MenuItem>
                <MenuItem value="LOAN_APPLICATION">Loan application</MenuItem>
                <MenuItem value="LENDER_CASE">Lender case</MenuItem>
              </TextField>
              <TextField
                fullWidth
                required
                label="Record ID"
                value={linkedId}
                disabled={!!fixedId}
                onChange={(e) => setLinkedId(e.target.value)}
                placeholder="e.g. lead_…"
                inputProps={{ 'data-testid': 'tasks.create.linkedId' }}
              />
            </Stack>
            <TextField
              type="datetime-local"
              label="Due"
              required
              value={dueLocal}
              onChange={(e) => setDueLocal(e.target.value)}
              InputLabelProps={{ shrink: true }}
              inputProps={{ 'data-testid': 'tasks.create.due' }}
            />
            <UserPicker multiple={false} label="Owner" value={ownerUserId} onChange={setOwnerUserId} />
            <BranchSelect required value={branchId} onChange={setBranchId} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={create.isPending}
            data-testid="tasks.create.submit"
          >
            Create task
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export function TaskCompleteDialog({ task, onClose }: { task: TaskResource; onClose: () => void }) {
  const qc = useQueryClient();
  const [outcomeCode, setOutcomeCode] = useState<TaskOutcomeCode>('CONNECTED');
  const [note, setNote] = useState('');
  const [followUp, setFollowUp] = useState(false);
  const [followUpType, setFollowUpType] = useState<TaskType>('FOLLOW_UP');
  const [followUpDue, setFollowUpDue] = useState(defaultDueLocal());
  const [followUpTitle, setFollowUpTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const complete = useMutation({
    meta: { successMessage: 'Task completed.' },
    mutationFn: () =>
      completeTask(task.id, `"${task.lockVersion}"`, {
        outcomeCode,
        completionNote: note.trim() || undefined,
        ...(followUp
          ? {
              nextAction: {
                createFollowUp: true,
                followUpType,
                followUpDueAt: localToIso(followUpDue)!,
                // The API wants 3 to 200 characters; a shorter title is left to the default.
                followUpTitle: followUpTitle.trim().length >= 3 ? followUpTitle.trim() : undefined,
              },
            }
          : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (followUp && !followUpDue) return setError('Choose when the follow-up is due.');
          complete.mutate();
        }}
      >
        <DialogTitle>Complete: {task.title}</DialogTitle>
        <DialogContent dividers>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select
              label="Outcome"
              value={outcomeCode}
              onChange={(e) => setOutcomeCode(e.target.value as TaskOutcomeCode)}
              inputProps={{ 'data-testid': 'tasks.complete.outcome' }}
            >
              {OUTCOMES.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              multiline
              rows={3}
              helperText="Do not type PAN, Aadhaar or account numbers."
              inputProps={{ maxLength: 2000 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={followUp}
                  onChange={(e) => setFollowUp(e.target.checked)}
                  inputProps={{ 'data-testid': 'tasks.complete.follow-up' } as never}
                />
              }
              label="Schedule a follow-up"
            />
            {followUp && (
              <>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    select
                    fullWidth
                    label="Follow-up type"
                    value={followUpType}
                    onChange={(e) => setFollowUpType(e.target.value as TaskType)}
                  >
                    {TASK_TYPES.map((t) => (
                      <MenuItem key={t.value} value={t.value}>
                        {t.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    fullWidth
                    type="datetime-local"
                    label="Follow-up due"
                    value={followUpDue}
                    onChange={(e) => setFollowUpDue(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                </Stack>
                <TextField
                  label="Follow-up title (optional)"
                  value={followUpTitle}
                  onChange={(e) => setFollowUpTitle(e.target.value)}
                  inputProps={{ maxLength: 200 }}
                />
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            color="success"
            disabled={complete.isPending}
            data-testid="tasks.complete.submit"
          >
            Complete task
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
