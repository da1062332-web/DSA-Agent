// The Eligibility tab of the loan file (owner: Bhushan, 2026-11-28), laid out the way a DSA works a file out:
//   1. Income and obligations: one line per borrower, the borrower's and the earning co-applicants' income clubbed (a guarantor's is
//      shown, not counted), everyone's existing EMIs, the FOIR before the new loan, and the property value with the LTV of the request.
//   2. Eligibility by lender: each lender's own FOIR cap, LTV cap, rate, tenure, age at maturity, bureau score and pincode applied
//      (P1-04 lender matching), with the eligible amount and the EMI.
//   3. Credit policy pre-check: the tenant's approved rule set (MOD-ELG), underneath.
// The figures come from GET /v1/applications/{id}/lender-matches/inputs, which the lender matching also uses, so the working and the
// lender answers never disagree.
import type { LenderMatchPrefill } from '@dsa/contracts';
import {
  Alert,
  Box,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../api/client';
import { hasPermission, useMe } from '../../../api/useMe';
import { CustomerName } from '../../../shell/display';
import type { Application } from '../ApplicationsPage';
import { EligibilityCard } from '../EligibilityCard';
import { LenderMatchesCard } from '../LenderMatchesCard';
import { countedText, incomeTotals, ltvPercent } from '../eligibility-working';
import { formatInr, humanize } from '../loan-file';
import { Section } from './parts';

const ROLE = { PRIMARY: 'Borrower', CO_APPLICANT: 'Co-applicant', GUARANTOR: 'Guarantor' } as const;

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
      >
        {label}
      </Typography>
      <Typography sx={{ fontSize: 20, fontWeight: 700, lineHeight: 1.3 }}>{value}</Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Box>
  );
}

function IncomeWorking({ app }: { app: Application }) {
  const base = `/v1/applications/${app.id}/lender-matches`;
  const prefill = useQuery({
    queryKey: [base, 'inputs'],
    queryFn: () => apiFetch<LenderMatchPrefill>(`${base}/inputs`),
  });
  if (prefill.isPending) return null;
  if (!prefill.data) {
    return (
      <Section title="Income and obligations" testId="application.eligibility-working">
        <Typography variant="body2" color="text.secondary">
          The figures cannot be read.
        </Typography>
      </Section>
    );
  }
  const lines = prefill.data.borrowers ?? [];
  const totals = incomeTotals(lines);
  const value = prefill.data.inputs.collateralValue?.amount ?? null;
  const ltv = ltvPercent(app.requestedAmount, value);
  const age = prefill.data.inputs.ageYears;

  return (
    <Section title="Income and obligations" testId="application.eligibility-working">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Lenders add the income of the borrower and the earning co-applicants and count everyone&apos;s
        existing EMIs. A guarantor&apos;s income is not counted. Update a figure on the person&apos;s customer
        profile.
      </Typography>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Applicant</TableCell>
              <TableCell align="right">Monthly income</TableCell>
              <TableCell align="right">Existing EMIs</TableCell>
              <TableCell>Counted</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((l) => (
              <TableRow
                key={l.customerId}
                sx={{ opacity: l.counted ? 1 : 0.6 }}
                data-testid={`application.working.${l.customerId}`}
              >
                <TableCell>
                  <Typography variant="body2" component="div" sx={{ fontWeight: 600 }}>
                    <CustomerName id={l.customerId} linkToProfile />
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {ROLE[l.role]}
                    {l.relationshipToPrimary ? ` · ${humanize(l.relationshipToPrimary)}` : ''}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  {l.monthlyIncome ? (
                    <>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {formatInr(l.monthlyIncome.amount)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {l.incomeSource === 'FINANCIAL_INPUT' ? 'on the application' : 'from the profile'}
                      </Typography>
                    </>
                  ) : (
                    <Chip size="small" color="warning" variant="outlined" label="Not recorded" />
                  )}
                </TableCell>
                <TableCell align="right">
                  {l.monthlyObligations ? formatInr(l.monthlyObligations.amount) : '—'}
                </TableCell>
                <TableCell>
                  <Typography variant="caption">{countedText(l)}</Typography>
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Total counted</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>
                {totals.income ? formatInr(totals.income) : '—'}
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>
                {totals.obligations ? formatInr(totals.obligations) : '—'}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </Box>

      <Box
        sx={{
          mt: 2.5,
          display: 'grid',
          gap: 2,
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        }}
      >
        <Figure
          label="Existing FOIR"
          value={totals.existingFoirPercent === null ? '—' : `${totals.existingFoirPercent}%`}
          hint="EMIs already paid, as a share of income"
        />
        <Figure
          label="Property value"
          value={value ? formatInr(value) : 'None pledged'}
          hint={value ? `${prefill.data.collateralItems ?? 1} on the file` : 'Unsecured loan'}
        />
        <Figure
          label="LTV of the request"
          value={ltv === null ? '—' : `${ltv}%`}
          hint="Requested amount ÷ property value"
        />
        <Figure
          label="Borrower age"
          value={age === null ? '—' : `${age} years`}
          hint="From the year of birth"
        />
      </Box>

      {totals.missingIncome.length > 0 && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          {totals.missingIncome.length === 1
            ? 'One applicant has'
            : `${totals.missingIncome.length} applicants have`}{' '}
          no income on record. Lenders will not count them until it is added to their profile.
        </Alert>
      )}
    </Section>
  );
}

export function EligibilityTab({ app }: { app: Application }) {
  const me = useMe();
  const canMatch = hasPermission(me.data, 'lender_match.run');
  return (
    <Stack spacing={3} data-testid="application.eligibility-tab">
      {canMatch ? (
        <>
          <IncomeWorking app={app} />
          <LenderMatchesCard applicationId={app.id} productCategory={app.productCategory} />
        </>
      ) : (
        <Alert severity="info">
          Lender-wise eligibility needs the lender matching permission (lender_match.run).
        </Alert>
      )}
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
          Credit policy pre-check
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Your tenant&apos;s approved rules for the chosen product. Preliminary only: the lender makes the
          credit decision.
        </Typography>
        <EligibilityCard
          applicationId={app.id}
          applicationStatus={app.status}
          hasProduct={!!app.productVersionId}
          autoRun
          productVersionId={app.productVersionId}
          updatedAt={app.updatedAt}
          status={app.status}
        />
      </Box>
    </Stack>
  );
}
