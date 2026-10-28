// apps/web/src/features/sanctions/SanctionsPanel.tsx — owner: Dev 3 (MOD-SND UI)
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
  FormControlLabel,
  Grid,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { DataTable, PageHeader } from '../../ui';
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
  VoidTrancheInput,
} from './types';
import { NotSet } from '../../ui/NotSet';
import { RowAction } from '../../shell/RowAction';

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

  // Dialog visibility states
  const [sanctionDialogOpen, setSanctionDialogOpen] = useState<boolean>(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState<boolean>(false);
  const [trancheDialogOpen, setTrancheDialogOpen] = useState<boolean>(false);
  const [verifyDialogOpen, setVerifyDialogOpen] = useState<boolean>(false);
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState<boolean>(false);
  const [voidDialogOpen, setVoidDialogOpen] = useState<boolean>(false);
  const [selectedTranche, setSelectedTranche] = useState<DisbursementTranche | null>(null);

  // Sanction form
  const [sanctionForm, setSanctionForm] = useState<RecordSanctionInput & { conditionsText?: string }>({
    amount: 1000000,
    tenureMonths: 120,
    rateValue: 8.75,
    rateType: 'FLOATING' as RateType,
    benchmarkText: '',
    feesText: '',
    conditionsText: '',
    sanctionDate: new Date().toISOString().slice(0, 10),
    validUntil: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
    letterDocumentId: '',
  });

  // Cancel form
  const [cancelReason, setCancelReason] = useState<string>('');
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Tranche form
  const [trancheForm, setTrancheForm] = useState<RecordTrancheInput>({
    amount: 500000,
    disbursedOn: new Date().toISOString().slice(0, 10),
    utr: '',
    loanAccountNumber: '',
    evidenceDocumentId: '',
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

  // Exception form
  const [exceptionReason, setExceptionReason] = useState<string>('');
  const [exceptionError, setExceptionError] = useState<string | null>(null);

  // Void form
  const [voidReason, setVoidReason] = useState<string>('');
  const [createReplacement, setCreateReplacement] = useState<boolean>(false);
  const [replacementAmount, setReplacementAmount] = useState<number | ''>('');
  const [replacementDisbursedOn, setReplacementDisbursedOn] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [replacementUtr, setReplacementUtr] = useState<string>('');
  const [replacementLoanAccount, setReplacementLoanAccount] = useState<string>('');
  const [voidError, setVoidError] = useState<string | null>(null);

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
      const conditions = sanctionForm.conditionsText
        ? sanctionForm.conditionsText
            .split('\n')
            .map((c) => c.trim())
            .filter((c) => c.length > 0)
        : [];

      await sanctionsApi.recordSanction(lenderCaseId, {
        amount: Number(sanctionForm.amount),
        tenureMonths: Number(sanctionForm.tenureMonths),
        rateValue: Number(sanctionForm.rateValue),
        rateType: sanctionForm.rateType,
        benchmarkText: sanctionForm.benchmarkText?.trim() || null,
        feesText: sanctionForm.feesText?.trim() || null,
        conditions,
        sanctionDate: sanctionForm.sanctionDate,
        validUntil: sanctionForm.validUntil,
        letterDocumentId: sanctionForm.letterDocumentId?.trim() || null,
      });

      setSanctionDialogOpen(false);
      setSanctionErrors({});
      await fetchSanctions();
    } catch (err: any) {
      setError(err.message ?? 'Failed to record sanction');
    }
  };

  const handleCancelSanction = async () => {
    if (!activeSanction) return;
    if (!cancelReason || cancelReason.trim().length < 3) {
      setCancelError('Cancellation reason must be at least 3 characters.');
      return;
    }
    try {
      setError(null);
      setCancelError(null);
      await sanctionsApi.cancelSanction(activeSanction.id, cancelReason.trim());
      setCancelDialogOpen(false);
      setCancelReason('');
      await fetchSanctions();
    } catch (err: any) {
      setError(err.message ?? 'Failed to cancel sanction');
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
      await sanctionsApi.recordTranche(activeSanction.id, {
        amount: Number(trancheForm.amount),
        disbursedOn: trancheForm.disbursedOn,
        utr: trancheForm.utr?.trim() || null,
        loanAccountNumber: trancheForm.loanAccountNumber?.trim() || null,
        evidenceDocumentId: trancheForm.evidenceDocumentId?.trim() || null,
      });
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

  const handleApproveException = async () => {
    if (!selectedTranche) return;
    if (!exceptionReason || exceptionReason.trim().length < 5) {
      setExceptionError('Exception reason must be at least 5 characters.');
      return;
    }
    try {
      setError(null);
      setExceptionError(null);
      await sanctionsApi.approveException(selectedTranche.id, { reason: exceptionReason.trim() });
      setExceptionDialogOpen(false);
      setExceptionReason('');
      await fetchSanctions();
    } catch (err: any) {
      setError(err.message ?? 'Failed to approve exception');
    }
  };

  const handleVoidTranche = async () => {
    if (!selectedTranche) return;
    if (!voidReason || voidReason.trim().length < 5) {
      setVoidError('Void reason must be at least 5 characters.');
      return;
    }
    try {
      setError(null);
      setVoidError(null);
      const payload: VoidTrancheInput = {
        reason: voidReason.trim(),
        createReplacement,
        replacement: createReplacement && replacementAmount
          ? {
              amount: Number(replacementAmount),
              disbursedOn: replacementDisbursedOn,
              utr: replacementUtr.trim() || null,
              loanAccountNumber: replacementLoanAccount.trim() || null,
            }
          : undefined,
      };
      await sanctionsApi.voidTranche(selectedTranche.id, payload);
      setVoidDialogOpen(false);
      setVoidReason('');
      setCreateReplacement(false);
      await fetchSanctions();
    } catch (err: any) {
      setError(err.message ?? 'Failed to void tranche');
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
            Sanctions and Disbursements
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
      <Box data-testid="sanctions-panel-loading" display="flex" justifyContent="center" p={4}>
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

      <PageHeader
        title="Sanctions & Disbursements"
        subtitle="Lender case credit sanctions, multi-tranche disbursals, UTR tracking, and dual-control verification"
      />

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
                  Version {activeSanction.version} • Sanctioned on {activeSanction.sanctionDate} • Source: {activeSanction.source}
                </Typography>
              )}
            </Box>
            <Box display="flex" alignItems="center" gap={1}>
              {activeSanction && (
                <Chip
                  label={activeSanction.status}
                  color={
                    activeSanction.status === 'ACTIVE'
                      ? 'success'
                      : activeSanction.status === 'REVISED'
                        ? 'info'
                        : activeSanction.status === 'CANCELLED'
                          ? 'error'
                          : 'default'
                  }
                  size="small"
                  sx={{ mr: 1 }}
                />
              )}
              <Can action="sanction.record">
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => {
                      if (activeSanction) {
                        setSanctionForm({
                          amount: activeSanction.amount,
                          tenureMonths: activeSanction.tenureMonths,
                          rateValue: activeSanction.rateValue,
                          rateType: activeSanction.rateType,
                          benchmarkText: activeSanction.benchmarkText ?? '',
                          feesText: activeSanction.feesText ?? '',
                          conditionsText: activeSanction.conditions ? activeSanction.conditions.join('\n') : '',
                          sanctionDate: activeSanction.sanctionDate,
                          validUntil: activeSanction.validUntil,
                          letterDocumentId: activeSanction.letterDocumentId ?? '',
                        });
                      }
                      setSanctionDialogOpen(true);
                    }}
                    data-testid="record-sanction-btn"
                  >
                    {activeSanction ? 'Revise Sanction Terms' : 'Record Sanction'}
                  </Button>
                  {activeSanction && activeSanction.status === 'ACTIVE' && (
                    <Button
                      variant="outlined"
                      color="error"
                      size="small"
                      onClick={() => setCancelDialogOpen(true)}
                      data-testid="cancel-sanction-btn"
                    >
                      Cancel Sanction
                    </Button>
                  )}
                </Stack>
              </Can>
            </Box>
          </Box>

          {activeSanction ? (
            <>
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

              {/* Extra Sanction Details: Benchmark, Fees, Letter Doc */}
              {(activeSanction.benchmarkText || activeSanction.feesText || activeSanction.letterDocumentId || activeSanction.cancelReason) && (
                <Grid container spacing={2} sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
                  {activeSanction.benchmarkText && (
                    <Grid item xs={12} sm={4}>
                      <Typography variant="caption" color="text.secondary">
                        Benchmark Reference
                      </Typography>
                      <Typography variant="body2">{activeSanction.benchmarkText}</Typography>
                    </Grid>
                  )}
                  {activeSanction.feesText && (
                    <Grid item xs={12} sm={4}>
                      <Typography variant="caption" color="text.secondary">
                        Fee Structure
                      </Typography>
                      <Typography variant="body2">{activeSanction.feesText}</Typography>
                    </Grid>
                  )}
                  {activeSanction.letterDocumentId && (
                    <Grid item xs={12} sm={4}>
                      <Typography variant="caption" color="text.secondary">
                        Sanction Letter Document
                      </Typography>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {activeSanction.letterDocumentId}
                      </Typography>
                    </Grid>
                  )}
                  {activeSanction.cancelReason && (
                    <Grid item xs={12}>
                      <Typography variant="caption" color="error.main">
                        Cancellation Reason
                      </Typography>
                      <Typography variant="body2" color="error.dark">
                        {activeSanction.cancelReason}
                      </Typography>
                    </Grid>
                  )}
                </Grid>
              )}

              {/* Sanction Conditions Precedent */}
              {activeSanction.conditions && activeSanction.conditions.length > 0 && (
                <Box sx={{ mt: 2, pt: 1, borderTop: 1, borderColor: 'divider' }}>
                  <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                    Conditions Precedent ({activeSanction.conditions.length})
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {activeSanction.conditions.map((condition, idx) => (
                      <Chip key={idx} label={condition} size="small" variant="outlined" />
                    ))}
                  </Stack>
                </Box>
              )}
            </>
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
                      amount: Math.min(500000, remainingSanctionLimit),
                      disbursedOn: new Date().toISOString().slice(0, 10),
                      utr: '',
                      loanAccountNumber: '',
                      evidenceDocumentId: '',
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
              <DataTable<(typeof tranches)[number]>
                dataTestId="sanctions.table.tranches"
                data={tranches}
                keyExtractor={(t) => t.id}
                columns={[
                  { id: 'no', header: 'Tranche #', render: (t) => `#${t.trancheNo}` },
                  {
                    id: 'amount',
                    header: 'Amount',
                    render: (t) => <Box sx={{ fontWeight: 'bold' }}>₹{t.amount.toLocaleString('en-IN')}</Box>,
                  },
                  { id: 'on', header: 'Disbursed On', render: (t) => t.disbursedOn },
                  {
                    id: 'status',
                    header: 'Status',
                    render: (t) => (
                      <Box>
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
                        {t.exceptionApprovalId && (
                          <Tooltip title={t.verificationComment || 'Evidence exception approved by supervisor'}>
                            <Chip
                              label="Exception Approved"
                              size="small"
                              color="info"
                              variant="outlined"
                              sx={{ ml: 0.5, fontSize: '0.68rem' }}
                            />
                          </Tooltip>
                        )}
                        {t.voidReason && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            Void: {t.voidReason}
                          </Typography>
                        )}
                        {t.replacedByTrancheId && (
                          <Typography variant="caption" color="primary.main" display="block">
                            Replaced by {t.replacedByTrancheId}
                          </Typography>
                        )}
                      </Box>
                    ),
                  },
                  { id: 'utr', header: 'UTR (Masked)', render: (t) => t.utrMasked ?? <NotSet /> },
                  { id: 'loan', header: 'Loan Account', render: (t) => t.loanAccountMasked ?? <NotSet /> },
                  {
                    id: 'evidence',
                    header: 'Evidence Doc',
                    render: (t) =>
                      t.evidenceDocumentId ? (
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                          {t.evidenceDocumentId}
                        </Typography>
                      ) : (
                        <Typography variant="caption" color="warning.main">
                          None (Exception required)
                        </Typography>
                      ),
                  },
                  {
                    id: 'actions',
                    header: 'Actions',
                    align: 'right',
                    render: (t) => {
                      const isRecorder = currentUserId && t.recordedBy === currentUserId;
                      return (
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                          {/* SOD-04 Verification */}
                          <RowAction allowed={t.status === 'RECORDED'} action="disbursement.verify">
                            <Button
                              size="small"
                              variant="outlined"
                              color="primary"
                              disabled={Boolean(isRecorder)}
                              title={isRecorder ? 'Segregation of duties: Creator cannot verify' : 'Verify Tranche'}
                              onClick={() => {
                                setSelectedTranche(t);
                                setVerifyDialogOpen(true);
                              }}
                              data-testid={`verify-tranche-btn-${t.id}`}
                            >
                              {isRecorder ? 'SOD Lock' : 'Verify'}
                            </Button>
                          </RowAction>

                          {/* Exception Approval (for tranches missing evidence document) */}
                          <RowAction
                            allowed={t.status === 'RECORDED' && !t.exceptionApprovalId}
                            action="disbursement.exception_approve"
                          >
                            <Button
                              size="small"
                              variant="outlined"
                              color="warning"
                              onClick={() => {
                                setSelectedTranche(t);
                                setExceptionReason('');
                                setExceptionError(null);
                                setExceptionDialogOpen(true);
                              }}
                              data-testid={`exception-tranche-btn-${t.id}`}
                            >
                              Exception
                            </Button>
                          </RowAction>

                          {/* Void Tranche */}
                          <RowAction
                            allowed={t.status === 'RECORDED' || t.status === 'VERIFIED'}
                            action="disbursement.record"
                          >
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              onClick={() => {
                                setSelectedTranche(t);
                                setVoidReason('');
                                setVoidError(null);
                                setCreateReplacement(false);
                                setReplacementAmount(Number(t.amount));
                                setReplacementDisbursedOn(new Date().toISOString().slice(0, 10));
                                setReplacementUtr('');
                                setReplacementLoanAccount('');
                                setVoidDialogOpen(true);
                              }}
                              data-testid={`void-tranche-btn-${t.id}`}
                            >
                              Void
                            </Button>
                          </RowAction>
                        </Stack>
                      );
                    },
                  },
                ]}
              />
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
                value={sanctionForm.amount || ''}
                onChange={(e) => {
                  const val = e.target.value === '' ? 0 : Math.max(0, Number(e.target.value));
                  setSanctionForm({ ...sanctionForm, amount: val });
                  if (sanctionErrors.amount) setSanctionErrors((prev) => ({ ...prev, amount: undefined }));
                }}
                inputProps={{ min: 0, 'data-testid': 'sanction.amount' }}
                onKeyDown={(e) => {
                  if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault();
                }}
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
                value={sanctionForm.tenureMonths || ''}
                onChange={(e) => {
                  const val = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10));
                  setSanctionForm({ ...sanctionForm, tenureMonths: val });
                  if (sanctionErrors.tenureMonths) setSanctionErrors((prev) => ({ ...prev, tenureMonths: undefined }));
                }}
                inputProps={{ min: 1, 'data-testid': 'sanction.tenureMonths' }}
                onKeyDown={(e) => {
                  if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault();
                }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Interest Rate (% p.a.)"
                type="number"
                fullWidth
                required
                error={Boolean(sanctionErrors.rateValue)}
                helperText={sanctionErrors.rateValue}
                value={sanctionForm.rateValue || ''}
                onChange={(e) => {
                  const val = e.target.value === '' ? 0 : Math.max(0, Number(e.target.value));
                  setSanctionForm({ ...sanctionForm, rateValue: val });
                  if (sanctionErrors.rateValue) setSanctionErrors((prev) => ({ ...prev, rateValue: undefined }));
                }}
                inputProps={{ min: 0, step: 0.01, 'data-testid': 'sanction.rateValue' }}
                onKeyDown={(e) => {
                  if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault();
                }}
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
            <Grid item xs={12} sm={6}>
              <TextField
                label="Benchmark Reference (e.g. Repo + 2.25%)"
                fullWidth
                value={sanctionForm.benchmarkText ?? ''}
                onChange={(e) => setSanctionForm({ ...sanctionForm, benchmarkText: e.target.value })}
                inputProps={{ maxLength: 200, 'data-testid': 'sanction.benchmarkText' }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Fee Structure (e.g. 0.5% + GST)"
                fullWidth
                value={sanctionForm.feesText ?? ''}
                onChange={(e) => setSanctionForm({ ...sanctionForm, feesText: e.target.value })}
                inputProps={{ maxLength: 500, 'data-testid': 'sanction.feesText' }}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Sanction Letter Document ID (from Document Hub)"
                fullWidth
                placeholder="e.g. doc_01JHDFC_SANCTION_LETTER"
                value={sanctionForm.letterDocumentId ?? ''}
                onChange={(e) => setSanctionForm({ ...sanctionForm, letterDocumentId: e.target.value })}
                inputProps={{ 'data-testid': 'sanction.letterDocumentId' }}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Conditions Precedent (one per line)"
                fullWidth
                multiline
                rows={3}
                placeholder="e.g.&#10;Original title deed verification&#10;CIBIL clear score > 750"
                value={sanctionForm.conditionsText ?? ''}
                onChange={(e) => setSanctionForm({ ...sanctionForm, conditionsText: e.target.value })}
                inputProps={{ 'data-testid': 'sanction.conditionsText' }}
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

      {/* Cancel Sanction Dialog */}
      <Dialog open={cancelDialogOpen} onClose={() => setCancelDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Cancel Credit Sanction</DialogTitle>
        <DialogContent dividers>
          {cancelError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {cancelError}
            </Alert>
          )}
          <Typography variant="body2" color="text.secondary" mb={2}>
            Cancelling this sanction will transition the lender case to <strong>SANCTION_CANCELLED</strong>. This action cannot be reversed.
          </Typography>
          <TextField
            label="Cancellation Reason"
            fullWidth
            required
            multiline
            rows={3}
            placeholder="e.g. Borrower selected competing lender with lower interest rate"
            value={cancelReason}
            onChange={(e) => {
              setCancelReason(e.target.value);
              if (cancelError) setCancelError(null);
            }}
            inputProps={{ 'data-testid': 'cancel-sanction-reason' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelDialogOpen(false)}>Dismiss</Button>
          <Button variant="contained" color="error" onClick={handleCancelSanction} data-testid="confirm-cancel-sanction-btn">
            Confirm Cancellation
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
                value={trancheForm.amount || ''}
                onChange={(e) => {
                  const val = e.target.value === '' ? 0 : Math.max(0, Number(e.target.value));
                  setTrancheForm({ ...trancheForm, amount: val });
                  if (trancheErrors.amount) setTrancheErrors((prev) => ({ ...prev, amount: undefined }));
                }}
                inputProps={{ min: 0, 'data-testid': 'tranche.amount' }}
                onKeyDown={(e) => {
                  if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault();
                }}
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
                  if (trancheErrors.loanAccountNumber)
                    setTrancheErrors((prev) => ({ ...prev, loanAccountNumber: undefined }));
                }}
                inputProps={{ 'data-testid': 'tranche.loanAccount' }}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Evidence Document ID (Receipt / Bank Advice)"
                fullWidth
                placeholder="e.g. doc_disbursement_receipt_01"
                helperText="Optional. If omitted, independent verification will require an approved evidence exception."
                value={trancheForm.evidenceDocumentId ?? ''}
                onChange={(e) => setTrancheForm({ ...trancheForm, evidenceDocumentId: e.target.value })}
                inputProps={{ 'data-testid': 'tranche.evidenceDocumentId' }}
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
                required
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

      {/* Approve Exception Dialog */}
      <Dialog open={exceptionDialogOpen} onClose={() => setExceptionDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Approve Evidence Exception</DialogTitle>
        <DialogContent dividers>
          {exceptionError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {exceptionError}
            </Alert>
          )}
          <Typography variant="body2" color="text.secondary" mb={2}>
            Tranche #{selectedTranche?.trancheNo} does not have an attached evidence document. As an authorized supervisor, please provide justification to allow verification:
          </Typography>
          <TextField
            label="Exception Reason / Justification"
            fullWidth
            required
            multiline
            rows={3}
            placeholder="e.g. Bank confirmation verified directly via corporate banking portal"
            value={exceptionReason}
            onChange={(e) => {
              setExceptionReason(e.target.value);
              if (exceptionError) setExceptionError(null);
            }}
            inputProps={{ 'data-testid': 'exception-reason-input' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExceptionDialogOpen(false)}>Dismiss</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={handleApproveException}
            data-testid="confirm-exception-btn"
          >
            Approve Exception
          </Button>
        </DialogActions>
      </Dialog>

      {/* Void Tranche Dialog */}
      <Dialog open={voidDialogOpen} onClose={() => setVoidDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Void Disbursement Tranche #{selectedTranche?.trancheNo}</DialogTitle>
        <DialogContent dividers>
          {voidError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {voidError}
            </Alert>
          )}
          <Typography variant="body2" color="text.secondary" mb={2}>
            Voiding will invalidate this tranche and return its amount back to the remaining sanction limit.
          </Typography>
          <TextField
            label="Void Reason (mandatory)"
            fullWidth
            required
            multiline
            rows={2}
            placeholder="e.g. Erroneous bank account number entered by ops"
            value={voidReason}
            onChange={(e) => {
              setVoidReason(e.target.value);
              if (voidError) setVoidError(null);
            }}
            inputProps={{ 'data-testid': 'void-reason-input' }}
            sx={{ mb: 2 }}
          />

          <FormControlLabel
            control={
              <Checkbox
                checked={createReplacement}
                onChange={(e) => setCreateReplacement(e.target.checked)}
                data-testid="create-replacement-checkbox"
              />
            }
            label="Create immediate replacement tranche with corrected details"
          />

          {createReplacement && (
            <Grid container spacing={2} sx={{ mt: 1, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Replacement Amount (₹)"
                  type="number"
                  fullWidth
                  value={replacementAmount}
                  onChange={(e) => setReplacementAmount(e.target.value === '' ? '' : Number(e.target.value))}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Disbursed Date"
                  type="date"
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  value={replacementDisbursedOn}
                  onChange={(e) => setReplacementDisbursedOn(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Corrected UTR Reference"
                  fullWidth
                  value={replacementUtr}
                  onChange={(e) => setReplacementUtr(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Corrected Loan Account"
                  fullWidth
                  value={replacementLoanAccount}
                  onChange={(e) => setReplacementLoanAccount(e.target.value)}
                />
              </Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVoidDialogOpen(false)}>Dismiss</Button>
          <Button variant="contained" color="error" onClick={handleVoidTranche} data-testid="confirm-void-btn">
            Void Tranche
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
