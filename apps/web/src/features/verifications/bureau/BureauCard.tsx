// apps/web/src/features/verifications/bureau/BureauCard.tsx — owner: Prathamesh (MOD-VER web, P1-05). The "Credit bureau report" card of the customer
// page: the consent of a bureau, the latest report, a Pull report dialog and the history (API-CRP-001 to 003). The attempt, its Idempotency-Key
// and the money discipline are in bureau-pull-session.ts; this file only draws them. The PAN, date of birth and name typed in the dialog live in
// the session's state and nowhere else (not in the URL, storage, the query cache or the console), and are cleared as soon as a report is shown.
// A report holds no identifier, so reports and consents may live in the query cache.
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link as RouterLink } from 'react-router-dom';
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
  DialogTitle,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreditBureau, CreditReport } from '@dsa/contracts';
import { newIdempotencyKey } from '../../../api/client';
import { Can, useCan } from '../../../shell/Can';
import { getCustomerConsents } from '../../customers/api';
import { BureauPullSession } from './bureau-pull-session';
import {
  BUREAUS,
  BUREAU_LABELS,
  CACHE_NOTE,
  CONSENT_TEXT,
  consentStatusFor,
  describeReadError,
  fetchCreditReportHistory,
  fetchLatestCreditReport,
  formatRupees,
  outcomeText,
  pullCreditReport,
} from './credit-reports';

const tid = (element: string) => `customers.bureau-${element}`;

const when = (iso: string) => new Date(iso).toLocaleString();

function Row({ label, testId, children }: { label: string; testId: string; children: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={1} alignItems="baseline">
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 220 }}>
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={600} data-testid={testId}>
        {children}
      </Typography>
    </Stack>
  );
}

/** The card is for people who may read credit reports; for everyone else it is not on the page at all. */
export function BureauCard(props: {
  customerId: string;
  customerName?: string;
  session?: BureauPullSession;
  defaultDialogOpen?: boolean;
}) {
  return (
    <Can action="credit_report.read">
      <BureauCardBody {...props} />
    </Can>
  );
}

function ReportView({ report }: { report: CreditReport }) {
  const scored = report.outcome === 'SCORED';
  const cost = formatRupees(report.cost);
  return (
    <Stack spacing={1} data-testid={tid('result')}>
      {scored && report.score !== null ? (
        <Stack direction="row" spacing={1} alignItems="baseline">
          <Typography variant="h3" fontWeight={700} data-testid={tid('score')}>
            {report.score}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            of 300 to 900
          </Typography>
        </Stack>
      ) : null}
      <Typography variant="body1" fontWeight={600} data-testid={tid('outcome')}>
        {outcomeText(report)}
      </Typography>
      <Row label="Report date" testId={tid('report-date')}>
        {report.reportDate}
      </Row>
      {scored && (
        <>
          <Row label="Active accounts" testId={tid('accounts')}>
            {report.activeAccounts ?? '—'}
          </Row>
          <Row label="Monthly EMIs" testId={tid('emi')}>
            {formatRupees(report.monthlyEmi) ?? '—'}
          </Row>
          <Row label="Highest days past due, last 12 months" testId={tid('dpd')}>
            {report.maxDpd12m ?? '—'}
          </Row>
          <Row label="Enquiries, last 6 months" testId={tid('enquiries')}>
            {report.enquiries6m ?? '—'}
          </Row>
        </>
      )}
      {report.vendorRef && (
        <Row label="Vendor reference" testId={tid('vendor-ref')}>
          {report.vendorRef}
        </Row>
      )}
      {cost && (
        <Row label="Cost of the pull" testId={tid('cost')}>
          {cost}
        </Row>
      )}
      <Typography variant="caption" color="text.secondary">
        Pulled {when(report.pulledAt)} through {report.provider}
      </Typography>
    </Stack>
  );
}

