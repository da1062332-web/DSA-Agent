// /applications/:id (owner: Dev 3; DSA Notion MODULE 16, API-APP-003, 004, 010). Edit the applicant request while the
// status allows it, and put the file on hold with a reason. Every change sends the version the screen loaded (If-Match),
// so a stale screen gets the conflict message. The lender-case panel (Dev 4) mounts in the slot at the bottom.
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  Link,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { LeadFollowUps } from '../leads/LeadFollowUps';
import { LenderCasePanel } from '../lender-cases/LenderCasePanel';
import { hasPermission, useMe } from '../../api/useMe';
import { useCommand, useLookup, useResource } from '../admin/api';
import { ErrorAlert, Loading, PageHeader, StatusChip, formatDate } from '../admin/components';
import type { Product, ProductVersion } from '../admin/ProductsPage';
import type { Application } from './ApplicationsPage';
import { ChecklistCard } from '../documents/ChecklistCard';
import { EligibilityCard } from './EligibilityCard';
import { CustomerName, BranchName, UserName } from '../../shell/display';
import { AppButton, AppCard, FieldGrid } from '../../ui';
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

function getAmountString(amt: unknown): string {
  if (amt == null) return '';
  if (typeof amt === 'object' && amt !== null) return String((amt as { amount?: unknown }).amount ?? '');
  return String(amt);
}

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
        title="Application"
        subtitle={`${a.productCategory} · ${a.currency || 'INR'} ${getAmountString(a.requestedAmount)} · version ${a.version ?? 0}`}
        action={<StatusChip active={!a.onHold} label={STATUS_LABELS[a.status]} />}
      />
      {a.onHold && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          On hold: {a.holdReason ?? 'no reason recorded'}
          {a.holdUntil ? ` until ${formatDate(a.holdUntil)}` : ''}.
        </Alert>
      )}

      <RelationsCard app={a} />
      <TransitionCard app={a} />
      <DetailsCard app={a} canEdit={canUpdate && canEditDetails(a.status)} />
      <HoldCard app={a} canHoldNow={canUpdate && canHold(a.status)} />
      <EligibilityCard
        applicationId={a.id}
        hasProduct={!!a.productVersionId}
        autoRun
        productVersionId={a.productVersionId}
        updatedAt={a.updatedAt}
        status={a.status}
      />
      <ChecklistCard applicationId={a.id} />

      <div data-slot="application.lender-cases">
        <LenderCasePanel applicationId={a.id} />
      </div>

      <LeadFollowUps subjectType="LOAN_APPLICATION" subjectId={a.id} />
    </>
  );
}

/** Who and what the file belongs to (QA plan Module 06 step 7: lead, customer and application relationships). */
function RelationsCard({ app }: { app: Application }) {
  const me = useMe();
  return (
    <AppCard dataTestId="application.relations" padding="dense">
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems={{ md: 'center' }}>
        <Typography
          variant="body2"
          component="span"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
        >
          Customer: <CustomerName id={app.customerId} linkToProfile />
        </Typography>
        <Typography variant="body2">
          Branch: <BranchName id={app.branchId} />
        </Typography>
        <Typography variant="body2">
          Sales owner: <UserName id={app.salesOwnerId} fallback="Not assigned" />
        </Typography>
        <Typography variant="body2">
          Operations owner: <UserName id={app.opsOwnerId} fallback="Not assigned" />
        </Typography>
        <Typography variant="body2">Opened: {formatDate(app.createdAt)}</Typography>
        {hasPermission(me.data, 'document.upload') && (
          <Box
            sx={{
              display: 'flex',
              justifyContent: { xs: 'flex-start', md: 'flex-end' },
              alignItems: 'center',
              ml: { md: 'auto' },
            }}
          >
            <AppButton
              size="small"
              variant="outlined"
              to={`/document-sharing?applicationId=${encodeURIComponent(app.id)}&action=upload-link`}
              dataTestId="application.upload-link"
              sx={{ whiteSpace: 'nowrap' }}
            >
              Send customer upload link
            </AppButton>
          </Box>
        )}
      </Stack>
    </AppCard>
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
          Applicant request
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
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Hold
        </Typography>
        <ErrorAlert error={hold.error} />
        {app.onHold ? (
          <Stack direction="row" spacing={2} alignItems="center">
            <Typography variant="body2">Reason: {app.holdReason}</Typography>
            <AppButton
              variant="outlined"
              size="small"
              loading={hold.isPending}
              onClick={() => hold.mutate({ onHold: false })}
            >
              Clear hold
            </AppButton>
          </Stack>
        ) : (
          <FieldGrid minColumnWidth={260} spanNonFields>
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
            <Stack direction="row" justifyContent="flex-end">
              <AppButton
                variant="danger"
                loading={hold.isPending}
                disabled={!isValidHoldReason(reason)}
                onClick={() =>
                  hold.mutate({
                    onHold: true,
                    reason: reason.trim(),
                    until: until ? `${until}T00:00:00Z` : null,
                  })
                }
              >
                Put on hold
              </AppButton>
            </Stack>
          </FieldGrid>
        )}
      </CardContent>
    </Card>
  );
}

