import React, { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormHelperText,
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
import { DataTable } from '../../ui';
import { Can } from '../../shell/Can';
import { ApplicationSelect } from '../../shell/selectors';
import { LenderName } from '../../shell/display';
import {
  buildPackage,
  createLenderCase,
  fetchLenderCases,
  fetchApplicationDocuments,
  fetchLenderCaseQueries,
  recordLenderQuery,
  recordQueryResponse,
  submitLenderCase,
  updateLenderCaseStatus,
} from './api';
import type { DeclineReasonCode, LenderCaseResource, LenderCaseStatus, SubmissionChannel } from './types';
import { LenderAttemptFields, type LenderAttemptValue } from './LenderAttemptFields';
import { oldestOpenLenderQuery } from './lender-query';
import { packageErrorText } from './package-error';
import { NotSet } from '../../ui/NotSet';
import { RowAction } from '../../shell/RowAction';

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
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [attempt, setAttempt] = useState<LenderAttemptValue>({
    lenderId: '',
    empanelmentId: '',
    productVersionId: '',
  });

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

  /** Refreshes the attempt list and every case screen that shows a case's queries, history or package. */
  const refreshCaseViews = () => {
    queryClient.invalidateQueries({ queryKey: ['lender-cases', applicationId] });
    queryClient.invalidateQueries({ queryKey: ['lender-case'] });
    queryClient.invalidateQueries({ queryKey: ['lender-case-queries'] });
    queryClient.invalidateQueries({ queryKey: ['lender-case-history'] });
    queryClient.invalidateQueries({ queryKey: ['lender-case-package'] });
  };

  /** Opens the status dialog with the target status already chosen (used by the row actions). */
  const openStatusDialog = (caseItem: LenderCaseResource, status: LenderCaseStatus) => {
    setActiveCase(caseItem);
    setNewStatus(status);
    setReasonText('');
    setStatusDialogOpen(true);
  };

  // The lender's queries on the case being answered. The response goes to the oldest unanswered one.
  const openQueriesQuery = useQuery({
    queryKey: ['lender-case-queries', activeCase?.id],
    queryFn: () => fetchLenderCaseQueries(activeCase!.id),
    enabled: responseDialogOpen && !!activeCase,
  });
  const openQuery = openQueriesQuery.data ? oldestOpenLenderQuery(openQueriesQuery.data) : null;

  // The documents of this application a response may attach. The dialog shows their types, never their ids.
  const [responseDocumentIds, setResponseDocumentIds] = useState<string[]>([]);
  const applicationDocumentsQuery = useQuery({
    queryKey: ['lender-case-documents', applicationId],
    queryFn: () => fetchApplicationDocuments(applicationId!),
    enabled: responseDialogOpen && !!applicationId,
  });

  const createMutation = useMutation({
    meta: { successMessage: 'Lender case created.' },
    mutationFn: () => {
      if (!applicationId) throw new Error('Application ID is required to create a lender attempt.');
      return createLenderCase(applicationId, attempt);
    },
    onSuccess: () => {
      refreshCaseViews();
      setCreateDialogOpen(false);
      setAttempt({ lenderId: '', empanelmentId: '', productVersionId: '' });
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
      refreshCaseViews();
      setSuccessMessage('Submission package built and frozen.');
      setErrorMessage(null);
    },
    onError: (err: any) => {
      // 422 here is a business rule (no lender-sharing consent, or documents still open): say which, and what to do.
      setErrorMessage(packageErrorText(err));
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
      refreshCaseViews();
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
      refreshCaseViews();
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
      refreshCaseViews();
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
      if (!openQuery) throw new Error('There is no open lender query to answer.');
      return recordQueryResponse(openQuery.id, { text: responseText, documentReferences: responseDocumentIds });
    },
    onSuccess: () => {
      refreshCaseViews();
      setResponseDialogOpen(false);
      setActiveCase(null);
      setResponseText('');
      setResponseDocumentIds([]);
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
              Lender Attempts
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Sequential and parallel lender submissions, frozen package manifests, and status roll-up.
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
              Choose the application whose lender attempts you want to see:
            </Typography>
            <Stack direction="row" spacing={2} justifyContent="center" maxWidth={400} mx="auto">
              <ApplicationSelect
                size="small"
                fullWidth
                label="Application"
                placeholder="Select Application..."
                value={inputAppId || null}
                onChange={(id) => setInputAppId(id ?? '')}
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
          <DataTable<(typeof cases)[number]>
            dataTestId="lc.table.cases"
            data={cases}
            keyExtractor={(c) => c.id}
            columns={[
              { id: 'attempt', header: 'Attempt', render: (c) => <Chip label={`#${c.attemptNo}`} size="small" variant="outlined" /> },
              { id: 'lender', header: 'Lender', render: (c) => <LenderName id={c.lenderId} typographyProps={{ fontWeight: 500 }} /> },
              {
                id: 'status',
                header: 'Status',
                render: (c) => (
                  <>
                    <Chip label={c.status} size="small" color={statusColors[c.status] || 'default'} />
                    {c.declineReasonCode && (
                      <Typography variant="caption" display="block" color="error">
                        {c.declineReasonCode}
                      </Typography>
                    )}
                  </>
                ),
              },
              { id: 'channel', header: 'Channel', render: (c) => c.submissionChannel || <NotSet /> },
              { id: 'reference', header: 'Reference', render: (c) => c.lenderReference || <NotSet /> },
              {
                id: 'submitted',
                header: 'Submitted At',
                render: (c) => (c.submittedAt ? new Date(c.submittedAt).toLocaleDateString() : <NotSet />),
              },
              {
                id: 'actions',
                header: 'Actions',
                align: 'right',
                render: (c) => (
                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <RowAction allowed={c.status === 'DRAFT'} action="lender_case.submit">
                        <Button size="small" variant="outlined" onClick={() => packageMutation.mutate(c)} disabled={packageMutation.isPending}>
                          Build Package
                        </Button>
                    </RowAction>
                    <RowAction allowed={c.status === 'PACKAGE_READY'} action="lender_case.submit">
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
                    </RowAction>
                    <RowAction allowed={['SUBMITTED', 'UNDER_PROCESSING', 'QUERY_RESPONDED'].includes(c.status)} action="lender_case.update_status">
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
                    </RowAction>
                    <RowAction allowed={['SUBMITTED', 'UNDER_PROCESSING', 'QUERY_RESPONDED'].includes(c.status)} action="lender_case.update_status">
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
                    </RowAction>
                    <RowAction allowed={c.status === 'QUERY_RAISED'} action="lender_case.update_status">
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
                    </RowAction>
                    <RowAction allowed={c.status === 'SANCTIONED'} action="disbursement.record">
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
                    </RowAction>
                    <RowAction
                      allowed={['DRAFT', 'PACKAGE_READY', 'SUBMITTED', 'UNDER_PROCESSING', 'QUERY_RAISED', 'QUERY_RESPONDED', 'SANCTIONED'].includes(c.status)}
                      action="lender_case.update_status"
                    >
                      <Button
                        size="small"
                        variant="text"
                        color="error"
                        onClick={() => openStatusDialog(c, 'WITHDRAWN')}
                        data-testid="lender-case.withdraw"
                      >
                        Withdraw
                      </Button>
                    </RowAction>
                    <RowAction allowed={c.status === 'SANCTIONED'} action="sanction.record">
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => navigate(`/sanctions/${c.id}`)}
                        data-testid="lender-case.open-sanction"
                      >
                        Sanction
                      </Button>
                    </RowAction>
                  </Stack>
                ),
              },
            ]}
          />
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
            <Box sx={{ mt: 1 }}>
              <LenderAttemptFields value={attempt} onChange={setAttempt} />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              onClick={() => createMutation.mutate()}
              disabled={
                createMutation.isPending ||
                !attempt.lenderId ||
                !attempt.productVersionId ||
                !attempt.empanelmentId
              }
              data-testid="lender-case.create.submit"
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
              {openQueriesQuery.isLoading ? (
                <CircularProgress size={24} />
              ) : openQuery ? (
                <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.50' }}>
                  <Typography variant="caption" color="text.secondary">
                    The lender asks ({openQueriesQuery.data?.filter((q) => !q.respondedAt).length ?? 0} open)
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
                    {openQuery.text}
                  </Typography>
                  {openQuery.requestedItems.length > 0 && (
                    <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap' }}>
                      {openQuery.requestedItems.map((item) => (
                        <Chip key={item} label={item.replace(/_/g, ' ').toLowerCase()} size="small" variant="outlined" />
                      ))}
                    </Stack>
                  )}
                </Paper>
              ) : (
                <Alert severity="info">There is no open lender query on this case.</Alert>
              )}
              <TextField
                label="Response Details"
                value={responseText}
                onChange={(e) => setResponseText(e.target.value)}
                multiline
                rows={3}
                fullWidth
                required
              />
              <FormControl fullWidth>
                <InputLabel id="lc-response-documents">Attach documents</InputLabel>
                <Select
                  labelId="lc-response-documents"
                  multiple
                  label="Attach documents"
                  value={responseDocumentIds}
                  onChange={(e) => setResponseDocumentIds(e.target.value as string[])}
                  renderValue={(ids) => `${ids.length} selected`}
                  data-testid="lender-case.response.documents"
                >
                  {(applicationDocumentsQuery.data ?? []).map((d) => (
                    <MenuItem key={d.documentId} value={d.documentId}>
                      <Checkbox checked={responseDocumentIds.includes(d.documentId)} />
                      {d.documentTypeCode.replace(/_/g, ' ').toLowerCase()} · {d.status.replace(/_/g, ' ').toLowerCase()}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>
                  {applicationDocumentsQuery.data?.length
                    ? 'Only documents uploaded for this application are offered.'
                    : 'No documents are uploaded for this application yet.'}
                </FormHelperText>
              </FormControl>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setResponseDialogOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              color="primary"
              onClick={() => responseMutation.mutate()}
              disabled={responseMutation.isPending || !openQuery || !responseText.trim()}
              data-testid="lender-case.response.submit"
            >
              Submit Response
            </Button>
          </DialogActions>
        </Dialog>
      </CardContent>
    </Card>
  );
}
