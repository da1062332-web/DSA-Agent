// The audit trail of one connector, from GET /v1/connectors/:id/activity. Only what happened, when, by whom and why is shown; the stored
// before and after values are never fetched.
import React from 'react';
import { Alert, Box, CircularProgress } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type { ConnectorActivityResource } from '@dsa/contracts';
import { apiFetch, errorText } from '../../api/client';
import { DataTable, type ColumnDef } from '../../ui';
import { activityLabel } from './connector-workspace-model';

export function ConnectorActivityTab({ connectorId }: { connectorId: string }) {
  const activity = useQuery<{ items: ConnectorActivityResource[] }>({
    queryKey: ['connector-activity', connectorId],
    queryFn: () =>
      apiFetch<{ items: ConnectorActivityResource[] }>(`/v1/connectors/${connectorId}/activity?limit=100`),
  });

  if (activity.isLoading) return <CircularProgress size={28} />;
  if (activity.isError) return <Alert severity="error">{errorText(activity.error)}</Alert>;

  const columns: ColumnDef<ConnectorActivityResource>[] = [
    {
      id: 'when',
      header: 'When',
      render: (a) => new Date(a.occurredAt).toLocaleString('en-IN'),
    },
    { id: 'what', header: 'What happened', render: (a) => activityLabel(a.action) },
    { id: 'record', header: 'Record', render: (a) => a.entityType },
    { id: 'by', header: 'By', render: (a) => a.actorName ?? a.actorId },
    { id: 'reason', header: 'Reason', render: (a) => a.reason ?? '—' },
  ];

  return (
    <Box>
      <DataTable<ConnectorActivityResource>
        dataTestId="con.table.activity"
        data={activity.data?.items ?? []}
        columns={columns}
        keyExtractor={(a) => a.id}
        emptyMessage="No activity is recorded for this connector yet."
      />
    </Box>
  );
}
