// Customer page tabs for task P1-02 (owner: Bhushan): Profile (employment, income), Identity (PAN and date of birth, masked, with a
// reveal that needs a reason and a step-up code) and Addresses. Every value is validated with the same zod schemas the API uses.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  Grid,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import {
  ADDRESS_OWNERSHIPS,
  ADDRESS_TYPES,
  CONSTITUTIONS,
  CustomerAddressCreate,
  CustomerIdentityUpsert,
  CustomerProfileUpsert,
  EMPLOYMENT_TYPES,
  type CustomerAddressView,
  type CustomerProfileView,
} from '@dsa/contracts';
import { hasPermission, useMe } from '../../api/useMe';
import {
  ApiError,
  addCustomerAddress,
  getCustomerIdentity,
  getCustomerProfile,
  listCustomerAddresses,
  removeCustomerAddress,
  revealCustomerField,
  saveCustomerIdentity,
  saveCustomerProfile,
  updateCustomerAddress,
} from './api';

const label = (code: string) => code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ');
const errorText = (err: unknown) =>
  err instanceof ApiError ? `${err.message}` : err instanceof Error ? err.message : 'Something went wrong.';
/** Rupees typed by the user → the API's money string. Empty means "not given". */
const toMoney = (rupees: string) =>
  rupees.trim() === ''
    ? null
    : { amount: Number(rupees.replace(/,/g, '')).toFixed(2), currency: 'INR' as const };
const firstIssue = (result: {
  success: boolean;
  error?: { issues: { path: (string | number)[]; message: string }[] };
}) =>
  result.success ? null : `${result.error!.issues[0]!.path.join('.')}: ${result.error!.issues[0]!.message}`;

export function CustomerProfileTabs({ customerId, readOnly }: { customerId: string; readOnly: boolean }) {
  const [tab, setTab] = useState(0);
  return (
    <Card sx={{ borderRadius: 2 }} data-testid="customer.profile-tabs">
      <Tabs
        value={tab}
        onChange={(_e, v: number) => setTab(v)}
        sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="Profile" data-testid="customer.tab.profile" />
        <Tab label="Identity" data-testid="customer.tab.identity" />
        <Tab label="Addresses" data-testid="customer.tab.addresses" />
      </Tabs>
      <CardContent>
        {tab === 0 && <ProfileTab customerId={customerId} readOnly={readOnly} />}
        {tab === 1 && <IdentityTab customerId={customerId} readOnly={readOnly} />}
        {tab === 2 && <AddressesTab customerId={customerId} readOnly={readOnly} />}
      </CardContent>
    </Card>
  );
}

// ---- Profile --------------------------------------------------------------------------------------------------------------------

