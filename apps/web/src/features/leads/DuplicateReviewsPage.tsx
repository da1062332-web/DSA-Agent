// /leads/duplicates (owner: Dev 5; DSA Notion MODULE 7, SUB-LEAD.04: CMP-LEAD.04.2 duplicate review UI, API-LEAD-008 and 009).
// The pairs the duplicate check flagged at capture. A reviewer with lead.merge compares the two leads and either merges them (the
// survivor stays, the other becomes MERGED) or dismisses the pair. Both need a reason, which goes to the lead history and audit.
import {
  Alert,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Link,
  Radio,
  RadioGroup,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { errorText, newIdempotencyKey } from '../../api/client';
import { useList } from '../admin/api';
import { ErrorAlert, LoadMore, Loading, PageHeader, formatDate } from '../admin/components';
import { DataTable } from '../../ui';
import { fetchLeadById, resolveDuplicateReview, type DuplicateReview } from './api';

type Status = DuplicateReview['status'];

function LeadCell({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['lead', id], queryFn: () => fetchLeadById(id), staleTime: 60_000 });
  const lead = q.data?.lead;
  return (
    <Stack spacing={0.25}>
      <Link component={RouterLink} to={`/leads/${id}`}>
        {lead?.fullName ?? id}
      </Link>
      {lead && (
        <Typography variant="caption" color="text.secondary">
          {lead.mobileMasked} · {lead.state} · {formatDate(lead.createdAt)}
        </Typography>
      )}
      {q.isError && (
        <Typography variant="caption" color="text.secondary">
          Not visible to you
        </Typography>
      )}
    </Stack>
  );
}

export function DuplicateReviewsPage() {
  const [status, setStatus] = useState<Status>('OPEN');
  const [resolving, setResolving] = useState<DuplicateReview | null>(null);
  const list = useList<DuplicateReview>('/v1/duplicate-reviews', { status });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <>
      <PageHeader
        title="Duplicate reviews"
        subtitle="Leads flagged as possible or exact duplicates at capture. Merge a pair to keep one lead, or dismiss it when they are different people."
      />
      <Tabs value={status} onChange={(_e, v: Status) => setStatus(v)} sx={{ mb: 2 }}>
        <Tab value="OPEN" label="Open" data-testid="duplicates.tab.open" />
        <Tab value="MERGED" label="Merged" />
        <Tab value="DISMISSED" label="Dismissed" />
      </Tabs>
      <ErrorAlert error={list.error} />
      {list.isLoading ? (
        <Loading />
      ) : rows.length === 0 && !list.error ? (
        <Card sx={{ p: 3 }} data-testid="duplicates.empty">
          <Typography color="text.secondary">
            {status === 'OPEN' ? 'No duplicate pairs are waiting for review.' : 'Nothing here yet.'}
          </Typography>
        </Card>
      ) : (
        <DataTable<DuplicateReview>
          dataTestId="duplicates.table"
          data={rows}
          keyExtractor={(r) => r.id}
          columns={[
            {
              id: 'classification',
              header: 'Classification',
              render: (r) => (
                <Chip
                  size="small"
                  color={r.classification === 'EXACT' ? 'error' : 'warning'}
                  label={r.classification.toLowerCase().replace(/_/g, ' ')}
                />
              ),
            },
            { id: 'existing', header: 'Existing lead', render: (r) => <LeadCell id={r.leftId} /> },
            { id: 'new', header: 'New lead', render: (r) => <LeadCell id={r.rightId} /> },
            { id: 'flagged', header: 'Flagged', render: (r) => formatDate(r.createdAt) },
            {
              id: 'action',
              header: status === 'OPEN' ? 'Action' : 'Outcome',
              align: 'right',
              render: (r) =>
                r.status === 'OPEN' ? (
                  <Button size="small" variant="outlined" onClick={() => setResolving(r)} data-testid="duplicates.resolve">
                    Resolve
                  </Button>
                ) : (
                  <Typography variant="body2">
                    {r.status.toLowerCase()}
                    {r.resolution ? `: ${r.resolution}` : ''}
                  </Typography>
                ),
            },
          ]}
        />
      )}
      <LoadMore
        hasNext={!!list.hasNextPage}
        loading={list.isFetchingNextPage}
        onClick={() => list.fetchNextPage()}
      />
      {resolving && <ResolveDialog review={resolving} onClose={() => setResolving(null)} />}
    </>
  );
}

function ResolveDialog({ review, onClose }: { review: DuplicateReview; onClose: () => void }) {
  const qc = useQueryClient();
  const [action, setAction] = useState<'MERGE' | 'DISMISS'>('MERGE');
  const [survivorId, setSurvivorId] = useState(review.leftId);
  const [reason, setReason] = useState('');
  const key = useRef(newIdempotencyKey());
  const resolve = useMutation({
    meta: { successMessage: action === 'MERGE' ? 'Leads merged.' : 'Pair dismissed.' },
    mutationFn: () =>
      resolveDuplicateReview(
        review.id,
        { action, reason: reason.trim(), ...(action === 'MERGE' ? { survivorId } : {}) },
        key.current,
      ),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['/v1/duplicate-reviews'] }),
        qc.invalidateQueries({ queryKey: ['lead', review.leftId] }),
        qc.invalidateQueries({ queryKey: ['lead', review.rightId] }),
      ]);
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Resolve duplicate pair</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <RadioGroup row value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
            <FormControlLabel value="MERGE" control={<Radio />} label="Merge" />
            <FormControlLabel value="DISMISS" control={<Radio />} label="Not a duplicate" />
          </RadioGroup>
          {action === 'MERGE' && (
            <>
              <DialogContentText>
                Which lead stays? The other one becomes MERGED and points to it.
              </DialogContentText>
              <RadioGroup value={survivorId} onChange={(e) => setSurvivorId(e.target.value)}>
                <FormControlLabel
                  value={review.leftId}
                  control={<Radio />}
                  label={<LeadCell id={review.leftId} />}
                />
                <FormControlLabel
                  value={review.rightId}
                  control={<Radio />}
                  label={<LeadCell id={review.rightId} />}
                />
              </RadioGroup>
            </>
          )}
          <TextField
            label="Reason"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            helperText="3 to 200 characters. No identity or account numbers."
            inputProps={{ maxLength: 200, 'data-testid': 'duplicates.reason' }}
          />
          {resolve.isError && <Alert severity="error">{errorText(resolve.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={reason.trim().length < 3 || resolve.isPending}
          onClick={() => resolve.mutate()}
          data-testid="duplicates.submit"
        >
          {action === 'MERGE' ? 'Merge leads' : 'Dismiss pair'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
