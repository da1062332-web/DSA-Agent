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
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Can } from '../../shell/Can';
import { UserSelect } from '../../shell/selectors';
import { ApplicationName, BranchName, UserName } from '../../shell/display';
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

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetchVerification(id);
      setData(res);
      setNewStatus(res.status);
      setNewAssignee(res.assignedToUserId || '');
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
      setData(updated);
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
      setData(updated);
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
    } catch (err) {
      setError((err as Error).message || 'Failed to review checklist item');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (!data) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">Verification record not found.</Alert>
        <Button onClick={() => navigate('/verifications')} sx={{ mt: 2 }}>
          Back to list
        </Button>
      </Container>
    );
  }

  const isFinalized = data.status === 'VERIFIED' || data.status === 'REJECTED' || data.status === 'CANCELLED';

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Breadcrumbs */}
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link component={RouterLink} to="/verifications" color="inherit">
          Verifications
        </Link>
        <Typography color="text.primary">{data.id}</Typography>
      </Breadcrumbs>

      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Typography variant="h4" fontWeight={700}>
              Case {data.id}
            </Typography>
            <Chip label={data.status} color={data.status === 'VERIFIED' ? 'success' : 'primary'} />
            {data.outcome && (
              <Chip
                label={data.outcome}
                color={
                  data.outcome === 'POSITIVE' ? 'success' : data.outcome === 'NEGATIVE' ? 'error' : 'warning'
                }
                variant="outlined"
              />
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Application: <ApplicationName id={data.applicationId} linkToApp /> • Branch: <BranchName id={data.branchId} /> • Type:{' '}
            {data.verificationType.replace(/_/g, ' ')}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1.5}>
          <Can action="verification.perform">
            <Button
              variant="outlined"
              onClick={() => setAssignOpen(true)}
              disabled={isFinalized}
              data-testid="verification.btn.assign"
            >
              Update / Assign
            </Button>
          </Can>
          <Can action="verification.complete">
            <Button
              variant="contained"
              color="success"
              onClick={() => setCompleteOpen(true)}
              disabled={isFinalized}
              data-testid="verification.btn.complete"
            >
              Complete Assessment
            </Button>
          </Can>
        </Stack>
      </Box>

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
          <Card variant="outlined">
            <CardHeader title="Case Details & Audit Attributes" />
            <Divider />
            <CardContent>
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
                  <Typography variant="body1">{data.createdBy}</Typography>
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
                    <Typography variant="body1">{data.verifiedBy}</Typography>
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
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={5}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardHeader title="Findings & Evaluation Summary" />
            <Divider />
            <CardContent>
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
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Linked Document Checklist Review Section */}
      <Card variant="outlined">
        <CardHeader
          title="Document Checklist & Attestation Items"
          subheader="Review and attest uploaded borrower documents against verification checklist"
        />
        <Divider />
        <CardContent>
          {data.checklistItmIds.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              No specific checklist items linked to this case. General verification applies.
            </Typography>
          ) : (
            <Stack spacing={2}>
              {data.checklistItmIds.map((itemId) => (
                <Paper
                  key={itemId}
                  variant="outlined"
                  sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <Box>
                    <Typography variant="subtitle2" fontWeight={600}>
                      Item: {itemId}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Linked checklist document requirement
                    </Typography>
                  </Box>
                  <Can action="verification.perform">
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => {
                        setSelectedChecklistId(itemId);
                        setAttestOpen(true);
                      }}
                      data-testid={`verification.attest.${itemId}`}
                    >
                      Attest / Review
                    </Button>
                  </Can>
                </Paper>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>

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

            <UserSelect
              label="Assigned Staff Member"
              placeholder="Search staff user by name..."
              value={newAssignee || null}
              onChange={(val) => setNewAssignee(val ?? '')}
              fullWidth
              size="small"
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
    </Container>
  );
}
