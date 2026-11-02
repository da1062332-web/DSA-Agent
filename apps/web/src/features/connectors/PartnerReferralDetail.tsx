// One referral, as the partner sees it: its progress on approved steps, and the documents requested for it. A document is sent through the
// existing upload path, and only when the API says uploads are available. Nothing is downloadable here.
import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, errorText } from '../../api/client';
import {
  DOCUMENT_STATUS_LABEL,
  uploadUnavailableMessage,
  type PortalDocumentItem,
  type PortalDocumentList,
  type PortalReferralDetail as ReferralDetail,
} from './portal-model';
import { browserUploadPort, sendPartnerDocument, type PartnerUploadStage } from './partner-upload';

const UPLOAD_STAGE_LABEL: Record<PartnerUploadStage, string> = {
  UPLOADING: 'Uploading',
  SCANNING: 'Pending security scan',
  ACCEPTED: 'Accepted',
  NOT_ACCEPTED: 'Rejected',
  FAILED: 'Failed',
};

export function PartnerReferralDetail({ leadId }: { leadId: string }) {
  const queryClient = useQueryClient();
  const [uploads, setUploads] = useState<Record<string, { stage: PartnerUploadStage; message?: string }>>({});

  const referral = useQuery<ReferralDetail>({
    queryKey: ['/portal/v1/referrals', leadId],
    queryFn: () => apiFetch<ReferralDetail>(`/portal/v1/referrals/${leadId}`),
  });
  const documents = useQuery<PortalDocumentList>({
    queryKey: ['/portal/v1/referrals', leadId, 'documents'],
    queryFn: () => apiFetch<PortalDocumentList>(`/portal/v1/referrals/${leadId}/documents`),
  });

  const send = async (doc: PortalDocumentItem, file: File) => {
    await sendPartnerDocument(leadId, doc, file, browserUploadPort(), (stage, message) =>
      setUploads((u) => ({ ...u, [doc.checklistItemId]: { stage, message } })),
    );
    queryClient.invalidateQueries({ queryKey: ['/portal/v1/referrals', leadId, 'documents'] });
  };

  if (referral.isLoading) return <CircularProgress size={28} />;
  if (referral.isError) return <Alert severity="error">{errorText(referral.error)}</Alert>;
  const r = referral.data;
  if (!r) return null;

  const activeStep = Math.max(
    0,
    r.steps.findIndex((s) => s.current),
  );
  const docs = documents.data;
  const unavailable = docs ? uploadUnavailableMessage(docs.unavailableReason) : null;

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h6" fontWeight={700}>
          {r.name}
        </Typography>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 0.5 }}>
          <Chip size="small" label={r.productCategory} variant="outlined" />
          <Typography variant="body2" color="text.secondary">
            {r.mobileMasked} · Submitted {new Date(r.submittedAt).toLocaleDateString('en-IN')} · Last updated{' '}
            {new Date(r.lastUpdatedAt).toLocaleDateString('en-IN')}
          </Typography>
        </Stack>
      </Box>

      <Box>
        <Typography variant="subtitle2" fontWeight={700} gutterBottom>
          Progress
        </Typography>
        <Stepper activeStep={activeStep} alternativeLabel>
          {r.steps.map((step) => (
            <Step key={step.key} completed={step.done}>
              <StepLabel>{step.label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Box>

      <Box>
        <Typography variant="subtitle2" fontWeight={700} gutterBottom>
          Documents requested
        </Typography>
        {documents.isLoading && <CircularProgress size={24} />}
        {documents.isError && <Alert severity="error">{errorText(documents.error)}</Alert>}
        {docs && !docs.uploadAvailable && unavailable && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {unavailable}
          </Alert>
        )}
        {docs && docs.items.length === 0 && !unavailable && (
          <Typography variant="body2" color="text.secondary">
            No documents are requested for this referral.
          </Typography>
        )}
        <Stack spacing={1.5}>
          {docs?.items.map((doc) => {
            const upload = uploads[doc.checklistItemId];
            const canSend =
              !!docs.uploadAvailable &&
              doc.actionRequired &&
              upload?.stage !== 'UPLOADING' &&
              upload?.stage !== 'SCANNING';
            return (
              <Box
                key={doc.checklistItemId}
                sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}
              >
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between">
                  <Box>
                    <Typography fontWeight={600}>{doc.documentName}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {doc.allowedMime
                        .map((m) => m.replace('application/', '').replace('image/', '').toUpperCase())
                        .join(', ')}
                      {' · up to '}
                      {Math.round(doc.maxSizeBytes / (1024 * 1024))} MB
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip size="small" label={DOCUMENT_STATUS_LABEL[doc.status]} variant="outlined" />
                    {upload && (
                      <Chip
                        size="small"
                        color={
                          upload.stage === 'ACCEPTED'
                            ? 'success'
                            : upload.stage === 'NOT_ACCEPTED' || upload.stage === 'FAILED'
                              ? 'error'
                              : 'default'
                        }
                        label={UPLOAD_STAGE_LABEL[upload.stage]}
                      />
                    )}
                    {canSend && (
                      <Button
                        component="label"
                        size="small"
                        variant="contained"
                        data-testid={`cpt.doc.send.${doc.checklistItemId}`}
                      >
                        {upload?.stage === 'NOT_ACCEPTED' || upload?.stage === 'FAILED'
                          ? 'Send again'
                          : 'Send file'}
                        <input
                          type="file"
                          hidden
                          accept={doc.allowedMime.join(',')}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (file) void send(doc, file);
                          }}
                        />
                      </Button>
                    )}
                  </Stack>
                </Stack>
                {upload?.message && (
                  <Typography variant="body2" color="error" sx={{ mt: 1 }}>
                    {upload.message}
                  </Typography>
                )}
              </Box>
            );
          })}
        </Stack>
      </Box>
    </Stack>
  );
}
