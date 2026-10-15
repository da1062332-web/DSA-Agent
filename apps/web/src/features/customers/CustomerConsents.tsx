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
import type { ConsentResource, RecordConsentPayload } from './types';

export function CustomerConsents(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const customerId = id || '';
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

  const {
    data: consents = [],
    isLoading: isConsentsLoading,
  } = useQuery({
    queryKey: ['customer-consents', customerId],
    queryFn: () => getCustomerConsents(customerId),
    enabled: Boolean(customerId),
  });

  const recordMutation = useMutation({
    meta: { successMessage: 'Consent recorded.' },
    mutationFn: (payload: RecordConsentPayload) =>
      recordCustomerConsent(customerId, payload),
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
    mutationFn: (consentId: string) => withdrawConsent(consentId, 'User withdrawal via UI'),
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
        <Alert severity="error">
          Failed to load customer profile: {(loadError as Error).message}
        </Alert>
      </Container>
    );
  }

  const customer = customerData?.customer;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack spacing={3}>
        {/* Navigation & Title */}
        <Stack direction="row" alignItems="center" spacing={2}>
          <Button
            component={Link}
            to="/leads"
            variant="outlined"
            size="small"
          >
            ← Back to Leads
          </Button>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>
            Customer Consent Management (UI-LEAD-001)
          </Typography>
        </Stack>

        {actionError && <Alert severity="error">{actionError}</Alert>}

        {/* Customer Summary Card */}
        {customer && (
          <Card elevation={2}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    {customer.fullName}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Customer ID: {customer.id} · Party Type: {customer.partyType} · Branch: {customer.homeBranchId}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Mobile: {customer.primaryMobileMasked || 'N/A'} · Email: {customer.primaryEmailMasked || 'N/A'}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip
                    label={customer.status}
                    color={customer.status === 'ACTIVE' ? 'success' : 'default'}
                    size="small"
                  />
                  <Button
                    variant="contained"
                    onClick={() => setOpenDialog(true)}
                  >
                    + Record New Consent
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Consents List */}
        <Card elevation={2}>
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Consent Registry Records (ENT-028)
              </Typography>
            </Stack>
            <Divider sx={{ mb: 2 }} />

            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ backgroundColor: 'action.hover' }}>
                    <TableCell>Purpose</TableCell>
                    <TableCell>Notice Version</TableCell>
                    <TableCell>Channel</TableCell>
                    <TableCell>Target</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {consents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                        No consent records found for this customer.
                      </TableCell>
                    </TableRow>
                  ) : (
                    consents.map((c: ConsentResource) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {c.purpose}
                          </Typography>
                        </TableCell>
                        <TableCell>{c.noticeVersion}</TableCell>
                        <TableCell>{c.channel}</TableCell>
                        <TableCell>{c.purposeTarget || '—'}</TableCell>
                        <TableCell>
                          <Chip
                            label={c.status}
                            color={c.status === 'ACTIVE' ? 'success' : 'default'}
                            size="small"
                          />
                        </TableCell>
                        <TableCell align="right">
                          {c.status === 'ACTIVE' && (
                            <Button
                              size="small"
                              color="error"
                              variant="outlined"
                              onClick={() => withdrawMutation.mutate(c.id)}
                              disabled={withdrawMutation.isPending}
                            >
                              Withdraw
                            </Button>
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
        <DialogTitle>Record Customer Consent (DPDP Act)</DialogTitle>
        <DialogContent dividers>
          {actionError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
              {actionError}
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
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

            {(purpose === 'SHARE_WITH_LENDER' || purpose === 'VERIFICATION_CHECK') && (
              <TextField
                label="Purpose Target (Lender / Vendor ID) *"
                value={purposeTarget || 'LENDER_HDFC_01'}
                onChange={(e) => setPurposeTarget(e.target.value)}
                size="small"
                fullWidth
                required
                helperText="Identifier of lender or agency with whom data is shared"
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
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDialog(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              const target =
                purpose === 'SHARE_WITH_LENDER' || purpose === 'VERIFICATION_CHECK'
                  ? (purposeTarget.trim() || 'LENDER_HDFC_01')
                  : (purposeTarget.trim() || undefined);
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
            Record Consent
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
