// /applications/:id (owner: Dev 3; DSA Notion MODULE 16, API-APP-003, 004, 010). Edit the applicant request while the
// status allows it, and put the file on hold with a reason. Every change sends the version the screen loaded (If-Match),
// so a stale screen gets the conflict message. The lender-case panel (Dev 4) mounts in the slot at the bottom.
import { Alert, Button, Card, CardContent, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { hasPermission, useMe } from '../../api/useMe';
import { useCommand, useResource } from '../admin/api';
import { ErrorAlert, Loading, PageHeader, StatusChip, formatDate } from '../admin/components';
import type { Application } from './ApplicationsPage';
import {
  STATUS_LABELS,
  canEditDetails,
  canHold,
  isValidAmount,
  isValidHoldReason,
  isValidTenure,
} from './rules';

const PURPOSES = [
  'PERSONAL_NEEDS',
  'MEDICAL',
  'EDUCATION',
  'HOME_PURCHASE',
  'HOME_IMPROVEMENT',
  'VEHICLE',
  'WORKING_CAPITAL',
  'BUSINESS_EXPANSION',
  'DEBT_CONSOLIDATION',
  'OTHER',
] as const;

const APPLICANT_TYPES = [
  'SALARIED',
  'SELF_EMPLOYED_PROFESSIONAL',
  'SELF_EMPLOYED_BUSINESS',
  'NON_INDIVIDUAL',
] as const;

export function ApplicationDetailPage() {
  const { id } = useParams();
  const me = useMe();
  const canUpdate = hasPermission(me.data, 'application.update');
  const app = useResource<Application>(id ? `/v1/applications/${id}` : null);

  if (app.isPending) return <Loading />;
  if (!app.data) return <ErrorAlert error={app.error} />;
  const a = app.data;

  return (
    <>
      <PageHeader
        title={`Application ${a.id}`}
        subtitle={`${a.productCategory} · ${a.currency} ${a.requestedAmount} · version ${a.version}`}
        action={<StatusChip active={!a.onHold} label={STATUS_LABELS[a.status]} />}
      />
      {a.onHold && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          On hold: {a.holdReason ?? 'no reason recorded'}
          {a.holdUntil ? ` until ${formatDate(a.holdUntil)}` : ''}.
        </Alert>
      )}

      <DetailsCard app={a} canEdit={canUpdate && canEditDetails(a.status)} />
      <HoldCard app={a} canHoldNow={canUpdate && canHold(a.status)} />

      {/* Extension point: the lender-case panel (MOD-LCS, Dev 4) mounts here. Nothing renders until it is added. */}
      <div data-slot="application.lender-cases" />
    </>
  );
}

function DetailsCard({ app, canEdit }: { app: Application; canEdit: boolean }) {
  const [amount, setAmount] = useState(app.requestedAmount);
  const [tenure, setTenure] = useState(app.tenureMonths ? String(app.tenureMonths) : '');
  const [purpose, setPurpose] = useState(app.purposeCode ?? '');
  const [applicantType, setApplicantType] = useState(app.applicantType);
  useEffect(() => {
    setAmount(app.requestedAmount);
    setTenure(app.tenureMonths ? String(app.tenureMonths) : '');
    setPurpose(app.purposeCode ?? '');
    setApplicantType(app.applicantType);
  }, [app]);

  const save = useCommand<object, Application>(
    () => ({ path: `/v1/applications/${app.id}`, method: 'PATCH', version: app.version }),
    [[`/v1/applications/${app.id}`], ['/v1/applications']],
  );
  const dirty =
    amount.trim() !== app.requestedAmount ||
    tenure !== (app.tenureMonths ? String(app.tenureMonths) : '') ||
    (purpose || null) !== app.purposeCode ||
    applicantType !== app.applicantType;
  const valid = isValidAmount(amount) && (tenure === '' || isValidTenure(tenure));

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Applicant request
        </Typography>
        <ErrorAlert error={save.error} />
        {!canEditDetails(app.status) && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Details can be edited while the application is Draft or Documents pending. It is{' '}
            {STATUS_LABELS[app.status]}.
          </Typography>
        )}
        <Stack spacing={2} sx={{ maxWidth: 520 }}>
          <TextField
            label="Requested amount (INR)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={!canEdit}
            error={amount !== '' && !isValidAmount(amount)}
            helperText="Decimal, for example 300000.00"
          />
          <TextField
            label="Tenure (months)"
            type="number"
            value={tenure}
            onChange={(e) => setTenure(e.target.value)}
            disabled={!canEdit}
            error={tenure !== '' && !isValidTenure(tenure)}
            helperText="1 to 480"
          />
          <TextField
            select
            label="Purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            disabled={!canEdit}
          >
            <MenuItem value="">Not set</MenuItem>
            {PURPOSES.map((p) => (
              <MenuItem key={p} value={p}>
                {p.replace(/_/g, ' ').toLowerCase()}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Applicant type"
            value={applicantType}
            onChange={(e) => setApplicantType(e.target.value as Application['applicantType'])}
            disabled={!canEdit}
          >
            {APPLICANT_TYPES.map((t) => (
              <MenuItem key={t} value={t}>
                {t.replace(/_/g, ' ').toLowerCase()}
              </MenuItem>
            ))}
          </TextField>
          {canEdit && (
            <Stack direction="row">
              <Button
                variant="contained"
                disabled={!dirty || !valid || save.isPending}
                onClick={() =>
                  save.mutate({
                    requestedAmount: amount.trim(),
                    tenureMonths: tenure === '' ? undefined : Number(tenure),
                    purposeCode: purpose || null,
                    applicantType,
                  })
                }
              >
                Save details
              </Button>
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

function HoldCard({ app, canHoldNow }: { app: Application; canHoldNow: boolean }) {
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const hold = useCommand<{ onHold: boolean; reason?: string; until?: string | null }, Application>(
    () => ({ path: `/v1/applications/${app.id}/hold`, method: 'PUT', version: app.version }),
    [[`/v1/applications/${app.id}`], ['/v1/applications']],
  );

  if (!canHoldNow) return null;
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Hold
        </Typography>
        <ErrorAlert error={hold.error} />
        {app.onHold ? (
          <Stack direction="row" spacing={2} alignItems="center">
            <Typography variant="body2">Reason: {app.holdReason}</Typography>
            <Button
              variant="outlined"
              disabled={hold.isPending}
              onClick={() => hold.mutate({ onHold: false })}
            >
              Clear hold
            </Button>
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ maxWidth: 520 }}>
            <TextField
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              helperText="3 to 200 characters. Shown to the team while the hold is on."
            />
            <TextField
              label="Hold until"
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              InputLabelProps={{ shrink: true }}
              helperText="Optional."
            />
            <Stack direction="row">
              <Button
                variant="contained"
                color="warning"
                disabled={hold.isPending || !isValidHoldReason(reason)}
                onClick={() =>
                  hold.mutate({
                    onHold: true,
                    reason: reason.trim(),
                    until: until ? `${until}T00:00:00Z` : null,
                  })
                }
              >
                Put on hold
              </Button>
            </Stack>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
