// /products (owner: Dev 3; DSA Notion MODULE 15, SUB-PRD.01 to .03). List and create loan products under a lender.
// Writes need config.manage; the list is visible to any signed-in staff, as the API allows.
import {
  Button,
  Card,
  Checkbox,
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
} from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { hasPermission, useMe } from '../../api/useMe';
import { useCommand, useList, useLookup } from './api';
import { ErrorAlert, LoadMore, Loading, PageHeader, StatusChip } from './components';
import type { Lender } from './LendersPage';

export interface Product {
  id: string;
  lenderId: string;
  name: string;
  category: ProductCategory;
  applicantTypes: ApplicantType[];
  secured: boolean;
  ownerUserId: string | null;
  nextReviewAt: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductVersion {
  id: string;
  productId: string;
  versionNo: number;
  effectiveFrom: string;
  amountMin: string;
  amountMax: string;
  currency: string;
  tenureMinMonths: number;
  tenureMaxMonths: number;
  illustrativeRateText: string | null;
  feeText: string | null;
  geoRules: { state: string; allowed: boolean }[];
  documentProfileId: string | null;
  workflowProfile: Record<string, unknown>;
  eligibilityScope: Record<string, unknown>;
  status: 'ACTIVE' | 'RETIRED';
  /** True for the one ACTIVE version whose effective date has been reached. */
  isCurrent: boolean;
  createdAt: string;
}

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export type ApplicantType = (typeof APPLICANT_TYPES)[number];

export const PRODUCT_CATEGORIES = ['PL', 'BL', 'MSME', 'LAP', 'HL', 'VL', 'GL', 'EL', 'OTHER'] as const;
export const APPLICANT_TYPES = [
  'INDIVIDUAL',
  'SALARIED',
  'SELF_EMPLOYED',
  'PROPRIETORSHIP',
  'PARTNERSHIP',
  'PRIVATE_LIMITED',
  'OTHER',
] as const;

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  PL: 'Personal loan',
  BL: 'Business loan',
  MSME: 'MSME loan',
  LAP: 'Loan against property',
  HL: 'Home loan',
  VL: 'Vehicle loan',
  GL: 'Gold loan',
  EL: 'Education loan',
  OTHER: 'Other',
};

export function ProductsPage() {
  const me = useMe();
  const canEdit = hasPermission(me.data, 'config.manage');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [lenderId, setLenderId] = useState('');
  const list = useList<Product>('/v1/products', {
    q: search || undefined,
    status: status || undefined,
    category: category || undefined,
    lenderId: lenderId || undefined,
  });
  const lenders = useLookup<Lender>('/v1/lenders');
  const [creating, setCreating] = useState(false);
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const lenderName = (id: string) => lenders.data?.find((l) => l.id === id)?.name ?? id;

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Loan products under each lender. Terms are versioned; a change is a new version, never an edit."
        action={
          canEdit && (
            <Button variant="contained" onClick={() => setCreating(true)} data-testid="admin.products.new">
              New product
            </Button>
          )
        }
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField
          size="small"
          label="Search name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <TextField
          size="small"
          select
          label="Lender"
          value={lenderId}
          onChange={(e) => setLenderId(e.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">All lenders</MenuItem>
          {(lenders.data ?? []).map((l) => (
            <MenuItem key={l.id} value={l.id}>
              {l.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          select
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">All categories</MenuItem>
          {PRODUCT_CATEGORIES.map((c) => (
            <MenuItem key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="ACTIVE">Active</MenuItem>
          <MenuItem value="INACTIVE">Inactive</MenuItem>
        </TextField>
      </Stack>
      <ErrorAlert error={list.error} />
      {list.isPending ? (
        <Loading />
      ) : (
        <Card>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Lender</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell>Applicant types</TableCell>
                  <TableCell>Secured</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      No products match.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((p) => (
                  <TableRow key={p.id} hover>
                    <TableCell>
                      <Link component={RouterLink} to={`/products/${p.id}`} data-testid="admin.product.open">
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell>{lenderName(p.lenderId)}</TableCell>
                    <TableCell>{CATEGORY_LABELS[p.category]}</TableCell>
                    <TableCell>{p.applicantTypes.join(', ')}</TableCell>
                    <TableCell>{p.secured ? 'Yes' : 'No'}</TableCell>
                    <TableCell>
                      <StatusChip active={p.status === 'ACTIVE'} label={p.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}
      <LoadMore
        hasNext={!!list.hasNextPage}
        loading={list.isFetchingNextPage}
        onClick={() => void list.fetchNextPage()}
      />
      {creating && <CreateProductDialog lenders={lenders.data ?? []} onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateProductDialog({ lenders, onClose }: { lenders: Lender[]; onClose: () => void }) {
  const [lenderId, setLenderId] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ProductCategory>('PL');
  const [applicantTypes, setApplicantTypes] = useState<ApplicantType[]>(['SALARIED']);
  const [secured, setSecured] = useState(false);
  const [nextReviewAt, setNextReviewAt] = useState('');
  const create = useCommand<object, Product>(
    () => ({ path: '/v1/products', method: 'POST' }),
    [['/v1/products']],
  );

  const submit = () =>
    create.mutate(
      {
        lenderId,
        name: name.trim(),
        category,
        applicantTypes,
        secured,
        nextReviewAt: nextReviewAt || null,
      },
      { onSuccess: onClose },
    );

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New product</DialogTitle>
      <DialogContent>
        <ErrorAlert error={create.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            label="Lender"
            value={lenderId}
            onChange={(e) => setLenderId(e.target.value)}
            required
            helperText={lenders.length === 0 ? 'Add a lender first.' : undefined}
            inputProps={{ 'data-testid': 'admin.product.lender' }}
          >
            {lenders.map((l) => (
              <MenuItem key={l.id} value={l.id}>
                {l.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Product name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            inputProps={{ 'data-testid': 'admin.product.name' }}
          />
          <TextField
            select
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value as ProductCategory)}
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
            required
          >
            {APPLICANT_TYPES.map((t) => (
              <MenuItem key={t} value={t}>
                {t}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            control={<Checkbox checked={secured} onChange={(e) => setSecured(e.target.checked)} />}
            label="Secured loan"
          />
          <TextField
            label="Next review date"
            type="date"
            value={nextReviewAt}
            onChange={(e) => setNextReviewAt(e.target.value)}
            InputLabelProps={{ shrink: true }}
            helperText="Optional."
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
          disabled={create.isPending || !lenderId || name.trim().length < 2 || applicantTypes.length === 0}
          data-testid="admin.product.save"
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}
