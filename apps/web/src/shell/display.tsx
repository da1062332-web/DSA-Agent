// apps/web/src/shell/display.tsx — Reusable human-friendly name components.
// Records are shown by name, never by ID. An ID that cannot be resolved to a name shows the standard "Not set" placeholder.
import React from 'react';
import { Link, Skeleton, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import type {
  BranchItem,
  UserItem,
  ConnectorItem,
  LeadItem,
  ApplicationItem,
  CustomerItem,
  LenderItem,
  ProductItem,
} from './selectors';
import { NotSet } from '../ui/NotSet';

/** Resilient lookup hook caching entity collections for name resolution */
function useDisplayLookup<T>(path: string, query?: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: [path, query],
    queryFn: async () => {
      try {
        const res = await apiFetch<any>(path, { query: { limit: 100, ...query } });
        if (Array.isArray(res)) return res as T[];
        if (Array.isArray(res?.items)) return res.items as T[];
        if (Array.isArray(res?.data)) return res.data as T[];
        return [] as T[];
      } catch {
        return [] as T[];
      }
    },
    staleTime: 5 * 60_000, // 5 min cache
  });
}

// ---------------------------------------------------------------------------
// Lookup Hooks (return a name, or null when the record is unknown)
// ---------------------------------------------------------------------------
export function useBranchName(id: string | null | undefined): string | null {
  const { data: branches = [] } = useDisplayLookup<BranchItem>('/v1/branches');
  if (!id) return null;
  return branches.find((b) => b.id === id)?.name ?? null;
}

export function useUserName(id: string | null | undefined): string | null {
  const { data: users = [] } = useDisplayLookup<UserItem>('/v1/users');
  const match = id ? users.find((u) => u.id === id) : null;

  const { data: singleUser } = useQuery({
    queryKey: ['/v1/users', id],
    queryFn: async () => {
      try {
        const res = await apiFetch<any>(`/v1/users/${id}`);
        return (res?.displayName || res?.fullName || res?.name || res?.email || null) as string | null;
      } catch {
        return null;
      }
    },
    enabled: Boolean(id && !match),
    staleTime: 5 * 60_000,
  });

  if (!id) return null;
  if (match) return match.displayName || match.fullName || (match as any).name || match.email || null;
  return singleUser ?? null;
}

export function useConnectorName(id: string | null | undefined): string | null {
  const { data: connectors = [] } = useDisplayLookup<ConnectorItem>('/v1/connectors');
  if (!id) return null;
  const match = connectors.find((c) => c.id === id);
  if (!match) return null;
  const displayName = match.tradeName || match.legalName || match.contactName || match.fullName || null;
  const firm = match.firmName || match.tradeName;
  if (!displayName) return null;
  return firm && firm !== displayName ? `${displayName} (${firm})` : displayName;
}

export function useLenderName(id: string | null | undefined): string | null {
  const { data: lenders = [] } = useDisplayLookup<LenderItem>('/v1/lenders');
  if (!id) return null;
  return lenders.find((l) => l.id === id)?.name ?? null;
}

export function useCustomerName(id: string | null | undefined): string | null {
  const { data: customers = [] } = useDisplayLookup<CustomerItem>('/v1/customers');
  const match = id ? customers.find((c) => c.id === id) : null;

  const { data: singleCustomer } = useQuery({
    queryKey: ['/v1/customers', id],
    queryFn: async () => {
      try {
        const res = await apiFetch<any>(`/v1/customers/${id}`);
        return (res?.fullName || res?.data?.fullName || res?.name || null) as string | null;
      } catch {
        return null;
      }
    },
    enabled: Boolean(id && !match),
    staleTime: 5 * 60_000,
  });

  if (!id) return null;
  return match ? match.fullName : singleCustomer ?? null;
}

export function useLeadName(id: string | null | undefined): string | null {
  const { data: leads = [] } = useDisplayLookup<LeadItem>('/v1/leads');
  if (!id) return null;
  const match = leads.find((l) => l.id === id);
  return match ? `${match.fullName} (${match.productCategory})` : null;
}

export function useProductName(id: string | null | undefined): string | null {
  const { data: products = [] } = useDisplayLookup<ProductItem>('/v1/products');
  if (!id) return null;
  return products.find((p) => p.id === id)?.name ?? null;
}

// ---------------------------------------------------------------------------
// Shared rendering
// ---------------------------------------------------------------------------
interface DisplayProps {
  id: string | null | undefined;
  fallback?: React.ReactNode;
  typographyProps?: any;
  sx?: any;
}

const linkSx = { fontWeight: 600 };

/** Renders a resolved name, a link to the record's detail page when asked, or the fallback when there is no name. */
function NameText({
  name,
  fallback,
  to,
  typographyProps,
  sx,
}: {
  name: string | null | undefined;
  fallback: React.ReactNode;
  to?: string;
  typographyProps?: any;
  sx?: any;
}) {
  if (!name) return <>{fallback}</>;
  if (to) {
    return (
      <Link component={RouterLink} to={to} underline="hover" color="primary.main" sx={{ ...linkSx, ...sx }}>
        {name}
      </Link>
    );
  }
  return (
    <Typography component="span" variant="body2" {...typographyProps} sx={{ display: 'inline', ...sx }}>
      {name}
    </Typography>
  );
}

function LoadingName({ width }: { width: number }) {
  return <Skeleton width={width} height={20} sx={{ display: 'inline-block' }} />;
}

