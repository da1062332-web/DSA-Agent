// Eligibility on the application page and in the eligibility screen (owner: Dev 3; DSA Notion MODULE 17, API-ELG-001 to 006).
// Anyone who can read the application sees the latest check and the history. Running a check needs application.update, and the
// applicant figures it reads are shown to the same people. An override needs eligibility.override and a reason, and applies only
// to a failed result on the latest check.
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiFetch } from '../../api/client';
import { hasPermission, useMe } from '../../api/useMe';
import { useCommand, useList } from '../admin/api';
import { ErrorAlert, LoadMore, Loading, StatusChip, formatDate } from '../admin/components';
import { EligibilityInputsPanel } from './EligibilityInputsPanel';
import {
  MISSING_DATA_TEXT,
  NO_PROMISE,
  RESULT_LABELS,
  canOverride,
  figuresChangedSince,
  isValidOverrideReason,
  type ApplicantInputs,
  needsAutoCheck,
  outcomeOf,
  type EligibilityAssessment,
  type ProductResult,
} from './eligibility';
import { STATUS_LABELS, TERMINAL, type ApplicationStatus } from './rules';

export function EligibilityCard({
  applicationId,
  applicationStatus,
  hasProduct,
  variant = 'card',
  autoRun = false,
  productVersionId,
  updatedAt,
  status,
}: {
  applicationId: string;
  applicationStatus: string;
  hasProduct: boolean;
  variant?: 'card' | 'dialog';
  /** Run a check without a click when the latest one is missing or out of date (see needsAutoCheck). */
  autoRun?: boolean;
  /** What the automatic run compares the latest check with. */
  productVersionId?: string | null;
  updatedAt?: string | null;
  status?: string;
}) {
  const me = useMe();
  const canRead = hasPermission(me.data, 'application.read');
  const canCheck = hasPermission(me.data, 'application.update');
  const canOverrideNow = hasPermission(me.data, 'eligibility.override');
  const closed = (TERMINAL as string[]).includes(applicationStatus);
  const path = `/v1/applications/${applicationId}/eligibility-assessments`;
  const latestPath = `${path}/latest`;
  const figuresPath = `/v1/applications/${applicationId}/eligibility-inputs`;
  // "No check yet" is a 404 from the latest endpoint, not a failure, so it is not retried.
  const latest = useQuery<EligibilityAssessment, ApiError>({
    queryKey: [latestPath],
    queryFn: () => apiFetch<EligibilityAssessment>(latestPath),
    enabled: canRead,
    retry: (count, err) => !(err instanceof ApiError && err.httpStatus === 404) && count < 2,
  });
  const history = useList<EligibilityAssessment>(path, {}, 50, canRead);
  // The same figures the panel shows (one cache entry), read only to say whether this check still reflects them.
  const figures = useQuery<ApplicantInputs, ApiError>({
    queryKey: [figuresPath],
    queryFn: () => apiFetch<ApplicantInputs>(figuresPath),
    enabled: canCheck,
  });
  const run = useCommand<Record<string, never>, EligibilityAssessment>(
    () => ({ path, method: 'POST' }),
    [[path], [latestPath]],
    'Eligibility checked.',
  );
  const [target, setTarget] = useState<{ assessment: EligibilityAssessment; result: ProductResult } | null>(
    null,
  );

  const noCheckYet = latest.error?.httpStatus === 404;
  const current = noCheckYet ? null : (latest.data ?? null);
  const rows = history.data?.pages.flatMap((p) => p.data) ?? [];
  const latestError = noCheckYet ? null : latest.error;
  const changed = current ? figuresChangedSince(figures.data, current.assessedAt) : false;

  // One automatic attempt per state of the application (success or not), so a failed run is not repeated in a loop.
  const attempted = useRef<string | null>(null);
  // Wait until both reads have settled: a check started before the latest one is known would repeat it.
  const settled = !latest.isPending && !history.isPending && (!latest.isError || noCheckYet);
  const due =
    autoRun &&
    settled &&
    needsAutoCheck({ hasProduct, status, productVersionId, updatedAt, latest: current ?? undefined });
  const { mutate: runCheck, isPending: running } = run;
  useEffect(() => {
    if (!canRead || !canCheck || !due || running) return;
    const state = [applicationId, productVersionId ?? '', updatedAt ?? ''].join('|');
    if (attempted.current === state) return;
    attempted.current = state;
    runCheck({});
  }, [canRead, canCheck, due, running, runCheck, applicationId, productVersionId, updatedAt]);

  if (!canRead) return null;

  const content = (
    <Stack spacing={2}>
      <Alert severity="info">{NO_PROMISE}</Alert>
      <ErrorAlert error={latestError ?? history.error ?? run.error} />
      {!hasProduct && (
        <Alert severity="warning">Choose a product for this application before checking eligibility.</Alert>
      )}
      {closed && (
        <Alert severity="info">
          This application is {STATUS_LABELS[applicationStatus as ApplicationStatus] ?? applicationStatus}.
          Its checks are kept for the record and cannot be run again.
        </Alert>
      )}
      {canCheck ? (
        <Stack direction="row" spacing={2} alignItems="center">
          <Button
            variant="contained"
            disabled={!hasProduct || closed || run.isPending}
            onClick={() => run.mutate({})}
            data-testid="eligibility.run"
          >
            {run.isPending ? 'Checking…' : current ? 'Check again' : 'Check eligibility'}
          </Button>
          {autoRun && (
            <Typography variant="caption" color="text.secondary">
              Runs by itself when the application has no current result or its product changes.
            </Typography>
          )}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Only people who can update this application can run a check.
        </Typography>
      )}

      {changed && (
        <Alert severity="info">
          The applicant figures changed after this check. Check again to see the result for the current
          figures.
        </Alert>
      )}
      {latest.isPending ? (
        <Loading />
      ) : !current ? (
        <Typography variant="body2" color="text.secondary">
          No eligibility check has been run for this application.
        </Typography>
      ) : (
        <LatestResult
          assessment={current}
          closed={closed}
          canOverrideNow={canOverrideNow}
          onOverride={(t) => setTarget(t)}
        />
      )}

      {rows.length > 0 && (
        <Stack spacing={1} data-testid="eligibility.history">
          <Typography variant="subtitle2">Checks on record, oldest first</Typography>
          {rows.map((a) => (
            <Stack key={a.id} direction="row" spacing={2} data-testid={`eligibility.history.${a.id}`}>
              <Typography variant="body2" sx={{ minWidth: 120 }}>
                {formatDate(a.assessedAt)}
              </Typography>
              <Typography variant="body2">
                {a.results.map((r) => RESULT_LABELS[r.result]).join('; ') || 'No result'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {a.ruleSetVersionNo ? `rule set version ${a.ruleSetVersionNo}` : 'no rule set used'}
              </Typography>
            </Stack>
          ))}
          <LoadMore
            hasNext={!!history.hasNextPage}
            loading={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          />
        </Stack>
      )}

      {canCheck && (
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Applicant figures used by the rules
          </Typography>
          <EligibilityInputsPanel applicationId={applicationId} status={applicationStatus} />
        </Box>
      )}
    </Stack>
  );

  return (
    <>
      {variant === 'card' ? (
        <Card sx={{ mb: 3 }} data-testid="application.eligibility">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Eligibility
            </Typography>
            {content}
          </CardContent>
        </Card>
      ) : (
        <Box data-testid="application.eligibility">{content}</Box>
      )}

      {target && (
        <OverrideDialog
          assessment={target.assessment}
          result={target.result}
          invalidate={[[path], [latestPath]]}
          onClose={() => setTarget(null)}
        />
      )}
    </>
  );
}

function LatestResult({
  assessment,
  closed,
  canOverrideNow,
  onOverride,
}: {
  assessment: EligibilityAssessment;
  closed: boolean;
  canOverrideNow: boolean;
  onOverride: (t: { assessment: EligibilityAssessment; result: ProductResult }) => void;
}) {
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Checked {formatDate(assessment.assessedAt)}
        {assessment.ruleSetVersionNo
          ? `, against the approved rule set, version ${assessment.ruleSetVersionNo}`
          : ', with no rule set in use'}
        .
      </Typography>
      {assessment.results.map((r) => {
        const outcome = outcomeOf(r);
        // The rule's indicative ceiling is not shown: whether users may see it is an open decision (PENDING_APPROVALS section 7, F).
        return (
          <Stack
            key={r.productVersionId}
            spacing={1}
            data-testid={`eligibility.result.${r.productVersionId}`}
          >
            <Alert severity={outcome.tone}>
              <strong>{outcome.title}</strong> {outcome.detail}
            </Alert>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
              <StatusChip active={r.result === 'PASS'} label={RESULT_LABELS[r.result]} />
              {canOverrideNow && !closed && canOverride(assessment, r) && (
                <Button size="small" onClick={() => onOverride({ assessment, result: r })}>
                  Override
                </Button>
              )}
            </Stack>
            {r.criteria.map((c) => (
              <Typography key={`${c.code}-${c.reason}`} variant="caption" color="text.secondary">
                {c.reason}
              </Typography>
            ))}
            {r.missingData.map((code) => (
              <Typography key={code} variant="body2">
                • {MISSING_DATA_TEXT[code] ?? MISSING_DATA_TEXT.FACT_MISSING}
              </Typography>
            ))}
          </Stack>
        );
      })}
      {assessment.overrides.map((o) => (
        <Alert key={`${o.productVersionId}-${o.overriddenAt}`} severity="warning">
          Overridden on {formatDate(o.overriddenAt)}: {o.reason}
        </Alert>
      ))}
      {assessment.decisionRecordIds.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          Decision record {assessment.decisionRecordIds[0]}
        </Typography>
      )}
    </Stack>
  );
}

function OverrideDialog({
  assessment,
  result,
  invalidate,
  onClose,
}: {
  assessment: EligibilityAssessment;
  result: ProductResult;
  invalidate: string[][];
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const override = useCommand<{ productVersionId: string; reason: string }, EligibilityAssessment>(
    () => ({ path: `/v1/eligibility-assessments/${assessment.id}/overrides`, method: 'POST' }),
    invalidate,
    'Override recorded.',
  );
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Override this result</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>
          The override applies to this result for these applicant figures only. If the figures change and the
          result still fails, a new check can be overridden with a new reason.
        </Alert>
        <ErrorAlert error={override.error} />
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={3}
          margin="dense"
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          helperText="10 to 500 characters. Do not enter PAN, Aadhaar or account numbers. Recorded in the audit trail."
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={override.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={override.isPending || !isValidOverrideReason(reason)}
          onClick={() =>
            override.mutate(
              { productVersionId: result.productVersionId, reason: reason.trim() },
              { onSuccess: onClose },
            )
          }
        >
          Override
        </Button>
      </DialogActions>
    </Dialog>
  );
}
