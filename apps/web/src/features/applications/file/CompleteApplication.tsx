// Completing a loan file, step by step (owner: Bhushan, 2026-11-28). Opened from the overview with "Complete application" or "Continue
// application". The stages are the steps; each shows its work (StagePanel) and a footer with Previous and Save & next.
// "Save & next" validates the step (step-validation.ts) and lists what is missing; when the step passes it saves the step's form,
// moves the file on where the step has a transition and the caller holds its permission (T-APP-01 start documents, T-APP-02 send to
// credit review, T-APP-04 ready for submission), and opens the next step. Later steps move on by the lender case, so their "Save & next"
// only opens the next step once the file has moved past. Every write sends the version just read (If-Match).
import { Alert, Box, Stack, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiRequest, errorText } from '../../../api/client';
import { hasPermission, useMe } from '../../../api/useMe';
import { AppButton } from '../../../ui';
import type { Application } from '../ApplicationsPage';
import { JOURNEY, type JourneyState } from '../loan-file';
import { canEditDetails } from '../rules';
import { FORWARD, stepProblems, type LoanRequestForm, type StepProblem } from '../step-validation';
import { JourneyStepper } from './JourneyStepper';
import { LoanRequestFields, ProductPicker } from './LoanRequestFields';
import { StagePanel, useFileFacts } from './StagePanel';

const toForm = (a: Application): LoanRequestForm => ({
  amount: a.requestedAmount ? String(Number(a.requestedAmount)) : '',
  tenure: a.tenureMonths ? String(a.tenureMonths) : '',
  purpose: a.purposeCode ?? '',
  applicantType: a.applicantType,
});

const sameForm = (x: LoanRequestForm, y: LoanRequestForm) =>
  x.amount.trim() === y.amount.trim() &&
  x.tenure.trim() === y.tenure.trim() &&
  x.purpose === y.purpose &&
  x.applicantType === y.applicantType;

/** "500000" or "500000.5" → "500000.00", the amount the API takes. */
const toAmount = (raw: string) => Number(raw.trim()).toFixed(2);

