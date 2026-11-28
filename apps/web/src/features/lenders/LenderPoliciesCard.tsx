// Lender policy grid on /lenders/:id (owner: Dipanshu; task P1-04, API-LND-POL-001..005). One credit policy per product version,
// versioned DRAFT → ACTIVE → RETIRED. Drafting and editing need lender_policy.manage; activating needs rule.approve and a recent
// second factor (the API asks for step-up), and is refused for anyone who drafted or edited the version (maker-checker, SOD-01).
// Activating retires the previous ACTIVE version of the same product version. Every edit sends the version it loaded (If-Match).
import {
  Alert,
  Box,
  Button,
  Card,
  CardHeader,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  FormLabel,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import type { LenderPolicy } from '@dsa/contracts';
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, errorText } from '../../api/client';
import { hasPermission, useMe } from '../../api/useMe';
import { useCommand, useList, useLookup, useResource } from '../admin/api';
import { ErrorAlert } from '../admin/components';
import type { Product, ProductVersion } from '../admin/ProductsPage';
import { DataTable } from '../../ui';
import {
  EMPLOYMENT_LABELS,
  EMPLOYMENT_OPTIONS,
  EMPTY_POLICY_FORM,
  activationBlocker,
  bpsToPercent,
  formToCreate,
  formToPatch,
  instantToBusinessDate,
  policyToForm,
  rateBand,
  type PolicyForm,
  type PolicyFormErrors,
} from './policy-form';

const LIST = '/v1/lender-policies';
const STATUS_COLOR = { DRAFT: 'default', ACTIVE: 'success', RETIRED: 'warning' } as const;

