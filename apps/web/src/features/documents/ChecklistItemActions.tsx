// Actions on one checklist row (owner: Dev 3; DSA Notion MODULE 20: CMP-DOC.03.1 upload widget, CMP-DOC.05.1 review, CMP-DOC.05.2
// viewer, API-APP-009 waiver). Staff upload a file for the item, a reviewer opens the current version and accepts or rejects it with a
// reason code, and Loan Ops or a branch manager waive an item that does not apply. Which buttons show comes from itemActions().
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { DOCUMENT_MIME_TYPES, DOCUMENT_REJECT_REASONS } from '@dsa/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { errorText, newIdempotencyKey } from '../../api/client';
import { hasPermission, useMe } from '../../api/useMe';
import {
  currentVersion,
  getDocument,
  openDocumentVersion,
  reviewDocumentVersion,
  uploadChecklistDocument,
  waiveChecklistItem,
} from './api';
import { itemActions, readable, type ChecklistItem } from './model';

export function ChecklistItemActions({ item }: { item: ChecklistItem }) {
  const me = useMe();
  const qc = useQueryClient();
  const actions = itemActions(item, (code) => hasPermission(me.data, code));
  const fileInput = useRef<HTMLInputElement>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [waiveOpen, setWaiveOpen] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['application-checklist', item.applicationId] });
    // A review or waiver can complete the checklist, and the API then moves the application to Under review by itself: reload it too.
    qc.invalidateQueries({ queryKey: [`/v1/applications/${item.applicationId}`] });
    qc.invalidateQueries({ queryKey: ['/v1/applications'] });
  };

  const upload = useMutation({
    meta: { successMessage: 'Document uploaded. It now waits for review.' },
    mutationFn: async (file: File) => {
      const r = await uploadChecklistDocument(item.id, file);
      // A file that fails the scan is kept as a quarantined version and the item stays where it was: report it as an error.
      if (r.scanStatus === 'QUARANTINED') {
        throw new Error(
          'The file did not pass the scan and was quarantined. Upload a clean PDF, JPEG or PNG.',
        );
      }
      return r;
    },
    onSettled: refresh,
  });

  const view = useMutation({
    meta: { handled: true },
    mutationFn: async () => {
      if (!item.documentId) {
        throw new Error('No document has been linked to this checklist item.');
      }
      try {
        const doc = await getDocument(item.documentId);
        const v = currentVersion(doc);
        if (!v) throw new Error('This document has no version to open.');
        await openDocumentVersion(v.id);
      } catch (err: unknown) {
        const errorObj = err as { httpStatus?: number; status?: number; code?: string; message?: string };
        if (errorObj?.httpStatus === 404 || errorObj?.status === 404 || errorObj?.code === 'NOT_FOUND') {
          throw new Error('Document record was not found or is no longer available on the server.');
        }
        throw err;
      }
    },
  });

  if (!actions.upload && !actions.view && !actions.review && !actions.waive) return null;

  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {actions.upload && (
        <>
          <input
            ref={fileInput}
            type="file"
            hidden
            accept={DOCUMENT_MIME_TYPES.join(',')}
            data-testid={`documents.upload-input.${item.id}`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) upload.mutate(file);
            }}
          />
          <Button
            size="small"
            variant="outlined"
            disabled={upload.isPending}
            onClick={() => fileInput.current?.click()}
            data-testid={`documents.upload.${item.id}`}
          >
            {upload.isPending ? 'Uploading…' : item.documentId ? 'Upload new version' : 'Upload'}
          </Button>
        </>
      )}
      {actions.view && (
        <Button
          size="small"
          disabled={view.isPending}
          onClick={() => view.mutate()}
          data-testid={`documents.view.${item.id}`}
        >
          View
        </Button>
      )}
      {actions.review && (
        <Button
          size="small"
          variant="contained"
          onClick={() => setReviewOpen(true)}
          data-testid={`documents.review.${item.id}`}
        >
          Review
        </Button>
      )}
      {actions.waive && (
        <Button
          size="small"
          color="inherit"
          onClick={() => setWaiveOpen(true)}
          data-testid={`documents.waive.${item.id}`}
        >
          Waive
        </Button>
      )}
      {view.isError && (
        <Typography variant="caption" color="error">
          {errorText(view.error)}
        </Typography>
      )}
      {reviewOpen && <ReviewDialog item={item} onClose={() => setReviewOpen(false)} onDone={refresh} />}
      {waiveOpen && <WaiveDialog item={item} onClose={() => setWaiveOpen(false)} onDone={refresh} />}
    </Stack>
  );
}

