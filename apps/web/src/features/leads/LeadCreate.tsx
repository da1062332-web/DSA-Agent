import React, { useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { createLead, ApiError } from './api';

export function LeadCreate() {
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [productCategory, setProductCategory] = useState('PL');
  const [amount, setAmount] = useState('500000');
  const [currency] = useState('INR');
  const [pincode, setPincode] = useState('560001');
  const [branchId, setBranchId] = useState('br_blr_01');
  const [source, setSource] = useState('WALK_IN');
  const [subSource, setSubSource] = useState('');
  const [campaign, setCampaign] = useState('');
  const [connectorId, setConnectorId] = useState('');
  const [priority, setPriority] = useState<'HIGH' | 'MEDIUM' | 'LOW'>('MEDIUM');

  // Consent fields
  const [consentPurpose, setConsentPurpose] = useState('CONTACT');
  const [noticeVersion, setNoticeVersion] = useState('v1.0');
  const [consentChannel, setConsentChannel] = useState('IN_PERSON');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationDetails, setValidationDetails] = useState<Array<{ field?: string; issue?: string }>>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setValidationDetails([]);

    // Client-side quick validations
    if (!fullName.trim() || fullName.trim().length < 2) {
      setError('Full Name must be at least 2 characters');
      return;
    }
    if (!mobile.trim() || mobile.replace(/\D/g, '').length < 10) {
      setError('Mobile number must be a valid 10-digit number');
      return;
    }
    if (pincode && !/^[1-9][0-9]{5}$/.test(pincode.trim())) {
      setError('Pincode must be exactly 6 digits not starting with 0');
      return;
    }

    setLoading(true);

    try {
      const res = await createLead({
        fullName: fullName.trim(),
        mobile: mobile.trim(),
        email: email.trim() || null,
        productCategory,
        indicativeAmount: amount.trim() ? { amount: amount.trim(), currency } : null,
        pincode: pincode.trim() || null,
        branchId: branchId.trim(),
        source,
        subSource: subSource.trim() || null,
        campaign: campaign.trim() || null,
        connectorId: connectorId.trim() || null,
        priority,
        consent: {
          purpose: consentPurpose,
          noticeVersion: noticeVersion.trim(),
          channel: consentChannel,
        },
      });

      navigate(`/leads/${res.lead.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`${err.code}: ${err.message}`);
        if (Array.isArray(err.details)) {
          setValidationDetails(err.details as Array<{ field?: string; issue?: string }>);
        }
      } else {
        setError((err as Error).message || 'Failed to create lead');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box mb={3}>
        <Stack direction="row" spacing={1} alignItems="center" mb={1}>
          <Button component={RouterLink} to="/leads" size="small" variant="text">
            ← Back to Leads
          </Button>
        </Stack>
        <Typography variant="h4" component="h1" fontWeight="bold">
          Create New Lead
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Manual lead intake with mandatory customer consent
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          <Typography variant="body2" fontWeight="bold">{error}</Typography>
          {validationDetails.length > 0 && (
            <Box component="ul" sx={{ pl: 2, mt: 1, mb: 0 }}>
              {validationDetails.map((d, i) => (
                <li key={i}>{d.field ? `${d.field}: ` : ''}{d.issue}</li>
              ))}
            </Box>
          )}
        </Alert>
      )}

      <Card>
        <CardContent sx={{ p: 4 }}>
          <Box component="form" onSubmit={handleSubmit} noValidate>
            <Typography variant="h6" gutterBottom fontWeight="semibold">
              Basic Details
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  required
                  label="Full Name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Ramesh Kumar"
                  data-testid="lead-form.fullName"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  required
                  label="Mobile Number"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="e.g. 9876543210"
                  helperText="10-digit Indian mobile number"
                  data-testid="lead-form.mobile"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. ramesh@example.com"
                  data-testid="lead-form.email"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Pincode"
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value)}
                  placeholder="e.g. 560001"
                  helperText="6-digit postal code"
                  data-testid="lead-form.pincode"
                />
              </Grid>
            </Grid>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" gutterBottom fontWeight="semibold">
              Product & Loan Requirement
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth>
                  <InputLabel id="product-category-label">Product Category</InputLabel>
                  <Select
                    labelId="product-category-label"
                    value={productCategory}
                    label="Product Category"
                    onChange={(e) => setProductCategory(e.target.value)}
                    data-testid="lead-form.productCategory"
                  >
                    <MenuItem value="PL">Personal Loan (PL)</MenuItem>
                    <MenuItem value="HL">Home Loan (HL)</MenuItem>
                    <MenuItem value="BL">Business Loan (BL)</MenuItem>
                    <MenuItem value="LAP">Loan Against Property (LAP)</MenuItem>
                    <MenuItem value="AL">Auto Loan (AL)</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  label="Indicative Amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 500000"
                  data-testid="lead-form.amount"
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth>
                  <InputLabel id="priority-label">Priority</InputLabel>
                  <Select
                    labelId="priority-label"
                    value={priority}
                    label="Priority"
                    onChange={(e) => setPriority(e.target.value as 'HIGH' | 'MEDIUM' | 'LOW')}
                  >
                    <MenuItem value="HIGH">High</MenuItem>
                    <MenuItem value="MEDIUM">Medium</MenuItem>
                    <MenuItem value="LOW">Low</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" gutterBottom fontWeight="semibold">
              Attribution & Routing
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  required
                  label="Branch ID"
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  placeholder="e.g. br_blr_01"
                  data-testid="lead-form.branchId"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel id="source-label">Source</InputLabel>
                  <Select
                    labelId="source-label"
                    value={source}
                    label="Source"
                    onChange={(e) => setSource(e.target.value)}
                    data-testid="lead-form.source"
                  >
                    <MenuItem value="WALK_IN">Walk-in</MenuItem>
                    <MenuItem value="CONNECTOR_REFERRAL">Connector Referral</MenuItem>
                    <MenuItem value="INBOUND_CALL">Inbound Call</MenuItem>
                    <MenuItem value="DIGITAL_CAMPAIGN">Digital Campaign</MenuItem>
                    <MenuItem value="BTL_EVENT">BTL Event</MenuItem>
                    <MenuItem value="PARTNER">Partner</MenuItem>
                    <MenuItem value="OTHER">Other</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  label="Sub Source"
                  value={subSource}
                  onChange={(e) => setSubSource(e.target.value)}
                  placeholder="e.g. Branch Booth"
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  label="Campaign"
                  value={campaign}
                  onChange={(e) => setCampaign(e.target.value)}
                  placeholder="e.g. DIWALI_2026"
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  label="Connector ID"
                  value={connectorId}
                  onChange={(e) => setConnectorId(e.target.value)}
                  placeholder="e.g. conn_01"
                />
              </Grid>
            </Grid>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" gutterBottom fontWeight="semibold">
              Consent Details (DPDP Mandatory)
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth>
                  <InputLabel id="consent-purpose-label">Consent Purpose</InputLabel>
                  <Select
                    labelId="consent-purpose-label"
                    value={consentPurpose}
                    label="Consent Purpose"
                    onChange={(e) => setConsentPurpose(e.target.value)}
                    data-testid="lead-form.consentPurpose"
                  >
                    <MenuItem value="CONTACT">Contact</MenuItem>
                    <MenuItem value="LOAN_PROCESSING">Loan Processing</MenuItem>
                    <MenuItem value="SHARE_WITH_LENDER">Share With Lender</MenuItem>
                    <MenuItem value="VERIFICATION_CHECK">Verification Check</MenuItem>
                    <MenuItem value="MARKETING">Marketing</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  required
                  label="Notice Version"
                  value={noticeVersion}
                  onChange={(e) => setNoticeVersion(e.target.value)}
                  placeholder="e.g. v1.0"
                  data-testid="lead-form.noticeVersion"
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth>
                  <InputLabel id="consent-channel-label">Consent Channel</InputLabel>
                  <Select
                    labelId="consent-channel-label"
                    value={consentChannel}
                    label="Consent Channel"
                    onChange={(e) => setConsentChannel(e.target.value)}
                    data-testid="lead-form.consentChannel"
                  >
                    <MenuItem value="IN_PERSON">In Person</MenuItem>
                    <MenuItem value="PHONE">Phone / Telephonic</MenuItem>
                    <MenuItem value="WEB_FORM">Web Form</MenuItem>
                    <MenuItem value="EMAIL">Email</MenuItem>
                    <MenuItem value="OTP">OTP Verified</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>

            <Box mt={4} display="flex" justifyContent="flex-end" gap={2}>
              <Button
                variant="outlined"
                component={RouterLink}
                to="/leads"
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="contained"
                color="primary"
                disabled={loading}
                data-testid="lead-form.submit"
                startIcon={loading && <CircularProgress size={18} color="inherit" />}
              >
                {loading ? 'Creating...' : 'Create Lead'}
              </Button>
            </Box>
          </Box>
        </CardContent>
      </Card>
    </Container>
  );
}
