// Connector verification: the status, the decisions recorded against it, and the actions the API supports. The API activates a connector
// only on a VERIFIED verification record. A connector has no verification subject of its own yet, so reject and request-information are
// shown as unavailable rather than offered as working buttons.
import React from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type { ConnectorActivityResource, ConnectorResource } from '@dsa/contracts';
import { apiFetch, errorText } from '../../api/client';
import { DataTable, StatusBadge, type ColumnDef } from '../../ui';
import { activityLabel, verificationHistory } from './connector-workspace-model';

/** The states from which the activation action is offered. The API also accepts activation of a suspended connector; the page does not offer it. */
const ACTIVATABLE = ['DRAFT', 'PENDING_VERIFICATION'];

export function ConnectorVerificationTab({
  connector,
  canManage,
  onActivate,
}: {
  connector: ConnectorResource;
  canManage: boolean;
  onActivate: () => void;
}) {
  const activity = useQuery<{ items: ConnectorActivityResource[] }>({
    queryKey: ['connector-activity', connector.id],
    queryFn: () =>
      apiFetch<{ items: ConnectorActivityResource[] }>(`/v1/connectors/${connector.id}/activity?limit=100`),
  });

  const history = verificationHistory(activity.data?.items ?? []);
  const canActivate = canManage && ACTIVATABLE.includes(connector.status);

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Typography variant="subtitle1" fontWeight={700}>
          Current status
        </Typography>
        <StatusBadge
          status={
            connector.status === 'ACTIVE'
              ? 'success'
              : connector.status === 'SUSPENDED'
                ? 'danger'
                : 'neutral'
          }
          label={connector.status}
        />
      </Stack>

      <Alert severity="info">
        Activation needs a verification record with the result VERIFIED. The record is checked for that
        result; its link to this connector is not checked yet, because verification records cannot name a
        connector as their subject. This is a pending decision.
      </Alert>

      <Stack direction="row" spacing={1}>
        <Button
          variant="contained"
          disabled={!canActivate}
          onClick={onActivate}
          data-testid="con.verification.activate"
        >
          Activate on a verified check
        </Button>
        <Button
          variant="outlined"
          disabled
          title="Not available: a connector has no verification record to reject yet."
        >
          Reject
        </Button>
        <Button
          variant="outlined"
          disabled
          title="Not available: no request-information workflow exists for connectors yet."
        >
          Request information
        </Button>
      </Stack>
      {!canManage && (
        <Typography variant="body2" color="text.secondary">
          Activation needs connector.manage. You can see the history below.
        </Typography>
      )}

      <Typography variant="subtitle2" fontWeight={700}>
        Verification history
      </Typography>
      {activity.isLoading ? (
        <CircularProgress size={24} />
      ) : activity.isError ? (
        <Alert severity="error">{errorText(activity.error)}</Alert>
      ) : (
        <Box>
          <DataTable<ConnectorActivityResource>
            dataTestId="con.table.verification-history"
            data={history}
            columns={[
              { id: 'when', header: 'When', render: (h) => new Date(h.occurredAt).toLocaleString('en-IN') },
              {
                id: 'what',
                header: 'Decision',
                render: (h) => activityLabel(h.action),
              } as ColumnDef<ConnectorActivityResource>,
              { id: 'by', header: 'By', render: (h) => h.actorName ?? h.actorId },
              { id: 'reason', header: 'Reason', render: (h) => h.reason ?? '—' },
            ]}
            keyExtractor={(h) => h.id}
            emptyMessage="No verification decisions are recorded for this connector yet."
          />
        </Box>
      )}
    </Stack>
  );
}