export function ProfileTab({ customerId, readOnly }: { customerId: string; readOnly: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['customer-profile', customerId],
    queryFn: () => getCustomerProfile(customerId),
  });
  const [form, setForm] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const p: CustomerProfileView | undefined = q.data?.profile;
    if (!p) return;
    setForm({
      constitution: p.constitution ?? '',
      employmentType: p.employmentType ?? '',
      employerName: p.employerName ?? '',
      businessName: p.businessName ?? '',
      vintageMonths: p.vintageMonths === null ? '' : String(p.vintageMonths),
      gstin: p.gstin ?? '',
      udyamNumber: p.udyamNumber ?? '',
      monthlyIncome: p.monthlyIncome?.amount ?? '',
      monthlyObligations: p.monthlyObligations?.amount ?? '',
    });
  }, [q.data]);

  const save = useMutation({
    mutationFn: (payload: object) => saveCustomerProfile(customerId, payload, q.data?.etag ?? '"0"'),
    onSuccess: () => {
      setMessage({ ok: true, text: 'Profile saved.' });
      qc.invalidateQueries({ queryKey: ['customer-profile', customerId] });
    },
    onError: (err) =>
      setMessage({
        ok: false,
        text:
          err instanceof ApiError && err.code === 'VERSION_CONFLICT'
            ? 'Someone else changed this profile. Reload and try again.'
            : errorText(err),
      }),
  });

  if (q.isLoading) return <CircularProgress size={24} />;
  if (q.isError) return <Alert severity="error">{errorText(q.error)}</Alert>;

  const set = (k: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const onSave = () => {
    const text = (k: string) => (form[k]?.trim() ? form[k]!.trim() : null);
    const payload = {
      constitution: text('constitution'),
      employmentType: text('employmentType'),
      employerName: text('employerName'),
      businessName: text('businessName'),
      vintageMonths: form.vintageMonths?.trim() ? Number(form.vintageMonths) : null,
      gstin: text('gstin'),
      udyamNumber: text('udyamNumber'),
      monthlyIncome: toMoney(form.monthlyIncome ?? ''),
      monthlyObligations: toMoney(form.monthlyObligations ?? ''),
    };
    const issue = firstIssue(CustomerProfileUpsert.safeParse(payload));
    if (issue) return setMessage({ ok: false, text: issue });
    setMessage(null);
    save.mutate(payload);
  };

  const field = (k: string, lbl: string, props: object = {}) => (
    <TextField
      label={lbl}
      value={form[k] ?? ''}
      onChange={set(k)}
      fullWidth
      size="small"
      disabled={readOnly}
      inputProps={{ 'data-testid': `customer.profile.${k}` }}
      {...props}
    />
  );
  const select = (k: string, lbl: string, options: readonly string[]) =>
    field(k, lbl, {
      select: true,
      children: [
        <MenuItem key="" value="">
          Not set
        </MenuItem>,
        ...options.map((o) => (
          <MenuItem key={o} value={o}>
            {label(o)}
          </MenuItem>
        )),
      ],
    });

  return (
    <Stack spacing={2}>
      {message && <Alert severity={message.ok ? 'success' : 'error'}>{message.text}</Alert>}
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          {select('constitution', 'Constitution', CONSTITUTIONS)}
        </Grid>
        <Grid item xs={12} md={6}>
          {select('employmentType', 'Employment type', EMPLOYMENT_TYPES)}
        </Grid>
        <Grid item xs={12} md={6}>
          {field('employerName', 'Employer name')}
        </Grid>
        <Grid item xs={12} md={6}>
          {field('businessName', 'Business name')}
        </Grid>
        <Grid item xs={12} md={4}>
          {field('vintageMonths', 'Job or business vintage (months)', { type: 'number' })}
        </Grid>
        <Grid item xs={12} md={4}>
          {field('gstin', 'GSTIN', { placeholder: '27ABCDE1234F1Z5' })}
        </Grid>
        <Grid item xs={12} md={4}>
          {field('udyamNumber', 'Udyam number', { placeholder: 'UDYAM-MH-01-0001234' })}
        </Grid>
        <Grid item xs={12} md={6}>
          {field('monthlyIncome', 'Monthly income (₹)', { type: 'number' })}
        </Grid>
        <Grid item xs={12} md={6}>
          {field('monthlyObligations', 'Monthly EMIs and obligations (₹)', { type: 'number' })}
        </Grid>
      </Grid>
      {!readOnly && (
        <Box>
          <Button
            variant="contained"
            onClick={onSave}
            disabled={save.isPending}
            data-testid="customer.profile.save"
          >
            {save.isPending ? 'Saving…' : 'Save profile'}
          </Button>
        </Box>
      )}
    </Stack>
  );
}

// ---- Identity -------------------------------------------------------------------------------------------------------------------

