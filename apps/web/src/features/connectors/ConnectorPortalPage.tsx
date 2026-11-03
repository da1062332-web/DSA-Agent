import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client';
import { useToast } from '../../shell/toast';
import { useMe } from '../../api/useMe';
import { DataTable, DetailCard, PageHeader, StatCard, StatCardGrid, StatusBadge } from '../../ui';
import { PartnerReferralDetail } from './PartnerReferralDetail';
import type { ColumnDef } from '../../ui';
import {
  DISPUTE_CATEGORIES,
  disputeCategoryLabel,
  disputeReasonError,
  payableLines,
  referralStatusLabel,
  sumMoney,
  type PortalDispute,
  type PortalReferral,
  type PortalStatementLine,
  type PortalStatements,
} from './portal-model';
import {
  portalDataOpen,
  portalNotice,
  portalNoticeSeverity,
  portalTableText,
  type PortalEligibility,
} from './portal-eligibility';

const STATEMENT_TONE: Record<string, 'success' | 'info' | 'neutral'> = {
  PAID: 'success',
  ELIGIBLE: 'info',
};

const DISPUTE_STATUS_TONE: Record<string, 'success' | 'info' | 'neutral'> = {
  RESOLVED: 'success',
  OPEN: 'info',
  UNDER_REVIEW: 'info',
  REJECTED: 'neutral',
  WITHDRAWN: 'neutral',
};

const money = (rupees: number) => `₹${rupees.toLocaleString('en-IN')}`;
const errorText = (err: unknown) =>
  err instanceof Error ? err.message : 'Something went wrong. Please try again.';

