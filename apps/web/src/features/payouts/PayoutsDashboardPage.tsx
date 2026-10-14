import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
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
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { errorText } from '../../api/client';
import { hasPermission, useMe } from '../../api/useMe';
import { fetchPayables } from '../commission/api';
import type { CommissionPayable } from '../commission/types';
import {
  approvePayoutRequest,
  cancelPayoutRequest,
  createPayoutBatch,
  createPayoutRequest,
  downloadBankFile,
  fetchPayoutRequestById,
  fetchPayoutRequests,
  recordPayoutFailure,
  recordPayoutPayment,
} from './api';
import type {
  ApprovePayoutRequestInput,
  CreatePayoutBatchInput,
  CreatePayoutRequestInput,
  PayoutBatch,
  PayoutRequest,
  PayoutRequestStatus,
  RecordPayoutFailureInput,
  RecordPayoutPaymentInput,
} from './types';

export function PayoutsDashboardPage() {
  const me = useMe();
  const currentUserId = me.data?.id;

  const canRequestPayout = hasPermission(me.data, 'payout.request');
  const canApprovePayout = hasPermission(me.data, 'payout.approve');
  const canRecordPayment = hasPermission(me.data, 'payout.record_payment');

  const [activeTab, setActiveTab] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [requests, setRequests] = useState<PayoutRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Create Payout Request Dialog
  const [createDialogOpen, setCreateDialogOpen] = useState<boolean>(false);
  const [selectedConnector, setSelectedConnector] = useState<string>('con_001');
  const [eligiblePayables, setEligiblePayables] = useState<CommissionPayable[]>([]);
  const [selectedPayableIds, setSelectedPayableIds] = useState<string[]>([]);
  const [loadingPayables, setLoadingPayables] = useState<boolean>(false);
  const [submittingRequest, setSubmittingRequest] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Review / Approval Dialog
  const [approvalDialogOpen, setApprovalDialogOpen] = useState<boolean>(false);
  const [selectedRequest, setSelectedRequest] = useState<PayoutRequest | null>(null);
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [comment, setComment] = useState<string>('Reviewed and approved for disbursement');
  const [approving, setApproving] = useState<boolean>(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  // Record Payment Dialog
  const [paymentDialogOpen, setPaymentDialogOpen] = useState<boolean>(false);
  const [paymentUtr, setPaymentUtr] = useState<string>('');
  const [recordingPayment, setRecordingPayment] = useState<boolean>(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Record Failure Dialog
  const [failureDialogOpen, setFailureDialogOpen] = useState<boolean>(false);
  const [failureReason, setFailureReason] = useState<string>('Beneficiary account number mismatch');
  const [recordingFailure, setRecordingFailure] = useState<boolean>(false);
  const [failureError, setFailureError] = useState<string | null>(null);

  // Batch Generation State
  const [createdBatches, setCreatedBatches] = useState<PayoutBatch[]>([]);
  const [batching, setBatching] = useState<boolean>(false);

  const loadRequests = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchPayoutRequests({
        status: statusFilter || undefined,
        limit: 100,
      });
      setRequests(res.data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
  }, [statusFilter]);

  const loadEligiblePayablesForConnector = async (connectorId: string) => {
    try {
      setLoadingPayables(true);
      const res = await fetchPayables({ connectorId, state: 'ELIGIBLE', limit: 100 });
      setEligiblePayables(res.data);
      setSelectedPayableIds(res.data.map((p) => p.id));
    } catch (err) {
      setCreateError(errorText(err));
    } finally {
      setLoadingPayables(false);
    }
  };

  const handleOpenCreateDialog = () => {
    setCreateError(null);
    setCreateDialogOpen(true);
    loadEligiblePayablesForConnector(selectedConnector);
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedPayableIds.length === 0) {
      setCreateError('Please select at least one eligible payable.');
      return;
    }
    try {
      setSubmittingRequest(true);
      setCreateError(null);
      const input: CreatePayoutRequestInput = {
        connectorId: selectedConnector,
        origin: 'FINANCE',
        payableIds: selectedPayableIds,
      };
      const res = await createPayoutRequest(input);
      setSuccessMsg(`Payout request ${res.id} created for ₹${res.total}. Submitted for approval.`);
      setCreateDialogOpen(false);
      await loadRequests();
    } catch (err) {
      setCreateError(errorText(err));
    } finally {
      setSubmittingRequest(false);
    }
  };

  const handleOpenApprovalDialog = async (req: PayoutRequest) => {
    try {
      const full = await fetchPayoutRequestById(req.id);
      setSelectedRequest(full);
      setApprovalError(null);
      setApprovalDialogOpen(true);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const handleApprovalSubmit = async () => {
    if (!selectedRequest) return;
    if (selectedRequest.submittedBy === currentUserId) {
      setApprovalError('Maker-Checker Violation (SOD-03): Submitter cannot approve their own payout request.');
      return;
    }
    try {
      setApproving(true);
      setApprovalError(null);
      const input: ApprovePayoutRequestInput = {
        decision,
        comment: comment.trim() || undefined,
      };
      await approvePayoutRequest(selectedRequest.id, input);
      setSuccessMsg(`Payout request ${selectedRequest.id} marked as ${decision}.`);
      setApprovalDialogOpen(false);
      await loadRequests();
    } catch (err) {
      setApprovalError(errorText(err));
    } finally {
      setApproving(false);
    }
  };

  const handleCancelRequest = async (id: string) => {
    try {
      setError(null);
      await cancelPayoutRequest(id);
      setSuccessMsg(`Payout request ${id} cancelled. Associated payables unlocked to ELIGIBLE.`);
      await loadRequests();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const handleOpenPaymentDialog = (req: PayoutRequest) => {
    setSelectedRequest(req);
    setPaymentUtr(`UTR${Math.floor(1000000000 + Math.random() * 9000000000)}`);
    setPaymentError(null);
    setPaymentDialogOpen(true);
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRequest) return;
    try {
      setRecordingPayment(true);
      setPaymentError(null);
      const input: RecordPayoutPaymentInput = {
        paymentRef: paymentUtr.trim(),
      };
      await recordPayoutPayment(selectedRequest.id, input);
      setSuccessMsg(`Payment recorded for payout ${selectedRequest.id}. Payables marked PAID.`);
      setPaymentDialogOpen(false);
      await loadRequests();
    } catch (err) {
      setPaymentError(errorText(err));
    } finally {
      setRecordingPayment(false);
    }
  };

  const handleOpenFailureDialog = (req: PayoutRequest) => {
    setSelectedRequest(req);
    setFailureError(null);
    setFailureDialogOpen(true);
  };

  const handleFailureSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRequest) return;
    try {
      setRecordingFailure(true);
      setFailureError(null);
      const input: RecordPayoutFailureInput = {
        failureReason: failureReason.trim(),
      };
      await recordPayoutFailure(selectedRequest.id, input);
      setSuccessMsg(`Payment failure recorded for payout ${selectedRequest.id}. Payables returned to ELIGIBLE.`);
      setFailureDialogOpen(false);
      await loadRequests();
    } catch (err) {
      setFailureError(errorText(err));
    } finally {
      setRecordingFailure(false);
    }
  };

  const handleGenerateBatch = async () => {
    const approvedIds = requests.filter((r) => r.status === 'APPROVED').map((r) => r.id);
    if (approvedIds.length === 0) {
      setError('No APPROVED payout requests available to batch.');
      return;
    }
    try {
      setBatching(true);
      setError(null);
      const input: CreatePayoutBatchInput = { payoutIds: approvedIds };
      const batch = await createPayoutBatch(input);
      setCreatedBatches([batch, ...createdBatches]);
      setSuccessMsg(`Bank export batch ${batch.id} generated with ${approvedIds.length} payout(s).`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBatching(false);
    }
  };

  const handleDownloadBankFile = async (batchId: string) => {
    try {
      await downloadBankFile(batchId);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const getStatusColor = (status: PayoutRequestStatus) => {
    switch (status) {
      case 'SUBMITTED':
        return 'warning';
      case 'APPROVED':
        return 'info';
      case 'PAYMENT_RECORDED':
        return 'success';
      case 'REJECTED':
      case 'PAYMENT_FAILED':
        return 'error';
      case 'CANCELLED':
        return 'default';
      default:
        return 'default';
    }
  };

  const pendingApprovals = requests.filter((r) => r.status === 'SUBMITTED');
  const readyForPayment = requests.filter((r) => r.status === 'APPROVED');

  const selectedTotalPaise = eligiblePayables
    .filter((p) => selectedPayableIds.includes(p.id))
    .reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Payouts & Settlement Hub
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Module 31 / 30 Part B — Connector payouts with maker-checker controls, bank batching, and payment recording
          </Typography>
        </Box>
        {canRequestPayout && (
          <Button variant="contained" onClick={handleOpenCreateDialog}>
            Create Payout Request
          </Button>
        )}
      </Stack>

      {successMsg && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg(null)}>
          {successMsg}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper sx={{ mb: 3 }}>
        <Tabs value={activeTab} onChange={(_, val) => setActiveTab(val)}>
          <Tab label={`1. Payout Requests (${requests.length})`} />
          <Tab label={`2. Approval Queue (${pendingApprovals.length})`} />
          <Tab label={`3. Payment Recording & Batches (${readyForPayment.length})`} />
        </Tabs>
      </Paper>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          {/* TAB 1: Payout Requests List */}
          {activeTab === 0 && (
            <Card>
              <CardHeader
                title="Payout Requests Register"
                subheader="Connector payout requests enforcing one live payout line per payable (BR-DOM-025)"
                action={
                  <FormControl size="small" sx={{ width: 180 }}>
                    <InputLabel>Status</InputLabel>
                    <Select
                      value={statusFilter}
                      label="Status"
                      onChange={(e) => setStatusFilter(e.target.value)}
                    >
                      <MenuItem value="">All Statuses</MenuItem>
                      <MenuItem value="SUBMITTED">Submitted</MenuItem>
                      <MenuItem value="APPROVED">Approved</MenuItem>
                      <MenuItem value="PAYMENT_RECORDED">Paid</MenuItem>
                      <MenuItem value="PAYMENT_FAILED">Failed</MenuItem>
                      <MenuItem value="CANCELLED">Cancelled</MenuItem>
                    </Select>
                  </FormControl>
                }
              />
              <Divider />
              <TableContainer>
                {requests.length === 0 ? (
                  <Box sx={{ p: 4, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                      No payout requests found.
                    </Typography>
                  </Box>
                ) : (
                  <Table>
                    <TableHead sx={{ bgcolor: 'grey.50' }}>
                      <TableRow>
                        <TableCell><strong>Payout ID</strong></TableCell>
                        <TableCell><strong>Connector</strong></TableCell>
                        <TableCell><strong>Origin</strong></TableCell>
                        <TableCell><strong>Total Amount (₹)</strong></TableCell>
                        <TableCell><strong>Payment Ref</strong></TableCell>
                        <TableCell><strong>Status</strong></TableCell>
                        <TableCell align="right"><strong>Actions</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {requests.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell><strong>{r.id}</strong></TableCell>
                          <TableCell>{r.connectorId}</TableCell>
                          <TableCell>{r.origin}</TableCell>
                          <TableCell><strong>₹{Number(r.total).toLocaleString('en-IN')}</strong></TableCell>
                          <TableCell>{r.paymentRefMasked || '—'}</TableCell>
                          <TableCell>
                            <Chip
                              label={r.status}
                              size="small"
                              color={getStatusColor(r.status)}
                            />
                          </TableCell>
                          <TableCell align="right">
                            <Stack direction="row" spacing={1} justifyContent="flex-end">
                              {r.status === 'SUBMITTED' && canRequestPayout && (
                                <Button
                                  size="small"
                                  color="error"
                                  onClick={() => handleCancelRequest(r.id)}
                                >
                                  Cancel
                                </Button>
                              )}
                              {r.status === 'SUBMITTED' && canApprovePayout && (
                                <Button
                                  size="small"
                                  variant="outlined"
                                  onClick={() => handleOpenApprovalDialog(r)}
                                >
                                  Review
                                </Button>
                              )}
                            </Stack>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TableContainer>
            </Card>
          )}

          {/* TAB 2: Approval Queue */}
          {activeTab === 1 && (
            <Card>
              <CardHeader
                title="Maker-Checker Approval Queue (CMP-PAY.03.1)"
                subheader="Requester cannot approve their own payout request (SOD-03). Dynamic payable eligibility is checked."
              />
              <Divider />
              <TableContainer>
                {pendingApprovals.length === 0 ? (
                  <Box sx={{ p: 4, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                      No payout requests currently waiting for approval.
                    </Typography>
                  </Box>
                ) : (
                  <Table>
                    <TableHead sx={{ bgcolor: 'grey.50' }}>
                      <TableRow>
                        <TableCell><strong>Payout ID</strong></TableCell>
                        <TableCell><strong>Connector</strong></TableCell>
                        <TableCell><strong>Total Amount (₹)</strong></TableCell>
                        <TableCell><strong>Submitted By</strong></TableCell>
                        <TableCell><strong>Submitted At</strong></TableCell>
                        <TableCell align="right"><strong>Action</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {pendingApprovals.map((req) => (
                        <TableRow key={req.id}>
                          <TableCell><strong>{req.id}</strong></TableCell>
                          <TableCell>{req.connectorId}</TableCell>
                          <TableCell><strong>₹{Number(req.total).toLocaleString('en-IN')}</strong></TableCell>
                          <TableCell>{req.submittedBy}</TableCell>
                          <TableCell>{new Date(req.submittedAt).toLocaleDateString()}</TableCell>
                          <TableCell align="right">
                            <Button
                              size="small"
                              variant="contained"
                              color="primary"
                              disabled={req.submittedBy === currentUserId || !canApprovePayout}
                              onClick={() => handleOpenApprovalDialog(req)}
                            >
                              Review & Decide (SOD-03)
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TableContainer>
            </Card>
          )}

          {/* TAB 3: Payment Recording & Batches */}
          {activeTab === 2 && (
            <Stack spacing={4}>
              <Card>
                <CardHeader
                  title="Approved Payouts Ready for Payment (CMP-PAY.04.1)"
                  subheader="Record bank reference (UTR) or record bank payment failures"
                  action={
                    canRecordPayment &&
                    readyForPayment.length > 0 && (
                      <Button
                        variant="contained"
                        color="secondary"
                        onClick={handleGenerateBatch}
                        disabled={batching}
                      >
                        {batching ? <CircularProgress size={24} /> : `Generate Bank Batch (${readyForPayment.length})`}
                      </Button>
                    )
                  }
                />
                <Divider />
                <TableContainer>
                  {readyForPayment.length === 0 ? (
                    <Box sx={{ p: 3, textAlign: 'center' }}>
                      <Typography variant="body2" color="text.secondary">
                        No approved payouts waiting for payment execution.
                      </Typography>
                    </Box>
                  ) : (
                    <Table>
                      <TableHead sx={{ bgcolor: 'grey.50' }}>
                        <TableRow>
                          <TableCell><strong>Payout ID</strong></TableCell>
                          <TableCell><strong>Connector</strong></TableCell>
                          <TableCell><strong>Total (₹)</strong></TableCell>
                          <TableCell align="right"><strong>Payment Actions</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {readyForPayment.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell><strong>{p.id}</strong></TableCell>
                            <TableCell>{p.connectorId}</TableCell>
                            <TableCell><strong>₹{Number(p.total).toLocaleString('en-IN')}</strong></TableCell>
                            <TableCell align="right">
                              <Stack direction="row" spacing={1} justifyContent="flex-end">
                                <Button
                                  size="small"
                                  variant="contained"
                                  color="success"
                                  onClick={() => handleOpenPaymentDialog(p)}
                                >
                                  Record UTR
                                </Button>
                                <Button
                                  size="small"
                                  color="error"
                                  onClick={() => handleOpenFailureDialog(p)}
                                >
                                  Mark Failed
                                </Button>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </TableContainer>
              </Card>

              {createdBatches.length > 0 && (
                <Card>
                  <CardHeader
                    title="Exported Bank Batches (CMP-PAY.02.1)"
                    subheader="Batches with SHA-256 integrity hash for secure bank transfer files"
                  />
                  <Divider />
                  <TableContainer>
                    <Table>
                      <TableHead sx={{ bgcolor: 'grey.50' }}>
                        <TableRow>
                          <TableCell><strong>Batch ID</strong></TableCell>
                          <TableCell><strong>Payouts Count</strong></TableCell>
                          <TableCell><strong>SHA-256 Integrity Hash</strong></TableCell>
                          <TableCell align="right"><strong>Download</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {createdBatches.map((b) => (
                          <TableRow key={b.id}>
                            <TableCell><strong>{b.id}</strong></TableCell>
                            <TableCell>{b.payoutIds.length}</TableCell>
                            <TableCell><code>{b.fileSha256.slice(0, 24)}...</code></TableCell>
                            <TableCell align="right">
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => handleDownloadBankFile(b.id)}
                              >
                                Download CSV
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Card>
              )}
            </Stack>
          )}
        </>
      )}

      {/* Create Payout Request Modal */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="md" fullWidth>
        <form onSubmit={handleCreateRequest}>
          <DialogTitle>Create Payout Request from Eligible Payables</DialogTitle>
          <DialogContent>
            {createError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {createError}
              </Alert>
            )}
            <Grid container spacing={2} sx={{ mt: 0.5 }}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Connector ID"
                  value={selectedConnector}
                  onChange={(e) => {
                    setSelectedConnector(e.target.value);
                    loadEligiblePayablesForConnector(e.target.value);
                  }}
                />
              </Grid>
              <Grid item xs={12} sm={6} display="flex" alignItems="center">
                <Typography variant="h6" fontWeight={700} color="primary.main">
                  Selected Total: ₹{selectedTotalPaise.toLocaleString('en-IN')}
                </Typography>
              </Grid>
            </Grid>

            <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
              Select Eligible Payables:
            </Typography>

            {loadingPayables ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                <CircularProgress size={24} />
              </Box>
            ) : eligiblePayables.length === 0 ? (
              <Alert severity="info">No ELIGIBLE payables found for connector {selectedConnector}.</Alert>
            ) : (
              <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 260 }}>
                <Table size="small">
                  <TableHead sx={{ bgcolor: 'grey.100' }}>
                    <TableRow>
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={selectedPayableIds.length === eligiblePayables.length}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedPayableIds(eligiblePayables.map((p) => p.id));
                            } else {
                              setSelectedPayableIds([]);
                            }
                          }}
                        />
                      </TableCell>
                      <TableCell><strong>Payable ID</strong></TableCell>
                      <TableCell><strong>Calculation ID</strong></TableCell>
                      <TableCell><strong>Share Rate</strong></TableCell>
                      <TableCell><strong>Amount (₹)</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {eligiblePayables.map((p) => {
                      const isChecked = selectedPayableIds.includes(p.id);
                      return (
                        <TableRow key={p.id}>
                          <TableCell padding="checkbox">
                            <Checkbox
                              checked={isChecked}
                              onChange={() => {
                                if (isChecked) {
                                  setSelectedPayableIds(selectedPayableIds.filter((id) => id !== p.id));
                                } else {
                                  setSelectedPayableIds([...selectedPayableIds, p.id]);
                                }
                              }}
                            />
                          </TableCell>
                          <TableCell>{p.id}</TableCell>
                          <TableCell>{p.calculationId}</TableCell>
                          <TableCell>{(Number(p.shareRate) * 100).toFixed(0)}%</TableCell>
                          <TableCell><strong>₹{Number(p.amount).toLocaleString('en-IN')}</strong></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={submittingRequest || selectedPayableIds.length === 0}
            >
              {submittingRequest ? <CircularProgress size={24} /> : 'Submit Payout Request'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Approval / Review Modal */}
      <Dialog open={approvalDialogOpen} onClose={() => setApprovalDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Maker-Checker Payout Review</DialogTitle>
        <DialogContent>
          {approvalError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {approvalError}
            </Alert>
          )}
          <Typography variant="body2" sx={{ mb: 2 }}>
            Reviewing Payout Request <strong>{selectedRequest?.id}</strong> for Connector{' '}
            <strong>{selectedRequest?.connectorId}</strong>. Total Amount: <strong>₹{selectedRequest?.total}</strong>.
          </Typography>

          <Stack spacing={2}>
            <FormControl fullWidth>
              <InputLabel>Decision</InputLabel>
              <Select
                value={decision}
                label="Decision"
                onChange={(e) => setDecision(e.target.value as 'APPROVED' | 'REJECTED')}
              >
                <MenuItem value="APPROVED">Approve for Payment</MenuItem>
                <MenuItem value="REJECTED">Reject Payout Request</MenuItem>
              </Select>
            </FormControl>
            <TextField
              fullWidth
              multiline
              rows={3}
              label="Reviewer Comments"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApprovalDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleApprovalSubmit}
            variant="contained"
            color={decision === 'APPROVED' ? 'success' : 'error'}
            disabled={approving}
          >
            {approving ? <CircularProgress size={24} /> : `Confirm ${decision}`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Record Bank Payment Modal */}
      <Dialog open={paymentDialogOpen} onClose={() => setPaymentDialogOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handlePaymentSubmit}>
          <DialogTitle>Record Bank Payment Reference (UTR)</DialogTitle>
          <DialogContent>
            {paymentError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {paymentError}
              </Alert>
            )}
            <Typography variant="body2" sx={{ mb: 2 }}>
              Enter the bank Unique Transaction Reference (UTR) for payout{' '}
              <strong>{selectedRequest?.id}</strong> (₹{selectedRequest?.total}).
            </Typography>
            <TextField
              required
              fullWidth
              label="Bank UTR / Transaction Reference"
              placeholder="e.g. UTR1029384756"
              value={paymentUtr}
              onChange={(e) => setPaymentUtr(e.target.value)}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPaymentDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" color="success" disabled={recordingPayment}>
              {recordingPayment ? <CircularProgress size={24} /> : 'Record Payment'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Record Failure Modal */}
      <Dialog open={failureDialogOpen} onClose={() => setFailureDialogOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleFailureSubmit}>
          <DialogTitle>Record Bank Payment Failure</DialogTitle>
          <DialogContent>
            {failureError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {failureError}
              </Alert>
            )}
            <Typography variant="body2" sx={{ mb: 2 }}>
              Recording a payment failure will mark payout{' '}
              <strong>{selectedRequest?.id}</strong> as <code>PAYMENT_FAILED</code> and return all constituent payables back to <code>ELIGIBLE</code>.
            </Typography>
            <TextField
              required
              fullWidth
              label="Failure Reason"
              value={failureReason}
              onChange={(e) => setFailureReason(e.target.value)}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setFailureDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" color="error" disabled={recordingFailure}>
              {recordingFailure ? <CircularProgress size={24} /> : 'Record Failure'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Container>
  );
}
