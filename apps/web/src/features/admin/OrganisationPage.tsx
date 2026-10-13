// /admin/organisation (owner: Dev 1) — tenant facts (read-only) and the organisation profile (config.manage).
import { Button, Card, CardContent, Grid, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { hasPermission, useMe, useTenant } from '../../api/useMe';
import { CONSTITUTIONS, useCommand, useLookup, type Organisation } from './api';
import { ErrorAlert, Loading, PageHeader, StatusChip, formatDate } from './components';

export function OrganisationPage() {
  const me = useMe();
  const tenant = useTenant();
  // The organisation profile is config.manage only (API-ORG-001); others see the tenant facts.
  const canEdit = hasPermission(me.data, 'config.manage');
  const orgs = useLookup<Organisation>('/v1/organisations', {}, canEdit);

  if (tenant.isPending || (canEdit && orgs.isPending)) return <Loading />;
  return (
    <>
      <PageHeader title="Organisation" subtitle="Your tenant and the legal entity that operates it." />
      <ErrorAlert error={tenant.error ?? orgs.error} />
      {tenant.data && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Tenant
            </Typography>
            <Grid container spacing={2}>
              {[
                ['Name', tenant.data.legalName],
                ['Slug', tenant.data.slug],
                ['Type', tenant.data.tenantType],
                ['Data region', tenant.data.dataRegion],
                ['Time zone', tenant.data.timezone],
                ['Created', formatDate(tenant.data.createdAt)],
              ].map(([k, v]) => (
                <Grid item xs={12} sm={6} md={4} key={k}>
                  <Typography variant="caption" color="text.secondary">
                    {k}
                  </Typography>
                  <Typography>{v}</Typography>
                </Grid>
              ))}
              <Grid item xs={12} sm={6} md={4}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Status
                </Typography>
                <StatusChip active={tenant.data.status === 'ACTIVE'} label={tenant.data.status} />
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}
      {(orgs.data ?? []).map((org) => (
        <OrganisationForm key={org.id} org={org} canEdit={canEdit} />
      ))}
    </>
  );
}

function OrganisationForm({ org, canEdit }: { org: Organisation; canEdit: boolean }) {
  const [legalName, setLegalName] = useState(org.legalName);
  const [constitution, setConstitution] = useState(org.constitution);
  useEffect(() => {
    setLegalName(org.legalName);
    setConstitution(org.constitution);
  }, [org]);

  const save = useCommand<{ legalName?: string; constitution?: string }, Organisation>(
    () => ({ path: `/v1/organisations/${org.id}`, method: 'PATCH', version: org.version }),
    [['/v1/organisations']],
  );
  const dirty = legalName.trim() !== org.legalName || constitution !== org.constitution;

  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="h6">Organisation profile</Typography>
          <StatusChip active={org.status === 'ACTIVE'} label={org.status} />
        </Stack>
        <ErrorAlert error={save.error} />
        <Stack spacing={2} sx={{ maxWidth: 520 }}>
          <TextField
            label="Legal name"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            disabled={!canEdit || save.isPending}
            inputProps={{ 'data-testid': 'admin.org.legalName' }}
          />
          <TextField
            select
            label="Constitution"
            value={constitution}
            onChange={(e) => setConstitution(e.target.value)}
            disabled={!canEdit || save.isPending}
          >
            {CONSTITUTIONS.map((c) => (
              <MenuItem key={c} value={c}>
                {c.replace(/_/g, ' ')}
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="caption" color="text.secondary">
            Last updated {new Date(org.updatedAt).toLocaleString()} · version {org.version}
          </Typography>
          {canEdit && (
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                disabled={!dirty || save.isPending}
                onClick={() =>
                  save.mutate({
                    legalName: legalName.trim() !== org.legalName ? legalName.trim() : undefined,
                    constitution: constitution !== org.constitution ? constitution : undefined,
                  })
                }
                data-testid="admin.org.save"
              >
                Save
              </Button>
              <Button
                disabled={!dirty || save.isPending}
                onClick={() => {
                  setLegalName(org.legalName);
                  setConstitution(org.constitution);
                }}
              >
                Discard
              </Button>
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
