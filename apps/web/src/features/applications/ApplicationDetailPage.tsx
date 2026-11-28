// /applications/:id, the loan file (DSA Notion MODULE 16, API-APP-003, 004, 006, 010, 011; redesigned 2026-11-28 by Bhushan).
// Laid out like a loan file: a front sheet (loan, borrower, amount, the stage on the road from draft to disbursal), the next step,
// then tabs for the overview, applicants, loan and security, documents, eligibility, lenders and activity, with the people and the
// hold in a side rail. Every change sends the version the screen loaded (If-Match), so a stale screen gets the conflict message.
// The tab is in the address (?tab=documents), so a link can open the file on the right page.
import {
  Alert,
  Box,
  Card,
  CardContent,
  Collapse,
  Link,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { LeadFollowUps } from '../leads/LeadFollowUps';
import { LenderCasePanel } from '../lender-cases/LenderCasePanel';
import { hasPermission, useMe } from '../../api/useMe';
import { useCommand, useLookup, useResource } from '../admin/api';
import { ErrorAlert, Loading, formatDate } from '../admin/components';
import type { Product, ProductVersion } from '../admin/ProductsPage';
import type { Application } from './ApplicationsPage';
import { ChecklistCard } from '../documents/ChecklistCard';
import { OwnersCard } from './ApplicationFileCards';
import { CollateralCard } from './CollateralCard';
import { StatusLinkCard } from './StatusLinkCard';
import { EligibilityCard } from './EligibilityCard';

import { UserName } from '../../shell/display';
import { AppButton, FieldGrid } from '../../ui';
import {
  APPLICANT_TYPE_LABELS,
  FILE_TABS,
  asFileTab,
  humanize,
  journeyState,
  type FileTab,
} from './loan-file';
import { ApplicantsTab } from './file/ApplicantsTab';
import { LoanFileHeader } from './file/LoanFileHeader';
import { OverviewTab, Section } from './file/OverviewTab';
import { StatusTimeline, type StatusHistoryEntry } from './file/StatusTimeline';
import { LenderMatchesCard } from './LenderMatchesCard';
import {
  CLOSABLE,
  STATUS_LABELS,
  canEditDetails,
  canHold,
  isValidAmount,
  isValidHoldReason,
  isValidTenure,
  isValidTransitionReason,
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

function getAmountString(amt: unknown): string {
  if (amt == null) return '';
  if (typeof amt === 'object' && amt !== null) return String((amt as { amount?: unknown }).amount ?? '');
  return String(amt);
}

export function ApplicationDetailPage() {
  const { id } = useParams();
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const tab = asFileTab(params.get('tab'));
  const canUpdate = hasPermission(me.data, 'application.update');
  const app = useResource<Application>(id ? `/v1/applications/${id}` : null);
  const history = useLookup<StatusHistoryEntry>(id ? `/v1/applications/${id}/status-history` : '', {}, !!id);

  if (app.isPending) return <Loading />;
  if (!app.data) return <ErrorAlert error={app.error} />;
  const a = app.data;
  const entries = history.data ?? [];
  const open = (t: FileTab) => {
    const next = new URLSearchParams(params);
    if (t === 'overview') next.delete('tab');
    else next.set('tab', t);
    setParams(next, { replace: true });
  };

  return (
    <Box data-testid="application.file">
      <LoanFileHeader app={a} journey={journeyState(a.status, entries)} />
      {a.onHold && (
        <Alert severity="warning" sx={{ mb: 2 }} data-testid="application.hold-banner">
          On hold: {a.holdReason ?? 'no reason recorded'}
          {a.holdUntil ? ` until ${formatDate(a.holdUntil)}` : ''}.
        </Alert>
      )}
      {a.reworkReason && a.status === 'DOCUMENTS_PENDING' && (
        <Alert severity="info" sx={{ mb: 2 }} data-testid="application.rework-reason">
          Sent back for rework: {a.reworkReason}
        </Alert>
      )}

      <Box
        sx={{
          display: 'grid',
          gap: 3,
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 320px' },
          alignItems: 'start',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <TransitionCard app={a} />
          <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
            <Tabs
              value={tab}
              onChange={(_e, v: FileTab) => open(v)}
              variant="scrollable"
              scrollButtons={false}
              aria-label="Loan file sections"
            >
              {FILE_TABS.map((t) => (
                <Tab
                  key={t.key}
                  value={t.key}
                  label={t.label}
                  data-testid={`application.tab-${t.key}`}
                  sx={{ textTransform: 'none', fontWeight: 600, minWidth: 0, px: 1.5 }}
                />
              ))}
            </Tabs>
          </Box>

          {tab === 'overview' && <OverviewTab app={a} history={entries} onOpen={open} />}
          {tab === 'applicants' && <ApplicantsTab app={a} />}
          {tab === 'loan' && (
            <>
              <DetailsCard app={a} canEdit={canUpdate && canEditDetails(a.status)} />
              <CollateralCard app={a} />
            </>
          )}
          {tab === 'documents' && <ChecklistCard applicationId={a.id} />}
          {tab === 'eligibility' && (
            <EligibilityCard
              applicationId={a.id}
              applicationStatus={a.status}
              hasProduct={!!a.productVersionId}
              autoRun
              productVersionId={a.productVersionId}
              updatedAt={a.updatedAt}
              status={a.status}
            />
          )}
          {tab === 'lenders' && (
            <>
              <LenderMatchesCard applicationId={a.id} productCategory={a.productCategory} />
              <div data-slot="application.lender-cases">
                <LenderCasePanel applicationId={a.id} />
              </div>
            </>
          )}
          {tab === 'activity' && (
            <Stack spacing={3}>
              <Section title="Status history" testId="application.activity-history">
                <StatusTimeline entries={entries} />
              </Section>
              <LeadFollowUps subjectType="LOAN_APPLICATION" subjectId={a.id} />
            </Stack>
          )}
        </Box>

        <Stack
          spacing={3}
          sx={{ position: { lg: 'sticky' }, top: { lg: 88 } }}
          data-testid="application.rail"
        >
          <PeopleCard app={a} />
          <StatusLinkCard applicationId={a.id} />
          <HoldCard app={a} canHoldNow={canUpdate && canHold(a.status)} />
        </Stack>
      </Box>
    </Box>
  );
}

/** Who owns the file: the sales owner and the operations owner, with the change form behind a link. */
function PeopleCard({ app }: { app: Application }) {
  const me = useMe();
  const [changing, setChanging] = useState(false);
  const canAssign = hasPermission(me.data, 'application.assign');
  return (
    <Section
      title="People"
      testId="application.people"
      action={
        canAssign ? (
          <Link
            component="button"
            type="button"
            variant="body2"
            underline="hover"
            onClick={() => setChanging((c) => !c)}
            data-testid="application.change-owners"
          >
            {changing ? 'Close' : 'Change'}
          </Link>
        ) : undefined
      }
    >
      <PersonLine role="Sales owner" id={app.salesOwnerId} />
      <PersonLine role="Operations owner" id={app.opsOwnerId} />
      <Collapse in={changing} unmountOnExit>
        <Box sx={{ mt: 2, mx: -2.5, mb: -5 }}>
          <OwnersCard app={app} />
        </Box>
      </Collapse>
    </Section>
  );
}

function PersonLine({ role, id }: { role: string; id: string | null }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 0.75 }}>
      <Box
        sx={{
          width: 30,
          height: 30,
          borderRadius: '50%',
          bgcolor: id ? 'primary.main' : 'grey.200',
          color: id ? '#fff' : 'text.disabled',
          display: 'grid',
          placeItems: 'center',
          fontSize: 12,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {role.charAt(0)}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" component="div">
          {role}
        </Typography>
        <Typography variant="body2" component="div" sx={{ fontWeight: 600 }}>
          <UserName id={id} fallback="Not assigned" />
        </Typography>
      </Box>
    </Stack>
  );
}

function DetailsCard({ app, canEdit }: { app: Application; canEdit: boolean }) {
  const [amount, setAmount] = useState(() => getAmountString(app.requestedAmount));
  const [tenure, setTenure] = useState(app.tenureMonths ? String(app.tenureMonths) : '');
  const [purpose, setPurpose] = useState(app.purposeCode ?? '');
  const [applicantType, setApplicantType] = useState(app.applicantType);
  useEffect(() => {
    setAmount(getAmountString(app.requestedAmount));
    setTenure(app.tenureMonths ? String(app.tenureMonths) : '');
    setPurpose(app.purposeCode ?? '');
    setApplicantType(app.applicantType);
  }, [app]);

  const save = useCommand<object, Application>(
    () => ({ path: `/v1/applications/${app.id}`, method: 'PATCH', version: app.version }),
    [[`/v1/applications/${app.id}`], ['/v1/applications']],
  );
  const dirty =
    amount.trim() !== getAmountString(app.requestedAmount) ||
    tenure !== (app.tenureMonths ? String(app.tenureMonths) : '') ||
    (purpose || null) !== app.purposeCode ||
    applicantType !== app.applicantType;
  const valid = isValidAmount(amount) && (tenure === '' || isValidTenure(tenure));

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Loan request
        </Typography>
        <ErrorAlert error={save.error} />
        {!canEditDetails(app.status) && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Details can be edited while the application is Draft or Documents pending. It is{' '}
            {STATUS_LABELS[app.status]}.
          </Typography>
        )}
        <FieldGrid minColumnWidth={260} spanNonFields>
          <TextField
            label="Requested amount (INR)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={!canEdit}
            error={amount !== '' && !isValidAmount(amount)}
            helperText="Decimal, for example 300000.00"
            onKeyDown={(e) => {
              if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault();
            }}
          />
          <TextField
            label="Tenure (months)"
            type="number"
            value={tenure}
            onChange={(e) => setTenure(e.target.value)}
            disabled={!canEdit}
            error={tenure !== '' && !isValidTenure(tenure)}
            helperText="1 to 480"
            inputProps={{ min: 1, max: 480 }}
            onKeyDown={(e) => {
              if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault();
            }}
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
                {humanize(p)}
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
                {APPLICANT_TYPE_LABELS[t] ?? humanize(t)}
              </MenuItem>
            ))}
          </TextField>
          {canEdit && (
            <Stack direction="row" justifyContent="flex-end">
              <AppButton
                variant="primary"
                loading={save.isPending}
                disabled={!dirty || !valid}
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
              </AppButton>
            </Stack>
          )}
        </FieldGrid>
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
    <Section title="Hold" testId="application.hold">
      <ErrorAlert error={hold.error} />
      {app.onHold ? (
        <Stack spacing={1.5}>
          <Typography variant="body2">
            On hold: {app.holdReason}
            {app.holdUntil ? ` (until ${formatDate(app.holdUntil)})` : ''}
          </Typography>
          <AppButton
            variant="outlined"
            size="small"
            loading={hold.isPending}
            onClick={() => hold.mutate({ onHold: false })}
            dataTestId="application.clear-hold"
          >
            Clear hold
          </AppButton>
        </Stack>
      ) : (
        <Stack spacing={1.5}>
          <Typography variant="caption" color="text.secondary">
            Pause the file while you wait on the customer. The team sees the reason.
          </Typography>
          <TextField
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            helperText="3 to 200 characters."
            inputProps={{ 'data-testid': 'application.hold-reason' }}
          />
          <TextField
            label="Hold until (optional)"
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <AppButton
            variant="danger"
            loading={hold.isPending}
            disabled={!isValidHoldReason(reason)}
            dataTestId="application.put-on-hold"
            onClick={() =>
              hold.mutate(
                { onHold: true, reason: reason.trim(), until: until ? `${until}T00:00:00Z` : null },
                { onSuccess: () => setReason('') },
              )
            }
          >
            Put on hold
          </AppButton>
        </Stack>
      )}
    </Section>
  );
}

