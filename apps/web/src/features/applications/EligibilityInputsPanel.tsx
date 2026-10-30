// Applicant figures for the eligibility rules (owner: Dev 3; DSA Notion MODULE 17). Declared income is shown and kept, but the
// rules read only verified income, which needs an accepted income document from the checklist. A credit score is recorded by
// hand only when the tenant has allowed that. Only people who can update the application see or change these figures.
import { Alert, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useCommand, useLookup, useResource } from '../admin/api';
import { ErrorAlert, Loading, formatDate } from '../admin/components';
import type { ChecklistResponse } from '../documents/model';
import { AppButton, FieldGrid } from '../../ui';
import {
  INPUT_EDITABLE_STATUSES,
  businessDate,
  creditProblem,
  formatMoney,
  normaliseAmount,
  type ApplicantInputs,
  verifiedIncomeCandidates,
} from './eligibility';

const SOURCE_LABELS: Record<NonNullable<ApplicantInputs['declaredIncomeSource']>, string> = {
  APPLICANT_STATED: 'Stated by the applicant',
  SALES_ESTIMATE: 'Estimated by sales',
};

const today = () => businessDate(new Date());

/** The figures as the summary lines show them. Declared income is labelled as not used by the rules. */
function summarise(d: ApplicantInputs) {
  const creditLine = d.credit
    ? `${d.credit.score}, report dated ${d.credit.reportDate}${d.credit.usable ? '' : ' (out of date, not used)'}`
    : d.creditEntryEnabled
      ? 'not recorded'
      : 'not recorded (manual entry is off for this tenant)';
  return {
    declared: d.declaredMonthlyIncome,
    declaredSourceLabel: d.declaredIncomeSource ? SOURCE_LABELS[d.declaredIncomeSource] : null,
    verified: d.verifiedMonthlyIncome,
    verifiedAt: d.verifiedAt,
    creditLine,
  };
}

