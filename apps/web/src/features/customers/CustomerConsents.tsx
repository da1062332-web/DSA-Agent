// apps/web/src/features/customers/CustomerConsents.tsx — owner: Dev 5 (UI-LEAD-001 Customer Consents)
import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
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
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
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
  Paper,
} from '@mui/material';
import { getCustomer, getCustomerConsents, recordCustomerConsent, withdrawConsent } from './api';
import { Can } from '../../shell/Can';
import { LenderSelect } from '../../shell/selectors';
import type { ConsentResource, RecordConsentPayload } from './types';

// Human-friendly branch map
const BRANCH_NAMES: Record<string, string> = {
  br_demo_01: 'Mumbai Central (MUM01)',
  br_01JMUMBAI000000000000000000: 'Mumbai Central (MUM01)',
  br_01M4SXZC0AQGYTCAXDYW7X5P5G: 'Mumbai Central (MUM01)',
  br_01M4SXZKQBPV90E84AHJXMVBG9: 'Mumbai Central (MUM01)',
  br_01M51P6RD79G416WCM2DRC81QE: 'Mumbai Central (MUM02)',
  br_01M4SXZC2066CKN733T19QJ1T9: 'Pune Camp (PUN01)',
  br_01M4SXZKRV8TA1K0PFRFSH9AZW: 'Pune Camp (PUN01)',
  br_01M4ZJ8H51XBQ0A3RWZSBVRZAP: 'Platform Operations',
};

function formatBranch(id?: string | null): string {
  if (!id) return '—';
  return BRANCH_NAMES[id] || id;
}

