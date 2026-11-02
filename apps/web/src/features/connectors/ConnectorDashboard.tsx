// The connector directory's dashboard. Every figure comes from GET /v1/connectors/summary, which counts only what the caller may see.
// A figure the caller may not see is shown as "not visible to you", never as zero.
import React, { useState } from 'react';
import { Alert, Box, CircularProgress, LinearProgress, Stack, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type { ConnectorSummaryResource } from '@dsa/contracts';
import { apiFetch, errorText } from '../../api/client';
import { StatCard, StatCardGrid } from '../../ui';
import { dashboardRangeParams, DIRECTORY_STATUS_OPTIONS } from './connector-workspace-model';

const NOT_VISIBLE = 'Not visible to you';

const money = (amount: string) => `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

export function ConnectorDashboard() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const range = dashboardRangeParams(from, to);

  const summary = useQuery<ConnectorSummaryResource>({
    queryKey: ['connector-summary', range.query],
    queryFn: () =>
      apiFetch<ConnectorSummaryResource>(`/v1/connectors/summary${range.query ? `?${range.query}` : ''}`),
    enabled: range.error === null,
  });

  const data = summary.data;
  const disputeTotal =
    data && data.disputes.attributionOpen !== null && data.disputes.partnerOpen !== null
      ? data.disputes.attributionOpen + data.disputes.partnerOpen
      : null;

  return (
    <Box sx={{ mb: 3 }} data-testid="con.dashboard">
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField
          size="small"
          type="date"
          label="From"
          InputLabelProps={{ shrink: true }}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextField
          size="small"
          type="date"
          label="To"
          InputLabelProps={{ shrink: true }}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </Stack>
      {range.error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {range.error}
        </Alert>
      )}
      {summary.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          The dashboard could not be loaded. {errorText(summary.error)}
        </Alert>
      )}

      {summary.isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {data && (
        <>
          <StatCardGrid columns={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard
              title="TOTAL CONNECTORS"
              value={data.connectors.total}
              format="number"
              status="primary"
            />
            <StatCard
              title="ACTIVE"
              value={data.connectors.byStatus.ACTIVE}
              format="number"
              status="success"
            />
            <StatCard
              title="PENDING VERIFICATION"
              value={data.connectors.byStatus.PENDING_VERIFICATION}
              format="number"
              status="warning"
            />
            <StatCard
              title="SUSPENDED"
              value={data.connectors.byStatus.SUSPENDED}
              format="number"
              status="error"
            />
            <StatCard title="TOTAL REFERRALS" value={data.referrals.total} format="number" status="primary" />
            <StatCard
              title="PENDING REFERRALS"
              value={data.referrals.pending}
              format="number"
              status="warning"
            />
            <StatCard
              title="CONVERTED REFERRALS"
              value={data.referrals.converted}
              format="number"
              status="success"
            />
            <StatCard
              title="PENDING DISPUTES"
              value={disputeTotal ?? NOT_VISIBLE}
              format={disputeTotal === null ? 'raw' : 'number'}
              status="warning"
            />
          </StatCardGrid>

          <Box sx={{ mt: 3 }}>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>
              Connectors by status
            </Typography>
            {DIRECTORY_STATUS_OPTIONS.map((status) => {
              const count = data.connectors.byStatus[status] ?? 0;
              const share = data.connectors.total > 0 ? Math.round((count / data.connectors.total) * 100) : 0;
              return (
                <Stack key={status} direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
                  <Typography variant="body2" sx={{ width: 180 }}>
                    {status.replace('_', ' ')}
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={share}
                    sx={{ flex: 1, height: 8, borderRadius: 4 }}
                  />
                  <Typography variant="body2" sx={{ width: 40, textAlign: 'right' }}>
                    {count}
                  </Typography>
                </Stack>
              );
            })}
          </Box>

          <Box sx={{ mt: 3 }}>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>
              Earnings (connectors you can see)
            </Typography>
            {data.earnings ? (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
                <Typography variant="body2">Expected: {money(data.earnings.expected)}</Typography>
                <Typography variant="body2">Approved: {money(data.earnings.approved)}</Typography>
                <Typography variant="body2">Paid: {money(data.earnings.paid)}</Typography>
                <Typography variant="body2">On hold: {money(data.earnings.held)}</Typography>
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {NOT_VISIBLE}: earnings need a finance permission.
              </Typography>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
