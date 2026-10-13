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
  Divider,
  Grid,
  MenuItem,
  Select,
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
  lenderCaseId: string;
  currentUserId?: string;
}

export const SanctionsPanel: React.FC<SanctionsPanelProps> = ({ lenderCaseId, currentUserId }) => {
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
    letterDocumentId: '',
  });

  // Tranche form
  const [trancheForm, setTrancheForm] = useState<RecordTrancheInput>({
    amount: 500000,
    disbursedOn: new Date().toISOString().slice(0, 10),
    utr: '',
    loanAccountNumber: '',
    evidenceDocumentId: '',
  });

  // Verify form
  const [verifyForm, setVerifyForm] = useState<VerifyTrancheInput>({
    decision: 'VERIFY',
    comment: '',
  });

  const activeSanction = sanctions.find((s) => s.status === 'ACTIVE') ?? sanctions[sanctions.length - 1];

  const fetchSanctions = async () => {
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
    try {
      setError(null);
      await sanctionsApi.recordSanction(lenderCaseId, sanctionForm);
      setSanctionDialogOpen(false);
      await fetchSanctions();
    } catch (err: any) {
      setError(err.message ?? 'Failed to record sanction');
    }
  };

  const handleRecordTranche = async () => {
    if (!activeSanction) return;
    try {
      setError(null);
      await sanctionsApi.recordTranche(activeSanction.id, trancheForm);
      setTrancheDialogOpen(false);
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
              <Button
                variant="contained"
                size="small"
                onClick={() => setSanctionDialogOpen(true)}
                data-testid="record-sanction-btn"
              >
                {activeSanction ? 'Revise Sanction Terms' : 'Record Sanction'}
              </Button>
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
                              <Button
                                size="small"
                                variant="outlined"
                                color="primary"
                                disabled={Boolean(isRecorder)}
                                title={
                                  isRecorder ? 'Segregation of duties: Creator cannot verify' : 'Verify Tranche'
                                }
                                onClick={() => {
                                  setSelectedTranche(t);
                                  setVerifyDialogOpen(true);
                                }}
                                data-testid={`verify-tranche-btn-${t.id}`}
                              >
                                {isRecorder ? 'SOD Lock' : 'Verify'}
                              </Button>
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
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Sanction Amount (₹)"
                type="number"
                fullWidth
                value={sanctionForm.amount}
                onChange={(e) => setSanctionForm({ ...sanctionForm, amount: Number(e.target.value) })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Tenure (Months)"
                type="number"
                fullWidth
                value={sanctionForm.tenureMonths}
                onChange={(e) => setSanctionForm({ ...sanctionForm, tenureMonths: Number(e.target.value) })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Interest Rate (%)"
                type="number"
                fullWidth
                value={sanctionForm.rateValue}
                onChange={(e) => setSanctionForm({ ...sanctionForm, rateValue: Number(e.target.value) })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Select
                fullWidth
                value={sanctionForm.rateType}
                onChange={(e) => setSanctionForm({ ...sanctionForm, rateType: e.target.value as RateType })}
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
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Valid Until"
                type="date"
                fullWidth
                InputLabelProps={{ shrink: true }}
                value={sanctionForm.validUntil}
                onChange={(e) => setSanctionForm({ ...sanctionForm, validUntil: e.target.value })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSanctionDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleRecordSanction}>
            Save Sanction
          </Button>
        </DialogActions>
      </Dialog>

      {/* Record Tranche Dialog */}
      <Dialog open={trancheDialogOpen} onClose={() => setTrancheDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Record Disbursement Tranche</DialogTitle>
        <DialogContent dividers>
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
                value={trancheForm.amount}
                onChange={(e) => setTrancheForm({ ...trancheForm, amount: Number(e.target.value) })}
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
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="UTR Reference"
                fullWidth
                value={trancheForm.utr}
                onChange={(e) => setTrancheForm({ ...trancheForm, utr: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Loan Account Number"
                fullWidth
                value={trancheForm.loanAccountNumber}
                onChange={(e) => setTrancheForm({ ...trancheForm, loanAccountNumber: e.target.value })}
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
