import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
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
import { ConnectorSelect } from '../connectors/ConnectorSelect';
import { hasPermission, useMe } from '../../api/useMe';
import { Can } from '../../shell/Can';
import { ConnectorName } from '../../shell/display';
import { fetchLenders } from '../lenders/api';
import type { Lender } from '../lenders/types';
import {
  approveCommissionPlan,
  approveRecalculationProposal,
  calculateCommission,
  createClawback,
  createCommissionPlan,
  createRecalculationProposal,
  fetchCalculations,
  fetchCommissionPlans,
  fetchPayables,
  fetchRecalculationProposals,
} from './api';
import type {
  CalculateCommissionInput,
  CommissionBasis,
  CommissionCalculation,
  CommissionPayable,
  CommissionPlan,
  CreateClawbackInput,
  CreateCommissionPlanInput,
  CreateRecalculationProposalInput,
  QualifyingEvent,
  RecalculationProposal,
  RoundingMode,
} from './types';

export function CommissionDashboardPage() {
  const me = useMe();
  const currentUserId = me.data?.id;

  const canEditPlan = hasPermission(me.data, 'commission.plan.edit');
  const canApprovePlan = hasPermission(me.data, 'commission.plan.approve');
  const canCreateClawback = hasPermission(me.data, 'adjustment.create');
  const canApproveRecalc = hasPermission(me.data, 'adjustment.approve');

  const [activeTab, setActiveTab] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Data states
  const [plans, setPlans] = useState<CommissionPlan[]>([]);
  const [calculations, setCalculations] = useState<CommissionCalculation[]>([]);
  const [payables, setPayables] = useState<CommissionPayable[]>([]);
  const [lenders, setLenders] = useState<Lender[]>([]);

  // Create Plan Dialog
  const [createPlanOpen, setCreatePlanOpen] = useState<boolean>(false);
  const [planLenderId, setPlanLenderId] = useState<string>('');
  const [planQualifyingEvent, setPlanQualifyingEvent] = useState<QualifyingEvent>('DISBURSEMENT');
  const [planBasis, setPlanBasis] = useState<CommissionBasis>('DISBURSED_AMOUNT');
  const [planRoundingMode, setPlanRoundingMode] = useState<RoundingMode>('HALF_UP');
  const [planClawbackDays, setPlanClawbackDays] = useState<number>(90);
  const [planRuleSetId, setPlanRuleSetId] = useState<string>('');
  const [savingPlan, setSavingPlan] = useState<boolean>(false);
  const [planError, setPlanError] = useState<string | null>(null);

  // Calculate Commission Dialog
  const [calcDialogOpen, setCalcDialogOpen] = useState<boolean>(false);
  const [calcLenderId, setCalcLenderId] = useState<string>('');
  const [calcTrancheId, setCalcTrancheId] = useState<string>('');
  const [calcBasisAmount, setCalcBasisAmount] = useState<string>('5000000.00');
  const [calcRate, setCalcRate] = useState<number>(0.015);
  const [calcConnectorId, setCalcConnectorId] = useState<string>('con_001');
  const [calcConnectorShare, setCalcConnectorShare] = useState<number>(0.7);
  const [calculating, setCalculating] = useState<boolean>(false);
  const [calcError, setCalcError] = useState<string | null>(null);

  // Record Clawback Dialog
  const [clawbackDialogOpen, setClawbackDialogOpen] = useState<boolean>(false);
  const [selectedPayable, setSelectedPayable] = useState<CommissionPayable | null>(null);
  const [clawbackAmount, setClawbackAmount] = useState<string>('');
  const [clawbackReason, setClawbackReason] = useState<string>('Early loan foreclosure within 90 days');
  const [clawbackEvidence, setClawbackEvidence] = useState<string>('lender_clawback_notice_2026.pdf');
  const [savingClawback, setSavingClawback] = useState<boolean>(false);
  const [clawbackError, setClawbackError] = useState<string | null>(null);

  // Recalculation Proposal Dialog
  const [recalcDialogOpen, setRecalcDialogOpen] = useState<boolean>(false);
  const [recalcReason, setRecalcReason] = useState<string>('Quarterly rate revision adjustment');
  const [recalcCalcIds, setRecalcCalcIds] = useState<string>('');
  const [savingRecalc, setSavingRecalc] = useState<boolean>(false);
  const [recalcError, setRecalcError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<RecalculationProposal[]>([]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [plansRes, calcsRes, payRes, lendRes, propsRes] = await Promise.all([
        fetchCommissionPlans({ limit: 50 }),
        fetchCalculations({ limit: 50 }),
        fetchPayables({ limit: 50 }),
        fetchLenders({ limit: 100 }),
        fetchRecalculationProposals(),
      ]);
      setPlans(plansRes.data);
      setCalculations(calcsRes.data);
      setPayables(payRes.data);
      setLenders(lendRes.data);
      setProposals(propsRes.data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planLenderId) {
      setPlanError('Please select a lender.');
      return;
    }
    try {
      setSavingPlan(true);
      setPlanError(null);
      const input: CreateCommissionPlanInput = {
        lenderId: planLenderId,
        qualifyingEvent: planQualifyingEvent,
        basis: planBasis,
        roundingMode: planRoundingMode,
        clawbackWindowDays: planClawbackDays,
        ruleSetId: planRuleSetId.trim() || undefined,
      };
      await createCommissionPlan(input);
      setSuccessMsg('Commission plan created in DRAFT. Pending maker-checker approval (SOD-02).');
      setCreatePlanOpen(false);
      await loadData();
    } catch (err) {
      setPlanError(errorText(err));
    } finally {
      setSavingPlan(false);
    }
  };

  const handleApprovePlan = async (plan: CommissionPlan) => {
    if (plan.createdBy === currentUserId) {
      setError('Maker-Checker Violation (SOD-02): Plan creator cannot approve their own commission plan.');
      return;
    }
    try {
      setError(null);
      await approveCommissionPlan(plan.id, plan.lockVersion);
      setSuccessMsg(`Commission plan ${plan.id} approved and marked ACTIVE.`);
      await loadData();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const handleCalculateCommission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!calcLenderId || !calcTrancheId.trim()) {
      setCalcError('Lender and Tranche ID are required.');
      return;
    }
    try {
      setCalculating(true);
      setCalcError(null);
      const input: CalculateCommissionInput = {
        lenderId: calcLenderId,
        trancheId: calcTrancheId.trim(),
        basisAmount: calcBasisAmount.trim(),
        customRate: calcRate,
        connectorId: calcConnectorId.trim() || undefined,
        connectorShareRate: calcConnectorShare,
      };
      const res = await calculateCommission(input);
      setSuccessMsg(
        `Calculated ₹${res.calculation.grossAmount} commission (Payable: ₹${res.payable?.amount ?? '0.00'}).`,
      );
      setCalcDialogOpen(false);
      setCalcTrancheId('');
      await loadData();
    } catch (err) {
      setCalcError(errorText(err));
    } finally {
      setCalculating(false);
    }
  };

  const handleOpenClawback = (payable: CommissionPayable) => {
    setSelectedPayable(payable);
    setClawbackAmount(payable.amount);
    setClawbackError(null);
    setClawbackDialogOpen(true);
  };

  const handleSaveClawback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPayable) return;
    try {
      setSavingClawback(true);
      setClawbackError(null);
      const input: CreateClawbackInput = {
        calculationId: selectedPayable.calculationId,
        payableId: selectedPayable.id,
        amount: clawbackAmount.trim(),
        reason: clawbackReason.trim(),
        evidenceRef: clawbackEvidence.trim() || undefined,
      };
      await createClawback(input);
      setSuccessMsg(`Clawback registered for payable ${selectedPayable.id}. Payable placed ON_HOLD.`);
      setClawbackDialogOpen(false);
      await loadData();
    } catch (err) {
      setClawbackError(errorText(err));
    } finally {
      setSavingClawback(false);
    }
  };

  const handleCreateRecalc = async (e: React.FormEvent) => {
    e.preventDefault();
    const ids = recalcCalcIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      setRecalcError('Please specify at least one affected calculation ID.');
      return;
    }
    try {
      setSavingRecalc(true);
      setRecalcError(null);
      const input: CreateRecalculationProposalInput = {
        reason: recalcReason.trim(),
        affectedCalculationIds: ids,
      };
      const prop = await createRecalculationProposal(input);
      setProposals([prop, ...proposals]);
      setSuccessMsg(`Recalculation proposal ${prop.id} submitted for checker approval (SOD-07).`);
      setRecalcDialogOpen(false);
    } catch (err) {
      setRecalcError(errorText(err));
    } finally {
      setSavingRecalc(false);
    }
  };

  const handleApproveRecalc = async (propId: string) => {
    try {
      setError(null);
      const res = await approveRecalculationProposal(propId);
      setSuccessMsg(`Proposal approved: ${res.supersededCalculationsCount} calculation(s) superseded.`);
      await loadData();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const getPayableChipColor = (state: string) => {
    switch (state) {
      case 'ELIGIBLE':
        return 'success';
      case 'ON_HOLD':
        return 'warning';
      case 'IN_PAYOUT':
        return 'info';
      case 'PAID':
        return 'primary';
      case 'REVERSED':
        return 'error';
      default:
        return 'default';
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Commission Management Hub
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Module 29 / 30 Part A — Lender plans, disbursement tranche calculations, splits, and clawbacks
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          {canEditPlan && activeTab === 0 && (
            <Button
              variant="contained"
              onClick={() => {
                setPlanError(null);
                setCreatePlanOpen(true);
              }}
            >
              Add Commission Plan
            </Button>
          )}
          {activeTab === 1 && (
            <Can action="commission.calculate">
              <Button
                variant="contained"
                onClick={() => {
                  setCalcError(null);
                  setCalcDialogOpen(true);
                }}
              >
                Calculate Commission
              </Button>
            </Can>
          )}
          {activeTab === 2 && canEditPlan && (
            <Button
              variant="contained"
              onClick={() => {
                setRecalcError(null);
                setRecalcDialogOpen(true);
              }}
            >
              New Recalculation Proposal
            </Button>
          )}
        </Stack>
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
          <Tab label="1. Commission Plans (CMP-COM.01.1)" />
          <Tab label="2. Calculations & Connector Payables (CMP-COM.02.1)" />
          <Tab label="3. Recalculation Proposals (CMP-COM.05.1)" />
        </Tabs>
      </Paper>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          {/* TAB 1: Commission Plans */}
          {activeTab === 0 && (
            <Card>
              <CardHeader
                title="Lender Commission Plans"
                subheader="One ACTIVE plan per lender with maker-checker governance (SOD-02)"
              />
              <Divider />
              <TableContainer>
                {plans.length === 0 ? (
                  <Box sx={{ p: 4, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                      No commission plans configured. Add a plan to enable disbursement commission
                      calculations.
                    </Typography>
                  </Box>
                ) : (
                  <Table>
                    <TableHead sx={{ bgcolor: 'grey.50' }}>
                      <TableRow>
                        <TableCell>
                          <strong>Lender ID</strong>
                        </TableCell>
                        <TableCell>
                          <strong>Qualifying Event</strong>
                        </TableCell>
                        <TableCell>
                          <strong>Basis</strong>
                        </TableCell>
                        <TableCell>
                          <strong>Rounding</strong>
                        </TableCell>
                        <TableCell>
                          <strong>Clawback Window</strong>
                        </TableCell>
                        <TableCell>
                          <strong>Rule Set ID</strong>
                        </TableCell>
                        <TableCell>
                          <strong>Status</strong>
                        </TableCell>
                        <TableCell align="right">
                          <strong>Actions</strong>
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {plans.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>
                            <strong>{lenders.find((l) => l.id === p.lenderId)?.name || p.lenderId}</strong>
                          </TableCell>
                          <TableCell>{p.qualifyingEvent}</TableCell>
                          <TableCell>{p.basis}</TableCell>
                          <TableCell>{p.roundingMode}</TableCell>
                          <TableCell>{p.clawbackWindowDays} Days</TableCell>
                          <TableCell>{p.ruleSetId || 'Default Standard'}</TableCell>
                          <TableCell>
                            <Chip
                              label={p.status}
                              size="small"
                              color={p.status === 'ACTIVE' ? 'success' : 'default'}
                            />
                          </TableCell>
                          <TableCell align="right">
                            {p.status === 'DRAFT' && canApprovePlan && (
                              <Button
                                size="small"
                                variant="contained"
                                color="success"
                                disabled={p.createdBy === currentUserId}
                                onClick={() => handleApprovePlan(p)}
                              >
                                Approve (SOD-02)
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TableContainer>
            </Card>
          )}

          {/* TAB 2: Calculations & Payables */}
          {activeTab === 1 && (
            <Stack spacing={4}>
              <Card>
                <CardHeader
                  title="Earned Commission Calculations"
                  subheader="Immutable calculation snapshots per disbursement tranche"
                />
                <Divider />
                <TableContainer>
                  {calculations.length === 0 ? (
                    <Box sx={{ p: 3, textAlign: 'center' }}>
                      <Typography variant="body2" color="text.secondary">
                        No calculations generated yet. Click "Calculate Commission" above.
                      </Typography>
                    </Box>
                  ) : (
                    <Table>
                      <TableHead sx={{ bgcolor: 'grey.50' }}>
                        <TableRow>
                          <TableCell>
                            <strong>Calc ID</strong>
                          </TableCell>
                          <TableCell>
                            <strong>Tranche ID</strong>
                          </TableCell>
                          <TableCell>
                            <strong>Lender</strong>
                          </TableCell>
                          <TableCell>
                            <strong>Basis Amount (₹)</strong>
                          </TableCell>
                          <TableCell>
                            <strong>Rate</strong>
                          </TableCell>
                          <TableCell>
                            <strong>Gross Amount (₹)</strong>
                          </TableCell>
                          <TableCell>
                            <strong>Status</strong>
                          </TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {calculations.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell>{c.id}</TableCell>
                            <TableCell>
                              <strong>{c.trancheId}</strong>
                            </TableCell>
                            <TableCell>
                              {lenders.find((l) => l.id === c.lenderId)?.name || c.lenderId}
                            </TableCell>
                            <TableCell>₹{Number(c.basisAmount).toLocaleString('en-IN')}</TableCell>
                            <TableCell>{(Number(c.rate) * 100).toFixed(2)}%</TableCell>
                            <TableCell>
                              <strong>₹{Number(c.grossAmount).toLocaleString('en-IN')}</strong>
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={c.status}
                                size="small"
                                color={c.status === 'EARNED' ? 'success' : 'default'}
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </TableContainer>
              </Card>

              <Card>
                <CardHeader
                  title="Connector Payables Register"
                  subheader="Commission shares attributable to connectors with clawback controls"
                />
                <Divider />
                <TableContainer>
                  {payables.length === 0 ? (
                    <Box sx={{ p: 3, textAlign: 'center' }}>
                      <Typography variant="body2" color="text.secondary">
                        No connector payables registered.
                      </Typography>
                    </Box>
                  ) : (
                    <Table>
                      <TableHead sx={{ bgcolor: 'grey.50' }}>
                        <TableRow>
                          <TableCell>
                            <strong>Payable ID</strong>
                          </TableCell>
                          <TableCell>
                            <strong>Connector ID</strong>
                          </TableCell>
                          <TableCell>
                            <strong>Share Rate</strong>
                          </TableCell>
                          <TableCell>
                            <strong>Payable Amount (₹)</strong>
                          </TableCell>
                          <TableCell>
                            <strong>State</strong>
                          </TableCell>
                          <TableCell align="right">
                            <strong>Actions</strong>
                          </TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {payables.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell>{p.id}</TableCell>
                            <TableCell>
                              <ConnectorName id={p.connectorId} typographyProps={{ fontWeight: 600 }} />
                            </TableCell>
                            <TableCell>{(Number(p.shareRate) * 100).toFixed(1)}%</TableCell>
                            <TableCell>
                              <strong>₹{Number(p.amount).toLocaleString('en-IN')}</strong>
                            </TableCell>
                            <TableCell>
                              <Chip label={p.state} size="small" color={getPayableChipColor(p.state)} />
                            </TableCell>
                            <TableCell align="right">
                              {canCreateClawback && p.state === 'ELIGIBLE' && (
                                <Button size="small" color="warning" onClick={() => handleOpenClawback(p)}>
                                  Clawback
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </TableContainer>
              </Card>
            </Stack>
          )}

          {/* TAB 3: Recalculation Proposals */}
          {activeTab === 2 && (
            <Card>
              <CardHeader
                title="Commission Recalculation Proposals"
                subheader="Maker-checker approval for superseding historical calculations (SOD-07)"
              />
              <Divider />
              <TableContainer>
                {proposals.length === 0 ? (
                  <Box sx={{ p: 4, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                      No recalculation proposals pending review.
                    </Typography>
                  </Box>
                ) : (
                  <Table>
                    <TableHead sx={{ bgcolor: 'grey.50' }}>
                      <TableRow>
                        <TableCell>
                          <strong>Proposal ID</strong>
                        </TableCell>
                        <TableCell>
                          <strong>Reason</strong>
                        </TableCell>
                        <TableCell>
                          <strong>Affected Calculations</strong>
                        </TableCell>
                        <TableCell>
                          <strong>Status</strong>
                        </TableCell>
                        <TableCell align="right">
                          <strong>Actions</strong>
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {proposals.map((pr) => (
                        <TableRow key={pr.id}>
                          <TableCell>{pr.id}</TableCell>
                          <TableCell>
                            <strong>{pr.reason}</strong>
                          </TableCell>
                          <TableCell>{pr.affectedCalculationIds.join(', ')}</TableCell>
                          <TableCell>
                            <Chip
                              label={pr.status}
                              size="small"
                              color={pr.status === 'APPROVED' ? 'success' : 'warning'}
                            />
                          </TableCell>
                          <TableCell align="right">
                            {pr.status === 'PENDING' && canApproveRecalc && (
                              <Button
                                size="small"
                                variant="contained"
                                color="success"
                                disabled={pr.createdBy === currentUserId}
                                onClick={() => handleApproveRecalc(pr.id)}
                              >
                                Approve (SOD-07)
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TableContainer>
            </Card>
          )}
        </>
      )}

      {/* Create Commission Plan Modal */}
      <Dialog open={createPlanOpen} onClose={() => setCreatePlanOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleCreatePlan}>
          <DialogTitle>Create Commission Plan</DialogTitle>
          <DialogContent>
            {planError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {planError}
              </Alert>
            )}
            <Stack spacing={2} sx={{ mt: 1 }}>
              <FormControl fullWidth required>
                <InputLabel>Lender</InputLabel>
                <Select value={planLenderId} label="Lender" onChange={(e) => setPlanLenderId(e.target.value)}>
                  {lenders.map((l) => (
                    <MenuItem key={l.id} value={l.id}>
                      {l.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel>Qualifying Event</InputLabel>
                <Select
                  value={planQualifyingEvent}
                  label="Qualifying Event"
                  onChange={(e) => setPlanQualifyingEvent(e.target.value as QualifyingEvent)}
                >
                  <MenuItem value="DISBURSEMENT">Disbursement (Standard)</MenuItem>
                  <MenuItem value="SANCTION">Loan Sanction</MenuItem>
                  <MenuItem value="FIRST_EMI">First EMI Paid</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel>Calculation Basis</InputLabel>
                <Select
                  value={planBasis}
                  label="Calculation Basis"
                  onChange={(e) => setPlanBasis(e.target.value as CommissionBasis)}
                >
                  <MenuItem value="DISBURSED_AMOUNT">Disbursed Amount (Standard)</MenuItem>
                  <MenuItem value="SANCTION_AMOUNT">Sanctioned Loan Amount</MenuItem>
                  <MenuItem value="NET_LOAN">Net Loan Amount</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel>Rounding Mode</InputLabel>
                <Select
                  value={planRoundingMode}
                  label="Rounding Mode"
                  onChange={(e) => setPlanRoundingMode(e.target.value as RoundingMode)}
                >
                  <MenuItem value="HALF_UP">Half Up (Financial Standard)</MenuItem>
                  <MenuItem value="FLOOR">Floor (Round Down)</MenuItem>
                  <MenuItem value="CEIL">Ceiling (Round Up)</MenuItem>
                </Select>
              </FormControl>
              <TextField
                fullWidth
                type="number"
                label="Clawback Window (Days)"
                value={planClawbackDays}
                onChange={(e) => setPlanClawbackDays(Math.max(0, Number(e.target.value)))}
                inputProps={{ min: 0 }}
                onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }}
              />
              <TextField
                fullWidth
                label="Rule Set ID (DK-commission.calculate)"
                placeholder="rs_comm_standard_01"
                value={planRuleSetId}
                onChange={(e) => setPlanRuleSetId(e.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreatePlanOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={savingPlan}>
              {savingPlan ? <CircularProgress size={24} /> : 'Create Plan'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Calculate Commission Modal */}
      <Dialog open={calcDialogOpen} onClose={() => setCalcDialogOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleCalculateCommission}>
          <DialogTitle>Calculate Disbursement Commission</DialogTitle>
          <DialogContent>
            {calcError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {calcError}
              </Alert>
            )}
            <Stack spacing={2} sx={{ mt: 1 }}>
              <FormControl fullWidth required>
                <InputLabel>Lender</InputLabel>
                <Select value={calcLenderId} label="Lender" onChange={(e) => setCalcLenderId(e.target.value)}>
                  {lenders.map((l) => (
                    <MenuItem key={l.id} value={l.id}>
                      {l.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                required
                fullWidth
                label="Disbursement Tranche ID"
                placeholder="tranche_disb_001"
                value={calcTrancheId}
                onChange={(e) => setCalcTrancheId(e.target.value)}
              />
              <TextField
                required
                fullWidth
                label="Disbursement Basis Amount (₹)"
                value={calcBasisAmount}
                onChange={(e) => setCalcBasisAmount(e.target.value)}
              />
              <TextField
                required
                fullWidth
                type="number"
                inputProps={{ min: 0, step: 0.001 }}
                label="Commission Rate (e.g. 0.015 for 1.5%)"
                value={calcRate}
                onChange={(e) => setCalcRate(Math.max(0, Number(e.target.value)))}
                onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }}
              />
              <ConnectorSelect
                label="Attributed Connector"
                placeholder="Optional: select sourcing partner..."
                value={calcConnectorId || null}
                onChange={(id) => setCalcConnectorId(id ?? '')}
                helperText="Select the partner earning referral commission split"
              />
              <TextField
                fullWidth
                type="number"
                inputProps={{ min: 0, max: 1, step: 0.05 }}
                label="Connector Share Rate (e.g. 0.70 for 70%)"
                value={calcConnectorShare}
                onChange={(e) => setCalcConnectorShare(Math.max(0, Number(e.target.value)))}
                onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCalcDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={calculating}>
              {calculating ? <CircularProgress size={24} /> : 'Execute Calculation'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Record Clawback Modal */}
      <Dialog open={clawbackDialogOpen} onClose={() => setClawbackDialogOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleSaveClawback}>
          <DialogTitle>Record Lender Clawback</DialogTitle>
          <DialogContent>
            {clawbackError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {clawbackError}
              </Alert>
            )}
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                required
                fullWidth
                label="Clawback Amount (₹)"
                value={clawbackAmount}
                onChange={(e) => setClawbackAmount(e.target.value)}
              />
              <TextField
                required
                fullWidth
                label="Reason"
                value={clawbackReason}
                onChange={(e) => setClawbackReason(e.target.value)}
              />
              <TextField
                fullWidth
                label="Evidence Reference"
                value={clawbackEvidence}
                onChange={(e) => setClawbackEvidence(e.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setClawbackDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" color="warning" disabled={savingClawback}>
              {savingClawback ? <CircularProgress size={24} /> : 'Confirm Clawback'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Recalculation Proposal Modal */}
      <Dialog open={recalcDialogOpen} onClose={() => setRecalcDialogOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleCreateRecalc}>
          <DialogTitle>New Recalculation Proposal</DialogTitle>
          <DialogContent>
            {recalcError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {recalcError}
              </Alert>
            )}
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                required
                fullWidth
                label="Reason for Recalculation"
                value={recalcReason}
                onChange={(e) => setRecalcReason(e.target.value)}
              />
              <TextField
                required
                fullWidth
                label="Affected Calculation IDs (comma-separated)"
                placeholder="ccal_01, ccal_02"
                value={recalcCalcIds}
                onChange={(e) => setRecalcCalcIds(e.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRecalcDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={savingRecalc}>
              {savingRecalc ? <CircularProgress size={24} /> : 'Submit Proposal'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Container>
  );
}