export function CompleteApplication({
  app,
  journey,
  index,
  onStep,
  onExit,
  otherActions,
}: {
  app: Application;
  journey: JourneyState;
  index: number;
  onStep: (index: number) => void;
  onExit: () => void;
  /** Cancel, withdraw, send back and the other actions that do not move the file forward. */
  otherActions: ReactNode;
}) {
  const me = useMe();
  const qc = useQueryClient();
  const facts = useFileFacts(app);
  const stage = JOURNEY[index]!;
  const canMatch = hasPermission(me.data, 'lender_match.run');
  const editable = hasPermission(me.data, 'application.update') && canEditDetails(app.status);

  const [form, setForm] = useState<LoanRequestForm>(() => toForm(app));
  const saved = useMemo(() => toForm(app), [app]);
  // React Query keeps the same object while the data is unchanged, so this resets the form only when the saved request changes.
  useEffect(() => setForm(saved), [saved]);
  const [productId, setProductId] = useState('');
  const [versionId, setVersionId] = useState(app.productVersionId ?? '');

  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    setAttempted(false);
    setFailure(null);
    setNotice(null);
  }, [index]);

  const problems: StepProblem[] = stepProblems({
    stage: stage.key,
    status: app.status,
    facts,
    form: stage.key === 'draft' ? form : undefined,
    productVersionId: versionId || app.productVersionId,
    canMatch,
  });
  const shown = attempted ? problems : [];
  const last = index === JOURNEY.length - 1;

  const refresh = () =>
    qc.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey[0];
        return (
          (typeof k === 'string' && k.startsWith(`/v1/applications/${app.id}`)) ||
          (k === 'application-checklist' && q.queryKey[1] === app.id) ||
          k === '/v1/applications'
        );
      },
    });

  async function saveAndNext() {
    setAttempted(true);
    setFailure(null);
    setNotice(null);
    if (problems.length > 0) return;
    setBusy(true);
    try {
      let version = app.version;
      // 1. Save the step's form.
      if (stage.key === 'draft' && editable && !sameForm(form, saved)) {
        const res = await apiRequest<Application>(`/v1/applications/${app.id}`, {
          method: 'PATCH',
          version,
          body: {
            requestedAmount: toAmount(form.amount),
            tenureMonths: Number(form.tenure),
            purposeCode: form.purpose || null,
            applicantType: form.applicantType,
          },
        });
        version = res.data.version;
      }
      // 2. Move the file on, when it is at this step and the step has a transition the caller may run.
      const forward = FORWARD[stage.key];
      if (forward && app.status === stage.status) {
        if (!hasPermission(me.data, forward.permission as never)) {
          await refresh();
          setNotice(
            `Saved. ${stage.movesOn} Your role cannot do that, so the file stays here until they do.`,
          );
          return;
        }
        await apiRequest<Application>(`/v1/applications/${app.id}/transitions`, {
          method: 'POST',
          version,
          body:
            forward.code === 'T-APP-01'
              ? { transitionCode: forward.code, productVersionId: versionId || app.productVersionId }
              : { transitionCode: forward.code },
        });
      }
      await refresh();
      if (last) onExit();
      else onStep(index + 1);
    } catch (e) {
      setFailure(errorText(e));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const draftFields = (
    <>
      <LoanRequestFields
        value={form}
        onChange={setForm}
        problems={shown}
        editable={editable}
        productCategory={app.productCategory}
      />
      {app.status === 'DRAFT' && (
        <ProductPicker
          productCategory={app.productCategory}
          productId={productId}
          versionId={versionId}
          onChange={(p, v) => {
            setProductId(p);
            setVersionId(v);
          }}
          problem={shown.find((p) => p.field === 'product')?.message}
        />
      )}
    </>
  );

  return (
    <Box data-testid="application.complete">
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <AppButton variant="ghost" onClick={onExit} dataTestId="application.back-to-overview">
          ← Back to overview
        </AppButton>
        <Typography variant="body2" color="text.secondary">
          Step {index + 1} of {JOURNEY.length}: {stage.label}
        </Typography>
      </Stack>
      <Box
        sx={{
          border: 1,
          borderColor: 'divider',
          borderRadius: '12px',
          bgcolor: 'background.paper',
          px: { xs: 1, md: 3 },
          py: 2,
          mb: 3,
        }}
      >
        <JourneyStepper state={journey} selected={index} onSelect={onStep} />
      </Box>

      <StagePanel
        app={app}
        journey={journey}
        index={index}
        onSelect={onStep}
        nextStep={otherActions}
        loanRequest={draftFields}
      />

      <Box
        data-testid="application.step-footer"
        sx={{
          position: 'sticky',
          bottom: 0,
          zIndex: 2,
          mt: 2,
          border: 1,
          borderColor: shown.length || failure ? 'error.light' : 'divider',
          borderRadius: '12px',
          bgcolor: 'background.paper',
          boxShadow: '0 -4px 16px rgba(15, 23, 42, 0.08)',
          p: 2,
        }}
      >
        {shown.length > 0 && (
          <Alert severity="error" sx={{ mb: 1.5 }} data-testid="application.step-problems">
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              Before you go on:
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {shown.map((p) => (
                <li key={p.field + p.message}>
                  <Typography variant="body2">{p.message}</Typography>
                </li>
              ))}
            </Box>
          </Alert>
        )}
        {failure && (
          <Alert severity="error" sx={{ mb: 1.5 }} data-testid="application.step-failure">
            {failure}
          </Alert>
        )}
        {notice && (
          <Alert severity="info" sx={{ mb: 1.5 }} data-testid="application.step-notice">
            {notice}
          </Alert>
        )}
        <Stack direction="row" spacing={1.5} justifyContent="space-between" alignItems="center">
          <AppButton
            variant="outlined"
            disabled={index === 0 || busy}
            onClick={() => onStep(index - 1)}
            dataTestId="application.step-previous"
          >
            Previous
          </AppButton>
          <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' } }}>
            {stage.movesOn}
          </Typography>
          <AppButton
            variant="primary"
            loading={busy}
            onClick={() => void saveAndNext()}
            dataTestId="application.step-next"
          >
            {last ? 'Finish' : 'Save & next'}
          </AppButton>
        </Stack>
      </Box>
    </Box>
  );
}