export function ConnectorPortalPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState(0);

  // Referral state
  const [newReferralOpen, setNewReferralOpen] = useState(false);
  const [refName, setRefName] = useState('');
  const [refMobile, setRefMobile] = useState('');
  const [refProduct, setRefProduct] = useState('PL');
  const [refAmount, setRefAmount] = useState('500000');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpId, setOtpId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Payout dialog state: the statement lines the request covers
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payoutSelection, setPayoutSelection] = useState<string[]>([]);

  // Dispute dialog state: the statement line being disputed
  const [disputeLine, setDisputeLine] = useState<PortalStatementLine | null>(null);
  const [disputeCategory, setDisputeCategory] = useState(DISPUTE_CATEGORIES.STATEMENT_LINE[0]!.value);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeTouched, setDisputeTouched] = useState(false);

  // The referral whose progress and documents are open, and whether a payout request is being sent (so it cannot be sent twice).
  const [detailLeadId, setDetailLeadId] = useState<string | null>(null);
  const [payoutBusy, setPayoutBusy] = useState(false);

  const me = useMe();
  const isConnector = me.data?.userType === 'CONNECTOR';

  // The state of this login comes first. Nothing else is asked for unless the server says the login is eligible: a refused login
  // gets one request and one clear message, not a request per screen.
  const eligibilityQuery = useQuery<PortalEligibility>({
    queryKey: ['/portal/v1/eligibility'],
    queryFn: () => apiFetch<PortalEligibility>('/portal/v1/eligibility'),
    enabled: isConnector,
    retry: false,
  });
  const portalOpen = portalDataOpen(eligibilityQuery.data);
  const notice = portalNotice(eligibilityQuery.data, eligibilityQuery.error);
  // An empty table says why it is empty: still checking, closed for this login, loading, or nothing yet (see portalTableText).
  const tableText = (dataLoading: boolean, loadingText: string, emptyText: string) =>
    portalTableText(portalOpen, eligibilityQuery.isLoading, loadingText, emptyText, dataLoading);

  const referralsQuery = useQuery<{ data: PortalReferral[] }>({
    queryKey: ['/portal/v1/referrals'],
    queryFn: () => apiFetch<{ data: PortalReferral[] }>('/portal/v1/referrals'),
    enabled: portalOpen,
  });

  const statementsQuery = useQuery<PortalStatements>({
    queryKey: ['/portal/v1/statements'],
    queryFn: () => apiFetch<PortalStatements>('/portal/v1/statements'),
    enabled: portalOpen,
  });

  const disputesQuery = useQuery<{ data: PortalDispute[] }>({
    queryKey: ['/portal/v1/disputes'],
    queryFn: () => apiFetch<{ data: PortalDispute[] }>('/portal/v1/disputes'),
    enabled: portalOpen,
  });

  const referrals = referralsQuery.data?.data ?? [];
  const statements = statementsQuery.data;
  const statementLines = statements?.lines ?? [];
  const disputes = disputesQuery.data?.data ?? [];
  const eligibleLines = payableLines(statementLines);
  const eligibleAmount = sumMoney(eligibleLines.map((l) => l.amount));
  const accumulatedAmount = statements
    ? sumMoney([
        statements.totals.expected,
        statements.totals.approved,
        statements.totals.paid,
        statements.totals.held,
      ])
    : 0;

  const handleSendOtp = async () => {
    if (!refMobile || refMobile.length < 10) {
      toast.error('Please enter a valid 10-digit mobile number.');
      return;
    }
    try {
      setSubmitting(true);
      const res = await apiFetch<{ otpId: string; status: string }>('/portal/v1/referrals/consent-otp', {
        method: 'POST',
        body: {
          action: 'SEND',
          mobile: refMobile.startsWith('+91') ? refMobile : `+91${refMobile}`,
        },
      });
      setOtpId(res.otpId);
      setOtpSent(true);
      toast.success('Consent verification OTP sent to the customer’s mobile.');
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitReferral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode) {
      toast.error('Please enter the customer’s consent verification OTP.');
      return;
    }
    try {
      setSubmitting(true);
      // The code is checked first. A referral needs a verified consent code for the same mobile.
      const verified = await apiFetch<{ status: string; attemptsLeft?: number }>(
        '/portal/v1/referrals/consent-otp',
        {
          method: 'POST',
          body: { action: 'VERIFY', otpId, code: otpCode },
        },
      );
      if (verified.status !== 'VERIFIED') {
        toast.error(
          verified.status === 'INCORRECT'
            ? `The code is incorrect. ${verified.attemptsLeft ?? 0} attempts left.`
            : 'This code can no longer be used. Send a new one.',
        );
        return;
      }
      await apiFetch('/portal/v1/referrals', {
        method: 'POST',
        body: {
          fullName: refName,
          mobile: refMobile.startsWith('+91') ? refMobile : `+91${refMobile}`,
          productCategory: refProduct,
          indicativeAmount: { amount: refAmount, currency: 'INR' },
          consentOtpId: otpId,
        },
      });
      toast.success('Referral submitted with the customer’s consent.');
      setNewReferralOpen(false);
      setRefName('');
      setRefMobile('');
      setOtpSent(false);
      setOtpCode('');
      setOtpId('');
      queryClient.invalidateQueries({ queryKey: ['/portal/v1/referrals'] });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  const openPayout = () => {
    setPayoutSelection(eligibleLines.map((l) => l.id));
    setPayoutOpen(true);
  };

  const handleRequestPayout = async () => {
    if (payoutSelection.length === 0) {
      toast.error('Select at least one line for the payout.');
      return;
    }
    if (payoutBusy) return;
    setPayoutBusy(true);
    try {
      // The API may ask for a second factor first; the client handles that and retries. The success message shows the status it returned.
      const res = await apiFetch<{ id: string; status: string }>('/portal/v1/payout-requests', {
        method: 'POST',
        body: { payableIds: payoutSelection },
      });
      toast.success(
        `Payout request ${res.id} is ${res.status.toLowerCase()}. It is reviewed before any payment is made.`,
      );
      setPayoutOpen(false);
      queryClient.invalidateQueries({ queryKey: ['/portal/v1/statements'] });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setPayoutBusy(false);
    }
  };

  const openDispute = (line: PortalStatementLine) => {
    setDisputeLine(line);
    setDisputeCategory(DISPUTE_CATEGORIES.STATEMENT_LINE[0]!.value);
    setDisputeReason('');
    setDisputeTouched(false);
  };

  const reasonError = disputeReasonError(disputeReason);

  const handleRaiseDispute = async () => {
    setDisputeTouched(true);
    if (!disputeLine || reasonError) return;
    try {
      await apiFetch('/portal/v1/disputes', {
        method: 'POST',
        body: {
          subjectType: 'STATEMENT_LINE',
          subjectId: disputeLine.id,
          category: disputeCategory,
          reason: disputeReason.trim(),
        },
      });
      toast.success('Dispute raised. Our team will review it.');
      setDisputeLine(null);
      queryClient.invalidateQueries({ queryKey: ['/portal/v1/disputes'] });
      queryClient.invalidateQueries({ queryKey: ['/portal/v1/statements'] });
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const referralColumns: ColumnDef<PortalReferral>[] = [
    { id: 'name', header: 'Applicant Name', render: (ref) => <strong>{ref.name}</strong> },
    { id: 'mobile', header: 'Mobile (Masked)', render: (ref) => ref.mobileMasked || 'XXXXXX' },
    {
      id: 'product',
      header: 'Product',
      render: (ref) => <Chip label={ref.productCategory} size="small" variant="outlined" />,
    },
    {
      id: 'status',
      header: 'Status',
      render: (ref) => (
        <StatusBadge
          status={ref.status === 'APPLICATION' ? 'success' : ref.status === 'CLOSED' ? 'neutral' : 'info'}
          label={referralStatusLabel(ref.status)}
        />
      ),
    },
    {
      id: 'date',
      header: 'Submitted',
      render: (ref) => new Date(ref.submittedAt).toLocaleDateString('en-IN'),
    },
  ];

  const statementColumns: ColumnDef<PortalStatementLine>[] = [
    {
      id: 'payable',
      header: 'Payable Amount',
      align: 'right',
      render: (s) => <strong>{money(Number(s.amount.amount))}</strong>,
    },
    {
      id: 'state',
      header: 'State',
      render: (s) => <StatusBadge status={STATEMENT_TONE[s.state] ?? 'neutral'} label={s.state} />,
    },
    {
      id: 'disputed',
      header: 'Dispute',
      render: (s) => (s.disputed ? <Chip label="Under dispute" size="small" color="warning" /> : 'None'),
    },
    { id: 'date', header: 'Date', render: (s) => new Date(s.createdAt).toLocaleDateString('en-IN') },
    {
      id: 'action',
      header: '',
      align: 'right',
      render: (s) =>
        s.disputed ? null : (
          <Button size="small" onClick={() => openDispute(s)} data-testid={`cpt.dispute.${s.id}`}>
            Dispute
          </Button>
        ),
    },
  ];

  const disputeColumns: ColumnDef<PortalDispute>[] = [
    { id: 'raised', header: 'Raised', render: (d) => new Date(d.raisedAt).toLocaleDateString('en-IN') },
    {
      id: 'subject',
      header: 'Item',
      render: (d) => (d.subjectType === 'PAYOUT' ? 'Payout' : 'Statement line'),
    },
    { id: 'category', header: 'Category', render: (d) => disputeCategoryLabel(d.category) },
    {
      id: 'status',
      header: 'Status',
      render: (d) => <StatusBadge status={DISPUTE_STATUS_TONE[d.status] ?? 'neutral'} label={d.status} />,
    },
    { id: 'reason', header: 'Your description', render: (d) => d.reason },
  ];

  const tabTitle = ['My Referrals', 'Commission Statements', 'Disputes'][activeTab];
  const tabSubtitle = [
    'Leads you have referred, with their consent-verified status.',
    'Payable commission statements and their state.',
    'Disputes you have raised on statement lines.',
  ][activeTab];

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Connector Partner Portal"
        subtitle="Manage referred leads, monitor commission payouts, and raise disputes on statements."
        actions={
          <Stack direction="row" spacing={2}>
            <Button
              variant="outlined"
              onClick={openPayout}
              disabled={!portalOpen}
              data-testid="cpt.request-payout"
            >
              Request Payout
            </Button>
            <Button
              variant="contained"
              onClick={() => setNewReferralOpen(true)}
              disabled={!portalOpen}
              data-testid="cpt.submit-referral"
            >
              Submit Referral
            </Button>
          </Stack>
        }
      />

      {!isConnector && !me.isLoading && (
        <Alert severity="info" sx={{ mb: 3, borderRadius: 2 }}>
          <strong>Partner Portal Preview:</strong> You are signed in as internal staff (
          {me.data?.displayName || me.data?.email || 'Staff'}). This self-service portal is dedicated to
          external Connector partners (Sub-DSAs) to submit customer referrals with OTP consent, track payouts,
          and inspect commission statements.
        </Alert>
      )}

      {notice && (
        <Alert severity={portalNoticeSeverity(eligibilityQuery.data)} sx={{ mb: 3 }} data-testid="cpt.notice">
          {notice}
        </Alert>
      )}

      {referralsQuery.isError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Your referrals could not be loaded. {errorText(referralsQuery.error)}
        </Alert>
      )}
      {statementsQuery.isError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Your statements could not be loaded. {errorText(statementsQuery.error)}
        </Alert>
      )}

      <StatCardGrid columns={{ xs: 12, sm: 4 }}>
        <StatCard
          title="TOTAL REFERRALS"
          value={referrals.length}
          format="number"
          status="primary"
          subtext="Active partner sourcing pipeline"
        />
        <StatCard
          title="ACCUMULATED COMMISSION"
          value={money(accumulatedAmount)}
          format="raw"
          status="success"
          subtext="All payable commission on your statements"
        />
        <StatCard
          title="ELIGIBLE FOR PAYOUT"
          value={money(eligibleAmount)}
          format="raw"
          status="warning"
          subtext="Eligible or approved lines not under dispute"
        />
      </StatCardGrid>

      <DetailCard title={tabTitle} subtitle={tabSubtitle}>
        <Tabs value={activeTab} onChange={(_, val) => setActiveTab(val)} sx={{ mb: 2 }}>
          <Tab label="My Referrals" />
          <Tab label="Commission Statements" />
          <Tab label="Disputes" />
        </Tabs>

        {activeTab === 0 && (
          <DataTable<PortalReferral>
            dataTestId="cpt.table.referrals"
            onRowClick={(ref) => setDetailLeadId(ref.id)}
            data={referrals}
            columns={referralColumns}
            keyExtractor={(ref) => ref.id}
            emptyMessage={tableText(
              referralsQuery.isLoading,
              'Loading referrals...',
              'No referrals submitted yet. Click "Submit Referral" to refer a borrower.',
            )}
          />
        )}

        {activeTab === 1 && (
          <DataTable<PortalStatementLine>
            dataTestId="cpt.table.statements"
            data={statementLines}
            columns={statementColumns}
            keyExtractor={(s) => s.id}
            emptyMessage={tableText(
              statementsQuery.isLoading,
              'Loading statements...',
              'No payable statements recorded yet.',
            )}
          />
        )}

        {activeTab === 2 && (
          <DataTable<PortalDispute>
            dataTestId="cpt.table.disputes"
            data={disputes}
            columns={disputeColumns}
            keyExtractor={(d) => d.id}
            emptyMessage={tableText(
              disputesQuery.isLoading,
              'Loading disputes...',
              'You have not raised any disputes.',
            )}
          />
        )}
      </DetailCard>

      {/* Submit Referral Dialog */}
      <Dialog open={newReferralOpen} onClose={() => setNewReferralOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleSubmitReferral}>
          <DialogTitle sx={{ fontWeight: 700 }}>Submit Lead Referral</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              In accordance with DPDP consent requirements, submitting a referral requires borrower consent
              verification.
            </Typography>

            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                required
                fullWidth
                label="Borrower Full Name"
                placeholder="e.g. Ramesh Kumar"
                value={refName}
                onChange={(e) => setRefName(e.target.value)}
              />

              <Stack direction="row" spacing={1}>
                <TextField
                  required
                  fullWidth
                  label="Mobile Number (10 digits)"
                  placeholder="9876543210"
                  value={refMobile}
                  onChange={(e) => setRefMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  inputProps={{ maxLength: 10 }}
                />
                <Button
                  variant="outlined"
                  onClick={handleSendOtp}
                  disabled={submitting || !refMobile || refMobile.length < 10}
                  sx={{ minWidth: 120 }}
                >
                  {otpSent ? 'Resend' : 'Send OTP'}
                </Button>
              </Stack>

              {otpSent && (
                <TextField
                  required
                  fullWidth
                  label="Consent Verification OTP"
                  placeholder="Enter 6-digit OTP received by customer"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  helperText="Verification OTP confirms borrower consent to share details with NBFC partners"
                />
              )}

              <TextField
                select
                fullWidth
                label="Loan Product"
                value={refProduct}
                onChange={(e) => setRefProduct(e.target.value)}
              >
                <MenuItem value="PL">Personal Loan (PL)</MenuItem>
                <MenuItem value="BL">Business Loan (BL)</MenuItem>
                <MenuItem value="HL">Home Loan (HL)</MenuItem>
                <MenuItem value="LAP">Loan Against Property (LAP)</MenuItem>
              </TextField>

              <TextField
                required
                fullWidth
                type="number"
                label="Indicative Loan Amount (INR)"
                value={refAmount}
                onChange={(e) => setRefAmount(e.target.value)}
                inputProps={{ min: 10000 }}
                onKeyDown={(e) => {
                  if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault();
                }}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Button onClick={() => setNewReferralOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={submitting || !otpSent || !otpCode}>
              {submitting ? <CircularProgress size={24} /> : 'Verify & Submit'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Request Payout Dialog: the lines the request covers, each one a choice */}
      <Dialog open={payoutOpen} onClose={() => setPayoutOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Request Commission Payout</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Choose the eligible statement lines to include. The request undergoes dual-control verification
            (SOD-03).
          </Typography>
          {eligibleLines.length === 0 ? (
            <Alert severity="info">You have no eligible lines to pay out.</Alert>
          ) : (
            <Stack>
              {eligibleLines.map((line) => (
                <FormControlLabel
                  key={line.id}
                  control={
                    <Checkbox
                      checked={payoutSelection.includes(line.id)}
                      onChange={(e) =>
                        setPayoutSelection((sel) =>
                          e.target.checked ? [...sel, line.id] : sel.filter((id) => id !== line.id),
                        )
                      }
                    />
                  }
                  label={`${money(Number(line.amount.amount))} · ${line.state} · ${new Date(line.createdAt).toLocaleDateString('en-IN')}`}
                />
              ))}
              <Typography variant="body2" sx={{ mt: 2 }}>
                Selected:{' '}
                <strong>
                  {money(
                    sumMoney(
                      eligibleLines.filter((l) => payoutSelection.includes(l.id)).map((l) => l.amount),
                    ),
                  )}
                </strong>
              </Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setPayoutOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleRequestPayout}
            disabled={payoutSelection.length === 0 || payoutBusy}
            data-testid="cpt.payout.submit"
          >
            Submit Request
          </Button>
        </DialogActions>
      </Dialog>

      {/* Referral detail: the progress on approved steps and the documents requested */}
      <Dialog open={detailLeadId !== null} onClose={() => setDetailLeadId(null)} maxWidth="md" fullWidth>
        <DialogContent sx={{ pt: 3 }}>
          {detailLeadId && <PartnerReferralDetail leadId={detailLeadId} />}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDetailLeadId(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Raise Dispute Dialog */}
      <Dialog open={disputeLine !== null} onClose={() => setDisputeLine(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Dispute a statement line</DialogTitle>
        <DialogContent>
          {disputeLine && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Line of {money(Number(disputeLine.amount.amount))} ({disputeLine.state}). Only you and our team
              see this dispute.
            </Typography>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select
              fullWidth
              label="Category"
              value={disputeCategory}
              onChange={(e) => setDisputeCategory(e.target.value)}
            >
              {DISPUTE_CATEGORIES.STATEMENT_LINE.map((c) => (
                <MenuItem key={c.value} value={c.value}>
                  {c.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              required
              fullWidth
              multiline
              rows={3}
              label="What is wrong?"
              placeholder="Describe the problem. Do not include PAN, Aadhaar or account numbers."
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value)}
              onBlur={() => setDisputeTouched(true)}
              error={disputeTouched && reasonError !== null}
              helperText={disputeTouched && reasonError ? reasonError : `${disputeReason.trim().length}/500`}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDisputeLine(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleRaiseDispute} data-testid="cpt.dispute.submit">
            Raise dispute
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
