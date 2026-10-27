// apps/web/src/features/privacy/PrivacyDashboard.tsx
// Module 29: Privacy and Consent Governance Dashboard
import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Collapse,
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
import { DataTable, PageHeader } from '../../ui';
import type { ConsentPurposeCode, DataSharingRecord, VerifyConsentResult } from '@dsa/contracts';
import { checkConsent, fetchDataSharingRecords, fetchPrivacyStats } from './api';
import { ApplicationSelect, CustomerSelect, LeadSelect } from '../../shell/selectors';
import { ApplicationName, LenderName } from '../../shell/display';

const KNOWN_FIELD_LABELS: Record<string, string> = {
  name: 'Full Name',
  pan: 'PAN Card Number',
  phone: 'Phone Number',
  mobile: 'Mobile Number',
  email: 'Email Address',
  address: 'Residential Address',
  dob: 'Date of Birth',
  income: 'Income / Salary Details',
  employment: 'Employment Status',
  aadhaar: 'Aadhaar (Last 4)',
  bank_account: 'Bank Account Details',
  cibil_score: 'Credit Score',
  cibil: 'CIBIL / Credit Score',
};

function formatFieldLabel(key: string): string {
  const normalized = key.toLowerCase().trim();
  if (KNOWN_FIELD_LABELS[normalized]) {
    return KNOWN_FIELD_LABELS[normalized];
  }
  return key
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatPurposeLabel(purpose: string): string {
  switch (purpose) {
    case 'LENDER_SUBMISSION':
      return 'Lender Submission (Loan Processing)';
    case 'PORTFOLIO_REVIEW':
      return 'Portfolio Review';
    case 'AUDIT_INSPECTION':
      return 'Audit & Compliance Inspection';
    default:
      return purpose.replace(/[_-]/g, ' ');
  }
}

export function PrivacyDashboard(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<number>(0);

  // Filter states for Data Sharing Inventory
  const [sharingSubjectFilter, setSharingSubjectFilter] = useState<string>('');
  const [sharingRecipientFilter, setSharingRecipientFilter] = useState<string>('ALL');
  const [sharingPurposeFilter, setSharingPurposeFilter] = useState<string>('ALL');

  // Selected sharing record for manifest modal
  const [selectedRecord, setSelectedRecord] = useState<DataSharingRecord | null>(null);
  const [showRawJson, setShowRawJson] = useState<boolean>(false);

  // Consent verification auditor form states
  const [verifyCustomerId, setVerifyCustomerId] = useState<string>('');
  const [verifyLeadId, setVerifyLeadId] = useState<string>('');
  const [verifyPurpose, setVerifyPurpose] = useState<ConsentPurposeCode>('LOAN_PROCESSING');
  const [verifyPurposeTarget, setVerifyPurposeTarget] = useState<string>('');
  const [verifyResult, setVerifyResult] = useState<VerifyConsentResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Masking preview sandbox states
  const [sandboxPhone, setSandboxPhone] = useState<string>('+91 98765 43210');
  const [sandboxEmail, setSandboxEmail] = useState<string>('customer.name@example.com');
  const [sandboxPan, setSandboxPan] = useState<string>('ABCDE1234F');
  const [sandboxNotes, setSandboxNotes] = useState<string>(
    'Customer Aadhaar 1234 5678 9012 mentioned verbally',
  );

  // Queries
  const {
    data: stats,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ['privacy-stats'],
    queryFn: fetchPrivacyStats,
  });

  const {
    data: sharingData,
    isLoading: sharingLoading,
    refetch: refetchSharing,
  } = useQuery({
    queryKey: ['privacy-data-sharing'],
    queryFn: () => fetchDataSharingRecords({ limit: 100, offset: 0 }),
  });

  // Verify Consent Mutation
  const verifyMutation = useMutation({
    meta: { successMessage: 'Verification saved.' },
    mutationFn: checkConsent,
    onSuccess: (data) => {
      setVerifyResult(data);
      setVerifyError(null);
    },
    onError: (err: Error) => {
      setVerifyError(err.message || 'Failed to verify consent');
      setVerifyResult(null);
    },
  });

  const handleVerifySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyCustomerId && !verifyLeadId) {
      setVerifyError('Please enter either a Customer ID or Lead ID');
      return;
    }
    verifyMutation.mutate({
      customerId: verifyCustomerId.trim() || undefined,
      leadId: verifyLeadId.trim() || undefined,
      purpose: verifyPurpose,
      purposeTarget: verifyPurposeTarget.trim() || undefined,
    });
  };

  // Masking Helpers for Sandbox
  const maskPhone = (phone: string): string => {
    const cleaned = phone.replace(/[^0-9+]/g, '');
    if (cleaned.length < 8) return cleaned;
    const prefix = cleaned.slice(0, 3);
    const suffix = cleaned.slice(-4);
    return `${prefix} ******${suffix}`;
  };

  const maskEmail = (email: string): string => {
    const parts = email.split('@');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return email;
    const user = parts[0];
    const domain = parts[1];
    const maskedUser = user.length <= 2 ? `${user}***` : `${user[0]}***${user[user.length - 1]}`;
    return `${maskedUser}@${domain}`;
  };

  const maskPan = (pan: string): string => {
    const cleaned = pan.toUpperCase().trim();
    if (cleaned.length !== 10) return cleaned;
    return `${cleaned.slice(0, 5)}****${cleaned.slice(-1)}`;
  };

  const detectAadhaarLeak = (text: string): boolean => {
    return /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/.test(text) || /\b\d{12}\b/.test(text);
  };

  // Filtered sharing records
  const filteredSharingRecords = (sharingData?.items || []).filter((r) => {
    if (sharingSubjectFilter && !r.subjectId.toLowerCase().includes(sharingSubjectFilter.toLowerCase())) {
      return false;
    }
    if (sharingRecipientFilter !== 'ALL' && r.recipientType !== sharingRecipientFilter) {
      return false;
    }
    if (sharingPurposeFilter !== 'ALL' && r.purpose !== sharingPurposeFilter) {
      return false;
    }
    return true;
  });

  return (
    <Container maxWidth={false} disableGutters data-testid="privacy.dashboard">
      <PageHeader
        title="Privacy &amp; Consent Governance"
        subtitle="DPDP Act 2023 & RBI Digital Lending Regulatory Governance • Data Classification, Consent Registry, and Sharing Audit"
        actions={
          <Stack direction="row" spacing={1.5}>
            <Button
              id="privacy-refresh-btn"
              variant="outlined"
              onClick={() => {
                void refetchStats();
                void refetchSharing();
              }}
              disabled={statsLoading || sharingLoading}
            >
              Refresh Metrics
            </Button>
          </Stack>
        }
      />

      {/* KPI Metric Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card
            elevation={0}
            sx={{
              p: 2.5,
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'success.light',
              bgcolor: 'background.paper',
              background: 'linear-gradient(145deg, rgba(46,125,50,0.04) 0%, rgba(255,255,255,0) 100%)',
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
              <Typography variant="subtitle2" color="text.secondary" fontWeight={600}>
                ACTIVE CONSENTS
              </Typography>
              <Chip
                label="Trigger Guarded"
                size="small"
                color="success"
                variant="outlined"
                sx={{ height: 22, fontSize: 11 }}
              />
            </Stack>
            <Typography variant="h3" fontWeight={700} color="success.main" sx={{ mb: 0.5 }}>
              {statsLoading ? <CircularProgress size={28} /> : (stats?.activeConsentsCount ?? 0)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              ENT-028 • Valid consents across leads &amp; customers
            </Typography>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card
            elevation={0}
            sx={{
              p: 2.5,
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'warning.light',
              bgcolor: 'background.paper',
              background: 'linear-gradient(145deg, rgba(237,108,2,0.04) 0%, rgba(255,255,255,0) 100%)',
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
              <Typography variant="subtitle2" color="text.secondary" fontWeight={600}>
                WITHDRAWN CONSENTS
              </Typography>
              <Chip
                label="Revocation Active"
                size="small"
                color="warning"
                variant="outlined"
                sx={{ height: 22, fontSize: 11 }}
              />
            </Stack>
            <Typography variant="h3" fontWeight={700} color="warning.main" sx={{ mb: 0.5 }}>
              {statsLoading ? <CircularProgress size={28} /> : (stats?.withdrawnConsentsCount ?? 0)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Gated with HTTP 422 CONSENT_REQUIRED
            </Typography>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card
            elevation={0}
            sx={{
              p: 2.5,
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'primary.light',
              bgcolor: 'background.paper',
              background: 'linear-gradient(145deg, rgba(25,118,210,0.04) 0%, rgba(255,255,255,0) 100%)',
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
              <Typography variant="subtitle2" color="text.secondary" fontWeight={600}>
                DATA SHARING EVENTS
              </Typography>
              <Chip
                label="Append-Only"
                size="small"
                color="primary"
                variant="outlined"
                sx={{ height: 22, fontSize: 11 }}
              />
            </Stack>
            <Typography variant="h3" fontWeight={700} color="primary.main" sx={{ mb: 0.5 }}>
              {statsLoading ? <CircularProgress size={28} /> : (stats?.totalSharingRecordsCount ?? 0)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              ENT-100 • Audited lender &amp; partner transmissions
            </Typography>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card
            elevation={0}
            sx={{
              p: 2.5,
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              background: 'linear-gradient(145deg, rgba(156,39,176,0.04) 0%, rgba(255,255,255,0) 100%)',
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
              <Typography variant="subtitle2" color="text.secondary" fontWeight={600}>
                DATA CLASSIFICATION
              </Typography>
              <Chip
                label="S0 - S4 Active"
                size="small"
                sx={{ height: 22, fontSize: 11, bgcolor: 'secondary.main', color: '#fff' }}
              />
            </Stack>
            <Typography variant="h3" fontWeight={700} color="secondary.main" sx={{ mb: 0.5 }}>
              5 Tiers
            </Typography>
            <Typography variant="caption" color="text.secondary">
              HMAC Blind Index + Aadhaar Leak Blocker
            </Typography>
          </Card>
        </Grid>
      </Grid>

      {/* Main Tabs Navigation */}
      <Paper elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', mb: 4 }}>
        <Tabs
          value={activeTab}
          onChange={(_e, val: number) => setActiveTab(val)}
          sx={{
            px: 3,
            pt: 1,
            borderBottom: '1px solid',
            borderColor: 'divider',
            '& .MuiTab-root': { fontWeight: 600, fontSize: 14, textTransform: 'none', minHeight: 48 },
          }}
        >
          <Tab label="Data Sharing Inventory (ENT-100)" id="tab-sharing" />
          <Tab label="Consent Verification Auditor" id="tab-consent" />
          <Tab label="Data Classification & Masking" id="tab-masking" />
          <Tab label="Retention & Legal Hold (OD-008)" id="tab-retention" />
          <Tab label="Data-Principal Rights (DSR)" id="tab-dsr" />
        </Tabs>

        {/* TAB 0: Data Sharing Inventory */}
        {activeTab === 0 && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
                External Data Sharing Audit Ledger (ENT-100)
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Immutable, trigger-enforced record of personal data, documents, and credit fields transmitted
                to external lenders and partners.
              </Typography>
            </Box>

            {/* Filter Controls */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} sm={4}>
                <ApplicationSelect
                  fullWidth
                  size="small"
                  label="Filter by Application"
                  placeholder="Select application..."
                  value={sharingSubjectFilter || null}
                  onChange={(id) => setSharingSubjectFilter(id ?? '')}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth size="small">
                  <InputLabel id="recipient-filter-label">Recipient Type</InputLabel>
                  <Select
                    labelId="recipient-filter-label"
                    value={sharingRecipientFilter}
                    label="Recipient Type"
                    onChange={(e) => setSharingRecipientFilter(e.target.value)}
                  >
                    <MenuItem value="ALL">All Recipient Types</MenuItem>
                    <MenuItem value="LENDER">Lender</MenuItem>
                    <MenuItem value="CO_LENDER">Co-Lender</MenuItem>
                    <MenuItem value="PARTNER">Partner</MenuItem>
                    <MenuItem value="AUDITOR">Auditor</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth size="small">
                  <InputLabel id="purpose-filter-label">Purpose</InputLabel>
                  <Select
                    labelId="purpose-filter-label"
                    value={sharingPurposeFilter}
                    label="Purpose"
                    onChange={(e) => setSharingPurposeFilter(e.target.value)}
                  >
                    <MenuItem value="ALL">All Purposes</MenuItem>
                    <MenuItem value="LENDER_SUBMISSION">Lender Submission</MenuItem>
                    <MenuItem value="PORTFOLIO_REVIEW">Portfolio Review</MenuItem>
                    <MenuItem value="AUDIT_INSPECTION">Audit Inspection</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>

            {/* Sharing Table */}
            {sharingLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
                <CircularProgress />
              </Box>
            ) : filteredSharingRecords.length === 0 ? (
              <Alert severity="info" sx={{ borderRadius: 2 }}>
                No data sharing events match the current filter criteria.
              </Alert>
            ) : (
              <DataTable<(typeof filteredSharingRecords)[number]>
                dataTestId="privacy.table.sharing"
                data={filteredSharingRecords}
                keyExtractor={(r) => r.id}
                columns={[
                  {
                    id: 'application',
                    header: 'Application',
                    render: (r) => (
                      <Box>
                        <ApplicationName id={r.subjectId} typographyProps={{ fontWeight: 600, variant: 'body2' }} />
                      </Box>
                    ),
                  },
                  {
                    id: 'recipient',
                    header: 'Recipient',
                    render: (r) => (
                      <Box>
                        {r.recipientType === 'LENDER' || r.recipientType === 'CO_LENDER' ? (
                          <LenderName id={r.recipientId} typographyProps={{ fontWeight: 600, variant: 'body2' }} />
                        ) : (
                          <Typography variant="body2" fontWeight={600}>
                            {r.recipientType.replace(/_/g, ' ')}
                          </Typography>
                        )}
                        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.25 }}>
                          <Chip label={r.recipientType} size="small" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                          <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                            {r.recipientType.replace(/_/g, ' ')}
                          </Typography>
                        </Stack>
                      </Box>
                    ),
                  },
                  {
                    id: 'purpose',
                    header: 'Purpose',
                    render: (r) => (
                      <Typography variant="body2" color="text.secondary">
                        {r.purpose.replace(/_/g, ' ')}
                      </Typography>
                    ),
                  },
                  {
                    id: 'channel',
                    header: 'Channel',
                    render: (r) => <Chip label={r.channel} size="small" sx={{ height: 20, fontSize: 11 }} />,
                  },
                  {
                    id: 'shared',
                    header: 'Shared At',
                    render: (r) => <Box sx={{ whiteSpace: 'nowrap', fontSize: 13 }}>{new Date(r.sharedAt).toLocaleString()}</Box>,
                  },
                  {
                    id: 'actions',
                    header: 'Actions',
                    render: (r) => (
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => setSelectedRecord(r)}
                        sx={{ fontSize: 12, textTransform: 'none', p: 0.5 }}
                      >
                        Inspect Manifest
                      </Button>
                    ),
                  },
                ]}
              />
            )}
          </Box>
        )}

        {/* TAB 1: Consent Verification Auditor Tool */}
        {activeTab === 1 && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
                Consent Verification &amp; Gating Auditor
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Audit active legal bases before loan processing or external data sharing. Validates consent on
                customers and pre-conversion leads.
              </Typography>
            </Box>

            <Grid container spacing={4}>
              <Grid item xs={12} md={5}>
                <Paper
                  component="form"
                  onSubmit={handleVerifySubmit}
                  elevation={0}
                  sx={{ p: 3, border: '1px solid', borderColor: 'divider', borderRadius: 2.5 }}
                >
                  <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
                    Consent Check Parameters
                  </Typography>

                  <Stack spacing={2.5}>
                    <CustomerSelect
                      fullWidth
                      size="small"
                      label="Customer"
                      placeholder="Select customer..."
                      value={verifyCustomerId || null}
                      onChange={(id) => setVerifyCustomerId(id ?? '')}
                      helperText="Check consent directly on customer profile"
                    />

                    <Divider>
                      <Typography variant="caption" color="text.secondary">
                        OR PRE-CONVERSION LEAD
                      </Typography>
                    </Divider>

                    <LeadSelect
                      fullWidth
                      size="small"
                      label="Lead"
                      placeholder="Select lead..."
                      value={verifyLeadId || null}
                      onChange={(id) => setVerifyLeadId(id ?? '')}
                      helperText="Check consent captured on original lead"
                    />

                    <FormControl fullWidth size="small">
                      <InputLabel id="verify-purpose-label">Consent Purpose</InputLabel>
                      <Select
                        labelId="verify-purpose-label"
                        id="select-verify-purpose"
                        value={verifyPurpose}
                        label="Consent Purpose"
                        onChange={(e) => setVerifyPurpose(e.target.value as ConsentPurposeCode)}
                      >
                        <MenuItem value="LOAN_PROCESSING">LOAN_PROCESSING</MenuItem>
                        <MenuItem value="SHARE_WITH_LENDER">SHARE_WITH_LENDER</MenuItem>
                        <MenuItem value="VERIFICATION_CHECK">VERIFICATION_CHECK</MenuItem>
                        <MenuItem value="CONTACT">CONTACT</MenuItem>
                        <MenuItem value="MARKETING">MARKETING</MenuItem>
                      </Select>
                    </FormControl>

                    <TextField
                      fullWidth
                      size="small"
                      label="Purpose Target (Optional)"
                      placeholder="e.g. HDFC_BANK"
                      value={verifyPurposeTarget}
                      onChange={(e) => setVerifyPurposeTarget(e.target.value)}
                      helperText="Target lender or specific verification provider"
                    />

                    <Button
                      id="btn-verify-consent"
                      type="submit"
                      variant="contained"
                      disabled={verifyMutation.isPending}
                      sx={{ py: 1, fontWeight: 600 }}
                    >
                      {verifyMutation.isPending ? 'Verifying...' : 'Verify Active Consent'}
                    </Button>
                  </Stack>
                </Paper>
              </Grid>

              <Grid item xs={12} md={7}>
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
                  Auditor Verification Output
                </Typography>

                {verifyError && (
                  <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
                    {verifyError}
                  </Alert>
                )}

                {!verifyResult && !verifyError ? (
                  <Paper
                    elevation={0}
                    sx={{
                      p: 4,
                      textAlign: 'center',
                      border: '1px dashed',
                      borderColor: 'divider',
                      borderRadius: 2.5,
                      bgcolor: 'background.default',
                    }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      Enter a Customer ID or Lead ID and click <strong>Verify Active Consent</strong> to audit
                      consent status.
                    </Typography>
                  </Paper>
                ) : verifyResult ? (
                  <Card
                    elevation={0}
                    sx={{
                      p: 3,
                      borderRadius: 2.5,
                      border: '1px solid',
                      borderColor:
                        verifyResult.status === 'ACTIVE'
                          ? 'success.main'
                          : verifyResult.status === 'WITHDRAWN'
                            ? 'warning.main'
                            : 'error.main',
                      bgcolor: 'background.paper',
                    }}
                  >
                    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
                      <Chip
                        label={verifyResult.status}
                        color={
                          verifyResult.status === 'ACTIVE'
                            ? 'success'
                            : verifyResult.status === 'WITHDRAWN'
                              ? 'warning'
                              : 'error'
                        }
                        sx={{ fontWeight: 700 }}
                      />
                      <Typography variant="h6" fontWeight={700}>
                        {verifyResult.hasConsent
                          ? 'Active Valid Consent Verified'
                          : verifyResult.status === 'WITHDRAWN'
                            ? 'Consent Has Been Revoked / Withdrawn'
                            : 'No Consent Record Found'}
                      </Typography>
                    </Stack>

                    <Divider sx={{ mb: 2 }} />

                    <Grid container spacing={2}>
                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">
                          CONSENT RECORD ID
                        </Typography>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                          {verifyResult.consentId || 'None'}
                        </Typography>
                      </Grid>

                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">
                          ORIGINATING SOURCE
                        </Typography>
                        <Typography variant="body2" fontWeight={600}>
                          {verifyResult.source
                            ? verifyResult.source === 'LEAD'
                              ? 'Lead Record (Pre-Conversion)'
                              : 'Customer Direct Record'
                            : 'N/A'}
                        </Typography>
                      </Grid>

                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">
                          PURPOSE &amp; TARGET
                        </Typography>
                        <Typography variant="body2" fontWeight={600}>
                          {verifyResult.purpose}{' '}
                          {verifyResult.purposeTarget ? `(${verifyResult.purposeTarget})` : ''}
                        </Typography>
                      </Grid>

                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">
                          CAPTURE CHANNEL
                        </Typography>
                        <Typography variant="body2" fontWeight={600}>
                          {verifyResult.channel || 'N/A'}
                        </Typography>
                      </Grid>

                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">
                          NOTICE VERSION
                        </Typography>
                        <Typography variant="body2" fontWeight={600}>
                          {verifyResult.noticeVersion || 'N/A'}
                        </Typography>
                      </Grid>

                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">
                          CAPTURED AT
                        </Typography>
                        <Typography variant="body2" fontWeight={600}>
                          {verifyResult.createdAt ? new Date(verifyResult.createdAt).toLocaleString() : 'N/A'}
                        </Typography>
                      </Grid>
                    </Grid>

                    {!verifyResult.hasConsent && (
                      <Alert severity="warning" sx={{ mt: 3, borderRadius: 2 }}>
                        Processing for purpose <strong>{verifyResult.purpose}</strong> is prohibited and will
                        throw HTTP 422 <code>CONSENT_REQUIRED</code>.
                      </Alert>
                    )}
                  </Card>
                ) : null}
              </Grid>
            </Grid>
          </Box>
        )}

        {/* TAB 2: Data Classification & Masking Framework */}
        {activeTab === 2 && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
                Field-Level Sensitivity Classification &amp; Masking Framework (S0–S4)
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Compliance with DPDP Act 2023, RBI Guidelines, and ISO 27701. Personal and sensitive financial
                data is masked by default in all view layers.
              </Typography>
            </Box>

            {/* Policy Tiers Table */}
            <Box sx={{ mb: 4 }}>
              <DataTable<NonNullable<typeof stats>['protectionPolicies'][number]>
                dataTestId="privacy.table.policies"
                data={stats?.protectionPolicies || []}
                keyExtractor={(p) => p.field}
                columns={[
                  {
                    id: 'tier',
                    header: 'Tier',
                    render: (p) => (
                      <Chip
                        label={p.tier}
                        size="small"
                        color={
                          p.tier === 'S4' ? 'error' : p.tier === 'S3' ? 'warning' : p.tier === 'S2' ? 'info' : p.tier === 'S1' ? 'primary' : 'default'
                        }
                        sx={{ fontWeight: 700, height: 22 }}
                      />
                    ),
                  },
                  {
                    id: 'field',
                    header: 'Field Category',
                    render: (p) => <Box sx={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 13 }}>{p.field}</Box>,
                  },
                  {
                    id: 'strategy',
                    header: 'Protection Strategy',
                    render: (p) => <Chip label={p.strategy} size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />,
                  },
                  {
                    id: 'description',
                    header: 'Governance Description',
                    render: (p) => <Box sx={{ fontSize: 13, color: 'text.secondary' }}>{p.description}</Box>,
                  },
                ]}
              />
            </Box>

            {/* Interactive Masking Sandbox */}
            <Paper
              elevation={0}
              sx={{
                p: 3,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2.5,
                bgcolor: 'background.default',
              }}
            >
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                Live Deterministic Masking Simulator
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Test how customer inputs are normalized, masked, and guarded against leaks in the system
                serializers:
              </Typography>

              <Grid container spacing={3}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Mobile Number (E.164)"
                    value={sandboxPhone}
                    onChange={(e) => setSandboxPhone(e.target.value)}
                    helperText={`Masked output: ${maskPhone(sandboxPhone)}`}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Email Address"
                    value={sandboxEmail}
                    onChange={(e) => setSandboxEmail(e.target.value)}
                    helperText={`Masked output: ${maskEmail(sandboxEmail)}`}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Permanent Account Number (PAN)"
                    value={sandboxPan}
                    onChange={(e) => setSandboxPan(e.target.value)}
                    helperText={`Masked output: ${maskPan(sandboxPan)}`}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Free Text Notes (Aadhaar Leak Blocker)"
                    value={sandboxNotes}
                    onChange={(e) => setSandboxNotes(e.target.value)}
                    error={detectAadhaarLeak(sandboxNotes)}
                    helperText={
                      detectAadhaarLeak(sandboxNotes)
                        ? 'BLOCKED: 12-digit Aadhaar pattern detected! API rejects payload.'
                        : 'Clean: No forbidden Aadhaar patterns detected.'
                    }
                  />
                </Grid>
              </Grid>
            </Paper>
          </Box>
        )}

        {/* TAB 3: Retention & Legal Hold Status */}
        {activeTab === 3 && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
                Retention Schedules &amp; Legal Hold Governance
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Compliance with statutory record-keeping periods under RBI, PMLA, and Limitation Act
                guidelines.
              </Typography>
            </Box>

            <Alert severity="warning" sx={{ mb: 3, borderRadius: 2 }}>
              <Typography variant="subtitle2" fontWeight={700}>
                Retention notice: hard deletion is not yet enabled
              </Typography>
              Retention schedules below are proposed baselines. Hard deletion and legal-hold records stay disabled until a formal legal opinion on retention is received.
            </Alert>

            <Grid container spacing={3}>
              <Grid item xs={12} md={4}>
                <Card
                  elevation={0}
                  sx={{
                    p: 3,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 2.5,
                    height: '100%',
                  }}
                >
                  <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                    KYC &amp; Identity Records
                  </Typography>
                  <Typography variant="h4" fontWeight={700} color="primary.main" sx={{ mb: 1 }}>
                    5 Years
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Mandatory retention under Prevention of Money Laundering Act (PMLA Rule 9) from the date
                    of cessation of customer relationship.
                  </Typography>
                  <Chip label="PMLA Mandated" size="small" variant="outlined" />
                </Card>
              </Grid>

              <Grid item xs={12} md={4}>
                <Card
                  elevation={0}
                  sx={{
                    p: 3,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 2.5,
                    height: '100%',
                  }}
                >
                  <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                    Loan Agreements &amp; Files
                  </Typography>
                  <Typography variant="h4" fontWeight={700} color="primary.main" sx={{ mb: 1 }}>
                    8 Years
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Retention post full loan repayment / closure to protect against disputes under the Indian
                    Limitation Act (1963).
                  </Typography>
                  <Chip label="Limitation Act" size="small" variant="outlined" />
                </Card>
              </Grid>

              <Grid item xs={12} md={4}>
                <Card
                  elevation={0}
                  sx={{
                    p: 3,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 2.5,
                    height: '100%',
                  }}
                >
                  <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                    Rejected / Unconverted Leads
                  </Typography>
                  <Typography variant="h4" fontWeight={700} color="primary.main" sx={{ mb: 1 }}>
                    1 Year
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    DPDP Act data minimization principle: Lead contact records with no active conversion are
                    scheduled for automated purge.
                  </Typography>
                  <Chip label="DPDP Minimization" size="small" variant="outlined" />
                </Card>
              </Grid>
            </Grid>
          </Box>
        )}

        {/* TAB 4: Data-Principal Rights (DSR) */}
        {activeTab === 4 && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
                Data-Principal Rights Management (DSR)
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Digital Personal Data Protection (DPDP) Act 2023 statutory rights for Indian data principals.
              </Typography>
            </Box>

            <Alert severity="info" sx={{ mb: 3, borderRadius: 2 }}>
              <Typography variant="subtitle2" fontWeight={700}>
                Data-principal requests are handled through Grievances
              </Typography>
              Data-principal request tickets are managed in the Grievances module.
            </Alert>

            <Grid container spacing={3}>
              <Grid item xs={12} sm={6} md={3}>
                <Paper
                  elevation={0}
                  sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
                >
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                    1. Right to Access
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Principal can request a summary of personal data being processed and third parties with
                    whom data has been shared.
                  </Typography>
                </Paper>
              </Grid>

              <Grid item xs={12} sm={6} md={3}>
                <Paper
                  elevation={0}
                  sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
                >
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                    2. Right to Correction
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Principal can request rectification of inaccurate contact points, address changes, or
                    incomplete profile details.
                  </Typography>
                </Paper>
              </Grid>

              <Grid item xs={12} sm={6} md={3}>
                <Paper
                  elevation={0}
                  sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
                >
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                    3. Right to Erasure
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Principal can request erasure of personal data that is no longer necessary for the purpose
                    it was collected (subject to PMLA statutory retention).
                  </Typography>
                </Paper>
              </Grid>

              <Grid item xs={12} sm={6} md={3}>
                <Paper
                  elevation={0}
                  sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
                >
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                    4. Grievance Redressal
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    SLA-bound complaint resolution workflow integrated into the Data Protection Officer (DPO)
                    ticketing queue.
                  </Typography>
                </Paper>
              </Grid>
            </Grid>
          </Box>
        )}
      </Paper>

      {/* Manifest Inspection Modal */}
      <Dialog
        open={Boolean(selectedRecord)}
        onClose={() => {
          setSelectedRecord(null);
          setShowRawJson(false);
        }}
        maxWidth="sm"
        fullWidth
        data-testid="dialog-sharing-manifest"
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography variant="h6" fontWeight={700}>
            Data Sharing Delivery Receipt
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Verified proof of personal data disclosed to an external lender
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          {selectedRecord && (() => {
            const fields: string[] = Array.isArray(selectedRecord.items?.fields)
              ? selectedRecord.items.fields
              : [];
            const checklistItems: string[] = Array.isArray(selectedRecord.items?.checklistItemIds)
              ? selectedRecord.items.checklistItemIds
              : [];

            return (
              <Stack spacing={2.5}>
                {/* Verified Consent & Legal Basis Card */}
                <Paper
                  elevation={0}
                  sx={{
                    p: 1.75,
                    border: '1px solid',
                    borderColor: 'success.main',
                    borderRadius: 2,
                    bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(46, 125, 50, 0.15)' : '#f0fdf4'),
                  }}
                >
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        bgcolor: 'success.main',
                        flexShrink: 0,
                      }}
                    />
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" fontWeight={700} color="success.main">
                        Customer Consent Verified
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                        Authorized under Consent ID:{' '}
                        <Box component="span" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                          {selectedRecord.consentIds.join(', ')}
                        </Box>
                      </Typography>
                    </Box>
                  </Stack>
                </Paper>

                {/* Transfer Summary Grid */}
                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                      RECIPIENT LENDER
                    </Typography>
                    <Box sx={{ mt: 0.5 }}>
                      {selectedRecord.recipientType === 'LENDER' || selectedRecord.recipientType === 'CO_LENDER' ? (
                        <LenderName id={selectedRecord.recipientId} typographyProps={{ fontWeight: 600, variant: 'body2' }} />
                      ) : (
                        <Typography variant="body2" fontWeight={600}>
                          {selectedRecord.recipientType.replace(/_/g, ' ')}
                        </Typography>
                      )}
                      <Chip
                        label={selectedRecord.recipientType}
                        size="small"
                        variant="outlined"
                        sx={{ height: 18, fontSize: 10, mt: 0.5 }}
                      />
                    </Box>
                  </Grid>

                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                      PURPOSE
                    </Typography>
                    <Typography variant="body2" fontWeight={600} sx={{ mt: 0.5 }}>
                      {formatPurposeLabel(selectedRecord.purpose)}
                    </Typography>
                  </Grid>

                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                      TRANSMISSION CHANNEL
                    </Typography>
                    <Box sx={{ mt: 0.5 }}>
                      <Chip
                        label={selectedRecord.channel}
                        size="small"
                        color="primary"
                        variant="outlined"
                        sx={{ fontWeight: 600, height: 22, fontSize: 11 }}
                      />
                    </Box>
                  </Grid>

                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                      SOURCE REFERENCE
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 13, mt: 0.5 }}>
                      {selectedRecord.sourceRef}
                    </Typography>
                  </Grid>
                </Grid>

                <Divider />

                {/* Shared Data - User Friendly Badges */}
                <Box>
                  <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ display: 'block', mb: 0.5 }}>
                    SHARED PERSONAL DATA (MINIMIZATION COMPLIANT)
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                    Only these specific field categories were shared with the lender (raw values are never stored in audit logs):
                  </Typography>

                  {fields.length > 0 ? (
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                      {fields.map((field) => (
                        <Chip
                          key={field}
                          label={formatFieldLabel(field)}
                          size="small"
                          color="info"
                          variant="filled"
                          sx={{ fontWeight: 600, fontSize: 12 }}
                        />
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary" fontStyle="italic">
                      No personal profile fields listed.
                    </Typography>
                  )}

                  {checklistItems.length > 0 && (
                    <Box sx={{ mt: 1.5 }}>
                      <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>
                        Checklist Documents Attached:
                      </Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {checklistItems.map((docId) => (
                          <Chip
                            key={docId}
                            label={docId}
                            size="small"
                            variant="outlined"
                            sx={{ fontFamily: 'monospace', fontSize: 11 }}
                          />
                        ))}
                      </Stack>
                    </Box>
                  )}
                </Box>

                <Divider />

                {/* Technical / Audit Details Collapsible */}
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => setShowRawJson((prev) => !prev)}
                      sx={{ fontSize: 11, textTransform: 'none', py: 0 }}
                    >
                      {showRawJson ? 'Hide Technical JSON' : 'View Technical JSON'}
                    </Button>
                  </Box>

                  <Collapse in={showRawJson}>
                    <Paper
                      elevation={0}
                      sx={{
                        mt: 1.5,
                        p: 1.5,
                        bgcolor: 'background.default',
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1.5,
                      }}
                    >
                      <pre style={{ margin: 0, fontSize: 11, fontFamily: 'monospace', overflow: 'auto' }}>
                        {JSON.stringify(selectedRecord.items, null, 2)}
                      </pre>
                    </Paper>
                  </Collapse>
                </Box>
              </Stack>
            );
          })()}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button
            onClick={() => {
              setSelectedRecord(null);
              setShowRawJson(false);
            }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
