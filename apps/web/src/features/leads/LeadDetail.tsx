import { useState } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { hasPermission, useMe } from '../../api/useMe';
import { Can } from '../../shell/Can';
import { fetchLeadById, transitionLead, assignLead, convertLead, ApiError } from './api';
import { leadActions } from './lead-actions';
import { UserSelect } from '../../shell/selectors';
import { CustomerName, ConnectorName, UserName } from '../../shell/display';
import type { ConversionResponse } from './types';

export function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const me = useMe();

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Modal states
  const [qualifyOpen, setQualifyOpen] = useState(false);
  const [qualApplicantType, setQualApplicantType] = useState('SALARIED');
  const [qualMonthlyIncome, setQualMonthlyIncome] = useState('');
  const [qualAmount, setQualAmount] = useState('');
  const [qualError, setQualError] = useState<string | null>(null);

  const [disqualifyOpen, setDisqualifyOpen] = useState(false);
  const [disqualificationReason, setDisqualificationReason] = useState('NOT_INTERESTED');

  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('CUSTOMER_REQUESTED');
  const [reopenError, setReopenError] = useState<string | null>(null);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignUserId, setAssignUserId] = useState('');
  const [assignReason, setAssignReason] = useState('MANUAL');

  const [conversionResult, setConversionResult] = useState<ConversionResponse | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['lead', id],
    queryFn: () => (id ? fetchLeadById(id) : Promise.reject(new Error('Missing lead id'))),
    enabled: !!id,
  });

  const lead = data?.lead;
  const etag = data?.etag;

  // Mutations
  const transitionMutation = useMutation({
    meta: { successMessage: 'Lead status updated.' },
    mutationFn: (variables: Parameters<typeof transitionLead>[1]) => {
      if (!id || !etag) throw new Error('Missing lead ID or ETag');
      return transitionLead(id, variables, etag);
    },
    onSuccess: () => {
      setSuccessMessage('Lead lifecycle state updated successfully.');
      setErrorMessage(null);
      setQualifyOpen(false);
      setDisqualifyOpen(false);
      setReopenOpen(false);
      queryClient.invalidateQueries({ queryKey: ['lead', id] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setErrorMessage(`${err.code}: ${err.message}`);
      } else {
        setErrorMessage((err as Error).message);
      }
    },
  });

  const assignMutation = useMutation({
    meta: { successMessage: 'Lead assigned.' },
    mutationFn: (variables: { toUserId?: string; reasonCode: string }) => {
      if (!id || !etag) throw new Error('Missing lead ID or ETag');
      return assignLead(id, variables, etag);
    },
    onSuccess: () => {
      setSuccessMessage('Lead assigned successfully.');
      setErrorMessage(null);
      setAssignOpen(false);
      queryClient.invalidateQueries({ queryKey: ['lead', id] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setErrorMessage(`${err.code}: ${err.message}`);
      } else {
        setErrorMessage((err as Error).message);
      }
    },
  });

  const convertMutation = useMutation({
    meta: { successMessage: 'Lead converted to an application.' },
    mutationFn: () => {
      if (!id || !etag) throw new Error('Missing lead ID or ETag');
      return convertLead(id, etag);
    },
    onSuccess: (result) => {
      setConversionResult(result);
      setSuccessMessage('Lead converted successfully into customer and loan application!');
      setErrorMessage(null);
      queryClient.invalidateQueries({ queryKey: ['lead', id] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setErrorMessage(`${err.code}: ${err.message}`);
      } else {
        setErrorMessage((err as Error).message);
      }
    },
  });

  if (isLoading) {
    return (
      <Container maxWidth="lg" sx={{ py: 8, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (isError || !lead) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          {(error as Error)?.message || 'Lead not found or access denied.'}
        </Alert>
        <Button component={RouterLink} to="/leads" variant="contained">
          Back to Leads
        </Button>
      </Container>
    );
  }

  const isTransitionPending =
    transitionMutation.isPending || convertMutation.isPending || assignMutation.isPending;
  // The state decides which actions apply; the user's permissions decide which of those are offered (audit F-12).
  const actions = leadActions(lead.state, (code) => hasPermission(me.data, code));

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Header and Breadcrumbs */}
      <Box mb={3}>
        <Stack direction="row" spacing={1} alignItems="center" mb={1}>
          <Button component={RouterLink} to="/leads" size="small" variant="text">
            ← Back to Leads
          </Button>
        </Stack>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          justifyContent="space-between"
          alignItems={{ md: 'center' }}
          spacing={2}
        >
          <Box>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Typography variant="h4" component="h1" fontWeight="bold">
                {lead.fullName}
              </Typography>
              <Chip
                label={lead.state}
                color={
                  lead.state === 'QUALIFIED' ? 'success' : lead.state === 'CONVERTED' ? 'primary' : 'info'
                }
              />
              {lead.duplicateFlag !== 'NONE' && (
                <Chip label={`Duplicate: ${lead.duplicateFlag}`} color="warning" variant="outlined" />
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Lead ID: <code>{lead.id}</code> · Version: {lead.lockVersion} (ETag: {etag})
            </Typography>
          </Box>

          {/* Action Buttons */}
          <Stack direction="row" spacing={1} flexWrap="wrap">
            {actions.attemptContact && (
              <Can permission="lead.update">
                <Button
                  variant="outlined"
                  color="primary"
                  disabled={isTransitionPending}
                  onClick={() => transitionMutation.mutate({ transitionCode: 'T-LEAD-01' })}
                  data-testid="lead.action.attempt-contact"
                >
                  Attempt Contact
                </Button>
              </Can>
            )}

            {actions.markInProgress && (
              <Can permission="lead.update">
                <Button
                  variant="outlined"
                  color="info"
                  disabled={isTransitionPending}
                  onClick={() => transitionMutation.mutate({ transitionCode: 'T-LEAD-02' })}
                  data-testid="lead.action.in-progress"
                >
                  Mark In Progress
                </Button>
              </Can>
            )}

            {actions.qualify && (
              <Can permission="lead.qualify">
                <Button
                  variant="contained"
                  color="success"
                  disabled={isTransitionPending}
                  onClick={() => setQualifyOpen(true)}
                  data-testid="lead.action.qualify"
                >
                  Qualify Lead
                </Button>
              </Can>
            )}
            {actions.disqualify && (
              <Can permission="lead.qualify">
                <Button
                  variant="outlined"
                  color="error"
                  disabled={isTransitionPending}
                  onClick={() => setDisqualifyOpen(true)}
                  data-testid="lead.action.disqualify"
                >
                  Disqualify
                </Button>
              </Can>
            )}

            {actions.reopen && (
              <Can permission="lead.reopen">
                <Button
                  variant="contained"
                  color="warning"
                  disabled={isTransitionPending}
                  onClick={() => setReopenOpen(true)}
                  data-testid="lead.action.reopen"
                >
                  Reopen Lead
                </Button>
              </Can>
            )}

            {actions.convert && (
              <Can permission="application.create">
                <Button
                  variant="contained"
                  color="primary"
                  disabled={isTransitionPending}
                  onClick={() => convertMutation.mutate()}
                  data-testid="lead.action.convert"
                >
                  Convert to Loan Application
                </Button>
              </Can>
            )}

            {actions.assign && (
              <Can permission="lead.assign">
                <Button
                  variant="outlined"
                  color="inherit"
                  disabled={isTransitionPending}
                  onClick={() => setAssignOpen(true)}
                  data-testid="lead.action.assign"
                >
                  Assign
                </Button>
              </Can>
            )}

            <Button
              variant="outlined"
              color="warning"
              component={RouterLink}
              to={`/complaints?complainantType=LEAD&complainantId=${lead.id}`}
              data-testid="lead.action.grievance"
            >
              Grievance / Complaint
            </Button>
          </Stack>
        </Stack>
      </Box>

      {/* Notifications */}
      {successMessage && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccessMessage(null)}>
          {successMessage}
        </Alert>
      )}
      {errorMessage && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            errorMessage.includes('VERSION_CONFLICT') ? (
              <Button color="inherit" size="small" onClick={() => refetch()}>
                Refresh
              </Button>
            ) : undefined
          }
          onClose={() => setErrorMessage(null)}
        >
          {errorMessage}
        </Alert>
      )}

      {/* Conversion Result Box */}
      {conversionResult && (
        <Card sx={{ mb: 3, bgcolor: 'primary.50', border: 1, borderColor: 'primary.200' }}>
          <CardContent>
            <Typography variant="h6" color="primary.main" fontWeight="bold" gutterBottom>
              Lead Converted Successfully
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <Typography variant="body2" color="text.secondary">
                  Customer Created / Linked:
                </Typography>
                <Typography variant="body1" fontWeight="medium">
                  {conversionResult.customerId}
                </Typography>
                <Button
                  component={RouterLink}
                  to={`/customers/${conversionResult.customerId}/consents`}
                  variant="contained"
                  color="primary"
                  size="small"
                  sx={{ mt: 1 }}
                >
                  Manage Customer DPDP Consents →
                </Button>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="body2" color="text.secondary">
                  Loan Application Created:
                </Typography>
                <Typography variant="body1" fontWeight="medium">
                  {conversionResult.applicationId}
                </Typography>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}

      {lead.state === 'CONVERTED' && lead.customerId && !conversionResult && (
        <Card sx={{ mb: 3, bgcolor: 'success.50', border: 1, borderColor: 'success.200' }}>
          <CardContent>
            <Typography variant="h6" color="success.main" fontWeight="bold" gutterBottom>
              Lead Converted to Customer
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
              <Typography variant="body1">
                Linked Customer: <CustomerName id={lead.customerId} linkToProfile typographyProps={{ fontWeight: 'bold' }} />
              </Typography>
              <Button
                component={RouterLink}
                to={`/customers/${lead.customerId}/consents`}
                variant="contained"
                color="success"
                size="small"
              >
                Manage Customer DPDP Consents →
              </Button>
              <Button
                component={RouterLink}
                to={`/applications`}
                variant="outlined"
                color="primary"
                size="small"
              >
                View Loan Applications →
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* Details Grid */}
      <Grid container spacing={3}>
        {/* Contact & Personal Information */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom fontWeight="semibold">
                Contact Information
              </Typography>
              <Divider sx={{ mb: 2 }} />
              <Stack spacing={1.5}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Full Name
                  </Typography>
                  <Typography variant="body1">{lead.fullName}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Masked Mobile
                  </Typography>
                  <Typography variant="body1" fontWeight="medium">
                    {lead.mobileMasked}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Masked Email
                  </Typography>
                  <Typography variant="body1">{lead.emailMasked || '—'}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Pincode
                  </Typography>
                  <Typography variant="body1">{lead.pincode || '—'}</Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Loan Requirement & Qualification */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom fontWeight="semibold">
                Loan & Qualification Details
              </Typography>
              <Divider sx={{ mb: 2 }} />
              <Stack spacing={1.5}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Product Category
                  </Typography>
                  <Typography variant="body1">{lead.productCategory}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Indicative Amount
                  </Typography>
                  <Typography variant="body1">
                    {lead.indicativeAmount
                      ? `${lead.indicativeAmount.currency} ${lead.indicativeAmount.amount}`
                      : '—'}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Priority
                  </Typography>
                  <Typography variant="body1">{lead.priority}</Typography>
                </Box>
                {lead.qualApplicantType && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Applicant Type (Qualified)
                    </Typography>
                    <Typography variant="body1">{lead.qualApplicantType}</Typography>
                  </Box>
                )}
                {lead.qualMonthlyIncome && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Monthly Income (Qualified)
                    </Typography>
                    <Typography variant="body1">INR {lead.qualMonthlyIncome}</Typography>
                  </Box>
                )}
                {lead.disqualificationReason && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Disqualification Reason
                    </Typography>
                    <Typography variant="body1" color="error">
                      {lead.disqualificationReason}
                    </Typography>
                  </Box>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Attribution & Ownership */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom fontWeight="semibold">
                Attribution
              </Typography>
              <Divider sx={{ mb: 2 }} />
              <Stack spacing={1.5}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Source
                  </Typography>
                  <Typography variant="body1">{lead.source}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Campaign
                  </Typography>
                  <Typography variant="body1">{lead.campaign || '—'}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Connector / Partner
                  </Typography>
                  <Box sx={{ mt: 0.5 }}>
                    <ConnectorName id={lead.connectorId} fallback="Direct / Organic" typographyProps={{ variant: 'body1' }} />
                  </Box>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Referred At
                  </Typography>
                  <Typography variant="body1">
                    {lead.referredAt ? new Date(lead.referredAt).toLocaleString() : '—'}
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Ownership & System */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom fontWeight="semibold">
                Ownership & Metadata
              </Typography>
              <Divider sx={{ mb: 2 }} />
              <Stack spacing={1.5}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Owner User
                  </Typography>
                  <Box sx={{ mt: 0.5 }}>
                    <UserName id={lead.ownerUserId} fallback="Unassigned" typographyProps={{ variant: 'body1' }} />
                  </Box>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Owner Queue ID
                  </Typography>
                  <Typography variant="body1">{lead.ownerQueueId || '—'}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Contact Attempts
                  </Typography>
                  <Typography variant="body1">{lead.contactAttempts}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Created At
                  </Typography>
                  <Typography variant="body1">{new Date(lead.createdAt).toLocaleString()}</Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Grievance & Complaints Integration */}
        <Grid item xs={12}>
          <Card sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider' }}>
            <CardContent>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                justifyContent="space-between"
                alignItems={{ sm: 'center' }}
                spacing={2}
              >
                <Box>
                  <Typography variant="h6" fontWeight="semibold">
                    Grievances & Customer Complaints
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Registered complaints for this lead are linked to the Grievances module (MOD-GRV).
                  </Typography>
                </Box>
                <Button
                  variant="contained"
                  color="warning"
                  component={RouterLink}
                  to={`/complaints?complainantType=LEAD&complainantId=${lead.id}`}
                  data-testid="lead.view-grievances"
                >
                  Manage Lead Complaints →
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Qualify Dialog (T-LEAD-04) */}
      <Dialog open={qualifyOpen} onClose={() => setQualifyOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Qualify Lead (T-LEAD-04)</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Provide qualification details before marking this lead as QUALIFIED.
          </DialogContentText>
          {qualError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {qualError}
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel id="qual-applicant-type-label">Applicant Type</InputLabel>
              <Select
                labelId="qual-applicant-type-label"
                value={qualApplicantType}
                label="Applicant Type"
                onChange={(e) => setQualApplicantType(e.target.value)}
                data-testid="qualify.applicantType"
              >
                <MenuItem value="SALARIED">Salaried</MenuItem>
                <MenuItem value="SELF_EMPLOYED_PROFESSIONAL">Self-Employed Professional</MenuItem>
                <MenuItem value="SELF_EMPLOYED_BUSINESS">Self-Employed Business</MenuItem>
                <MenuItem value="NON_INDIVIDUAL">Non-Individual / Entity</MenuItem>
              </Select>
            </FormControl>
            <TextField
              fullWidth
              required
              label="Monthly Income (INR)"
              value={qualMonthlyIncome}
              onChange={(e) => setQualMonthlyIncome(e.target.value)}
              placeholder="e.g. 75000"
              data-testid="qualify.monthlyIncome"
            />
            <TextField
              fullWidth
              required
              label="Requested Loan Amount (INR)"
              value={qualAmount}
              onChange={(e) => setQualAmount(e.target.value)}
              placeholder="e.g. 500000"
              data-testid="qualify.requestedAmount"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQualifyOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="success"
            onClick={() => {
              if (!qualApplicantType || !qualAmount.trim() || !qualMonthlyIncome.trim()) {
                setQualError('Applicant type, monthly income, and requested amount are required.');
                return;
              }
              const amtNum = Number(qualAmount.trim());
              const incNum = Number(qualMonthlyIncome.trim());
              if (isNaN(amtNum) || amtNum <= 0 || isNaN(incNum) || incNum <= 0) {
                setQualError('Please enter valid positive numbers for income and requested amount.');
                return;
              }
              setQualError(null);
              const formattedAmt =
                /^\d+$/.test(qualAmount.trim())
                  ? `${qualAmount.trim()}.00`
                  : /^\d+\.\d$/.test(qualAmount.trim())
                    ? `${qualAmount.trim()}0`
                    : qualAmount.trim();
              transitionMutation.mutate({
                transitionCode: 'T-LEAD-04',
                qualification: {
                  applicantType: qualApplicantType,
                  requestedAmount: {
                    amount: formattedAmt,
                    currency: 'INR',
                  },
                },
                qualApplicantType,
                qualRequestedAmount: {
                  amount: formattedAmt,
                  currency: 'INR',
                },
              });
            }}
            disabled={transitionMutation.isPending}
            data-testid="qualify.submit"
          >
            Submit Qualification
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reopen Dialog (T-LEAD-06) */}
      <Dialog open={reopenOpen} onClose={() => setReopenOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Reopen Lead (T-LEAD-06)</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Provide a mandatory reason for reopening this lead back to NEW status.
          </DialogContentText>
          {reopenError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {reopenError}
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel id="reopen-reason-label">Reason Code</InputLabel>
              <Select
                labelId="reopen-reason-label"
                value={reopenReason}
                label="Reason Code"
                onChange={(e) => setReopenReason(e.target.value)}
                data-testid="reopen.reason"
              >
                <MenuItem value="CUSTOMER_REQUESTED">Customer Requested Re-evaluation</MenuItem>
                <MenuItem value="NEW_INFORMATION_RECEIVED">New Information Received</MenuItem>
                <MenuItem value="CONTACT_DETAILS_UPDATED">Contact Details Updated</MenuItem>
                <MenuItem value="CREDIT_PROFILE_IMPROVED">Credit Profile Improved</MenuItem>
                <MenuItem value="OTHER">Other / Manager Override</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReopenOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => {
              if (!reopenReason || !reopenReason.trim()) {
                setReopenError('Reopen reason is required.');
                return;
              }
              setReopenError(null);
              transitionMutation.mutate({
                transitionCode: 'T-LEAD-06',
                reasonCode: reopenReason.trim(),
              });
            }}
            disabled={transitionMutation.isPending}
            data-testid="reopen.submit"
          >
            Confirm Reopen
          </Button>
        </DialogActions>
      </Dialog>

      {/* Disqualify Dialog (T-LEAD-05) */}
      <Dialog open={disqualifyOpen} onClose={() => setDisqualifyOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Disqualify Lead (T-LEAD-05)</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>Select reason for disqualifying this lead.</DialogContentText>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel id="disqual-reason-label">Disqualification Reason</InputLabel>
            <Select
              labelId="disqual-reason-label"
              value={disqualificationReason}
              label="Disqualification Reason"
              onChange={(e) => setDisqualificationReason(e.target.value)}
              data-testid="disqualify.reason"
            >
              <MenuItem value="NOT_INTERESTED">Not Interested</MenuItem>
              <MenuItem value="NOT_ELIGIBLE">Not Eligible</MenuItem>
              <MenuItem value="DUPLICATE">Duplicate</MenuItem>
              <MenuItem value="UNREACHABLE">Unreachable</MenuItem>
              <MenuItem value="OTHER">Other</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisqualifyOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() =>
              transitionMutation.mutate({
                transitionCode: 'T-LEAD-05',
                disqualificationReason,
              })
            }
            disabled={transitionMutation.isPending}
            data-testid="disqualify.submit"
          >
            Confirm Disqualification
          </Button>
        </DialogActions>
      </Dialog>

      {/* Assign Dialog (API-LEAD-006) */}
      <Dialog open={assignOpen} onClose={() => setAssignOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Assign Lead</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Reassign ownership of this lead to another sales executive or queue.
          </DialogContentText>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <UserSelect
              fullWidth
              label="Target User / Sales Executive"
              value={assignUserId || null}
              onChange={(val) => setAssignUserId(val ?? '')}
              placeholder="Search user by name or email..."
              data-testid="assign.userId"
            />
            <FormControl fullWidth>
              <InputLabel id="assign-reason-label">Reason Code</InputLabel>
              <Select
                labelId="assign-reason-label"
                value={assignReason}
                label="Reason Code"
                onChange={(e) => setAssignReason(e.target.value)}
              >
                <MenuItem value="MANUAL">Manual Reassignment</MenuItem>
                <MenuItem value="WORKLOAD_BALANCE">Workload Balancing</MenuItem>
                <MenuItem value="SPECIALIST_TRANSFER">Specialist Transfer</MenuItem>
                <MenuItem value="TERRITORY_CHANGE">Territory Change</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() =>
              assignMutation.mutate({
                toUserId: assignUserId.trim() || undefined,
                reasonCode: assignReason,
              })
            }
            disabled={assignMutation.isPending || !assignUserId.trim()}
            data-testid="assign.submit"
          >
            Assign Lead
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
