// A picker over the applications in the caller's scope (owner: Dev 3; API-APP-002), so forms never ask for a typed application ID.
// Optionally limited to one customer's applications (filtered here: the list endpoint has no customer filter).
import { MenuItem, TextField } from '@mui/material';
import { errorText } from '../../api/client';
import { useLookup } from '../admin/api';
import { CustomerName } from '../../shell/display';
import { STATUS_LABELS } from './rules';
import type { Application } from './ApplicationsPage';

export function ApplicationSelect(props: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
  required?: boolean;
  customerId?: string;
  testId?: string;
}) {
  const apps = useLookup<Application>('/v1/applications');
  const rows = (apps.data ?? []).filter((a) => !props.customerId || a.customerId === props.customerId);
  // Keep a value that came from the URL selectable even before (or without) the list containing it.
  const known = !props.value || rows.some((a) => a.id === props.value);
  return (
    <TextField
      select
      fullWidth
      label={props.label ?? 'Application'}
      required={props.required}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      disabled={apps.isPending}
      error={apps.isError}
      helperText={
        apps.isError
          ? errorText(apps.error)
          : rows.length === 0 && !apps.isPending
            ? 'No applications in your scope.'
            : undefined
      }
      inputProps={props.testId ? { 'data-testid': props.testId } : undefined}
    >
      {!known && <MenuItem value={props.value}>{props.value}</MenuItem>}
      {rows.map((a) => (
        <MenuItem key={a.id} value={a.id}>
          <CustomerName id={a.customerId} fallback={`App #${a.id.slice(-6)}`} typographyProps={{ component: 'span', fontWeight: 600 }} />
          {' '}· {a.productCategory} · {a.currency} {a.requestedAmount} ·{' '}
          {STATUS_LABELS[a.status] ?? a.status}
        </MenuItem>
      ))}
    </TextField>
  );
}
