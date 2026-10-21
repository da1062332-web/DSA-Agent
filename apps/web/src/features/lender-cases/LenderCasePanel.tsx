import React, { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Can } from '../../shell/Can';
import {
  buildPackage,
  createLenderCase,
  fetchLenderCases,
  recordLenderQuery,
  recordQueryResponse,
  submitLenderCase,
  updateLenderCaseStatus,
} from './api';
import type { DeclineReasonCode, LenderCaseResource, LenderCaseStatus, SubmissionChannel } from './types';

interface LenderCasePanelProps {
  applicationId?: string;
}

const statusColors: Record<
  LenderCaseStatus,
  'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'
> = {
  DRAFT: 'default',
  PACKAGE_READY: 'info',
  SUBMITTED: 'primary',
  UNDER_PROCESSING: 'info',
  QUERY_RAISED: 'warning',
  QUERY_RESPONDED: 'secondary',
  SANCTIONED: 'success',
  REJECTED: 'error',
  WITHDRAWN: 'default',
  SANCTION_EXPIRED: 'error',
  SANCTION_CANCELLED: 'error',
  PARTIALLY_DISBURSED: 'success',
  DISBURSED: 'success',
  CLOSED: 'default',
};

export function LenderCasePanel({ applicationId: propAppId }: LenderCasePanelProps = {}): React.ReactElement {
  const { applicationId: paramAppId } = useParams<{ applicationId?: string }>();
  const [searchParams] = useSearchParams();
  const queryAppId = searchParams.get('applicationId');
  const [inputAppId, setInputAppId] = useState('');

  const applicationId = propAppId || paramAppId || queryAppId || inputAppId;

  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newLenderId, setNewLenderId] = useState('lnd_hdfc_01');
  const [newProductVersionId, setNewProductVersionId] = useState('lpv_hl_01');
  const [newEmpanelmentId, setNewEmpanelmentId] = useState('emp_blr_01');

  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [activeCase, setActiveCase] = useState<LenderCaseResource | null>(null);
  const [submitChannel, setSubmitChannel] = useState<SubmissionChannel>('PORTAL');
  const [submitReference, setSubmitReference] = useState('');

  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<LenderCaseStatus>('UNDER_PROCESSING');
  const [declineReason, setDeclineReason] = useState<DeclineReasonCode>('POLICY');
  const [reasonText, setReasonText] = useState('');

  const [queryDialogOpen, setQueryDialogOpen] = useState(false);
  const [queryText, setQueryText] = useState('');

  const [responseDialogOpen, setResponseDialogOpen] = useState(false);
  const [responseText, setResponseText] = useState('');

  const {
    data: cases = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['lender-cases', applicationId],
    queryFn: () => fetchLenderCases(applicationId),
    enabled: !!applicationId,
  });

  const createMutation = useMutation({
    meta: { successMessage: 'Lender case created.' },
    mutationFn: () => {
      if (!applicationId) throw new Error('Application ID is required to create a lender attempt.');
      return createLenderCase(applicationId, {
        lenderId: newLenderId,
        productVersionId: newProductVersionId,
        empanelmentId: newEmpanelmentId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lender-cases', applicationId] });
      setCreateDialogOpen(false);
      setNewLenderId('');
      setNewProductVersionId('');
      setNewEmpanelmentId('');
      setSuccessMessage('New lender attempt created successfully.');
      setErrorMessage(null);
    },
    onError: (err: any) => {
      setErrorMessage(err.message || 'Failed to create lender attempt.');
    },
  });

  const packageMutation = useMutation({
    meta: { successMessage: 'Submission package built.' },
    mutationFn: (caseItem: LenderCaseResource) => buildPackage(caseItem.id, {}, `"${caseItem.lockVersion}"`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lender-cases', applicationId] });
      setSuccessMessage('Submission package built and frozen.');
      setErrorMessage(null);
    },
    onError: (err: any) => {
      setErrorMessage(err.message || 'Failed to build package.');
    },
  });

  const submitMutation = useMutation({
    meta: { successMessage: 'Case submitted to the lender.' },
    mutationFn: () => {
      if (!activeCase) throw new Error('No active case');
      return submitLenderCase(
        activeCase.id,
        { channel: submitChannel, lenderReference: submitReference || undefined },
        `"${activeCase.lockVersion}"`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lender-cases', applicationId] });
      setSubmitDialogOpen(false);
      setActiveCase(null);
      setSuccessMessage('Lender case successfully submitted.');
      setErrorMessage(null);
    },
    onError: (err: any) => {
      setErrorMessage(err.message || 'Failed to submit lender case.');
    },
  });

  const statusMutation = useMutation({
    meta: { successMessage: 'Case status updated.' },
    mutationFn: () => {
      if (!activeCase) throw new Error('No active case');
      return updateLenderCaseStatus(
        activeCase.id,
        {
          toStatus: newStatus,
          declineReasonCode: newStatus === 'REJECTED' ? declineReason : undefined,
          reasonText: reasonText || undefined,
        },
        `"${activeCase.lockVersion}"`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lender-cases', applicationId] });
      setStatusDialogOpen(false);
      setActiveCase(null);
      setSuccessMessage('Status updated successfully.');
      setErrorMessage(null);
    },
    onError: (err: any) => {
      setErrorMessage(err.message || 'Failed to update status.');
    },
  });

  const queryMutation = useMutation({
    meta: { successMessage: 'Lender query recorded.' },
    mutationFn: () => {
      if (!activeCase) throw new Error('No active case');
      return recordLenderQuery(activeCase.id, { text: queryText }, `"${activeCase.lockVersion}"`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lender-cases', applicationId] });
      setQueryDialogOpen(false);
      setActiveCase(null);
      setQueryText('');
      setSuccessMessage('Query recorded successfully.');
      setErrorMessage(null);
    },
    onError: (err: any) => {
      setErrorMessage(err.message || 'Failed to record query.');
    },
  });

  const responseMutation = useMutation({
    meta: { successMessage: 'Response recorded.' },
    mutationFn: () => {
      if (!activeCase) throw new Error('No active case');
      return recordQueryResponse(activeCase.id, { text: responseText });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lender-cases', applicationId] });
      setResponseDialogOpen(false);
      setActiveCase(null);
      setResponseText('');
      setSuccessMessage('Query response recorded.');
      setErrorMessage(null);
    },
    onError: (err: any) => {
      setErrorMessage(err.message || 'Failed to record query response.');
    },
  });

  return (
    <Card variant="outlined" sx={{ my: 2 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
          <Box>
            <Typography variant="h6" component="h2" fontWeight="bold">
              Lender Attempts (MOD-LCS)
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Sequential and parallel lender submissions, frozen package manifests, and status roll-up.
              {applicationId ? ` · Application: ${applicationId}` : ''}
            </Typography>
          </Box>
          <Can action="lender_case.submit">
            <Button
              variant="contained"
              color="primary"
              disabled={!applicationId}
              onClick={() => setCreateDialogOpen(true)}
            >
              + New Lender Attempt
            </Button>
          </Can>
        </Stack>

        {errorMessage && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMessage(null)}>
            {errorMessage}
          </Alert>
        )}

        {successMessage && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMessage(null)}>
            {successMessage}
          </Alert>
        )}

        {!applicationId ? (
          <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', bgcolor: 'grey.50' }}>
            <Typography variant="subtitle1" fontWeight={600} mb={1}>
              No Application Selected
            </Typography>
            <Typography color="text.secondary" mb={2}>
              Please provide an Application ID in the route URL (e.g.
              /applications/:applicationId/lender-cases) or enter one below:
            </Typography>
            <Stack direction="row" spacing={2} justifyContent="center" maxWidth={400} mx="auto">
              <TextField
                size="small"
                fullWidth
                placeholder="Enter Application ID (e.g. app_demo_001)"
                value={inputAppId}
                onChange={(e) => setInputAppId(e.target.value)}
              />
            </Stack>
          </Paper>
        ) : isLoading ? (
          <Box display="flex" justifyContent="center" p={4}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Alert severity="error">Failed to load lender attempts.</Alert>
        ) : cases.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', bgcolor: 'grey.50' }}>
            <Typography color="text.secondary">
              No lender attempts recorded yet for this application. Click "+ New Lender Attempt" to start.
            </Typography>
          </Paper>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead sx={{ bgcolor: 'grey.100' }}>
                <TableRow>
                  <TableCell>
                    <strong>Attempt</strong>
                  </TableCell>
                  <TableCell>
                    <strong>Lender ID</strong>
                  </TableCell>
                  <TableCell>
                    <strong>Status</strong>
                  </TableCell>
                  <TableCell>
                    <strong>Channel</strong>
                  </TableCell>
                  <TableCell>
                    <strong>Reference</strong>
                  </TableCell>
                  <TableCell>
                    <strong>Submitted At</strong>
                  </TableCell>
                  <TableCell align="right">
                    <strong>Actions</strong>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {cases.map((c) => (
                  <TableRow key={c.id} hover>
                    <TableCell>
                      <Chip label={`#${c.attemptNo}`} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell>{c.lenderId}</TableCell>
                    <TableCell>
                      <Chip label={c.status} size="small" color={statusColors[c.status] || 'default'} />
                      {c.declineReasonCode && (
                        <Typography variant="caption" display="block" color="error">
                          {c.declineReasonCode}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{c.submissionChannel || '—'}</TableCell>
                    <TableCell>{c.lenderReference || '—'}</TableCell>
                    <TableCell>
                      {c.submittedAt ? new Date(c.submittedAt).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        {c.status === 'DRAFT' && (
                          <Can action="lender_case.submit">
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => packageMutation.mutate(c)}
                              disabled={packageMutation.isPending}
                            >
                              Build Package
                            </Button>
                          </Can>
                        )}
                        {c.status === 'PACKAGE_READY' && (
                          <Can action="lender_case.submit">
                            <Button
                              size="small"
                              variant="contained"
                              color="primary"
                              onClick={() => {
                                setActiveCase(c);
                                setSubmitDialogOpen(true);
                              }}
                            >
                              Submit
                            </Button>
                          </Can>
                        )}
                        {['SUBMITTED', 'UNDER_PROCESSING', 'QUERY_RESPONDED'].includes(c.status) && (
                          <>
                            <Can action="lender_case.update_status">
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => {
                                  setActiveCase(c);
                                  setNewStatus('UNDER_PROCESSING');
                                  setStatusDialogOpen(true);
                                }}
                              >
                                Update Status
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                color="warning"
                                onClick={() => {
                                  setActiveCase(c);
                                  setQueryDialogOpen(true);
                                }}
                              >
                                Query
                              </Button>
                            </Can>
                          </>
                        )}
                        {c.status === 'QUERY_RAISED' && (
                          <Can action="lender_case.update_status">
                            <Button
                              size="small"
                              variant="contained"
                              color="warning"
                              onClick={() => {
                                setActiveCase(c);
                                setResponseDialogOpen(true);
                              }}
                            >
                              Respond to Query
                            </Button>
                          </Can>
                        )}
                        {c.status === 'SANCTIONED' && (
                          <Can action="disbursement.record">
                            <Button
                              size="small"
                              variant="outlined"
                              color="success"
                              onClick={() => {
                                setActiveCase(c);
                                setNewStatus('DISBURSED');
                                setStatusDialogOpen(true);
                              }}
                            >
                              Disbursement
                            </Button>
                          </Can>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Create Lender Attempt Dialog */}
        <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>New Lender Attempt</DialogTitle>
          <DialogContent dividers>
            {errorMessage && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMessage(null)}>
                {errorMessage}
              </Alert>
            )}
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                label="Lender ID"
                value={newLenderId}
                onChange={(e) => setNewLenderId(e.target.value)}
                placeholder="lnd_01..."
                fullWidth
                required
              />
              <TextField
                label="Product Version ID"
                value={newProductVersionId}
                onChange={(e) => setNewProductVersionId(e.target.value)}
                placeholder="lpv_01..."
                fullWidth
                required
              />
              <TextField
                label="Empanelment ID"
                value={newEmpanelmentId}
                onChange={(e) => setNewEmpanelmentId(e.target.value)}
                placeholder="emp_01..."
                fullWidth
                required
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !newLenderId || !newProductVersionId || !newEmpanelmentId}
            >
              Create Attempt
            </Button>
          </DialogActions>
        </Dialog>

        {/* Submit to Lender Dialog */}
        <Dialog open={submitDialogOpen} onClose={() => setSubmitDialogOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Submit Package to Lender</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <FormControl fullWidth>
                <InputLabel>Submission Channel</InputLabel>
                <Select
                  value={submitChannel}
                  label="Submission Channel"
                  onChange={(e) => setSubmitChannel(e.target.value as SubmissionChannel)}
                >
                  <MenuItem value="PORTAL">Lender Partner Portal</MenuItem>
                  <MenuItem value="EMAIL">Encrypted Email Delivery</MenuItem>
                  <MenuItem value="API">Direct Lender API</MenuItem>
                  <MenuItem value="PHYSICAL">Physical Branch Docket</MenuItem>
                </Select>
              </FormControl>
              <TextField
                label="Lender Reference / Application Number"
                value={submitReference}
                onChange={(e) => setSubmitReference(e.target.value)}
                placeholder="e.g. HDFC-APP-2026-9901"
                fullWidth
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSubmitDialogOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              color="primary"
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
            >
              Confirm Submission
            </Button>
          </DialogActions>
        </Dialog>

        {/* Update Status Dialog */}
        <Dialog open={statusDialogOpen} onClose={() => setStatusDialogOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Update Case Status</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <FormControl fullWidth>
                <InputLabel>Target Status</InputLabel>
                <Select
                  value={newStatus}
                  label="Target Status"
                  onChange={(e) => setNewStatus(e.target.value as LenderCaseStatus)}
                >
                  <MenuItem value="UNDER_PROCESSING">UNDER_PROCESSING</MenuItem>
                  <MenuItem value="SANCTIONED">SANCTIONED</MenuItem>
                  <MenuItem value="REJECTED">REJECTED</MenuItem>
                  <MenuItem value="PARTIALLY_DISBURSED">PARTIALLY_DISBURSED</MenuItem>
                  <MenuItem value="DISBURSED">DISBURSED</MenuItem>
                  <MenuItem value="WITHDRAWN">WITHDRAWN</MenuItem>
                </Select>
              </FormControl>

              {newStatus === 'REJECTED' && (
                <FormControl fullWidth required>
                  <InputLabel>Decline Reason Code</InputLabel>
                  <Select
                    value={declineReason}
                    label="Decline Reason Code"
                    onChange={(e) => setDeclineReason(e.target.value as DeclineReasonCode)}
                  >
                    <MenuItem value="POLICY">Policy Out of Bounds</MenuItem>
                    <MenuItem value="INCOME">Income / FOIR Inadequate</MenuItem>
                    <MenuItem value="CREDIT_HISTORY">Credit Score / Bureau Derogatory</MenuItem>
                    <MenuItem value="DOCUMENTATION">Documentation Incomplete</MenuItem>
                    <MenuItem value="LOCATION">Geo-Location Unserviceable</MenuItem>
                    <MenuItem value="CUSTOMER_DECLINED">Customer Declined Offer</MenuItem>
                    <MenuItem value="OTHER">Other Reason</MenuItem>
                  </Select>
                </FormControl>
              )}

              <TextField
                label="Reason / Remarks Note"
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                multiline
                rows={3}
                fullWidth
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setStatusDialogOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              onClick={() => statusMutation.mutate()}
              disabled={statusMutation.isPending}
            >
              Update Status
            </Button>
          </DialogActions>
        </Dialog>

        {/* Record Query Dialog */}
        <Dialog open={queryDialogOpen} onClose={() => setQueryDialogOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Raise Lender Query</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                label="Query Description"
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                multiline
                rows={3}
                fullWidth
                required
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setQueryDialogOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              color="warning"
              onClick={() => queryMutation.mutate()}
              disabled={queryMutation.isPending || !queryText.trim()}
            >
              Raise Query
            </Button>
          </DialogActions>
        </Dialog>

        {/* Respond to Query Dialog */}
        <Dialog
          open={responseDialogOpen}
          onClose={() => setResponseDialogOpen(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Respond to Lender Query</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                label="Response Details"
                value={responseText}
                onChange={(e) => setResponseText(e.target.value)}
                multiline
                rows={3}
                fullWidth
                required
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setResponseDialogOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              color="primary"
              onClick={() => responseMutation.mutate()}
              disabled={responseMutation.isPending || !responseText.trim()}
            >
              Submit Response
            </Button>
          </DialogActions>
        </Dialog>
      </CardContent>
    </Card>
  );
}