export function CustomerConsents(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const customerId = (id || '').replace(/[)\s]+$/, '');
  const queryClient = useQueryClient();

  const [openDialog, setOpenDialog] = useState(false);
  const [purpose, setPurpose] = useState<RecordConsentPayload['purpose']>('CONTACT');
  const [purposeTarget, setPurposeTarget] = useState('');
  const [noticeVersion, setNoticeVersion] = useState('NV-2026.1');
  const [channel, setChannel] = useState<RecordConsentPayload['channel']>('WEB_FORM');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    data: customerData,
    isLoading,
    error: loadError,
  } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => getCustomer(customerId),
    enabled: Boolean(customerId),
  });

  const { data: consents = [], isLoading: isConsentsLoading } = useQuery({
    queryKey: ['customer-consents', customerId],
    queryFn: () => getCustomerConsents(customerId),
    enabled: Boolean(customerId),
  });

  const recordMutation = useMutation({
    meta: { successMessage: 'Consent recorded.' },
    mutationFn: (payload: RecordConsentPayload) => recordCustomerConsent(customerId, payload),
    onSuccess: () => {
      setOpenDialog(false);
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-consents', customerId] });
    },
    onError: (err: Error) => {
      setActionError(err.message);
    },
  });

  const withdrawMutation = useMutation({
    meta: { successMessage: 'Consent withdrawn.' },
    mutationFn: (consentId: string) => withdrawConsent(consentId, 'Customer requested revocation'),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-consents', customerId] });
    },
    onError: (err: Error) => {
      setActionError(err.message);
    },
  });

  if (isLoading || isConsentsLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (loadError) {
    return (
      <Container sx={{ py: 4 }}>
        <Alert severity="error">Failed to load customer profile: {(loadError as Error).message}</Alert>
        <Button component={Link} to="/customers" sx={{ mt: 2 }} variant="outlined">
          ← Back to Customers
        </Button>
      </Container>
    );
  }

  const customer = customerData?.customer;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack spacing={3}>
        {/* Navigation & Header */}
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ sm: 'center' }}
          spacing={2}
        >
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Button component={Link} to="/leads" variant="outlined" size="small">
              ← Back to Leads
            </Button>
            <Button component={Link} to={`/customers/${customerId}`} variant="outlined" size="small">
              Customer Profile
            </Button>
            <Button component={Link} to="/applications" variant="outlined" color="primary" size="small">
              Applications
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Digital Personal Data Protection (DPDP) Act Compliance
          </Typography>
        </Stack>

        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Customer Consent Management
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Audit-grade record of explicit consents captured, inherited from lead conversion, and revocable on
            demand.
          </Typography>
        </Box>

        {actionError && <Alert severity="error">{actionError}</Alert>}

        {/* Structured Customer Profile Card */}
        {customer && (
          <Card elevation={2} sx={{ borderRadius: 2 }}>
            <CardContent>
              {/* Header inside card */}
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                justifyContent="space-between"
                alignItems={{ sm: 'center' }}
                spacing={2}
                sx={{ mb: 2 }}
              >
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    {customer.fullName}
                  </Typography>
                  <Chip
                    label={customer.status}
                    color={customer.status === 'ACTIVE' ? 'success' : 'default'}
                    size="small"
                    sx={{ fontWeight: 600 }}
                  />
                  <Chip label={customer.partyType} variant="outlined" color="primary" size="small" />
                </Stack>
                <Can action="consent.record">
                  <Button
                    variant="contained"
                    onClick={() => setOpenDialog(true)}
                    sx={{ textTransform: 'none', fontWeight: 600 }}
                  >
                    + Record New Consent
                  </Button>
                </Can>
              </Stack>

              <Divider sx={{ mb: 2 }} />

              {/* Clean structured key-value grid */}
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6} md={3}>
                  <Box
                    sx={{
                      p: 1.5,
                      bgcolor: 'background.default',
                      borderRadius: 1.5,
                      border: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', mb: 0.5, fontWeight: 500 }}
                    >
                      Customer ID
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                      {customer.id}
                    </Typography>
                  </Box>
                </Grid>

                <Grid item xs={12} sm={6} md={3}>
                  <Box
                    sx={{
                      p: 1.5,
                      bgcolor: 'background.default',
                      borderRadius: 1.5,
                      border: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', mb: 0.5, fontWeight: 500 }}
                    >
                      Home Branch
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {formatBranch(customer.homeBranchId)}
                    </Typography>
                  </Box>
                </Grid>

                <Grid item xs={12} sm={6} md={3}>
                  <Box
                    sx={{
                      p: 1.5,
                      bgcolor: 'background.default',
                      borderRadius: 1.5,
                      border: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', mb: 0.5, fontWeight: 500 }}
                    >
                      Registered Mobile
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {customer.primaryMobileMasked || 'N/A'}
                    </Typography>
                  </Box>
                </Grid>

                <Grid item xs={12} sm={6} md={3}>
                  <Box
                    sx={{
                      p: 1.5,
                      bgcolor: 'background.default',
                      borderRadius: 1.5,
                      border: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', mb: 0.5, fontWeight: 500 }}
                    >
                      Registered Email
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {customer.primaryEmailMasked || 'N/A'}
                    </Typography>
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        )}

        {/* Consents Registry Table */}
        <Card elevation={2} sx={{ borderRadius: 2 }}>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  Consent Registry Records (ENT-028)
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Immutable DPDP consent trail with purpose, versioning, channel, and withdrawal status
                </Typography>
              </Box>
              <Chip
                label={`${consents.filter((c: ConsentResource) => c.status === 'ACTIVE').length} Active Consents`}
                color="primary"
                variant="outlined"
                size="small"
              />
            </Stack>

            <Divider sx={{ mb: 2 }} />

            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5 }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ backgroundColor: 'action.hover' }}>
                    <TableCell sx={{ fontWeight: 600 }}>Purpose</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Notice Version</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Channel</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Target / Scope</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Captured Date</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>
                      Action
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {consents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                        No consent records found for this customer.
                      </TableCell>
                    </TableRow>
                  ) : (
                    consents.map((c: ConsentResource) => (
                      <TableRow key={c.id} hover>
                        <TableCell>
                          <Chip
                            label={c.purpose}
                            size="small"
                            color="info"
                            variant="outlined"
                            sx={{ fontWeight: 600 }}
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                            {c.noticeVersion}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={c.channel}
                            size="small"
                            variant="filled"
                            sx={{ fontSize: '0.75rem' }}
                          />
                        </TableCell>
                        <TableCell>{c.purposeTarget || '—'}</TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={c.status}
                            color={c.status === 'ACTIVE' ? 'success' : 'error'}
                            size="small"
                            sx={{ fontWeight: 600 }}
                          />
                        </TableCell>
                        <TableCell align="right">
                          {c.status === 'ACTIVE' && (
                            <Can action="consent.record">
                              <Button
                                size="small"
                                color="error"
                                variant="outlined"
                                onClick={() => withdrawMutation.mutate(c.id)}
                                disabled={withdrawMutation.isPending}
                              >
                                Withdraw
                              </Button>
                            </Can>
                          )}
                          {c.status === 'WITHDRAWN' && (
                            <Typography variant="caption" color="text.secondary">
                              Revoked
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Stack>

      {/* Record Consent Dialog */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Record Customer Consent (DPDP Act)</DialogTitle>
        <DialogContent dividers>
          {actionError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
              {actionError}
            </Alert>
          )}
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel id="purpose-select-label">Purpose</InputLabel>
              <Select
                labelId="purpose-select-label"
                value={purpose}
                label="Purpose"
                onChange={(e) => {
                  const val = e.target.value as RecordConsentPayload['purpose'];
                  setPurpose(val);
                  if ((val === 'SHARE_WITH_LENDER' || val === 'VERIFICATION_CHECK') && !purposeTarget) {
                    setPurposeTarget('LENDER_HDFC_01');
                  }
                }}
              >
                <MenuItem value="CONTACT">CONTACT</MenuItem>
                <MenuItem value="LOAN_PROCESSING">LOAN_PROCESSING</MenuItem>
                <MenuItem value="SHARE_WITH_LENDER">SHARE_WITH_LENDER</MenuItem>
                <MenuItem value="VERIFICATION_CHECK">VERIFICATION_CHECK</MenuItem>
                <MenuItem value="MARKETING">MARKETING</MenuItem>
              </Select>
            </FormControl>

            {purpose === 'SHARE_WITH_LENDER' && (
              <LenderSelect
                label="Target Lender *"
                value={purposeTarget || null}
                onChange={(val) => setPurposeTarget(val ?? '')}
                size="small"
                fullWidth
                required
                helperText="Lender organization with whom consent is granted"
              />
            )}

            {purpose === 'VERIFICATION_CHECK' && (
              <TextField
                label="Verification Agency / Target *"
                value={purposeTarget || ''}
                onChange={(e) => setPurposeTarget(e.target.value)}
                size="small"
                fullWidth
                required
                helperText="Identifier or name of agency conducting verification"
              />
            )}

            <TextField
              label="Notice Version"
              value={noticeVersion}
              onChange={(e) => setNoticeVersion(e.target.value)}
              size="small"
              fullWidth
            />

            <FormControl fullWidth size="small">
              <InputLabel id="channel-select-label">Channel</InputLabel>
              <Select
                labelId="channel-select-label"
                value={channel}
                label="Channel"
                onChange={(e) => setChannel(e.target.value as RecordConsentPayload['channel'])}
              >
                <MenuItem value="WEB_FORM">WEB_FORM</MenuItem>
                <MenuItem value="OTP">OTP</MenuItem>
                <MenuItem value="IN_PERSON">IN_PERSON</MenuItem>
                <MenuItem value="PHONE">PHONE</MenuItem>
                <MenuItem value="EMAIL">EMAIL</MenuItem>
                <MenuItem value="DOCUMENT">DOCUMENT</MenuItem>
              </Select>
            </FormControl>

            <TextField
              label="Evidence Reference (Optional)"
              value={evidenceRef}
              onChange={(e) => setEvidenceRef(e.target.value)}
              size="small"
              fullWidth
              placeholder="e.g. DOC-SIGNED-001"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setOpenDialog(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              const target =
                purpose === 'SHARE_WITH_LENDER' || purpose === 'VERIFICATION_CHECK'
                  ? purposeTarget.trim() || 'LENDER_HDFC_01'
                  : purposeTarget.trim() || undefined;
              recordMutation.mutate({
                purpose,
                purposeTarget: target,
                noticeVersion: noticeVersion.trim() || 'NV-2026.1',
                channel,
                evidenceRef: evidenceRef.trim() || undefined,
              });
            }}
            disabled={recordMutation.isPending}
          >
            {recordMutation.isPending ? 'Recording...' : 'Record Consent'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default CustomerConsents;
