// The loan request and the product on the Draft step of completing a loan file (owner: Bhushan, 2026-11-28). Controlled: the step's
// "Save & next" saves them (PATCH /v1/applications/{id}, then T-APP-01 with the product version), so there is no separate save button.
// Problems show under the fields once "Save & next" has been tried.
import { Card, CardContent, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useLookup } from '../../admin/api';
import type { Product, ProductVersion } from '../../admin/ProductsPage';
import { formatDate } from '../../admin/components';
import { APPLICANT_TYPE_LABELS, PRODUCT_LABELS, humanize } from '../loan-file';
import type { LoanRequestForm, StepProblem } from '../step-validation';

export const PURPOSES = [
  'PERSONAL_NEEDS',
  'MEDICAL',
  'EDUCATION',
  'HOME_PURCHASE',
  'HOME_IMPROVEMENT',
  'VEHICLE',
  'WORKING_CAPITAL',
  'BUSINESS_EXPANSION',
  'DEBT_CONSOLIDATION',
  'OTHER',
] as const;

export const APPLICANT_TYPES = [
  'SALARIED',
  'SELF_EMPLOYED_PROFESSIONAL',
  'SELF_EMPLOYED_BUSINESS',
  'NON_INDIVIDUAL',
] as const;

const blockKeys = (e: React.KeyboardEvent) => {
  if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault();
};

export function LoanRequestFields({
  value,
  onChange,
  problems,
  editable,
  productCategory,
}: {
  value: LoanRequestForm;
  onChange: (v: LoanRequestForm) => void;
  /** Shown under the fields (after "Save & next" was tried). */
  problems: StepProblem[];
  editable: boolean;
  productCategory: string;
}) {
  const err = (field: StepProblem['field']) => problems.find((p) => p.field === field)?.message;
  const set = (patch: Partial<LoanRequestForm>) => onChange({ ...value, ...patch });
  return (
    <Card sx={{ mb: 3 }} data-testid="application.loan-request">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Loan request
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {PRODUCT_LABELS[productCategory] ?? 'Loan'}.{' '}
          {editable
            ? 'Saved when you press Save & next.'
            : 'The request can be changed while the application is Draft or Documents pending.'}
        </Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField
            fullWidth
            required
            label="Loan amount (₹)"
            value={value.amount}
            onChange={(e) => set({ amount: e.target.value })}
            onKeyDown={blockKeys}
            disabled={!editable}
            error={!!err('amount')}
            helperText={err('amount') ?? 'In rupees, for example 500000'}
            inputProps={{ 'data-testid': 'application.request-amount', inputMode: 'decimal' }}
          />
          <TextField
            fullWidth
            required
            label="Tenure (months)"
            type="number"
            value={value.tenure}
            onChange={(e) => set({ tenure: e.target.value })}
            onKeyDown={blockKeys}
            disabled={!editable}
            error={!!err('tenure')}
            helperText={err('tenure') ?? '1 to 480'}
            inputProps={{ min: 1, max: 480, 'data-testid': 'application.request-tenure' }}
          />
        </Stack>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mt: 2 }}>
          <TextField
            select
            fullWidth
            required
            label="Purpose"
            value={value.purpose}
            onChange={(e) => set({ purpose: e.target.value })}
            disabled={!editable}
            error={!!err('purpose')}
            helperText={err('purpose') ?? ' '}
            inputProps={{ 'data-testid': 'application.request-purpose' }}
          >
            {PURPOSES.map((p) => (
              <MenuItem key={p} value={p}>
                {humanize(p)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            fullWidth
            required
            label="Applicant type"
            value={value.applicantType}
            onChange={(e) => set({ applicantType: e.target.value })}
            disabled={!editable}
            error={!!err('applicantType')}
            helperText={err('applicantType') ?? ' '}
          >
            {APPLICANT_TYPES.map((t) => (
              <MenuItem key={t} value={t}>
                {APPLICANT_TYPE_LABELS[t]}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </CardContent>
    </Card>
  );
}

/** The product and the version in force today, chosen on the Draft step; "Save & next" starts the documents with it (T-APP-01). */
export function ProductPicker({
  productCategory,
  productId,
  versionId,
  onChange,
  problem,
}: {
  productCategory: string;
  productId: string;
  versionId: string;
  onChange: (productId: string, versionId: string) => void;
  problem?: string;
}) {
  const products = useLookup<Product>('/v1/products', { category: productCategory, status: 'ACTIVE' });
  const versions = useLookup<ProductVersion>(`/v1/products/${productId}/versions`, {}, !!productId);
  const inForce = (versions.data ?? []).filter((v) => v.isCurrent);
  return (
    <Card sx={{ mb: 3 }} data-testid="application.product-picker">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Product
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          The lender product this file is for. Its document list is made from it when you press Save & next.
        </Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField
            select
            fullWidth
            required
            label="Product"
            value={productId}
            onChange={(e) => onChange(e.target.value, '')}
            error={!!problem && !productId}
            helperText={
              products.data?.length === 0
                ? `No active ${PRODUCT_LABELS[productCategory] ?? productCategory} products.`
                : !productId && problem
                  ? problem
                  : ' '
            }
            inputProps={{ 'data-testid': 'application.product' }}
          >
            {(products.data ?? []).map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            fullWidth
            required
            label="Version in force"
            value={versionId}
            onChange={(e) => onChange(productId, e.target.value)}
            disabled={!productId}
            error={!!problem && !!productId && !versionId}
            helperText={
              productId && inForce.length === 0
                ? 'No version is in force today.'
                : productId && !versionId && problem
                  ? problem
                  : ' '
            }
            inputProps={{ 'data-testid': 'application.product-version' }}
          >
            {inForce.map((v) => (
              <MenuItem key={v.id} value={v.id}>
                Version {v.versionNo} (from {formatDate(v.effectiveFrom)})
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </CardContent>
    </Card>
  );
}