export function LenderPoliciesCard({ lenderId, lenderOpen }: { lenderId: string; lenderOpen: boolean }) {
  const me = useMe();
  const canRead = hasPermission(me.data, 'lender_policy.read');
  const canManage = hasPermission(me.data, 'lender_policy.manage') && lenderOpen;
  const canApprove = hasPermission(me.data, 'rule.approve');
  const list = useList<LenderPolicy>(LIST, { lenderId }, 100, canRead);
  const products = useLookup<Product>('/v1/products', { lenderId }, canRead);
  const [editing, setEditing] = useState<LenderPolicy | 'new' | null>(null);

  const policies = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const productName = (id: string) => products.data?.find((p) => p.id === id)?.name ?? 'Product';

  const activate = usePolicyTransition();

  if (!canRead) return null;

  return (
    <Card sx={{ mb: 4 }} data-testid="lenderPolicy.card">
      <CardHeader
        title={
          <Typography variant="h6" fontWeight={700}>
            Credit policies
          </Typography>
        }
        subheader="The lender's credit policy for each product version. Matching uses the ACTIVE version only; a draft needs a second person to activate it."
        action={
          canManage && (
            <Button
              variant="contained"
              size="small"
              onClick={() => setEditing('new')}
              data-testid="lenderPolicy.new"
            >
              New policy draft
            </Button>
          )
        }
      />
      <Divider />
      {list.error ? <ErrorAlert error={list.error} /> : null}
      {activate.error ? (
        <Alert severity="error" sx={{ m: 2 }} onClose={activate.reset}>
          {activate.error}
        </Alert>
      ) : null}
      <DataTable<LenderPolicy>
        dataTestId="lenderPolicy.table"
        data={policies}
        isLoading={list.isPending}
        keyExtractor={(p) => p.id}
        emptyMessage="No credit policy yet. Without an ACTIVE policy this lender is left out of lender matching."
        columns={[
          {
            id: 'product',
            header: 'Product',
            render: (p) => (
              <ProductVersionLabel productVersionId={p.productVersionId} productName={productName} />
            ),
          },
          { id: 'version', header: 'Version', render: (p) => `v${p.versionNo}` },
          {
            id: 'status',
            header: 'Status',
            render: (p) => (
              <Chip
                size="small"
                label={p.status}
                color={STATUS_COLOR[p.status]}
                data-testid={`lenderPolicy.status.${p.id}`}
              />
            ),
          },
          { id: 'rate', header: 'Rate', render: (p) => rateBand(p.rateMinBps, p.rateMaxBps) },
          {
            id: 'foir',
            header: 'FOIR cap',
            render: (p) => (p.foirCapBps === null ? '—' : `${bpsToPercent(p.foirCapBps)}%`),
          },
          { id: 'score', header: 'Min score', render: (p) => p.minBureauScore ?? '—' },
          {
            id: 'effective',
            header: 'Effective',
            render: (p) =>
              `${instantToBusinessDate(p.effectiveFrom)}${p.effectiveTo ? ` to ${instantToBusinessDate(p.effectiveTo)}` : ''}`,
          },
          {
            id: 'actions',
            header: '',
            align: 'right',
            render: (p) => {
              const blocker = activationBlocker(p, me.data, canApprove);
              return (
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  {p.status === 'DRAFT' && canManage && (
                    <Button
                      size="small"
                      onClick={() => setEditing(p)}
                      data-testid={`lenderPolicy.edit.${p.id}`}
                    >
                      Edit
                    </Button>
                  )}
                  {p.status === 'DRAFT' && (
                    <Tooltip
                      title={blocker ?? 'Activate this version; the current ACTIVE version is retired.'}
                    >
                      <span>
                        <Button
                          size="small"
                          color="success"
                          disabled={blocker !== null || activate.pending}
                          onClick={() => activate.run(p, 'ACTIVATE')}
                          data-testid={`lenderPolicy.activate.${p.id}`}
                        >
                          Activate
                        </Button>
                      </span>
                    </Tooltip>
                  )}
                  {p.status === 'ACTIVE' && canManage && (
                    <Button
                      size="small"
                      color="warning"
                      disabled={activate.pending}
                      onClick={() => activate.run(p, 'RETIRE')}
                      data-testid={`lenderPolicy.retire.${p.id}`}
                    >
                      Retire
                    </Button>
                  )}
                </Stack>
              );
            },
          },
        ]}
      />
      {editing && (
        <PolicyDialog
          lenderId={lenderId}
          policy={editing === 'new' ? null : editing}
          products={products.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

/** ACTIVATE or RETIRE with the loaded version as If-Match. The body is { action } only (the schema is strict). */
function usePolicyTransition() {
  const qc = useQueryClient();
  const mutation = useMutation({
    meta: { handled: true },
    mutationFn: (v: { policy: LenderPolicy; action: 'ACTIVATE' | 'RETIRE' }) =>
      apiFetch<LenderPolicy>(`${LIST}/${v.policy.id}/transitions`, {
        method: 'POST',
        version: v.policy.version,
        body: { action: v.action },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [LIST] }),
  });
  return {
    pending: mutation.isPending,
    error: mutation.error ? errorText(mutation.error) : null,
    reset: () => mutation.reset(),
    run: (policy: LenderPolicy, action: 'ACTIVATE' | 'RETIRE') => mutation.mutate({ policy, action }),
  };
}

function ProductVersionLabel({
  productVersionId,
  productName,
}: {
  productVersionId: string;
  productName: (productId: string) => string;
}) {
  const v = useResource<ProductVersion>(`/v1/product-versions/${productVersionId}`);
  if (!v.data) return <>…</>;
  return <>{`${productName(v.data.productId)} · v${v.data.versionNo}`}</>;
}

function PolicyDialog({
  lenderId,
  policy,
  products,
  onClose,
}: {
  lenderId: string;
  policy: LenderPolicy | null;
  products: Product[];
  onClose: () => void;
}) {
  const [form, setForm] = useState<PolicyForm>(policy ? policyToForm(policy) : EMPTY_POLICY_FORM);
  const [errors, setErrors] = useState<PolicyFormErrors>({});
  const [productId, setProductId] = useState('');
  const versions = useResource<{ data: ProductVersion[] }>(
    productId ? `/v1/products/${productId}/versions` : null,
  );
  const create = useCommand<object, LenderPolicy>(
    () => ({ path: LIST, method: 'POST' }),
    [[LIST]],
    'Policy draft saved.',
  );
  const patch = useCommand<object, LenderPolicy>(
    () => ({ path: `${LIST}/${policy?.id}`, method: 'PATCH', version: policy?.version }),
    [[LIST]],
    'Policy draft updated.',
  );
  const set = (field: keyof PolicyForm) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));
  const field = (name: keyof PolicyForm, label: string, help?: string, type = 'text') => (
    <TextField
      fullWidth
      size="small"
      label={label}
      type={type}
      value={form[name] as string}
      onChange={set(name)}
      error={!!errors[name]}
      helperText={errors[name] ?? help}
      InputLabelProps={type === 'date' ? { shrink: true } : undefined}
      inputProps={{ 'data-testid': `lenderPolicy.field.${name}` }}
    />
  );

  const save = () => {
    const result = policy ? formToPatch(form) : formToCreate(lenderId, form);
    setErrors(result.errors);
    if (!result.body) return;
    const cmd = policy ? patch : create;
    cmd.mutate(result.body, { onSuccess: onClose });
  };
  const busy = create.isPending || patch.isPending;

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth data-testid="lenderPolicy.dialog">
      <DialogTitle>{policy ? `Edit draft v${policy.versionNo}` : 'New policy draft'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3}>
          {!policy && (
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label="Product"
                  value={productId}
                  onChange={(e) => {
                    setProductId(e.target.value);
                    setForm((f) => ({ ...f, productVersionId: '' }));
                  }}
                  inputProps={{ 'data-testid': 'lenderPolicy.field.product' }}
                >
                  {products.map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.name} ({p.category})
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label="Product version"
                  value={form.productVersionId}
                  onChange={set('productVersionId')}
                  disabled={!productId}
                  error={!!errors.productVersionId}
                  helperText={errors.productVersionId ?? 'The policy prices this version only.'}
                  inputProps={{ 'data-testid': 'lenderPolicy.field.productVersionId' }}
                >
                  {(versions.data?.data ?? [])
                    .filter((v) => v.status === 'ACTIVE')
                    .map((v) => (
                      <MenuItem key={v.id} value={v.id}>
                        v{v.versionNo} · ₹{v.amountMin}–₹{v.amountMax} · {v.tenureMinMonths}–
                        {v.tenureMaxMonths} months
                      </MenuItem>
                    ))}
                </TextField>
              </Grid>
            </Grid>
          )}

          <Box>
            <FormLabel>Pricing</FormLabel>
            <Grid container spacing={2} sx={{ mt: 0 }}>
              <Grid item xs={12} sm={4}>
                {field('rateMin', 'Lowest rate (% a year)', 'For example 10.5')}
              </Grid>
              <Grid item xs={12} sm={4}>
                {field('rateMax', 'Highest rate (% a year)', 'Loans are sized at this rate')}
              </Grid>
              <Grid item xs={12} sm={4}>
                {field('processingFee', 'Processing fee (%)', 'Of the eligible amount')}
              </Grid>
            </Grid>
          </Box>

          <Box>
            <FormLabel>Limits</FormLabel>
            <Grid container spacing={2} sx={{ mt: 0 }}>
              <Grid item xs={12} sm={4}>
                {field('foirCap', 'FOIR cap (%)', 'EMIs as a share of income')}
              </Grid>
              <Grid item xs={12} sm={4}>
                {field('ltvCap', 'LTV cap (%)', 'Secured loans: loan to collateral value')}
              </Grid>
              <Grid item xs={12} sm={4}>
                {field('minIncome', 'Minimum monthly income (₹)')}
              </Grid>
            </Grid>
          </Box>

          <Box>
            <FormLabel>Applicant</FormLabel>
            <Grid container spacing={2} sx={{ mt: 0 }}>
              <Grid item xs={12} sm={3}>
                {field('minBureauScore', 'Minimum bureau score', '300 to 900')}
              </Grid>
              <Grid item xs={12} sm={3}>
                {field('minAge', 'Minimum age')}
              </Grid>
              <Grid item xs={12} sm={3}>
                {field('maxAgeAtMaturity', 'Maximum age at maturity')}
              </Grid>
              <Grid item xs={12} sm={3}>
                {field('minVintageMonths', 'Minimum vintage (months)', 'Business or job vintage')}
              </Grid>
              <Grid item xs={12} sm={6}>
                {field(
                  'serviceablePincodes',
                  'Serviceable pincodes',
                  'Pincodes or prefixes such as 411, 560034. Empty serves everywhere.',
                )}
              </Grid>
              <Grid item xs={12} sm={6}>
                {field(
                  'allowedConstitutions',
                  'Allowed constitutions',
                  'Such as PROPRIETORSHIP, PVT_LTD. Empty allows all.',
                )}
              </Grid>
              <Grid item xs={12}>
                <FormControl>
                  <FormLabel>Allowed applicant types (none ticked allows all)</FormLabel>
                  <FormGroup row>
                    {EMPLOYMENT_OPTIONS.map((t) => (
                      <FormControlLabel
                        key={t}
                        label={EMPLOYMENT_LABELS[t]}
                        control={
                          <Checkbox
                            checked={form.allowedEmployment.includes(t)}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                allowedEmployment: e.target.checked
                                  ? [...f.allowedEmployment, t]
                                  : f.allowedEmployment.filter((x) => x !== t),
                              }))
                            }
                            inputProps={{ 'data-testid': `lenderPolicy.field.employment.${t}` } as object}
                          />
                        }
                      />
                    ))}
                  </FormGroup>
                </FormControl>
              </Grid>
            </Grid>
          </Box>

          <Box>
            <FormLabel>Validity</FormLabel>
            <Grid container spacing={2} sx={{ mt: 0 }}>
              <Grid item xs={12} sm={6}>
                {field('effectiveFrom', 'Effective from', undefined, 'date')}
              </Grid>
              <Grid item xs={12} sm={6}>
                {field('effectiveTo', 'Effective to (optional)', 'Leave empty for no end date', 'date')}
              </Grid>
            </Grid>
            <FormHelperText>Dates are India business dates.</FormHelperText>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} data-testid="lenderPolicy.cancel">
          Cancel
        </Button>
        <Button variant="contained" onClick={save} disabled={busy} data-testid="lenderPolicy.save">
          Save draft
        </Button>
      </DialogActions>
    </Dialog>
  );
}
