// apps/web/src/features/document-sharing/DocumentSharingPage.tsx
// Module 25: Document Sharing Dashboard (MOD-DSH)
import React, { useState } from 'react';
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, errorText } from '../../api/client';
import type {
  ExternalShareRecord,
  UploadLinkRecord,
} from '@dsa/contracts';

const APPROVED_CHECKLIST_REQUIREMENTS = [
  { id: 'chk_pan_card', label: 'PAN Card (Identity Proof)' },
  { id: 'chk_bank_statement', label: 'Bank Statement (6 Months)' },
  { id: 'chk_salary_slip', label: 'Salary Slips (3 Months)' },
  { id: 'chk_address_proof', label: 'Address / Aadhaar Proof' },
  { id: 'chk_itr_filing', label: 'ITR / Form 16' },
  { id: 'chk_business_proof', label: 'Business Registration' },
];

export function DocumentSharingPage() {
  const queryClient = useQueryClient();
  const [tabIndex, setTabIndex] = useState(0);

  // Modals
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);

  // Link Form State - prefill with seeded live application ID for frictionless testing
  const [linkAppId, setLinkAppId] = useState('app_01ARZ3NDEKTSV4RRFFQ69G5FAV');
  const [linkItems, setLinkItems] = useState('chk_bank_statement, chk_salary_slip, chk_pan_card');
  const [linkHours, setLinkHours] = useState(48);
  const [linkMaxUses, setLinkMaxUses] = useState(5);
  const [linkOtpRequired, setLinkOtpRequired] = useState(true);
  const [createdLinkResult, setCreatedLinkResult] = useState<any | null>(null);

  const toggleChecklistItem = (itemId: string) => {
    const current = linkItems.split(',').map((s) => s.trim()).filter(Boolean);
    if (current.includes(itemId)) {
      setLinkItems(current.filter((id) => id !== itemId).join(', '));
    } else {
      setLinkItems([...current, itemId].join(', '));
    }
  };

  // Share Form State
  const [shareAppId, setShareAppId] = useState('app_01ARZ3NDEKTSV4RRFFQ69G5FAV');
  const [shareRecipientType, setShareRecipientType] = useState('LENDER');
  const [shareRecipientId, setShareRecipientId] = useState('len_hdfc_bank');
  const [shareRecipientName, setShareRecipientName] = useState('Pooja Sharma');
  const [shareRecipientEmail, setShareRecipientEmail] = useState('credit.ops@hdfcbank.com');
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
        idempotencyKey: `idem_upl_${Date.now()}`,
        body: payload,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['upload-links'] });
      setCreatedLinkResult(data);
      setFeedback({ message: 'Upload link generated successfully!', severity: 'success' });
    },
    onError: (err: any) => {
      setFeedback({ message: errorText(err), severity: 'error' });
    },
  });

  const revokeLinkMutation = useMutation({
    meta: { successMessage: 'Upload link revoked.' },
    mutationFn: (id: string) =>
      apiFetch(`/v1/upload-links/${id}/revocation`, { method: 'POST' }),
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
        idempotencyKey: `idem_shr_${Date.now()}`,
        body: payload,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shares'] });
      setIsShareModalOpen(false);
      setFeedback({ message: 'Case share package created and logged in ENT-100 inventory.', severity: 'success' });
    },
    onError: (err: any) => {
      setFeedback({ message: errorText(err), severity: 'error' });
    },
  });

  const revokeShareMutation = useMutation({
    meta: { successMessage: 'Share revoked.' },
    mutationFn: (id: string) =>
      apiFetch(`/v1/shares/${id}/revocation`, { method: 'POST' }),
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
    const items = linkItems.split(',').map((s) => s.trim()).filter(Boolean);
    createLinkMutation.mutate({
      applicationId: linkAppId.trim(),
      checklistItemIds: items,
      expiresInHours: linkHours,
      maxUses: linkMaxUses,
      otpRequired: linkOtpRequired,
    });
  };

  const handleCreateShare = (e: React.FormEvent) => {
    e.preventDefault();
    createShareMutation.mutate({
      applicationId: shareAppId.trim(),
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
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems="flex-start" spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Document Sharing
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Module 25 (MOD-DSH): Customer Upload Links & Case Share Packages
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5}>
          <Button variant="outlined" onClick={() => setIsShareModalOpen(true)}>
            + Create Share Package
          </Button>
          <Button variant="contained" onClick={() => { setCreatedLinkResult(null); setIsLinkModalOpen(true); }}>
            + Generate Upload Link
          </Button>
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
              <TableContainer component={Paper} elevation={0}>
                <Table>
                  <TableHead sx={{ bgcolor: '#fafafa' }}>
                    <TableRow>
                      <TableCell><strong>Link ID</strong></TableCell>
                      <TableCell><strong>Application ID</strong></TableCell>
                      <TableCell><strong>Items Requested</strong></TableCell>
                      <TableCell><strong>Uses / Max</strong></TableCell>
                      <TableCell><strong>Expires At</strong></TableCell>
                      <TableCell><strong>Status</strong></TableCell>
                      <TableCell align="right"><strong>Actions</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {uploadLinksData.data.map((link) => {
                      const isExpired = new Date(link.expiresAt) < new Date();
                      const isRevoked = Boolean(link.revokedAt);
                      const isLocked = Boolean(link.lockedAt);

                      let statusBadge = <Chip label="ACTIVE" color="success" size="small" />;
                      if (isRevoked) statusBadge = <Chip label="REVOKED" color="error" size="small" />;
                      else if (isLocked) statusBadge = <Chip label="LOCKED" color="error" size="small" />;
                      else if (isExpired) statusBadge = <Chip label="EXPIRED" color="default" size="small" />;

                      return (
                        <TableRow key={link.id} hover>
                          <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{link.id}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{link.applicationId}</TableCell>
                          <TableCell>{link.items.length} items</TableCell>
                          <TableCell>{link.uses} / {link.maxUses}</TableCell>
                          <TableCell>{new Date(link.expiresAt).toLocaleString()}</TableCell>
                          <TableCell>{statusBadge}</TableCell>
                          <TableCell align="right">
                            {!isRevoked && !isExpired && !isLocked && (
                              <Button
                                size="small"
                                color="error"
                                onClick={() => revokeLinkMutation.mutate(link.id)}
                              >
                                Revoke
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
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
              <TableContainer component={Paper} elevation={0}>
                <Table>
                  <TableHead sx={{ bgcolor: '#fafafa' }}>
                    <TableRow>
                      <TableCell><strong>Share ID</strong></TableCell>
                      <TableCell><strong>Application ID</strong></TableCell>
                      <TableCell><strong>Recipient</strong></TableCell>
                      <TableCell><strong>Purpose</strong></TableCell>
                      <TableCell><strong>Consent Verified</strong></TableCell>
                      <TableCell><strong>Expires At</strong></TableCell>
                      <TableCell><strong>Status</strong></TableCell>
                      <TableCell align="right"><strong>Actions</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sharesData.data.map((share) => {
                      const isExpired = new Date(share.expiresAt) < new Date();
                      const isRevoked = Boolean(share.revokedAt);

                      let statusBadge = <Chip label="ACTIVE" color="success" size="small" />;
                      if (isRevoked) statusBadge = <Chip label="REVOKED" color="error" size="small" />;
                      else if (isExpired) statusBadge = <Chip label="EXPIRED" color="default" size="small" />;

                      return (
                        <TableRow key={share.id} hover>
                          <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{share.id}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{share.applicationId}</TableCell>
                          <TableCell>
                            <Typography variant="body2" fontWeight={600}>{share.recipientContact.name}</Typography>
                            <Typography variant="caption" color="text.secondary">{share.recipientContact.email}</Typography>
                          </TableCell>
                          <TableCell><Chip label={share.purpose} size="small" variant="outlined" /></TableCell>
                          <TableCell><Chip label={`${share.consentIds.length} Active`} color="info" size="small" /></TableCell>
                          <TableCell>{new Date(share.expiresAt).toLocaleDateString()}</TableCell>
                          <TableCell>{statusBadge}</TableCell>
                          <TableCell align="right">
                            {!isRevoked && !isExpired && (
                              <Button
                                size="small"
                                color="error"
                                onClick={() => revokeShareMutation.mutate(share.id)}
                              >
                                Revoke
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
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
                <Typography variant="caption" color="text.secondary">Public Upload URL</Typography>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', flexGrow: 1 }}>
                    {window.location.origin}{createdLinkResult.uploadUrl}
                  </Typography>
                  <Button size="small" variant="contained" onClick={() => copyToClipboard(`${window.location.origin}${createdLinkResult.uploadUrl}`)}>
                    Copy
                  </Button>
                </Stack>
              </Box>

              {createdLinkResult.generatedOtp && (
                <Box sx={{ p: 2, bgcolor: '#e8f4fd', borderRadius: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">Demonstration OTP (Simulated via MOD-MSG)</Typography>
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
                <TextField
                  label="Application ID"
                  fullWidth
                  required
                  placeholder="app_01ARZ3NDEKTSV4RRFFQ69G5FAV"
                  value={linkAppId}
                  onChange={(e) => setLinkAppId(e.target.value)}
                  helperText="Prefix: app_ followed by 26-char ULID"
                />

                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontWeight: 600 }}>
                    Approved Document Requirements (Click to select/deselect):
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
                    {APPROVED_CHECKLIST_REQUIREMENTS.map((req) => {
                      const selected = linkItems
                        .split(',')
                        .map((s) => s.trim())
                        .includes(req.id);
                      return (
                        <Chip
                          key={req.id}
                          label={req.label}
                          size="small"
                          color={selected ? 'primary' : 'default'}
                          variant={selected ? 'filled' : 'outlined'}
                          onClick={() => toggleChecklistItem(req.id)}
                          clickable
                        />
                      );
                    })}
                  </Stack>
                  <TextField
                    label="Checklist Item IDs (comma-separated)"
                    fullWidth
                    required
                    value={linkItems}
                    onChange={(e) => setLinkItems(e.target.value)}
                    helperText="Approved requirements or custom checklist IDs for this loan application"
                  />
                </Box>

                <Stack direction="row" spacing={2}>
                  <FormControl fullWidth>
                    <InputLabel>Expires In</InputLabel>
                    <Select value={linkHours} label="Expires In" onChange={(e) => setLinkHours(Number(e.target.value))}>
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
                  control={<Switch checked={linkOtpRequired} onChange={(e) => setLinkOtpRequired(e.target.checked)} />}
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
                Case sharing enforces verified active customer consent. An ENT-100 data sharing inventory record will be created atomically.
              </Alert>

              <TextField
                label="Application ID"
                fullWidth
                required
                placeholder="app_01ARZ3NDEKTSV4RRFFQ69G5FAV"
                value={shareAppId}
                onChange={(e) => setShareAppId(e.target.value)}
              />

              <Stack direction="row" spacing={2}>
                <FormControl fullWidth>
                  <InputLabel>Recipient Type</InputLabel>
                  <Select value={shareRecipientType} label="Recipient Type" onChange={(e) => setShareRecipientType(e.target.value)}>
                    <MenuItem value="LENDER">Lender</MenuItem>
                    <MenuItem value="CO_LENDER">Co-Lender</MenuItem>
                    <MenuItem value="PARTNER">Partner</MenuItem>
                    <MenuItem value="AUDITOR">Auditor</MenuItem>
                  </Select>
                </FormControl>

                <TextField
                  label="Recipient ID"
                  fullWidth
                  required
                  value={shareRecipientId}
                  onChange={(e) => setShareRecipientId(e.target.value)}
                />
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
                  value={shareRecipientEmail}
                  onChange={(e) => setShareRecipientEmail(e.target.value)}
                />
              </Stack>

              <Stack direction="row" spacing={2}>
                <FormControl fullWidth>
                  <InputLabel>Purpose</InputLabel>
                  <Select value={sharePurpose} label="Purpose" onChange={(e) => setSharePurpose(e.target.value)}>
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