/** Accept or reject the current version (API-DOC-006). A rejection needs a reason code, which the checklist then shows. */
function ReviewDialog({
  item,
  onClose,
  onDone,
}: {
  item: ChecklistItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const doc = useQuery({
    queryKey: ['document', item.documentId],
    queryFn: () => getDocument(item.documentId!),
  });
  const version = doc.data ? currentVersion(doc.data) : undefined;
  const [reasonCode, setReasonCode] = useState<(typeof DOCUMENT_REJECT_REASONS)[number] | ''>('');
  const [comment, setComment] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const key = useRef(newIdempotencyKey());

  const review = useMutation({
    meta: { successMessage: 'Review recorded.' },
    mutationFn: (decision: 'ACCEPT' | 'REJECT') =>
      reviewDocumentVersion(
        version!.id,
        {
          decision,
          ...(decision === 'REJECT' && reasonCode ? { reasonCode } : {}),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
          ...(decision === 'ACCEPT' && validUntil ? { validUntil } : {}),
        },
        key.current,
      ),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const open = useMutation({ meta: { handled: true }, mutationFn: () => openDocumentVersion(version!.id) });

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Review {readable(item.documentTypeCode)}</DialogTitle>
      <DialogContent>
        {doc.isError && <Alert severity="error">{errorText(doc.error)}</Alert>}
        {version && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <DialogContentText>
              Version {version.versionNo}: {version.fileName} ({Math.ceil(version.sizeBytes / 1024)} KB, scan{' '}
              {version.scanStatus.toLowerCase()}). Open it, check it against the checklist, then accept or
              reject it.
            </DialogContentText>
            <Button
              variant="outlined"
              onClick={() => open.mutate()}
              disabled={open.isPending}
              data-testid="documents.review-dialog.open"
            >
              Open document
            </Button>
            {open.isError && <Alert severity="error">{errorText(open.error)}</Alert>}
            <TextField
              select
              label="Reason code (needed to reject)"
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value as typeof reasonCode)}
              inputProps={{ 'data-testid': 'documents.review-dialog.reason' }}
            >
              {DOCUMENT_REJECT_REASONS.map((r) => (
                <MenuItem key={r} value={r}>
                  {readable(r)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              multiline
              minRows={2}
              inputProps={{ maxLength: 1000, 'data-testid': 'documents.review-dialog.comment' }}
              helperText="Do not type PAN, Aadhaar or account numbers."
            />
            <TextField
              type="date"
              label="Valid until (optional, on accept)"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Stack>
        )}
        {review.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {errorText(review.error)}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          color="error"
          variant="outlined"
          disabled={!version || !reasonCode || review.isPending}
          onClick={() => review.mutate('REJECT')}
          data-testid="documents.review-dialog.reject"
        >
          Reject
        </Button>
        <Button
          color="success"
          variant="contained"
          disabled={!version || review.isPending}
          onClick={() => review.mutate('ACCEPT')}
          data-testid="documents.review-dialog.accept"
        >
          Accept
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Mark an item WAIVED or NOT_APPLICABLE with a reason (API-APP-009). */
function WaiveDialog({
  item,
  onClose,
  onDone,
}: {
  item: ChecklistItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<'WAIVED' | 'NOT_APPLICABLE'>('WAIVED');
  const [reason, setReason] = useState('');
  const key = useRef(newIdempotencyKey());
  const waive = useMutation({
    meta: { successMessage: status === 'WAIVED' ? 'Item waived.' : 'Item marked not applicable.' },
    mutationFn: () =>
      waiveChecklistItem(
        item.applicationId,
        { checklistItemId: item.id, status, reason: reason.trim() },
        key.current,
      ),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const tooShort = reason.trim().length < 5;
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Waive {readable(item.documentTypeCode)}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            label="Mark as"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <MenuItem value="WAIVED">Waived</MenuItem>
            <MenuItem value="NOT_APPLICABLE">Not applicable</MenuItem>
          </TextField>
          <TextField
            label="Reason"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            multiline
            minRows={2}
            helperText="At least 5 characters. The reason is kept in the audit trail."
            inputProps={{ maxLength: 500, 'data-testid': 'documents.waive-dialog.reason' }}
          />
          {waive.isError && <Alert severity="error">{errorText(waive.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={tooShort || waive.isPending}
          onClick={() => waive.mutate()}
          data-testid="documents.waive-dialog.submit"
        >
          Confirm
        </Button>
      </DialogActions>
    </Dialog>
  );
}
