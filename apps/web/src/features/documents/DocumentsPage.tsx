// /documents (owner: Dev 3, MOD-DOC checklist slice). Pick an application, see its document checklist. Needs application.read.
import { Alert, Card, MenuItem, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { hasPermission, useMe } from '../../api/useMe';
import { useList } from '../admin/api';
import { ErrorAlert, Loading, PageHeader } from '../admin/components';
import { ChecklistCard } from './ChecklistCard';

interface ApplicationRow {
  id: string;
  productCategory?: string;
  status?: string;
}

export function DocumentsPage() {
  const me = useMe();
  const allowed = !me.data || hasPermission(me.data, 'application.read');
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState(params.get('application') ?? '');
  const apps = useList<ApplicationRow>('/v1/applications', {}, 50, allowed);

  if (!allowed) {
    return (
      <Alert severity="warning" data-testid="documents-no-access">
        You do not have access to application documents. This needs the application read permission.
      </Alert>
    );
  }

  const rows = apps.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle="The documents each application needs, and where each one stands. Customers upload through Document sharing; verifiers review in Verification."
      />
      <ErrorAlert error={apps.error} />
      {apps.isLoading ? (
        <Loading />
      ) : rows.length === 0 && !apps.error ? (
        <Card sx={{ p: 3 }} data-testid="documents-empty">
          <Typography color="text.secondary">There are no applications in your scope yet.</Typography>
        </Card>
      ) : (
        <TextField
          select
          size="small"
          label="Application"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setParams(e.target.value ? { application: e.target.value } : {});
          }}
          sx={{ minWidth: 320, mb: 1 }}
        >
          {rows.map((a) => (
            <MenuItem key={a.id} value={a.id}>
              {a.id}
              {a.productCategory ? ` · ${a.productCategory}` : ''}
              {a.status ? ` · ${a.status}` : ''}
            </MenuItem>
          ))}
        </TextField>
      )}
      {selected && <ChecklistCard applicationId={selected} />}
    </div>
  );
}
