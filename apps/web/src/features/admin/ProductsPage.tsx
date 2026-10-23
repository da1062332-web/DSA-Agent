// /products (owner: Dev 3; DSA Notion MODULE 15, SUB-PRD.01 to .03). List and create loan products under a lender.
// Writes need config.manage; the list is visible to any signed-in staff, as the API allows.
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { hasPermission, useMe } from '../../api/useMe';
import { useCommand, useList, useLookup } from './api';
import { ErrorAlert, LoadMore, PageHeader, StatusChip } from './components';
import { DataTable, FilterToolbar, type ColumnDef } from '../../ui';
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

  const productColumns: ColumnDef<Product>[] = [
    {
      id: 'name',
      header: 'Name',
      accessor: (p) => (
        <Link component={RouterLink} to={`/products/${p.id}`} data-testid="admin.product.open" sx={{ fontWeight: 600 }}>
          {p.name}
        </Link>
      ),
    },
    {
      id: 'lender',
      header: 'Lender',
      accessor: (p) => lenderName(p.lenderId),
    },
    {
      id: 'category',
      header: 'Category',
      accessor: (p) => CATEGORY_LABELS[p.category],
    },
    {
      id: 'applicantTypes',
      header: 'Applicant types',
      accessor: (p) => p.applicantTypes.join(', '),
    },
    {
      id: 'secured',
      header: 'Secured',
      accessor: (p) => (p.secured ? 'Yes' : 'No'),
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (p) => <StatusChip active={p.status === 'ACTIVE'} label={p.status} />,
    },
  ];

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
      <FilterToolbar
        searchPlaceholder="Search product name..."
        searchValue={search}
        onSearchChange={setSearch}
        filters={
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>Lender</InputLabel>
              <Select
                value={lenderId}
                label="Lender"
                onChange={(e) => setLenderId(e.target.value)}
              >
                <MenuItem value="">All lenders</MenuItem>
                {(lenders.data ?? []).map((l) => (
                  <MenuItem key={l.id} value={l.id}>
                    {l.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Category</InputLabel>
              <Select
                value={category}
                label="Category"
                onChange={(e) => setCategory(e.target.value)}
              >
                <MenuItem value="">All categories</MenuItem>
                {PRODUCT_CATEGORIES.map((c) => (
                  <MenuItem key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>Status</InputLabel>
              <Select
                value={status}
                label="Status"
                onChange={(e) => setStatus(e.target.value)}
              >
                <MenuItem value="">All</MenuItem>
                <MenuItem value="ACTIVE">Active</MenuItem>
                <MenuItem value="INACTIVE">Inactive</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        }
      />
      <ErrorAlert error={list.error} />
      <DataTable<Product>
        columns={productColumns}
        data={rows}
        loading={list.isPending}
        emptyTitle="No products match."
      />
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
