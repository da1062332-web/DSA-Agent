import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
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
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { errorText } from '../../api/client';
import { ConnectorSelect } from '../connectors/ConnectorSelect';
import { hasPermission, useMe } from '../../api/useMe';
import { Can } from '../../shell/Can';
import { ConnectorName, LenderName } from '../../shell/display';
import { fetchLenders } from '../lenders/api';
import type { Lender } from '../lenders/types';
import {
  DataTable,
  PageHeader,
  StatCard,
  StatCardGrid,
  StatusBadge,
  type ColumnDef,
} from '../../ui';
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

  const planColumns: ColumnDef<CommissionPlan>[] = [
    {
      id: 'lender',
      header: 'Lender',
      accessor: (p) => <LenderName id={p.lenderId} typographyProps={{ fontWeight: 600 }} />,
    },
    {
      id: 'qualifyingEvent',
      header: 'Qualifying Event',
      accessor: (p) => p.qualifyingEvent,
    },
    {
      id: 'basis',
      header: 'Basis',
      accessor: (p) => p.basis,
    },
    {
      id: 'rounding',
      header: 'Rounding',
      accessor: (p) => p.roundingMode,
    },
    {
      id: 'clawback',
      header: 'Clawback Window',
      accessor: (p) => `${p.clawbackWindowDays} Days`,
    },
    {
      id: 'ruleSet',
      header: 'Rule Set ID',
      accessor: (p) => p.ruleSetId || 'Default Standard',
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (p) => <StatusBadge status={p.status} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      accessor: (p) => (
        p.status === 'DRAFT' && canApprovePlan ? (
          <Button
            size="small"
            variant="contained"
            color="success"
            disabled={p.createdBy === currentUserId}
            onClick={() => handleApprovePlan(p)}
          >
            Approve (SOD-02)
          </Button>
        ) : null
      ),
    },
  ];

  const calcColumns: ColumnDef<CommissionCalculation>[] = [
    { id: 'id', header: 'Calc ID', accessor: (c) => c.id },
    { id: 'trancheId', header: 'Tranche ID', accessor: (c) => <strong>{c.trancheId}</strong> },
    {
      id: 'lender',
      header: 'Lender',
      accessor: (c) => <LenderName id={c.lenderId} />,
    },
    {
      id: 'basisAmount',
      header: 'Basis Amount (₹)',
      accessor: (c) => `₹${Number(c.basisAmount).toLocaleString('en-IN')}`,
    },
    {
      id: 'rate',
      header: 'Rate',
      accessor: (c) => `${(Number(c.rate) * 100).toFixed(2)}%`,
    },
    {
      id: 'grossAmount',
      header: 'Gross Amount (₹)',
      accessor: (c) => <strong>₹{Number(c.grossAmount).toLocaleString('en-IN')}</strong>,
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (c) => <StatusBadge status={c.status} />,
    },
  ];

  const payableColumns: ColumnDef<CommissionPayable>[] = [
    { id: 'id', header: 'Payable ID', accessor: (p) => p.id },
    {
      id: 'connector',
      header: 'Connector ID',
      accessor: (p) => <ConnectorName id={p.connectorId} typographyProps={{ fontWeight: 600 }} />,
    },
    {
      id: 'shareRate',
      header: 'Share Rate',
      accessor: (p) => `${(Number(p.shareRate) * 100).toFixed(1)}%`,
    },
    {
      id: 'amount',
      header: 'Payable Amount (₹)',
      accessor: (p) => <strong>₹{Number(p.amount).toLocaleString('en-IN')}</strong>,
    },
    {
      id: 'state',
      header: 'State',
      accessor: (p) => <StatusBadge status={p.state} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      accessor: (p) => (
        canCreateClawback && p.state === 'ELIGIBLE' ? (
          <Button size="small" color="warning" onClick={() => handleOpenClawback(p)}>
            Clawback
          </Button>
        ) : null
      ),
    },
  ];

  const proposalColumns: ColumnDef<RecalculationProposal>[] = [
    { id: 'id', header: 'Proposal ID', accessor: (pr) => pr.id },
    { id: 'reason', header: 'Reason', accessor: (pr) => <strong>{pr.reason}</strong> },
    {
      id: 'affected',
      header: 'Affected Calculations',
      accessor: (pr) => pr.affectedCalculationIds.join(', '),
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (pr) => <StatusBadge status={pr.status} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      accessor: (pr) => (
        pr.status === 'PENDING' && canApproveRecalc ? (
          <Button
            size="small"
            variant="contained"
            color="success"
            disabled={pr.createdBy === currentUserId}
            onClick={() => handleApproveRecalc(pr.id)}
          >
            Approve (SOD-07)
          </Button>
        ) : null
      ),
    },
  ];

  return (
    <Container maxWidth={false} disableGutters>
      <PageHeader
        title="Commission Management Hub"
        subtitle="Lender plans, disbursement tranche calculations, splits, and clawbacks"
        actions={
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
        }
      />

      {/* KPI Stat Cards */}
      <StatCardGrid columns={{ xs: 1, sm: 2, md: 4 }} sx={{ mb: 3 }}>
        <StatCard
          title="Commission Plans"
          value={plans.length}
          subtext="Active & draft lender agreements"
        />
        <StatCard
          title="Calculations"
          value={calculations.length}
          subtext="Tranche disbursement calculations"
          colorVariant="primary"
        />
        <StatCard
          title="Connector Payables"
          value={payables.length}
          subtext="Connector revenue shares"
          colorVariant="secondary"
        />
        <StatCard
          title="Recalc Proposals"
          value={proposals.length}
          subtext="Pending audit & adjustments"
          colorVariant="warning"
        />
      </StatCardGrid>

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
          <Tab label="1. Commission Plans" />
          <Tab label="2. Calculations & Connector Payables" />
          <Tab label="3. Recalculation Proposals" />
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
              <DataTable<CommissionPlan>
                columns={planColumns}
                data={plans}
                emptyTitle="No commission plans configured. Add a plan to enable disbursement commission calculations."
              />
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
                <DataTable<CommissionCalculation>
                  columns={calcColumns}
                  data={calculations}
                  emptyTitle="No calculations generated yet. Click &quot;Calculate Commission&quot; above."
                />
              </Card>

              <Card>
                <CardHeader
                  title="Connector Payables Register"
                  subheader="Commission shares attributable to connectors with clawback controls"
                />
                <Divider />
                <DataTable<CommissionPayable>
                  columns={payableColumns}
                  data={payables}
                  emptyTitle="No connector payables registered."
                />
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
              <DataTable<RecalculationProposal>
                columns={proposalColumns}
                data={proposals}
                emptyTitle="No recalculation proposals pending review."
              />
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
