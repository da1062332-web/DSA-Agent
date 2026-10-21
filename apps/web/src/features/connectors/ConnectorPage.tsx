// apps/web/src/features/connectors/ConnectorPage.tsx
// Module 27: Connector Management (MOD-CON) — Interactive Connector Workbench
import React, { useState } from 'react';
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
  InputLabel,
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
  const [activeTab, setActiveTab] = useState(0);

  // Dialog states
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [activateModalOpen, setActivateModalOpen] = useState(false);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [bankModalOpen, setBankModalOpen] = useState(false);
  const [agreementModalOpen, setAgreementModalOpen] = useState(false);
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [disputeModalOpen, setDisputeModalOpen] = useState(false);

  const [selectedConnector, setSelectedConnector] = useState<ConnectorResource | null>(null);
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
      setCreateModalOpen(false);
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
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

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
      {/* Header Banner */}
      <Box sx={{ mb: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography variant="h4" fontWeight={700} color="text.primary">
              Connector Management (MOD-CON)
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Direct Selling Agents (DSA), Broker Onboarding, Dual-Control Bank Accounts & Attribution Dispute
              Workbench
            </Typography>
          </Box>
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
        </Stack>
      </Box>

      {/* Tabs */}
      <Paper sx={{ mb: 3 }}>
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab label="Directory & Onboarding" />
          <Tab label="Bank Accounts & SOD" />
          <Tab label="Agreements & Rate Cards" />
          <Tab label="Attribution Requests (SOD-09)" />
          <Tab label="Disputes & Duplicate Referrals" />
        </Tabs>
      </Paper>

      {/* TAB 0: Directory & Onboarding */}
      {activeTab === 0 && (
        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
              <TextField
                size="small"
                label="Search by Name, Contact, or Email"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                sx={{ width: 320 }}
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
              <TableContainer>
                <Table size="small">
                  <TableHead sx={{ bgcolor: 'action.hover' }}>
                    <TableRow>
                      <TableCell>Connector ID</TableCell>
                      <TableCell>Legal Name / Contact</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>PAN (Masked)</TableCell>
                      <TableCell>Email / Mobile</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {connectorsQuery.data.map((con) => (
                      <TableRow key={con.id} hover>
                        <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{con.id}</TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>
                            {con.legalName}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {con.contactPerson}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip label={con.connectorType} size="small" variant="outlined" />
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{con.panMasked}</TableCell>
                        <TableCell>
                          <Typography variant="body2">{con.email}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {con.mobileE164}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={con.status}
                            color={STATUS_COLORS[con.status] || 'default'}
                            size="small"
                          />
                        </TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => {
                                setSelectedConnector(con);
                                setActiveTab(1); // Jump to bank accounts tab
                              }}
                            >
                              Manage Details
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
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Alert severity="info">No connectors found matching filter criteria.</Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 1: Bank Accounts & SOD */}
      {activeTab === 1 && (
        <Card variant="outlined">
          <CardContent>
            {selectedConnector ? (
              <Box>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                  <Box>
                    <Typography variant="h6">
                      Bank Accounts for: {selectedConnector.legalName} ({selectedConnector.id})
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Requires Dual-Control Separation of Duties (SOD). Creator cannot approve. 24-hr cooling
                      period applies after activation.
                    </Typography>
                  </Box>
                  <Can action="connector.manage">
                    <Button
                      variant="contained"
                      color="primary"
                      size="small"
                      onClick={() => setBankModalOpen(true)}
                    >
                      + Add Bank Account
                    </Button>
                  </Can>
                </Stack>

                {selectedBankAccountsQuery.isLoading ? (
                  <CircularProgress size={24} />
                ) : selectedBankAccountsQuery.data && selectedBankAccountsQuery.data.length > 0 ? (
                  <TableContainer>
                    <Table size="small">
                      <TableHead sx={{ bgcolor: 'action.hover' }}>
                        <TableRow>
                          <TableCell>Account Holder</TableCell>
                          <TableCell>Account Number (Masked)</TableCell>
                          <TableCell>IFSC Code</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Cooling Period</TableCell>
                          <TableCell>Created By</TableCell>
                          <TableCell align="right">SOD Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {selectedBankAccountsQuery.data.map((acc) => (
                          <TableRow key={acc.id} hover>
                            <TableCell sx={{ fontWeight: 600 }}>{acc.accountHolderName}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace' }}>{acc.accountMasked}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace' }}>{acc.ifscCode}</TableCell>
                            <TableCell>
                              <Chip
                                label={acc.status}
                                color={STATUS_COLORS[acc.status] || 'default'}
                                size="small"
                              />
                            </TableCell>
                            <TableCell>
                              {acc.coolingUntil ? (
                                <Typography variant="caption" color="warning.main">
                                  Until {new Date(acc.coolingUntil).toLocaleTimeString()}
                                </Typography>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell sx={{ fontFamily: 'monospace' }}>{acc.createdBy}</TableCell>
                            <TableCell align="right">
                              {acc.status === 'PENDING_APPROVAL' && (
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
                              )}
                              {acc.status === 'ACTIVE' && (
                                <Box
                                  sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}
                                >
                                  <Chip
                                    label="✓ Approved (Dual-Control Verified)"
                                    color="success"
                                    size="small"
                                    sx={{
                                      fontWeight: 600,
                                      bgcolor: 'rgba(46, 125, 50, 0.12)',
                                      color: 'success.main',
                                    }}
                                  />
                                  {acc.approvedBy && (
                                    <Typography
                                      variant="caption"
                                      sx={{ fontFamily: 'monospace', color: 'text.secondary', mt: 0.5 }}
                                    >
                                      Approver: {acc.approvedBy}
                                    </Typography>
                                  )}
                                </Box>
                              )}
                              {acc.status === 'DISABLED' && (
                                <Chip label="Disabled" size="small" variant="outlined" color="default" />
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="info">No bank accounts registered for this connector yet.</Alert>
                )}
              </Box>
            ) : (
              <Alert severity="warning">
                Please select a connector from the Directory tab to view and manage bank accounts.
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 2: Agreements & Rate Cards */}
      {activeTab === 2 && (
        <Card variant="outlined">
          <CardContent>
            {selectedConnector ? (
              <Box>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                  <Box>
                    <Typography variant="h6">
                      Agreements & Commission Scope for: {selectedConnector.legalName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Governs product eligibility and links to rate card rules without duplicating commission
                      engine calculations.
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
                  <CircularProgress size={24} />
                ) : selectedAgreementsQuery.data && selectedAgreementsQuery.data.length > 0 ? (
                  <TableContainer>
                    <Table size="small">
                      <TableHead sx={{ bgcolor: 'action.hover' }}>
                        <TableRow>
                          <TableCell>Agreement ID</TableCell>
                          <TableCell>Version</TableCell>
                          <TableCell>Permitted Products</TableCell>
                          <TableCell>Rule Scope</TableCell>
                          <TableCell>Validity Period</TableCell>
                          <TableCell>Status</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {selectedAgreementsQuery.data.map((agr) => (
                          <TableRow key={agr.id} hover>
                            <TableCell sx={{ fontFamily: 'monospace' }}>{agr.id}</TableCell>
                            <TableCell>v{agr.version}</TableCell>
                            <TableCell>
                              <Stack direction="row" spacing={0.5}>
                                {agr.permittedProducts.map((p) => (
                                  <Chip key={p} label={p} size="small" />
                                ))}
                              </Stack>
                            </TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>{agr.shareRuleScope}</TableCell>
                            <TableCell>
                              {new Date(agr.validFrom).toLocaleDateString()} –{' '}
                              {new Date(agr.validTo).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={agr.status}
                                color={STATUS_COLORS[agr.status] || 'default'}
                                size="small"
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="info">No active agreements found for this connector.</Alert>
                )}
              </Box>
            ) : (
              <Alert severity="warning">
                Please select a connector from the Directory tab to view and manage agreements.
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 3: Attribution Requests (SOD-09) */}
      {activeTab === 3 && (
        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Box>
                <Typography variant="h6">Attribution Change Requests</Typography>
                <Typography variant="caption" color="text.secondary">
                  Enforces SOD-09: Requester cannot approve their own change request. Reassignment executes
                  through security-definer function.
                </Typography>
              </Box>
              <Can action="connector.manage">
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
              <TableContainer>
                <Table size="small">
                  <TableHead sx={{ bgcolor: 'action.hover' }}>
                    <TableRow>
                      <TableCell>Request ID</TableCell>
                      <TableCell>Lead ID</TableCell>
                      <TableCell>Previous Connector</TableCell>
                      <TableCell>Proposed Connector</TableCell>
                      <TableCell>Reason</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Requester</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {attributionRequestsQuery.data.map((req) => (
                      <TableRow key={req.id} hover>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{req.id}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{req.leadId}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>
                          {req.previousConnectorId || 'None (Organic)'}
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                          {req.proposedConnectorId}
                        </TableCell>
                        <TableCell>{req.reason}</TableCell>
                        <TableCell>
                          <Chip
                            label={req.status}
                            color={STATUS_COLORS[req.status] || 'default'}
                            size="small"
                          />
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{req.requesterId}</TableCell>
                        <TableCell align="right">
                          {req.status === 'PENDING' && (
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
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Alert severity="info">No attribution change requests pending.</Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 4: Disputes & Duplicate Referrals */}
      {activeTab === 4 && (
        <Card variant="outlined">
          <CardContent>
            <Box sx={{ mb: 2 }}>
              <Typography variant="h6">Attribution Disputes (BRE Conflict Handling)</Typography>
              <Typography variant="caption" color="text.secondary">
                Triggered automatically by DecisionPort `DK-lead.duplicate` returning `ATTRIBUTION_CONFLICT`.
              </Typography>
            </Box>

            {disputesQuery.isLoading ? (
              <CircularProgress size={24} />
            ) : disputesQuery.data && disputesQuery.data.length > 0 ? (
              <TableContainer>
                <Table size="small">
                  <TableHead sx={{ bgcolor: 'action.hover' }}>
                    <TableRow>
                      <TableCell>Dispute ID</TableCell>
                      <TableCell>Lead ID</TableCell>
                      <TableCell>Claimant Connectors</TableCell>
                      <TableCell>Resolution</TableCell>
                      <TableCell>Winner Connector</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {disputesQuery.data.map((disp) => (
                      <TableRow key={disp.id} hover>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{disp.id}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{disp.leadId}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>
                          {disp.claimantConnectorIds.join(', ')}
                        </TableCell>
                        <TableCell>{disp.resolution || 'Pending Adjudication'}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>
                          {disp.resolvedConnectorId || '—'}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={disp.status}
                            color={STATUS_COLORS[disp.status] || 'default'}
                            size="small"
                          />
                        </TableCell>
                        <TableCell align="right">
                          {disp.status !== 'RESOLVED' && (
                            <Can action="connector.manage">
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
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
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
                primaryBranchId: newConnector.primaryBranchId || me.data?.primaryBranchId || 'br_demo_01',
                relationshipOwnerUserId: newConnector.relationshipOwnerUserId || me.data?.id || 'usr_demo_01',
              } as CreateConnectorInput);
            }}
          >
            Create (Draft)
          </Button>
        </DialogActions>
      </Dialog>

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
              if (selectedConnector) {
                activateConnectorMutation.mutate({
                  id: selectedConnector.id,
                  lockVersion: selectedConnector.lockVersion,
                  verificationId: activationVerificationId,
                });
              }
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
              if (selectedConnector) {
                updateStatusMutation.mutate({
                  id: selectedConnector.id,
                  lockVersion: selectedConnector.lockVersion,
                  targetStatus,
                  reason: statusReason,
                });
              }
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
              if (selectedConnector) {
                createBankAccountMutation.mutate({
                  connectorId: selectedConnector.id,
                  data: bankAccountInput as CreateConnectorBankAccountInput,
                });
              }
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
              if (selectedConnector) {
                createAgreementMutation.mutate({
                  connectorId: selectedConnector.id,
                  data: agreementInput as CreateConnectorAgreementInput,
                });
              }
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
            <TextField
              size="small"
              label="Lead ID (lead_...)"
              required
              value={attributionInput.leadId}
              onChange={(e) => setAttributionInput({ ...attributionInput, leadId: e.target.value })}
            />
            <TextField
              size="small"
              label="Proposed Connector ID (con_...)"
              required
              value={attributionInput.proposedConnectorId}
              onChange={(e) =>
                setAttributionInput({ ...attributionInput, proposedConnectorId: e.target.value })
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
                <strong>Lead:</strong> {selectedDispute.leadId}
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
              <TextField
                size="small"
                label="Winning Connector ID (if applicable)"
                value={disputeResolutionInput.resolvedConnectorId || ''}
                onChange={(e) =>
                  setDisputeResolutionInput({
                    ...disputeResolutionInput,
                    resolvedConnectorId: e.target.value || null,
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
