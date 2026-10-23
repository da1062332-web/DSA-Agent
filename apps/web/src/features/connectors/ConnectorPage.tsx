// apps/web/src/features/connectors/ConnectorPage.tsx
// Module 27: Connector Management (MOD-CON) — Interactive Connector Workbench
import React, { useState } from 'react';
import {
  Alert,
  Box,
  Breadcrumbs,
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
  InputLabel,
  Link,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../api/client';
import { useMe } from '../../api/useMe';
import { Can } from '../../shell/Can';
import { ConnectorSelect, LeadSelect } from '../../shell/selectors';
import { BranchName, ConnectorName, LeadName, UserName } from '../../shell/display';
import { DataTable, PageHeader } from '../../ui';
import type {
  AttributionChangeRequestResource,
  AttributionDisputeResource,
  ConnectorAgreementResource,
  ConnectorBankAccountResource,
  ConnectorResource,
  ConnectorStatus,
  ConnectorType,
  CreateAttributionChangeRequestInput,
  CreateConnectorAgreementInput,
  CreateConnectorBankAccountInput,
  CreateConnectorInput,
  ResolveAttributionDisputeInput,
} from '@dsa/contracts';

const STATUS_COLORS: Record<
  string,
  'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'
> = {
  DRAFT: 'default',
  PENDING_VERIFICATION: 'warning',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  TERMINATED: 'error',
  PENDING_APPROVAL: 'warning',
  RESOLVED: 'success',
  OPEN: 'error',
  UNDER_REVIEW: 'info',
};

export function ConnectorPage() {
  const queryClient = useQueryClient();
  const me = useMe();

  // Top-level tab state (when in directory view)
  const [activeMainTab, setActiveMainTab] = useState(0);

  // Selected Connector for Detail / Workspace view
  const [selectedConnector, setSelectedConnector] = useState<ConnectorResource | null>(null);
  // Inner tab state for the selected connector's workspace
  const [activeConnectorTab, setActiveConnectorTab] = useState(0);

  // Dialog states
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [activateModalOpen, setActivateModalOpen] = useState(false);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [bankModalOpen, setBankModalOpen] = useState(false);
  const [agreementModalOpen, setAgreementModalOpen] = useState(false);
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [disputeModalOpen, setDisputeModalOpen] = useState(false);

  const [selectedDispute, setSelectedDispute] = useState<AttributionDisputeResource | null>(null);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  // Form states
  const [newConnector, setNewConnector] = useState<Partial<CreateConnectorInput>>({
    connectorType: 'INDIVIDUAL',
    legalName: '',
    contactPerson: '',
    mobileE164: '',
    email: '',
    pan: '',
  });

  const [activationVerificationId, setActivationVerificationId] = useState('');
  const [targetStatus, setTargetStatus] = useState<'ACTIVE' | 'SUSPENDED' | 'TERMINATED'>('SUSPENDED');
  const [statusReason, setStatusReason] = useState('');

  const [bankAccountInput, setBankAccountInput] = useState<Partial<CreateConnectorBankAccountInput>>({
    accountHolderName: '',
    accountNumber: '',
    ifscCode: '',
  });

  const [agreementInput, setAgreementInput] = useState<Partial<CreateConnectorAgreementInput>>({
    validFrom: new Date().toISOString(),
    validTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    permittedProducts: ['HL', 'LAP'],
    shareRuleScope: 'DEFAULT_STANDARD_RATE',
    evidenceRef: 'upl_signed_agreement_sample',
  });

  const [attributionInput, setAttributionInput] = useState<Partial<CreateAttributionChangeRequestInput>>({
    leadId: '',
    proposedConnectorId: '',
    reason: '',
    evidenceRef: 'upl_referral_proof_sample',
  });

  const [disputeResolutionInput, setDisputeResolutionInput] = useState<
    Partial<ResolveAttributionDisputeInput>
  >({
    resolution: 'ATTRIBUTED_TO_FIRST',
    resolvedConnectorId: null,
    resolutionNotes: '',
  });

  // Queries
  const connectorsQuery = useQuery({
    queryKey: ['connectors', statusFilter, searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (searchQuery) params.set('q', searchQuery);
      const res = await apiFetch<{ items: ConnectorResource[] }>(`/v1/connectors?${params.toString()}`);
      return res.items;
    },
  });

  const selectedBankAccountsQuery = useQuery({
    queryKey: ['connector-bank-accounts', selectedConnector?.id],
    queryFn: async () => {
      if (!selectedConnector) return [];
      const res = await apiFetch<{ items: ConnectorBankAccountResource[] }>(
        `/v1/connectors/${selectedConnector.id}/bank-accounts`,
      );
      return res.items;
    },
    enabled: !!selectedConnector,
  });

  const selectedAgreementsQuery = useQuery({
    queryKey: ['connector-agreements', selectedConnector?.id],
    queryFn: async () => {
      if (!selectedConnector) return [];
      const res = await apiFetch<{ items: ConnectorAgreementResource[] }>(
        `/v1/connectors/${selectedConnector.id}/agreements`,
      );
      return res.items;
    },
    enabled: !!selectedConnector,
  });

  const attributionRequestsQuery = useQuery({
    queryKey: ['attribution-change-requests'],
    queryFn: async () => {
      const res = await apiFetch<{ items: AttributionChangeRequestResource[] }>(
        '/v1/attribution-change-requests',
      );
      return res.items;
    },
  });

  const disputesQuery = useQuery({
    queryKey: ['attribution-disputes'],
    queryFn: async () => {
      const res = await apiFetch<{ items: AttributionDisputeResource[] }>('/v1/attribution-disputes');
      return res.items;
    },
  });

  // Mutations
  const createConnectorMutation = useMutation({
    meta: { successMessage: 'Connector created.' },
    mutationFn: async (data: CreateConnectorInput) => {
      return apiFetch<ConnectorResource>('/v1/connectors', {
        method: 'POST',
        headers: {
          'Idempotency-Key': `con_idem_${Date.now()}`,
        },
        body: JSON.stringify(data),
      });
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
      setCreateModalOpen(false);
      setSelectedConnector(created);
      setActiveConnectorTab(0);
    },
  });

  const activateConnectorMutation = useMutation({
    meta: { successMessage: 'Connector activated.' },
    mutationFn: async ({
      id,
      lockVersion,
      verificationId,
    }: {
      id: string;
      lockVersion: number;
      verificationId: string;
    }) => {
      return apiFetch<ConnectorResource>(`/v1/connectors/${id}/activation`, {
        method: 'POST',
        headers: {
          'If-Match': `"${lockVersion}"`,
          'Idempotency-Key': `act_idem_${Date.now()}`,
        },
        body: JSON.stringify({ verificationId }),
      });
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
      if (selectedConnector && selectedConnector.id === updated.id) {
        setSelectedConnector(updated);
      }
      setActivateModalOpen(false);
    },
  });

  const updateStatusMutation = useMutation({
    meta: { successMessage: 'Connector status updated.' },
    mutationFn: async ({
      id,
      lockVersion,
      targetStatus,
      reason,
    }: {
      id: string;
      lockVersion: number;
      targetStatus: string;
      reason: string;
    }) => {
      return apiFetch<ConnectorResource>(`/v1/connectors/${id}/status`, {
        method: 'POST',
        headers: {
          'If-Match': `"${lockVersion}"`,
          'Idempotency-Key': `stat_idem_${Date.now()}`,
        },
        body: JSON.stringify({ targetStatus, reason }),
      });
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
      if (selectedConnector && selectedConnector.id === updated.id) {
        setSelectedConnector(updated);
      }
      setStatusModalOpen(false);
    },
  });

  const createBankAccountMutation = useMutation({
    meta: { successMessage: 'Bank account added.' },
    mutationFn: async ({
      connectorId,
      data,
    }: {
      connectorId: string;
      data: CreateConnectorBankAccountInput;
    }) => {
      return apiFetch<ConnectorBankAccountResource>(`/v1/connectors/${connectorId}/bank-accounts`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': `bank_idem_${Date.now()}`,
        },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connector-bank-accounts'] });
      setBankModalOpen(false);
    },
  });

  const approveBankAccountMutation = useMutation({
    meta: { successMessage: 'Bank account approved.' },
    mutationFn: async ({ connectorId, accountId }: { connectorId: string; accountId: string }) => {
      return apiFetch<ConnectorBankAccountResource>(
        `/v1/connectors/${connectorId}/bank-accounts/${accountId}/approval`,
        {
          method: 'POST',
          body: JSON.stringify({ remarks: 'Approved from workbench' }),
        },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connector-bank-accounts'] });
    },
  });

  const createAgreementMutation = useMutation({
    meta: { successMessage: 'Agreement saved.' },
    mutationFn: async ({
      connectorId,
      data,
    }: {
      connectorId: string;
      data: CreateConnectorAgreementInput;
    }) => {
      return apiFetch<ConnectorAgreementResource>(`/v1/connectors/${connectorId}/agreements`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': `agr_idem_${Date.now()}`,
        },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connector-agreements'] });
      setAgreementModalOpen(false);
    },
  });

  const createAttributionMutation = useMutation({
    meta: { successMessage: 'Attribution change requested.' },
    mutationFn: async (data: CreateAttributionChangeRequestInput) => {
      return apiFetch<AttributionChangeRequestResource>('/v1/attribution-change-requests', {
        method: 'POST',
        headers: {
          'Idempotency-Key': `car_idem_${Date.now()}`,
        },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attribution-change-requests'] });
      setReassignModalOpen(false);
    },
  });

  const approveAttributionMutation = useMutation({
    meta: { successMessage: 'Attribution change approved.' },
    mutationFn: async ({ id, lockVersion }: { id: string; lockVersion: number }) => {
      return apiFetch<AttributionChangeRequestResource>(`/v1/attribution-change-requests/${id}/approval`, {
        method: 'POST',
        headers: {
          'If-Match': `"${lockVersion}"`,
        },
        body: JSON.stringify({ remarks: 'Approved by authorized operator' }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attribution-change-requests'] });
    },
  });

  const resolveDisputeMutation = useMutation({
    meta: { successMessage: 'Dispute resolved.' },
    mutationFn: async ({
      id,
      lockVersion,
      data,
    }: {
      id: string;
      lockVersion: number;
      data: ResolveAttributionDisputeInput;
    }) => {
      return apiFetch<AttributionDisputeResource>(`/v1/attribution-disputes/${id}/resolution`, {
        method: 'POST',
        headers: {
          'If-Match': `"${lockVersion}"`,
        },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attribution-disputes'] });
      setDisputeModalOpen(false);
    },
  });

  // ==========================================
  // VIEW: INDIVIDUAL CONNECTOR WORKSPACE
  // ==========================================
  if (selectedConnector) {
    return (
      <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
        {/* Navigation Breadcrumbs & Back Button */}
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
          <Button
            size="small"
            variant="text"
            onClick={() => setSelectedConnector(null)}
            sx={{ fontWeight: 600, color: 'text.secondary' }}
          >
            ← Back to Directory
          </Button>
          <Breadcrumbs aria-label="breadcrumb">
            <Link
              underline="hover"
              color="inherit"
              sx={{ cursor: 'pointer', fontSize: '0.875rem' }}
              onClick={() => setSelectedConnector(null)}
            >
              Connectors
            </Link>
            <Typography color="text.primary" sx={{ fontSize: '0.875rem', fontWeight: 600 }}>
              {selectedConnector.legalName}
            </Typography>
          </Breadcrumbs>
        </Stack>

        <PageHeader
          title={selectedConnector.legalName}
          badge={
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip
                label={selectedConnector.status}
                color={STATUS_COLORS[selectedConnector.status] || 'default'}
                size="small"
                sx={{ fontWeight: 600 }}
              />
              <Chip label={selectedConnector.connectorType} size="small" variant="outlined" sx={{ fontWeight: 500 }} />
            </Stack>
          }
          subtitle={
            <Typography variant="body2" color="text.secondary">
              <strong>ID:</strong> <span style={{ fontFamily: 'monospace' }}>{selectedConnector.id}</span> •{' '}
              <strong>Contact:</strong> {selectedConnector.contactPerson} • <strong>Mobile:</strong>{' '}
              {selectedConnector.mobileE164} • <strong>Email:</strong> {selectedConnector.email} •{' '}
              <strong>PAN:</strong> <span style={{ fontFamily: 'monospace' }}>{selectedConnector.panMasked}</span>
            </Typography>
          }
          actions={
            <Stack direction="row" spacing={1}>
              {selectedConnector.status === 'DRAFT' && (
                <Can action="connector.manage">
                  <Button size="small" color="success" variant="contained" onClick={() => setActivateModalOpen(true)}>
                    Activate Connector
                  </Button>
                </Can>
              )}
              {selectedConnector.status === 'ACTIVE' && (
                <Can action="connector.manage">
                  <Button
                    size="small"
                    color="warning"
                    variant="outlined"
                    onClick={() => {
                      setTargetStatus('SUSPENDED');
                      setStatusModalOpen(true);
                    }}
                  >
                    Suspend
                  </Button>
                </Can>
              )}
              {selectedConnector.status === 'SUSPENDED' && (
                <Can action="connector.manage">
                  <Button
                    size="small"
                    color="primary"
                    variant="outlined"
                    onClick={() => {
                      setTargetStatus('ACTIVE');
                      setStatusModalOpen(true);
                    }}
                  >
                    Reinstate
                  </Button>
                </Can>
              )}
            </Stack>
          }
        />

        {/* Contextual Tabs inside this Connector */}
        <Paper sx={{ mb: 3, borderRadius: 2 }}>
          <Tabs
            value={activeConnectorTab}
            onChange={(_, v) => setActiveConnectorTab(v)}
            variant="scrollable"
            scrollButtons="auto"
          >
            <Tab label="Profile & KYC Details" />
            <Tab label={`Bank Accounts & SOD (${selectedBankAccountsQuery.data?.length || 0})`} />
            <Tab label={`Agreements & Rate Cards (${selectedAgreementsQuery.data?.length || 0})`} />
            <Tab label="Attributions & Disputes" />
          </Tabs>
        </Paper>

        {/* CONNECTOR TAB 0: Profile & Details */}
        {activeConnectorTab === 0 && (
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" fontWeight={700} gutterBottom>
                Profile & Operational Registration
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Primary registration entity, tax numbers, and assigned branch relationship details.
              </Typography>

              <Grid container spacing={3}>
                <Grid item xs={12} sm={6} md={4}>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                      LEGAL NAME
                    </Typography>
                    <Typography variant="body1" fontWeight={600}>
                      {selectedConnector.legalName}
                    </Typography>
                  </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                      ENTITY TYPE
                    </Typography>
                    <Typography variant="body1" fontWeight={600}>
                      {selectedConnector.connectorType}
                    </Typography>
                  </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                      PAN (PERMANENT ACCOUNT NUMBER)
                    </Typography>
                    <Typography variant="body1" fontWeight={600} sx={{ fontFamily: 'monospace' }}>
                      {selectedConnector.panMasked}
                    </Typography>
                  </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                      GSTIN
                    </Typography>
                    <Typography variant="body1" fontWeight={600} sx={{ fontFamily: 'monospace' }}>
                      {selectedConnector.gstin || 'Not registered / exempt'}
                    </Typography>
                  </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                      PRIMARY BRANCH
                    </Typography>
                    <Box sx={{ mt: 0.5 }}>
                      <BranchName id={selectedConnector.primaryBranchId} fallback="Default Branch" typographyProps={{ fontWeight: 600, variant: 'body1' }} />
                    </Box>
                  </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                      RELATIONSHIP MANAGER
                    </Typography>
                    <Box sx={{ mt: 0.5 }}>
                      <UserName id={selectedConnector.relationshipOwnerUserId} fallback="Unassigned" typographyProps={{ fontWeight: 600, variant: 'body1' }} />
                    </Box>
                  </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                      ONBOARDED ON
                    </Typography>
                    <Typography variant="body1" fontWeight={600}>
                      {new Date(selectedConnector.createdAt).toLocaleDateString()}
                    </Typography>
                  </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                      VERSION LOCK
                    </Typography>
                    <Typography variant="body1" fontWeight={600} sx={{ fontFamily: 'monospace' }}>
                      v{selectedConnector.lockVersion}
                    </Typography>
                  </Paper>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        )}

        {/* CONNECTOR TAB 1: Bank Accounts & SOD */}
        {activeConnectorTab === 1 && (
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent sx={{ p: 3 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Box>
                  <Typography variant="h6" fontWeight={700}>
                    Bank Accounts & Dual-Control SOD
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Requires Dual-Control Separation of Duties (SOD). The account creator cannot approve the bank
                    details. A 24-hr cooling period applies after activation.
                  </Typography>
                </Box>
                <Can action="connector.manage">
                  <Button
                    variant="contained"
                    color="primary"
                    size="small"
                    onClick={() => {
                      setBankAccountInput({
                        accountHolderName: selectedConnector.legalName,
                        accountNumber: '',
                        ifscCode: '',
                      });
                      setBankModalOpen(true);
                    }}
                  >
                    + Add Bank Account
                  </Button>
                </Can>
              </Stack>

              {selectedBankAccountsQuery.isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : selectedBankAccountsQuery.data && selectedBankAccountsQuery.data.length > 0 ? (
                <DataTable<(typeof selectedBankAccountsQuery.data)[number]>
                  dataTestId="con.table.bank-accounts"
                  data={selectedBankAccountsQuery.data}
                  keyExtractor={(acc) => acc.id}
                  columns={[
                    { id: 'holder', header: 'Account Holder', render: (acc) => <Box sx={{ fontWeight: 600 }}>{acc.accountHolderName}</Box> },
                    { id: 'masked', header: 'Account Number (Masked)', render: (acc) => <Box sx={{ fontFamily: 'monospace' }}>{acc.accountMasked}</Box> },
                    { id: 'ifsc', header: 'IFSC Code', render: (acc) => <Box sx={{ fontFamily: 'monospace' }}>{acc.ifscCode}</Box> },
                    {
                      id: 'status',
                      header: 'Status',
                      render: (acc) => (
                        <Chip label={acc.status} color={STATUS_COLORS[acc.status] || 'default'} size="small" sx={{ fontWeight: 600 }} />
                      ),
                    },
                    {
                      id: 'cooling',
                      header: 'Cooling Period',
                      render: (acc) =>
                        acc.coolingUntil ? (
                          <Typography variant="caption" color="warning.main">
                            Until {new Date(acc.coolingUntil).toLocaleTimeString()}
                          </Typography>
                        ) : (
                          '—'
                        ),
                    },
                    { id: 'createdBy', header: 'Created By', render: (acc) => <Box sx={{ fontFamily: 'monospace' }}>{acc.createdBy}</Box> },
                    {
                      id: 'sod',
                      header: 'Dual-Control SOD Actions',
                      align: 'right',
                      render: (acc) => (
                        <>
                          {acc.status === 'PENDING_APPROVAL' && (
                            <Can action="connector.bank_change_approve">
                              <Button
                                size="small"
                                color="success"
                                variant="contained"
                                onClick={() =>
                                  approveBankAccountMutation.mutate({
                                    connectorId: selectedConnector.id,
                                    accountId: acc.id,
                                  })
                                }
                              >
                                Approve (SOD)
                              </Button>
                            </Can>
                          )}
                          {acc.status === 'ACTIVE' && (
                            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                              <Chip
                                label="✓ Approved (Dual-Control Verified)"
                                color="success"
                                size="small"
                                sx={{ fontWeight: 600, bgcolor: 'rgba(46, 125, 50, 0.12)', color: 'success.main' }}
                              />
                              {acc.approvedBy && (
                                <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary', mt: 0.5 }}>
                                  Approver: {acc.approvedBy}
                                </Typography>
                              )}
                            </Box>
                          )}
                          {acc.status === 'DISABLED' && <Chip label="Disabled" size="small" variant="outlined" color="default" />}
                        </>
                      ),
                    },
                  ]}
                />
              ) : (
                <Alert severity="info">
                  No bank accounts registered for this connector yet. Add an account to enable automated payout disbursements.
                </Alert>
              )}
            </CardContent>
          </Card>
        )}

        {/* CONNECTOR TAB 2: Agreements & Rate Cards */}
        {activeConnectorTab === 2 && (
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent sx={{ p: 3 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Box>
                  <Typography variant="h6" fontWeight={700}>
                    Commercial Agreements & Commission Rate Scope
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Governs permitted product eligibility and rate cards without duplicating commission engine calculations.
                  </Typography>
                </Box>
                <Can action="connector.manage">
                  <Button
                    variant="contained"
                    color="primary"
                    size="small"
                    onClick={() => setAgreementModalOpen(true)}
                  >
                    + Create Agreement
                  </Button>
                </Can>
              </Stack>

              {selectedAgreementsQuery.isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : selectedAgreementsQuery.data && selectedAgreementsQuery.data.length > 0 ? (
                <DataTable<(typeof selectedAgreementsQuery.data)[number]>
                  dataTestId="con.table.agreements"
                  data={selectedAgreementsQuery.data}
                  keyExtractor={(agr) => agr.id}
                  columns={[
                    { id: 'id', header: 'Agreement ID', render: (agr) => <Box sx={{ fontFamily: 'monospace' }}>{agr.id}</Box> },
                    { id: 'version', header: 'Version', render: (agr) => `v${agr.version}` },
                    {
                      id: 'products',
                      header: 'Permitted Products',
                      render: (agr) => (
                        <Stack direction="row" spacing={0.5}>
                          {agr.permittedProducts.map((p) => (
                            <Chip key={p} label={p} size="small" />
                          ))}
                        </Stack>
                      ),
                    },
                    { id: 'scope', header: 'Rule Scope', render: (agr) => <Box sx={{ fontWeight: 600 }}>{agr.shareRuleScope}</Box> },
                    {
                      id: 'validity',
                      header: 'Validity Period',
                      render: (agr) => (
                        <>
                          {new Date(agr.validFrom).toLocaleDateString()} – {new Date(agr.validTo).toLocaleDateString()}
                        </>
                      ),
                    },
                    {
                      id: 'status',
                      header: 'Status',
                      render: (agr) => (
                        <Chip label={agr.status} color={STATUS_COLORS[agr.status] || 'default'} size="small" sx={{ fontWeight: 600 }} />
                      ),
                    },
                  ]}
                />
              ) : (
                <Alert severity="info">
                  No active commission agreements attached to this connector yet.
                </Alert>
              )}
            </CardContent>
          </Card>
        )}

        {/* CONNECTOR TAB 3: Attributions & Disputes */}
        {activeConnectorTab === 3 && (
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent sx={{ p: 3 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Box>
                  <Typography variant="h6" fontWeight={700}>
                    Attribution History & Lead Referral Conflicts
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    View attribution requests and duplicate referral disputes concerning {selectedConnector.legalName}.
                  </Typography>
                </Box>
                <Can action="connector.manage">
                  <Button
                    variant="outlined"
                    color="primary"
                    size="small"
                    onClick={() => {
                      setAttributionInput({
                        leadId: '',
                        proposedConnectorId: selectedConnector.id,
                        reason: '',
                        evidenceRef: 'upl_referral_proof_sample',
                      });
                      setReassignModalOpen(true);
                    }}
                  >
                    + Request Lead Attribution
                  </Button>
                </Can>
              </Stack>

              <Alert severity="info" sx={{ mb: 2 }}>
                Referrals originating from this connector are protected under first-touch attribution policies unless an attribution change request is reviewed under SOD-09.
              </Alert>
            </CardContent>
          </Card>
        )}

        {/* Common Modals that operate on selectedConnector */}
        {/* Dialog: Activate Connector */}
        <Dialog open={activateModalOpen} onClose={() => setActivateModalOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>Activate Connector</DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Activation requires evidence of a passed verification record in `MOD-VER`.
            </Typography>
            <TextField
              size="small"
              fullWidth
              label="Verification ID (ver_...)"
              required
              value={activationVerificationId}
              onChange={(e) => setActivationVerificationId(e.target.value)}
              placeholder="ver_01ARZ3NDEKTSV4RRFFQ69G5FAV"
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setActivateModalOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              color="success"
              disabled={!activationVerificationId}
              onClick={() => {
                activateConnectorMutation.mutate({
                  id: selectedConnector.id,
                  lockVersion: selectedConnector.lockVersion,
                  verificationId: activationVerificationId,
                });
              }}
            >
              Confirm Activation
            </Button>
          </DialogActions>
        </Dialog>

        {/* Dialog: Status Transition */}
        <Dialog open={statusModalOpen} onClose={() => setStatusModalOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>Change Connector Status</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Target Status</InputLabel>
                <Select
                  value={targetStatus}
                  label="Target Status"
                  onChange={(e) => setTargetStatus(e.target.value as any)}
                >
                  <MenuItem value="ACTIVE">ACTIVE (Reinstate)</MenuItem>
                  <MenuItem value="SUSPENDED">SUSPENDED (Hold Payouts & Revoke Portal)</MenuItem>
                  <MenuItem value="TERMINATED">TERMINATED (Permanent Debarment)</MenuItem>
                </Select>
              </FormControl>
              <TextField
                size="small"
                label="Transition Reason"
                multiline
                rows={3}
                required
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setStatusModalOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              color="warning"
              disabled={!statusReason}
              onClick={() => {
                updateStatusMutation.mutate({
                  id: selectedConnector.id,
                  lockVersion: selectedConnector.lockVersion,
                  targetStatus,
                  reason: statusReason,
                });
              }}
            >
              Apply Transition
            </Button>
          </DialogActions>
        </Dialog>

        {/* Dialog: Add Bank Account */}
        <Dialog open={bankModalOpen} onClose={() => setBankModalOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>Add Bank Account</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                size="small"
                label="Account Holder Name"
                required
                value={bankAccountInput.accountHolderName}
                onChange={(e) =>
                  setBankAccountInput({ ...bankAccountInput, accountHolderName: e.target.value })
                }
              />
              <TextField
                size="small"
                label="Account Number (9-18 digits)"
                required
                value={bankAccountInput.accountNumber}
                onChange={(e) => setBankAccountInput({ ...bankAccountInput, accountNumber: e.target.value })}
              />
              <TextField
                size="small"
                label="IFSC Code"
                placeholder="HDFC0001234"
                required
                value={bankAccountInput.ifscCode}
                onChange={(e) =>
                  setBankAccountInput({ ...bankAccountInput, ifscCode: e.target.value.toUpperCase() })
                }
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setBankModalOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              disabled={!bankAccountInput.accountNumber || !bankAccountInput.ifscCode}
              onClick={() => {
                createBankAccountMutation.mutate({
                  connectorId: selectedConnector.id,
                  data: bankAccountInput as CreateConnectorBankAccountInput,
                });
              }}
            >
              Submit for Approval
            </Button>
          </DialogActions>
        </Dialog>

        {/* Dialog: Create Agreement */}
        <Dialog open={agreementModalOpen} onClose={() => setAgreementModalOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>New Commission Agreement</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                size="small"
                label="Rule Set Scope / Rate Card"
                required
                value={agreementInput.shareRuleScope}
                onChange={(e) => setAgreementInput({ ...agreementInput, shareRuleScope: e.target.value })}
              />
              <TextField
                size="small"
                label="Signed Evidence Reference (Upload Link / Storage Key)"
                required
                value={agreementInput.evidenceRef}
                onChange={(e) => setAgreementInput({ ...agreementInput, evidenceRef: e.target.value })}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAgreementModalOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              onClick={() => {
                createAgreementMutation.mutate({
                  connectorId: selectedConnector.id,
                  data: agreementInput as CreateConnectorAgreementInput,
                });
              }}
            >
              Create Agreement
            </Button>
          </DialogActions>
        </Dialog>

        {/* Dialog: Request Reattribution */}
        <Dialog open={reassignModalOpen} onClose={() => setReassignModalOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Request Lead Reattribution</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <LeadSelect
                size="small"
                label="Lead"
                required
                value={attributionInput.leadId}
                onChange={(id) => setAttributionInput({ ...attributionInput, leadId: id ?? '' })}
              />
              <ConnectorSelect
                size="small"
                label="Proposed Connector"
                required
                value={attributionInput.proposedConnectorId}
                onChange={(id) =>
                  setAttributionInput({ ...attributionInput, proposedConnectorId: id ?? '' })
                }
              />
              <TextField
                size="small"
                label="Justification Reason"
                multiline
                rows={3}
                required
                value={attributionInput.reason}
                onChange={(e) => setAttributionInput({ ...attributionInput, reason: e.target.value })}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setReassignModalOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              disabled={
                !attributionInput.leadId || !attributionInput.proposedConnectorId || !attributionInput.reason
              }
              onClick={() =>
                createAttributionMutation.mutate(attributionInput as CreateAttributionChangeRequestInput)
              }
            >
              Submit Request
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    );
  }

  // ==========================================
  // VIEW: TOP-LEVEL DIRECTORY & WORKBENCH
  // ==========================================
  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
      <PageHeader
        title="Connector Management (MOD-CON)"
        subtitle="Direct Selling Agents (DSA), Broker Onboarding, Dual-Control Bank Accounts & Attribution Dispute Workbench"
        actions={
          <Can action="connector.manage">
            <Button
              variant="contained"
              color="primary"
              onClick={() => setCreateModalOpen(true)}
              sx={{ fontWeight: 600, px: 3 }}
            >
              + Onboard Connector
            </Button>
          </Can>
        }
      />

      {/* Main Tabs */}
      <Paper sx={{ mb: 3, borderRadius: 2 }}>
        <Tabs
          value={activeMainTab}
          onChange={(_, v) => setActiveMainTab(v)}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab label="Directory & Onboarding" />
          <Tab label={`Attribution Requests (${attributionRequestsQuery.data?.length || 0})`} />
          <Tab label={`Disputes & Duplicate Referrals (${disputesQuery.data?.length || 0})`} />
        </Tabs>
      </Paper>

      {/* TAB 0: Directory & Onboarding */}
      {activeMainTab === 0 && (
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 3 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
              <TextField
                size="small"
                label="Search by Name, Contact, or Email"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                sx={{ minWidth: 320 }}
              />
              <FormControl size="small" sx={{ width: 180 }}>
                <InputLabel>Status</InputLabel>
                <Select value={statusFilter} label="Status" onChange={(e) => setStatusFilter(e.target.value)}>
                  <MenuItem value="">All Statuses</MenuItem>
                  <MenuItem value="DRAFT">DRAFT</MenuItem>
                  <MenuItem value="ACTIVE">ACTIVE</MenuItem>
                  <MenuItem value="SUSPENDED">SUSPENDED</MenuItem>
                  <MenuItem value="TERMINATED">TERMINATED</MenuItem>
                </Select>
              </FormControl>
            </Stack>

            {connectorsQuery.isLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
              </Box>
            ) : connectorsQuery.data && connectorsQuery.data.length > 0 ? (
              <DataTable<(typeof connectorsQuery.data)[number]>
                dataTestId="con.table.connectors"
                data={connectorsQuery.data}
                keyExtractor={(con) => con.id}
                onRowClick={(con) => {
                  setSelectedConnector(con);
                  setActiveConnectorTab(0);
                }}
                columns={[
                  { id: 'id', header: 'Connector ID', render: (con) => <Box sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{con.id}</Box> },
                  {
                    id: 'legal',
                    header: 'Legal Name / Contact',
                    render: (con) => (
                      <>
                        <Typography variant="body2" fontWeight={600} color="primary.main">
                          {con.legalName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {con.contactPerson}
                        </Typography>
                      </>
                    ),
                  },
                  { id: 'type', header: 'Type', render: (con) => <Chip label={con.connectorType} size="small" variant="outlined" /> },
                  { id: 'pan', header: 'PAN (Masked)', render: (con) => <Box sx={{ fontFamily: 'monospace' }}>{con.panMasked}</Box> },
                  {
                    id: 'contact',
                    header: 'Email / Mobile',
                    render: (con) => (
                      <>
                        <Typography variant="body2">{con.email}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {con.mobileE164}
                        </Typography>
                      </>
                    ),
                  },
                  {
                    id: 'status',
                    header: 'Status',
                    render: (con) => (
                      <Chip label={con.status} color={STATUS_COLORS[con.status] || 'default'} size="small" sx={{ fontWeight: 600 }} />
                    ),
                  },
                  {
                    id: 'actions',
                    header: 'Actions',
                    align: 'right',
                    render: (con) => (
                      <Stack direction="row" spacing={1} justifyContent="flex-end" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => {
                            setSelectedConnector(con);
                            setActiveConnectorTab(0);
                          }}
                        >
                          Manage Details →
                        </Button>
                        {con.status === 'DRAFT' && (
                          <Can action="connector.manage">
                            <Button
                              size="small"
                              color="success"
                              variant="contained"
                              onClick={() => {
                                setSelectedConnector(con);
                                setActivateModalOpen(true);
                              }}
                            >
                              Activate
                            </Button>
                          </Can>
                        )}
                        {con.status === 'ACTIVE' && (
                          <Can action="connector.manage">
                            <Button
                              size="small"
                              color="warning"
                              variant="outlined"
                              onClick={() => {
                                setSelectedConnector(con);
                                setTargetStatus('SUSPENDED');
                                setStatusModalOpen(true);
                              }}
                            >
                              Suspend
                            </Button>
                          </Can>
                        )}
                        {con.status === 'SUSPENDED' && (
                          <Can action="connector.manage">
                            <Button
                              size="small"
                              color="primary"
                              variant="outlined"
                              onClick={() => {
                                setSelectedConnector(con);
                                setTargetStatus('ACTIVE');
                                setStatusModalOpen(true);
                              }}
                            >
                              Reinstate
                            </Button>
                          </Can>
                        )}
                      </Stack>
                    ),
                  },
                ]}
              />
            ) : (
              <Alert severity="info">No connectors found matching filter criteria.</Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 1: Attribution Requests (SOD-09) */}
      {activeMainTab === 1 && (
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 3 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Box>
                <Typography variant="h6" fontWeight={700}>
                  Attribution Change Requests
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Enforces SOD-09: Requester cannot approve their own change request. Reassignment executes
                  through security-definer function.
                </Typography>
              </Box>
              <Can action="connector.attribution_change">
                <Button
                  variant="contained"
                  color="primary"
                  size="small"
                  onClick={() => setReassignModalOpen(true)}
                >
                  + Request Reattribution
                </Button>
              </Can>
            </Stack>

            {attributionRequestsQuery.isLoading ? (
              <CircularProgress size={24} />
            ) : attributionRequestsQuery.data && attributionRequestsQuery.data.length > 0 ? (
              <DataTable<(typeof attributionRequestsQuery.data)[number]>
                dataTestId="con.table.attribution"
                data={attributionRequestsQuery.data}
                keyExtractor={(req) => req.id}
                columns={[
                  { id: 'id', header: 'Request ID', render: (req) => <Box sx={{ fontFamily: 'monospace' }}>{req.id}</Box> },
                  { id: 'lead', header: 'Lead ID', render: (req) => <LeadName id={req.leadId} linkToLead /> },
                  {
                    id: 'previous',
                    header: 'Previous Connector',
                    render: (req) => <ConnectorName id={req.previousConnectorId} fallback="None (Organic)" />,
                  },
                  {
                    id: 'proposed',
                    header: 'Proposed Connector',
                    render: (req) => <ConnectorName id={req.proposedConnectorId} typographyProps={{ fontWeight: 600 }} />,
                  },
                  { id: 'reason', header: 'Reason', render: (req) => req.reason },
                  {
                    id: 'status',
                    header: 'Status',
                    render: (req) => (
                      <Chip label={req.status} color={STATUS_COLORS[req.status] || 'default'} size="small" sx={{ fontWeight: 600 }} />
                    ),
                  },
                  { id: 'requester', header: 'Requester', render: (req) => <Box sx={{ fontFamily: 'monospace' }}>{req.requesterId}</Box> },
                  {
                    id: 'actions',
                    header: 'Actions',
                    align: 'right',
                    render: (req) =>
                      req.status === 'PENDING' ? (
                        <Button
                          size="small"
                          color="success"
                          variant="contained"
                          onClick={() =>
                            approveAttributionMutation.mutate({
                              id: req.id,
                              lockVersion: req.lockVersion,
                            })
                          }
                        >
                          Approve (SOD-09)
                        </Button>
                      ) : null,
                  },
                ]}
              />
            ) : (
              <Alert severity="info">No attribution change requests pending.</Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 2: Disputes & Duplicate Referrals */}
      {activeMainTab === 2 && (
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 3 }}>
            <Box sx={{ mb: 2 }}>
              <Typography variant="h6" fontWeight={700}>
                Attribution Disputes (BRE Conflict Handling)
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Triggered automatically by DecisionPort `DK-lead.duplicate` returning `ATTRIBUTION_CONFLICT`.
              </Typography>
            </Box>

            {disputesQuery.isLoading ? (
              <CircularProgress size={24} />
            ) : disputesQuery.data && disputesQuery.data.length > 0 ? (
              <DataTable<(typeof disputesQuery.data)[number]>
                dataTestId="con.table.disputes"
                data={disputesQuery.data}
                keyExtractor={(disp) => disp.id}
                columns={[
                  { id: 'id', header: 'Dispute ID', render: (disp) => <Box sx={{ fontFamily: 'monospace' }}>{disp.id}</Box> },
                  { id: 'lead', header: 'Lead ID', render: (disp) => <LeadName id={disp.leadId} linkToLead /> },
                  {
                    id: 'claimants',
                    header: 'Claimant Connectors',
                    render: (disp) => <Box sx={{ fontFamily: 'monospace' }}>{disp.claimantConnectorIds.join(', ')}</Box>,
                  },
                  { id: 'resolution', header: 'Resolution', render: (disp) => disp.resolution || 'Pending Adjudication' },
                  {
                    id: 'winner',
                    header: 'Winner Connector',
                    render: (disp) => <Box sx={{ fontFamily: 'monospace' }}>{disp.resolvedConnectorId || '—'}</Box>,
                  },
                  {
                    id: 'status',
                    header: 'Status',
                    render: (disp) => (
                      <Chip label={disp.status} color={STATUS_COLORS[disp.status] || 'default'} size="small" sx={{ fontWeight: 600 }} />
                    ),
                  },
                  {
                    id: 'actions',
                    header: 'Actions',
                    align: 'right',
                    render: (disp) =>
                      disp.status !== 'RESOLVED' ? (
                        <Can action="connector.dispute_resolve">
                          <Button
                            size="small"
                            color="primary"
                            variant="contained"
                            onClick={() => {
                              setSelectedDispute(disp);
                              setDisputeModalOpen(true);
                            }}
                          >
                            Adjudicate
                          </Button>
                        </Can>
                      ) : null,
                  },
                ]}
              />
            ) : (
              <Alert severity="info">No active attribution disputes found.</Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dialog: Create Connector */}
      <Dialog open={createModalOpen} onClose={() => setCreateModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Onboard New Connector</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Connector Entity Type</InputLabel>
              <Select
                value={newConnector.connectorType}
                label="Connector Entity Type"
                onChange={(e) =>
                  setNewConnector({ ...newConnector, connectorType: e.target.value as ConnectorType })
                }
              >
                <MenuItem value="INDIVIDUAL">Individual Agent</MenuItem>
                <MenuItem value="PROPRIETORSHIP">Proprietorship Firm</MenuItem>
                <MenuItem value="PARTNERSHIP">Partnership Firm</MenuItem>
                <MenuItem value="PVT_LTD">Private Limited Company</MenuItem>
                <MenuItem value="LLP">Limited Liability Partnership (LLP)</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="Legal Entity Name"
              required
              value={newConnector.legalName}
              onChange={(e) => setNewConnector({ ...newConnector, legalName: e.target.value })}
            />
            <TextField
              size="small"
              label="Contact Person"
              required
              value={newConnector.contactPerson}
              onChange={(e) => setNewConnector({ ...newConnector, contactPerson: e.target.value })}
            />
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <TextField
                  size="small"
                  fullWidth
                  label="Mobile (E.164)"
                  placeholder="+919876543210"
                  required
                  value={newConnector.mobileE164}
                  onChange={(e) => setNewConnector({ ...newConnector, mobileE164: e.target.value })}
                />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  size="small"
                  fullWidth
                  label="Email"
                  type="email"
                  required
                  value={newConnector.email}
                  onChange={(e) => setNewConnector({ ...newConnector, email: e.target.value })}
                />
              </Grid>
            </Grid>
            <TextField
              size="small"
              label="Permanent Account Number (PAN)"
              placeholder="ABCDE1234F"
              required
              value={newConnector.pan}
              onChange={(e) => setNewConnector({ ...newConnector, pan: e.target.value.toUpperCase() })}
              helperText="Encrypted via AES-256-GCM. Never logged or stored plaintext."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateModalOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!newConnector.legalName || !newConnector.pan || !newConnector.email}
            onClick={() => {
              createConnectorMutation.mutate({
                ...newConnector,
                primaryBranchId: newConnector.primaryBranchId || me.data?.primaryBranchId,
                relationshipOwnerUserId: newConnector.relationshipOwnerUserId || me.data?.id,
              } as CreateConnectorInput);
            }}
          >
            Create (Draft)
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog: Request Reattribution */}
      <Dialog open={reassignModalOpen} onClose={() => setReassignModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Request Lead Reattribution</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <LeadSelect
              size="small"
              label="Lead"
              required
              value={attributionInput.leadId}
              onChange={(id) => setAttributionInput({ ...attributionInput, leadId: id ?? '' })}
            />
            <ConnectorSelect
              size="small"
              label="Proposed Connector"
              required
              value={attributionInput.proposedConnectorId}
              onChange={(id) =>
                setAttributionInput({ ...attributionInput, proposedConnectorId: id ?? '' })
              }
            />
            <TextField
              size="small"
              label="Justification Reason"
              multiline
              rows={3}
              required
              value={attributionInput.reason}
              onChange={(e) => setAttributionInput({ ...attributionInput, reason: e.target.value })}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReassignModalOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={
              !attributionInput.leadId || !attributionInput.proposedConnectorId || !attributionInput.reason
            }
            onClick={() =>
              createAttributionMutation.mutate(attributionInput as CreateAttributionChangeRequestInput)
            }
          >
            Submit Request
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog: Adjudicate Dispute */}
      <Dialog open={disputeModalOpen} onClose={() => setDisputeModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Adjudicate Attribution Dispute</DialogTitle>
        <DialogContent>
          {selectedDispute && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2">
                <strong>Lead:</strong> <LeadName id={selectedDispute.leadId} linkToLead />
              </Typography>
              <Typography variant="body2">
                <strong>Claimants:</strong> {selectedDispute.claimantConnectorIds.join(', ')}
              </Typography>
              <FormControl fullWidth size="small">
                <InputLabel>Resolution Finding</InputLabel>
                <Select
                  value={disputeResolutionInput.resolution}
                  label="Resolution Finding"
                  onChange={(e) =>
                    setDisputeResolutionInput({
                      ...disputeResolutionInput,
                      resolution: e.target.value as any,
                    })
                  }
                >
                  <MenuItem value="ATTRIBUTED_TO_CLAIMANT">Award Attribution to Claimant</MenuItem>
                  <MenuItem value="ATTRIBUTED_TO_FIRST">Retain First Direct Connector</MenuItem>
                  <MenuItem value="SPLIT_COMMISSION">Split Commission Split Model</MenuItem>
                  <MenuItem value="DISMISSED_ORGANIC">Dismiss as Organic Ingestion</MenuItem>
                </Select>
              </FormControl>
              <ConnectorSelect
                size="small"
                label="Winning Connector (if applicable)"
                value={disputeResolutionInput.resolvedConnectorId || null}
                onChange={(id) =>
                  setDisputeResolutionInput({
                    ...disputeResolutionInput,
                    resolvedConnectorId: id,
                  })
                }
              />
              <TextField
                size="small"
                label="Adjudication Findings & Notes"
                multiline
                rows={3}
                required
                value={disputeResolutionInput.resolutionNotes}
                onChange={(e) =>
                  setDisputeResolutionInput({
                    ...disputeResolutionInput,
                    resolutionNotes: e.target.value,
                  })
                }
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisputeModalOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="success"
            disabled={!disputeResolutionInput.resolutionNotes}
            onClick={() => {
              if (selectedDispute) {
                resolveDisputeMutation.mutate({
                  id: selectedDispute.id,
                  lockVersion: selectedDispute.lockVersion,
                  data: disputeResolutionInput as ResolveAttributionDisputeInput,
                });
              }
            }}
          >
            Submit Ruling
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