const CANCEL_REASONS = [
  { value: 'DUPLICATE', label: 'Duplicate' },
  { value: 'CREATED_IN_ERROR', label: 'Created in error' },
  { value: 'INELIGIBLE', label: 'Ineligible' },
  { value: 'OTHER', label: 'Other' },
] as const;

/** One step on the page: its fields on the left, the action button on the right, side by side. Stacks on a phone. */
function StepRow({ children, action }: { children: ReactNode; action: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-start' }}>
      <Stack spacing={2} sx={{ flex: 1, minWidth: 0, maxWidth: { sm: 640 } }}>
        {children}
      </Stack>
      <Box sx={{ flexShrink: 0 }}>{action}</Box>
    </Stack>
  );
}

/** The next step for this application: T-APP-01 (draft, pick a product version), T-APP-02 (send to review), T-APP-03
 *  (send back for rework), T-APP-04 (ready), T-APP-05 (send back to review), T-APP-07 (close), T-APP-08 (withdraw), T-APP-09
 *  (reopen) and T-APP-10 (cancel). Only the steps the caller's permissions and the current status allow are shown. The API
 *  re-checks all of it. */
export function TransitionCard({ app }: { app: Application }) {
  const me = useMe();
  const canUpdate = hasPermission(me.data, 'application.update');
  const canReview = hasPermission(me.data, 'application.review');
  const canCancel = hasPermission(me.data, 'application.cancel');
  const canWithdraw = hasPermission(me.data, 'application.withdraw');
  const canReopen = hasPermission(me.data, 'application.reopen');
  const canClose = hasPermission(me.data, 'application.close');
  const [productId, setProductId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [withdrawReason, setWithdrawReason] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [sendBackReason, setSendBackReason] = useState('');
  const [closeReason, setCloseReason] = useState('');

  const showStart = app.status === 'DRAFT' && canUpdate;
  const showReview = app.status === 'DOCUMENTS_PENDING' && canReview;
  const showCancel = ['DRAFT', 'DOCUMENTS_PENDING', 'UNDER_REVIEW'].includes(app.status) && canCancel;
  // T-APP-04: once the checklist is complete, the file is ready to go to a lender.
  const showReady = app.status === 'UNDER_REVIEW' && canReview;
  // T-APP-08: the customer withdraws before any lender has the file. A reason is required.
  const showWithdraw =
    ['DOCUMENTS_PENDING', 'UNDER_REVIEW', 'READY_FOR_SUBMISSION'].includes(app.status) && canWithdraw;
  // T-APP-09: a cancelled or withdrawn file is reopened as a draft. A reason is required.
  const showReopen = ['CANCELLED', 'WITHDRAWN'].includes(app.status) && canReopen;
  // T-APP-03 (under review) and T-APP-05 (ready): send the file back a step, with a reason.
  const sendBack =
    app.status === 'UNDER_REVIEW' && canReview
      ? ({
          code: 'T-APP-03',
          label: 'Send back for rework',
          hint: 'The file goes back to documents pending.',
        } as const)
      : app.status === 'READY_FOR_SUBMISSION' && canReview
        ? ({
            code: 'T-APP-05',
            label: 'Send back to review',
            hint: 'The file goes back to under review.',
          } as const)
        : null;
  // T-APP-07: a disbursed or terminal file is closed for good.
  const showClose = CLOSABLE.includes(app.status) && canClose;

  // Products of this application's category, then their versions. Only versions in force today can be chosen.
  const products = useLookup<Product>(
    '/v1/products',
    { category: app.productCategory, status: 'ACTIVE' },
    showStart,
  );
  const versions = useLookup<ProductVersion>(
    `/v1/products/${productId}/versions`,
    {},
    showStart && !!productId,
  );
  const inForce = (versions.data ?? []).filter((v) => v.isCurrent);

  const run = useCommand<
    {
      transitionCode:
        | 'T-APP-01'
        | 'T-APP-02'
        | 'T-APP-03'
        | 'T-APP-04'
        | 'T-APP-05'
        | 'T-APP-07'
        | 'T-APP-08'
        | 'T-APP-09'
        | 'T-APP-10';
      productVersionId?: string;
      cancelReason?: string;
      reason?: string;
    },
    Application
  >(
    () => ({ path: `/v1/applications/${app.id}/transitions`, method: 'POST', version: app.version }),
    [[`/v1/applications/${app.id}`], ['/v1/applications']],
  );

  if (
    !showStart &&
    !showReview &&
    !showCancel &&
    !showReady &&
    !showWithdraw &&
    !showReopen &&
    !sendBack &&
    !showClose
  )
    return null;

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Next step
        </Typography>
        <ErrorAlert error={run.error} />
        <Stack spacing={3}>
          {showStart && (
            <StepRow
              action={
                <AppButton
                  variant="primary"
                  loading={run.isPending}
                  disabled={!versionId}
                  onClick={() => run.mutate({ transitionCode: 'T-APP-01', productVersionId: versionId })}
                >
                  Start documents
                </AppButton>
              }
            >
              <Typography variant="body2" color="text.secondary">
                Choose the product and the version in force today, then start the documents.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  select
                  label="Product"
                  value={productId}
                  onChange={(e) => {
                    setProductId(e.target.value);
                    setVersionId('');
                  }}
                  helperText={
                    products.data?.length === 0 ? `No active ${app.productCategory} products.` : undefined
                  }
                  sx={{ flex: { sm: 1 }, minWidth: 0 }}
                >
                  {(products.data ?? []).map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.name}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Product version"
                  value={versionId}
                  onChange={(e) => setVersionId(e.target.value)}
                  disabled={!productId}
                  helperText={productId && inForce.length === 0 ? 'No version is in force today.' : undefined}
                  sx={{ flex: { sm: 1 }, minWidth: 0 }}
                >
                  {inForce.map((v) => (
                    <MenuItem key={v.id} value={v.id}>
                      Version {v.versionNo} (from {formatDate(v.effectiveFrom)})
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
            </StepRow>
          )}

          {showReview && (
            <Stack direction="row" justifyContent="flex-end">
              <AppButton
                variant="primary"
                loading={run.isPending}
                onClick={() => run.mutate({ transitionCode: 'T-APP-02' })}
              >
                Send to review
              </AppButton>
            </Stack>
          )}

          {showReady && (
            <Stack direction="row" justifyContent="flex-end">
              <AppButton
                variant="primary"
                loading={run.isPending}
                onClick={() => run.mutate({ transitionCode: 'T-APP-04' })}
              >
                Mark ready for submission
              </AppButton>
            </Stack>
          )}

          {sendBack && (
            <StepRow
              action={
                <AppButton
                  variant="outlined"
                  loading={run.isPending}
                  disabled={!isValidTransitionReason(sendBackReason)}
                  dataTestId="application.send-back"
                  onClick={() =>
                    run.mutate(
                      { transitionCode: sendBack.code, reason: sendBackReason.trim() },
                      { onSuccess: () => setSendBackReason('') },
                    )
                  }
                >
                  {sendBack.label}
                </AppButton>
              }
            >
              <TextField
                fullWidth
                label="Reason for sending back"
                value={sendBackReason}
                onChange={(e) => setSendBackReason(e.target.value)}
                helperText={`5 to 200 characters. ${sendBack.hint}`}
                inputProps={{ 'data-testid': 'application.send-back-reason' }}
              />
            </StepRow>
          )}

          {showClose && (
            <StepRow
              action={
                <AppButton
                  variant="danger"
                  loading={run.isPending}
                  disabled={closeReason.trim() !== '' && !isValidTransitionReason(closeReason)}
                  dataTestId="application.close"
                  onClick={() =>
                    run.mutate({
                      transitionCode: 'T-APP-07',
                      ...(closeReason.trim() ? { reason: closeReason.trim() } : {}),
                    })
                  }
                >
                  Close application
                </AppButton>
              }
            >
              <TextField
                fullWidth
                label="Closing note (optional)"
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                helperText="5 to 200 characters when given. A closed file cannot be reopened."
              />
            </StepRow>
          )}

          {showWithdraw && (
            <StepRow
              action={
                <AppButton
                  variant="danger"
                  loading={run.isPending}
                  disabled={withdrawReason.trim().length < 5}
                  onClick={() => run.mutate({ transitionCode: 'T-APP-08', reason: withdrawReason.trim() })}
                >
                  Withdraw application
                </AppButton>
              }
            >
              <TextField
                fullWidth
                label="Withdrawal reason"
                value={withdrawReason}
                onChange={(e) => setWithdrawReason(e.target.value)}
                helperText="At least 5 characters. Recorded in the status history."
              />
            </StepRow>
          )}

          {showReopen && (
            <StepRow
              action={
                <AppButton
                  variant="primary"
                  loading={run.isPending}
                  disabled={reopenReason.trim().length < 5}
                  onClick={() => run.mutate({ transitionCode: 'T-APP-09', reason: reopenReason.trim() })}
                >
                  Reopen as draft
                </AppButton>
              }
            >
              <TextField
                fullWidth
                label="Reopen reason"
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                helperText="At least 5 characters. The file goes back to draft."
              />
            </StepRow>
          )}

          {showCancel && (
            <StepRow
              action={
                <AppButton
                  variant="danger"
                  loading={run.isPending}
                  disabled={!cancelReason}
                  onClick={() => run.mutate({ transitionCode: 'T-APP-10', cancelReason })}
                >
                  Cancel application
                </AppButton>
              }
            >
              <TextField
                fullWidth
                select
                label="Cancel reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              >
                {CANCEL_REASONS.map((r) => (
                  <MenuItem key={r.value} value={r.value}>
                    {r.label}
                  </MenuItem>
                ))}
              </TextField>
            </StepRow>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
