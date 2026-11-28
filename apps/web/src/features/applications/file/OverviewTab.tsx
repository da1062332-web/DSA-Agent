// The overview of a loan file (owner: Bhushan, 2026-11-28 redesign): the borrowers, the loan, the security, the documents and the
// eligibility on one screen, each with a link to the tab that holds the detail, and the status journey below. Read-only; changes
// happen on the tabs. Every figure comes from an existing endpoint; a section the caller may not read says so instead of failing.
import type { CollateralView, CustomerProfileView } from '@dsa/contracts';
import { Box, Chip, LinearProgress, Link, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
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
  type FileTab,
} from '../loan-file';
import { StatusTimeline, type StatusHistoryEntry } from './StatusTimeline';

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

/** A titled section with an optional "Open" link to its tab. */
export function Section({
  title,
  action,
  children,
  testId,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Box
      data-testid={testId}
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: '12px',
        bgcolor: 'background.paper',
        p: 2.5,
        minWidth: 0,
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        {action}
      </Stack>
      {children}
    </Box>
  );
}

function OpenTab({ tab, label, onOpen }: { tab: FileTab; label: string; onOpen: (t: FileTab) => void }) {
  return (
    <Link
      component="button"
      type="button"
      variant="body2"
      underline="hover"
      onClick={() => onOpen(tab)}
      data-testid={`application.open-${tab}`}
    >
      {label}
    </Link>
  );
}

/** Label and value in two columns, the way a loan file's front sheet reads. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={2} sx={{ py: 0.75, borderBottom: 1, borderColor: 'grey.100' }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: 150, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ fontWeight: 600, minWidth: 0 }}>
        {children}
      </Typography>
    </Stack>
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

interface EligibilityLatest {
  assessedAt: string;
  results: { result: string; indicativeMaxAmount: { amount: string } | null }[];
}

const RESULT_TONE: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  PASS: 'success',
  FAIL: 'error',
  REFER: 'warning',
  UNKNOWN: 'default',
};

export function OverviewTab({
  app,
  history,
  onOpen,
}: {
  app: Application;
  history: StatusHistoryEntry[];
  onOpen: (t: FileTab) => void;
}) {
  const parties = useLookup<Party>(`/v1/applications/${app.id}/parties`);
  const collateral = useLookup<CollateralView>(`/v1/applications/${app.id}/collateral`);
  const checklist = useChecklist(app.id);
  const eligibility = useResource<EligibilityLatest>(
    `/v1/applications/${app.id}/eligibility-assessments/latest`,
  );

  const live = (parties.data ?? []).filter((p) => p.removedAt === null);
  const ordered = [...live].sort((a, b) => (a.role === 'PRIMARY' ? -1 : b.role === 'PRIMARY' ? 1 : 0));
  const values = (collateral.data ?? []).map((c) => c.estimatedMarketValue);
  const ltv = loanToValue(app.requestedAmount, values);
  const summary = checklist.data?.summary;
  const done = summary ? summary.accepted : 0;
  const pct = summary && summary.total > 0 ? Math.round((done / summary.total) * 100) : 0;
  const latest = eligibility.data?.results?.[0];

  return (
    <Box sx={{ display: 'grid', gap: 2.5 }} data-testid="application.overview">
      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <Section
          title={`Borrowers (${live.length})`}
          action={<OpenTab tab="applicants" label="Manage applicants" onOpen={onOpen} />}
          testId="application.overview-borrowers"
        >
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
          title="Loan requested"
          action={<OpenTab tab="loan" label="Edit request" onOpen={onOpen} />}
          testId="application.overview-loan"
        >
          <Row label="Loan type">{PRODUCT_LABELS[app.productCategory] ?? app.productCategory}</Row>
          <Row label="Amount">{formatInr(app.requestedAmount)}</Row>
          <Row label="Tenure">{app.tenureMonths ? `${app.tenureMonths} months` : 'Not set'}</Row>
          <Row label="Purpose">{app.purposeCode ? humanize(app.purposeCode) : 'Not set'}</Row>
          <Row label="Applicant type">{APPLICANT_TYPE_LABELS[app.applicantType] ?? app.applicantType}</Row>
          <Row label="Opened">{fileDate(app.createdAt)}</Row>
        </Section>
      </Box>

      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Section
          title="Security"
          action={<OpenTab tab="loan" label="Collateral" onOpen={onOpen} />}
          testId="application.overview-security"
        >
          {values.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {collateral.error
                ? 'Collateral cannot be read.'
                : 'No property pledged. Unsecured unless a property is added.'}
            </Typography>
          ) : (
            <>
              <Typography sx={{ fontSize: 22, fontWeight: 700 }}>{formatInr(totalValue(values))}</Typography>
              <Typography variant="caption" color="text.secondary">
                Market value of {values.length} {values.length === 1 ? 'property' : 'properties'}
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
                <Typography variant="body2" color="text.secondary">
                  Loan to value
                </Typography>
                <Chip
                  size="small"
                  label={`${ltv}%`}
                  color={ltv !== null && ltv > 80 ? 'warning' : 'success'}
                  data-testid="application.ltv"
                />
              </Stack>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
                {(collateral.data ?? [])
                  .slice(0, 2)
                  .map((c) => `${PROPERTY_TYPE_LABELS[c.propertyType]}, ${c.city}`)
                  .join(' · ')}
              </Typography>
            </>
          )}
        </Section>

        <Section
          title="Documents"
          action={<OpenTab tab="documents" label="Checklist" onOpen={onOpen} />}
          testId="application.overview-documents"
        >
          {!summary || summary.total === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {checklist.error
                ? 'The checklist cannot be read.'
                : 'No documents requested yet. The checklist is made when documents start.'}
            </Typography>
          ) : (
            <>
              <Typography sx={{ fontSize: 22, fontWeight: 700 }}>
                {done} of {summary.total}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                documents accepted
              </Typography>
              <LinearProgress
                variant="determinate"
                value={pct}
                color={summary.complete ? 'success' : 'primary'}
                sx={{ mt: 1.5, height: 8, borderRadius: 4 }}
              />
              <Typography variant="caption" component="div" sx={{ mt: 1 }}>
                {summary.complete
                  ? 'Complete: every mandatory document is in.'
                  : `${summary.outstandingMandatory} mandatory still outstanding`}
              </Typography>
            </>
          )}
        </Section>

        <Section
          title="Eligibility"
          action={<OpenTab tab="eligibility" label="Details" onOpen={onOpen} />}
          testId="application.overview-eligibility"
        >
          {!latest ? (
            <Typography variant="body2" color="text.secondary">
              {app.productVersionId
                ? 'Not checked yet.'
                : 'Choose a product to check eligibility against its rules.'}
            </Typography>
          ) : (
            <>
              <Chip
                label={humanize(latest.result)}
                color={RESULT_TONE[latest.result] ?? 'default'}
                sx={{ fontWeight: 700 }}
              />
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
                Checked {fileDate(eligibility.data?.assessedAt)}
              </Typography>
              {latest.indicativeMaxAmount && (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Indicative up to <b>{formatInr(latest.indicativeMaxAmount.amount)}</b>
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
                Preliminary only. The lender makes the credit decision.
              </Typography>
            </>
          )}
        </Section>
      </Box>

      <Section
        title="Status history"
        action={<OpenTab tab="activity" label="All activity" onOpen={onOpen} />}
        testId="application.overview-history"
      >
        <StatusTimeline entries={history} />
      </Section>
    </Box>
  );
}