export function EligibilityInputsPanel({ applicationId, status }: { applicationId: string; status: string }) {
  const path = `/v1/applications/${applicationId}/eligibility-inputs`;
  const checklistPath = `/v1/applications/${applicationId}/checklist`;
  const figures = useResource<ApplicantInputs>(path);
  const checklist = useResource<ChecklistResponse>(checklistPath);
  const parties = useLookup<{ id: string; role: string; removedAt: string | null }>(
    `/v1/applications/${applicationId}/parties`,
  );
  const save = useCommand<Record<string, unknown>, ApplicantInputs>(
    () => ({ path, method: 'PUT', version: figures.data?.version ?? 0 }),
    [[path], [`/v1/applications/${applicationId}/eligibility-assessments`]],
    'Applicant figures saved.',
  );

  const [declaredAmount, setDeclaredAmount] = useState('');
  const [declaredSource, setDeclaredSource] = useState<'APPLICANT_STATED' | 'SALES_ESTIMATE' | ''>('');
  const [verifiedAmount, setVerifiedAmount] = useState('');
  const [verifiedItem, setVerifiedItem] = useState('');
  const [score, setScore] = useState('');
  const [reference, setReference] = useState('');
  const [reportDate, setReportDate] = useState('');

  useEffect(() => {
    const d = figures.data;
    if (!d) return;
    setDeclaredAmount(d.declaredMonthlyIncome?.amount ?? '');
    setDeclaredSource(d.declaredIncomeSource ?? '');
    setVerifiedAmount(d.verifiedMonthlyIncome?.amount ?? '');
    setVerifiedItem(d.verifiedMonthlyIncome?.checklistItemId ?? '');
    setScore(d.credit ? String(d.credit.score) : '');
    setReference(d.credit?.reportReference ?? '');
    setReportDate(d.credit?.reportDate ?? '');
  }, [figures.data]);

  if (figures.isPending) return <Loading />;
  const editable = (INPUT_EDITABLE_STATUSES as readonly string[]).includes(status);
  const acceptedItems = verifiedIncomeCandidates(checklist.data?.data ?? [], parties.data ?? []);
  const view = figures.data ? summarise(figures.data) : null;

  const declaredNormal = normaliseAmount(declaredAmount);
  const verifiedNormal = normaliseAmount(verifiedAmount);
  const creditError = creditProblem({ score, reference, reportDate, today: today() });

  return (
    <Stack spacing={2} data-testid="application.eligibility-inputs">
      <ErrorAlert error={figures.error ?? save.error} />
      {view && (
        <Stack spacing={0.5}>
          <Typography variant="body2">
            Declared income: {formatMoney(view.declared) ?? 'not recorded'}
            {view.declaredSourceLabel ? `, ${view.declaredSourceLabel.toLowerCase()}` : ''}. It is not used by
            the rules.
          </Typography>
          <Typography variant="body2">
            Verified income: {formatMoney(view.verified) ?? 'not verified'}
            {view.verifiedAt ? `, verified ${formatDate(view.verifiedAt)}` : ''}.
          </Typography>
          <Typography variant="body2">Credit score: {view.creditLine}</Typography>
        </Stack>
      )}
      {!editable && (
        <Alert severity="info">
          Applicant figures are fixed once the application is past review. Their current values are shown
          above.
        </Alert>
      )}

      <FieldGrid minColumnWidth={220}>
        <TextField
          size="small"
          label="Declared monthly income (INR)"
          value={declaredAmount}
          onChange={(e) => setDeclaredAmount(e.target.value)}
          disabled={!editable || save.isPending}
          error={declaredAmount !== '' && declaredNormal === null}
          helperText="Up to two decimals, for example 45000.00"
        />
        <TextField
          select
          size="small"
          label="Source of declared income"
          value={declaredSource}
          onChange={(e) => setDeclaredSource(e.target.value as typeof declaredSource)}
          disabled={!editable || save.isPending}
        >
          {(Object.keys(SOURCE_LABELS) as NonNullable<ApplicantInputs['declaredIncomeSource']>[]).map((s) => (
            <MenuItem key={s} value={s}>
              {SOURCE_LABELS[s]}
            </MenuItem>
          ))}
        </TextField>
        <AppButton
          variant="outlined"
          loading={save.isPending}
          disabled={!editable || !declaredNormal || !declaredSource}
          dataTestId="application.declared-save"
          onClick={() =>
            save.mutate({
              declaredMonthlyIncome: { amount: declaredNormal, currency: 'INR' },
              declaredIncomeSource: declaredSource,
            })
          }
        >
          Save declared income
        </AppButton>
      </FieldGrid>

      <FieldGrid minColumnWidth={220}>
        <TextField
          size="small"
          label="Verified monthly income (INR)"
          value={verifiedAmount}
          onChange={(e) => setVerifiedAmount(e.target.value)}
          disabled={!editable || save.isPending}
          error={verifiedAmount !== '' && verifiedNormal === null}
          helperText="Verified from an accepted income document"
        />
        <TextField
          select
          size="small"
          label="Accepted income document"
          value={verifiedItem}
          onChange={(e) => setVerifiedItem(e.target.value)}
          disabled={!editable || save.isPending}
          helperText={
            acceptedItems.length === 0
              ? 'No accepted document on the checklist yet.'
              : 'Salary slips and income tax returns, once accepted'
          }
        >
          {acceptedItems.map((i) => (
            <MenuItem key={i.id} value={i.id}>
              {i.documentTypeCode}
            </MenuItem>
          ))}
        </TextField>
        <Stack direction="row" spacing={1}>
          <AppButton
            variant="outlined"
            loading={save.isPending}
            disabled={!editable || !verifiedNormal || !verifiedItem}
            dataTestId="application.verified-save"
            onClick={() =>
              save.mutate({
                verifiedMonthlyIncome: {
                  amount: verifiedNormal,
                  currency: 'INR',
                  checklistItemId: verifiedItem,
                },
              })
            }
          >
            Save verified income
          </AppButton>
          {view?.verified && (
            <AppButton
              variant="ghost"
              loading={save.isPending}
              disabled={!editable}
              onClick={() => save.mutate({ verifiedMonthlyIncome: null })}
            >
              Clear
            </AppButton>
          )}
        </Stack>
      </FieldGrid>

      {figures.data?.creditEntryEnabled ? (
        <FieldGrid minColumnWidth={220}>
          <TextField
            size="small"
            label="Credit score (300 to 900)"
            value={score}
            onChange={(e) => setScore(e.target.value)}
            disabled={!editable || save.isPending}
          />
          <TextField
            size="small"
            label="Report reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            disabled={!editable || save.isPending}
            helperText="The reference of the authorised report"
          />
          <TextField
            size="small"
            type="date"
            label="Report date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            disabled={!editable || save.isPending}
            InputLabelProps={{ shrink: true }}
            inputProps={{ max: today() }}
          />
          <Stack direction="row" spacing={1}>
            <AppButton
              variant="outlined"
              loading={save.isPending}
              disabled={!editable || creditError !== null}
              dataTestId="application.credit-save"
              onClick={() =>
                save.mutate({
                  credit: { score: Number(score), reportReference: reference.trim(), reportDate },
                })
              }
            >
              Save credit data
            </AppButton>
            {figures.data?.credit && (
              <AppButton
                variant="ghost"
                loading={save.isPending}
                disabled={!editable}
                onClick={() => save.mutate({ credit: null })}
              >
                Clear
              </AppButton>
            )}
          </Stack>
          {editable && score !== '' && creditError && (
            <Typography variant="caption" color="error">
              {creditError}
            </Typography>
          )}
        </FieldGrid>
      ) : (
        <Alert severity="info">
          Recording a credit score by hand is not switched on for this tenant. Until it is, credit data stays
          pending and no decision uses it. A credit bureau connection is not set up.
        </Alert>
      )}
    </Stack>
  );
}
