// apps/web/src/features/ledger/LedgerPage.tsx — MOD-LED Ledger Management UI (Material UI)
import React, { useEffect, useState } from 'react';
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
  FormControl,
  Grid,
  IconButton,
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
import type {
  AccountBalanceResponse,
  ConnectorStatementResponse,
  LedgerAccount,
  LedgerJournal,
} from '@dsa/contracts';
import {
  closeLedgerPeriod,
  createLedgerAccount,
  createLedgerExport,
  fetchAccountBalance,
  fetchConnectorStatements,
  fetchLedgerAccounts,
  fetchLedgerJournals,
  fetchTrialBalance,
} from './api';

export function LedgerPage() {
  const [activeTab, setActiveTab] = useState<
    'accounts' | 'journals' | 'statements' | 'period_close' | 'exports'
  >('accounts');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // --- Accounts State ---
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [accountTypeFilter, setAccountTypeFilter] = useState<string>('ALL');
  const [selectedBalance, setSelectedBalance] = useState<AccountBalanceResponse | null>(null);
  const [isNewAccountModalOpen, setIsNewAccountModalOpen] = useState(false);
  const [newAccountCode, setNewAccountCode] = useState('');
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountType, setNewAccountType] = useState('ASSET');

  // --- Journals State ---
  const [journals, setJournals] = useState<LedgerJournal[]>([]);
  const [journalPeriodFilter, setJournalPeriodFilter] = useState('');

  // --- Statements State ---
  const [connectorIdInput, setConnectorIdInput] = useState('');
  const [connectorStatement, setConnectorStatement] = useState<ConnectorStatementResponse | null>(null);

  // --- Trial Balance & Period Close State ---
  const [trialPeriod, setTrialPeriod] = useState(new Date().toISOString().substring(0, 7));
  const [trialBalance, setTrialBalance] = useState<{
    totalDebit: string;
    totalCredit: string;
    variance: string;
    isBalanced: boolean;
  } | null>(null);
  const [closePeriodNote, setClosePeriodNote] = useState('');
  const [isClosingPeriod, setIsClosingPeriod] = useState(false);

  // --- Export State ---
  const [exportPeriod, setExportPeriod] = useState(new Date().toISOString().substring(0, 7));
  const [exportFormat, setExportFormat] = useState<'CSV' | 'JSON' | 'EXCEL'>('CSV');
  const [exportHistory, setExportHistory] = useState<
    Array<{ id: string; format: string; period: string; status: string; date: string }>
  >([]);

  const loadAccounts = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchLedgerAccounts(
        accountTypeFilter !== 'ALL' ? { type: accountTypeFilter as any } : undefined,
      );
      setAccounts(res.data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load ledger accounts');
    } finally {
      setLoading(false);
    }
  };

  const loadJournals = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchLedgerJournals(
        journalPeriodFilter ? { period: journalPeriodFilter } : undefined,
      );
      setJournals(res.data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load journals');
    } finally {
      setLoading(false);
    }
  };

  const loadTrialBalance = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchTrialBalance(trialPeriod || undefined);
      setTrialBalance(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to load trial balance');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'accounts') loadAccounts();
    if (activeTab === 'journals') loadJournals();
    if (activeTab === 'period_close') loadTrialBalance();
  }, [activeTab, accountTypeFilter, journalPeriodFilter, trialPeriod]);

  const handleInspectBalance = async (accId: string) => {
    try {
      setLoading(true);
      const res = await fetchAccountBalance(accId);
      setSelectedBalance(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch balance');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError(null);
      await createLedgerAccount({
        code: newAccountCode,
        name: newAccountName,
        type: newAccountType as any,
        isActive: newAccountType !== 'TAX_PAYABLE' && newAccountType !== 'TAX_RECEIVABLE',
      });
      setSuccessMsg(`Account ${newAccountCode} created successfully.`);
      setIsNewAccountModalOpen(false);
      setNewAccountCode('');
      setNewAccountName('');
      loadAccounts();
    } catch (err: any) {
      setError(err?.message || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  const handleFetchStatements = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectorIdInput.trim()) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetchConnectorStatements(connectorIdInput.trim());
      setConnectorStatement(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch connector statement');
    } finally {
      setLoading(false);
    }
  };

  const handleClosePeriodSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !window.confirm(
        `Are you sure you want to CLOSE accounting period ${trialPeriod}? Once closed, no further journals can be posted to this period.`,
      )
    ) {
      return;
    }
    try {
      setIsClosingPeriod(true);
      setError(null);
      const res = await closeLedgerPeriod(trialPeriod, { note: closePeriodNote });
      setSuccessMsg(`Period ${res.period} closed successfully with zero-sum trial balance verification.`);
      setClosePeriodNote('');
      loadTrialBalance();
    } catch (err: any) {
      setError(err?.message || 'Period close failed');
    } finally {
      setIsClosingPeriod(false);
    }
  };

  const handleExportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError(null);
      const res = await createLedgerExport({
        period: exportPeriod,
        format: exportFormat,
      });
      setExportHistory((prev) => [
        {
          id: res.exportId,
          format: exportFormat,
          period: exportPeriod,
          status: 'QUEUED',
          date: new Date().toLocaleTimeString(),
        },
        ...prev,
      ]);
      setSuccessMsg(`Export job ${res.exportId} dispatched to queue.`);
    } catch (err: any) {
      setError(err?.message || 'Export request failed');
    } finally {
      setLoading(false);
    }
  };

  const getTypeChipColor = (type: string): 'primary' | 'secondary' | 'success' | 'warning' | 'default' => {
    switch (type) {
      case 'ASSET':
        return 'primary';
      case 'LIABILITY':
        return 'secondary';
      case 'INCOME':
        return 'success';
      case 'EXPENSE':
        return 'warning';
      default:
        return 'default';
    }
  };

  return (
    <Box sx={{ p: { xs: 2.5, sm: 3.5 }, maxWidth: 1400, mx: 'auto' }}>
      {/* Header Section */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        justifyContent="space-between"
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5 }}>
            <Typography variant="h5" component="h1" fontWeight={700} sx={{ color: '#0f172a' }}>
              Ledger Management
            </Typography>
            <Chip
              label="MOD-LED • DOM-K"
              size="small"
              color="primary"
              variant="outlined"
              sx={{ fontWeight: 600, fontSize: '0.75rem' }}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            General and sub-ledger chart of accounts, immutable double-entry journal postings, and
            period-close governance.
          </Typography>
        </Box>

        <Button
          id="btn-new-account"
          variant="contained"
          onClick={() => setIsNewAccountModalOpen(true)}
          sx={{
            fontWeight: 600,
            textTransform: 'none',
            borderRadius: 2,
            px: 2.5,
            py: 1,
            boxShadow: '0 4px 14px rgba(37, 99, 235, 0.25)',
          }}
        >
          + New Account
        </Button>
      </Stack>

      {/* Feedback Alerts */}
      {error && (
        <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {successMsg && (
        <Alert severity="success" sx={{ mb: 2.5, borderRadius: 2 }} onClose={() => setSuccessMsg(null)}>
          {successMsg}
        </Alert>
      )}

      {/* Tabs */}
      <Paper elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs
          value={activeTab}
          onChange={(_, val) => setActiveTab(val)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            '& .MuiTab-root': {
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '0.9rem',
              py: 1.5,
            },
          }}
        >
          <Tab id="tab-accounts" value="accounts" label="Chart of Accounts (SUB-LED.01)" />
          <Tab id="tab-journals" value="journals" label="Journal Postings (SUB-LED.02)" />
          <Tab id="tab-statements" value="statements" label="Connector Statements (SUB-LED.03)" />
          <Tab id="tab-period_close" value="period_close" label="Trial Balance & Period Close" />
          <Tab id="tab-exports" value="exports" label="Exports" />
        </Tabs>
      </Paper>

      {/* TAB 1: Chart of Accounts */}
      {activeTab === 'accounts' && (
        <Stack spacing={2.5}>
          <Paper
            elevation={0}
            sx={{
              p: 2,
              borderRadius: 2.5,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: '#f8fafc',
            }}
          >
            <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
              <Stack direction="row" alignItems="center" spacing={2}>
                <Typography variant="caption" fontWeight={700} sx={{ color: '#64748b', textTransform: 'uppercase' }}>
                  Filter by Type:
                </Typography>
                <FormControl size="small" sx={{ minWidth: 220 }}>
                  <InputLabel id="select-account-type-label">All Types</InputLabel>
                  <Select
                    labelId="select-account-type-label"
                    id="select-account-type"
                    value={accountTypeFilter}
                    label="All Types"
                    onChange={(e) => setAccountTypeFilter(e.target.value)}
                    sx={{ bgcolor: '#ffffff', borderRadius: 2 }}
                  >
                    <MenuItem value="ALL">All Types</MenuItem>
                    <MenuItem value="ASSET">ASSET</MenuItem>
                    <MenuItem value="LIABILITY">LIABILITY</MenuItem>
                    <MenuItem value="INCOME">INCOME</MenuItem>
                    <MenuItem value="EXPENSE">EXPENSE</MenuItem>
                    <MenuItem value="SUSPENSE">SUSPENSE</MenuItem>
                    <MenuItem value="TAX_PAYABLE">TAX_PAYABLE (OD-021 Dormant)</MenuItem>
                    <MenuItem value="TAX_RECEIVABLE">TAX_RECEIVABLE (OD-021 Dormant)</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Showing {accounts.length} accounts
              </Typography>
            </Stack>
          </Paper>

          <TableContainer
            component={Paper}
            elevation={0}
            sx={{
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
              overflow: 'hidden',
            }}
          >
            <Table>
              <TableHead sx={{ bgcolor: '#f8fafc' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, color: '#475569' }}>Code</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: '#475569' }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: '#475569' }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: '#475569' }}>Counterparty</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: '#475569' }}>Status</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, color: '#475569' }}>
                    Actions
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {accounts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                      {loading ? (
                        <Stack alignItems="center" spacing={1.5}>
                          <CircularProgress size={28} />
                          <Typography variant="body2">Loading accounts...</Typography>
                        </Stack>
                      ) : (
                        'No ledger accounts registered.'
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  accounts.map((acc) => (
                    <TableRow key={acc.id} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
                      <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'primary.main' }}>
                        {acc.code}
                      </TableCell>
                      <TableCell sx={{ fontWeight: 500, color: '#0f172a' }}>{acc.name}</TableCell>
                      <TableCell>
                        <Chip
                          label={acc.type}
                          size="small"
                          color={getTypeChipColor(acc.type)}
                          variant="outlined"
                          sx={{ fontWeight: 600, fontSize: '0.75rem' }}
                        />
                      </TableCell>
                      <TableCell sx={{ color: 'text.secondary' }}>
                        {acc.counterpartyType
                          ? `${acc.counterpartyType} (${acc.counterpartyId ?? 'any'})`
                          : '—'}
                      </TableCell>
                      <TableCell>
                        {acc.isActive ? (
                          <Chip
                            label="Active"
                            size="small"
                            color="success"
                            variant="filled"
                            sx={{ fontWeight: 600, fontSize: '0.75rem', height: 22 }}
                          />
                        ) : (
                          <Chip
                            label="Inactive (OD-021)"
                            size="small"
                            color="warning"
                            variant="outlined"
                            sx={{ fontWeight: 600, fontSize: '0.75rem', height: 22 }}
                          />
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => handleInspectBalance(acc.id)}
                          sx={{ textTransform: 'none', borderRadius: 1.5, fontWeight: 600 }}
                        >
                          View Balance
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Stack>
      )}

      {/* TAB 2: Journal Postings */}
      {activeTab === 'journals' && (
        <Stack spacing={2.5}>
          <Paper
            elevation={0}
            sx={{
              p: 2,
              borderRadius: 2.5,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: '#f8fafc',
            }}
          >
            <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
              <Stack direction="row" alignItems="center" spacing={2}>
                <Typography variant="caption" fontWeight={700} sx={{ color: '#64748b', textTransform: 'uppercase' }}>
                  Period (YYYY-MM):
                </Typography>
                <TextField
                  id="filter-journal-period"
                  size="small"
                  placeholder="e.g. 2026-10"
                  value={journalPeriodFilter}
                  onChange={(e) => setJournalPeriodFilter(e.target.value)}
                  sx={{ width: 160, bgcolor: '#ffffff', borderRadius: 2 }}
                />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Append-only double-entry journals enforced by PostgreSQL deferred balancing trigger.
              </Typography>
            </Stack>
          </Paper>

          <Stack spacing={2}>
            {journals.length === 0 ? (
              <Paper
                elevation={0}
                sx={{
                  p: 6,
                  textAlign: 'center',
                  borderRadius: 3,
                  border: '1px dashed',
                  borderColor: 'divider',
                  color: 'text.secondary',
                }}
              >
                {loading ? (
                  <Stack alignItems="center" spacing={1.5}>
                    <CircularProgress size={28} />
                    <Typography variant="body2">Loading journals...</Typography>
                  </Stack>
                ) : (
                  'No journals found for this filter.'
                )}
              </Paper>
            ) : (
              journals.map((j) => (
                <Card
                  key={j.id}
                  variant="outlined"
                  sx={{
                    borderRadius: 3,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                    overflow: 'hidden',
                  }}
                >
                  <CardContent sx={{ p: 2.5 }}>
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      alignItems={{ xs: 'flex-start', sm: 'center' }}
                      justifyContent="space-between"
                      spacing={1.5}
                      sx={{ pb: 2, mb: 2, borderBottom: '1px solid', borderColor: 'divider' }}
                    >
                      <Stack direction="row" alignItems="center" spacing={1.5}>
                        <Typography variant="subtitle1" fontWeight={700} sx={{ fontFamily: 'monospace' }}>
                          {j.journalNumber}
                        </Typography>
                        <Chip
                          label={j.referenceType}
                          size="small"
                          sx={{ fontWeight: 600, bgcolor: '#f1f5f9', color: '#475569' }}
                        />
                        <Typography variant="caption" color="text.secondary">
                          Ref: {j.referenceId}
                        </Typography>
                      </Stack>
                      <Stack direction="row" alignItems="center" spacing={2} sx={{ fontSize: '0.8rem', color: '#64748b' }}>
                        <span>
                          Period: <strong>{j.period}</strong>
                        </span>
                        <span>Posted by: {j.postedBy}</span>
                        <span>{new Date(j.postedAt).toLocaleString()}</span>
                      </Stack>
                    </Stack>

                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow sx={{ '& th': { color: '#64748b', fontWeight: 600, py: 0.75 } }}>
                            <TableCell>#</TableCell>
                            <TableCell>Account</TableCell>
                            <TableCell>Type</TableCell>
                            <TableCell>Narration</TableCell>
                            <TableCell align="right">Debit (₹)</TableCell>
                            <TableCell align="right">Credit (₹)</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {j.lines?.map((line) => (
                            <TableRow key={line.id} sx={{ '& td': { py: 0.75 } }}>
                              <TableCell sx={{ color: 'text.secondary' }}>{line.lineNumber}</TableCell>
                              <TableCell sx={{ fontFamily: 'monospace', fontWeight: 500 }}>
                                {line.accountCode ?? line.accountId}
                              </TableCell>
                              <TableCell>
                                <Chip
                                  label={line.entryType}
                                  size="small"
                                  color={line.entryType === 'DEBIT' ? 'primary' : 'success'}
                                  variant="outlined"
                                  sx={{ fontWeight: 700, fontSize: '0.7rem', height: 20 }}
                                />
                              </TableCell>
                              <TableCell sx={{ color: 'text.secondary' }}>{line.narration ?? '—'}</TableCell>
                              <TableCell align="right" sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'primary.main' }}>
                                {line.entryType === 'DEBIT'
                                  ? `₹${parseFloat(line.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                                  : '—'}
                              </TableCell>
                              <TableCell align="right" sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'success.main' }}>
                                {line.entryType === 'CREDIT'
                                  ? `₹${parseFloat(line.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                                  : '—'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </CardContent>
                </Card>
              ))
            )}
          </Stack>
        </Stack>
      )}

      {/* TAB 3: Connector Statements */}
      {activeTab === 'statements' && (
        <Stack spacing={3}>
          <Paper
            component="form"
            onSubmit={handleFetchStatements}
            elevation={0}
            sx={{
              p: 2.5,
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: '#f8fafc',
            }}
          >
            <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'stretch', sm: 'flex-end' }} spacing={2}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="caption" fontWeight={700} sx={{ color: '#64748b', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
                  Connector ID:
                </Typography>
                <TextField
                  id="input-connector-id"
                  fullWidth
                  size="small"
                  placeholder="e.g. con_01J..."
                  value={connectorIdInput}
                  onChange={(e) => setConnectorIdInput(e.target.value)}
                  sx={{ bgcolor: '#ffffff', borderRadius: 2 }}
                />
              </Box>
              <Button
                id="btn-fetch-statement"
                type="submit"
                variant="contained"
                disabled={loading}
                sx={{
                  py: 1,
                  px: 3,
                  fontWeight: 600,
                  textTransform: 'none',
                  borderRadius: 2,
                  boxShadow: '0 4px 14px rgba(37, 99, 235, 0.25)',
                }}
              >
                Generate Statement
              </Button>
            </Stack>
          </Paper>

          {connectorStatement && (
            <Stack spacing={3}>
              <Grid container spacing={2.5}>
                <Grid item xs={12} sm={6} md={3}>
                  <Card variant="outlined" sx={{ borderRadius: 2.5, p: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                      Opening Balance
                    </Typography>
                    <Typography variant="h6" fontWeight={700} sx={{ fontFamily: 'monospace', mt: 0.5 }}>
                      ₹{connectorStatement.openingBalance}
                    </Typography>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <Card variant="outlined" sx={{ borderRadius: 2.5, p: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                      Total Credits (Earned)
                    </Typography>
                    <Typography variant="h6" fontWeight={700} color="success.main" sx={{ fontFamily: 'monospace', mt: 0.5 }}>
                      ₹{connectorStatement.totalCredits}
                    </Typography>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <Card variant="outlined" sx={{ borderRadius: 2.5, p: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                      Total Debits (Paid)
                    </Typography>
                    <Typography variant="h6" fontWeight={700} color="primary.main" sx={{ fontFamily: 'monospace', mt: 0.5 }}>
                      ₹{connectorStatement.totalDebits}
                    </Typography>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <Card variant="outlined" sx={{ borderRadius: 2.5, p: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                      Closing Balance (Payable)
                    </Typography>
                    <Typography variant="h6" fontWeight={700} color="secondary.main" sx={{ fontFamily: 'monospace', mt: 0.5 }}>
                      ₹{connectorStatement.closingBalance}
                    </Typography>
                  </Card>
                </Grid>
              </Grid>

              <TableContainer
                component={Paper}
                elevation={0}
                sx={{
                  borderRadius: 3,
                  border: '1px solid',
                  borderColor: 'divider',
                  overflow: 'hidden',
                }}
              >
                <Table>
                  <TableHead sx={{ bgcolor: '#f8fafc' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, color: '#475569' }}>Date</TableCell>
                      <TableCell sx={{ fontWeight: 700, color: '#475569' }}>Journal #</TableCell>
                      <TableCell sx={{ fontWeight: 700, color: '#475569' }}>Reference</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, color: '#475569' }}>
                        Debit (₹)
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, color: '#475569' }}>
                        Credit (₹)
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, color: '#475569' }}>
                        Running Balance (₹)
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {connectorStatement.lines.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                          No activity recorded for this connector.
                        </TableCell>
                      </TableRow>
                    ) : (
                      connectorStatement.lines.map((line, idx) => (
                        <TableRow key={idx} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{line.date}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem', fontWeight: 600, color: 'primary.main' }}>
                            {line.journalNumber}
                          </TableCell>
                          <TableCell sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>
                            {line.referenceType}: {line.referenceId}
                          </TableCell>
                          <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'primary.main' }}>
                            {line.debit !== '0.00' ? `₹${line.debit}` : '—'}
                          </TableCell>
                          <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'success.main' }}>
                            {line.credit !== '0.00' ? `₹${line.credit}` : '—'}
                          </TableCell>
                          <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 700, color: '#0f172a' }}>
                            ₹{line.runningBalance}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          )}
        </Stack>
      )}

      {/* TAB 4: Trial Balance & Period Close */}
      {activeTab === 'period_close' && (
        <Stack spacing={3}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={4}>
              <Card variant="outlined" sx={{ borderRadius: 3, p: 3, bgcolor: '#ffffff' }}>
                <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Total Debits
                </Typography>
                <Typography variant="h4" fontWeight={700} color="primary.main" sx={{ fontFamily: 'monospace', my: 1 }}>
                  ₹{trialBalance?.totalDebit ?? '0.00'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Aggregated debits across all sub-ledgers
                </Typography>
              </Card>
            </Grid>

            <Grid item xs={12} md={4}>
              <Card variant="outlined" sx={{ borderRadius: 3, p: 3, bgcolor: '#ffffff' }}>
                <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Total Credits
                </Typography>
                <Typography variant="h4" fontWeight={700} color="success.main" sx={{ fontFamily: 'monospace', my: 1 }}>
                  ₹{trialBalance?.totalCredit ?? '0.00'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Aggregated credits across all sub-ledgers
                </Typography>
              </Card>
            </Grid>

            <Grid item xs={12} md={4}>
              <Card
                variant="outlined"
                sx={{
                  borderRadius: 3,
                  p: 3,
                  bgcolor: trialBalance?.isBalanced ? '#f0fdf4' : '#fef2f2',
                  borderColor: trialBalance?.isBalanced ? '#bbf7d0' : '#fecaca',
                }}
              >
                <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Trial Balance Variance
                </Typography>
                <Typography
                  variant="h4"
                  fontWeight={700}
                  color={trialBalance?.isBalanced ? 'success.dark' : 'error.main'}
                  sx={{ fontFamily: 'monospace', my: 1 }}
                >
                  ₹{trialBalance?.variance ?? '0.00'}
                </Typography>
                <Typography
                  variant="caption"
                  fontWeight={600}
                  color={trialBalance?.isBalanced ? 'success.dark' : 'error.main'}
                >
                  {trialBalance?.isBalanced
                    ? '✓ Zero-sum verified (Debit = Credit)'
                    : '⚠ UNBALANCED: Period close blocked'}
                </Typography>
              </Card>
            </Grid>
          </Grid>

          {/* Period Close Action Card */}
          <Card variant="outlined" sx={{ borderRadius: 3, p: 3.5, bgcolor: '#ffffff' }}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
              <Typography variant="h6" fontWeight={700} sx={{ color: '#0f172a' }}>
                Execute Accounting Period Close
              </Typography>
              <Chip
                label="Step-Up MFA Required"
                size="small"
                color="warning"
                variant="outlined"
                sx={{ fontWeight: 600, fontSize: '0.75rem' }}
              />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 800 }}>
              Closing a period finalizes all journal postings for that calendar month. It locks the period
              against retroactive adjustments and ensures financial statements remain tamper-evident.
            </Typography>

            <Box component="form" onSubmit={handleClosePeriodSubmit} sx={{ maxWidth: 540 }}>
              <Stack spacing={2.5}>
                <TextField
                  id="input-close-period"
                  label="Period to Close"
                  size="small"
                  value={trialPeriod}
                  onChange={(e) => setTrialPeriod(e.target.value)}
                  placeholder="YYYY-MM"
                  inputProps={{ style: { fontFamily: 'monospace' } }}
                  fullWidth
                />

                <TextField
                  id="input-close-note"
                  label="Closing Note / Audit Memo"
                  multiline
                  rows={3}
                  size="small"
                  value={closePeriodNote}
                  onChange={(e) => setClosePeriodNote(e.target.value)}
                  placeholder="e.g. Month-end commission settlement closed after reconciliation."
                  fullWidth
                />

                <Button
                  id="btn-close-period"
                  type="submit"
                  variant="contained"
                  color="error"
                  disabled={isClosingPeriod || !trialBalance?.isBalanced}
                  sx={{
                    py: 1.2,
                    fontWeight: 600,
                    textTransform: 'none',
                    borderRadius: 2,
                    boxShadow: '0 4px 14px rgba(220, 38, 38, 0.25)',
                  }}
                >
                  {isClosingPeriod ? 'Closing Period...' : `Close Period ${trialPeriod}`}
                </Button>
              </Stack>
            </Box>
          </Card>
        </Stack>
      )}

      {/* TAB 5: Exports */}
      {activeTab === 'exports' && (
        <Stack spacing={3}>
          <Card variant="outlined" sx={{ borderRadius: 3, p: 3.5, maxWidth: 640, bgcolor: '#ffffff' }}>
            <Typography variant="h6" fontWeight={700} sx={{ color: '#0f172a', mb: 0.5 }}>
              Generate Accounting Ledger Export
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Export general ledger journals, account balances, and sub-ledger movements for external ERP
              accounting suites.
            </Typography>

            <Box component="form" onSubmit={handleExportSubmit}>
              <Stack spacing={2.5}>
                <FormControl fullWidth size="small">
                  <InputLabel id="select-export-format-label">Export Format</InputLabel>
                  <Select
                    labelId="select-export-format-label"
                    id="select-export-format"
                    value={exportFormat}
                    label="Export Format"
                    onChange={(e) => setExportFormat(e.target.value as any)}
                  >
                    <MenuItem value="CSV">CSV (Tally / QuickBooks Compatible)</MenuItem>
                    <MenuItem value="JSON">JSON (Standard Schema)</MenuItem>
                    <MenuItem value="EXCEL">Excel (.xlsx)</MenuItem>
                  </Select>
                </FormControl>

                <TextField
                  id="input-export-period"
                  label="Period (Optional)"
                  size="small"
                  value={exportPeriod}
                  onChange={(e) => setExportPeriod(e.target.value)}
                  inputProps={{ style: { fontFamily: 'monospace' } }}
                  fullWidth
                />

                <Button
                  id="btn-trigger-export"
                  type="submit"
                  variant="contained"
                  disabled={loading}
                  sx={{
                    py: 1.2,
                    fontWeight: 600,
                    textTransform: 'none',
                    borderRadius: 2,
                    boxShadow: '0 4px 14px rgba(37, 99, 235, 0.25)',
                  }}
                >
                  Dispatch Export Job
                </Button>
              </Stack>
            </Box>
          </Card>

          {exportHistory.length > 0 && (
            <TableContainer
              component={Paper}
              elevation={0}
              sx={{
                borderRadius: 3,
                border: '1px solid',
                borderColor: 'divider',
                overflow: 'hidden',
                maxWidth: 900,
              }}
            >
              <Box sx={{ p: 2, bgcolor: '#f8fafc', borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle2" fontWeight={700}>
                  Recent Export Dispatches
                </Typography>
              </Box>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ '& th': { color: '#64748b', fontWeight: 600 } }}>
                    <TableCell>Export ID</TableCell>
                    <TableCell>Period</TableCell>
                    <TableCell>Format</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Dispatched At</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {exportHistory.map((h) => (
                    <TableRow key={h.id} hover>
                      <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'primary.main' }}>
                        {h.id}
                      </TableCell>
                      <TableCell>{h.period}</TableCell>
                      <TableCell>
                        <Chip label={h.format} size="small" variant="outlined" sx={{ fontWeight: 600 }} />
                      </TableCell>
                      <TableCell>
                        <Chip label={h.status} size="small" color="success" sx={{ fontWeight: 600 }} />
                      </TableCell>
                      <TableCell align="right" sx={{ color: 'text.secondary' }}>
                        {h.date}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Stack>
      )}

      {/* Balance Inspection Modal */}
      <Dialog
        open={Boolean(selectedBalance)}
        onClose={() => setSelectedBalance(null)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogTitle sx={{ fontWeight: 700, pb: 1 }}>Account Balance Summary</DialogTitle>
        <DialogContent dividers>
          {selectedBalance && (
            <Stack spacing={1.5} sx={{ py: 1 }}>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  Account:
                </Typography>
                <Typography variant="body2" fontWeight={700} sx={{ fontFamily: 'monospace' }}>
                  {selectedBalance.accountCode}
                </Typography>
              </Stack>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  Name:
                </Typography>
                <Typography variant="body2" fontWeight={500}>
                  {selectedBalance.accountName}
                </Typography>
              </Stack>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  Type:
                </Typography>
                <Chip
                  label={selectedBalance.type}
                  size="small"
                  color={getTypeChipColor(selectedBalance.type)}
                  sx={{ fontWeight: 600, height: 22 }}
                />
              </Stack>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  Total Debits:
                </Typography>
                <Typography variant="body2" fontWeight={600} color="primary.main" sx={{ fontFamily: 'monospace' }}>
                  ₹{selectedBalance.debitTotal}
                </Typography>
              </Stack>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  Total Credits:
                </Typography>
                <Typography variant="body2" fontWeight={600} color="success.main" sx={{ fontFamily: 'monospace' }}>
                  ₹{selectedBalance.creditTotal}
                </Typography>
              </Stack>
              <Divider sx={{ my: 1 }} />
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="subtitle1" fontWeight={700}>
                  Net Balance:
                </Typography>
                <Typography variant="subtitle1" fontWeight={700} color="primary.dark" sx={{ fontFamily: 'monospace' }}>
                  ₹{selectedBalance.balance}
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary" align="right">
                Computed from {selectedBalance.lineCount} ledger entries
              </Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setSelectedBalance(null)} variant="outlined" fullWidth sx={{ borderRadius: 2 }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* New Account Modal */}
      <Dialog
        open={isNewAccountModalOpen}
        onClose={() => setIsNewAccountModalOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogTitle sx={{ fontWeight: 700, pb: 1 }}>Register New Ledger Account</DialogTitle>
        <Box component="form" onSubmit={handleCreateAccount}>
          <DialogContent dividers>
            <Stack spacing={2.5} sx={{ py: 1 }}>
              <TextField
                id="input-new-code"
                label="Account Code"
                required
                placeholder="e.g. 1020-OPERATING-BANK"
                value={newAccountCode}
                onChange={(e) => setNewAccountCode(e.target.value)}
                inputProps={{ style: { fontFamily: 'monospace' } }}
                fullWidth
                size="small"
              />

              <TextField
                id="input-new-name"
                label="Account Name"
                required
                placeholder="e.g. Operating Bank Account"
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                fullWidth
                size="small"
              />

              <FormControl fullWidth size="small">
                <InputLabel id="select-new-type-label">Account Type</InputLabel>
                <Select
                  labelId="select-new-type-label"
                  id="select-new-type"
                  value={newAccountType}
                  label="Account Type"
                  onChange={(e) => setNewAccountType(e.target.value)}
                >
                  <MenuItem value="ASSET">ASSET</MenuItem>
                  <MenuItem value="LIABILITY">LIABILITY</MenuItem>
                  <MenuItem value="INCOME">INCOME</MenuItem>
                  <MenuItem value="EXPENSE">EXPENSE</MenuItem>
                  <MenuItem value="SUSPENSE">SUSPENSE</MenuItem>
                  <MenuItem value="TAX_PAYABLE">TAX_PAYABLE (OD-021 Dormant)</MenuItem>
                  <MenuItem value="TAX_RECEIVABLE">TAX_RECEIVABLE (OD-021 Dormant)</MenuItem>
                </Select>
              </FormControl>

              {(newAccountType === 'TAX_PAYABLE' || newAccountType === 'TAX_RECEIVABLE') && (
                <Alert severity="warning" sx={{ borderRadius: 2 }}>
                  Under Open Decision OD-021, tax accounts will be created in INACTIVE state until tax
                  withholding rules are finalized.
                </Alert>
              )}
            </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 2 }}>
            <Button onClick={() => setIsNewAccountModalOpen(false)} variant="outlined" sx={{ borderRadius: 2 }}>
              Cancel
            </Button>
            <Button
              id="btn-save-account"
              type="submit"
              variant="contained"
              disabled={loading}
              sx={{ borderRadius: 2, px: 3, fontWeight: 600 }}
            >
              Save Account
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Box>
  );
}
