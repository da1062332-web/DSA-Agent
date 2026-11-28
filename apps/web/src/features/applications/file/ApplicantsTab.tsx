// The applicants of a loan file (owner: Bhushan, 2026-11-28 redesign): one profile card per borrower, guarantor and co-applicant (from
// the customer's P1-02 profile), then the card that adds or removes parties. Identity numbers are never shown here: the customer page
// reveals a masked PAN with step-up.
import type { CustomerProfileView } from '@dsa/contracts';
import { Box, Chip, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { CustomerName } from '../../../shell/display';
import { useLookup, useResource } from '../../admin/api';
import { PartiesCard } from '../ApplicationFileCards';
import type { Application } from '../ApplicationsPage';
import { formatInr, humanize } from '../loan-file';
import { Row } from './OverviewTab';

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

function ProfileCard({ party }: { party: Party }) {
  const profile = useResource<CustomerProfileView>(`/v1/customers/${party.customerId}/profile`);
  const p = profile.data;
  const net =
    p?.monthlyIncome && p.monthlyObligations
      ? (Number(p.monthlyIncome.amount) - Number(p.monthlyObligations.amount)).toFixed(2)
      : null;
  return (
    <Box
      data-testid={`application.profile.${party.id}`}
      sx={{
        border: 1,
        borderColor: party.role === 'PRIMARY' ? 'primary.light' : 'divider',
        borderRadius: '12px',
        bgcolor: 'background.paper',
        p: 2.5,
        minWidth: 0,
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" component="div" sx={{ fontWeight: 700 }}>
            <CustomerName id={party.customerId} typographyProps={{ variant: 'subtitle1', fontWeight: 700 }} />
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {party.partyType === 'ENTITY' ? 'Company or firm' : 'Individual'}
            {party.relationshipToPrimary
              ? ` · ${humanize(party.relationshipToPrimary)} of the primary applicant`
              : ''}
          </Typography>
        </Box>
        <Chip
          size="small"
          label={ROLE_LABELS[party.role]}
          color={party.role === 'PRIMARY' ? 'primary' : 'default'}
          variant={party.role === 'PRIMARY' ? 'filled' : 'outlined'}
        />
      </Stack>
      <Box sx={{ mt: 1.5 }}>
        {profile.error ? (
          <Typography variant="body2" color="text.secondary">
            The profile cannot be read with your permissions.
          </Typography>
        ) : (
          <>
            {party.partyType === 'ENTITY' && (
              <Row label="Constitution">{p?.constitution ? humanize(p.constitution) : 'Not recorded'}</Row>
            )}
            <Row label="Employment">{p?.employmentType ? humanize(p.employmentType) : 'Not recorded'}</Row>
            <Row label={p?.businessName ? 'Business' : 'Employer'}>
              {p?.employerName ?? p?.businessName ?? 'Not recorded'}
            </Row>
            <Row label="Years in work">
              {p?.vintageMonths != null
                ? `${Math.floor(p.vintageMonths / 12)} y ${p.vintageMonths % 12} m`
                : 'Not recorded'}
            </Row>
            <Row label="Monthly income">
              {p?.monthlyIncome ? formatInr(p.monthlyIncome.amount) : 'Not recorded'}
            </Row>
            <Row label="Monthly EMIs">
              {p?.monthlyObligations ? formatInr(p.monthlyObligations.amount) : 'Not recorded'}
            </Row>
            {net && <Row label="Income after EMIs">{formatInr(Number(net) < 0 ? '0.00' : net)}</Row>}
          </>
        )}
      </Box>
      <Link
        component={RouterLink}
        to={`/customers/${party.customerId}`}
        variant="body2"
        underline="hover"
        sx={{ display: 'inline-block', mt: 1.5 }}
      >
        Open customer profile
      </Link>
    </Box>
  );
}

export function ApplicantsTab({ app }: { app: Application }) {
  const parties = useLookup<Party>(`/v1/applications/${app.id}/parties`);
  const live = (parties.data ?? []).filter((p) => p.removedAt === null);
  const ordered = [...live].sort((a, b) => (a.role === 'PRIMARY' ? -1 : b.role === 'PRIMARY' ? 1 : 0));
  return (
    <Box data-testid="application.applicants">
      <Box
        sx={{
          display: 'grid',
          gap: 2.5,
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          mb: 3,
        }}
      >
        {ordered.map((p) => (
          <ProfileCard key={p.id} party={p} />
        ))}
      </Box>
      <PartiesCard app={app} />
    </Box>
  );
}