function BureauCardBody({
  customerId,
  customerName,
  session: injected,
  defaultDialogOpen = false,
}: {
  customerId: string;
  customerName?: string;
  session?: BureauPullSession;
  defaultDialogOpen?: boolean;
}) {
  const queryClient = useQueryClient();
  const canPull = useCan('credit_report.pull');
  const [bureau, setBureau] = useState<CreditBureau>('CIBIL');
  const [dialogOpen, setDialogOpen] = useState(defaultDialogOpen);
  // The customer's name only prefills the form of a new attempt: a change of it must never replace a session that has an attempt open.
  const nameRef = useRef(customerName ?? '');
  nameRef.current = customerName ?? '';

  const session = useMemo(
    () =>
      injected ??
      new BureauPullSession(
        {
          call: (body, key) => pullCreditReport(customerId, body, key),
          newKey: newIdempotencyKey,
          now: () => new Date(),
          // The reports are read again; the report itself is not put into the cache by hand. The dialog closes.
          onResult: () => {
            setDialogOpen(false);
            void queryClient.invalidateQueries({ queryKey: ['credit-report-latest', customerId] });
            void queryClient.invalidateQueries({ queryKey: ['credit-report-history', customerId] });
          },
        },
        nameRef.current,
      ),
    [injected, customerId, queryClient],
  );
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  // Leaving the page forgets what was typed.
  useEffect(() => () => session.dispose(), [session]);

  const consents = useQuery({
    queryKey: ['customer-consents', customerId],
    queryFn: () => getCustomerConsents(customerId),
    retry: false,
  });
  const latest = useQuery({
    queryKey: ['credit-report-latest', customerId, bureau],
    queryFn: () => fetchLatestCreditReport(customerId, bureau),
    retry: false,
  });
  const history = useInfiniteQuery({
    queryKey: ['credit-report-history', customerId, bureau],
    queryFn: ({ pageParam }) => fetchCreditReportHistory(customerId, bureau, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    retry: false,
  });

  const consent = consentStatusFor(consents.isSuccess ? consents.data : undefined, bureau, new Date());
  const pullBlocked = consent.kind !== 'ACTIVE' && consent.kind !== 'UNKNOWN';
  const attemptOpen = state.phase === 'failed' || state.phase === 'sending';
  const sending = state.phase === 'sending';
  const editing = state.phase === 'editing';
  const reports = history.data?.pages.flatMap((page) => page.data) ?? [];

  const openDialog = () => {
    if (state.phase === 'done') session.newPull();
    setDialogOpen(true);
  };
  const closeDialog = () => {
    // An open attempt is kept (a failed one can still be retried, one in flight still finishes); an unfinished form is forgotten.
    if (state.phase === 'editing') session.cancel();
    setDialogOpen(false);
  };

  const text = (
    field: 'name' | 'pan' | 'dateOfBirth',
    label: string,
    testId: string,
    extra: Record<string, unknown> = {},
  ) => (
    <TextField
      size="small"
      fullWidth
      label={label}
      value={state.form[field]}
      onChange={(e) => session.setField(field, e.target.value)}
      disabled={!editing}
      error={Boolean(state.fieldErrors[field])}
      helperText={state.fieldErrors[field]}
      // Typed for this one pull only: no autofill, no spell-check, no suggestions.
      autoComplete="off"
      spellCheck={false}
      inputProps={{ 'data-testid': tid(testId), ...extra }}
    />
  );

  return (
    <Card elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 2 }} data-testid={tid('card')}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6" fontWeight="bold">
            Credit bureau report
          </Typography>
          <TextField
            select
            size="small"
            label="Bureau"
            value={bureau}
            onChange={(e) => setBureau(e.target.value as CreditBureau)}
            sx={{ minWidth: 160 }}
            data-testid={tid('bureau')}
          >
            {BUREAUS.map((b) => (
              <MenuItem key={b} value={b}>
                {BUREAU_LABELS[b]}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          sx={{ mb: 2 }}
          data-testid={tid('consent-status')}
        >
          <Chip
            size="small"
            label={
              consent.kind === 'ACTIVE'
                ? 'Consent active'
                : consent.kind === 'UNKNOWN'
                  ? 'Consent unknown'
                  : 'No active consent'
            }
            color={consent.kind === 'ACTIVE' ? 'success' : consent.kind === 'UNKNOWN' ? 'default' : 'warning'}
          />
          <Typography variant="body2" color="text.secondary">
            {consent.kind === 'ACTIVE'
              ? `Given for ${BUREAU_LABELS[bureau]} on ${when(consent.capturedAt)} (${consent.channel.toLowerCase().replace('_', ' ')}).`
              : CONSENT_TEXT[consent.kind]}
          </Typography>
          {consent.kind !== 'ACTIVE' && (
            <Button
              size="small"
              component={RouterLink}
              to={`/customers/${encodeURIComponent(customerId)}/consents`}
              data-testid={tid('record-consent-link')}
            >
              Record consent
            </Button>
          )}
        </Stack>

        {state.phase === 'done' && state.report && (
          <Alert severity="success" sx={{ mb: 2 }} data-testid={tid('done')}>
            {state.report.outcome === 'SCORED'
              ? 'The report was pulled.'
              : `The bureau holds no history for this customer.`}
            {state.cached && (
              <Typography variant="body2" component="div" data-testid={tid('cached-note')}>
                {CACHE_NOTE}
              </Typography>
            )}
          </Alert>
        )}

        {latest.isLoading ? (
          <CircularProgress size={22} />
        ) : latest.isError ? (
          <Alert severity="error" data-testid={tid('read-error')}>
            {describeReadError(latest.error).message}
            {describeReadError(latest.error).correlationId && (
              <Typography variant="caption" component="div">
                Reference to quote to support: {describeReadError(latest.error).correlationId}
              </Typography>
            )}
          </Alert>
        ) : latest.data ? (
          <ReportView report={latest.data} />
        ) : (
          <Typography variant="body2" color="text.secondary" data-testid={tid('none')}>
            No report pulled yet.
          </Typography>
        )}

        <Can action="credit_report.pull">
          <Box sx={{ mt: 2 }}>
            <Button
              variant="contained"
              onClick={openDialog}
              disabled={pullBlocked || sending || !canPull}
              data-testid={tid('pull')}
            >
              {sending
                ? 'Pulling…'
                : state.phase === 'failed'
                  ? 'Resume pull'
                  : latest.data
                    ? 'Pull again'
                    : 'Pull report'}
            </Button>
            {pullBlocked && (
              <Typography
                variant="caption"
                color="text.secondary"
                component="div"
                sx={{ mt: 0.5 }}
                data-testid={tid('pull-blocked')}
              >
                {CONSENT_TEXT[consent.kind as keyof typeof CONSENT_TEXT]} Record the consent first.
              </Typography>
            )}
          </Box>
        </Can>

        <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 3, mb: 1 }}>
          History
        </Typography>
        {history.isLoading ? (
          <CircularProgress size={22} />
        ) : history.isError ? (
          <Alert severity="error">{describeReadError(history.error).message}</Alert>
        ) : reports.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {`No reports pulled for ${BUREAU_LABELS[bureau]}.`}
          </Typography>
        ) : (
          <>
            <Table size="small" data-testid={tid('history')}>
              <TableHead>
                <TableRow>
                  <TableCell>Pulled</TableCell>
                  <TableCell>Outcome</TableCell>
                  <TableCell align="right">Score</TableCell>
                  <TableCell align="right">Monthly EMIs</TableCell>
                  <TableCell align="right">Days past due</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.id} data-testid={tid('history-row')}>
                    <TableCell>{when(r.pulledAt)}</TableCell>
                    <TableCell>{r.outcome === 'SCORED' ? 'Scored' : 'No history'}</TableCell>
                    <TableCell align="right">{r.score ?? '—'}</TableCell>
                    <TableCell align="right">{formatRupees(r.monthlyEmi) ?? '—'}</TableCell>
                    <TableCell align="right">{r.maxDpd12m ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {history.hasNextPage && (
              <Button
                size="small"
                sx={{ mt: 1 }}
                onClick={() => void history.fetchNextPage()}
                disabled={history.isFetchingNextPage}
                data-testid={tid('load-more')}
              >
                {history.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            )}
          </>
        )}
      </CardContent>

      <Dialog
        open={dialogOpen && state.phase !== 'done'}
        onClose={closeDialog}
        disablePortal
        fullWidth
        maxWidth="sm"
        data-testid={tid('dialog')}
      >
        <Box
          component="form"
          noValidate
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            void session.submit(state.bureau ?? bureau);
          }}
        >
          <DialogTitle>{`Pull a ${BUREAU_LABELS[state.bureau ?? bureau]} report`}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                The PAN, date of birth and name are sent to the bureau for this pull only. They are not saved,
                and only the summary of the report is kept. The bureau may charge for each pull; a report
                pulled in the last 24 hours is shown again without a new charge.
              </Typography>
              {text('name', 'Name as the bureau should match it', 'name')}
              {text('pan', 'PAN', 'pan', { maxLength: 10 })}
              {text('dateOfBirth', 'Date of birth (YYYY-MM-DD)', 'dob', {
                inputMode: 'numeric',
                placeholder: 'YYYY-MM-DD',
                maxLength: 10,
              })}

              {state.phase === 'failed' && state.error && (
                <Alert severity="error" data-testid={tid('error')}>
                  <AlertTitle>{state.error.title}</AlertTitle>
                  {state.error.message}
                  {state.error.correlationId && (
                    <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
                      Reference to quote to support: {state.error.correlationId}
                    </Typography>
                  )}
                  {state.error.canRetry ? (
                    <>
                      <Typography
                        variant="caption"
                        component="div"
                        sx={{ mt: 0.5 }}
                        data-testid={tid('stop-note')}
                      >
                        If you stop here and pull again later, the bureau may charge a second time should this
                        request have reached it.
                      </Typography>
                      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => void session.retry()}
                          data-testid={tid('retry')}
                        >
                          Try again
                        </Button>
                        <Button size="small" onClick={() => session.discard()} data-testid={tid('stop')}>
                          Stop this pull
                        </Button>
                      </Stack>
                    </>
                  ) : (
                    <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => session.editRequest()}
                        data-testid={tid('edit-request')}
                      >
                        Change the request
                      </Button>
                    </Stack>
                  )}
                </Alert>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={closeDialog} data-testid={tid('cancel')}>
              {attemptOpen ? 'Close' : 'Cancel'}
            </Button>
            {(editing || sending) && (
              <Button
                type="submit"
                variant="contained"
                disabled={!editing}
                startIcon={sending ? <CircularProgress size={16} /> : undefined}
                data-testid={tid('submit')}
              >
                {sending ? 'Pulling…' : 'Pull report'}
              </Button>
            )}
          </DialogActions>
        </Box>
      </Dialog>
    </Card>
  );
}
