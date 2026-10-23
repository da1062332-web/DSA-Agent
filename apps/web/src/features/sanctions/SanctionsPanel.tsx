// apps/web/src/features/sanctions/SanctionsPanel.tsx — owner: Dev 3 (MOD-SND UI)
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
  Grid,
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
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMe } from '../../api/useMe';
import { Can } from '../../shell/Can';
import { sanctionsApi } from './api';
import type {
  DisbursementTranche,
  RateType,
  RecordSanctionInput,
  RecordTrancheInput,
  Sanction,
  VerifyTrancheInput,
} from './types';

interface SanctionsPanelProps {
  lenderCaseId?: string;
  currentUserId?: string;
}

export const SanctionsPanel: React.FC<SanctionsPanelProps> = ({
  lenderCaseId: propLenderCaseId,
  currentUserId: propCurrentUserId,
}) => {
  // SOD-04 (verified_by <> recorded_by) needs the signed-in user; the route renders the panel without the prop.
  const me = useMe();
  const currentUserId = propCurrentUserId ?? me.data?.id;
  const { lenderCaseId: paramLenderCaseId } = useParams<{ lenderCaseId?: string }>();
  const [searchParams] = useSearchParams();
  const queryLenderCaseId = searchParams.get('lenderCaseId');
  const [inputCaseId, setInputCaseId] = useState('');

  const lenderCaseId = propLenderCaseId || paramLenderCaseId || queryLenderCaseId || inputCaseId;
  const [sanctions, setSanctions] = useState<Sanction[]>([]);
  const [tranches, setTranches] = useState<DisbursementTranche[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog states
  const [sanctionDialogOpen, setSanctionDialogOpen] = useState<boolean>(false);
  const [trancheDialogOpen, setTrancheDialogOpen] = useState<boolean>(false);
  const [verifyDialogOpen, setVerifyDialogOpen] = useState<boolean>(false);
  const [selectedTranche, setSelectedTranche] = useState<DisbursementTranche | null>(null);

  // Sanction form
  const [sanctionForm, setSanctionForm] = useState<RecordSanctionInput>({
    amount: 1000000,
    tenureMonths: 120,
    rateValue: 8.75,
    rateType: 'FLOATING' as RateType,
    sanctionDate: new Date().toISOString().slice(0, 10),
    validUntil: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
    letterDocumentId: 'doc_sanction_letter_01',
  });

  // Tranche form
  const [trancheForm, setTrancheForm] = useState<RecordTrancheInput>({
    amount: 500000,
    disbursedOn: new Date().toISOString().slice(0, 10),
    utr: 'UTR202610130001',
    loanAccountNumber: 'LA9876543210',
    evidenceDocumentId: 'doc_disbursal_receipt_01',
  });

  // Form validation errors
  const [sanctionErrors, setSanctionErrors] = useState<{
    amount?: string;
    tenureMonths?: string;
    rateValue?: string;
    validUntil?: string;
  }>({});
  const [trancheErrors, setTrancheErrors] = useState<{
    amount?: string;
    utr?: string;
    loanAccountNumber?: string;
  }>({});

  // Verify form
  const [verifyForm, setVerifyForm] = useState<VerifyTrancheInput>({
    decision: 'VERIFY',
    comment: '',
  });

  const activeSanction = sanctions.find((s) => s.status === 'ACTIVE') ?? sanctions[sanctions.length - 1];

  const fetchSanctions = async () => {
    if (!lenderCaseId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const res = await sanctionsApi.listSanctions(lenderCaseId);
      setSanctions(res.data);

      const active = res.data.find((s) => s.status === 'ACTIVE') ?? res.data[res.data.length - 1];
      if (active) {
        const trancheRes = await sanctionsApi.listTranches(active.id);
        setTranches(trancheRes.data);
      } else {
        setTranches([]);
      }
    } catch (err: any) {
      setError(err.message ?? 'Failed to load sanctions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSanctions();
  }, [lenderCaseId]);

  const handleRecordSanction = async () => {
    if (!lenderCaseId) return;
    const errors: { amount?: string; tenureMonths?: string; rateValue?: string; validUntil?: string } = {};

    if (!sanctionForm.amount || isNaN(sanctionForm.amount) || sanctionForm.amount <= 0) {
      errors.amount = 'Sanction amount must be greater than zero.';
    }
    if (!sanctionForm.tenureMonths || isNaN(sanctionForm.tenureMonths) || sanctionForm.tenureMonths <= 0) {
      errors.tenureMonths = 'Tenure must be at least 1 month.';
    }
    if (
      sanctionForm.rateValue === undefined ||
      isNaN(sanctionForm.rateValue) ||
      sanctionForm.rateValue <= 0 ||
      sanctionForm.rateValue > 100
    ) {
      errors.rateValue = 'Interest rate must be between 0.01% and 100%.';
    }
    if (sanctionForm.validUntil && sanctionForm.sanctionDate && sanctionForm.validUntil < sanctionForm.sanctionDate) {
      errors.validUntil = 'Valid until date cannot precede the sanction date.';
    }

    setSanctionErrors(errors);
    if (Object.keys(errors).length > 0) return;

    try {
      setError(null);
      await sanctionsApi.recordSanction(lenderCaseId, sanctionForm);
      setSanctionDialogOpen(false);
      setSanctionErrors({});
      await fetchSanctions();
    } catch (err: any) {
      setError(err.message ?? 'Failed to record sanction');
    }
  };

  const handleRecordTranche = async () => {
    if (!activeSanction) return;
    const errors: { amount?: string; utr?: string; loanAccountNumber?: string } = {};

    if (!trancheForm.amount || isNaN(trancheForm.amount) || trancheForm.amount <= 0) {
      errors.amount = 'Tranche amount must be greater than zero.';
    } else if (trancheForm.amount > remainingSanctionLimit) {
      errors.amount = `Tranche amount cannot exceed remaining limit of ₹${remainingSanctionLimit.toLocaleString('en-IN')}.`;
    }
    if (!trancheForm.utr || !trancheForm.utr.trim()) {
      errors.utr = 'UTR reference is required.';
    }
    if (!trancheForm.loanAccountNumber || !trancheForm.loanAccountNumber.trim()) {
      errors.loanAccountNumber = 'Loan account number is required.';
    }

    setTrancheErrors(errors);
    if (Object.keys(errors).length > 0) return;

    try {
      setError(null);
      await sanctionsApi.recordTranche(activeSanction.id, trancheForm);
      setTrancheDialogOpen(false);
      setTrancheErrors({});
      await fetchSanctions();
    } catch (err: any) {
      setError(err.message ?? 'Failed to record tranche');
    }
  };

  const handleVerifyTranche = async () => {
    if (!selectedTranche) return;
    try {
      setError(null);
      await sanctionsApi.verifyTranche(selectedTranche.id, verifyForm);
      setVerifyDialogOpen(false);
      await fetchSanctions();
    } catch (err: any) {
      setError(err.message ?? 'Failed to verify tranche');
    }
  };

  const totalActiveDisbursed = tranches
    .filter((t) => t.status === 'RECORDED' || t.status === 'VERIFIED')
    .reduce((sum, t) => sum + t.amount, 0);

  const remainingSanctionLimit = activeSanction ? activeSanction.amount - totalActiveDisbursed : 0;

  if (!lenderCaseId) {
    return (
      <Box data-testid="sanctions-panel" sx={{ mt: 2, p: 2 }}>
        <Card variant="outlined" sx={{ p: 4, textAlign: 'center', bgcolor: 'grey.50' }}>
          <Typography variant="h6" fontWeight="bold" mb={1}>
            Sanctions and Disbursements (MOD-SND)
          </Typography>
          <Typography color="text.secondary" mb={3}>
            Please select a lender case or enter a Lender Case ID to manage sanctions and disbursements:
          </Typography>
          <Stack direction="row" spacing={2} justifyContent="center" maxWidth={400} mx="auto">
            <TextField
              size="small"
              fullWidth
              placeholder="Enter Lender Case ID (e.g. lcs_demo_001)"
              value={inputCaseId}
              onChange={(e) => setInputCaseId(e.target.value)}
            />
          </Stack>
        </Card>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" p={4} data-testid="sanctions-panel-loading">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box data-testid="sanctions-panel" sx={{ mt: 2 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Sanction Summary Card */}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Box>
              <Typography variant="h6" fontWeight="bold">
                Lender Sanction Details
              </Typography>
              {activeSanction && (
                <Typography variant="body2" color="text.secondary">
                  Version {activeSanction.version} • Sanctioned on {activeSanction.sanctionDate}
                </Typography>
              )}
            </Box>
            <Box>
              {activeSanction && (
                <Chip
                  label={activeSanction.status}
                  color={
                    activeSanction.status === 'ACTIVE'
                      ? 'success'
                      : activeSanction.status === 'REVISED'
                        ? 'info'
                        : 'default'
                  }
                  size="small"
                  sx={{ mr: 1 }}
                />
              )}
              <Can action="sanction.record">
                <Button
                  variant="contained"
                  size="small"
                  onClick={() => setSanctionDialogOpen(true)}
                  data-testid="record-sanction-btn"
                >
                  {activeSanction ? 'Revise Sanction Terms' : 'Record Sanction'}
                </Button>
              </Can>
            </Box>
          </Box>

          {activeSanction ? (
            <Grid container spacing={2}>
              <Grid item xs={12} sm={3}>
                <Typography variant="caption" color="text.secondary">
                  Sanction Amount
                </Typography>
                <Typography variant="subtitle1" fontWeight="bold">
                  ₹{activeSanction.amount.toLocaleString('en-IN')}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={3}>
                <Typography variant="caption" color="text.secondary">
                  Tenure & Rate
                </Typography>
                <Typography variant="subtitle1">
                  {activeSanction.tenureMonths} mos @ {activeSanction.rateValue}% ({activeSanction.rateType})
                </Typography>
              </Grid>
              <Grid item xs={12} sm={3}>
                <Typography variant="caption" color="text.secondary">
                  Validity Period
                </Typography>
                <Typography variant="subtitle1">Until {activeSanction.validUntil}</Typography>
              </Grid>
              <Grid item xs={12} sm={3}>
                <Typography variant="caption" color="text.secondary">
                  Remaining Limit
                </Typography>
                <Typography variant="subtitle1" fontWeight="bold" color="primary">
                  ₹{remainingSanctionLimit.toLocaleString('en-IN')}
                </Typography>
              </Grid>
            </Grid>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No sanction has been recorded yet for this lender case.
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* Disbursement Tranches Section */}
      {activeSanction && (
        <Card variant="outlined">
          <CardContent>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6" fontWeight="bold">
                Disbursement Tranches
              </Typography>
              <Can action="disbursement.record">
                <Button
                  variant="outlined"
                  size="small"
                  disabled={activeSanction.status !== 'ACTIVE' || remainingSanctionLimit <= 0}
                  onClick={() => {
                    setTrancheForm({
                      ...trancheForm,
                      amount: Math.min(500000, remainingSanctionLimit),
                    });
                    setTrancheDialogOpen(true);
                  }}
                  data-testid="record-tranche-btn"
                >
                  Record Tranche
                </Button>
              </Can>
            </Box>

            {tranches.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No disbursement tranches recorded yet.
              </Typography>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Tranche #</TableCell>
                      <TableCell>Amount</TableCell>
                      <TableCell>Disbursed On</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>UTR (Masked)</TableCell>
                      <TableCell>Loan Account</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tranches.map((t) => {
                      const isRecorder = currentUserId && t.recordedBy === currentUserId;
                      return (
                        <TableRow key={t.id} data-testid={`tranche-row-${t.id}`}>
                          <TableCell>#{t.trancheNo}</TableCell>
                          <TableCell sx={{ fontWeight: 'bold' }}>
                            ₹{t.amount.toLocaleString('en-IN')}
                          </TableCell>
                          <TableCell>{t.disbursedOn}</TableCell>
                          <TableCell>
                            <Chip
                              label={t.status}
                              size="small"
                              color={
                                t.status === 'VERIFIED'
                                  ? 'success'
                                  : t.status === 'RECORDED'
                                    ? 'warning'
                                    : t.status === 'RETURNED'
                                      ? 'error'
                                      : 'default'
                              }
                            />
                          </TableCell>
                          <TableCell>{t.utrMasked ?? '—'}</TableCell>
                          <TableCell>{t.loanAccountMasked ?? '—'}</TableCell>
                          <TableCell align="right">
                            {t.status === 'RECORDED' && (
                              <Can action="disbursement.verify">
                                <Button
                                  size="small"
                                  variant="outlined"
                                  color="primary"
                                  disabled={Boolean(isRecorder)}
                                  title={
                                    isRecorder
                                      ? 'Segregation of duties: Creator cannot verify'
                                      : 'Verify Tranche'
                                  }
                                  onClick={() => {
                                    setSelectedTranche(t);
                                    setVerifyDialogOpen(true);
                                  }}
                                  data-testid={`verify-tranche-btn-${t.id}`}
                                >
                                  {isRecorder ? 'SOD Lock' : 'Verify'}
                                </Button>
                              </Can>
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

      {/* Record/Revise Sanction Dialog */}
      <Dialog open={sanctionDialogOpen} onClose={() => setSanctionDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{activeSanction ? 'Revise Sanction Terms' : 'Record Lender Sanction'}</DialogTitle>
        <DialogContent dividers>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Sanction Amount (₹)"
                type="number"
                fullWidth
                required
                error={Boolean(sanctionErrors.amount)}
                helperText={sanctionErrors.amount}
                value={sanctionForm.amount}
                onChange={(e) => {
                  setSanctionForm({ ...sanctionForm, amount: Number(e.target.value) });
                  if (sanctionErrors.amount) setSanctionErrors((prev) => ({ ...prev, amount: undefined }));
                }}
                inputProps={{ 'data-testid': 'sanction.amount' }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Tenure (Months)"
                type="number"
                fullWidth
                required
                error={Boolean(sanctionErrors.tenureMonths)}
                helperText={sanctionErrors.tenureMonths}
                value={sanctionForm.tenureMonths}
                onChange={(e) => {
                  setSanctionForm({ ...sanctionForm, tenureMonths: Number(e.target.value) });
                  if (sanctionErrors.tenureMonths) setSanctionErrors((prev) => ({ ...prev, tenureMonths: undefined }));
                }}
                inputProps={{ 'data-testid': 'sanction.tenureMonths' }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Interest Rate (%)"
                type="number"
                fullWidth
                required
                error={Boolean(sanctionErrors.rateValue)}
                helperText={sanctionErrors.rateValue}
                value={sanctionForm.rateValue}
                onChange={(e) => {
                  setSanctionForm({ ...sanctionForm, rateValue: Number(e.target.value) });
                  if (sanctionErrors.rateValue) setSanctionErrors((prev) => ({ ...prev, rateValue: undefined }));
                }}
                inputProps={{ 'data-testid': 'sanction.rateValue' }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Select
                fullWidth
                value={sanctionForm.rateType}
                onChange={(e) => setSanctionForm({ ...sanctionForm, rateType: e.target.value as RateType })}
                data-testid="sanction.rateType"
              >
                <MenuItem value="FLOATING">Floating Rate</MenuItem>
                <MenuItem value="FIXED">Fixed Rate</MenuItem>
              </Select>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Sanction Date"
                type="date"
                fullWidth
                InputLabelProps={{ shrink: true }}
                value={sanctionForm.sanctionDate}
                onChange={(e) => setSanctionForm({ ...sanctionForm, sanctionDate: e.target.value })}
                inputProps={{ 'data-testid': 'sanction.date' }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Valid Until"
                type="date"
                fullWidth
                error={Boolean(sanctionErrors.validUntil)}
                helperText={sanctionErrors.validUntil}
                InputLabelProps={{ shrink: true }}
                value={sanctionForm.validUntil}
                onChange={(e) => {
                  setSanctionForm({ ...sanctionForm, validUntil: e.target.value });
                  if (sanctionErrors.validUntil) setSanctionErrors((prev) => ({ ...prev, validUntil: undefined }));
                }}
                inputProps={{ 'data-testid': 'sanction.validUntil' }}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSanctionDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleRecordSanction} data-testid="sanction.save-btn">
            Save Sanction
          </Button>
        </DialogActions>
      </Dialog>

      {/* Record Tranche Dialog */}
      <Dialog open={trancheDialogOpen} onClose={() => setTrancheDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Record Disbursement Tranche</DialogTitle>
        <DialogContent dividers>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <Alert severity="info">
                Remaining permitted limit: ₹{remainingSanctionLimit.toLocaleString('en-IN')}
              </Alert>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Tranche Amount (₹)"
                type="number"
                fullWidth
                required
                error={Boolean(trancheErrors.amount)}
                helperText={trancheErrors.amount}
                value={trancheForm.amount}
                onChange={(e) => {
                  setTrancheForm({ ...trancheForm, amount: Number(e.target.value) });
                  if (trancheErrors.amount) setTrancheErrors((prev) => ({ ...prev, amount: undefined }));
                }}
                inputProps={{ 'data-testid': 'tranche.amount' }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Disbursed Date"
                type="date"
                fullWidth
                InputLabelProps={{ shrink: true }}
                value={trancheForm.disbursedOn}
                onChange={(e) => setTrancheForm({ ...trancheForm, disbursedOn: e.target.value })}
                inputProps={{ 'data-testid': 'tranche.date' }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="UTR Reference"
                fullWidth
                required
                error={Boolean(trancheErrors.utr)}
                helperText={trancheErrors.utr}
                value={trancheForm.utr}
                onChange={(e) => {
                  setTrancheForm({ ...trancheForm, utr: e.target.value });
                  if (trancheErrors.utr) setTrancheErrors((prev) => ({ ...prev, utr: undefined }));
                }}
                inputProps={{ 'data-testid': 'tranche.utr' }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Loan Account Number"
                fullWidth
                required
                error={Boolean(trancheErrors.loanAccountNumber)}
                helperText={trancheErrors.loanAccountNumber}
                value={trancheForm.loanAccountNumber}
                onChange={(e) => {
                  setTrancheForm({ ...trancheForm, loanAccountNumber: e.target.value });
                  if (trancheErrors.loanAccountNumber) setTrancheErrors((prev) => ({ ...prev, loanAccountNumber: undefined }));
                }}
                inputProps={{ 'data-testid': 'tranche.loanAccount' }}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTrancheDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={trancheForm.amount > remainingSanctionLimit}
            onClick={handleRecordTranche}
            data-testid="tranche.save-btn"
          >
            Record Tranche
          </Button>
        </DialogActions>
      </Dialog>

      {/* Verify Tranche Dialog (SOD-04) */}
      <Dialog open={verifyDialogOpen} onClose={() => setVerifyDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Independent Verification (SOD-04)</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ mt: 1 }}>
            <Select
              fullWidth
              value={verifyForm.decision}
              onChange={(e) => setVerifyForm({ ...verifyForm, decision: e.target.value as any })}
            >
              <MenuItem value="VERIFY">VERIFY (Approve Disbursement)</MenuItem>
              <MenuItem value="RETURN">RETURN (Reject / Send Back)</MenuItem>
            </Select>

            {verifyForm.decision === 'RETURN' && (
              <TextField
                label="Return Comment / Reason"
                fullWidth
                multiline
                rows={3}
                sx={{ mt: 2 }}
                value={verifyForm.comment}
                onChange={(e) => setVerifyForm({ ...verifyForm, comment: e.target.value })}
              />
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVerifyDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color={verifyForm.decision === 'VERIFY' ? 'success' : 'error'}
            onClick={handleVerifyTranche}
          >
            Submit Decision
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
