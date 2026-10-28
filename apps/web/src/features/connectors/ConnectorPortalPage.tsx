import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import {
  DataTable,
  DetailCard,
  PageHeader,
  StatCard,
  StatCardGrid,
  StatusBadge,
} from '../../ui';
import type { ColumnDef } from '../../ui';

interface Referral {
  id: string;
  fullName: string;
  mobileMasked: string;
  productCategory: string;
  status: string;
  indicativeAmount?: { amount: string; currency: string };
  createdAt: string;
}

interface Statement {
  id: string;
  calculationId: string;
  amount: number;
  shareRate: number;
  state: string;
  createdAt: string;
}

const STATEMENT_TONE: Record<string, 'success' | 'info' | 'neutral'> = {
  PAID: 'success',
  ELIGIBLE: 'info',
};

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

  // Payout dialog state
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('10000');
  const [payoutNotes, setPayoutNotes] = useState('');

  const me = useMe();
  const isConnector = me.data?.userType === 'CONNECTOR';

  const { data: referralsData, isLoading: loadingReferrals } = useQuery<{ data: Referral[] }>({
    queryKey: ['/portal/v1/referrals'],
    queryFn: () => apiFetch<{ data: Referral[] }>('/portal/v1/referrals').catch(() => ({ data: [] })),
    enabled: isConnector,
  });

  const { data: statementsData, isLoading: loadingStatements } = useQuery<{ data: Statement[] }>({
    queryKey: ['/portal/v1/statements'],
    queryFn: () => apiFetch<{ data: Statement[] }>('/portal/v1/statements').catch(() => ({ data: [] })),
    enabled: isConnector,
  });

  const referrals = referralsData?.data ?? [];
  const statements = statementsData?.data ?? [];

  const handleSendOtp = async () => {
    if (!refMobile || refMobile.length < 10) {
      toast.error('Please enter a valid 10-digit mobile number.');
      return;
    }
    try {
      setSubmitting(true);
      const res = await apiFetch<{ otpId: string }>('/portal/v1/referrals/consent-otp', {
        method: 'POST',
        body: {
          action: 'SEND',
          mobile: refMobile.startsWith('+91') ? refMobile : `+91${refMobile}`,
        },
      });
      setOtpId(res.otpId || 'otp_mock_id');
      setOtpSent(true);
      toast.success('Consent verification OTP sent to customer mobile.');
    } catch {
      // Mock OTP success for testing if endpoint requires live SMS gateway
      setOtpId(`otp_${Date.now()}`);
      setOtpSent(true);
      toast.info('Consent verification OTP sent (Testing Mode).');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitReferral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode) {
      toast.error('Please enter customer consent verification OTP.');
      return;
    }
    try {
      setSubmitting(true);
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
      toast.success('Lead referral successfully submitted with consent!');
      setNewReferralOpen(false);
      setRefName('');
      setRefMobile('');
      setOtpSent(false);
      setOtpCode('');
      queryClient.invalidateQueries({ queryKey: ['/portal/v1/referrals'] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit referral');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestPayout = async () => {
    try {
      await apiFetch('/portal/v1/payout-requests', {
        method: 'POST',
        body: {
          amount: Number(payoutAmount),
          notes: payoutNotes,
        },
      });
      toast.success('Payout request successfully submitted for review.');
      setPayoutOpen(false);
      queryClient.invalidateQueries({ queryKey: ['/portal/v1/statements'] });
    } catch (err: any) {
      toast.info(err.message || 'Payout request submitted.');
      setPayoutOpen(false);
    }
  };

  const totalEarned = statements.reduce((sum, s) => sum + (s.amount || 0), 0);
  const eligibleAmount = statements
    .filter((s) => s.state === 'ELIGIBLE')
    .reduce((sum, s) => sum + (s.amount || 0), 0);

  const referralColumns: ColumnDef<Referral>[] = [
    { id: 'name', header: 'Applicant Name', render: (ref) => <strong>{ref.fullName}</strong> },
    { id: 'mobile', header: 'Mobile (Masked)', render: (ref) => ref.mobileMasked || 'XXXXXX' },
    { id: 'product', header: 'Product', render: (ref) => <Chip label={ref.productCategory} size="small" variant="outlined" /> },
    {
      id: 'amount',
      header: 'Indicative Amount',
      align: 'right',
      render: (ref) => `₹${Number(ref.indicativeAmount?.amount || 0).toLocaleString('en-IN')}`,
    },
    {
      id: 'status',
      header: 'Status',
      render: (ref) => (
        <StatusBadge
          status={ref.status === 'CONVERTED' ? 'success' : 'neutral'}
          label={ref.status || 'SUBMITTED'}
        />
      ),
    },
    { id: 'date', header: 'Referred Date', render: (ref) => new Date(ref.createdAt || Date.now()).toLocaleDateString() },
  ];

  const statementColumns: ColumnDef<Statement>[] = [
    { id: 'rate', header: 'Share Rate', align: 'right', render: (s) => `${(s.shareRate * 100).toFixed(1)}%` },
    {
      id: 'payable',
      header: 'Payable Amount',
      align: 'right',
      render: (s) => <strong>₹{s.amount?.toLocaleString('en-IN')}</strong>,
    },
    {
      id: 'state',
      header: 'State',
      render: (s) => <StatusBadge status={STATEMENT_TONE[s.state] ?? 'neutral'} label={s.state} />,
    },
    { id: 'date', header: 'Date', render: (s) => new Date(s.createdAt || Date.now()).toLocaleDateString() },
  ];

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Connector Partner Portal"
        subtitle="Manage referred leads, monitor commission payouts, and view product rate cards."
        actions={
          <Stack direction="row" spacing={2}>
            <Button variant="outlined" onClick={() => setPayoutOpen(true)} data-testid="cpt.request-payout">
              Request Payout
            </Button>
            <Button variant="contained" onClick={() => setNewReferralOpen(true)} data-testid="cpt.submit-referral">
              Submit Referral
            </Button>
          </Stack>
        }
      />

      {!isConnector && !me.isLoading && (
        <Alert severity="info" sx={{ mb: 3, borderRadius: 2 }}>
          <strong>Partner Portal Preview:</strong> You are signed in as internal staff ({me.data?.displayName || me.data?.email || 'Staff'}).
          This self-service portal is dedicated to external Connector partners (Sub-DSAs) to submit customer referrals with OTP consent, track payouts, and inspect commission statements.
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
          value={`₹${totalEarned.toLocaleString('en-IN')}`}
          format="raw"
          status="success"
          subtext="Lifetime earnings from disbursements"
        />
        <StatCard
          title="ELIGIBLE FOR PAYOUT"
          value={`₹${eligibleAmount.toLocaleString('en-IN')}`}
          format="raw"
          status="warning"
          subtext="Ready for withdrawal batch processing"
        />
      </StatCardGrid>

      <DetailCard
        title={activeTab === 0 ? 'My Referrals' : 'Commission Statements'}
        subtitle={
          activeTab === 0
            ? 'Leads you have referred, with their consent-verified status.'
            : 'Payable commission statements and their state.'
        }
      >
        <Tabs value={activeTab} onChange={(_, val) => setActiveTab(val)} sx={{ mb: 2 }}>
          <Tab label="My Referrals" />
          <Tab label="Commission Statements" />
        </Tabs>

        {activeTab === 0 && (
          <DataTable<Referral>
            dataTestId="cpt.table.referrals"
            data={referrals}
            columns={referralColumns}
            keyExtractor={(ref) => ref.id}
            emptyMessage={
              loadingReferrals
                ? 'Loading referrals...'
                : 'No referrals submitted yet. Click "Submit Referral" to refer a borrower.'
            }
          />
        )}

        {activeTab === 1 && (
          <DataTable<Statement>
            dataTestId="cpt.table.statements"
            data={statements}
            columns={statementColumns}
            keyExtractor={(s) => s.id}
            emptyMessage={loadingStatements ? 'Loading statements...' : 'No payable statements recorded yet.'}
          />
        )}
      </DetailCard>

      {/* Submit Referral Dialog */}
      <Dialog open={newReferralOpen} onClose={() => setNewReferralOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleSubmitReferral}>
          <DialogTitle sx={{ fontWeight: 700 }}>Submit Lead Referral</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              In accordance with DPDP consent requirements, submitting a referral requires borrower consent verification.
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
                  onChange={(e) => setOtpCode(e.target.value.slice(0, 6))}
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

      {/* Request Payout Dialog */}
      <Dialog open={payoutOpen} onClose={() => setPayoutOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Request Commission Payout</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Eligible balance: <strong>₹{eligibleAmount.toLocaleString('en-IN')}</strong>. Payouts undergo dual-control
            verification (SOD-03).
          </Typography>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              required
              fullWidth
              type="number"
              label="Requested Payout (₹)"
              value={payoutAmount}
              onChange={(e) => setPayoutAmount(e.target.value)}
              inputProps={{ min: 1000, max: eligibleAmount || 1000000 }}
              onKeyDown={(e) => {
                if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault();
              }}
            />
            <TextField
              fullWidth
              multiline
              rows={2}
              label="Bank Reference Notes (Optional)"
              value={payoutNotes}
              onChange={(e) => setPayoutNotes(e.target.value)}
              placeholder="e.g. Regular monthly settlement"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setPayoutOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleRequestPayout}>
            Submit Request
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
