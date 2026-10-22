// /leads/new (DSA Notion MODULE 7, API-LEAD-001). Manual lead intake with mandatory consent. The form checks every field
// against the same rules as the API before sending, shows problems next to the field, and confirms with a toast.
import React, { useEffect, useState } from 'react';
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
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMe } from '../../api/useMe';
import { useToast } from '../../shell/toast';
import { BranchSelect } from '../admin/components';
import { createLead, ApiError } from './api';
import {
  CONSENT_CHANNELS,
  CONSENT_PURPOSES,
  LEAD_SOURCES,
  PRODUCT_CATEGORIES,
  formFieldFor,
  normalizeAmount,
  validateLead,
  type LeadFieldErrors,
  type LeadForm,
} from './validation';

export function LeadCreate() {
  const navigate = useNavigate();
  const toast = useToast();
  const me = useMe();

  const [form, setForm] = useState<LeadForm>({
    fullName: '',
    mobile: '',
    email: '',
    pincode: '',
    amount: '',
    branchId: '',
    subSource: '',
    campaign: '',
    noticeVersion: 'v1.0',
    evidenceRef: '',
  });
  const [productCategory, setProductCategory] = useState('PL');
  const [source, setSource] = useState('WALK_IN');
  const [connectorId, setConnectorId] = useState('');
  const [priority, setPriority] = useState<'HIGH' | 'MEDIUM' | 'LOW'>('MEDIUM');
  const [consentPurpose, setConsentPurpose] = useState('CONTACT');
  const [consentChannel, setConsentChannel] = useState('IN_PERSON');

  const [errors, setErrors] = useState<LeadFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Default the branch to the user's own branch once it is known.
  useEffect(() => {
    const own = me.data?.primaryBranchId;
    if (own) setForm((f) => (f.branchId ? f : { ...f, branchId: own }));
  }, [me.data?.primaryBranchId]);

  const set = (field: keyof LeadForm) => (value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    // Clear a field's error as soon as the user edits it.
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };
  const fieldProps = (field: keyof LeadForm) => ({
    error: !!errors[field],
    helperText: errors[field],
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const found = validateLead(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      toast.error('Please fix the highlighted fields.');
      return;
    }

    setLoading(true);
    try {
      const amount = form.amount.trim() ? normalizeAmount(form.amount) : null;
      const res = await createLead({
        fullName: form.fullName.trim(),
        mobile: form.mobile.trim(),
        email: form.email.trim() || null,
        productCategory,
        indicativeAmount: amount ? { amount, currency: 'INR' } : null,
        pincode: form.pincode.trim() || null,
        branchId: form.branchId.trim(),
        source,
        subSource: form.subSource.trim() || null,
        campaign: form.campaign.trim() || null,
        connectorId: connectorId.trim() || null,
        priority,
        consent: {
          purpose: consentPurpose,
          noticeVersion: form.noticeVersion.trim(),
          channel: consentChannel,
          evidenceRef: form.evidenceRef?.trim() || null,
        },
      });
      // QA Module 06 step 4: the duplicate classification is shown as soon as the lead is created.
      if (res.lead.duplicateFlag && res.lead.duplicateFlag !== 'NONE') {
        toast.warning(
          `Lead created for ${form.fullName.trim()}, flagged as a ${res.lead.duplicateFlag.toLowerCase().replace(/_/g, ' ')} duplicate.`,
        );
      } else {
        toast.success(`Lead created for ${form.fullName.trim()}.`);
      }
      navigate(`/leads/${res.lead.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        // Put each API problem on its field; anything without a field goes in the banner.
        const fromApi: LeadFieldErrors = {};
        const unplaced: string[] = [];
        for (const d of (err.details ?? []) as Array<{ field?: string; issue?: string }>) {
          const f = formFieldFor(d.field);
          if (f) fromApi[f] = `${d.issue ?? 'Invalid value'}`.replace(/_/g, ' ').toLowerCase();
          else if (d.field || d.issue) unplaced.push(`${d.field ? `${d.field}: ` : ''}${d.issue ?? ''}`);
        }
        setErrors((prev) => ({ ...prev, ...fromApi }));
        const message =
          err.code === 'DUPLICATE_LEAD' ? 'A lead with this mobile number already exists.' : err.message;
        setFormError(unplaced.length ? `${message} (${unplaced.join(', ')})` : message);
        toast.error(message);
      } else {
        const message = (err as Error).message || 'The lead could not be created.';
        setFormError(message);
        toast.error(message);
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

      {formError && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setFormError(null)}>
          {formError}
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
                  value={form.fullName}
                  onChange={(e) => set('fullName')(e.target.value)}
                  placeholder="e.g. Kavya Deshmukh"
                  {...fieldProps('fullName')}
                  inputProps={{ 'data-testid': 'lead-form.fullName', maxLength: 200 }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  required
                  label="Mobile Number"
                  value={form.mobile}
                  onChange={(e) => set('mobile')(e.target.value)}
                  placeholder="e.g. 9876501234"
                  error={!!errors.mobile}
                  helperText={errors.mobile ?? '10-digit Indian mobile number'}
                  inputProps={{ 'data-testid': 'lead-form.mobile', inputMode: 'tel', maxLength: 16 }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Email"
                  type="email"
                  value={form.email}
                  onChange={(e) => set('email')(e.target.value)}
                  placeholder="e.g. kavya@example.com"
                  {...fieldProps('email')}
                  inputProps={{ 'data-testid': 'lead-form.email' }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Pincode"
                  value={form.pincode}
                  onChange={(e) => set('pincode')(e.target.value.replace(/\D/g, ''))}
                  placeholder="e.g. 411001"
                  error={!!errors.pincode}
                  helperText={errors.pincode ?? '6-digit postal code'}
                  inputProps={{ 'data-testid': 'lead-form.pincode', inputMode: 'numeric', maxLength: 6 }}
                />
              </Grid>
            </Grid>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" gutterBottom fontWeight="semibold">
              Product & Loan Requirement
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <TextField
                  select
                  fullWidth
                  label="Product Category"
                  value={productCategory}
                  onChange={(e) => setProductCategory(e.target.value)}
                  inputProps={{ 'data-testid': 'lead-form.productCategory' }}
                >
                  {PRODUCT_CATEGORIES.map((c) => (
                    <MenuItem key={c.value} value={c.value}>
                      {c.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  label="Indicative Amount (INR)"
                  value={form.amount}
                  onChange={(e) => set('amount')(e.target.value)}
                  onBlur={() => {
                    const n = form.amount.trim() ? normalizeAmount(form.amount) : null;
                    if (n) setForm((f) => ({ ...f, amount: n }));
                  }}
                  placeholder="e.g. 300000"
                  error={!!errors.amount}
                  helperText={errors.amount ?? 'Optional'}
                  inputProps={{ 'data-testid': 'lead-form.amount', inputMode: 'decimal' }}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  select
                  fullWidth
                  label="Priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as 'HIGH' | 'MEDIUM' | 'LOW')}
                >
                  <MenuItem value="HIGH">High</MenuItem>
                  <MenuItem value="MEDIUM">Medium</MenuItem>
                  <MenuItem value="LOW">Low</MenuItem>
                </TextField>
              </Grid>
            </Grid>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" gutterBottom fontWeight="semibold">
              Attribution & Routing
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <Box data-testid="lead-form.branchId">
                  <BranchSelect
                    required
                    value={form.branchId || null}
                    onChange={(id) => set('branchId')(id ?? '')}
                  />
                </Box>
                {errors.branchId && (
                  <Typography variant="caption" color="error" sx={{ ml: 1.75 }}>
                    {errors.branchId}
                  </Typography>
                )}
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  select
                  fullWidth
                  label="Source"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  inputProps={{ 'data-testid': 'lead-form.source' }}
                >
                  {LEAD_SOURCES.map((s) => (
                    <MenuItem key={s.value} value={s.value}>
                      {s.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  label="Sub Source"
                  value={form.subSource}
                  onChange={(e) => set('subSource')(e.target.value)}
                  placeholder="e.g. Branch booth"
                  {...fieldProps('subSource')}
                  inputProps={{ maxLength: 100 }}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  label="Campaign"
                  value={form.campaign}
                  onChange={(e) => set('campaign')(e.target.value)}
                  placeholder="e.g. DIWALI_2026"
                  {...fieldProps('campaign')}
                  inputProps={{ maxLength: 100 }}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  label="Connector ID"
                  value={connectorId}
                  onChange={(e) => setConnectorId(e.target.value)}
                  placeholder="Optional"
                />
              </Grid>
            </Grid>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" gutterBottom fontWeight="semibold">
              Consent Details (DPDP Mandatory)
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  select
                  fullWidth
                  label="Consent Purpose"
                  value={consentPurpose}
                  onChange={(e) => setConsentPurpose(e.target.value)}
                  inputProps={{ 'data-testid': 'lead-form.consentPurpose' }}
                >
                  {CONSENT_PURPOSES.map((p) => (
                    <MenuItem key={p.value} value={p.value}>
                      {p.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  required
                  label="Notice Version"
                  value={form.noticeVersion}
                  onChange={(e) => set('noticeVersion')(e.target.value)}
                  placeholder="e.g. v1.0"
                  {...fieldProps('noticeVersion')}
                  inputProps={{ 'data-testid': 'lead-form.noticeVersion', maxLength: 40 }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  select
                  fullWidth
                  label="Consent Channel"
                  value={consentChannel}
                  onChange={(e) => setConsentChannel(e.target.value)}
                  inputProps={{ 'data-testid': 'lead-form.consentChannel' }}
                >
                  {CONSENT_CHANNELS.map((c) => (
                    <MenuItem key={c.value} value={c.value}>
                      {c.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Consent Evidence Reference"
                  value={form.evidenceRef}
                  onChange={(e) => set('evidenceRef')(e.target.value)}
                  placeholder="e.g. call recording or signed form reference"
                  error={!!errors.evidenceRef}
                  helperText={errors.evidenceRef ?? 'Optional: where the consent proof is kept'}
                  inputProps={{ 'data-testid': 'lead-form.evidenceRef', maxLength: 200 }}
                />
              </Grid>
            </Grid>

            <Box mt={4} display="flex" justifyContent="flex-end" gap={2}>
              <Button variant="outlined" component={RouterLink} to="/leads" disabled={loading}>
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
