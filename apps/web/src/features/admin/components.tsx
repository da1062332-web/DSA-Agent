// Shared admin UI pieces (owner: Dev 1).
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import type { ReactNode } from 'react';
import { errorText } from '../../api/client';
import { useLookup, type Branch, type UserSummary } from './api';

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 2,
        mb: 3,
        flexWrap: 'wrap',
      }}
    >
      <Box>
        <Typography variant="h5" fontWeight={700}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary">
            {subtitle}
          </Typography>
        )}
      </Box>
      {action}
    </Box>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <Alert severity="error" sx={{ mb: 2 }}>
      {errorText(error)}
    </Alert>
  );
}

export function Loading() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
      <CircularProgress />
    </Box>
  );
}

export function StatusChip({ active, label }: { active: boolean; label?: string }) {
  return (
    <Chip
      size="small"
      color={active ? 'success' : 'default'}
      label={label ?? (active ? 'Active' : 'Inactive')}
    />
  );
}

export function LoadMore({
  hasNext,
  loading,
  onClick,
}: {
  hasNext: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  if (!hasNext) return null;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
      <Button onClick={onClick} disabled={loading}>
        {loading ? <CircularProgress size={20} /> : 'Load more'}
      </Button>
    </Box>
  );
}

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  text: string;
  confirmLabel: string;
  busy?: boolean;
  error?: unknown;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{props.title}</DialogTitle>
      <DialogContent>
        <ErrorAlert error={props.error} />
        <DialogContentText>{props.text}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose} disabled={props.busy}>
          Cancel
        </Button>
        <Button color="error" variant="contained" onClick={props.onConfirm} disabled={props.busy}>
          {props.confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Active branches from GET /v1/branches. `allowNone` adds an empty option. */
export function BranchSelect(props: {
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  allowNone?: boolean;
  required?: boolean;
  disabled?: boolean;
}) {
  const branches = useLookup<Branch>('/v1/branches', { status: 'ACTIVE' });
  return (
    <TextField
      select
      fullWidth
      label={props.label ?? 'Branch'}
      value={props.value ?? ''}
      required={props.required}
      disabled={props.disabled || branches.isPending}
      onChange={(e) => props.onChange(e.target.value || null)}
      helperText={branches.isError ? errorText(branches.error) : undefined}
      error={branches.isError}
    >
      {props.allowNone && (
        <MenuItem value="">
          <em>None</em>
        </MenuItem>
      )}
      {(branches.data ?? []).map((b) => (
        <MenuItem key={b.id} value={b.id}>
          {b.code} — {b.name}
        </MenuItem>
      ))}
    </TextField>
  );
}

/** Active users from GET /v1/users. Single or multiple selection. */
export function UserPicker<M extends boolean>(props: {
  multiple: M;
  value: M extends true ? string[] : string | null;
  onChange: (value: M extends true ? string[] : string | null) => void;
  label: string;
  exclude?: string[];
  disabled?: boolean;
}) {
  const users = useLookup<UserSummary>('/v1/users', { status: 'ACTIVE' });
  const options = (users.data ?? []).filter((u) => !props.exclude?.includes(u.id));
  const byId = new Map((users.data ?? []).map((u) => [u.id, u]));
  const label = (id: string) => byId.get(id)?.displayName ?? id;

  if (props.multiple) {
    const value = props.value as string[];
    return (
      <Autocomplete
        multiple
        options={options.map((u) => u.id)}
        value={value}
        getOptionLabel={label}
        loading={users.isPending}
        disabled={props.disabled}
        onChange={(_e, v) => (props.onChange as (v: string[]) => void)(v)}
        renderInput={(params) => <TextField {...params} label={props.label} />}
      />
    );
  }
  return (
    <Autocomplete
      options={options.map((u) => u.id)}
      value={(props.value as string | null) ?? null}
      getOptionLabel={label}
      loading={users.isPending}
      disabled={props.disabled}
      onChange={(_e, v) => (props.onChange as (v: string | null) => void)(v)}
      renderInput={(params) => <TextField {...params} label={props.label} />}
    />
  );
}

export const formatDate = (iso: string) => new Date(iso).toLocaleDateString();
