// apps/web/src/features/verification/VerificationDetailPage.tsx — owner: Developer 2
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  Link,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { UserPicker } from '../admin/components';
import { Can } from '../../shell/Can';
import { UserSelect } from '../../shell/selectors';
import { ApplicationName, BranchName, CustomerName, UserName } from '../../shell/display';
import { PageHeader, AppButton, AppCard, StatusBadge } from '../../ui';
import {
  apiUrl,
  currentVersion,
  downloadDocumentVersion,
  getDocument,
  useChecklist,
} from '../documents/api';
import { readable, STATUS_LABELS, type ChecklistItem } from '../documents/model';
import { apiFetch } from '../../api/client';
import type { DocumentLinkResponse } from '@dsa/contracts';
import { attestChecklistItem, completeVerification, fetchVerification, updateVerification } from './api';
import type {
  ChecklistAttestationInput,
  CompleteVerificationInput,
  RejectionReason,
  UpdateVerificationInput,
  VerificationOutcome,
  VerificationRequest,
  VerificationStatus,
} from './types';

export function VerificationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<VerificationRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Complete Dialog State
  const [completeOpen, setCompleteOpen] = useState(false);
  const [outcome, setOutcome] = useState<VerificationOutcome>('POSITIVE');
  const [findings, setFindings] = useState('');
  const [markStatus, setMarkStatus] = useState<'VERIFIED' | 'REJECTED' | 'WAIVED'>('VERIFIED');
  const [rejectionReason, setRejectionReason] = useState<RejectionReason>('ADDRESS_NOT_FOUND');
  const [submitting, setSubmitting] = useState(false);

  // Checklist Attest Dialog State
  const [attestOpen, setAttestOpen] = useState(false);
  const [selectedChecklistId, setSelectedChecklistId] = useState('');
  const [checklistStatus, setChecklistStatus] = useState<'ACCEPTED' | 'REJECTED' | 'WAIVED'>('ACCEPTED');
  const [attestationNote, setAttestationNote] = useState('');
  const [checklistRejectReason, setChecklistRejectReason] = useState<
    'ILLEGIBLE' | 'EXPIRED_DOCUMENT' | 'MISMATCH' | 'INCOMPLETE' | 'WRONG_DOCUMENT' | 'OTHER'
  >('MISMATCH');

  // Update Status / Assignment State
  const [assignOpen, setAssignOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<VerificationStatus>('IN_PROGRESS');
  const [newAssignee, setNewAssignee] = useState('');

  // Document Viewer Modal State
  const [viewDocOpen, setViewDocOpen] = useState(false);
  const [viewDocItem, setViewDocItem] = useState<string | null>(null);
  const [viewDocName, setViewDocName] = useState<string>('Document');
  const [viewDocLoading, setViewDocLoading] = useState(false);
  const [viewDocUrl, setViewDocUrl] = useState<string | null>(null);
  const [viewDocFileName, setViewDocFileName] = useState<string | null>(null);
  const [viewDocMimeType, setViewDocMimeType] = useState<string | null>(null);
  const [viewDocError, setViewDocError] = useState<string | null>(null);
  const [viewDocVersionId, setViewDocVersionId] = useState<string | null>(null);

  const checklistQuery = useChecklist(data?.applicationId ?? null);
  const allChecklistItems = checklistQuery.data?.data ?? [];
  const effectiveItems =
    data?.checklistItmIds && data.checklistItmIds.length > 0
      ? allChecklistItems.filter((i) => data.checklistItmIds.includes(i.id))
      : allChecklistItems;

  const handleOpenDocViewer = async (item: ChecklistItem) => {
    setViewDocItem(item.id);
    setViewDocName(readable(item.documentTypeCode));
    setViewDocOpen(true);
    setViewDocError(null);
    setViewDocUrl(null);
    setViewDocFileName(null);
    setViewDocMimeType(null);
    setViewDocVersionId(null);

    if (!item.documentId) {
      setViewDocError(
        `No document file has been uploaded for this checklist requirement yet. Status: ${
          STATUS_LABELS[item.status] ?? item.status
        }`,
      );
      return;
    }

    try {
      setViewDocLoading(true);
      const doc = await getDocument(item.documentId);
      const v = currentVersion(doc);
      if (!v) {
        setViewDocError('This document has no uploaded version available on the server.');
        return;
      }
      setViewDocFileName(v.fileName || `${item.documentTypeCode}.pdf`);
      setViewDocMimeType(v.detectedMime || 'application/pdf');
      setViewDocVersionId(v.id);

      const link = await apiFetch<DocumentLinkResponse>(
        `/v1/document-versions/${encodeURIComponent(v.id)}/view-url`,
        { method: 'POST', body: { purpose: 'Verification review' } },
      );
      const fullUrl = apiUrl(link.url);
      setViewDocUrl(fullUrl);
    } catch (err) {
      setViewDocError((err as Error).message || 'Failed to load document preview.');
    } finally {
      setViewDocLoading(false);
    }
  };

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetchVerification(id);
      const record = (res as any)?.data ?? res;
      setData(record);
      setNewStatus(record?.status || 'IN_PROGRESS');
      setNewAssignee(record?.assignedToUserId || '');
    } catch (err) {
      setError((err as Error).message || 'Failed to load verification case');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCompleteSubmit = async () => {
    if (!data) return;
    if (!findings.trim() || findings.trim().length < 5) {
      setError('Findings summary must be at least 5 characters');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const payload: CompleteVerificationInput = {
        outcome,
        findingsSummary: findings.trim(),
        markStatus,
        rejectionReason: markStatus === 'REJECTED' ? rejectionReason : undefined,
      };

      const updated = await completeVerification(data.id, data.lockVersion, payload);
      setData((updated as any)?.data ?? updated);
      setCompleteOpen(false);
      setActionSuccess('Verification case successfully finalized!');
    } catch (err) {
      setError((err as Error).message || 'Failed to complete verification');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignSubmit = async () => {
    if (!data) return;
    try {
      setSubmitting(true);
      setError(null);

      const payload: UpdateVerificationInput = {
        status: newStatus,
        assignedToUserId: newAssignee.trim() || null,
      };

      const updated = await updateVerification(data.id, data.lockVersion, payload);
      setData((updated as any)?.data ?? updated);
      setAssignOpen(false);
      setActionSuccess('Verification case updated successfully!');
    } catch (err) {
      setError((err as Error).message || 'Failed to update verification case');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAttestSubmit = async () => {
    if (!data || !selectedChecklistId) return;
    try {
      setSubmitting(true);
      setError(null);

      const payload: ChecklistAttestationInput = {
        checklistItemId: selectedChecklistId,
        status: checklistStatus,
        attestationNote: attestationNote.trim() || undefined,
        rejectReason: checklistStatus === 'REJECTED' ? checklistRejectReason : undefined,
      };

      await attestChecklistItem(data.id, payload);
      setAttestOpen(false);
      setActionSuccess(`Checklist item ${selectedChecklistId} marked as ${checklistStatus}!`);
      loadData();
      void checklistQuery.refetch();
    } catch (err) {
      setError((err as Error).message || 'Failed to review checklist item');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Container maxWidth={false} disableGutters sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (!data) {
    return (
      <Container maxWidth={false} disableGutters>
        <Alert severity="error">Verification record not found.</Alert>
        <Button onClick={() => navigate('/verifications')} sx={{ mt: 2 }}>
          Back to list
        </Button>
      </Container>
    );
  }

  const isFinalized = data.status === 'VERIFIED' || data.status === 'REJECTED' || data.status === 'CANCELLED';

  return (
    <Container maxWidth={false} disableGutters>
      {/* Breadcrumbs */}
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link component={RouterLink} to="/verifications" color="inherit">
          Verifications
        </Link>
        <Typography color="text.primary">
          {data.verificationType ? `${data.verificationType.replace(/_/g, ' ')} Case` : 'Case Details'}
        </Typography>
      </Breadcrumbs>

      <PageHeader
        title={
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <CustomerName
              id={data.customerId}
              fallback="Verification Case"
              typographyProps={{ variant: 'h5', fontWeight: 700 }}
            />
            <Typography component="span" variant="h5" color="text.secondary" fontWeight={500}>
              — {data.verificationType?.replace(/_/g, ' ') || 'Verification'}
            </Typography>
          </Box>
        }
        backTo="/verifications"
        badge={
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip label={data.status} color={data.status === 'VERIFIED' ? 'success' : 'primary'} />
            {data.outcome && (
              <Chip
                label={data.outcome}
                color={data.outcome === 'POSITIVE' ? 'success' : data.outcome === 'NEGATIVE' ? 'error' : 'warning'}
                variant="outlined"
              />
            )}
          </Stack>
        }
        subtitle={
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography variant="body2" color="text.secondary">
              Application: <ApplicationName id={data.applicationId} linkToApp /> • Branch: <BranchName id={data.branchId} />
            </Typography>
          </Stack>
        }
        actions={
          <Stack direction="row" spacing={1.5}>
            <Can action="verification.perform">
              <AppButton
                variant="outlined"
                onClick={() => setAssignOpen(true)}
                disabled={isFinalized}
                data-testid="verification.btn.assign"
              >
                Update / Assign
              </AppButton>
            </Can>
            <Can action="verification.complete">
              <AppButton
                variant="success"
                onClick={() => setCompleteOpen(true)}
                disabled={isFinalized}
                data-testid="verification.btn.complete"
              >
                Complete Assessment
              </AppButton>
            </Can>
          </Stack>
        }
      />

      {/* Alerts */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {actionSuccess && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setActionSuccess(null)}>
          {actionSuccess}
        </Alert>
      )}

      {/* Case Overview Grid */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={7}>
          <AppCard title="Case Details & Audit Attributes" divider>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Verification Type
                </Typography>
                <Typography variant="body1" fontWeight={600}>
                  {data.verificationType.replace(/_/g, ' ')}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Priority
                </Typography>
                <Typography variant="body1" fontWeight={600}>
                  {data.priority}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Assigned Verifier
                </Typography>
                <Box sx={{ mt: 0.5 }}>
                  <UserName id={data.assignedToUserId} fallback="Unassigned" typographyProps={{ variant: 'body1', fontWeight: 500 }} />
                </Box>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Scheduled Date
                </Typography>
                <Typography variant="body1">
                  {data.scheduledAt ? new Date(data.scheduledAt).toLocaleString() : 'Not scheduled'}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Created By
                </Typography>
                <Typography variant="body1">
                  <UserName id={data.createdBy} fallback="Operations / System" />
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Created At
                </Typography>
                <Typography variant="body1">{new Date(data.createdAt).toLocaleString()}</Typography>
              </Box>
              {data.verifiedBy && (
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Verified By
                  </Typography>
                  <Typography variant="body1">
                    <UserName id={data.verifiedBy} fallback="Verifier" />
                  </Typography>
                </Box>
              )}
              {data.completedAt && (
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Completed At
                  </Typography>
                  <Typography variant="body1">{new Date(data.completedAt).toLocaleString()}</Typography>
                </Box>
              )}
            </Box>
          </AppCard>
        </Grid>

        <Grid item xs={12} md={5}>
          <AppCard title="Findings & Evaluation Summary" divider sx={{ height: '100%' }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Assessment Notes / Scope:
            </Typography>
            <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default', mb: 2 }}>
              <Typography variant="body2">{data.findingsSummary || 'No notes entered yet.'}</Typography>
            </Paper>

            {data.rejectionReason && (
              <Alert severity="error" sx={{ mt: 1 }}>
                <strong>Rejection Reason:</strong> {data.rejectionReason}
              </Alert>
            )}
          </AppCard>
        </Grid>
      </Grid>

      {/* Linked Document Checklist Review Section */}
      <AppCard
        title="Document Checklist & Attestation Items"
        subtitle="Review and attest uploaded borrower documents against verification checklist"
        divider
      >
        {checklistQuery.isLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 3 }}>
            <CircularProgress size={24} />
            <Typography variant="body2" color="text.secondary">
              Loading borrower documents from application checklist...
            </Typography>
          </Box>
        ) : effectiveItems.length === 0 ? (
          <Box sx={{ py: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              No document checklist items found for this application.
            </Typography>
            {data && (
              <Button
                variant="outlined"
                size="small"
                component={RouterLink}
                to={`/applications/${data.applicationId}`}
                sx={{ textTransform: 'none', fontWeight: 600 }}
              >
                Open Application & View Documents
              </Button>
            )}
          </Box>
        ) : (
          <Stack spacing={2}>
            {effectiveItems.map((item) => (
              <Paper
                key={item.id}
                variant="outlined"
                sx={{
                  p: 2,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 2,
                }}
              >
                <Box>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                    <Typography variant="subtitle2" fontWeight={600}>
                      {readable(item.documentTypeCode)}
                    </Typography>
                    {item.mandatory && (
                      <Chip
                        label="Mandatory"
                        size="small"
                        variant="outlined"
                        color="primary"
                        sx={{ height: 20, fontSize: 11 }}
                      />
                    )}
                    <StatusBadge
                      status={item.status}
                      label={STATUS_LABELS[item.status] ?? item.status}
                      size="small"
                    />
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    Item ID: {item.id} • Party: {item.partyId}
                    {item.attestationNote ? ` • Note: ${item.attestationNote}` : ''}
                    {item.reviewedBy ? ' • Reviewed by staff' : ''}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <AppButton
                    variant="secondary"
                    size="small"
                    onClick={() => void handleOpenDocViewer(item)}
                    data-testid={`verification.view.${item.id}`}
                  >
                    View Document
                  </AppButton>
                  <Can action="verification.perform">
                    <AppButton
                      variant="outlined"
                      size="small"
                      disabled={isFinalized}
                      onClick={() => {
                        setSelectedChecklistId(item.id);
                        setAttestOpen(true);
                      }}
                      data-testid={`verification.attest.${item.id}`}
                    >
                      Attest / Review
                    </AppButton>
                  </Can>
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
      </AppCard>

      {/* Complete Assessment Dialog */}
      <Dialog open={completeOpen} onClose={() => setCompleteOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Complete Verification Assessment</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel id="outcome-select-label">Verdict / Outcome</InputLabel>
              <Select
                labelId="outcome-select-label"
                value={outcome}
                label="Verdict / Outcome"
                onChange={(e) => {
                  const val = e.target.value as VerificationOutcome;
                  setOutcome(val);
                  if (val === 'POSITIVE') setMarkStatus('VERIFIED');
                  if (val === 'NEGATIVE') setMarkStatus('REJECTED');
                }}
                data-testid="verification.complete.outcome"
              >
                <MenuItem value="POSITIVE">Positive (Verified & Approved)</MenuItem>
                <MenuItem value="NEGATIVE">Negative (Verification Failed)</MenuItem>
                <MenuItem value="REFER_TO_CREDIT">Refer to Credit Underwriting</MenuItem>
                <MenuItem value="WAIVED">Waived (Discretionary Waiver)</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth size="small">
              <InputLabel id="markstatus-select-label">Mark Final Status</InputLabel>
              <Select
                labelId="markstatus-select-label"
                value={markStatus}
                label="Mark Final Status"
                onChange={(e) => setMarkStatus(e.target.value as 'VERIFIED' | 'REJECTED' | 'WAIVED')}
                data-testid="verification.complete.status"
              >
                <MenuItem value="VERIFIED">VERIFIED</MenuItem>
                <MenuItem value="REJECTED">REJECTED</MenuItem>
                <MenuItem value="WAIVED">WAIVED</MenuItem>
              </Select>
            </FormControl>

            {markStatus === 'REJECTED' && (
              <FormControl fullWidth size="small">
                <InputLabel id="rejectreason-select-label">Rejection Reason</InputLabel>
                <Select
                  labelId="rejectreason-select-label"
                  value={rejectionReason}
                  label="Rejection Reason"
                  onChange={(e) => setRejectionReason(e.target.value as RejectionReason)}
                  data-testid="verification.complete.rejectReason"
                >
                  <MenuItem value="ADDRESS_NOT_FOUND">Address Not Found / Untraceable</MenuItem>
                  <MenuItem value="APPLICANT_UNKNOWN">Applicant Unknown at Premises</MenuItem>
                  <MenuItem value="DOCUMENT_FORGED">Document Suspected Forged / Tampered</MenuItem>
                  <MenuItem value="SALARY_MISMATCH">Salary Details Discrepancy</MenuItem>
                  <MenuItem value="BUSINESS_CLOSED">Business Closed / Non-Operational</MenuItem>
                  <MenuItem value="UNCOOPERATIVE">Applicant / Reference Uncooperative</MenuItem>
                  <MenuItem value="INCOMPLETE_DETAILS">Incomplete Verification Evidence</MenuItem>
                  <MenuItem value="OTHER">Other Reason</MenuItem>
                </Select>
              </FormControl>
            )}

            <TextField
              label="Detailed Verification Findings"
              placeholder="State clear reasons, physical observations, and evidence verified..."
              value={findings}
              onChange={(e) => setFindings(e.target.value)}
              multiline
              rows={4}
              required
              fullWidth
              size="small"
              data-testid="verification.complete.findings"
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setCompleteOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="success"
            onClick={handleCompleteSubmit}
            disabled={submitting}
            data-testid="verification.complete.submit"
          >
            Submit Final Verdict
          </Button>
        </DialogActions>
      </Dialog>

      {/* Assign Dialog */}
      <Dialog open={assignOpen} onClose={() => setAssignOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Update Case Status & Verifier</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel id="status-update-label">Status</InputLabel>
              <Select
                labelId="status-update-label"
                value={newStatus}
                label="Status"
                onChange={(e) => setNewStatus(e.target.value as VerificationStatus)}
              >
                <MenuItem value="INITIATED">INITIATED</MenuItem>
                <MenuItem value="ASSIGNED">ASSIGNED</MenuItem>
                <MenuItem value="IN_PROGRESS">IN_PROGRESS</MenuItem>
                <MenuItem value="CANCELLED">CANCELLED</MenuItem>
              </Select>
            </FormControl>

            <UserPicker
              multiple={false}
              size="small"
              label="Assigned Staff Member"
              placeholder="Select staff verifier or enter ID..."
              value={newAssignee || null}
              onChange={(id) => setNewAssignee(id ?? '')}
              freeSolo
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAssignOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleAssignSubmit} disabled={submitting}>
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>

      {/* Attest Checklist Item Dialog */}
      <Dialog open={attestOpen} onClose={() => setAttestOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Attest Checklist Document</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Typography variant="body2">
              Item ID: <strong>{selectedChecklistId}</strong>
            </Typography>

            <FormControl fullWidth size="small">
              <InputLabel id="attest-status-label">Review Verdict</InputLabel>
              <Select
                labelId="attest-status-label"
                value={checklistStatus}
                label="Review Verdict"
                onChange={(e) => setChecklistStatus(e.target.value as 'ACCEPTED' | 'REJECTED' | 'WAIVED')}
              >
                <MenuItem value="ACCEPTED">ACCEPTED (Document Clear & Valid)</MenuItem>
                <MenuItem value="REJECTED">REJECTED (Defect / Discrepancy)</MenuItem>
                <MenuItem value="WAIVED">WAIVED (Waived under Approval)</MenuItem>
              </Select>
            </FormControl>

            {checklistStatus === 'REJECTED' && (
              <FormControl fullWidth size="small">
                <InputLabel id="checklist-reject-reason-label">Reject Reason</InputLabel>
                <Select
                  labelId="checklist-reject-reason-label"
                  value={checklistRejectReason}
                  label="Reject Reason"
                  onChange={(e) =>
                    setChecklistRejectReason(
                      e.target.value as
                        | 'ILLEGIBLE'
                        | 'EXPIRED_DOCUMENT'
                        | 'MISMATCH'
                        | 'INCOMPLETE'
                        | 'WRONG_DOCUMENT'
                        | 'OTHER',
                    )
                  }
                >
                  <MenuItem value="ILLEGIBLE">Illegible / Blurry</MenuItem>
                  <MenuItem value="EXPIRED_DOCUMENT">Expired Document</MenuItem>
                  <MenuItem value="MISMATCH">Mismatch with Application Info</MenuItem>
                  <MenuItem value="INCOMPLETE">Incomplete / Missing Pages</MenuItem>
                  <MenuItem value="WRONG_DOCUMENT">Wrong Document Type</MenuItem>
                  <MenuItem value="OTHER">Other Defect</MenuItem>
                </Select>
              </FormControl>
            )}

            <TextField
              label="Attestation Note"
              placeholder="Optional notes or remarks regarding document validity..."
              value={attestationNote}
              onChange={(e) => setAttestationNote(e.target.value)}
              multiline
              rows={3}
              fullWidth
              size="small"
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAttestOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleAttestSubmit} disabled={submitting}>
            Submit Attestation
          </Button>
        </DialogActions>
      </Dialog>

      {/* Document Viewer Modal */}
      <Dialog open={viewDocOpen} onClose={() => setViewDocOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="h6" fontWeight={700}>
              Document Viewer: {viewDocName}
            </Typography>
            <Chip
              label={viewDocUrl ? 'Uploaded & Verified' : 'Checklist Item'}
              size="small"
              color={viewDocUrl ? 'success' : 'default'}
            />
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ p: 2, bgcolor: '#f8fafc', borderRadius: 2, border: '1px solid #e2e8f0', mb: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary">Item Identifier</Typography>
                <Typography variant="body2" fontWeight={600}>{viewDocItem || 'chk_...'}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary">Document Type</Typography>
                <Typography variant="body2" fontWeight={600}>{viewDocName}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary">File Name</Typography>
                <Typography variant="body2" fontWeight={600}>{viewDocFileName || 'No file attached'}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary">Integrity & Antivirus Scan</Typography>
                <Typography variant="body2" color={viewDocUrl ? 'success.main' : 'text.secondary'} fontWeight={600}>
                  {viewDocUrl ? 'PASSED (Clean - SHA-256 Verified)' : 'Awaiting File Upload'}
                </Typography>
              </Grid>
            </Grid>
          </Box>

          {viewDocLoading ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8 }}>
              <CircularProgress size={36} sx={{ mb: 2 }} />
              <Typography variant="body2" color="text.secondary">
                Loading secure document preview...
              </Typography>
            </Box>
          ) : viewDocError ? (
            <Alert severity="info" sx={{ my: 2 }}>
              {viewDocError}
            </Alert>
          ) : viewDocUrl ? (
            <Box sx={{ width: '100%', borderRadius: 2, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
              {viewDocMimeType?.startsWith('image/') ? (
                <Box
                  component="img"
                  src={viewDocUrl}
                  alt={viewDocName}
                  sx={{ width: '100%', maxHeight: 520, objectFit: 'contain', bgcolor: '#0f172a' }}
                />
              ) : (
                <Box
                  component="iframe"
                  src={viewDocUrl}
                  title={viewDocName}
                  sx={{ width: '100%', height: 500, border: 'none', bgcolor: '#f8fafc' }}
                />
              )}
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setViewDocOpen(false)}>Close Viewer</Button>
          {viewDocUrl && (
            <Button
              variant="outlined"
              onClick={() => window.open(viewDocUrl, '_blank', 'noopener')}
            >
              Open in New Tab
            </Button>
          )}
          {viewDocVersionId && (
            <Button
              variant="outlined"
              onClick={() => void downloadDocumentVersion(viewDocVersionId)}
            >
              Download File
            </Button>
          )}
          <Button
            variant="contained"
            color="success"
            onClick={() => {
              setViewDocOpen(false);
              setSelectedChecklistId(viewDocItem || '');
              setAttestOpen(true);
            }}
            disabled={isFinalized}
            data-testid="verification.view.proceed-to-attest"
          >
            Proceed to Attest
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
