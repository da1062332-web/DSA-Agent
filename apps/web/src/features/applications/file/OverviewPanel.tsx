// The overview of a loan file (owner: Bhushan, 2026-11-28): what opens first. A band says where the file stands and offers
// "Complete application" (a draft) or "Continue application", which opens the step-by-step form on the current step. Below, the
// borrowers, the loan, the security, the documents and the eligibility on one screen; each "open" link jumps to its step. Read-only:
// changes happen in the steps.
import type { CollateralView, CustomerProfileView, LenderMatchRun } from '@dsa/contracts';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiFetch } from '../../../api/client';
import { hasPermission, useMe } from '../../../api/useMe';
import { Box, LinearProgress, Link, Stack, Typography } from '@mui/material';
import { CustomerName } from '../../../shell/display';
import { useLookup, useResource } from '../../admin/api';
import { useChecklist } from '../../documents/api';
import type { Application } from '../ApplicationsPage';
import { PROPERTY_TYPE_LABELS } from '../collateral';
import {
  APPLICANT_TYPE_LABELS,
  PRODUCT_LABELS,
  fileDate,
  formatInr,
  humanize,
  loanToValue,
  totalValue,
  type JourneyState,
  type StageKey,
  JOURNEY,
} from '../loan-file';
import { AppButton } from '../../../ui';
import { stageChecks, openChecks } from '../stage-checks';
import { Row, Section, Tile } from './parts';
import { useFileFacts } from './StagePanel';

interface Party {
  id: string;
  customerId: string;
  role: 'PRIMARY' | 'CO_APPLICANT' | 'GUARANTOR';
  partyType: 'INDIVIDUAL' | 'ENTITY';
  relationshipToPrimary: string | null;
  removedAt: string | null;
}

const ROLE_LABELS: Record<Party['role'], string> = {
  PRIMARY: 'Primary applicant',
  CO_APPLICANT: 'Co-applicant',
  GUARANTOR: 'Guarantor',
};

function OpenStep({
  stage,
  label,
  onOpen,
}: {
  stage: StageKey;
  label: string;
  onOpen: (s: StageKey) => void;
}) {
  return (
    <Link
      component="button"
      type="button"
      variant="body2"
      underline="hover"
      onClick={() => onOpen(stage)}
      data-testid={`application.open-${stage}`}
    >
      {label}
    </Link>
  );
}

function BorrowerLine({ party }: { party: Party }) {
  const profile = useResource<CustomerProfileView>(`/v1/customers/${party.customerId}/profile`);
  const p = profile.data;
  const work = p?.employerName ?? p?.businessName ?? null;
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="flex-start"
      sx={{ py: 1, borderBottom: 1, borderColor: 'grey.100' }}
      data-testid={`application.borrower.${party.id}`}
    >
      <Box
        sx={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          bgcolor: party.role === 'PRIMARY' ? 'primary.main' : 'grey.200',
          color: party.role === 'PRIMARY' ? '#fff' : 'text.secondary',
          display: 'grid',
          placeItems: 'center',
          fontSize: 12,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {party.partyType === 'ENTITY'
          ? 'CO'
          : party.role === 'PRIMARY'
            ? 'P'
            : party.role === 'GUARANTOR'
              ? 'G'
              : 'CA'}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" component="div" sx={{ fontWeight: 600 }}>
          <CustomerName id={party.customerId} linkToProfile />
        </Typography>
        <Typography variant="caption" color="text.secondary" component="div">
          {ROLE_LABELS[party.role]}
          {party.relationshipToPrimary ? ` · ${humanize(party.relationshipToPrimary)}` : ''}
          {party.partyType === 'ENTITY' ? ' · Company or firm' : ''}
        </Typography>
        <Typography variant="caption" component="div" sx={{ mt: 0.25 }}>
          {p?.employmentType ? humanize(p.employmentType) : 'Employment not recorded'}
          {work ? ` · ${work}` : ''}
        </Typography>
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
        <Typography variant="caption" color="text.secondary" component="div">
          Monthly income
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {p?.monthlyIncome ? formatInr(p.monthlyIncome.amount) : '—'}
        </Typography>
      </Box>
    </Stack>
  );
}