// ---------------------------------------------------------------------------
// 1. BranchName
// ---------------------------------------------------------------------------
export function BranchName({ id, fallback = <NotSet />, typographyProps, sx }: DisplayProps) {
  const { data: branches = [], isLoading } = useDisplayLookup<BranchItem>('/v1/branches');
  if (!id) return <>{fallback}</>;
  if (isLoading && branches.length === 0) return <LoadingName width={100} />;
  const name = branches.find((b) => b.id === id)?.name ?? null;
  return <NameText name={name} fallback={fallback} typographyProps={typographyProps} sx={sx} />;
}

// ---------------------------------------------------------------------------
// 2. UserName
// ---------------------------------------------------------------------------
export function UserName({ id, fallback = 'Unassigned', typographyProps, sx }: DisplayProps) {
  const name = useUserName(id);
  const { isLoading } = useDisplayLookup<UserItem>('/v1/users');
  if (!id) return <>{fallback}</>;
  if (isLoading && !name) return <LoadingName width={90} />;
  return <NameText name={name} fallback={fallback} typographyProps={typographyProps} sx={sx} />;
}

// ---------------------------------------------------------------------------
// 3. ConnectorName
// ---------------------------------------------------------------------------
export function ConnectorName({
  id,
  fallback = 'Direct / Organic',
  showFirm = true,
  typographyProps,
  sx,
}: DisplayProps & { showFirm?: boolean }) {
  const { data: connectors = [], isLoading } = useDisplayLookup<ConnectorItem>('/v1/connectors');
  if (!id) return <>{fallback}</>;
  if (isLoading && connectors.length === 0) return <LoadingName width={110} />;
  const match = connectors.find((c) => c.id === id);
  let name: string | null = null;
  if (match) {
    const displayName = match.tradeName || match.legalName || match.contactName || match.fullName || null;
    const firm = match.firmName || match.tradeName;
    if (displayName) name = showFirm && firm && firm !== displayName ? `${displayName} (${firm})` : displayName;
  }
  return <NameText name={name} fallback={fallback} typographyProps={typographyProps} sx={sx} />;
}

// ---------------------------------------------------------------------------
// 4. LenderName
// ---------------------------------------------------------------------------
export function LenderName({ id, fallback = <NotSet />, typographyProps, sx }: DisplayProps) {
  const { data: lenders = [], isLoading } = useDisplayLookup<LenderItem>('/v1/lenders');
  if (!id) return <>{fallback}</>;
  if (isLoading && lenders.length === 0) return <LoadingName width={90} />;
  const name = lenders.find((l) => l.id === id)?.name ?? null;
  return <NameText name={name} fallback={fallback} typographyProps={typographyProps} sx={sx} />;
}

// ---------------------------------------------------------------------------
// 5. CustomerName
// ---------------------------------------------------------------------------
export function CustomerName({
  id,
  fallback = <NotSet />,
  linkToProfile = false,
  typographyProps,
  sx,
}: DisplayProps & { linkToProfile?: boolean }) {
  const { data: customers = [], isLoading } = useDisplayLookup<CustomerItem>('/v1/customers');
  const name = useCustomerName(id);
  if (!id) return <>{fallback}</>;
  if (isLoading && !name) return <LoadingName width={100} />;
  return (
    <NameText
      name={name}
      fallback={fallback}
      to={linkToProfile ? `/customers/${id}` : undefined}
      typographyProps={typographyProps}
      sx={sx}
    />
  );
}

// ---------------------------------------------------------------------------
// 6. LeadName
// ---------------------------------------------------------------------------
export function LeadName({
  id,
  fallback = <NotSet />,
  linkToLead = false,
  showCategory = true,
  typographyProps,
  sx,
}: DisplayProps & { linkToLead?: boolean; showCategory?: boolean }) {
  const { data: leads = [], isLoading } = useDisplayLookup<LeadItem>('/v1/leads');
  if (!id) return <>{fallback}</>;
  if (isLoading && leads.length === 0) return <LoadingName width={110} />;
  const match = leads.find((l) => l.id === id);
  const name = match
    ? showCategory && match.productCategory
      ? `${match.fullName} (${match.productCategory})`
      : match.fullName
    : null;
  return (
    <NameText
      name={name}
      fallback={fallback}
      to={linkToLead ? `/leads/${id}` : undefined}
      typographyProps={typographyProps}
      sx={sx}
    />
  );
}

// ---------------------------------------------------------------------------
// 7. ApplicationName
// ---------------------------------------------------------------------------
export function ApplicationName({
  id,
  fallback = <NotSet />,
  linkToApp = false,
  typographyProps,
  sx,
}: DisplayProps & { linkToApp?: boolean }) {
  const { data: apps = [], isLoading } = useDisplayLookup<ApplicationItem>('/v1/applications');
  if (!id) return <>{fallback}</>;
  if (isLoading && apps.length === 0) return <LoadingName width={120} />;
  const match = apps.find((a) => a.id === id);
  const name = match
    ? `${match.productCategory} • ₹${Number(match.requestedAmount).toLocaleString('en-IN')}`
    : null;
  return (
    <NameText
      name={name}
      fallback={fallback}
      to={linkToApp ? `/applications/${id}` : undefined}
      typographyProps={typographyProps}
      sx={sx}
    />
  );
}

// ---------------------------------------------------------------------------
// 8. ProductName
// ---------------------------------------------------------------------------
export function ProductName({ id, fallback = <NotSet />, typographyProps, sx }: DisplayProps) {
  const { data: products = [], isLoading } = useDisplayLookup<ProductItem>('/v1/products');
  if (!id) return <>{fallback}</>;
  if (isLoading && products.length === 0) return <LoadingName width={100} />;
  const name = products.find((p) => p.id === id)?.name ?? null;
  return <NameText name={name} fallback={fallback} typographyProps={typographyProps} sx={sx} />;
}
