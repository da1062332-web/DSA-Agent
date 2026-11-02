// The connector's overview: identity and contact from the connector record, and summaries from the reads the workspace already makes.
// Each figure is the count of records the API returned; nothing is estimated.
import React from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type { ConnectorActivityResource, ConnectorReferralResource, ConnectorResource } from '@dsa/contracts';
import { apiFetch, errorText } from '../../api/client';
import { StatCard, StatCardGrid } from '../../ui';
import { activityLabel } from './connector-workspace-model';

const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <Box>
    <Typography variant="caption" color="text.secondary">
      {label}
    </Typography>
    <Typography variant="body2">{value || '—'}</Typography>
  </Box>
);

export function ConnectorOverviewTab({
  connector,
  canReadReferrals,
  agreementCount,
  bankAccountCount,
}: {
  connector: ConnectorResource;
  canReadReferrals: boolean;
  agreementCount: number;
  bankAccountCount: number | null;
}) {
  const referrals = useQuery<{ items: ConnectorReferralResource[] }>({
    queryKey: ['connector-referrals', connector.id],
    queryFn: () =>
      apiFetch<{ items: ConnectorReferralResource[] }>(`/v1/connectors/${connector.id}/referrals`),
    enabled: canReadReferrals,
  });
  const portalUsers = useQuery<{ items: { id: string; status: string }[] }>({
    queryKey: ['connector-portal-users', connector.id],
    queryFn: () =>
      apiFetch<{ items: { id: string; status: string }[] }>(`/v1/connectors/${connector.id}/users`),
  });
  const recent = useQuery<{ items: ConnectorActivityResource[] }>({
    queryKey: ['connector-activity', connector.id, 'recent'],
    queryFn: () =>
      apiFetch<{ items: ConnectorActivityResource[] }>(`/v1/connectors/${connector.id}/activity?limit=5`),
  });

  const referralItems = referrals.data?.items ?? [];
  const users = portalUsers.data?.items ?? [];

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="subtitle2" fontWeight={700} gutterBottom>
          Identity and contact
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} useFlexGap flexWrap="wrap">
          <Field label="Legal name" value={connector.legalName} />
          <Field
            label="Connector type"
            value={<Chip size="small" label={connector.connectorType} variant="outlined" />}
          />
          <Field label="Contact person" value={connector.contactPerson} />
          <Field label="Mobile" value={connector.mobileE164} />
          <Field label="Email" value={connector.email} />
          <Field label="Branch" value={connector.primaryBranchId} />
          <Field label="Relationship manager" value={connector.relationshipOwnerUserId} />
          <Field label="Created" value={new Date(connector.createdAt).toLocaleDateString('en-IN')} />
        </Stack>
      </Box>

      <StatCardGrid columns={{ xs: 12, sm: 6, md: 3 }}>
        <StatCard
          title="REFERRALS"
          value={canReadReferrals ? referralItems.length : 'Not visible to you'}
          format={canReadReferrals ? 'number' : 'raw'}
          status="primary"
          subtext={
            canReadReferrals
              ? `${referralItems.filter((r) => r.state === 'CONVERTED').length} converted`
              : 'Needs lead read permission'
          }
        />
        <StatCard
          title="PORTAL LOGINS"
          value={users.length}
          format="number"
          status="info"
          subtext={`${users.filter((u) => u.status === 'ACTIVE').length} active`}
        />
        <StatCard
          title="AGREEMENTS"
          value={agreementCount}
          format="number"
          status="default"
          subtext="Agreement versions on file"
        />
        <StatCard
          title="BANK ACCOUNTS"
          value={bankAccountCount ?? 'Not visible to you'}
          format={bankAccountCount === null ? 'raw' : 'number'}
          status="default"
          subtext={bankAccountCount === null ? 'Needs bank or manage permission' : 'Accounts on file'}
        />
      </StatCardGrid>

      <Box>
        <Typography variant="subtitle2" fontWeight={700} gutterBottom>
          Recent activity
        </Typography>
        {recent.isError && <Typography color="error">{errorText(recent.error)}</Typography>}
        {(recent.data?.items ?? []).length === 0 && !recent.isLoading && (
          <Typography variant="body2" color="text.secondary">
            No activity recorded yet.
          </Typography>
        )}
        {(recent.data?.items ?? []).map((a) => (
          <Typography key={a.id} variant="body2" sx={{ mb: 0.5 }}>
            {new Date(a.occurredAt).toLocaleDateString('en-IN')} · {activityLabel(a.action)}
            {a.actorName ? ` · ${a.actorName}` : ''}
          </Typography>
        ))}
      </Box>
    </Stack>
  );
}