export function OverviewPanel({
  app,
  journey,
  onOpen,
  onContinue,
}: {
  app: Application;
  journey: JourneyState;
  onOpen: (s: StageKey) => void;
  onContinue: () => void;
}) {
  const facts = useFileFacts(app);
  const current = JOURNEY[journey.activeIndex]!;
  const toDo = openChecks(stageChecks(current.key, facts));
  const finished = journey.activeDone || journey.outcome !== null;
  const parties = useLookup<Party>(`/v1/applications/${app.id}/parties`);
  const collateral = useLookup<CollateralView>(`/v1/applications/${app.id}/collateral`);
  const checklist = useChecklist(app.id);
  // The lender-wise answer (lender matching) is what a DSA quotes; the rule-set check is the fallback.
  const me = useMe();
  const canMatch = hasPermission(me.data, 'lender_match.run');
  const matchBase = `/v1/applications/${app.id}/lender-matches`;
  const match = useQuery({
    queryKey: [matchBase, 'latest'],
    queryFn: () =>
      apiFetch<LenderMatchRun>(`${matchBase}/latest`).catch((e: unknown) => {
        if (e instanceof ApiError && e.httpStatus === 404) return null;
        throw e;
      }),
    enabled: canMatch,
  });
  const eligibleLenders = (match.data?.results ?? []).filter((r) => r.outcome === 'ELIGIBLE');
  const best = eligibleLenders[0];

  const live = (parties.data ?? []).filter((p) => p.removedAt === null);
  const ordered = [...live].sort((a, b) => (a.role === 'PRIMARY' ? -1 : b.role === 'PRIMARY' ? 1 : 0));
  const values = (collateral.data ?? []).map((c) => c.estimatedMarketValue);
  const ltv = loanToValue(app.requestedAmount, values);
  const summary = checklist.data?.summary;
  const done = summary ? summary.accepted : 0;
  const pct = summary && summary.total > 0 ? Math.round((done / summary.total) * 100) : 0;

  const coApplicants = live.filter((p) => p.role === 'CO_APPLICANT').length;
  const guarantors = live.filter((p) => p.role === 'GUARANTOR').length;
  const grid = (columns: Record<string, string>) => ({
    display: 'grid',
    gap: 2.5,
    gridTemplateColumns: { xs: '1fr', ...columns },
    alignItems: 'stretch',
  });

  return (
    <Box sx={{ display: 'grid', gap: 2.5 }} data-testid="application.overview">
      <Box
        data-testid="application.continue-band"
        sx={{
          border: 1,
          borderColor: finished ? 'divider' : 'primary.light',
          borderLeft: '4px solid',
          borderLeftColor: finished ? 'success.main' : 'primary.main',
          borderRadius: '12px',
          bgcolor: 'background.paper',
          px: 3,
          py: 2.5,
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          gap: 2,
          alignItems: { md: 'center' },
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}
          >
            {finished
              ? 'Application'
              : `Step ${journey.activeIndex + 1} of ${JOURNEY.length} · ${current.label}`}
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, mt: 0.25 }}>
            {finished
              ? journey.outcome === 'CLOSED' || journey.activeDone
                ? 'This application is complete'
                : `This application was ${(journey.outcome ?? '').toLowerCase()}`
              : toDo > 0
                ? `${toDo} thing${toDo === 1 ? '' : 's'} to do before the file moves on`
                : 'Everything for this step is done'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {finished ? 'Open the steps to look back at the file.' : current.movesOn}
          </Typography>
        </Box>
        <AppButton
          variant="primary"
          onClick={onContinue}
          dataTestId="application.continue"
          sx={{ whiteSpace: 'nowrap', flexShrink: 0, px: 3 }}
        >
          {finished
            ? 'View the steps'
            : app.status === 'DRAFT'
              ? 'Complete application'
              : 'Continue application'}
        </AppButton>
      </Box>

      <Box sx={grid({ sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' })}>
        <Tile
          label="Documents"
          testId="application.overview-documents"
          value={summary && summary.total > 0 ? `${done} of ${summary.total}` : '—'}
          sub={
            !summary || summary.total === 0
              ? checklist.error
                ? 'The checklist cannot be read.'
                : 'Requested when the documents start.'
              : summary.complete
                ? 'Every mandatory document is in.'
                : `accepted · ${summary.outstandingMandatory} mandatory outstanding`
          }
          action={<OpenStep stage="documents" label="Open the checklist" onOpen={onOpen} />}
        >
          {summary && summary.total > 0 && (
            <LinearProgress
              variant="determinate"
              value={pct}
              color={summary.complete ? 'success' : 'primary'}
              sx={{ mt: 1.5, height: 6, borderRadius: 3 }}
            />
          )}
        </Tile>

        <Tile
          label="Eligibility"
          testId="application.overview-eligibility"
          value={
            match.data
              ? best?.eligibleAmount
                ? `Up to ${formatInr(best.eligibleAmount.amount)}`
                : 'No lender yet'
              : '—'
          }
          sub={
            match.data ? (
              <span data-testid="application.overview-lender-eligibility">
                {eligibleLenders.length} of {match.data.policyCount} lenders eligible
                {best?.emiMin ? ` · EMI from ${formatInr(best.emiMin.amount)}` : ''}
              </span>
            ) : canMatch ? (
              'Not worked out yet.'
            ) : (
              'Lender matching is not available to your role.'
            )
          }
          action={<OpenStep stage="review" label="Open eligibility" onOpen={onOpen} />}
        />

        <Tile
          label="Security"
          testId="application.overview-security"
          value={values.length > 0 ? formatInr(totalValue(values)) : 'Unsecured'}
          sub={
            values.length > 0 ? (
              <>
                {values.length} {values.length === 1 ? 'property' : 'properties'} · LTV{' '}
                <Box
                  component="span"
                  data-testid="application.ltv"
                  sx={{ fontWeight: 700, color: ltv !== null && ltv > 80 ? 'warning.main' : 'success.main' }}
                >
                  {ltv}%
                </Box>
              </>
            ) : collateral.error ? (
              'Collateral cannot be read.'
            ) : (
              'No property pledged.'
            )
          }
          action={<OpenStep stage="draft" label="Open collateral" onOpen={onOpen} />}
        >
          {values.length > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }} noWrap>
              {(collateral.data ?? [])
                .slice(0, 2)
                .map((c) => `${PROPERTY_TYPE_LABELS[c.propertyType]}, ${c.city}`)
                .join(' · ')}
            </Typography>
          )}
        </Tile>

        <Tile
          label="Applicants"
          testId="application.overview-applicants"
          value={`${live.length} ${live.length === 1 ? 'person' : 'people'}`}
          sub={`Borrower${coApplicants ? ` + ${coApplicants} co-applicant${coApplicants === 1 ? '' : 's'}` : ''}${
            guarantors ? ` · ${guarantors} guarantor${guarantors === 1 ? '' : 's'}` : ''
          }`}
          action={<OpenStep stage="draft" label="Manage applicants" onOpen={onOpen} />}
        />
      </Box>

      <Box sx={grid({ md: 'repeat(2, minmax(0, 1fr))' })}>
        <Section fill title="Applicants" testId="application.overview-borrowers">
          {ordered.map((p) => (
            <BorrowerLine key={p.id} party={p} />
          ))}
          {!parties.isPending && ordered.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No applicants recorded.
            </Typography>
          )}
        </Section>

        <Section
          fill
          title="Loan details"
          action={<OpenStep stage="draft" label="Edit" onOpen={onOpen} />}
          testId="application.overview-loan"
        >
          <Row label="Loan type">{PRODUCT_LABELS[app.productCategory] ?? app.productCategory}</Row>
          <Row label="Amount requested">{formatInr(app.requestedAmount)}</Row>
          <Row label="Tenure">{app.tenureMonths ? `${app.tenureMonths} months` : 'Not set'}</Row>
          <Row label="Purpose">{app.purposeCode ? humanize(app.purposeCode) : 'Not set'}</Row>
          <Row label="Applicant type">{APPLICANT_TYPE_LABELS[app.applicantType] ?? app.applicantType}</Row>
          <Row label="Opened">{fileDate(app.createdAt)}</Row>
        </Section>
      </Box>
    </Box>
  );
}
