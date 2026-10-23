// apps/web/src/features/reconciliation/ReconciliationDashboardPage.tsx
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  Tooltip,
  Typography,
} from '@mui/material';
import { errorText } from '../../api/client';
import { hasPermission, useMe } from '../../api/useMe';
import { Can } from '../../shell/Can';
import { LenderSelect } from '../../shell/selectors';
import { LenderName } from '../../shell/display';
import { useLookup } from '../admin/api';
import { ConnectorSelect } from '../connectors/ConnectorSelect';
import { DataTable, PageHeader, StatCard, StatCardGrid } from '../../ui';
import {
  approveAdjustment,
  autoIngestBankFeed,
  createDispute,
  fetchAdjustments,
  fetchDisputes,
  fetchLenderStatements,
  fetchReconciliationExceptions,
  importLenderStatement,
  proposeAdjustment,
  reconcilePayoutWithBank,
  resolveException,
  runCommissionMatching,
  updateDispute,
} from './api';
import type {
  Adjustment,
  Dispute,
  LenderStatement,
  LenderStatementLine,
  ReconciliationException,
  ReconciliationMatch,
} from './types';

export function ReconciliationDashboardPage() {
  const { data: me, isLoading: meLoading } = useMe();
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(
    null,
  );

  // Data states
  const [statements, setStatements] = useState<LenderStatement[]>([]);
  const [selectedStatement, setSelectedStatement] = useState<LenderStatement | null>(null);
  const [exceptions, setExceptions] = useState<ReconciliationException[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [matches, setMatches] = useState<ReconciliationMatch[]>([]);

  // Dialog states
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [linesDrawerOpen, setLinesDrawerOpen] = useState(false);
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [selectedException, setSelectedException] = useState<ReconciliationException | null>(null);
  const [adjustmentDialogOpen, setAdjustmentDialogOpen] = useState(false);
  const [disputeDialogOpen, setDisputeDialogOpen] = useState(false);
  const [updateDisputeDialogOpen, setUpdateDisputeDialogOpen] = useState(false);
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);

  // Import Statement Form
  const [importFormat, setImportFormat] = useState<'MT940' | 'CSV'>('MT940');
  // Forms start empty: statements, references and amounts come from the user, never from fixtures (synthetic data only, no
  // S3-class values such as loan or bank account numbers and UTRs, CLAUDE.md data protection).
  const [importLenderId, setImportLenderId] = useState('');
  const [importPeriod, setImportPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [importBatchId, setImportBatchId] = useState(`batch_${Date.now()}`);
  const [importCsvText, setImportCsvText] = useState('');
  const [importMt940Text, setImportMt940Text] = useState('');

  // Resolve Exception Form
  const [resolveStatus, setResolveStatus] = useState<'RESOLVED' | 'WRITTEN_OFF' | 'INVESTIGATING'>(
    'RESOLVED',
  );
  const [resolveNote, setResolveNote] = useState('');
  const [resolveEvidence, setResolveEvidence] = useState('');

  // Propose Adjustment Form
  const [adjType, setAdjType] = useState<'WRITE_OFF' | 'CLAWBACK' | 'CORRECTION' | 'TAX'>('CORRECTION');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjCalcId, setAdjCalcId] = useState('');
  const [adjPayableId, setAdjPayableId] = useState('');

  // Dispute Form
  const [dispPartyType, setDispPartyType] = useState<'LENDER' | 'CONNECTOR'>('LENDER');
  const [dispPartyId, setDispPartyId] = useState('');
  const [dispSubjectType, setDispSubjectType] = useState<'STATEMENT_LINE' | 'PAYOUT' | 'CALCULATION'>(
    'STATEMENT_LINE',
  );
  const [dispSubjectId, setDispSubjectId] = useState('');
  const [dispReason, setDispReason] = useState('');
  const [dispHoldPayables, setDispHoldPayables] = useState('');

  // Update Dispute Form
  const [updateDispStatus, setUpdateDispStatus] = useState('RESOLVED');
  const [updateDispResolution, setUpdateDispResolution] = useState('');
  const [updateDispReleaseHolds, setUpdateDispReleaseHolds] = useState(true);

  // Bank Settlement Form
  const [bankPayoutId, setBankPayoutId] = useState('');
  const [bankRef, setBankRef] = useState('');
  const [bankAmount, setBankAmount] = useState('');
  const [bankDate, setBankDate] = useState(() => new Date().toISOString().slice(0, 10));
  const lenders = useLookup<{ id: string; name: string }>('/v1/lenders');

  // Permissions
  const canReconcile = hasPermission(me, 'finance.reconcile');
  const canDispute = hasPermission(me, 'finance.dispute');
  const canCreateAdj = hasPermission(me, 'adjustment.create');
  const canApproveAdj = hasPermission(me, 'adjustment.approve');

  const loadData = async () => {
    setLoading(true);
    try {
      const [stmtRes, excRes, adjRes, dispRes] = await Promise.all([
        fetchLenderStatements(),
        fetchReconciliationExceptions(),
        fetchAdjustments(),
        fetchDisputes(),
      ]);
      setStatements(stmtRes.items || []);
      setExceptions(excRes.items || []);
      setAdjustments(adjRes.items || []);
      setDisputes(dispRes.items || []);
    } catch (err) {
      setFeedback({ type: 'error', message: errorText(err) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleImportSubmit = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const rows = importCsvText.trim().split('\n').filter(Boolean);
      // Every column is required: a row with a missing or non-numeric value is refused, never filled in.
      const bad = rows.findIndex((r) => {
        const [loanAccount, customerName, disbursed, comm, tax, paidOn] = r.split(',').map((x) => x.trim());
        return (
          !loanAccount ||
          !customerName ||
          !(Number(disbursed) > 0) ||
          !(Number(comm) >= 0) ||
          comm === '' ||
          !(Number(tax) >= 0) ||
          tax === '' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(paidOn ?? '')
        );
      });
      if (rows.length === 0 || bad >= 0) {
        setFeedback({
          message:
            rows.length === 0
              ? 'Paste the statement lines to import.'
              : `Line ${bad + 1} is incomplete: every line needs LoanAccount, CustomerName, DisbursedAmount, CommissionAmount, TaxDeducted and PaidOn (YYYY-MM-DD).`,
          type: 'error',
        });
        setLoading(false);
        return;
      }
      const lines = rows.map((r, i) => {
        const [loanAccount, customerName, disbursed, comm, tax, paidOn] = r.split(',').map((x) => x.trim());
        return {
          loanAccount: loanAccount!,
          customerName: customerName!,
          disbursedAmount: Number(disbursed),
          commissionAmount: Number(comm),
          taxDeducted: Number(tax),
          paidOn: paidOn!,
          rawRowRef: `csv_row_${i + 1}`,
        };
      });

      // The sha256 of the statement as pasted, so the same file imported twice is recognised.
      const encoder = new TextEncoder();
      const data = encoder.encode(importCsvText);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const fileSha256 = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

      const res = await importLenderStatement({
        lenderId: importLenderId,
        period: importPeriod,
        sourceFileKey: `statements/${importLenderId}_${importPeriod}.csv`,
        importBatchId: importBatchId,
        fileSha256,
        lines,
      });

      setFeedback({
        type: 'success',
        message: `Statement imported successfully! ID: ${res.id} (${lines.length} lines parsed, S2 masked & hashed).`,
      });
      setImportDialogOpen(false);
      loadData();
    } catch (err) {
      setFeedback({ type: 'error', message: errorText(err) });
    } finally {
      setLoading(false);
    }
  };

  const handleAutoIngestSubmit = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const feedContent = importFormat === 'MT940' ? importMt940Text : importCsvText;
      const res = await autoIngestBankFeed({
        lenderId: importLenderId,
        period: importPeriod,
        format: importFormat,
        rawFeedContent: feedContent,
        filename: `${importLenderId}_${importPeriod}.${importFormat.toLowerCase()}`,
      });
      setFeedback({
        type: 'success',
        message: `${res.message} (Net Commission: ₹${res.netCommission.toLocaleString('en-IN')}, Hash: ${res.fileSha256.slice(0, 16)}...)`,
      });
      setImportDialogOpen(false);
      loadData();
    } catch (err) {
      setFeedback({ type: 'error', message: errorText(err) });
    } finally {
      setLoading(false);
    }
  };

  const handleRunMatching = async (statementId: string) => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await runCommissionMatching(statementId);
      setMatches(res.matches);
      setFeedback({
        type: 'success',
        message: `Commission matching executed! Matched: ${res.matchedCount}, Variances: ${res.varianceCount}, Unmatched: ${res.unmatchedCount}.`,
      });
      loadData();
    } catch (err) {
      setFeedback({ type: 'error', message: errorText(err) });
    } finally {
      setLoading(false);
    }
  };

  const handleResolveException = async () => {
    if (!selectedException) return;
    setLoading(true);
    setFeedback(null);
    try {
      await resolveException(selectedException.id, {
        status: resolveStatus,
        resolutionNote: resolveNote,
        evidenceRef: resolveEvidence || undefined,
      });
      setFeedback({ type: 'success', message: `Exception ${selectedException.id} resolved!` });
      setResolveDialogOpen(false);
      loadData();
    } catch (err) {
      setFeedback({ type: 'error', message: errorText(err) });
    } finally {
      setLoading(false);
    }
  };

  const handleProposeAdjustment = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await proposeAdjustment({
        type: adjType,
        amount: Number(adjAmount),
        reason: adjReason,
        calculationId: adjCalcId || undefined,
        payableId: adjPayableId || undefined,
      });
      setFeedback({
        type: 'success',
        message: `Adjustment proposed! ID: ${res.id}. Awaiting SOD-07 approval.`,
      });
      setAdjustmentDialogOpen(false);
      loadData();
    } catch (err) {
      setFeedback({ type: 'error', message: errorText(err) });
    } finally {
      setLoading(false);
    }
  };

  const handleApproveAdjustment = async (adj: Adjustment, approved: boolean) => {
    setLoading(true);
    setFeedback(null);
    try {
      await approveAdjustment(adj.id, { approved });
      setFeedback({
        type: 'success',
        message: `Adjustment ${adj.id} ${approved ? 'APPROVED' : 'REJECTED'} successfully under SOD-07!`,
      });
      loadData();
    } catch (err) {
      setFeedback({ type: 'error', message: errorText(err) });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDispute = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const payableIds = dispHoldPayables
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await createDispute({
        partyType: dispPartyType,
        partyId: dispPartyId,
        subjectType: dispSubjectType,
        subjectId: dispSubjectId,
        reason: dispReason,
        payableIds: payableIds.length > 0 ? payableIds : undefined,
      });
      setFeedback({
        type: 'success',
        message: `Dispute ${res.id} created! Associated payables atomically placed ON_HOLD.`,
      });
      setDisputeDialogOpen(false);
      loadData();
    } catch (err) {
      setFeedback({ type: 'error', message: errorText(err) });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateDispute = async () => {
    if (!selectedDispute) return;
    setLoading(true);
    setFeedback(null);
    try {
      await updateDispute(selectedDispute.id, selectedDispute.lockVersion, {
        status: updateDispStatus,
        resolution: updateDispResolution,
        releaseHolds: updateDispReleaseHolds,
      });
      setFeedback({
        type: 'success',
        message: `Dispute ${selectedDispute.id} updated with optimistic lock!`,
      });
      setUpdateDisputeDialogOpen(false);
      loadData();
    } catch (err) {
      setFeedback({ type: 'error', message: errorText(err) });
    } finally {
      setLoading(false);
    }
  };

  const handleBankReconcile = async () => {
    if (!bankPayoutId) {
      setFeedback({
        type: 'error',
        message: 'Payout Request ID required for bank settlement reconciliation.',
      });
      return;
    }
    setLoading(true);
    setFeedback(null);
    try {
      const res = await reconcilePayoutWithBank(bankPayoutId, {
        bankReference: bankRef,
        paidAmount: Number(bankAmount),
        settlementDate: bankDate,
      });
      setFeedback({
        type: 'success',
        message: `Payout ${res.payoutId} settled and transitioned to RECONCILED! Bank Ref: ${res.bankReference}.`,
      });
      loadData();
    } catch (err) {
      setFeedback({ type: 'error', message: errorText(err) });
    } finally {
      setLoading(false);
    }
  };

  // Metrics
  const totalStatements = statements.length;
  const openExceptions = exceptions.filter((e) => e.status === 'OPEN').length;
  const openDisputes = disputes.filter((d) => d.status === 'OPEN' || d.status === 'UNDER_REVIEW').length;
  const pendingAdjustments = adjustments.filter((a) => a.status === 'PENDING').length;

  return (
    <Container maxWidth="xl" sx={{ py: 4 }} data-testid="rec.dashboard">
      <PageHeader
        title="Reconciliation Management"
        subtitle="Domain DOM-K Finance Squad · Statement Ingestion, Commission Matching, Variance Resolution & Settlement"
        actions={
          <Stack direction="row" spacing={2}>
            <Can action="finance.reconcile">
              <Button
                variant="contained"
                color="primary"
                onClick={() => setImportDialogOpen(true)}
                data-testid="rec.btn.import-modal"
                sx={{ px: 3, fontWeight: 600, borderRadius: 2 }}
              >
                + Ingest Lender Statement
              </Button>
            </Can>
            <Can action="finance.reconcile">
              <Button
                variant="outlined"
                color="secondary"
                onClick={() => setAdjustmentDialogOpen(true)}
                data-testid="rec.btn.propose-adj-modal"
                sx={{ fontWeight: 600, borderRadius: 2 }}
              >
                Propose Adjustment
              </Button>
            </Can>
            <Can action="finance.reconcile">
              <Button
                variant="outlined"
                color="warning"
                onClick={() => setDisputeDialogOpen(true)}
                data-testid="rec.btn.raise-dispute-modal"
                sx={{ fontWeight: 600, borderRadius: 2 }}
              >
                Raise Dispute
              </Button>
            </Can>
          </Stack>
        }
      />

      {/* Feedback banner */}
      {feedback && (
        <Alert
          severity={feedback.type}
          onClose={() => setFeedback(null)}
          sx={{ mb: 3, borderRadius: 2 }}
          data-testid="rec.feedback"
        >
          {feedback.message}
        </Alert>
      )}

      {/* KPI Cards */}
      <StatCardGrid columns={{ xs: 12, sm: 6, md: 3 }}>
        <StatCard
          title="Lender Statements"
          value={totalStatements}
          format="number"
          status="primary"
          subtext="Ingested with SHA-256 integrity"
        />
        <StatCard
          title="Open Exceptions"
          value={openExceptions}
          format="number"
          status="error"
          subtext="Variances requiring resolution"
        />
        <StatCard
          title="Active Disputes"
          value={openDisputes}
          format="number"
          status="warning"
          subtext="Payables placed ON_HOLD"
        />
        <StatCard
          title="Pending Adjustments"
          value={pendingAdjustments}
          format="number"
          status="info"
          subtext="Enforcing SOD-07 Maker-Checker"
        />
      </StatCardGrid>

      {/* Tabs */}
      <Paper sx={{ borderRadius: 3, overflow: 'hidden', mb: 4, boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
        <Tabs
          value={activeTab}
          onChange={(_, val) => setActiveTab(val)}
          indicatorColor="primary"
          textColor="primary"
          variant="scrollable"
          scrollButtons="auto"
          sx={{ borderBottom: 1, borderColor: 'divider', px: 2, bgcolor: 'background.paper' }}
        >
          <Tab label="Lender Statements (SUB-REC.01)" data-testid="rec.tab.statements" />
          <Tab label="Commission Matches (SUB-REC.02)" data-testid="rec.tab.matches" />
          <Tab label="Exceptions Workbench (SUB-REC.03)" data-testid="rec.tab.exceptions" />
          <Tab label="Adjustments & SOD-07 (SUB-REC.03)" data-testid="rec.tab.adjustments" />
          <Tab label="Disputes & Holds (SUB-REC.04)" data-testid="rec.tab.disputes" />
          <Tab label="Bank Settlement (SUB-REC.05)" data-testid="rec.tab.settlement" />
        </Tabs>

        {/* Tab 0: Lender Statements */}
        {activeTab === 0 && (
          <Box sx={{ p: 3 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Typography variant="h6" fontWeight={600}>
                Imported Lender Commission Statements
              </Typography>
              <Button
                size="small"
                onClick={loadData}
                disabled={loading}
                data-testid="rec.btn.refresh-statements"
              >
                Refresh
              </Button>
            </Stack>
            <DataTable<LenderStatement>
              dataTestId="rec.table.statements"
              data={statements}
              keyExtractor={(stmt) => stmt.id}
              emptyMessage='No lender commission statements imported yet. Click "+ Ingest Lender Statement" to import.'
              columns={[
                { id: 'id', header: 'Statement ID', render: (stmt) => <Box sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{stmt.id}</Box> },
                { id: 'lender', header: 'Lender ID', render: (stmt) => <LenderName id={stmt.lenderId} typographyProps={{ fontWeight: 500 }} /> },
                { id: 'period', header: 'Period', render: (stmt) => <Chip label={stmt.period} size="small" variant="outlined" /> },
                { id: 'lines', header: 'Lines', render: (stmt) => stmt.totals?.lineCount ?? 0 },
                { id: 'disbursed', header: 'Disbursed Total (₹)', render: (stmt) => `₹${stmt.totals?.totalDisbursed?.toLocaleString() ?? 0}` },
                {
                  id: 'net',
                  header: 'Net Commission (₹)',
                  render: (stmt) => (
                    <Box sx={{ fontWeight: 600, color: 'primary.main' }}>
                      ₹{stmt.totals?.netCommission?.toLocaleString() ?? 0}
                    </Box>
                  ),
                },
                {
                  id: 'status',
                  header: 'Status',
                  render: (stmt) => (
                    <Chip
                      label={stmt.status}
                      size="small"
                      color={stmt.status === 'MATCHED' ? 'success' : stmt.status === 'PARTIALLY_MATCHED' ? 'warning' : 'default'}
                    />
                  ),
                },
                {
                  id: 'actions',
                  header: 'Actions',
                  render: (stmt) => (
                    <Stack direction="row" spacing={1}>
                      <Can action="finance.reconcile">
                        <Button
                          size="small"
                          variant="contained"
                          color="primary"
                          onClick={() => handleRunMatching(stmt.id)}
                          disabled={loading}
                          data-testid={`rec.btn.match-${stmt.id}`}
                        >
                          Run Match
                        </Button>
                      </Can>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => {
                          setSelectedStatement(stmt);
                          setLinesDrawerOpen(true);
                        }}
                      >
                        View Lines
                      </Button>
                    </Stack>
                  ),
                },
              ]}
            />
          </Box>
        )}

        {/* Tab 1: Commission Matches */}
        {activeTab === 1 && (
          <Box sx={{ p: 3 }}>
            <Alert severity="info" sx={{ mb: 3 }}>
              <strong>SUB-REC.02 Active Match Protection:</strong> Only one active match is permitted per
              statement line. Deterministic reconciliation matching runs through rules evaluation with audit
              trails.
            </Alert>
            <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
              Reconciliation Matches ({matches.length})
            </Typography>
            <DataTable<ReconciliationMatch>
              dataTestId="rec.table.matches"
              data={matches}
              emptyMessage='No matches generated in current session. Select a statement and click "Run Match" to trigger.'
              columns={[
                { id: 'id', header: 'Match ID', render: (m) => <Box sx={{ fontFamily: 'monospace' }}>{m.id}</Box> },
                { id: 'line', header: 'Statement Line ID', render: (m) => <Box sx={{ fontFamily: 'monospace' }}>{m.statementLineId}</Box> },
                { id: 'calc', header: 'Calculation ID', render: (m) => <Box sx={{ fontFamily: 'monospace' }}>{m.calculationId}</Box> },
                {
                  id: 'type',
                  header: 'Match Type',
                  render: (m) => <Chip label={m.matchType} size="small" color={m.matchType === 'EXACT' ? 'success' : 'warning'} />,
                },
                { id: 'amount', header: 'Matched Amount (₹)', render: (m) => <Box sx={{ fontWeight: 600 }}>₹{m.matchedAmount?.toLocaleString()}</Box> },
                {
                  id: 'decision',
                  header: 'Decision Record ID',
                  render: (m) => <Box sx={{ fontFamily: 'monospace', fontSize: 12 }}>{m.decisionRecordId || 'N/A'}</Box>,
                },
                { id: 'status', header: 'Status', render: (m) => <Chip label={m.status} size="small" color="success" /> },
              ]}
            />
          </Box>
        )}

        {/* Tab 2: Exceptions Workbench */}
        {activeTab === 2 && (
          <Box sx={{ p: 3 }}>
            <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
              Reconciliation Exceptions ({exceptions.length})
            </Typography>
            <DataTable<ReconciliationException>
              dataTestId="rec.table.exceptions"
              data={exceptions}
              emptyMessage="No reconciliation exceptions found. All processed lines match within 0 variance."
              columns={[
                { id: 'id', header: 'Exception ID', render: (exc) => <Box sx={{ fontFamily: 'monospace' }}>{exc.id}</Box> },
                {
                  id: 'classification',
                  header: 'Classification',
                  render: (exc) => (
                    <Chip
                      label={exc.classification}
                      size="small"
                      color={
                        exc.classification === 'SHORT_REMITTANCE'
                          ? 'error'
                          : exc.classification === 'OVER_REMITTANCE'
                            ? 'info'
                            : 'warning'
                      }
                    />
                  ),
                },
                {
                  id: 'variance',
                  header: 'Variance Amount (₹)',
                  render: (exc) => <Box sx={{ fontWeight: 600, color: 'error.main' }}>₹{exc.varianceAmount?.toLocaleString()}</Box>,
                },
                {
                  id: 'status',
                  header: 'Status',
                  render: (exc) => (
                    <Chip label={exc.status} size="small" color={exc.status === 'RESOLVED' ? 'success' : 'default'} />
                  ),
                },
                {
                  id: 'note',
                  header: 'Evidence / Note',
                  render: (exc) => <Box sx={{ fontSize: 13 }}>{exc.resolutionNote || exc.evidenceRef || 'None'}</Box>,
                },
                {
                  id: 'created',
                  header: 'Created At',
                  render: (exc) => <Box sx={{ fontSize: 12 }}>{new Date(exc.createdAt).toLocaleDateString()}</Box>,
                },
                {
                  id: 'action',
                  header: 'Action',
                  render: (exc) =>
                    exc.status !== 'RESOLVED' && exc.status !== 'WRITTEN_OFF' ? (
                      <Can action="finance.reconcile">
                        <Button
                          size="small"
                          variant="outlined"
                          color="primary"
                          onClick={() => {
                            setSelectedException(exc);
                            setResolveDialogOpen(true);
                          }}
                          data-testid={`rec.btn.resolve-${exc.id}`}
                        >
                          Resolve
                        </Button>
                      </Can>
                    ) : null,
                },
              ]}
            />
          </Box>
        )}

        {/* Tab 3: Adjustments & SOD-07 */}
        {activeTab === 3 && (
          <Box sx={{ p: 3 }}>
            <Alert severity="warning" sx={{ mb: 3 }}>
              <strong>SOD-07 Maker-Checker Enforcement:</strong> The creator of an adjustment proposal cannot
              approve it. Approval requires <code>adjustment.approve</code> held by Commission Approver or DSA
              Owner.
            </Alert>
            <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
              Financial Adjustments ({adjustments.length})
            </Typography>
            <DataTable<Adjustment>
              dataTestId="rec.table.adjustments"
              data={adjustments}
              emptyMessage='No financial adjustments recorded. Click "Propose Adjustment" above.'
              columns={[
                { id: 'id', header: 'Adjustment ID', render: (adj) => <Box sx={{ fontFamily: 'monospace' }}>{adj.id}</Box> },
                {
                  id: 'type',
                  header: 'Type',
                  render: (adj) => (
                    <Chip
                      label={adj.type || adj.adjustmentType}
                      size="small"
                      color={adj.type === 'CLAWBACK' ? 'error' : adj.type === 'WRITE_OFF' ? 'warning' : 'primary'}
                    />
                  ),
                },
                { id: 'amount', header: 'Amount (₹)', render: (adj) => <Box sx={{ fontWeight: 600 }}>₹{Number(adj.amount).toLocaleString()}</Box> },
                { id: 'reason', header: 'Reason', render: (adj) => <Box sx={{ fontSize: 13 }}>{adj.reason}</Box> },
                {
                  id: 'status',
                  header: 'Status',
                  render: (adj) => (
                    <Chip
                      label={adj.status}
                      size="small"
                      color={adj.status === 'APPROVED' ? 'success' : adj.status === 'REJECTED' ? 'error' : 'default'}
                    />
                  ),
                },
                {
                  id: 'createdBy',
                  header: 'Created By',
                  render: (adj) => <Box sx={{ fontSize: 12, fontFamily: 'monospace' }}>{adj.createdBy}</Box>,
                },
                {
                  id: 'approvedBy',
                  header: 'Approved By',
                  render: (adj) => (
                    <Box sx={{ fontSize: 12, fontFamily: 'monospace' }}>{adj.approvedBy || 'Pending'}</Box>
                  ),
                },
                {
                  id: 'sod07',
                  header: 'SOD-07 Action',
                  render: (adj) => {
                    const isCreator = adj.createdBy === me?.id;
                    if (adj.status !== 'PENDING') return null;
                    return (
                      <Stack direction="row" spacing={1}>
                        <Tooltip
                          title={
                            isCreator
                              ? 'SOD-07 Violation: You created this adjustment and cannot approve it.'
                              : 'Approve adjustment'
                          }
                        >
                          <span>
                            <Button
                              size="small"
                              variant="contained"
                              color="success"
                              disabled={isCreator || !canApproveAdj || loading}
                              onClick={() => handleApproveAdjustment(adj, true)}
                              data-testid={`rec.btn.adj-approve-${adj.id}`}
                            >
                              Approve
                            </Button>
                          </span>
                        </Tooltip>
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          disabled={isCreator || !canApproveAdj || loading}
                          onClick={() => handleApproveAdjustment(adj, false)}
                          data-testid={`rec.btn.adj-reject-${adj.id}`}
                        >
                          Reject
                        </Button>
                      </Stack>
                    );
                  },
                },
              ]}
            />
          </Box>
        )}

        {/* Tab 4: Disputes & Holds */}
        {activeTab === 4 && (
          <Box sx={{ p: 3 }}>
            <Alert severity="info" sx={{ mb: 3 }}>
              <strong>SUB-REC.04 Dispute Invariant:</strong> An open dispute places associated commission
              payables atomically on <code>ON_HOLD</code> to prevent premature payment processing.
            </Alert>
            <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
              Lender & Connector Disputes ({disputes.length})
            </Typography>
            <DataTable<Dispute>
              dataTestId="rec.table.disputes"
              data={disputes}
              emptyMessage='No disputes raised. Click "Raise Dispute" to initiate.'
              columns={[
                { id: 'id', header: 'Dispute ID', render: (disp) => <Box sx={{ fontFamily: 'monospace' }}>{disp.id}</Box> },
                {
                  id: 'partyType',
                  header: 'Party Type',
                  render: (disp) => (
                    <Chip label={disp.partyType} size="small" color={disp.partyType === 'LENDER' ? 'secondary' : 'primary'} />
                  ),
                },
                { id: 'partyId', header: 'Party ID', render: (disp) => disp.partyId },
                {
                  id: 'subject',
                  header: 'Subject',
                  render: (disp) => <Box sx={{ fontSize: 13 }}>{disp.subjectType}: {disp.subjectId}</Box>,
                },
                { id: 'reason', header: 'Reason', render: (disp) => <Box sx={{ fontSize: 13 }}>{disp.reason}</Box> },
                {
                  id: 'status',
                  header: 'Status',
                  render: (disp) => (
                    <Chip
                      label={disp.status}
                      size="small"
                      color={disp.status === 'RESOLVED' ? 'success' : disp.status === 'OPEN' ? 'warning' : 'default'}
                    />
                  ),
                },
                { id: 'lock', header: 'Lock Version', render: (disp) => disp.lockVersion },
                {
                  id: 'action',
                  header: 'Action',
                  render: (disp) =>
                    disp.status !== 'RESOLVED' ? (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => {
                          setSelectedDispute(disp);
                          setUpdateDisputeDialogOpen(true);
                        }}
                        data-testid={`rec.btn.dispute-update-${disp.id}`}
                      >
                        Resolve Dispute
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Box>
        )}

        {/* Tab 5: Bank Settlement (SUB-REC.05) */}
        {activeTab === 5 && (
          <Box sx={{ p: 4 }}>
            <Grid container spacing={4} justifyContent="center">
              <Grid item xs={12} md={8}>
                <Card sx={{ borderRadius: 3, p: 3, boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
                  <Typography variant="h6" fontWeight={700} sx={{ mb: 1, color: 'primary.main' }}>
                    SUB-REC.05: Payout Bank Settlement Reconciliation
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Reconciles recorded connector payout requests against imported bank settlement records.
                    Verifies bank UTR references and settlement amounts, transitioning payout status to
                    RECONCILED.
                  </Typography>
                  <Stack spacing={3}>
                    <TextField
                      label="Payout Request ID"
                      placeholder="prq_01J..."
                      value={bankPayoutId}
                      onChange={(e) => setBankPayoutId(e.target.value)}
                      fullWidth
                      required
                      data-testid="rec.input.payout-id"
                    />
                    <TextField
                      label="Bank Reference Number (UTR / Ref)"
                      value={bankRef}
                      onChange={(e) => setBankRef(e.target.value)}
                      fullWidth
                      required
                      data-testid="rec.input.bank-ref"
                    />
                    <Grid container spacing={2}>
                      <Grid item xs={6}>
                        <TextField
                          label="Settled Amount (₹)"
                          type="number"
                          value={bankAmount}
                          onChange={(e) => setBankAmount(e.target.value)}
                          fullWidth
                          required
                          data-testid="rec.input.bank-amount"
                        />
                      </Grid>
                      <Grid item xs={6}>
                        <TextField
                          label="Settlement Date"
                          type="date"
                          value={bankDate}
                          onChange={(e) => setBankDate(e.target.value)}
                          fullWidth
                          required
                          InputLabelProps={{ shrink: true }}
                          data-testid="rec.input.bank-date"
                        />
                      </Grid>
                    </Grid>
                    <Button
                      variant="contained"
                      color="primary"
                      size="large"
                      onClick={handleBankReconcile}
                      disabled={loading || !canReconcile}
                      data-testid="rec.btn.settle-payout"
                      sx={{ py: 1.5, fontWeight: 700, borderRadius: 2 }}
                    >
                      {loading ? <CircularProgress size={24} /> : 'Reconcile Payout with Bank Statement'}
                    </Button>
                  </Stack>
                </Card>
              </Grid>
            </Grid>
          </Box>
        )}
      </Paper>

      {/* MODAL 1: Ingest Lender Statement */}
      <Dialog open={importDialogOpen} onClose={() => setImportDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle fontWeight={700}>
          Automated Bank Statement Ingestion Engine (SUB-REC.01 / TASK-418)
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            <Alert severity="info">
              Automated Bank Feed Parser: Supports standard SWIFT MT940 electronic statements and automated
              CSV feeds. Statement lines undergo privacy protection: loan accounts are HMAC SHA-256 hashed and
              customer names are masked.
            </Alert>
            <Grid container spacing={2}>
              <Grid item xs={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Feed Format</InputLabel>
                  <Select
                    value={importFormat}
                    label="Feed Format"
                    onChange={(e) => setImportFormat(e.target.value as 'MT940' | 'CSV')}
                  >
                    <MenuItem value="MT940">SWIFT MT940 Feed</MenuItem>
                    <MenuItem value="CSV">Bank CSV Feed</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={3}>
                <TextField
                  select
                  size="small"
                  label="Lender"
                  value={importLenderId}
                  onChange={(e) => setImportLenderId(e.target.value)}
                  fullWidth
                  required
                >
                  {(lenders.data ?? []).map((l) => (
                    <MenuItem key={l.id} value={l.id}>
                      {l.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={3}>
                <TextField
                  size="small"
                  label="Period (YYYY-MM)"
                  value={importPeriod}
                  onChange={(e) => setImportPeriod(e.target.value)}
                  fullWidth
                  required
                />
              </Grid>
              <Grid item xs={3}>
                <TextField
                  size="small"
                  label="Batch ID"
                  value={importBatchId}
                  onChange={(e) => setImportBatchId(e.target.value)}
                  fullWidth
                  required
                />
              </Grid>
            </Grid>

            {importFormat === 'MT940' ? (
              <>
                <Typography variant="subtitle2" fontWeight={600}>
                  SWIFT MT940 Raw Electronic Feed Content (:20:, :25:, :61: statement line, :86: narration)
                </Typography>
                <TextField
                  multiline
                  rows={8}
                  value={importMt940Text}
                  onChange={(e) => setImportMt940Text(e.target.value)}
                  fullWidth
                  placeholder="Paste the lender's MT940 statement"
                  data-testid="rec.input.mt940"
                  sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
              </>
            ) : (
              <>
                <Typography variant="subtitle2" fontWeight={600}>
                  Bank CSV Statement Feed (LoanAccount, CustomerName, DisbursedAmount, CommissionAmount,
                  TaxDeducted, PaidOn)
                </Typography>
                <TextField
                  multiline
                  rows={8}
                  value={importCsvText}
                  onChange={(e) => setImportCsvText(e.target.value)}
                  fullWidth
                  placeholder="One line per loan: LoanAccount,CustomerName,DisbursedAmount,CommissionAmount,TaxDeducted,PaidOn"
                  data-testid="rec.input.csv"
                  sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setImportDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleAutoIngestSubmit}
            disabled={loading || !canReconcile}
            data-testid="rec.btn.auto-ingest"
          >
            {loading ? <CircularProgress size={24} /> : `Run Automated ${importFormat} Ingestion`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* MODAL 2: Resolve Exception */}
      <Dialog open={resolveDialogOpen} onClose={() => setResolveDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle fontWeight={700}>Resolve Reconciliation Exception</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary">
              Exception ID: <strong>{selectedException?.id}</strong> | Variance: ₹
              {selectedException?.varianceAmount?.toLocaleString()}
            </Typography>
            <FormControl fullWidth>
              <InputLabel>Resolution Status</InputLabel>
              <Select
                value={resolveStatus}
                label="Resolution Status"
                onChange={(e) => setResolveStatus(e.target.value as any)}
              >
                <MenuItem value="RESOLVED">RESOLVED (Variance Accepted / Corrected)</MenuItem>
                <MenuItem value="WRITTEN_OFF">WRITTEN_OFF (Immaterial Variance)</MenuItem>
                <MenuItem value="INVESTIGATING">INVESTIGATING (Under Audit Review)</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Resolution Note"
              multiline
              rows={3}
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              fullWidth
              required
              placeholder="State verified calculation or lender credit note agreement..."
            />
            <TextField
              label="Evidence Reference (URL / Pack ID)"
              value={resolveEvidence}
              onChange={(e) => setResolveEvidence(e.target.value)}
              fullWidth
              placeholder="docs/lender_email_ref_921.pdf"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setResolveDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleResolveException}
            disabled={loading || resolveNote.length < 5}
            data-testid="rec.btn.resolve-submit"
          >
            Confirm Resolution
          </Button>
        </DialogActions>
      </Dialog>

      {/* MODAL 3: Propose Adjustment */}
      <Dialog
        open={adjustmentDialogOpen}
        onClose={() => setAdjustmentDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle fontWeight={700}>Propose Financial Adjustment (SUB-REC.03)</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            <FormControl fullWidth>
              <InputLabel>Adjustment Type</InputLabel>
              <Select
                value={adjType}
                label="Adjustment Type"
                onChange={(e) => setAdjType(e.target.value as any)}
              >
                <MenuItem value="CORRECTION">CORRECTION (Calculation Rectification)</MenuItem>
                <MenuItem value="CLAWBACK">CLAWBACK (Pre-settlement Cancellation)</MenuItem>
                <MenuItem value="WRITE_OFF">WRITE_OFF (Unrecoverable Remittance)</MenuItem>
                <MenuItem value="TAX">TAX (TDS Reconciliation Difference)</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Adjustment Amount (₹)"
              type="number"
              value={adjAmount}
              onChange={(e) => setAdjAmount(e.target.value)}
              fullWidth
              required
            />
            <TextField
              label="Adjustment Reason"
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
              fullWidth
              required
              multiline
              rows={2}
            />
            <TextField
              label="Linked Commission Calculation ID (Optional)"
              value={adjCalcId}
              onChange={(e) => setAdjCalcId(e.target.value)}
              fullWidth
              placeholder="ccal_01J..."
            />
            <TextField
              label="Linked Commission Payable ID (Optional)"
              value={adjPayableId}
              onChange={(e) => setAdjPayableId(e.target.value)}
              fullWidth
              placeholder="cpay_01J..."
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setAdjustmentDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleProposeAdjustment}
            disabled={loading || !canCreateAdj}
            data-testid="rec.btn.propose-adj-submit"
          >
            Submit Proposal
          </Button>
        </DialogActions>
      </Dialog>

      {/* MODAL 4: Raise Dispute */}
      <Dialog open={disputeDialogOpen} onClose={() => setDisputeDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle fontWeight={700}>Raise Financial Dispute (SUB-REC.04)</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <FormControl fullWidth>
                  <InputLabel>Party Type</InputLabel>
                  <Select
                    value={dispPartyType}
                    label="Party Type"
                    onChange={(e) => {
                      setDispPartyType(e.target.value as 'LENDER' | 'CONNECTOR');
                      setDispPartyId('');
                    }}
                  >
                    <MenuItem value="LENDER">LENDER</MenuItem>
                    <MenuItem value="CONNECTOR">CONNECTOR</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={6}>
                {dispPartyType === 'LENDER' ? (
                  <TextField
                    select
                    label="Lender"
                    value={dispPartyId}
                    onChange={(e) => setDispPartyId(e.target.value)}
                    fullWidth
                    required
                  >
                    {(lenders.data ?? []).map((l) => (
                      <MenuItem key={l.id} value={l.id}>
                        {l.name}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : (
                  <ConnectorSelect
                    label="Connector / Partner"
                    placeholder="Search or select connector..."
                    value={dispPartyId || null}
                    onChange={(id) => setDispPartyId(id ?? '')}
                    required
                  />
                )}
              </Grid>
            </Grid>
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <FormControl fullWidth>
                  <InputLabel>Subject Type</InputLabel>
                  <Select
                    value={dispSubjectType}
                    label="Subject Type"
                    onChange={(e) => setDispSubjectType(e.target.value as any)}
                  >
                    <MenuItem value="STATEMENT_LINE">STATEMENT_LINE</MenuItem>
                    <MenuItem value="PAYOUT">PAYOUT</MenuItem>
                    <MenuItem value="CALCULATION">CALCULATION</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={6}>
                <TextField
                  label="Subject ID"
                  value={dispSubjectId}
                  onChange={(e) => setDispSubjectId(e.target.value)}
                  fullWidth
                  required
                />
              </Grid>
            </Grid>
            <TextField
              label="Dispute Reason"
              multiline
              rows={3}
              value={dispReason}
              onChange={(e) => setDispReason(e.target.value)}
              fullWidth
              required
            />
            <TextField
              label="Commission Payable IDs to Hold (Comma-separated)"
              value={dispHoldPayables}
              onChange={(e) => setDispHoldPayables(e.target.value)}
              fullWidth
              placeholder="cpay_01J..., cpay_02J..."
              helperText="Associated payables will be atomically placed ON_HOLD."
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setDisputeDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={handleCreateDispute}
            disabled={loading || !canDispute}
            data-testid="rec.btn.dispute-submit"
          >
            Create Dispute & Hold
          </Button>
        </DialogActions>
      </Dialog>

      {/* MODAL 5: Update / Resolve Dispute */}
      <Dialog
        open={updateDisputeDialogOpen}
        onClose={() => setUpdateDisputeDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle fontWeight={700}>Resolve Dispute (Optimistic Concurrency)</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary">
              Dispute: <strong>{selectedDispute?.id}</strong> | Concurrency Lock Version:{' '}
              {selectedDispute?.lockVersion}
            </Typography>
            <FormControl fullWidth>
              <InputLabel>New Status</InputLabel>
              <Select
                value={updateDispStatus}
                label="New Status"
                onChange={(e) => setUpdateDispStatus(e.target.value)}
              >
                <MenuItem value="RESOLVED">RESOLVED</MenuItem>
                <MenuItem value="REJECTED">REJECTED</MenuItem>
                <MenuItem value="WITHDRAWN">WITHDRAWN</MenuItem>
                <MenuItem value="UNDER_REVIEW">UNDER_REVIEW</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Resolution Terms"
              multiline
              rows={3}
              value={updateDispResolution}
              onChange={(e) => setUpdateDispResolution(e.target.value)}
              fullWidth
              required
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setUpdateDisputeDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleUpdateDispute}
            disabled={loading}
            data-testid="rec.btn.update-dispute-submit"
          >
            Save Resolution
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
export default ReconciliationDashboardPage;
