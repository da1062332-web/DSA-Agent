// apps/web/src/features/document-sharing/DocumentSharingPage.tsx
// Document sharing (MOD-DSH): customer upload links (SUB-DSH.01) and case share packages (SUB-DSH.02); QA plan Module 14.
// The forms pick a real application, its open checklist items and a lender from the API: nothing is typed or prefilled from
// fixtures. Opening /document-sharing?applicationId=…&action=upload-link (from a customer or application page) starts a link.
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { DataTable } from '../../ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, errorText, newIdempotencyKey } from '../../api/client';
import { Can } from '../../shell/Can';
import { ApplicationName } from '../../shell/display';
import type { ExternalShareRecord, UploadLinkRecord } from '@dsa/contracts';
import { useLookup } from '../admin/api';
import { ApplicationSelect } from '../applications/ApplicationSelect';
import { ConnectorSelect } from '../connectors/ConnectorSelect';
import { useChecklist } from '../documents/api';
import { readable } from '../documents/model';

/** Checklist items a customer can still send: nothing accepted, waived or not applicable. */
const OPEN_FOR_UPLOAD = ['PENDING', 'REJECTED', 'EXPIRED', 'SUBMITTED'];

export function DocumentSharingPage() {
  const queryClient = useQueryClient();
  const [tabIndex, setTabIndex] = useState(0);

  // Modals
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);

  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('applicationId') ?? '';

  // Link form state
  const [linkAppId, setLinkAppId] = useState(fromUrl);
  const [linkItems, setLinkItems] = useState<string[]>([]);
  const [linkHours, setLinkHours] = useState(48);
  const [linkMaxUses, setLinkMaxUses] = useState(5);
  const [linkOtpRequired, setLinkOtpRequired] = useState(true);
  const [createdLinkResult, setCreatedLinkResult] = useState<any | null>(null);

  const toggleChecklistItem = (itemId: string) =>
    setLinkItems((current) =>
      current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId],
    );
  const checklist = useChecklist(linkAppId || null);
  const uploadable = (checklist.data?.data ?? []).filter((i) => OPEN_FOR_UPLOAD.includes(i.status));
  const [linkKey, setLinkKey] = useState(newIdempotencyKey);

  // Share form state
  const [shareAppId, setShareAppId] = useState(fromUrl);
  const [shareRecipientType, setShareRecipientType] = useState('LENDER');
  const [shareRecipientId, setShareRecipientId] = useState('');
  const [shareRecipientName, setShareRecipientName] = useState('');
  const [shareRecipientEmail, setShareRecipientEmail] = useState('');
  const lenders = useLookup<{ id: string; name: string; status?: string }>(
    '/v1/lenders',
    {},
    isShareModalOpen,
  );
  const [shareKey, setShareKey] = useState(newIdempotencyKey);

  // A link from a customer or application page opens the upload-link form for that application.
  useEffect(() => {
    if (fromUrl && params.get('action') === 'upload-link') {
      setIsLinkModalOpen(true);
      params.delete('action');
      setParams(params, { replace: true });
    }
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [sharePurpose, setSharePurpose] = useState('LENDER_SUBMISSION');
  const [shareDays, setShareDays] = useState(7);

  // Queries
  const { data: uploadLinksData, isLoading: isLoadingLinks } = useQuery({
    queryKey: ['upload-links'],
    queryFn: () => apiFetch<{ data: UploadLinkRecord[] }>('/v1/upload-links'),
  });

  const { data: sharesData, isLoading: isLoadingShares } = useQuery({
    queryKey: ['shares'],
    queryFn: () => apiFetch<{ data: ExternalShareRecord[] }>('/v1/shares'),
  });

  // Mutations
  const createLinkMutation = useMutation({
    meta: { successMessage: 'Upload link created.' },
    mutationFn: (payload: any) =>
      apiFetch<UploadLinkRecord & { uploadUrl: string; generatedOtp?: string }>('/v1/upload-links', {
        method: 'POST',
        idempotencyKey: linkKey,
        body: payload,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['upload-links'] });
      setLinkKey(newIdempotencyKey());
      setCreatedLinkResult(data);
      setFeedback({ message: 'Upload link generated successfully!', severity: 'success' });
    },
    onError: (err: any) => {
      setFeedback({ message: errorText(err), severity: 'error' });
    },
  });

  const revokeLinkMutation = useMutation({
    meta: { successMessage: 'Upload link revoked.' },
    mutationFn: (id: string) => apiFetch(`/v1/upload-links/${id}/revocation`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['upload-links'] });
      setFeedback({ message: 'Upload link revoked successfully.', severity: 'success' });
    },
    onError: (err: any) => {
      setFeedback({ message: errorText(err), severity: 'error' });
    },
  });

  const createShareMutation = useMutation({
    meta: { successMessage: 'Share created.' },
    mutationFn: (payload: any) =>
      apiFetch<ExternalShareRecord>('/v1/shares', {
        method: 'POST',
        idempotencyKey: shareKey,
        body: payload,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shares'] });
      setShareKey(newIdempotencyKey());
      setIsShareModalOpen(false);
      setFeedback({
        message: 'Case share package created and logged in ENT-100 inventory.',
        severity: 'success',
      });
    },
    onError: (err: any) => {
      setFeedback({ message: errorText(err), severity: 'error' });
    },
  });

  const revokeShareMutation = useMutation({
    meta: { successMessage: 'Share revoked.' },
    mutationFn: (id: string) => apiFetch(`/v1/shares/${id}/revocation`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shares'] });
      setFeedback({ message: 'Case share package revoked.', severity: 'success' });
    },
    onError: (err: any) => {
      setFeedback({ message: errorText(err), severity: 'error' });
    },
  });

  const handleCreateLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkAppId || linkItems.length === 0) {
      setFeedback({
        message: 'Choose an application and at least one document to request.',
        severity: 'error',
      });
      return;
    }
    createLinkMutation.mutate({
      applicationId: linkAppId,
      checklistItemIds: linkItems,
      expiresInHours: linkHours,
      maxUses: linkMaxUses,
      otpRequired: linkOtpRequired,
    });
  };

  const handleCreateShare = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !shareAppId ||
      !shareRecipientId.trim() ||
      !shareRecipientName.trim() ||
      !shareRecipientEmail.trim()
    ) {
      setFeedback({ message: 'Fill in the application, recipient and contact.', severity: 'error' });
      return;
    }
    createShareMutation.mutate({
      applicationId: shareAppId,
      recipientType: shareRecipientType,
      recipientId: shareRecipientId.trim(),
      recipientContact: {
        name: shareRecipientName.trim(),
        email: shareRecipientEmail.trim(),
      },
      purpose: sharePurpose,
      expiresInDays: shareDays,
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setFeedback({ message: 'Copied to clipboard!', severity: 'success' });
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 4 }, maxWidth: 1300, mx: 'auto' }}>
      {/* Header */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems="flex-start"
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Document Sharing
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Secure upload links for customers, and consent-checked case packages for lenders
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5}>
          <Can action="share.create">
            <Button variant="outlined" onClick={() => setIsShareModalOpen(true)}>
              + Create Share Package
            </Button>
          </Can>
          <Can action="document.upload">
            <Button
              variant="contained"
              onClick={() => {
                setCreatedLinkResult(null);
                setIsLinkModalOpen(true);
              }}
            >
              + Generate Upload Link
            </Button>
          </Can>
        </Stack>
      </Stack>

      {feedback && (
        <Alert severity={feedback.severity} onClose={() => setFeedback(null)} sx={{ mb: 3 }}>
          {feedback.message}
        </Alert>
      )}

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={tabIndex} onChange={(_, val) => setTabIndex(val)}>
          <Tab label="Customer Upload Links (SUB-DSH.01)" />
          <Tab label="Case Share Packages (SUB-DSH.02)" />
        </Tabs>
      </Box>

      {/* Tab 1: Upload Links */}
      {tabIndex === 0 && (
        <Card elevation={0} sx={{ border: '1px solid #e0e0e0', borderRadius: 2 }}>
          <CardContent sx={{ p: 0 }}>
            {isLoadingLinks ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress />
              </Box>
            ) : !uploadLinksData?.data?.length ? (
              <Box sx={{ textAlign: 'center', py: 6 }}>
                <Typography color="text.secondary">No customer upload links created yet.</Typography>
                <Button sx={{ mt: 1.5 }} variant="text" onClick={() => setIsLinkModalOpen(true)}>
                  Generate your first upload link
                </Button>
              </Box>
            ) : (
              <DataTable<(typeof uploadLinksData.data)[number]>
                dataTestId="docshare.table.links"
                data={uploadLinksData.data}
                keyExtractor={(link) => link.id}
                columns={[
                  {
                    id: 'id',
                    header: 'Link ID',
                    render: (link) => <Box sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{link.id}</Box>,
                  },
                  { id: 'application', header: 'Application ID', render: (link) => <ApplicationName id={link.applicationId} linkToApp /> },
                  { id: 'items', header: 'Items Requested', render: (link) => `${link.items.length} items` },
                  { id: 'uses', header: 'Uses / Max', render: (link) => `${link.uses} / ${link.maxUses}` },
                  { id: 'expires', header: 'Expires At', render: (link) => new Date(link.expiresAt).toLocaleString() },
                  {
                    id: 'status',
                    header: 'Status',
                    render: (link) => {
                      const isExpired = new Date(link.expiresAt) < new Date();
                      const isRevoked = Boolean(link.revokedAt);
                      const isLocked = Boolean(link.lockedAt);
                      if (isRevoked) return <Chip label="REVOKED" color="error" size="small" />;
                      if (isLocked) return <Chip label="LOCKED" color="error" size="small" />;
                      if (isExpired) return <Chip label="EXPIRED" color="default" size="small" />;
                      return <Chip label="ACTIVE" color="success" size="small" />;
                    },
                  },
                  {
                    id: 'actions',
                    header: 'Actions',
                    align: 'right',
                    render: (link) => {
                      const isExpired = new Date(link.expiresAt) < new Date();
                      const isRevoked = Boolean(link.revokedAt);
                      const isLocked = Boolean(link.lockedAt);
                      return !isRevoked && !isExpired && !isLocked ? (
                        <Can action="document.upload">
                          <Button size="small" color="error" onClick={() => revokeLinkMutation.mutate(link.id)}>
                            Revoke
                          </Button>
                        </Can>
                      ) : null;
                    },
                  },
                ]}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab 2: Case Share Packages */}
      {tabIndex === 1 && (
        <Card elevation={0} sx={{ border: '1px solid #e0e0e0', borderRadius: 2 }}>
          <CardContent sx={{ p: 0 }}>
            {isLoadingShares ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress />
              </Box>
            ) : !sharesData?.data?.length ? (
              <Box sx={{ textAlign: 'center', py: 6 }}>
                <Typography color="text.secondary">No external share packages created yet.</Typography>
                <Button sx={{ mt: 1.5 }} variant="text" onClick={() => setIsShareModalOpen(true)}>
                  Create a lender share package
                </Button>
              </Box>
            ) : (
              <DataTable<(typeof sharesData.data)[number]>
                dataTestId="docshare.table.shares"
                data={sharesData.data}
                keyExtractor={(share) => share.id}
                columns={[
                  {
                    id: 'id',
                    header: 'Share ID',
                    render: (share) => <Box sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{share.id}</Box>,
                  },
                  { id: 'application', header: 'Application ID', render: (share) => <ApplicationName id={share.applicationId} linkToApp /> },
                  {
                    id: 'recipient',
                    header: 'Recipient',
                    render: (share) => (
                      <>
                        <Typography variant="body2" fontWeight={600}>
                          {share.recipientContact.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {share.recipientContact.email}
                        </Typography>
                      </>
                    ),
                  },
                  { id: 'purpose', header: 'Purpose', render: (share) => <Chip label={share.purpose} size="small" variant="outlined" /> },
                  {
                    id: 'consent',
                    header: 'Consent Verified',
                    render: (share) => <Chip label={`${share.consentIds.length} Active`} color="info" size="small" />,
                  },
                  { id: 'expires', header: 'Expires At', render: (share) => new Date(share.expiresAt).toLocaleDateString() },
                  {
                    id: 'status',
                    header: 'Status',
                    render: (share) => {
                      const isExpired = new Date(share.expiresAt) < new Date();
                      if (share.revokedAt) return <Chip label="REVOKED" color="error" size="small" />;
                      if (isExpired) return <Chip label="EXPIRED" color="default" size="small" />;
                      return <Chip label="ACTIVE" color="success" size="small" />;
                    },
                  },
                  {
                    id: 'actions',
                    header: 'Actions',
                    align: 'right',
                    render: (share) => {
                      const isExpired = new Date(share.expiresAt) < new Date();
                      const isRevoked = Boolean(share.revokedAt);
                      return !isRevoked && !isExpired ? (
                        <Can action="share.create">
                          <Button size="small" color="error" onClick={() => revokeShareMutation.mutate(share.id)}>
                            Revoke
                          </Button>
                        </Can>
                      ) : null;
                    },
                  },
                ]}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Modal: Generate Upload Link */}
      <Dialog open={isLinkModalOpen} onClose={() => setIsLinkModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Generate Customer Upload Link (SUB-DSH.01)</DialogTitle>
        <DialogContent dividers>
          {createdLinkResult ? (
            <Stack spacing={2.5}>
              <Alert severity="success">
                Customer upload link generated successfully! Share this link with the applicant.
              </Alert>
              <Box sx={{ p: 2, bgcolor: '#f5f5f5', borderRadius: 1.5 }}>
                <Typography variant="caption" color="text.secondary">
                  Public Upload URL
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                  <Typography
                    variant="body2"
                    sx={{ fontFamily: 'monospace', wordBreak: 'break-all', flexGrow: 1 }}
                  >
                    {window.location.origin}
                    {createdLinkResult.uploadUrl}
                  </Typography>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => copyToClipboard(`${window.location.origin}${createdLinkResult.uploadUrl}`)}
                  >
                    Copy
                  </Button>
                </Stack>
              </Box>

              {createdLinkResult.generatedOtp && (
                <Box sx={{ p: 2, bgcolor: '#e8f4fd', borderRadius: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    Demonstration OTP (Simulated via MOD-MSG)
                  </Typography>
                  <Typography variant="h5" fontWeight={700} sx={{ letterSpacing: 2, mt: 0.5 }}>
                    {createdLinkResult.generatedOtp}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    (Use this 6-digit code on the public verification screen)
                  </Typography>
                </Box>
              )}
            </Stack>
          ) : (
            <Box component="form" onSubmit={handleCreateLink}>
              <Stack spacing={2.5}>
                <ApplicationSelect
                  required
                  value={linkAppId}
                  onChange={(id) => {
                    setLinkAppId(id);
                    setLinkItems([]);
                  }}
                  testId="sharing.link.application"
                />

                <Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mb: 1, fontWeight: 600 }}
                  >
                    Documents to request (click to select):
                  </Typography>
                  {!linkAppId ? (
                    <Typography variant="body2" color="text.secondary">
                      Choose an application first.
                    </Typography>
                  ) : checklist.isLoading ? (
                    <CircularProgress size={20} />
                  ) : uploadable.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      {checklist.isError
                        ? errorText(checklist.error)
                        : "Nothing is outstanding on this application's checklist."}
                    </Typography>
                  ) : (
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      {uploadable.map((item) => {
                        const selected = linkItems.includes(item.id);
                        return (
                          <Chip
                            key={item.id}
                            label={`${readable(item.documentTypeCode)}${item.mandatory ? '' : ' (optional)'}`}
                            size="small"
                            color={selected ? 'primary' : 'default'}
                            variant={selected ? 'filled' : 'outlined'}
                            onClick={() => toggleChecklistItem(item.id)}
                            clickable
                            data-testid="sharing.link.item"
                          />
                        );
                      })}
                    </Stack>
                  )}
                </Box>

                <Stack direction="row" spacing={2}>
                  <FormControl fullWidth>
                    <InputLabel>Expires In</InputLabel>
                    <Select
                      value={linkHours}
                      label="Expires In"
                      onChange={(e) => setLinkHours(Number(e.target.value))}
                    >
                      <MenuItem value={24}>24 Hours</MenuItem>
                      <MenuItem value={48}>48 Hours (2 Days)</MenuItem>
                      <MenuItem value={72}>72 Hours (3 Days)</MenuItem>
                      <MenuItem value={168}>7 Days</MenuItem>
                    </Select>
                  </FormControl>

                  <TextField
                    label="Max Uploads"
                    type="number"
                    fullWidth
                    value={linkMaxUses}
                    onChange={(e) => setLinkMaxUses(Number(e.target.value))}
                  />
                </Stack>

                <FormControlLabel
                  control={
                    <Switch
                      checked={linkOtpRequired}
                      onChange={(e) => setLinkOtpRequired(e.target.checked)}
                    />
                  }
                  label="Mandatory 6-digit OTP Verification before document upload"
                />
              </Stack>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsLinkModalOpen(false)}>Close</Button>
          {!createdLinkResult && (
            <Button variant="contained" onClick={handleCreateLink} disabled={createLinkMutation.isPending}>
              {createLinkMutation.isPending ? 'Generating...' : 'Generate Link'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Modal: Create Share Package */}
      <Dialog open={isShareModalOpen} onClose={() => setIsShareModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Case Share Package (SUB-DSH.02)</DialogTitle>
        <DialogContent dividers>
          <Box component="form" onSubmit={handleCreateShare}>
            <Stack spacing={2.5}>
              <Alert severity="info">
                Case sharing enforces verified active customer consent. An ENT-100 data sharing inventory
                record will be created atomically.
              </Alert>

              <ApplicationSelect
                required
                value={shareAppId}
                onChange={setShareAppId}
                testId="sharing.share.application"
              />

              <Stack direction="row" spacing={2}>
                <FormControl fullWidth>
                  <InputLabel>Recipient Type</InputLabel>
                  <Select
                    value={shareRecipientType}
                    label="Recipient Type"
                    onChange={(e) => {
                      setShareRecipientType(e.target.value);
                      setShareRecipientId('');
                    }}
                  >
                    <MenuItem value="LENDER">Lender</MenuItem>
                    <MenuItem value="CO_LENDER">Co-Lender</MenuItem>
                    <MenuItem value="PARTNER">Partner</MenuItem>
                    <MenuItem value="AUDITOR">Auditor</MenuItem>
                  </Select>
                </FormControl>

                {shareRecipientType === 'LENDER' || shareRecipientType === 'CO_LENDER' ? (
                  <TextField
                    select
                    label="Lender"
                    fullWidth
                    required
                    value={shareRecipientId}
                    onChange={(e) => setShareRecipientId(e.target.value)}
                    disabled={lenders.isPending}
                    helperText={lenders.isError ? errorText(lenders.error) : undefined}
                  >
                    {(lenders.data ?? []).map((l) => (
                      <MenuItem key={l.id} value={l.id}>
                        {l.name}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : shareRecipientType === 'PARTNER' ? (
                  <ConnectorSelect
                    label="Sourcing Partner / Connector"
                    placeholder="Select partner or enter ID..."
                    value={shareRecipientId || null}
                    onChange={(id) => setShareRecipientId(id ?? '')}
                    required
                  />
                ) : (
                  <TextField
                    label="Recipient ID"
                    fullWidth
                    required
                    value={shareRecipientId}
                    onChange={(e) => setShareRecipientId(e.target.value)}
                  />
                )}
              </Stack>

              <Stack direction="row" spacing={2}>
                <TextField
                  label="Contact Name"
                  fullWidth
                  required
                  value={shareRecipientName}
                  onChange={(e) => setShareRecipientName(e.target.value)}
                />
                <TextField
                  label="Contact Email"
                  type="email"
                  fullWidth
                  required
                  placeholder="name@example.com"
                  value={shareRecipientEmail}
                  onChange={(e) => setShareRecipientEmail(e.target.value)}
                />
              </Stack>

              <Stack direction="row" spacing={2}>
                <FormControl fullWidth>
                  <InputLabel>Purpose</InputLabel>
                  <Select
                    value={sharePurpose}
                    label="Purpose"
                    onChange={(e) => setSharePurpose(e.target.value)}
                  >
                    <MenuItem value="LENDER_SUBMISSION">Lender Submission</MenuItem>
                    <MenuItem value="PORTFOLIO_REVIEW">Portfolio Review</MenuItem>
                    <MenuItem value="AUDIT_INSPECTION">Audit Inspection</MenuItem>
                  </Select>
                </FormControl>

                <TextField
                  label="Validity (Days)"
                  type="number"
                  fullWidth
                  value={shareDays}
                  onChange={(e) => setShareDays(Number(e.target.value))}
                />
              </Stack>
            </Stack>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsShareModalOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateShare} disabled={createShareMutation.isPending}>
            {createShareMutation.isPending ? 'Verifying Consent & Creating...' : 'Create Share Package'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
