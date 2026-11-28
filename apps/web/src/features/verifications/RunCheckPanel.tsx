// apps/web/src/features/verifications/RunCheckPanel.tsx — owner: Prathamesh (MOD-VER web, P1-06). "Run a provider check" on the verification
// workbench: the server runs a PAN, GST or bank-account (₹1 penny drop) check at the tenant's provider and stores the result
// (POST /v1/verifications/checks, API-VER-003). The attempt, its Idempotency-Key and the ₹1 rule are in run-check-session.ts; this file
// only draws them. The PAN, GSTIN, account number and name live in the session's state and nowhere else (not in the URL, storage, the
// query cache or the console), and they are cleared as soon as a result is shown.
import React, { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import type { VerificationRecord, VerificationResult } from '@dsa/contracts';
import { newIdempotencyKey } from '../../api/client';
import { Can } from '../../shell/Can';
import {
  NEW_BANK_CHECK_WARNING,
  RUN_CHECK_KINDS,
  RUN_CHECK_LABELS,
  SUBJECT_TYPE_LABELS,
  describeReason,
  isUnknownOutcome,
  runVerificationCheck,
  unknownOutcomeWarning,
  type RunCheckKind,
} from './run-check';
import { RunCheckSession } from './run-check-session';

const tid = (element: string) => `verifications.run-check-${element}`;

const RESULT_COLORS: Record<VerificationResult, 'success' | 'error' | 'warning' | 'default'> = {
  VERIFIED: 'success',
  REJECTED: 'error',
  FLAGGED: 'warning',
  INCONCLUSIVE: 'default',
};

/** The panel is for people who may perform verifications; for everyone else it is not on the page at all. */
export function RunCheckPanel({ session }: { session?: RunCheckSession }) {
  return (
    <Can action="verification.perform">
      <RunCheckCard session={session} />
    </Can>
  );
}

function Row({ label, testId, children }: { label: string; testId: string; children: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={1} alignItems="baseline">
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 150 }}>
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={600} data-testid={testId}>
        {children}
      </Typography>
    </Stack>
  );
}

function ResultView({ record }: { record: VerificationRecord }) {
  const unknown = isUnknownOutcome(record);
  const { maskedIdentifier, nameMatchScore, providerReference, discrepancies = [] } = record.minimalResult;
  // The unknown-outcome warning already says it; the other reasons are listed.
  const reasons = discrepancies.filter((code) => !(unknown && code === 'OUTCOME_UNKNOWN'));
  return (
    <Stack spacing={1.5} data-testid={tid('result')}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Chip
          label={record.result}
          color={unknown ? 'warning' : RESULT_COLORS[record.result]}
          size="small"
          sx={{ fontWeight: 700 }}
          data-testid={tid('result-chip')}
        />
        <Typography variant="body2" color="text.secondary">
          {record.checkType in RUN_CHECK_LABELS
            ? RUN_CHECK_LABELS[record.checkType as RunCheckKind]
            : record.checkType}
        </Typography>
      </Stack>
      {unknown && (
        <Alert severity="warning" data-testid={tid('unknown-warning')}>
          {unknownOutcomeWarning(record.evidenceRef)}
        </Alert>
      )}
      <Row label="Identifier" testId={tid('masked-identifier')}>
        {maskedIdentifier ?? '—'}
      </Row>
      {nameMatchScore !== undefined && (
        <Row label="Name match" testId={tid('name-score')}>
          {`${nameMatchScore} / 100`}
        </Row>
      )}
      {providerReference && (
        <Row label="Provider reference" testId={tid('provider-reference')}>
          {providerReference}
        </Row>
      )}
      <Row label="Evidence reference" testId={tid('evidence-ref')}>
        {record.evidenceRef}
      </Row>
      {reasons.length > 0 && (
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {reasons.map((code) => (
            <Typography component="li" variant="body2" key={code} data-testid={tid('reason')}>
              {describeReason(code)}
            </Typography>
          ))}
        </Box>
      )}
    </Stack>
  );
}

