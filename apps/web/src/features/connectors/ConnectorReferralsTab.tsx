// The referrals attributed to one connector, from GET /v1/connectors/:id/referrals. The API refuses a caller without lead.read, and a
// connector the caller may not see is not found; both are shown as they are, not as an empty list.
import React from 'react';
import { Alert, Box, Chip, CircularProgress } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type { ConnectorReferralResource } from '@dsa/contracts';
import { ACCESS_DENIED_TEXT, apiFetch, ApiError, errorText } from '../../api/client';
import { DataTable, type ColumnDef } from '../../ui';

const LEAD_STATE_LABEL: Record<string, string> = {
  NEW: 'New',
  CONTACT_ATTEMPTED: 'Contact attempted',
  IN_PROGRESS: 'In progress',
  QUALIFIED: 'Qualified',
  CONVERTED: 'Converted',
  DISQUALIFIED: 'Disqualified',
  NOT_CONTACTABLE: 'Not contactable',
  MERGED: 'Merged',
  ARCHIVED: 'Archived',
};

export function ConnectorReferralsTab({ connectorId }: { connectorId: string }) {
  const referrals = useQuery<{ items: ConnectorReferralResource[] }>({
    queryKey: ['connector-referrals', connectorId],
    queryFn: () =>
      apiFetch<{ items: ConnectorReferralResource[] }>(`/v1/connectors/${connectorId}/referrals`),
  });

  if (referrals.isLoading) {
    return <CircularProgress size={28} />;
  }
  if (referrals.isError) {
    const denied = referrals.error instanceof ApiError && referrals.error.httpStatus === 403;
    return (
      <Alert severity={denied ? 'info' : 'error'}>
        {denied ? ACCESS_DENIED_TEXT : errorText(referrals.error)}
      </Alert>
    );
  }

  const columns: ColumnDef<ConnectorReferralResource>[] = [
    { id: 'reference', header: 'Reference', render: (r) => <code>{r.id}</code> },
    { id: 'customer', header: 'Customer', render: (r) => r.customerName },
    {
      id: 'product',
      header: 'Loan type',
      render: (r) => <Chip label={r.productCategory} size="small" variant="outlined" />,
    },
    {
      id: 'state',
      header: 'Status',
      render: (r) => LEAD_STATE_LABEL[r.state] ?? r.state,
    },
    {
      id: 'duplicate',
      header: 'Duplicate check',
      render: (r) =>
        r.duplicateFlag === 'NONE' ? 'None' : <Chip label={r.duplicateFlag} size="small" color="warning" />,
    },
    {
      id: 'application',
      header: 'Application',
      render: (r) =>
        r.applicationId ? (
          <span>
            <code>{r.applicationId}</code>
            {r.applicationStatus ? ` · ${r.applicationStatus}` : ''}
          </span>
        ) : (
          'None yet'
        ),
    },
    {
      id: 'submitted',
      header: 'Submitted',
      render: (r) => new Date(r.createdAt).toLocaleDateString('en-IN'),
    },
    {
      id: 'updated',
      header: 'Last updated',
      render: (r) => new Date(r.updatedAt).toLocaleDateString('en-IN'),
    },
  ];

  return (
    <Box>
      <DataTable<ConnectorReferralResource>
        dataTestId="con.table.referrals"
        data={referrals.data?.items ?? []}
        columns={columns}
        keyExtractor={(r) => r.id}
        emptyMessage="No referrals are attributed to this connector yet."
      />
    </Box>
  );
}
