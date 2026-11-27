// Lender matches on /applications/:id (owner: Dipanshu; task P1-04, API-APP-LMR-001..003). Which lenders will take this file, for how
// much and at what EMI. The inputs are prefilled by the server from the application and its recorded figures; the user fills the
// gaps and runs. Each run is stored, so the latest result is shown on return. An ELIGIBLE row can open a lender case in one click,
// through the lender-cases create flow (POST /v1/applications/{id}/lender-cases, lender_case.submit). Needs lender_match.run.
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Divider,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import type { LenderMatchPrefill, LenderMatchResultView, LenderMatchRun } from '@dsa/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, apiFetch, errorText, newIdempotencyKey } from '../../api/client';
import { hasPermission, useMe } from '../../api/useMe';
import { createLenderCase } from '../lender-cases/api';
import type { Empanelment } from '../lenders/types';
import { DataTable } from '../../ui';
import { EMPLOYMENT_LABELS, EMPLOYMENT_OPTIONS } from '../lenders/policy-form';
import {
  FIELD_TEXT,
  LIMIT_TEXT,
  REASON_TEXT,
  bpsText,
  empanelmentFor,
  formToRun,
  inputsToForm,
  rupees,
  type MatchForm,
} from './lender-matches';

const OUTCOME = {
  ELIGIBLE: { label: 'Eligible', color: 'success' },
  NEEDS_DATA: { label: 'Needs data', color: 'info' },
  NOT_ELIGIBLE: { label: 'Not eligible', color: 'default' },
} as const;

const SOURCE_TEXT = {
  APPLICATION: 'from the application',
  FINANCIAL_INPUT: 'from the recorded figures',
  ENTERED: 'entered',
};