function RunCheckCard({ session: injected }: { session?: RunCheckSession }) {
  const queryClient = useQueryClient();
  const session = useMemo(
    () =>
      injected ??
      new RunCheckSession({
        call: runVerificationCheck,
        newKey: newIdempotencyKey,
        // The records list shows the new record. The result itself is never put into the query cache.
        onResult: () => {
          void queryClient.invalidateQueries({ queryKey: ['verifications'] });
        },
      }),
    [injected, queryClient],
  );
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  // Leaving the page forgets what was typed.
  useEffect(() => () => session.dispose(), [session]);

  const { form, fieldErrors, phase } = state;
  const view = phase === 'confirm-new' ? (state.confirmFrom ?? 'done') : phase;
  const editing = phase === 'editing';
  const isBank = form.check === 'BANK_ACCOUNT';
  const error = view === 'failed' ? state.error : null;

  const text = (
    field: keyof typeof form,
    label: string,
    testId: string,
    extra: Record<string, unknown> = {},
  ) => (
    <TextField
      size="small"
      fullWidth
      label={label}
      value={form[field]}
      onChange={(e) => session.setField(field, e.target.value as never)}
      disabled={!editing}
      error={Boolean(fieldErrors[field])}
      helperText={fieldErrors[field]}
      // Typed for this one check only: no autofill, no spell-check, no suggestions.
      autoComplete="off"
      spellCheck={false}
      inputProps={{ 'data-testid': tid(testId), ...extra }}
    />
  );

  return (
    <Card
      elevation={0}
      sx={{ border: '1px solid #e2e8f0', borderRadius: 2, mb: 3 }}
      data-testid={tid('panel')}
    >
      <CardContent>
        <Typography variant="subtitle1" fontWeight={700}>
          Run a provider check
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          The server asks the verification provider and stores the answer. What you type here is used for this
          check only: it is not saved, and only masked values are shown.
        </Typography>

        {view === 'done' && state.record ? (
          <Stack spacing={2}>
            <ResultView record={state.record} />
            <Box>
              <Button variant="outlined" onClick={() => session.newCheck()} data-testid={tid('new-check')}>
                {isUnknownOutcome(state.record) ? 'Start a new bank check' : 'New check'}
              </Button>
            </Box>
          </Stack>
        ) : (
          <Box
            component="form"
            noValidate
            onSubmit={(e: React.FormEvent) => {
              e.preventDefault();
              void session.submit();
            }}
          >
            <Stack spacing={2} sx={{ maxWidth: 560 }}>
              <TextField
                select
                size="small"
                label="Check"
                value={form.check}
                onChange={(e) => session.setCheck(e.target.value as RunCheckKind)}
                disabled={!editing}
                data-testid={tid('type')}
              >
                {RUN_CHECK_KINDS.map((kind) => (
                  <MenuItem key={kind} value={kind}>
                    {RUN_CHECK_LABELS[kind]}
                  </MenuItem>
                ))}
              </TextField>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  select
                  size="small"
                  label="Check is about"
                  value={form.subjectType}
                  onChange={(e) => session.setField('subjectType', e.target.value as typeof form.subjectType)}
                  disabled={!editing}
                  sx={{ minWidth: 190 }}
                  data-testid={tid('subject-type')}
                >
                  {Object.entries(SUBJECT_TYPE_LABELS).map(([value, label]) => (
                    <MenuItem key={value} value={value}>
                      {label}
                    </MenuItem>
                  ))}
                </TextField>
                {text('subjectId', 'Customer, application or lead id', 'subject-id')}
              </Stack>
              {text('consentRecordId', 'Consent record id (cnst_…)', 'consent-id')}

              {isBank ? (
                <>
                  {text('accountNumber', 'Account number', 'account-number', { inputMode: 'numeric' })}
                  {text('ifsc', 'IFSC code', 'ifsc')}
                  <Alert severity="info" data-testid={tid('bank-note')}>
                    A bank check sends ₹1 to the account to read the name the bank holds. It is sent once for
                    each check.
                  </Alert>
                </>
              ) : (
                text('idNumber', form.check === 'GST' ? 'GSTIN' : 'PAN', 'id-number')
              )}
              {text('name', 'Name to compare (optional)', 'name')}

              {error && (
                <Alert severity="error" data-testid={tid('error')}>
                  <AlertTitle>{error.title}</AlertTitle>
                  {error.message}
                  {error.correlationId && (
                    <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
                      Reference to quote to support: {error.correlationId}
                    </Typography>
                  )}
                  {error.canRetry && isBank && (
                    <Typography
                      variant="caption"
                      component="div"
                      sx={{ mt: 0.5 }}
                      data-testid={tid('leave-note')}
                    >
                      Stay on this page until this check ends. If you leave, this attempt is forgotten, and a
                      new bank check sends ₹1 again.
                    </Typography>
                  )}
                  <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                    {error.canRetry ? (
                      <>
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => void session.retry()}
                          data-testid={tid('retry')}
                        >
                          Try again
                        </Button>
                        <Button size="small" onClick={() => session.discard()} data-testid={tid('discard')}>
                          Cancel this check
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => session.editRequest()}
                        data-testid={tid('edit-request')}
                      >
                        Change the request
                      </Button>
                    )}
                  </Stack>
                </Alert>
              )}

              {(editing || phase === 'sending') && (
                <Box>
                  <Button
                    type="submit"
                    variant="contained"
                    disabled={!editing}
                    startIcon={phase === 'sending' ? <CircularProgress size={16} /> : undefined}
                    data-testid={tid('submit')}
                  >
                    {phase === 'sending' ? 'Running…' : isBank ? 'Run check (sends ₹1)' : 'Run check'}
                  </Button>
                </Box>
              )}
            </Stack>
          </Box>
        )}
      </CardContent>

      {/* Only an attempt that may already have sent the ₹1 asks for this: it is shown over the result or the failed attempt. */}
      <Dialog
        open={phase === 'confirm-new'}
        onClose={() => session.cancelNew()}
        disablePortal
        data-testid={tid('confirm-dialog')}
      >
        <DialogTitle>Start a new bank check?</DialogTitle>
        <DialogContent>
          <DialogContentText>{NEW_BANK_CHECK_WARNING}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => session.cancelNew()} data-testid={tid('cancel-new')}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => session.confirmNew()}
            data-testid={tid('confirm-new')}
          >
            Yes, start a new bank check
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
