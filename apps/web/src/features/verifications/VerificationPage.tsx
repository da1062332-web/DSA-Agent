// apps/web/src/features/verifications/VerificationPage.tsx
// Module 22: Verification — Verification Workbench
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { DataTable, PageHeader } from '../../ui';
import { ApplicationName, CustomerName, LeadName } from '../../shell/display';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../api/client';
import type {
  CreateVerificationInput,
  ListVerificationsResponse,
  VerificationCheckType,
  VerificationMethod,
  VerificationPurpose,
  VerificationRecord,
  VerificationResult,
  VerificationSubjectType,
} from '@dsa/contracts';

const CHECK_TYPE_ICONS: Record<string, string> = {
  PAN: '🪪',
  GST: '🏢',
  CIN: '🏛️',
  ITR: '📊',
  BANK_STATEMENT: '🏦',
  BUREAU: '📈',
  IDENTITY_DOCUMENT: '📑',
  EMPLOYMENT: '💼',
  ADDRESS: '📍',
};

export function VerificationPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Filters
  const [filterSubjectType, setFilterSubjectType] = useState<string>('');
  const [filterCheckType, setFilterCheckType] = useState<string>('');
  const [filterResult, setFilterResult] = useState<string>('');
  const [filterMethod, setFilterMethod] = useState<string>('');

  // Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);

  // Form State
  const [formSubjectType, setFormSubjectType] = useState<VerificationSubjectType>('LOAN_APPLICATION');
  const [formSubjectId, setFormSubjectId] = useState('');
  const [formCheckType, setFormCheckType] = useState<VerificationCheckType>('PAN');
  const [formMethod, setFormMethod] = useState<VerificationMethod>('MANUAL');
  const [formPurpose, setFormPurpose] = useState<VerificationPurpose>('KYC');
  const [formConsentId, setFormConsentId] = useState('');
  // Nothing about the outcome is prefilled: the verifier records what they found (QA plan: never fabricate a pass).
  const [formResult, setFormResult] = useState<VerificationResult | ''>('');
  const [formStatusDesc, setFormStatusDesc] = useState('');
  const [formMaskedId, setFormMaskedId] = useState('');
  const [formMatchScore, setFormMatchScore] = useState<number>(0);
  const [formDiscrepancies, setFormDiscrepancies] = useState('');
  const [formEvidenceRef, setFormEvidenceRef] = useState('');
  const [formValidityDays, setFormValidityDays] = useState<number>(365);
  const [formNotes, setFormNotes] = useState('');

  // Fetch Verifications (API-VER-002)
  const queryParams = new URLSearchParams();
  if (filterSubjectType) queryParams.set('subjectType', filterSubjectType);
  if (filterCheckType) queryParams.set('checkType', filterCheckType);
  if (filterResult) queryParams.set('result', filterResult);
  if (filterMethod) queryParams.set('method', filterMethod);
  const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';

  const {
    data: listData,
    isLoading,
    error: fetchError,
  } = useQuery<ListVerificationsResponse>({
    queryKey: ['verifications', queryString],
    queryFn: () => apiFetch<ListVerificationsResponse>(`/v1/verifications${queryString}`),
  });

  // Create Verification Mutation (API-VER-001)
  const createMutation = useMutation({
    meta: { successMessage: 'Verification requested.' },
    mutationFn: (payload: CreateVerificationInput) =>
      apiFetch<VerificationRecord>('/v1/verifications', {
        method: 'POST',
        idempotencyKey: `idem_ver_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        body: payload,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['verifications'] });
      setIsCreateOpen(false);
      setFeedback({
        message: `Verification check ${data.id} recorded successfully with result ${data.result}!`,
        severity: 'success',
      });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setFeedback({ message: err.message, severity: 'error' });
      } else {
        setFeedback({ message: 'Failed to record verification check.', severity: 'error' });
      }
    },
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSubjectId.trim() || !formConsentId.trim() || !formResult || !formStatusDesc.trim()) {
      setFeedback({
        message: 'Fill in the subject, the consent record, the result and what you found.',
        severity: 'error',
      });
      return;
    }
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + formValidityDays);

    const payload: CreateVerificationInput = {
      subjectType: formSubjectType,
      subjectId: formSubjectId.trim(),
      checkType: formCheckType,
      method: formMethod,
      purpose: formPurpose,
      consentRecordId: formConsentId.trim(),
      result: formResult,
      minimalResult: {
        statusDescription: formStatusDesc.trim(),
        maskedIdentifier: formMaskedId.trim() || undefined,
        matchScore: formMatchScore,
        nameMatchScore: formMatchScore,
        discrepancies: formDiscrepancies
          ? formDiscrepancies
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      },
      evidenceRef: formEvidenceRef.trim(),
      validityExpiresAt: expiry.toISOString(),
      notes: formNotes.trim() || undefined,
    };

    createMutation.mutate(payload);
  };

  const getResultBadge = (result: VerificationResult) => {
    switch (result) {
      case 'VERIFIED':
        return <Chip label="VERIFIED" color="success" size="small" sx={{ fontWeight: 700 }} />;
      case 'REJECTED':
        return <Chip label="REJECTED" color="error" size="small" sx={{ fontWeight: 700 }} />;
      case 'FLAGGED':
        return <Chip label="FLAGGED" color="warning" size="small" sx={{ fontWeight: 700 }} />;
      case 'INCONCLUSIVE':
        return <Chip label="INCONCLUSIVE" color="default" size="small" sx={{ fontWeight: 700 }} />;
      default:
        return <Chip label={result} size="small" />;
    }
  };

  const totalCount = listData?.data.length ?? 0;
  const verifiedCount = listData?.data.filter((r) => r.result === 'VERIFIED').length ?? 0;
  const flaggedCount =
    listData?.data.filter((r) => r.result === 'FLAGGED' || r.result === 'REJECTED').length ?? 0;

  return (
    <Box>
      <PageHeader
        title="Verification Workbench"
        subtitle="Identity, income, bureau and compliance check verification records."
        actions={
          <>
            <Button variant="outlined" onClick={() => navigate('/verifications')}>
              Cases list
            </Button>
            <Button variant="contained" onClick={() => setIsCreateOpen(true)}>
              + Perform verification check
            </Button>
          </>
        }
      />

      {/* Feedback Alert */}
      {feedback && (
        <Alert severity={feedback.severity} onClose={() => setFeedback(null)} sx={{ mb: 3 }}>
          {feedback.message}
        </Alert>
      )}

      {/* Metrics Row */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={4}>
          <Card elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 2 }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary" fontWeight={600}>
                Total Verification Records
              </Typography>
              <Typography variant="h4" fontWeight={700} color="#0f172a" sx={{ mt: 1 }}>
                {totalCount}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card elevation={0} sx={{ border: '1px solid #bbf7d0', bgcolor: '#f0fdf4', borderRadius: 2 }}>
            <CardContent>
              <Typography variant="body2" color="success.main" fontWeight={600}>
                Verified & Validated (Pass)
              </Typography>
              <Typography variant="h4" fontWeight={700} color="success.dark" sx={{ mt: 1 }}>
                {verifiedCount}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card elevation={0} sx={{ border: '1px solid #fed7aa', bgcolor: '#fff7ed', borderRadius: 2 }}>
            <CardContent>
              <Typography variant="body2" color="warning.main" fontWeight={600}>
                Flagged / Rejected (Exceptions)
              </Typography>
              <Typography variant="h4" fontWeight={700} color="warning.dark" sx={{ mt: 1 }}>
                {flaggedCount}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filters Bar */}
      <Card elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 2, mb: 3 }}>
        <CardContent sx={{ p: 2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Subject Type</InputLabel>
              <Select
                value={filterSubjectType}
                label="Subject Type"
                onChange={(e) => setFilterSubjectType(e.target.value)}
              >
                <MenuItem value="">All Subjects</MenuItem>
                <MenuItem value="LOAN_APPLICATION">Loan Application</MenuItem>
                <MenuItem value="CUSTOMER">Customer</MenuItem>
                <MenuItem value="LEAD">Lead</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Check Type</InputLabel>
              <Select
                value={filterCheckType}
                label="Check Type"
                onChange={(e) => setFilterCheckType(e.target.value)}
              >
                <MenuItem value="">All Check Types</MenuItem>
                <MenuItem value="PAN">PAN (Income Tax)</MenuItem>
                <MenuItem value="GST">GST (Business)</MenuItem>
                <MenuItem value="CIN">CIN (MCA)</MenuItem>
                <MenuItem value="ITR">ITR (Tax Return)</MenuItem>
                <MenuItem value="BANK_STATEMENT">Bank Statement</MenuItem>
                <MenuItem value="BUREAU">Credit Bureau</MenuItem>
                <MenuItem value="IDENTITY_DOCUMENT">Identity Document</MenuItem>
                <MenuItem value="EMPLOYMENT">Employment</MenuItem>
                <MenuItem value="ADDRESS">Address</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Result</InputLabel>
              <Select value={filterResult} label="Result" onChange={(e) => setFilterResult(e.target.value)}>
                <MenuItem value="">All Results</MenuItem>
                <MenuItem value="VERIFIED">Verified</MenuItem>
                <MenuItem value="REJECTED">Rejected</MenuItem>
                <MenuItem value="FLAGGED">Flagged</MenuItem>
                <MenuItem value="INCONCLUSIVE">Inconclusive</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Method</InputLabel>
              <Select value={filterMethod} label="Method" onChange={(e) => setFilterMethod(e.target.value)}>
                <MenuItem value="">All Methods</MenuItem>
                <MenuItem value="MANUAL">Manual Review</MenuItem>
                <MenuItem value="PROVIDER_AUTOMATED">Automated Provider</MenuItem>
              </Select>
            </FormControl>

            <Box sx={{ flexGrow: 1 }} />

            {(filterSubjectType || filterCheckType || filterResult || filterMethod) && (
              <Button
                variant="text"
                size="small"
                onClick={() => {
                  setFilterSubjectType('');
                  setFilterCheckType('');
                  setFilterResult('');
                  setFilterMethod('');
                }}
              >
                Reset Filters
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>

      {/* Verifications Table */}
      <Card elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 2, overflow: 'hidden' }}>
        <CardContent sx={{ p: 0 }}>
          {isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
              <CircularProgress />
            </Box>
          ) : fetchError ? (
            <Alert severity="error" sx={{ m: 3 }}>
              {fetchError instanceof ApiError
                ? fetchError.message
                : (fetchError as Error)?.message || 'Failed to load verification check records.'}
            </Alert>
          ) : !listData?.data?.length ? (
            <Box sx={{ textAlign: 'center', py: 8 }}>
              <Box sx={{ fontSize: 48, mb: 1 }}>🪪</Box>
              <Typography variant="h6" fontWeight={600} color="#1e293b">
                No verification records found
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
                Perform a document verification check or clear your active filters.
              </Typography>
              <Button variant="outlined" onClick={() => setIsCreateOpen(true)}>
                Perform First Check
              </Button>
            </Box>
          ) : (
            <DataTable<(typeof listData.data)[number]>
              dataTestId="verif.table.checks"
              data={listData.data}
              keyExtractor={(row) => row.id}
              columns={[
                { id: 'id', header: 'Check ID', render: (row) => <Box sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{row.id}</Box> },
                {
                  id: 'type',
                  header: 'Check Type',
                  render: (row) => (
                    <Stack direction="row" spacing={1} alignItems="center">
                      <span>{CHECK_TYPE_ICONS[row.checkType] || '📄'}</span>
                      <Typography variant="body2" fontWeight={600}>
                        {row.checkType.replace(/_/g, ' ')}
                      </Typography>
                    </Stack>
                  ),
                },
                {
                  id: 'subject',
                  header: 'Subject & ID',
                  render: (row) => {
                    let subjectName = null;
                    if (row.subjectType === 'CUSTOMER') {
                      subjectName = <CustomerName id={row.subjectId} fallback={row.subjectType.replace(/_/g, ' ')} />;
                    } else if (row.subjectType === 'LEAD') {
                      subjectName = <LeadName id={row.subjectId} fallback={row.subjectType.replace(/_/g, ' ')} />;
                    } else if (row.subjectType === 'LOAN_APPLICATION') {
                      subjectName = <ApplicationName id={row.subjectId} fallback={row.subjectType.replace(/_/g, ' ')} />;
                    }

                    return (
                      <Box>
                        {subjectName && (
                          <Box sx={{ fontWeight: 600, color: 'text.primary', mb: 0.25 }}>
                            {subjectName}
                          </Box>
                        )}
                        <Typography
                          variant={subjectName ? 'caption' : 'body2'}
                          color={subjectName ? 'text.secondary' : 'text.primary'}
                          fontWeight={subjectName ? 400 : 600}
                          sx={{ display: 'block' }}
                        >
                          {row.subjectType.replace(/_/g, ' ')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                          {row.subjectId}
                        </Typography>
                      </Box>
                    );
                  },
                },
                {
                  id: 'method',
                  header: 'Method / Purpose',
                  render: (row) => (
                    <>
                      <Chip
                        label={row.method}
                        size="small"
                        variant="outlined"
                        color={row.method === 'PROVIDER_AUTOMATED' ? 'primary' : 'default'}
                        sx={{ mb: 0.5 }}
                      />
                      <Typography variant="caption" color="text.secondary" display="block">
                        {row.purpose.replace(/_/g, ' ')}
                      </Typography>
                    </>
                  ),
                },
                { id: 'result', header: 'Result', render: (row) => getResultBadge(row.result) },
                {
                  id: 'masked',
                  header: 'Masked Details',
                  render: (row) => (
                    <>
                      <Typography variant="body2" fontWeight={600}>
                        {row.minimalResult.maskedIdentifier || 'N/A'}
                      </Typography>
                      {row.minimalResult.matchScore !== undefined && (
                        <Typography variant="caption" color="text.secondary">
                          Match: {row.minimalResult.matchScore}%
                        </Typography>
                      )}
                    </>
                  ),
                },
                {
                  id: 'evidence',
                  header: 'Evidence Ref',
                  render: (row) => (
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', display: 'block' }}>
                      {row.evidenceRef}
                    </Typography>
                  ),
                },
                {
                  id: 'performed',
                  header: 'Performed At',
                  render: (row) => (
                    <>
                      <Typography variant="body2">{new Date(row.performedAt).toLocaleDateString()}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(row.performedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </Typography>
                    </>
                  ),
                },
              ]}
            />
          )}
        </CardContent>
      </Card>

      {/* Dialog: Create Verification Check */}
      <Dialog open={isCreateOpen} onClose={() => setIsCreateOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Typography variant="h6" fontWeight={700}>
            Perform Verification Check (API-VER-001)
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Records an immutable audit verification check (ENT-064) under S3 Classification.
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          <Box component="form" onSubmit={handleCreateSubmit}>
            <Stack spacing={3}>
              {/* Statutory Notice */}
              <Alert severity="info" sx={{ bgcolor: '#eff6ff', border: '1px solid #bfdbfe' }}>
                <strong>Legal Guard (ADR-4D-04 & Aadhaar Act):</strong> Raw 12-digit Aadhaar numbers are
                strictly prohibited. Only masked identifier format (e.g. XXXXXXXX1234) and verified consent
                records are permitted.
              </Alert>

              {/* Section 1: Subject & Target */}
              <Typography variant="subtitle2" fontWeight={700} color="#1e293b">
                1. Subject & Check Type
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Subject Type</InputLabel>
                    <Select
                      value={formSubjectType}
                      label="Subject Type"
                      onChange={(e) => setFormSubjectType(e.target.value as VerificationSubjectType)}
                    >
                      <MenuItem value="LOAN_APPLICATION">Loan Application</MenuItem>
                      <MenuItem value="CUSTOMER">Customer</MenuItem>
                      <MenuItem value="LEAD">Lead</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={8}>
                  <TextField
                    label="Subject ID"
                    fullWidth
                    size="small"
                    required
                    value={formSubjectId}
                    onChange={(e) => setFormSubjectId(e.target.value)}
                    helperText="The application, customer or lead ID being verified"
                  />
                </Grid>

                <Grid item xs={12} sm={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Check Type</InputLabel>
                    <Select
                      value={formCheckType}
                      label="Check Type"
                      onChange={(e) => setFormCheckType(e.target.value as VerificationCheckType)}
                    >
                      <MenuItem value="PAN">PAN (Income Tax)</MenuItem>
                      <MenuItem value="GST">GST (Business)</MenuItem>
                      <MenuItem value="CIN">CIN (MCA)</MenuItem>
                      <MenuItem value="ITR">ITR (Tax Return)</MenuItem>
                      <MenuItem value="BANK_STATEMENT">Bank Statement</MenuItem>
                      <MenuItem value="BUREAU">Credit Bureau</MenuItem>
                      <MenuItem value="IDENTITY_DOCUMENT">Identity Document</MenuItem>
                      <MenuItem value="EMPLOYMENT">Employment Check</MenuItem>
                      <MenuItem value="ADDRESS">Address Verification</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Method</InputLabel>
                    <Select
                      value={formMethod}
                      label="Method"
                      onChange={(e) => setFormMethod(e.target.value as VerificationMethod)}
                    >
                      <MenuItem value="MANUAL">Manual Review (Operator)</MenuItem>
                      <MenuItem value="PROVIDER_AUTOMATED">Automated Provider</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Purpose</InputLabel>
                    <Select
                      value={formPurpose}
                      label="Purpose"
                      onChange={(e) => setFormPurpose(e.target.value as VerificationPurpose)}
                    >
                      <MenuItem value="KYC">KYC</MenuItem>
                      <MenuItem value="FINANCIAL_UNDERWRITING">Financial Underwriting</MenuItem>
                      <MenuItem value="EMPLOYMENT_CHECK">Employment Check</MenuItem>
                      <MenuItem value="COLLATERAL_LEGAL">Collateral Legal</MenuItem>
                      <MenuItem value="FRAUD_PREVENTION">Fraud Prevention</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>

              <Divider />

              {/* Section 2: Consent Gate */}
              <Typography variant="subtitle2" fontWeight={700} color="#1e293b">
                2. Consent Reference (VERIFICATION_CHECK Gate)
              </Typography>
              <TextField
                label="Consent Record ID"
                fullWidth
                size="small"
                required
                value={formConsentId}
                onChange={(e) => setFormConsentId(e.target.value)}
                helperText="Active app.consent_record ID for VERIFICATION_CHECK"
              />

              <Divider />

              {/* Section 3: Findings & Minimal Result */}
              <Typography variant="subtitle2" fontWeight={700} color="#1e293b">
                3. Verification Findings & Minimal Masked Result
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Verification Result</InputLabel>
                    <Select
                      value={formResult}
                      label="Verification Result"
                      onChange={(e) => setFormResult(e.target.value as VerificationResult)}
                    >
                      <MenuItem value="" disabled>
                        Choose the outcome
                      </MenuItem>
                      <MenuItem value="VERIFIED">VERIFIED (Pass)</MenuItem>
                      <MenuItem value="REJECTED">REJECTED (Fail)</MenuItem>
                      <MenuItem value="FLAGGED">FLAGGED (Review Required)</MenuItem>
                      <MenuItem value="INCONCLUSIVE">INCONCLUSIVE (Incomplete)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    label="Masked Identifier"
                    fullWidth
                    size="small"
                    value={formMaskedId}
                    onChange={(e) => setFormMaskedId(e.target.value)}
                    helperText="e.g. ABCDE****F or XXXXXXXX1234"
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    label="Match Confidence Score (%)"
                    type="number"
                    fullWidth
                    size="small"
                    value={formMatchScore}
                    onChange={(e) => setFormMatchScore(Math.max(0, Math.min(100, Number(e.target.value))))}
                    inputProps={{ min: 0, max: 100 }}
                    onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }}
                  />
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    label="Status Description"
                    fullWidth
                    size="small"
                    required
                    value={formStatusDesc}
                    onChange={(e) => setFormStatusDesc(e.target.value)}
                  />
                </Grid>

                <Grid item xs={12} sm={8}>
                  <TextField
                    label="Evidence Reference"
                    fullWidth
                    size="small"
                    required
                    value={formEvidenceRef}
                    onChange={(e) => setFormEvidenceRef(e.target.value)}
                    helperText="Document filename, storage key, or upload reference ID"
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    label="Validity Period (Days)"
                    type="number"
                    fullWidth
                    size="small"
                    value={formValidityDays}
                    onChange={(e) => setFormValidityDays(Math.max(1, Number(e.target.value)))}
                    inputProps={{ min: 1 }}
                    onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }}
                  />
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    label="Discrepancies / Anomalies (Comma-separated, optional)"
                    fullWidth
                    size="small"
                    value={formDiscrepancies}
                    onChange={(e) => setFormDiscrepancies(e.target.value)}
                    placeholder="e.g. Minor spelling variance in middle name"
                  />
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    label="Reviewer Notes"
                    fullWidth
                    multiline
                    rows={2}
                    size="small"
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                  />
                </Grid>
              </Grid>
            </Stack>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setIsCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateSubmit}
            disabled={createMutation.isPending}
            sx={{ bgcolor: '#2563eb', fontWeight: 600, px: 3 }}
          >
            {createMutation.isPending ? (
              <CircularProgress size={20} color="inherit" />
            ) : (
              'Record Verification Check'
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