export function IdentityTab({ customerId, readOnly }: { customerId: string; readOnly: boolean }) {
  const qc = useQueryClient();
  const me = useMe();
  const canReveal = hasPermission(me.data, 'customer.reveal_sensitive');
  const q = useQuery({
    queryKey: ['customer-identity', customerId],
    queryFn: () => getCustomerIdentity(customerId),
  });
  const [pan, setPan] = useState('');
  const [dob, setDob] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [revealField, setRevealField] = useState<'PAN' | 'DATE_OF_BIRTH' | null>(null);
  const [reason, setReason] = useState('');
  const [revealed, setRevealed] = useState<{ field: string; value: string } | null>(null);

  // A revealed value is shown for 30 seconds, then hidden again.
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(null), 30_000);
    return () => clearTimeout(t);
  }, [revealed]);

  const save = useMutation({
    mutationFn: (payload: { pan?: string; dateOfBirth?: string }) =>
      saveCustomerIdentity(customerId, payload, q.data?.etag ?? '"0"'),
    onSuccess: (r) => {
      setPan('');
      setDob('');
      setMessage({
        ok: true,
        text: r.identity.possibleDuplicatePan
          ? 'Saved. Another customer has the same PAN: it is flagged for duplicate review, nothing was merged.'
          : 'Saved.',
      });
      qc.invalidateQueries({ queryKey: ['customer-identity', customerId] });
    },
    onError: (err) => setMessage({ ok: false, text: errorText(err) }),
  });

  const reveal = useMutation({
    mutationFn: () => revealCustomerField(customerId, revealField!, reason.trim()),
    onSuccess: (r) => {
      setRevealed({ field: revealField!, value: r.value });
      setRevealField(null);
      setReason('');
    },
    onError: (err) =>
      setMessage({
        ok: false,
        text: JSON.stringify(err instanceof ApiError ? err.details : '').includes('PROJECT_SECOND_FACTOR_OFF')
          ? 'Reveal is switched off until two-factor sign-in is enabled for this organisation.'
          : errorText(err),
      }),
  });

  if (q.isLoading) return <CircularProgress size={24} />;
  if (q.isError) return <Alert severity="error">{errorText(q.error)}</Alert>;
  const identity = q.data!.identity;

  const onSave = () => {
    const payload: { pan?: string; dateOfBirth?: string } = {};
    if (pan.trim()) payload.pan = pan.trim();
    if (dob) payload.dateOfBirth = dob;
    const issue = firstIssue(CustomerIdentityUpsert.safeParse(payload));
    if (issue) return setMessage({ ok: false, text: issue });
    setMessage(null);
    save.mutate(payload);
  };

  return (
    <Stack spacing={2}>
      {message && <Alert severity={message.ok ? 'success' : 'error'}>{message.text}</Alert>}
      {identity.possibleDuplicatePan && (
        <Alert severity="warning" data-testid="customer.identity.duplicate">
          Another customer has the same PAN. It is flagged for duplicate review; nothing was merged.
        </Alert>
      )}
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Typography variant="caption" color="text.secondary">
            PAN
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography data-testid="customer.identity.pan-masked" sx={{ fontFamily: 'monospace' }}>
              {revealed?.field === 'PAN' ? revealed.value : (identity.panMasked ?? 'Not stored')}
            </Typography>
            {canReveal && identity.panMasked && revealed?.field !== 'PAN' && (
              <Button
                size="small"
                onClick={() => setRevealField('PAN')}
                data-testid="customer.identity.reveal-pan"
              >
                Reveal
              </Button>
            )}
          </Stack>
        </Grid>
        <Grid item xs={12} md={6}>
          <Typography variant="caption" color="text.secondary">
            Date of birth
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography data-testid="customer.identity.dob-masked">
              {revealed?.field === 'DATE_OF_BIRTH'
                ? revealed.value
                : identity.hasDateOfBirth
                  ? `Stored (born ${identity.birthYear})`
                  : 'Not stored'}
            </Typography>
            {canReveal && identity.hasDateOfBirth && revealed?.field !== 'DATE_OF_BIRTH' && (
              <Button
                size="small"
                onClick={() => setRevealField('DATE_OF_BIRTH')}
                data-testid="customer.identity.reveal-dob"
              >
                Reveal
              </Button>
            )}
          </Stack>
        </Grid>
      </Grid>
      {!readOnly && (
        <Grid container spacing={2}>
          <Grid item xs={12} md={5}>
            <TextField
              label={identity.panMasked ? 'Replace PAN' : 'PAN'}
              value={pan}
              onChange={(e) => setPan(e.target.value.toUpperCase())}
              size="small"
              fullWidth
              autoComplete="off"
              placeholder="ABCDE1234F"
              inputProps={{ maxLength: 10, 'data-testid': 'customer.identity.pan' }}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              label="Date of birth"
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              size="small"
              fullWidth
              InputLabelProps={{ shrink: true }}
              inputProps={{ 'data-testid': 'customer.identity.dob' }}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <Button
              variant="contained"
              onClick={onSave}
              disabled={save.isPending || (!pan.trim() && !dob)}
              data-testid="customer.identity.save"
            >
              {save.isPending ? 'Saving…' : 'Save identity'}
            </Button>
          </Grid>
        </Grid>
      )}
      <Typography variant="caption" color="text.secondary">
        PAN and date of birth are stored encrypted. Aadhaar numbers are never stored.
      </Typography>

      <Dialog open={revealField !== null} onClose={() => setRevealField(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Reveal {revealField === 'PAN' ? 'PAN' : 'date of birth'}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            The value is shown for 30 seconds. Your name and reason are recorded in the audit trail, and you
            may be asked for your authenticator code.
          </Typography>
          <TextField
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            fullWidth
            required
            placeholder="Lender query on login"
            inputProps={{ 'data-testid': 'customer.identity.reveal-reason' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevealField(null)} data-testid="customer.identity.reveal-cancel">
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => reveal.mutate()}
            disabled={reason.trim().length < 5 || reveal.isPending}
            data-testid="customer.identity.reveal-confirm"
          >
            Reveal
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

// ---- Addresses ------------------------------------------------------------------------------------------------------------------

const EMPTY_ADDRESS: Record<string, string> = {
  addressType: 'CURRENT',
  line1: '',
  line2: '',
  landmark: '',
  city: '',
  state: '',
  pincode: '',
  ownership: '',
  yearsAtAddress: '',
};

export function AddressesTab({ customerId, readOnly }: { customerId: string; readOnly: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['customer-addresses', customerId],
    queryFn: () => listCustomerAddresses(customerId),
  });
  const [editing, setEditing] = useState<CustomerAddressView | 'new' | null>(null);
  const [form, setForm] = useState<Record<string, string>>(EMPTY_ADDRESS);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['customer-addresses', customerId] });

  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (editing === 'new') return addCustomerAddress(customerId, payload as never);
      const { addressType: _type, ...changes } = payload;
      return updateCustomerAddress(customerId, editing as CustomerAddressView, changes as never);
    },
    onSuccess: () => {
      setEditing(null);
      setMessage({ ok: true, text: 'Address saved.' });
      refresh();
    },
    onError: (err) => setMessage({ ok: false, text: errorText(err) }),
  });
  const remove = useMutation({
    mutationFn: (a: CustomerAddressView) => removeCustomerAddress(customerId, a),
    onSuccess: () => {
      setMessage({ ok: true, text: 'Address removed.' });
      refresh();
    },
    onError: (err) => setMessage({ ok: false, text: errorText(err) }),
  });

  if (q.isLoading) return <CircularProgress size={24} />;
  if (q.isError) return <Alert severity="error">{errorText(q.error)}</Alert>;
  const addresses = q.data ?? [];
  const freeTypes = ADDRESS_TYPES.filter((t) => !addresses.some((a) => a.addressType === t));

  const open = (a: CustomerAddressView | 'new') => {
    setMessage(null);
    setEditing(a);
    setForm(
      a === 'new'
        ? { ...EMPTY_ADDRESS, addressType: freeTypes[0] ?? 'CURRENT' }
        : {
            addressType: a.addressType,
            line1: a.line1,
            line2: a.line2 ?? '',
            landmark: a.landmark ?? '',
            city: a.city,
            state: a.state,
            pincode: a.pincode,
            ownership: a.ownership ?? '',
            yearsAtAddress: a.yearsAtAddress === null ? '' : String(a.yearsAtAddress),
          },
    );
  };
  const onSave = () => {
    const opt = (k: string) => (form[k]?.trim() ? form[k]!.trim() : null);
    const payload = {
      addressType: form.addressType,
      line1: form.line1?.trim(),
      line2: opt('line2'),
      landmark: opt('landmark'),
      city: form.city?.trim(),
      state: form.state?.trim(),
      pincode: form.pincode?.trim(),
      ownership: opt('ownership'),
      yearsAtAddress: form.yearsAtAddress?.trim() ? Number(form.yearsAtAddress) : null,
    };
    const issue = firstIssue(CustomerAddressCreate.safeParse(payload));
    if (issue) return setMessage({ ok: false, text: issue });
    save.mutate(payload);
  };
  const set = (k: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const input = (k: string, lbl: string, props: object = {}) => (
    <TextField
      label={lbl}
      value={form[k] ?? ''}
      onChange={set(k)}
      fullWidth
      size="small"
      inputProps={{ 'data-testid': `customer.address.${k}` }}
      {...props}
    />
  );

  return (
    <Stack spacing={2}>
      {message && <Alert severity={message.ok ? 'success' : 'error'}>{message.text}</Alert>}
      {addresses.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No addresses yet.
        </Typography>
      )}
      {addresses.map((a) => (
        <Box
          key={a.id}
          sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}
          data-testid="customer.address.item"
        >
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
            <Box>
              <Chip size="small" label={label(a.addressType)} sx={{ mb: 0.5 }} />
              <Typography variant="body2">
                {[a.line1, a.line2, a.landmark].filter(Boolean).join(', ')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {a.city}, {a.state} {a.pincode}
                {a.ownership ? ` · ${label(a.ownership)}` : ''}
                {a.yearsAtAddress !== null ? ` · ${a.yearsAtAddress} years` : ''}
              </Typography>
            </Box>
            {!readOnly && (
              <Stack direction="row" spacing={1}>
                <Button size="small" onClick={() => open(a)} data-testid="customer.address.edit">
                  Edit
                </Button>
                <Button
                  size="small"
                  color="error"
                  onClick={() => remove.mutate(a)}
                  disabled={remove.isPending}
                  data-testid="customer.address.remove"
                >
                  Remove
                </Button>
              </Stack>
            )}
          </Stack>
        </Box>
      ))}
      {!readOnly && freeTypes.length > 0 && (
        <Box>
          <Button variant="outlined" onClick={() => open('new')} data-testid="customer.address.add">
            Add address
          </Button>
        </Box>
      )}

      <Dialog open={editing !== null} onClose={() => setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing === 'new' ? 'Add address' : 'Edit address'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0 }}>
            <Grid item xs={12} md={6}>
              {input('addressType', 'Type', {
                select: true,
                disabled: editing !== 'new',
                children: (editing === 'new' ? freeTypes : ADDRESS_TYPES).map((t) => (
                  <MenuItem key={t} value={t}>
                    {label(t)}
                  </MenuItem>
                )),
              })}
            </Grid>
            <Grid item xs={12} md={6}>
              {input('ownership', 'Ownership', {
                select: true,
                children: [
                  <MenuItem key="" value="">
                    Not set
                  </MenuItem>,
                  ...ADDRESS_OWNERSHIPS.map((o) => (
                    <MenuItem key={o} value={o}>
                      {label(o)}
                    </MenuItem>
                  )),
                ],
              })}
            </Grid>
            <Grid item xs={12}>
              {input('line1', 'Address line 1', { required: true })}
            </Grid>
            <Grid item xs={12} md={6}>
              {input('line2', 'Address line 2')}
            </Grid>
            <Grid item xs={12} md={6}>
              {input('landmark', 'Landmark')}
            </Grid>
            <Grid item xs={12} md={4}>
              {input('city', 'City', { required: true })}
            </Grid>
            <Grid item xs={12} md={4}>
              {input('state', 'State', { required: true })}
            </Grid>
            <Grid item xs={12} md={4}>
              {input('pincode', 'Pincode', {
                required: true,
                inputProps: { maxLength: 6, 'data-testid': 'customer.address.pincode' },
              })}
            </Grid>
            <Grid item xs={12} md={4}>
              {input('yearsAtAddress', 'Years at address', { type: 'number' })}
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)} data-testid="customer.address.cancel">
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={onSave}
            disabled={save.isPending}
            data-testid="customer.address.save"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
