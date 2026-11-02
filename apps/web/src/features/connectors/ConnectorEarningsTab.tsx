// The connector's commission payables, from GET /v1/commission-payables?connectorId= (the finance read). Amounts are the stored payable
// records; nothing here recomputes commission. A caller without a finance permission is told so, not shown zeros.
import React from 'react';
import { Alert, Box, CircularProgress, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type { CommissionPayableResponse } from '@dsa/contracts';
import { ACCESS_DENIED_TEXT, apiFetch, ApiError, errorText } from '../../api/client';
import { DataTable, StatCard, StatCardGrid, StatusBadge, type ColumnDef } from '../../ui';
import { payableBuckets } from './connector-workspace-model';

const money = (amount: string) => `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const STATE_TONE: Record<string, 'success' | 'info' | 'warning' | 'neutral'> = {
  PAID: 'success',
  APPROVED: 'info',
  IN_PAYOUT: 'info',
  ELIGIBLE: 'info',
  ON_HOLD: 'warning',
};

export function ConnectorEarningsTab({ connectorId }: { connectorId: string }) {
  const payables = useQuery<{ data: CommissionPayableResponse[] }>({
    queryKey: ['connector-payables', connectorId],
    queryFn: () =>
      apiFetch<{ data: CommissionPayableResponse[] }>(
        `/v1/commission-payables?connectorId=${connectorId}&limit=100`,
      ),
  });

  if (payables.isLoading) return <CircularProgress size={28} />;
  if (payables.isError) {
    const denied = payables.error instanceof ApiError && payables.error.httpStatus === 403;
    return (
      <Alert severity={denied ? 'info' : 'error'}>
        {denied ? ACCESS_DENIED_TEXT : errorText(payables.error)}
      </Alert>
    );
  }

  const rows = payables.data?.data ?? [];
  const buckets = payableBuckets(rows);

  const columns: ColumnDef<CommissionPayableResponse>[] = [
    { id: 'reference', header: 'Payable', render: (p) => <code>{p.id}</code> },
    { id: 'calculation', header: 'Calculation', render: (p) => <code>{p.calculationId}</code> },
    { id: 'amount', header: 'Amount', align: 'right', render: (p) => money(p.amount) },
    {
      id: 'state',
      header: 'State',
      render: (p) => <StatusBadge status={STATE_TONE[p.state] ?? 'neutral'} label={p.state} />,
    },
    { id: 'date', header: 'Recorded', render: (p) => new Date(p.createdAt).toLocaleDateString('en-IN') },
  ];

  return (
    <Box>
      <StatCardGrid columns={{ xs: 12, sm: 4 }}>
        <StatCard title="EXPECTED" value={money(buckets.expected)} format="raw" status="info" />
        <StatCard
          title="APPROVED OR IN PAYOUT"
          value={money(buckets.approved)}
          format="raw"
          status="primary"
        />
        <StatCard title="PAID" value={money(buckets.paid)} format="raw" status="success" />
      </StatCardGrid>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2, mb: 2 }}>
        On hold: {money(buckets.held)}. This list shows the stored payable records. Disputes raised by the
        partner on a statement line are not listed here yet: no internal read of them by connector exists.
      </Typography>
      <Stack>
        <DataTable<CommissionPayableResponse>
          dataTestId="con.table.payables"
          data={rows}
          columns={columns}
          keyExtractor={(p) => p.id}
          emptyMessage="No commission payables are recorded for this connector yet."
        />
      </Stack>
    </Box>
  );
}
