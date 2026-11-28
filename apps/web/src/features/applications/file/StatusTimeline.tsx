// The status journey of the file, newest first, from GET /v1/applications/{id}/status-history (owner: Bhushan, 2026-11-28).
import { Box, Stack, Typography } from '@mui/material';
import { UserName } from '../../../shell/display';
import { fileDateTime, humanize, transitionLabel } from '../loan-file';
import { STATUS_LABELS } from '../rules';

export interface StatusHistoryEntry {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  transitionCode: string;
  reason: string | null;
  actorId: string;
  causedByLenderCaseId: string | null;
  occurredAt: string;
}

const STEP_NAMES: Record<string, string> = {
  'T-APP-01': 'Documents started',
  'T-APP-02': 'Sent to credit review',
  'T-APP-03': 'Sent back for rework',
  'T-APP-04': 'Marked ready for submission',
  'T-APP-05': 'Sent back to review',
  'T-APP-06': 'Submitted to a lender',
  'T-APP-07': 'Closed',
  'T-APP-08': 'Withdrawn by the customer',
  'T-APP-09': 'Reopened as a draft',
  'T-APP-10': 'Cancelled',
  'T-APP-11': 'Rejected',
};

/** What happened, in words: the step name, or for creation whether it came from a lead. */
function stepName(e: StatusHistoryEntry): string {
  if (e.transitionCode === 'CREATE')
    return e.reason === 'CONVERSION' ? 'Converted from a lead' : 'Application opened';
  if (e.transitionCode.startsWith('ROLLUP')) return 'Updated from the lender';
  return STEP_NAMES[e.transitionCode] ?? e.transitionCode;
}

/** A code (CREATED_IN_ERROR) reads as words; a typed reason is shown as typed. Creation markers are not reasons. */
function reasonText(e: StatusHistoryEntry): string | null {
  if (!e.reason || e.transitionCode === 'CREATE') return null;
  return /^[A-Z_]+$/.test(e.reason) ? humanize(e.reason) : e.reason;
}

export function StatusTimeline({ entries }: { entries: StatusHistoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No status changes recorded yet.
      </Typography>
    );
  }
  const newestFirst = [...entries].reverse();
  return (
    <Stack spacing={0} data-testid="application.timeline">
      {newestFirst.map((e, i) => {
        const reason = reasonText(e);
        return (
          <Stack key={e.id} direction="row" spacing={2} data-testid={`application.timeline.${e.id}`}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 0.5 }}>
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  bgcolor: i === 0 ? 'primary.main' : 'grey.400',
                  flexShrink: 0,
                }}
              />
              {i < newestFirst.length - 1 && <Box sx={{ width: 2, flex: 1, bgcolor: 'grey.200', my: 0.5 }} />}
            </Box>
            <Box sx={{ pb: 2, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {stepName(e)}
              </Typography>
              <Typography variant="caption" color="text.secondary" component="div">
                {transitionLabel(e.fromStatus, e.toStatus, STATUS_LABELS as Record<string, string>)} ·{' '}
                {fileDateTime(e.occurredAt)} · <UserName id={e.actorId} fallback="System" />
              </Typography>
              {reason && (
                <Typography variant="caption" component="div" sx={{ mt: 0.25, color: 'text.primary' }}>
                  Reason: {reason}
                </Typography>
              )}
            </Box>
          </Stack>
        );
      })}
    </Stack>
  );
}
