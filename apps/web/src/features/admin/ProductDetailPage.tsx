// /products/:id (owner: Dev 3; DSA Notion MODULE 15, SUB-PRD.01 to .03). Product status and its terms versions.
// Terms never change in place: a change is a new version (the API refuses edits to a version). Status changes use
// If-Match, so a stale screen shows the version conflict instead of overwriting someone else's change.
import {
  Alert,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Link,
  MenuItem,
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
import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { hasPermission, useMe } from '../../api/useMe';
import { useCommand, useList, useResource } from './api';
import { ErrorAlert, Loading, PageHeader, StatusChip, formatDate } from './components';
import type { Lender } from './LendersPage';
import {
  APPLICANT_TYPES,
  CATEGORY_LABELS,
  PRODUCT_CATEGORIES,
  type ApplicantType,
  type Product,
  type ProductCategory,
  type ProductVersion,
} from './ProductsPage';

const MONEY = /^\d{1,16}(\.\d{1,2})?$/;

/** Mirrors the API rules for a version: decimal amounts (max 2 places), maximum at or above minimum, tenure 1+ and ordered. */
export function isValidTerms(t: {
  amountMin: string;
  amountMax: string;
  tenureMin: string;
  tenureMax: string;
}) {
  const tMin = Number(t.tenureMin);
  const tMax = Number(t.tenureMax);
  return (
    MONEY.test(t.amountMin.trim()) &&
    MONEY.test(t.amountMax.trim()) &&
    Number(t.amountMax) >= Number(t.amountMin) &&
    Number.isInteger(tMin) &&
    Number.isInteger(tMax) &&
    tMin >= 1 &&
    tMax >= tMin
  );
}

export function ProductDetailPage() {
  const { id } = useParams();
  const me = useMe();
  const canEdit = hasPermission(me.data, 'config.manage');
  const product = useResource<Product>(id ? `/v1/products/${id}` : null);
  const lender = useResource<Lender>(product.data ? `/v1/lenders/${product.data.lenderId}` : null);
  const versions = useList<ProductVersion>(`/v1/products/${id}/versions`, {}, 200);

  if (product.isPending) return <Loading />;
  if (!product.data) return <ErrorAlert error={product.error} />;
  const p = product.data;
  const rows = versions.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <>
      <PageHeader
        title={p.name}
        subtitle={`${CATEGORY_LABELS[p.category]} · lender ${lender.data?.name ?? '…'} · version ${p.version}`}
        action={<StatusChip active={p.status === 'ACTIVE'} label={p.status} />}
      />
      {p.status !== 'ACTIVE' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Inactive. No new terms version can be added until the product is activated again.
        </Alert>
      )}

      <DetailsCard product={p} lenderName={lender.data?.name ?? p.lenderId} canEdit={canEdit} />

      <StatusCard product={p} canEdit={canEdit} />
      <VersionsCard
        product={p}
        rows={rows}
        loading={versions.isPending}
        canEdit={canEdit && p.status === 'ACTIVE'}
      />
    </>
  );
}