const CANCEL_REASONS = [
  { value: 'DUPLICATE', label: 'Duplicate' },
  { value: 'CREATED_IN_ERROR', label: 'Created in error' },
  { value: 'INELIGIBLE', label: 'Ineligible' },
  { value: 'OTHER', label: 'Other' },
] as const;

/** The next step for this application: T-APP-01 (draft, pick a product version), T-APP-02 (send to review), T-APP-10
 *  (cancel). Only the steps the caller's permissions and the current status allow are shown. The API re-checks all of it. */
function TransitionCard({ app }: { app: Application }) {
  const me = useMe();
  const canUpdate = hasPermission(me.data, 'application.update');
  const canReview = hasPermission(me.data, 'application.review');
  const canCancel = hasPermission(me.data, 'application.cancel');
  const canWithdraw = hasPermission(me.data, 'application.withdraw');
  const canReopen = hasPermission(me.data, 'application.reopen');
  const [productId, setProductId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [withdrawReason, setWithdrawReason] = useState('');
  const [reopenReason, setReopenReason] = useState('');

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
      transitionCode: 'T-APP-01' | 'T-APP-02' | 'T-APP-04' | 'T-APP-08' | 'T-APP-09' | 'T-APP-10';
      productVersionId?: string;
      cancelReason?: string;
      reason?: string;
    },
    Application
  >(
    () => ({ path: `/v1/applications/${app.id}/transitions`, method: 'POST', version: app.version }),
    [[`/v1/applications/${app.id}`], ['/v1/applications']],
  );

  if (!showStart && !showReview && !showCancel && !showReady && !showWithdraw && !showReopen) return null;

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Next step
        </Typography>
        <ErrorAlert error={run.error} />
        <FieldGrid minColumnWidth={260} spanNonFields>
          {showStart && (
            <>
              <Typography variant="body2" color="text.secondary">
                Choose the product and the version in force today, then start the documents.
              </Typography>
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
              >
                {inForce.map((v) => (
                  <MenuItem key={v.id} value={v.id}>
                    Version {v.versionNo} (from {formatDate(v.effectiveFrom)})
                  </MenuItem>
                ))}
              </TextField>
              <Stack direction="row" justifyContent="flex-end">
                <AppButton
                  variant="primary"
                  loading={run.isPending}
                  disabled={!versionId}
                  onClick={() => run.mutate({ transitionCode: 'T-APP-01', productVersionId: versionId })}
                >
                  Start documents
                </AppButton>
              </Stack>
            </>
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

          {showWithdraw && (
            <>
              <TextField
                label="Withdrawal reason"
                value={withdrawReason}
                onChange={(e) => setWithdrawReason(e.target.value)}
                helperText="At least 5 characters. Recorded in the status history."
              />
              <Stack direction="row" justifyContent="flex-end">
                <AppButton
                  variant="danger"
                  loading={run.isPending}
                  disabled={withdrawReason.trim().length < 5}
                  onClick={() => run.mutate({ transitionCode: 'T-APP-08', reason: withdrawReason.trim() })}
                >
                  Withdraw application
                </AppButton>
              </Stack>
            </>
          )}

          {showReopen && (
            <>
              <TextField
                label="Reopen reason"
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                helperText="At least 5 characters. The file goes back to draft."
              />
              <Stack direction="row" justifyContent="flex-end">
                <AppButton
                  variant="primary"
                  loading={run.isPending}
                  disabled={reopenReason.trim().length < 5}
                  onClick={() => run.mutate({ transitionCode: 'T-APP-09', reason: reopenReason.trim() })}
                >
                  Reopen as draft
                </AppButton>
              </Stack>
            </>
          )}

          {showCancel && (
            <>
              <TextField
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
              <Stack direction="row" justifyContent="flex-end">
                <AppButton
                  variant="danger"
                  loading={run.isPending}
                  disabled={!cancelReason}
                  onClick={() => run.mutate({ transitionCode: 'T-APP-10', cancelReason })}
                >
                  Cancel application
                </AppButton>
              </Stack>
            </>
          )}
        </FieldGrid>
      </CardContent>
    </Card>
  );
}
