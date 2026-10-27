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
import { DataTable } from '../../ui';
import { getCustomer, getCustomerConsents, recordCustomerConsent, withdrawConsent } from './api';
import { Can } from '../../shell/Can';
import { LenderSelect } from '../../shell/selectors';
import { useLookup } from '../admin/api';
import type { ConsentResource, RecordConsentPayload } from './types';
import { NotSet } from '../../ui/NotSet';
import { RowAction } from '../../shell/RowAction';

export function CustomerConsents(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const customerId = (id || '').replace(/[)\s]+$/, '');
  const queryClient = useQueryClient();
  const branches = useLookup<{ id: string; code: string; name: string }>('/v1/branches');
  const formatBranch = (branchId?: string | null): React.ReactNode => {
    if (!branchId) return <NotSet />;
    const b = (branches.data ?? []).find((x) => x.id === branchId);
    return b ? `${b.name} (${b.code})` : branchId;
  };

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
      <Container maxWidth={false} disableGutters>
        <Alert severity="error">Failed to load customer profile: {(loadError as Error).message}</Alert>
        <Button component={Link} to="/customers" sx={{ mt: 2 }} variant="outlined">
          ← Back to Customers
        </Button>
      </Container>
    );
  }

  const customer = customerData?.customer;

  return (
    <Container maxWidth={false} disableGutters>
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

            <DataTable<ConsentResource>
              dataTestId="consents.table"
              data={consents}
              keyExtractor={(c) => c.id}
              emptyMessage="No consent records found for this customer."
              columns={[
                {
                  id: 'purpose',
                  header: 'Purpose',
                  render: (c) => (
                    <Chip label={c.purpose} size="small" color="info" variant="outlined" sx={{ fontWeight: 600 }} />
                  ),
                },
                {
                  id: 'notice',
                  header: 'Notice Version',
                  render: (c) => (
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {c.noticeVersion}
                    </Typography>
                  ),
                },
                {
                  id: 'channel',
                  header: 'Channel',
                  render: (c) => <Chip label={c.channel} size="small" variant="filled" sx={{ fontSize: '0.75rem' }} />,
                },
                { id: 'scope', header: 'Target / Scope', render: (c) => c.purposeTarget || <NotSet /> },
                {
                  id: 'captured',
                  header: 'Captured Date',
                  render: (c) => (
                    <Typography variant="body2" color="text.secondary">
                      {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : <NotSet />}
                    </Typography>
                  ),
                },
                {
                  id: 'status',
                  header: 'Status',
                  render: (c) => (
                    <Chip label={c.status} color={c.status === 'ACTIVE' ? 'success' : 'error'} size="small" sx={{ fontWeight: 600 }} />
                  ),
                },
                {
                  id: 'action',
                  header: 'Action',
                  align: 'right',
                  render: (c) =>
                    c.status === 'WITHDRAWN' ? (
                      <Typography variant="caption" color="text.secondary">
                        Revoked
                      </Typography>
                    ) : (
                      <RowAction allowed={c.status === 'ACTIVE'} action="consent.record">
                        <Button
                          size="small"
                          color="error"
                          variant="outlined"
                          onClick={() => withdrawMutation.mutate(c.id)}
                          disabled={withdrawMutation.isPending}
                        >
                          Withdraw
                        </Button>
                      </RowAction>
                    ),
                },
              ]}
            />
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
                onChange={(val) => {
                  setPurposeTarget(val ?? '');
                  if (actionError) setActionError(null);
                }}
                size="small"
                fullWidth
                required
                error={Boolean(actionError && !purposeTarget.trim())}
                helperText={
                  actionError && !purposeTarget.trim()
                    ? 'Target lender is required'
                    : 'Lender organization with whom consent is granted'
                }
                data-testid="consent.purposeTarget"
              />
            )}

            {purpose === 'VERIFICATION_CHECK' && (
              <TextField
                label="Verification Agency / Target *"
                value={purposeTarget}
                onChange={(e) => {
                  setPurposeTarget(e.target.value);
                  if (actionError) setActionError(null);
                }}
                size="small"
                fullWidth
                required
                error={Boolean(actionError && !purposeTarget.trim())}
                helperText={
                  actionError && !purposeTarget.trim()
                    ? 'Target agency identifier is required'
                    : 'Identifier or name of agency conducting verification'
                }
                inputProps={{ 'data-testid': 'consent.purposeTarget' }}
              />
            )}

            <TextField
              label="Notice Version"
              value={noticeVersion}
              onChange={(e) => setNoticeVersion(e.target.value)}
              size="small"
              fullWidth
              inputProps={{ 'data-testid': 'consent.noticeVersion' }}
            />

            <FormControl fullWidth size="small">
              <InputLabel id="channel-select-label">Channel</InputLabel>
              <Select
                labelId="channel-select-label"
                value={channel}
                label="Channel"
                onChange={(e) => setChannel(e.target.value as RecordConsentPayload['channel'])}
                data-testid="consent.channel"
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
              inputProps={{ 'data-testid': 'consent.evidenceRef' }}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setOpenDialog(false)}>Cancel</Button>
          <Button
            variant="contained"
            data-testid="consent.submit"
            onClick={() => {
              if (
                (purpose === 'SHARE_WITH_LENDER' || purpose === 'VERIFICATION_CHECK') &&
                !purposeTarget.trim()
              ) {
                setActionError('Target lender or agency identifier is required for this consent purpose.');
                return;
              }
              const target =
                purpose === 'SHARE_WITH_LENDER' || purpose === 'VERIFICATION_CHECK'
                  ? purposeTarget.trim()
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