/** Basic product details (API-PRD-006). Saves with If-Match; versions are never changed here. */
function DetailsCard({
  product,
  lenderName,
  canEdit,
}: {
  product: Product;
  lenderName: string;
  canEdit: boolean;
}) {
  const [name, setName] = useState(product.name);
  const [category, setCategory] = useState<ProductCategory>(product.category);
  const [applicantTypes, setApplicantTypes] = useState<ApplicantType[]>(product.applicantTypes);
  const [secured, setSecured] = useState(product.secured);
  const [nextReviewAt, setNextReviewAt] = useState(product.nextReviewAt ?? '');
  const save = useCommand<object, Product>(
    () => ({ path: `/v1/products/${product.id}`, method: 'PATCH', version: product.version }),
    [['/v1/products'], [`/v1/products/${product.id}`]],
  );
  const dirty =
    name.trim() !== product.name ||
    category !== product.category ||
    applicantTypes.join() !== product.applicantTypes.join() ||
    secured !== product.secured ||
    (nextReviewAt || null) !== product.nextReviewAt;

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Details
        </Typography>
        <Typography variant="body2" sx={{ mb: 2 }}>
          <strong>Lender:</strong>{' '}
          <Link component={RouterLink} to={`/lenders/${product.lenderId}`}>
            {lenderName}
          </Link>
        </Typography>
        <ErrorAlert error={save.error} />
        <Stack spacing={2} sx={{ maxWidth: 520 }}>
          <TextField
            label="Product name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
            required
          />
          <TextField
            select
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value as ProductCategory)}
            disabled={!canEdit}
          >
            {PRODUCT_CATEGORIES.map((c) => (
              <MenuItem key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Applicant types"
            value={applicantTypes}
            onChange={(e) => setApplicantTypes(e.target.value as unknown as ApplicantType[])}
            SelectProps={{ multiple: true }}
            disabled={!canEdit}
          >
            {APPLICANT_TYPES.map((t) => (
              <MenuItem key={t} value={t}>
                {t}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            control={
              <Checkbox
                checked={secured}
                onChange={(e) => setSecured(e.target.checked)}
                disabled={!canEdit}
              />
            }
            label="Secured loan"
          />
          <TextField
            label="Next review date"
            type="date"
            value={nextReviewAt}
            onChange={(e) => setNextReviewAt(e.target.value)}
            InputLabelProps={{ shrink: true }}
            disabled={!canEdit}
            helperText="Editing details does not change any terms version."
          />
          {canEdit && (
            <Stack direction="row">
              <Button
                variant="contained"
                disabled={!dirty || save.isPending || name.trim().length < 2 || applicantTypes.length === 0}
                onClick={() =>
                  save.mutate({
                    name: name.trim(),
                    category,
                    applicantTypes,
                    secured,
                    nextReviewAt: nextReviewAt || null,
                  })
                }
                data-testid="admin.product.saveDetails"
              >
                Save details
              </Button>
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

function StatusCard({ product, canEdit }: { product: Product; canEdit: boolean }) {
  const [deactivating, setDeactivating] = useState(false);
  const [reason, setReason] = useState('');
  const change = useCommand<{ status: Product['status']; reason?: string }, Product>(
    () => ({ path: `/v1/products/${product.id}/status`, method: 'POST', version: product.version }),
    [['/v1/products'], [`/v1/products/${product.id}`]],
  );
  const close = () => {
    setDeactivating(false);
    setReason('');
    change.reset();
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Status
        </Typography>
        <ErrorAlert error={change.error} />
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography variant="body2">
            Currently <strong>{product.status === 'ACTIVE' ? 'active' : 'inactive'}</strong>.
          </Typography>
          {canEdit && product.status === 'ACTIVE' && (
            <Button color="warning" variant="outlined" onClick={() => setDeactivating(true)}>
              Deactivate
            </Button>
          )}
          {canEdit && product.status === 'INACTIVE' && (
            <Button
              variant="contained"
              disabled={change.isPending}
              onClick={() => change.mutate({ status: 'ACTIVE' })}
            >
              Activate
            </Button>
          )}
        </Stack>
      </CardContent>
      {deactivating && (
        <Dialog open onClose={close} maxWidth="xs" fullWidth>
          <DialogTitle>Deactivate product</DialogTitle>
          <DialogContent>
            <ErrorAlert error={change.error} />
            <TextField
              autoFocus
              fullWidth
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              helperText="Recorded in the audit trail. Existing cases keep their version."
              sx={{ mt: 1 }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={close} disabled={change.isPending}>
              Cancel
            </Button>
            <Button
              color="warning"
              variant="contained"
              disabled={change.isPending || reason.trim().length < 2}
              onClick={() =>
                change.mutate({ status: 'INACTIVE', reason: reason.trim() }, { onSuccess: close })
              }
            >
              Deactivate
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Card>
  );
}

function VersionsCard({
  product,
  rows,
  loading,
  canEdit,
}: {
  product: Product;
  rows: ProductVersion[];
  loading: boolean;
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6">Terms versions</Typography>
          {canEdit && (
            <Button
              variant="contained"
              size="small"
              onClick={() => setAdding(true)}
              data-testid="admin.version.new"
            >
              New version
            </Button>
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Each version is fixed once created. The version in force is the newest active one whose effective
          date has been reached.
        </Typography>
        {loading ? (
          <Loading />
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>No.</TableCell>
                  <TableCell>Effective from</TableCell>
                  <TableCell>Amount</TableCell>
                  <TableCell>Tenure</TableCell>
                  <TableCell>Illustrative rate</TableCell>
                  <TableCell>Fee</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      No terms yet. Add the first version.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((v) => (
                  <TableRow key={v.id} hover>
                    <TableCell>{v.versionNo}</TableCell>
                    <TableCell>{formatDate(v.effectiveFrom)}</TableCell>
                    <TableCell>
                      {v.currency} {v.amountMin} – {v.amountMax}
                    </TableCell>
                    <TableCell>
                      {v.tenureMinMonths}–{v.tenureMaxMonths} months
                    </TableCell>
                    <TableCell>{v.illustrativeRateText ?? '—'}</TableCell>
                    <TableCell>{v.feeText ?? '—'}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1}>
                        <StatusChip active={v.status === 'ACTIVE'} label={v.status} />
                        {v.isCurrent && (
                          <Chip size="small" color="success" variant="outlined" label="In force" />
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
      {adding && <NewVersionDialog productId={product.id} onClose={() => setAdding(false)} />}
    </Card>
  );
}

function NewVersionDialog({ productId, onClose }: { productId: string; onClose: () => void }) {
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [tenureMin, setTenureMin] = useState('12');
  const [tenureMax, setTenureMax] = useState('60');
  const [rate, setRate] = useState('');
  const [fee, setFee] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const create = useCommand<object, ProductVersion>(
    () => ({ path: `/v1/products/${productId}/versions`, method: 'POST' }),
    [[`/v1/products/${productId}/versions`], ['/v1/products']],
  );

  const tMin = Number(tenureMin);
  const tMax = Number(tenureMax);
  const valid = isValidTerms({ amountMin, amountMax, tenureMin, tenureMax });

  const submit = () =>
    create.mutate(
      {
        amountMin: amountMin.trim(),
        amountMax: amountMax.trim(),
        currency: 'INR',
        tenureMinMonths: tMin,
        tenureMaxMonths: tMax,
        illustrativeRateText: rate.trim() || null,
        feeText: fee.trim() || null,
        // Blank means the terms take effect now. The API takes a UTC timestamp.
        effectiveFrom: effectiveDate ? `${effectiveDate}T00:00:00Z` : undefined,
      },
      { onSuccess: onClose },
    );

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New terms version</DialogTitle>
      <DialogContent>
        <ErrorAlert error={create.error} />
        <Alert severity="info" sx={{ mb: 2, mt: 1 }}>
          A new version never changes an earlier one. Earlier versions are retired once this one is in force.
        </Alert>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Minimum amount (INR)"
              value={amountMin}
              onChange={(e) => setAmountMin(e.target.value)}
              error={amountMin !== '' && !MONEY.test(amountMin.trim())}
              helperText="For example 100000.00"
              fullWidth
              inputProps={{ 'data-testid': 'admin.version.amountMin' }}
            />
            <TextField
              label="Maximum amount (INR)"
              value={amountMax}
              onChange={(e) => setAmountMax(e.target.value)}
              error={amountMax !== '' && !MONEY.test(amountMax.trim())}
              fullWidth
              inputProps={{ 'data-testid': 'admin.version.amountMax' }}
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Minimum tenure (months)"
              type="number"
              value={tenureMin}
              onChange={(e) => {
                const val = e.target.value;
                setTenureMin(val === '' ? '' : String(Math.max(1, Number(val))));
              }}
              inputProps={{ min: 1 }}
              fullWidth
            />
            <TextField
              label="Maximum tenure (months)"
              type="number"
              value={tenureMax}
              onChange={(e) => {
                const val = e.target.value;
                setTenureMax(val === '' ? '' : String(Math.max(1, Number(val))));
              }}
              inputProps={{ min: 1 }}
              error={tenureMax !== '' && tMax < tMin}
              helperText={tenureMax !== '' && tMax < tMin ? 'Must be at least the minimum.' : undefined}
              fullWidth
            />
          </Stack>
          <TextField
            label="Illustrative rate"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            helperText='Shown as "Illustrative, not an offer". Optional.'
          />
          <TextField
            label="Fees (text)"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            helperText="Optional."
          />
          <TextField
            label="Effective from"
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            helperText="Blank means now. Must be after the latest version."
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={create.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={create.isPending || !valid}
          data-testid="admin.version.save"
        >
          Add version
        </Button>
      </DialogActions>
    </Dialog>
  );
}
