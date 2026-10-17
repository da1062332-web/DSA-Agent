// Eligibility on the application page (owner: Dev 3; DSA Notion MODULE 17, API-ELG-001 to 003). Anyone who can read the
// application can run a check and see the history. An override needs eligibility.override and a reason, and applies only
// to a failed result. Until an eligibility rule set is published every result is "cannot be assessed yet".
import {
  Alert,
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
import { useState } from 'react';
import { hasPermission, useMe } from '../../api/useMe';
import { useCommand, useList } from '../admin/api';
import { ErrorAlert, Loading, StatusChip, formatDate } from '../admin/components';
import {
  NO_PROMISE,
  RESULT_LABELS,
  canOverride,
  isValidOverrideReason,
  latestAssessment,
  type EligibilityAssessment,
  type ProductResult,
} from './eligibility';

export function EligibilityCard({
  applicationId,
  hasProduct,
}: {
  applicationId: string;
  hasProduct: boolean;
}) {
  const me = useMe();
  const canRun = hasPermission(me.data, 'application.read');
  const canOverrideNow = hasPermission(me.data, 'eligibility.override');
  const path = `/v1/applications/${applicationId}/eligibility-assessments`;
  const history = useList<EligibilityAssessment>(path, {}, 50, canRun);
  const run = useCommand<Record<string, never>, EligibilityAssessment>(
    () => ({ path, method: 'POST' }),
    [[path]],
    'Eligibility checked.',
  );
  const [target, setTarget] = useState<{ assessment: EligibilityAssessment; result: ProductResult } | null>(
    null,
  );

  if (!canRun) return null;
  const rows = history.data?.pages.flatMap((p) => p.data) ?? [];
  const latest = latestAssessment(rows);

  return (
    <Card sx={{ mb: 3 }} data-testid="application.eligibility">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Eligibility
        </Typography>
        <Alert severity="info" sx={{ mb: 2 }}>
          {NO_PROMISE}
        </Alert>
        <ErrorAlert error={history.error ?? run.error} />
        {!hasProduct && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Choose a product for this application before checking eligibility.
          </Alert>
        )}
        <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
          <Button
            variant="contained"
            disabled={!hasProduct || run.isPending}
            onClick={() => run.mutate({})}
            data-testid="eligibility.run"
          >
            {latest ? 'Check again' : 'Check eligibility'}
          </Button>
        </Stack>

        {history.isPending ? (
          <Loading />
        ) : !latest ? (
          <Typography variant="body2" color="text.secondary">
            No eligibility check has been run for this application.
          </Typography>
        ) : (
          <>
            <Typography variant="subtitle2" gutterBottom>
              Latest check, {formatDate(latest.assessedAt)}
            </Typography>
            {latest.results.map((r) => (
              <Stack key={r.productVersionId} spacing={1} sx={{ mb: 2 }}>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Typography variant="body2">Product version {r.productVersionId}</Typography>
                  <StatusChip active={r.result === 'PASS'} label={RESULT_LABELS[r.result]} />
                  {canOverrideNow && canOverride(latest, r) && (
                    <Button size="small" onClick={() => setTarget({ assessment: latest, result: r })}>
                      Override
                    </Button>
                  )}
                </Stack>
                {r.criteria.map((c) => (
                  <Typography key={c.code} variant="caption" color="text.secondary">
                    {c.code}: {RESULT_LABELS[c.result]}. {c.reason}
                  </Typography>
                ))}
              </Stack>
            ))}
            {latest.overrides.map((o) => (
              <Alert key={`${o.productVersionId}-${o.overriddenAt}`} severity="warning" sx={{ mb: 1 }}>
                Overridden on {formatDate(o.overriddenAt)}: {o.reason}
              </Alert>
            ))}
            {rows.length > 1 && (
              <Typography variant="caption" color="text.secondary">
                {rows.length - 1} earlier check{rows.length - 1 === 1 ? '' : 's'} on record.
              </Typography>
            )}
          </>
        )}
      </CardContent>
      {target && (
        <OverrideDialog
          assessment={target.assessment}
          result={target.result}
          applicationPath={path}
          onClose={() => setTarget(null)}
        />
      )}
    </Card>
  );
}

function OverrideDialog({
  assessment,
  result,
  applicationPath,
  onClose,
}: {
  assessment: EligibilityAssessment;
  result: ProductResult;
  applicationPath: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const override = useCommand<{ productVersionId: string; reason: string }, EligibilityAssessment>(
    () => ({ path: `/v1/eligibility-assessments/${assessment.id}/overrides`, method: 'POST' }),
    [[applicationPath]],
    'Override recorded.',
  );
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Override this result</DialogTitle>
      <DialogContent>
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
          helperText="10 to 500 characters. Recorded in the audit trail."
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
