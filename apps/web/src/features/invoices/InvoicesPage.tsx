// apps/web/src/features/invoices/InvoicesPage.tsx — Module 33: Invoices (MOD-INV) UI
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useMemo, useState } from 'react';
import { hasPermission, useMe } from '../../api/useMe';
import { useToast } from '../../shell/toast';
import {
  DataTable,
  FilterToolbar,
  PageHeader,
  StatCard,
  StatCardGrid,
  StatusBadge,
  type Column,
} from '../../ui';
import { createInvoice, getConnectorStatements, getInvoices, updateInvoiceStatus } from './api';
import { ConnectorSelect } from '../connectors/ConnectorSelect';
import { ConnectorName } from '../../shell/display';
import type { CreateInvoiceInput, InvoiceDirection, InvoiceRecord, InvoiceStatus } from './types';

export function InvoicesPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();

  const canManage = hasPermission(me, 'invoice.manage');

  // Navigation tab (0: Invoice Register, 1: Connector Statements)
  const [tabIndex, setTabIndex] = useState(0);

  // Filters for Register
  const [directionFilter, setDirectionFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Dialog states
  const [recordDialogOpen, setRecordDialogOpen] = useState(false);
  const [detailsInvoice, setDetailsInvoice] = useState<InvoiceRecord | null>(null);

  // Form state for Record Invoice
  const [formDirection, setFormDirection] = useState<InvoiceDirection>('TO_LENDER');
  const [formNumber, setFormNumber] = useState('');
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0]!);
  const [formDueDate, setFormDueDate] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formPartyId, setFormPartyId] = useState('');
  const [formPartyName, setFormPartyName] = useState('');
  const [formGstRate, setFormGstRate] = useState('18');
  const [formTdsRate, setFormTdsRate] = useState('10');
  const [formHsnSac, setFormHsnSac] = useState('9971');
  const [formNotes, setFormNotes] = useState('');

  // State for Connector Statements Tab
  const [statementConnectorId, setStatementConnectorId] = useState(me?.id ?? '');
  const [statementFromDate, setStatementFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0]!;
  });
  const [statementToDate, setStatementToDate] = useState(() => new Date().toISOString().split('T')[0]!);
  const [activeConnectorId, setActiveConnectorId] = useState('');

  // Queries
  const {
    data: invoicesData,
    isLoading: invoicesLoading,
    error: invoicesError,
    refetch: refetchInvoices,
  } = useQuery({
    queryKey: ['invoices', directionFilter, statusFilter, searchQuery],
    queryFn: () =>
      getInvoices({
        direction: directionFilter === 'ALL' ? undefined : directionFilter,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        search: searchQuery.trim() || undefined,
      }),
  });

  const invoices = invoicesData?.data ?? [];

  // Query for Statement
  const {
    data: statementData,
    isLoading: statementLoading,
    error: statementError,
    refetch: refetchStatement,
  } = useQuery({
    queryKey: ['connector-statement', activeConnectorId, statementFromDate, statementToDate],
    queryFn: () =>
      getConnectorStatements(activeConnectorId, {
        fromDate: statementFromDate || undefined,
        toDate: statementToDate || undefined,
      }),
    enabled: !!activeConnectorId,
  });

  // KPI Metrics calculation
  const metrics = useMemo(() => {
    const totalCount = invoices.length;
    let totalAmount = 0;
    let toLenderAmount = 0;
    let fromConnectorAmount = 0;
    let draftCount = 0;
    let issuedCount = 0;
    let paidAmount = 0;

    for (const inv of invoices) {
      totalAmount += inv.amount;
      if (inv.direction === 'TO_LENDER') toLenderAmount += inv.amount;
      if (inv.direction === 'FROM_CONNECTOR') fromConnectorAmount += inv.amount;
      if (inv.status === 'DRAFT') draftCount++;
      if (inv.status === 'ISSUED') issuedCount++;
      if (inv.status === 'PAID') paidAmount += inv.amount;
    }

    return {
      totalCount,
      totalAmount,
      toLenderAmount,
      fromConnectorAmount,
      draftCount,
      issuedCount,
      paidAmount,
    };
  }, [invoices]);

  // Mutations
  const recordMutation = useMutation({
    mutationFn: (input: CreateInvoiceInput) => createInvoice(input),
    onSuccess: () => {
      toast.success('Invoice successfully recorded.');
      setRecordDialogOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to record invoice.');
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({
      id,
      status,
      lockVersion,
    }: {
      id: string;
      status: 'ISSUED' | 'PAID' | 'VOID';
      lockVersion: number;
    }) => updateInvoiceStatus(id, { status }, `"${lockVersion}"`),
    onSuccess: (_data, vars) => {
      toast.success(`Invoice status updated to ${vars.status}.`);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      if (detailsInvoice && detailsInvoice.id === vars.id) {
        setDetailsInvoice(null);
      }
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to update invoice status.');
    },
  });

  const resetForm = () => {
    setFormNumber('');
    setFormDate(new Date().toISOString().split('T')[0]!);
    setFormDueDate('');
    setFormAmount('');
    setFormPartyId('');
    setFormPartyName('');
    setFormNotes('');
  };

  const handleRecordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(formAmount);
    if (isNaN(parsedAmount) || parsedAmount < 0) {
      toast.error('Please enter a valid positive invoice amount.');
      return;
    }
    if (!formNumber.trim()) {
      toast.error('Invoice number is required.');
      return;
    }
    if (!formPartyId.trim()) {
      toast.error('Counterparty ID is required.');
      return;
    }

    const gstRateNum = parseFloat(formGstRate) || 0;
    const gstAmount = Number(((parsedAmount * gstRateNum) / 100).toFixed(2));
    const tdsRateNum = parseFloat(formTdsRate) || 0;
    const tdsAmount = Number(((parsedAmount * tdsRateNum) / 100).toFixed(2));

    recordMutation.mutate({
      direction: formDirection,
      number: formNumber.trim(),
      date: formDate,
      dueDate: formDueDate ? formDueDate : null,
      amount: parsedAmount,
      currency: 'INR',
      partyId: formPartyId.trim(),
      partyName: formPartyName.trim() || null,
      taxFields: {
        gstRate: gstRateNum,
        gstAmount,
        tdsRate: tdsRateNum,
        tdsAmount,
        hsnSac: formHsnSac.trim() || undefined,
      },
      notes: formNotes.trim() || null,
    });
  };

  const formatCurrency = (amt: number, curr = 'INR') => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: curr,
      maximumFractionDigits: 2,
    }).format(amt);
  };

  const getStatusChip = (status: InvoiceStatus) => {
    switch (status) {
      case 'DRAFT':
        return (
          <Chip
            label="DRAFT"
            size="small"
            sx={{ bgcolor: 'grey.300', color: 'text.primary', fontWeight: 600 }}
          />
        );
      case 'ISSUED':
        return <Chip label="ISSUED" size="small" color="warning" sx={{ fontWeight: 600 }} />;
      case 'PAID':
        return <Chip label="PAID" size="small" color="success" sx={{ fontWeight: 600 }} />;
      case 'VOID':
        return <Chip label="VOID" size="small" color="error" sx={{ fontWeight: 600 }} />;
    }
  };

  const getDirectionChip = (dir: InvoiceDirection) => {
    if (dir === 'TO_LENDER') {
      return (
        <Chip
          label="To Lender"
          size="small"
          variant="outlined"
          color="primary"
          sx={{ fontWeight: 600, fontSize: '0.75rem' }}
        />
      );
    }
    return (
      <Chip
        label="From Connector"
        size="small"
        variant="outlined"
        color="secondary"
        sx={{ fontWeight: 600, fontSize: '0.75rem' }}
      />
    );
  };

  const invoiceColumns: Column<InvoiceRecord>[] = [
    {
      id: 'number',
      label: 'Invoice #',
      render: (inv) => (
        <Typography
          variant="body2"
          fontWeight={600}
          sx={{ cursor: 'pointer', color: 'primary.main', textDecoration: 'underline' }}
          onClick={(e) => {
            e.stopPropagation();
            setDetailsInvoice(inv);
          }}
        >
          {inv.number}
        </Typography>
      ),
    },
    {
      id: 'direction',
      label: 'Direction',
      render: (inv) => getDirectionChip(inv.direction),
    },
    {
      id: 'date',
      label: 'Date',
      render: (inv) => (
        <Box>
          <Typography variant="body2">{inv.date}</Typography>
          {inv.dueDate && (
            <Typography variant="caption" color="text.secondary" display="block">
              Due: {inv.dueDate}
            </Typography>
          )}
        </Box>
      ),
    },
    {
      id: 'partyName',
      label: 'Party Name',
      render: (inv) => (
        <Box>
          <Typography variant="body2" fontWeight={600}>
            {inv.partyName || inv.partyId}
          </Typography>
          {inv.partyName && (
            <Typography variant="caption" color="text.secondary" display="block">
              {inv.partyId}
            </Typography>
          )}
        </Box>
      ),
    },
    {
      id: 'amount',
      label: 'Amount',
      align: 'right',
      render: (inv) => (
        <Typography variant="body2" fontWeight={700}>
          {formatCurrency(inv.amount, inv.currency)}
        </Typography>
      ),
    },
    {
      id: 'taxes',
      label: 'Taxes',
      render: (inv) => (
        <Box>
          {inv.taxFields.gstRate ? (
            <Typography variant="caption" display="block">
              GST: {inv.taxFields.gstRate}% ({formatCurrency(Number(inv.taxFields.gstAmount ?? 0))})
            </Typography>
          ) : null}
          {inv.taxFields.tdsRate ? (
            <Typography variant="caption" color="text.secondary" display="block">
              TDS: {inv.taxFields.tdsRate}%
            </Typography>
          ) : null}
          {!inv.taxFields.gstRate && !inv.taxFields.tdsRate && (
            <Typography variant="caption" color="text.secondary">
              None
            </Typography>
          )}
        </Box>
      ),
    },
    {
      id: 'status',
      label: 'Status',
      render: (inv) => <StatusBadge status={inv.status} />,
    },
    {
      id: 'actions',
      label: 'Actions',
      align: 'center',
      render: (inv) => (
        <Stack direction="row" spacing={1} justifyContent="center" onClick={(e) => e.stopPropagation()}>
          {canManage && inv.status === 'DRAFT' && (
            <Button
              size="small"
              variant="outlined"
              color="warning"
              disabled={statusMutation.isPending}
              onClick={() =>
                statusMutation.mutate({
                  id: inv.id,
                  status: 'ISSUED',
                  lockVersion: inv.lockVersion,
                })
              }
              sx={{ textTransform: 'none', py: 0.25 }}
            >
              Issue
            </Button>
          )}

          {canManage && inv.status === 'ISSUED' && (
            <Button
              size="small"
              variant="contained"
              color="success"
              disabled={statusMutation.isPending}
              onClick={() =>
                statusMutation.mutate({
                  id: inv.id,
                  status: 'PAID',
                  lockVersion: inv.lockVersion,
                })
              }
              sx={{ textTransform: 'none', py: 0.25 }}
            >
              Mark Paid
            </Button>
          )}

          {canManage && (inv.status === 'DRAFT' || inv.status === 'ISSUED') && (
            <Button
              size="small"
              variant="text"
              color="error"
              disabled={statusMutation.isPending}
              onClick={() =>
                statusMutation.mutate({
                  id: inv.id,
                  status: 'VOID',
                  lockVersion: inv.lockVersion,
                })
              }
              sx={{ textTransform: 'none', py: 0.25 }}
            >
              Void
            </Button>
          )}

          <Button
            size="small"
            variant="text"
            onClick={() => setDetailsInvoice(inv)}
            sx={{ textTransform: 'none', py: 0.25 }}
          >
            Details
          </Button>
        </Stack>
      ),
    },
  ];

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      {/* Top Header */}
      <PageHeader
        title="Invoices & Statements"
        subtitle="Module 33 (MOD-INV) — Manage lender billing, connector invoices, and periodic payout account statements."
        actions={
          canManage ? (
            <Button
              variant="contained"
              color="primary"
              onClick={() => setRecordDialogOpen(true)}
              sx={{ px: 3, py: 1, borderRadius: 2, textTransform: 'none', fontWeight: 600, boxShadow: 2 }}
            >
              + Record Invoice
            </Button>
          ) : undefined
        }
      />

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs
          value={tabIndex}
          onChange={(_e, v) => setTabIndex(v)}
          textColor="primary"
          indicatorColor="primary"
          sx={{ '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, fontSize: '0.95rem' } }}
        >
          <Tab label="CMP-INV.01.1 Invoice Register" />
          <Tab label="CMP-INV.02.1 Statement Generator" />
        </Tabs>
      </Box>

      {/* ======================================================== */}
      {/* TAB 0: INVOICE REGISTER */}
      {/* ======================================================== */}
      {tabIndex === 0 && (
        <Box>
          {/* KPI Summary Cards */}
          <StatCardGrid columns={{ xs: 1, sm: 2, md: 4 }} sx={{ mb: 3 }}>
            <StatCard
              title="Total Volume"
              value={formatCurrency(metrics.totalAmount)}
              subtext={`${metrics.totalCount} invoices registered`}
            />
            <StatCard
              title="Billed to Lenders"
              value={formatCurrency(metrics.toLenderAmount)}
              subtext="Outbound commission billing"
              colorVariant="primary"
            />
            <StatCard
              title="From Connectors"
              value={formatCurrency(metrics.fromConnectorAmount)}
              subtext="Inbound partner payouts"
              colorVariant="secondary"
            />
            <StatCard
              title="Paid Volume"
              value={formatCurrency(metrics.paidAmount)}
              subtext={`${metrics.draftCount} draft · ${metrics.issuedCount} pending payment`}
              colorVariant="success"
            />
          </StatCardGrid>

          {/* Filter Toolbar */}
          <FilterToolbar
            searchPlaceholder="Search by invoice # or party name..."
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            onRefresh={() => refetchInvoices()}
            filters={
              <>
                <TextField
                  select
                  size="small"
                  label="Direction"
                  value={directionFilter}
                  onChange={(e) => setDirectionFilter(e.target.value)}
                  sx={{ minWidth: 170 }}
                >
                  <MenuItem value="ALL">All Directions</MenuItem>
                  <MenuItem value="TO_LENDER">To Lender (Billing)</MenuItem>
                  <MenuItem value="FROM_CONNECTOR">From Connector (Payout)</MenuItem>
                </TextField>
                <TextField
                  select
                  size="small"
                  label="Status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  sx={{ minWidth: 150 }}
                >
                  <MenuItem value="ALL">All Statuses</MenuItem>
                  <MenuItem value="DRAFT">Draft</MenuItem>
                  <MenuItem value="ISSUED">Issued</MenuItem>
                  <MenuItem value="PAID">Paid</MenuItem>
                  <MenuItem value="VOID">Void</MenuItem>
                </TextField>
              </>
            }
          />

          {/* Invoices Table */}
          {invoicesError ? (
            <Alert severity="error" sx={{ mb: 3 }}>
              {(invoicesError as any).message || 'Failed to load invoices'}
            </Alert>
          ) : (
            <DataTable<InvoiceRecord>
              columns={invoiceColumns}
              data={invoices}
              loading={invoicesLoading}
              emptyMessage="No invoices found"
              onRowClick={(inv) => setDetailsInvoice(inv)}
            />
          )}
        </Box>
      )}

      {/* ======================================================== */}
      {/* TAB 1: CONNECTOR STATEMENTS */}
      {/* ======================================================== */}
      {tabIndex === 1 && (
        <Box>
          {/* Statement Generator Selector Card */}
          <Card sx={{ p: 3, mb: 3, borderRadius: 2 }}>
            <Typography variant="h6" fontWeight={700} gutterBottom>
              Generate Connector Periodic Statement
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Reconciles opening balance, earned commissions from ledger/payables, payouts disbursed, and net
              closing balance.
            </Typography>

            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={4}>
                <ConnectorSelect
                  size="small"
                  label="Filter by Connector"
                  placeholder="Select partner or search by name/ID..."
                  value={statementConnectorId || null}
                  onChange={(id) => setStatementConnectorId(id ?? '')}
                />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField
                  fullWidth
                  size="small"
                  type="date"
                  label="From Date"
                  InputLabelProps={{ shrink: true }}
                  value={statementFromDate}
                  onChange={(e) => setStatementFromDate(e.target.value)}
                />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField
                  fullWidth
                  size="small"
                  type="date"
                  label="To Date"
                  InputLabelProps={{ shrink: true }}
                  value={statementToDate}
                  onChange={(e) => setStatementToDate(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={2}>
                <Button
                  fullWidth
                  variant="contained"
                  onClick={() => {
                    if (!statementConnectorId.trim()) {
                      toast.error('Please enter a Connector ID');
                      return;
                    }
                    setActiveConnectorId(statementConnectorId.trim());
                  }}
                  sx={{ height: 40, textTransform: 'none', fontWeight: 600 }}
                >
                  Generate
                </Button>
              </Grid>
            </Grid>
          </Card>

          {/* Statement Result Display */}
          {statementLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
              <CircularProgress />
            </Box>
          ) : statementError ? (
            <Alert severity="error" sx={{ mb: 3 }}>
              {(statementError as any).message || 'Failed to generate statement.'}
            </Alert>
          ) : !statementData ? (
            <Card sx={{ p: 6, textAlign: 'center', borderRadius: 2 }}>
              <Typography variant="h6" color="text.secondary">
                Enter a Connector ID to generate statement
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Select a connector and date period to view ledger entries and running balance.
              </Typography>
            </Card>
          ) : (
            <Box>
              {/* Summary Cards */}
              <StatCardGrid columns={{ xs: 1, sm: 2, md: 5 }} sx={{ mb: 3 }}>
                <StatCard
                  title="Opening Balance"
                  value={formatCurrency(statementData.openingBalance, statementData.currency)}
                  subtext={`As of ${statementData.fromDate}`}
                />
                <StatCard
                  title="Total Credits (+)"
                  value={`+${formatCurrency(statementData.totalCredits, statementData.currency)}`}
                  subtext="Commissions & Adjustments"
                  colorVariant="success"
                />
                <StatCard
                  title="Total Debits (-)"
                  value={`-${formatCurrency(statementData.totalDebits, statementData.currency)}`}
                  subtext="Disbursed Payouts"
                  colorVariant="error"
                />
                <StatCard
                  title="Net Change"
                  value={formatCurrency(statementData.netChange, statementData.currency)}
                  subtext="During statement period"
                  colorVariant={statementData.netChange >= 0 ? 'success' : 'error'}
                />
                <StatCard
                  title="Closing Balance"
                  value={formatCurrency(statementData.closingBalance, statementData.currency)}
                  subtext={`As of ${statementData.toDate}`}
                  colorVariant="primary"
                />
              </StatCardGrid>

              {/* Transactions Table */}
              <Card sx={{ borderRadius: 2, mb: 3, p: 2 }}>
                <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="subtitle1" fontWeight={700}>
                    Account Activity: <ConnectorName id={statementData.connectorId} typographyProps={{ fontWeight: 700 }} /> ({statementData.fromDate} to{' '}
                    {statementData.toDate})
                  </Typography>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => window.print()}
                    sx={{ textTransform: 'none' }}
                  >
                    Print / Export
                  </Button>
                </Box>
                <DataTable
                  columns={[
                    { id: 'date', label: 'Date', render: (entry: any) => entry.date },
                    {
                      id: 'type',
                      label: 'Type',
                      render: (entry: any) => <StatusBadge status={entry.type} />,
                    },
                    { id: 'description', label: 'Description', render: (entry: any) => entry.description },
                    {
                      id: 'referenceId',
                      label: 'Reference',
                      render: (entry: any) => (
                        <Typography variant="caption" color="text.secondary">
                          {entry.referenceId || '—'}
                        </Typography>
                      ),
                    },
                    {
                      id: 'credit',
                      label: 'Credit (+)',
                      align: 'right',
                      render: (entry: any) => (
                        <Typography variant="body2" sx={{ color: 'success.main', fontWeight: 600 }}>
                          {entry.credit > 0 ? `+${formatCurrency(entry.credit)}` : '—'}
                        </Typography>
                      ),
                    },
                    {
                      id: 'debit',
                      label: 'Debit (-)',
                      align: 'right',
                      render: (entry: any) => (
                        <Typography variant="body2" sx={{ color: 'error.main', fontWeight: 600 }}>
                          {entry.debit > 0 ? `-${formatCurrency(entry.debit)}` : '—'}
                        </Typography>
                      ),
                    },
                    {
                      id: 'runningBalance',
                      label: 'Balance',
                      align: 'right',
                      render: (entry: any) => (
                        <Typography variant="body2" fontWeight={700}>
                          {formatCurrency(entry.runningBalance)}
                        </Typography>
                      ),
                    },
                  ]}
                  data={statementData.entries}
                  emptyMessage="No ledger entries found during this period."
                />
              </Card>
            </Box>
          )}
        </Box>
      )}

      {/* ======================================================== */}
      {/* DIALOG: RECORD INVOICE */}
      {/* ======================================================== */}
      <Dialog open={recordDialogOpen} onClose={() => setRecordDialogOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleRecordSubmit}>
          <DialogTitle sx={{ fontWeight: 700 }}>Record New Invoice</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    select
                    fullWidth
                    label="Direction"
                    value={formDirection}
                    onChange={(e) => setFormDirection(e.target.value as InvoiceDirection)}
                  >
                    <MenuItem value="TO_LENDER">To Lender (Billing)</MenuItem>
                    <MenuItem value="FROM_CONNECTOR">From Connector (Payout)</MenuItem>
                  </TextField>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    required
                    label="Invoice Number"
                    placeholder="e.g. INV-2026-0042"
                    value={formNumber}
                    onChange={(e) => setFormNumber(e.target.value)}
                  />
                </Grid>
              </Grid>

              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    required
                    type="date"
                    label="Invoice Date"
                    InputLabelProps={{ shrink: true }}
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    type="date"
                    label="Due Date"
                    InputLabelProps={{ shrink: true }}
                    value={formDueDate}
                    onChange={(e) => setFormDueDate(e.target.value)}
                  />
                </Grid>
              </Grid>

              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    required
                    label="Counterparty ID"
                    placeholder="lnd_… or con_…"
                    value={formPartyId}
                    onChange={(e) => setFormPartyId(e.target.value)}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Party Name"
                    placeholder="HDFC Bank Ltd"
                    value={formPartyName}
                    onChange={(e) => setFormPartyName(e.target.value)}
                  />
                </Grid>
              </Grid>

              <TextField
                fullWidth
                required
                type="number"
                label="Invoice Amount (INR)"
                placeholder="150000"
                value={formAmount}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '' || Number(val) >= 0) setFormAmount(val);
                }}
                inputProps={{ min: 0, step: 'any' }}
                onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }}
              />

              <Typography variant="subtitle2" fontWeight={600} color="text.secondary" sx={{ pt: 1 }}>
                Tax & Compliance Fields
              </Typography>

              <Grid container spacing={2}>
                <Grid item xs={4}>
                  <TextField
                    fullWidth
                    label="GST Rate (%)"
                    value={formGstRate}
                    onChange={(e) => setFormGstRate(e.target.value)}
                  />
                </Grid>
                <Grid item xs={4}>
                  <TextField
                    fullWidth
                    label="TDS Rate (%)"
                    value={formTdsRate}
                    onChange={(e) => setFormTdsRate(e.target.value)}
                  />
                </Grid>
                <Grid item xs={4}>
                  <TextField
                    fullWidth
                    label="HSN / SAC"
                    value={formHsnSac}
                    onChange={(e) => setFormHsnSac(e.target.value)}
                  />
                </Grid>
              </Grid>

              <TextField
                fullWidth
                multiline
                rows={2}
                label="Notes"
                placeholder="Disbursement commission payout notes..."
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 2 }}>
            <Button onClick={() => setRecordDialogOpen(false)} color="inherit" sx={{ textTransform: 'none' }}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={recordMutation.isPending}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              {recordMutation.isPending ? 'Recording...' : 'Record Invoice'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* ======================================================== */}
      {/* DIALOG: INVOICE DETAILS */}
      {/* ======================================================== */}
      {detailsInvoice && (
        <Dialog open={true} onClose={() => setDetailsInvoice(null)} maxWidth="sm" fullWidth>
          <DialogTitle
            sx={{ fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <span>Invoice: {detailsInvoice.number}</span>
            {getStatusChip(detailsInvoice.status)}
          </DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Direction
                  </Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {detailsInvoice.direction === 'TO_LENDER'
                      ? 'To Lender (Billing)'
                      : 'From Connector (Payout)'}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Total Amount
                  </Typography>
                  <Typography variant="body1" fontWeight={700} color="primary.main">
                    {formatCurrency(detailsInvoice.amount, detailsInvoice.currency)}
                  </Typography>
                </Grid>
              </Grid>

              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Invoice Date
                  </Typography>
                  <Typography variant="body2">{detailsInvoice.date}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Due Date
                  </Typography>
                  <Typography variant="body2">{detailsInvoice.dueDate || 'Immediate / Net 0'}</Typography>
                </Grid>
              </Grid>

              <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1.5 }}>
                <Typography variant="caption" color="text.secondary">
                  Counterparty
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {detailsInvoice.partyName
                    ? `${detailsInvoice.partyName} (${detailsInvoice.partyId})`
                    : detailsInvoice.partyId}
                </Typography>
              </Box>

              <Box>
                <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                  Tax Fields & Compliance
                </Typography>
                <Grid container spacing={1}>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">
                      GST Rate & Amount
                    </Typography>
                    <Typography variant="body2">
                      {detailsInvoice.taxFields.gstRate ?? 0}% (
                      {formatCurrency(Number(detailsInvoice.taxFields.gstAmount ?? 0))})
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">
                      TDS Rate & Amount
                    </Typography>
                    <Typography variant="body2">
                      {detailsInvoice.taxFields.tdsRate ?? 0}% (
                      {formatCurrency(Number(detailsInvoice.taxFields.tdsAmount ?? 0))})
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">
                      HSN/SAC Code
                    </Typography>
                    <Typography variant="body2">{detailsInvoice.taxFields.hsnSac || '—'}</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">
                      Lock Version (ETag)
                    </Typography>
                    <Typography variant="body2">{detailsInvoice.lockVersion}</Typography>
                  </Grid>
                </Grid>
              </Box>

              {detailsInvoice.notes && (
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Notes
                  </Typography>
                  <Typography variant="body2">{detailsInvoice.notes}</Typography>
                </Box>
              )}

              <Box sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary">
                  System ID: {detailsInvoice.id} · Created by {detailsInvoice.createdBy} at{' '}
                  {detailsInvoice.createdAt}
                </Typography>
              </Box>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 2 }}>
            <Button onClick={() => setDetailsInvoice(null)} sx={{ textTransform: 'none' }}>
              Close
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}