export function LenderMatchesCard({
  applicationId,
  productCategory,
}: {
  applicationId: string;
  productCategory: string;
}) {
  const me = useMe();
  const canRun = hasPermission(me.data, 'lender_match.run');
  const canCreateCase = hasPermission(me.data, 'lender_case.submit');
  const qc = useQueryClient();
  const base = `/v1/applications/${applicationId}/lender-matches`;

  const prefill = useQuery({
    queryKey: [base, 'inputs'],
    queryFn: () => apiFetch<LenderMatchPrefill>(`${base}/inputs`),
    enabled: canRun,
  });
  const latest = useQuery({
    queryKey: [base, 'latest'],
    // No run yet is 404 NO_MATCH_RUN: an empty state, not an error.
    queryFn: () =>
      apiFetch<LenderMatchRun>(`${base}/latest`).catch((e: unknown) => {
        if (e instanceof ApiError && e.httpStatus === 404) return null;
        throw e;
      }),
    enabled: canRun,
  });

  const [form, setForm] = useState<MatchForm | null>(() =>
    prefill.data ? inputsToForm(prefill.data.inputs) : null,
  );
  const [errors, setErrors] = useState<Partial<Record<keyof MatchForm, string>>>({});
  useEffect(() => {
    if (prefill.data && form === null) setForm(inputsToForm(prefill.data.inputs));
  }, [prefill.data, form]);

  // One Idempotency-Key per run: a retry after a network error returns the same run.
  const key = useRef(newIdempotencyKey());
  const run = useMutation({
    meta: { handled: true },
    mutationFn: (body: object) =>
      apiFetch<LenderMatchRun>(base, { method: 'POST', body, idempotencyKey: key.current }),
    onSuccess: (data) => {
      key.current = newIdempotencyKey();
      qc.setQueryData([base, 'latest'], data);
    },
  });

  if (!canRun) return null;

  const submit = () => {
    if (!form) return;
    const r = formToRun(form);
    setErrors(r.errors);
    if (r.body) run.mutate(r.body);
  };
  const set = (f: keyof MatchForm) => (e: { target: { value: string } }) =>
    setForm((s) => (s ? { ...s, [f]: e.target.value } : s));
  const field = (f: keyof MatchForm, help?: string) => {
    const source = prefill.data?.sources[f];
    return (
      <TextField
        fullWidth
        size="small"
        label={FIELD_TEXT[f]}
        value={form?.[f] ?? ''}
        onChange={set(f)}
        error={!!errors[f]}
        helperText={errors[f] ?? (source ? SOURCE_TEXT[source] : help)}
        inputProps={{ 'data-testid': `lenderMatches.input.${f}` }}
      />
    );
  };
  const result = latest.data ?? null;

  return (
    <Card sx={{ mb: 3 }} data-testid="lenderMatches.card">
      <CardHeader
        title={<Typography variant="h6">Lender matches</Typography>}
        subheader="Indicative only, against each lender's ACTIVE credit policy. Not an offer or a sanction."
      />
      <Divider />
      <CardContent>
        {prefill.error ? <Alert severity="error">{errorText(prefill.error)}</Alert> : null}
        {form && (
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              {field('requestedAmount', '₹')}
            </Grid>
            <Grid item xs={12} sm={4}>
              {field('tenureMonths', 'Months')}
            </Grid>
            <Grid item xs={12} sm={4}>
              {field('monthlyIncome', '₹ a month')}
            </Grid>
            <Grid item xs={12} sm={4}>
              {field('monthlyObligations', 'Existing EMIs, ₹ a month; enter 0 for none')}
            </Grid>
            <Grid item xs={12} sm={4}>
              {field('ageYears', 'Completed years')}
            </Grid>
            <Grid item xs={12} sm={4}>
              {field('pincode')}
            </Grid>
            <Grid item xs={12} sm={4}>
              {field('bureauScore', '300 to 900')}
            </Grid>
            <Grid item xs={12} sm={4}>
              {field('collateralValue', '₹, secured loans')}
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                select
                fullWidth
                size="small"
                label={FIELD_TEXT.employmentType}
                value={form.employmentType}
                onChange={set('employmentType')}
                helperText={
                  prefill.data?.sources.employmentType
                    ? SOURCE_TEXT[prefill.data.sources.employmentType]
                    : ' '
                }
                inputProps={{ 'data-testid': 'lenderMatches.input.employmentType' }}
              >
                <MenuItem value="">Not known</MenuItem>
                {EMPLOYMENT_OPTIONS.map((t) => (
                  <MenuItem key={t} value={t}>
                    {EMPLOYMENT_LABELS[t]}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={4}>
              {field('constitution', 'Such as PROPRIETORSHIP')}
            </Grid>
            <Grid item xs={12} sm={4}>
              {field('vintageMonths', 'Months in business or job')}
            </Grid>
            <Grid item xs={12} sm={4} sx={{ display: 'flex', alignItems: 'flex-start' }}>
              <Button
                variant="contained"
                onClick={submit}
                disabled={run.isPending}
                data-testid="lenderMatches.run"
              >
                {run.isPending ? 'Matching…' : 'Run lender match'}
              </Button>
            </Grid>
          </Grid>
        )}
        {run.error ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {errorText(run.error)}
          </Alert>
        ) : null}
      </CardContent>
      <Divider />
      {result ? (
        <MatchResults
          run={result}
          applicationId={applicationId}
          category={productCategory}
          canCreateCase={canCreateCase}
        />
      ) : (
        <CardContent>
          <Typography variant="body2" color="text.secondary" data-testid="lenderMatches.empty">
            {latest.isPending ? 'Loading…' : 'No match has been run for this application yet.'}
          </Typography>
        </CardContent>
      )}
    </Card>
  );
}

/**
 * A figure that only an ELIGIBLE row has. Other rows get an empty fragment, not null: the DataTable shows "Not set" for a blank
 * cell, which would read as missing data when the figure simply does not apply.
 */
const figure = (r: LenderMatchResultView, text: string | null | undefined): ReactNode =>
  r.outcome === 'ELIGIBLE' ? (text ?? null) : <></>;

function MatchResults({
  run,
  applicationId,
  category,
  canCreateCase,
}: {
  run: LenderMatchRun;
  applicationId: string;
  category: string;
  canCreateCase: boolean;
}) {
  return (
    <Box data-testid="lenderMatches.results">
      <CardContent sx={{ pb: 0 }}>
        <Typography variant="body2" color="text.secondary">
          {`${run.eligibleCount} of ${run.policyCount} lender policies eligible · run ${new Date(run.evaluatedAt).toLocaleString()}`}
        </Typography>
      </CardContent>
      <DataTable<LenderMatchResultView>
        dataTestId="lenderMatches.table"
        data={run.results}
        keyExtractor={(r) => r.policyId}
        emptyMessage="No lender has an ACTIVE policy for this product category with a current empanelment."
        columns={[
          { id: 'rank', header: '#', render: (r) => r.rank },
          {
            id: 'lender',
            header: 'Lender',
            render: (r) => (
              <>
                <Typography variant="body2" fontWeight={600}>
                  {r.lenderName}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {r.productName}
                </Typography>
              </>
            ),
          },
          {
            id: 'outcome',
            header: 'Outcome',
            render: (r) => (
              <Chip
                size="small"
                label={OUTCOME[r.outcome].label}
                color={OUTCOME[r.outcome].color}
                data-testid={`lenderMatches.outcome.${r.policyId}`}
              />
            ),
          },
          {
            id: 'why',
            header: 'Why',
            render: (r) =>
              r.outcome === 'ELIGIBLE'
                ? r.limitedBy
                  ? `Limited by ${LIMIT_TEXT[r.limitedBy]}`
                  : ''
                : r.outcome === 'NEEDS_DATA'
                  ? `Needs: ${r.missingFields.map((f) => FIELD_TEXT[f]).join(', ')}`
                  : r.reasons.map((x) => REASON_TEXT[x]).join('; '),
          },
          {
            id: 'amount',
            header: 'Eligible amount',
            align: 'right',
            render: (r) => figure(r, rupees(r.eligibleAmount)),
          },
          {
            id: 'emi',
            header: 'EMI',
            align: 'right',
            render: (r) =>
              figure(
                r,
                r.emiMin && r.emiMax
                  ? r.emiMin.amount === r.emiMax.amount
                    ? rupees(r.emiMin)
                    : `${rupees(r.emiMin)} – ${rupees(r.emiMax)}`
                  : null,
              ),
          },
          { id: 'foir', header: 'FOIR', align: 'right', render: (r) => figure(r, bpsText(r.foirBps)) },
          {
            id: 'fee',
            header: 'Processing fee',
            align: 'right',
            // An eligible row without a fee is a policy that charges none, not a missing value.
            render: (r) => figure(r, r.processingFee ? rupees(r.processingFee) : 'None'),
          },
          {
            id: 'action',
            header: '',
            align: 'right',
            render: (r) =>
              r.outcome === 'ELIGIBLE' && canCreateCase ? (
                <CreateCaseButton result={r} applicationId={applicationId} category={category} />
              ) : (
                <></>
              ),
          },
        ]}
      />
    </Box>
  );
}

/** Opens a lender case for this lender and product version under the lender's current empanelment for the category. */
function CreateCaseButton({
  result,
  applicationId,
  category,
}: {
  result: LenderMatchResultView;
  applicationId: string;
  category: string;
}) {
  const qc = useQueryClient();
  const key = useRef(newIdempotencyKey());
  const create = useMutation({
    meta: { handled: true },
    mutationFn: async () => {
      const list = await apiFetch<{ data: Empanelment[] }>(`/v1/lenders/${result.lenderId}/empanelments`);
      const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
      const emp = empanelmentFor(list.data, category, today);
      if (!emp)
        throw new Error(
          `${result.lenderName} has no current empanelment for ${category}, so no case can be opened.`,
        );
      return createLenderCase(
        applicationId,
        { lenderId: result.lenderId, productVersionId: result.productVersionId, empanelmentId: emp.id },
        key.current,
      );
    },
    onSuccess: async () => {
      key.current = newIdempotencyKey();
      await qc.invalidateQueries({ queryKey: ['lender-cases', applicationId] });
    },
  });
  if (create.isSuccess) return <Chip size="small" color="success" variant="outlined" label="Case created" />;
  return (
    <Stack alignItems="flex-end">
      <Tooltip
        title={create.error ? errorText(create.error) : 'Open a lender case for this lender and product'}
      >
        <span>
          <Button
            size="small"
            variant="outlined"
            disabled={create.isPending}
            onClick={() => create.mutate()}
            data-testid={`lenderMatches.createCase.${result.policyId}`}
          >
            Create lender case
          </Button>
        </span>
      </Tooltip>
      {create.error ? (
        <Typography variant="caption" color="error">
          Could not create the case
        </Typography>
      ) : null}
    </Stack>
  );
}
