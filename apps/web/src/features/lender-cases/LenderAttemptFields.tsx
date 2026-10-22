// The lender, empanelment and product version of a new lender attempt (owner: Dev 4; DSA Notion MODULE 18, API-LCS-001;
// QA plan Module 08 step 3 "verify the configured lender"). Each list comes from the catalogue (MOD-LND, MOD-PRD) and narrows the
// next: only active lenders, that lender's active empanelments, and the versions in force of its products in the application's
// category. Nothing is typed by hand.
import { MenuItem, Stack, TextField } from '@mui/material';
import { useState } from 'react';
import { errorText } from '../../api/client';
import { useLookup } from '../admin/api';
import type { Product, ProductVersion } from '../admin/ProductsPage';

interface LenderRow {
  id: string;
  name: string;
  status: string;
}
interface EmpanelmentRow {
  id: string;
  dsaCode: string;
  status: string;
  permittedCategories: string[];
}

export interface LenderAttemptValue {
  lenderId: string;
  empanelmentId: string;
  productVersionId: string;
}

export function LenderAttemptFields({
  value,
  onChange,
  productCategory,
}: {
  value: LenderAttemptValue;
  onChange: (v: LenderAttemptValue) => void;
  /** The application's category: products and empanelments are narrowed to it when known. */
  productCategory?: string;
}) {
  const [productId, setProductId] = useState('');
  const lenders = useLookup<LenderRow>('/v1/lenders', { status: 'ACTIVE' });
  const empanelments = useLookup<EmpanelmentRow>(
    `/v1/lenders/${value.lenderId}/empanelments`,
    {},
    !!value.lenderId,
  );
  const products = useLookup<Product>(
    '/v1/products',
    { lenderId: value.lenderId, status: 'ACTIVE', ...(productCategory ? { category: productCategory } : {}) },
    !!value.lenderId,
  );
  const versions = useLookup<ProductVersion>(`/v1/products/${productId}/versions`, {}, !!productId);
  const usableEmpanelments = (empanelments.data ?? []).filter(
    (e) =>
      e.status === 'ACTIVE' &&
      (!productCategory ||
        e.permittedCategories.length === 0 ||
        e.permittedCategories.includes(productCategory)),
  );
  const inForce = (versions.data ?? []).filter((v) => v.isCurrent);

  return (
    <Stack spacing={2}>
      <TextField
        select
        fullWidth
        required
        label="Lender"
        value={value.lenderId}
        onChange={(e) => {
          setProductId('');
          onChange({ lenderId: e.target.value, empanelmentId: '', productVersionId: '' });
        }}
        disabled={lenders.isPending}
        error={lenders.isError}
        helperText={lenders.isError ? errorText(lenders.error) : undefined}
        inputProps={{ 'data-testid': 'lender-case.create.lender' }}
      >
        {(lenders.data ?? []).map((l) => (
          <MenuItem key={l.id} value={l.id}>
            {l.name}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        fullWidth
        required
        label="Empanelment"
        value={value.empanelmentId}
        onChange={(e) => onChange({ ...value, empanelmentId: e.target.value })}
        disabled={!value.lenderId || empanelments.isPending}
        helperText={
          value.lenderId && !empanelments.isPending && usableEmpanelments.length === 0
            ? 'This lender has no active empanelment for this product category.'
            : undefined
        }
        inputProps={{ 'data-testid': 'lender-case.create.empanelment' }}
      >
        {usableEmpanelments.map((e) => (
          <MenuItem key={e.id} value={e.id}>
            DSA code {e.dsaCode}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        fullWidth
        required
        label="Product"
        value={productId}
        onChange={(e) => {
          setProductId(e.target.value);
          onChange({ ...value, productVersionId: '' });
        }}
        disabled={!value.lenderId || products.isPending}
        helperText={
          value.lenderId && !products.isPending && (products.data ?? []).length === 0
            ? 'This lender has no active product in this category.'
            : undefined
        }
        inputProps={{ 'data-testid': 'lender-case.create.product' }}
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
        label="Product version"
        value={value.productVersionId}
        onChange={(e) => onChange({ ...value, productVersionId: e.target.value })}
        disabled={!productId || versions.isPending}
        helperText={
          productId && !versions.isPending && inForce.length === 0
            ? 'No version is in force today.'
            : undefined
        }
        inputProps={{ 'data-testid': 'lender-case.create.version' }}
      >
        {inForce.map((v) => (
          <MenuItem key={v.id} value={v.id}>
            Version {v.versionNo} · {v.currency} {v.amountMin}–{v.amountMax} · {v.tenureMinMonths}–
            {v.tenureMaxMonths} months
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  );
}
