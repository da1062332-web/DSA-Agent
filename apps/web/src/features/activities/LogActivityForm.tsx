// apps/web/src/features/activities/LogActivityForm.tsx — CMP-ACT.01.1
import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
  Chip,
} from '@mui/material';
import { ApiError, apiFetch, errorText, newIdempotencyKey } from '../../api/client';
import {
  ACTIVITY_KINDS,
  ACTIVITY_OUTCOME_CODES,
  SUBJECT_TYPES,
  containsS2SensitiveData,
  type Activity,
  type ActivityKind,
  type ActivityOutcomeCode,
  type SubjectType,
} from '@dsa/contracts';

export interface LogActivityFormProps {
  open?: boolean;
  onClose?: () => void;
  onSuccess?: (activity: Activity) => void;
  defaultSubjectType?: SubjectType;
  defaultSubjectId?: string;
  lockSubject?: boolean;
}

export function LogActivityForm({
  open = true,
  onClose,
  onSuccess,
  defaultSubjectType = 'LEAD',
  defaultSubjectId = '',
  lockSubject = false,
}: LogActivityFormProps) {
  const [kind, setKind] = useState<ActivityKind>('CALL');
  const [subjectType, setSubjectType] = useState<SubjectType>(defaultSubjectType);
  const [subjectId, setSubjectId] = useState<string>(defaultSubjectId);
  const [outcomeCode, setOutcomeCode] = useState<ActivityOutcomeCode | ''>('CONNECTED');
  const [occurredAt, setOccurredAt] = useState<string>(() => {
    const now = new Date();
    // format as YYYY-MM-DDTHH:mm
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [durationSeconds, setDurationSeconds] = useState<string>('60');
  const [note, setNote] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setErrorMessage(null);
      setSuccessNotice(null);
      setFieldErrors({});
    }
  }, [open]);

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!subjectId.trim()) {
      errors.subjectId = 'Subject ID is required';
    }

    if (kind === 'CALL' && !outcomeCode) {
      errors.outcomeCode = 'Outcome code is required for calls';
    }

    if (note && note.length > 4000) {
      errors.note = 'Notes cannot exceed 4000 characters';
    }

    if (note && containsS2SensitiveData(note)) {
      errors.note = 'Notes must not contain sensitive PAN, Aadhaar, or bank account numbers (S2 protection).';
    }

    if (durationSeconds && (isNaN(Number(durationSeconds)) || Number(durationSeconds) < 0)) {
      errors.duration = 'Duration must be a positive number';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessNotice(null);

    if (!validate()) return;

    setLoading(true);

    try {
      const idempotencyKey = newIdempotencyKey();

      // Format timestamp as UTC ISO 8601
      const occurredDate = new Date(occurredAt);
      const isoOccurredAt = isNaN(occurredDate.getTime())
        ? new Date().toISOString()
        : occurredDate.toISOString();

      const payload = {
        kind,
        subjectType,
        subjectId: subjectId.trim(),
        outcomeCode: outcomeCode || undefined,
        occurredAt: isoOccurredAt,
        durationSeconds: durationSeconds ? parseInt(durationSeconds, 10) : undefined,
        note: note.trim() || undefined,
      };

      const data = await apiFetch<Activity>('/v1/activities', {
        method: 'POST',
        body: payload,
        idempotencyKey,
      });

      setSuccessNotice('Activity successfully recorded!');
      if (onSuccess) {
        onSuccess(data);
      }
      setTimeout(() => {
        if (onClose) onClose();
      }, 700);
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof ApiError && err.code === 'NOT_FOUND'
          ? 'The linked subject was not found or is outside your permitted scope.'
          : errorText(err),
      );
    } finally {
      setLoading(false);
    }
  };

  const formContent = (
    <Box component="form" onSubmit={handleSubmit} noValidate sx={{ mt: 1 }}>
      {errorMessage && (
        <Alert severity="error" sx={{ mb: 2 }} data-testid="activity.log-form.error">
          {errorMessage}
        </Alert>
      )}
      {successNotice && (
        <Alert severity="success" sx={{ mb: 2 }} data-testid="activity.log-form.success">
          {successNotice}
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6}>
          <FormControl fullWidth size="small">
            <InputLabel id="subject-type-label">Subject Type</InputLabel>
            <Select
              labelId="subject-type-label"
              id="subject-type-select"
              value={subjectType}
              label="Subject Type"
              disabled={lockSubject}
              onChange={(e) => setSubjectType(e.target.value as SubjectType)}
              data-testid="activity.log-form.subject-type"
            >
              {SUBJECT_TYPES.map((t) => (
                <MenuItem key={t} value={t}>
                  {t.replace('_', ' ')}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            size="small"
            label="Subject ID"
            id="subject-id-input"
            value={subjectId}
            disabled={lockSubject}
            onChange={(e) => setSubjectId(e.target.value)}
            error={Boolean(fieldErrors.subjectId)}
            helperText={fieldErrors.subjectId}
            data-testid="activity.log-form.subject-id"
          />
        </Grid>

        <Grid item xs={12} sm={6}>
          <FormControl fullWidth size="small">
            <InputLabel id="kind-label">Activity Kind</InputLabel>
            <Select
              labelId="kind-label"
              id="kind-select"
              value={kind}
              label="Activity Kind"
              onChange={(e) => setKind(e.target.value as ActivityKind)}
              data-testid="activity.log-form.kind"
            >
              {ACTIVITY_KINDS.map((k) => (
                <MenuItem key={k} value={k}>
                  {k}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        <Grid item xs={12} sm={6}>
          <FormControl fullWidth size="small" required={kind === 'CALL'}>
            <InputLabel id="outcome-label">Outcome</InputLabel>
            <Select
              labelId="outcome-label"
              id="outcome-select"
              value={outcomeCode}
              label="Outcome"
              onChange={(e) => setOutcomeCode(e.target.value as ActivityOutcomeCode)}
              error={Boolean(fieldErrors.outcomeCode)}
              data-testid="activity.log-form.outcome"
            >
              <MenuItem value="">
                <em>None</em>
              </MenuItem>
              {ACTIVITY_OUTCOME_CODES.map((o) => (
                <MenuItem key={o} value={o}>
                  {o.replace(/_/g, ' ')}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            size="small"
            label="Occurrence Date & Time"
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            InputLabelProps={{ shrink: true }}
            data-testid="activity.log-form.occurred-at"
          />
        </Grid>

        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            size="small"
            label="Duration (seconds)"
            type="number"
            value={durationSeconds}
            onChange={(e) => setDurationSeconds(e.target.value)}
            error={Boolean(fieldErrors.duration)}
            helperText={fieldErrors.duration || 'Optional duration'}
            inputProps={{ min: 0 }}
            data-testid="activity.log-form.duration"
          />
        </Grid>

        <Grid item xs={12}>
          <TextField
            fullWidth
            multiline
            rows={3}
            size="small"
            label="Interaction Notes"
            placeholder="Key discussion points, customer feedback, next steps..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            error={Boolean(fieldErrors.note)}
            helperText={
              fieldErrors.note ||
              `${note.length}/4000 characters. Do not record PAN, Aadhaar, or bank details.`
            }
            data-testid="activity.log-form.note"
          />
        </Grid>
      </Grid>
    </Box>
  );

  // If used inside a Modal / Dialog
  if (onClose) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" fontWeight={700}>
            Log Activity
          </Typography>
          {defaultSubjectId && (
            <Chip
              label={`${defaultSubjectType}: ${defaultSubjectId}`}
              size="small"
              color="primary"
              variant="outlined"
            />
          )}
        </DialogTitle>
        <DialogContent dividers>{formContent}</DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} disabled={loading} color="inherit">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={loading}
            data-testid="activity.log-form.submit"
            startIcon={loading ? <CircularProgress size={18} color="inherit" /> : null}
          >
            {loading ? 'Recording...' : 'Log Activity'}
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  // If embedded in a page
  return (
    <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
      <Typography variant="h6" fontWeight={700} gutterBottom>
        Log Activity (CMP-ACT.01.1)
      </Typography>
      {formContent}
      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading}
          data-testid="activity.log-form.submit"
          startIcon={loading ? <CircularProgress size={18} color="inherit" /> : null}
        >
          {loading ? 'Recording...' : 'Log Activity'}
        </Button>
      </Box>
    </Box>
  );
}
