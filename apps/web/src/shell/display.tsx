// apps/web/src/shell/display.tsx — Reusable human-friendly name display components for IDs
import React from 'react';
import { Box, Link, Skeleton, Tooltip, Typography } from '@mui/material';
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

/** Resilient lookup hook caching entity collections for name resolution */
function useDisplayLookup<T>(path: string, query?: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: [path, query],
    queryFn: async () => {
      try {
        const res = await apiFetch<any>(path, { query: { ...query, limit: 200 } });
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
// Lookup Hooks
// ---------------------------------------------------------------------------
export function useBranchName(id: string | null | undefined): string | null {
  const { data: branches = [] } = useDisplayLookup<BranchItem>('/v1/branches');
  if (!id) return null;
  const match = branches.find((b) => b.id === id);
  return match ? match.name : id;
}

export function useUserName(id: string | null | undefined): string | null {
  const { data: users = [] } = useDisplayLookup<UserItem>('/v1/users');
  if (!id) return null;
  const match = users.find((u) => u.id === id);
  return (match ? match.fullName || match.email : id) ?? id;
}

export function useConnectorName(id: string | null | undefined): string | null {
  const { data: connectors = [] } = useDisplayLookup<ConnectorItem>('/v1/connectors');
  if (!id) return null;
  const match = connectors.find((c) => c.id === id);
  if (!match) return id;
  const displayName = match.tradeName || match.legalName || match.contactName || match.fullName || id;
  const firm = match.firmName || match.tradeName;
  return firm && firm !== displayName ? `${displayName} (${firm})` : displayName;
}

export function useLenderName(id: string | null | undefined): string | null {
  const { data: lenders = [] } = useDisplayLookup<LenderItem>('/v1/lenders');
  if (!id) return null;
  const match = lenders.find((l) => l.id === id);
  return match ? match.name : id;
}

export function useCustomerName(id: string | null | undefined): string | null {
  const { data: customers = [] } = useDisplayLookup<CustomerItem>('/v1/customers');
  if (!id) return null;
  const match = customers.find((c) => c.id === id);
  return match ? match.fullName : id;
}

export function useLeadName(id: string | null | undefined): string | null {
  const { data: leads = [] } = useDisplayLookup<LeadItem>('/v1/leads');
  if (!id) return null;
  const match = leads.find((l) => l.id === id);
  return match ? `${match.fullName} (${match.productCategory})` : id;
}

export function useProductName(id: string | null | undefined): string | null {
  const { data: products = [] } = useDisplayLookup<ProductItem>('/v1/products');
  if (!id) return null;
  const match = products.find((p) => p.id === id);
  return match ? match.name : id;
}

// ---------------------------------------------------------------------------
// Base Wrapper Component
// ---------------------------------------------------------------------------
interface DisplayProps {
  id: string | null | undefined;
  fallback?: React.ReactNode;
  showIdTooltip?: boolean;
  typographyProps?: any;
  sx?: any;
}

function BaseDisplay({
  id,
  name,
  fallback = '—',
  showIdTooltip = true,
  typographyProps,
  sx,
}: DisplayProps & { name: string | null | undefined }) {
  if (!id) return <>{fallback}</>;
  const text = name || id;

  const content = (
    <Typography
      component="span"
      variant="body2"
      {...typographyProps}
      sx={{ display: 'inline', ...sx }}
    >
      {text}
    </Typography>
  );

  if (showIdTooltip && id) {
    return (
      <Tooltip title={`ID: ${id}`} arrow placement="top">
        {content}
      </Tooltip>
    );
  }

  return content;
}

// ---------------------------------------------------------------------------
// 1. BranchName
// ---------------------------------------------------------------------------
export function BranchName({
  id,
  fallback = '—',
  showIdTooltip = true,
  typographyProps,
  sx,
}: DisplayProps) {
  const { data: branches = [], isLoading } = useDisplayLookup<BranchItem>('/v1/branches');
  if (!id) return <>{fallback}</>;
  if (isLoading && branches.length === 0) return <Skeleton width={100} height={20} sx={{ display: 'inline-block' }} />;

  const match = branches.find((b) => b.id === id);
  const name = match ? match.name : id;

  return (
    <BaseDisplay
      id={id}
      name={name}
      fallback={fallback}
      showIdTooltip={showIdTooltip}
      typographyProps={typographyProps}
      sx={sx}
    />
  );
}

// ---------------------------------------------------------------------------
// 2. UserName
// ---------------------------------------------------------------------------
export function UserName({
  id,
  fallback = 'Unassigned',
  showIdTooltip = true,
  typographyProps,
  sx,
}: DisplayProps) {
  const { data: users = [], isLoading } = useDisplayLookup<UserItem>('/v1/users');
  if (!id) return <>{fallback}</>;
  if (isLoading && users.length === 0) return <Skeleton width={90} height={20} sx={{ display: 'inline-block' }} />;

  const match = users.find((u) => u.id === id);
  const name = match ? match.fullName || match.email : id;

  return (
    <BaseDisplay
      id={id}
      name={name}
      fallback={fallback}
      showIdTooltip={showIdTooltip}
      typographyProps={typographyProps}
      sx={sx}
    />
  );
}

// ---------------------------------------------------------------------------
// 3. ConnectorName
// ---------------------------------------------------------------------------
export function ConnectorName({
  id,
  fallback = 'Direct / Organic',
  showFirm = true,
  showIdTooltip = true,
  typographyProps,
  sx,
}: DisplayProps & { showFirm?: boolean }) {
  const { data: connectors = [], isLoading } = useDisplayLookup<ConnectorItem>('/v1/connectors');
  if (!id) return <>{fallback}</>;
  if (isLoading && connectors.length === 0) return <Skeleton width={110} height={20} sx={{ display: 'inline-block' }} />;

  const match = connectors.find((c) => c.id === id);
  let name = id;
  if (match) {
    const displayName = match.tradeName || match.legalName || match.contactName || match.fullName || id;
    const firm = match.firmName || match.tradeName;
    name = showFirm && firm && firm !== displayName ? `${displayName} (${firm})` : displayName;
  }

  return (
    <BaseDisplay
      id={id}
      name={name}
      fallback={fallback}
      showIdTooltip={showIdTooltip}
      typographyProps={typographyProps}
      sx={sx}
    />
  );
}

// ---------------------------------------------------------------------------
// 4. LenderName
// ---------------------------------------------------------------------------
export function LenderName({
  id,
  fallback = '—',
  showIdTooltip = true,
  typographyProps,
  sx,
}: DisplayProps) {
  const { data: lenders = [], isLoading } = useDisplayLookup<LenderItem>('/v1/lenders');
  if (!id) return <>{fallback}</>;
  if (isLoading && lenders.length === 0) return <Skeleton width={90} height={20} sx={{ display: 'inline-block' }} />;

  const match = lenders.find((l) => l.id === id);
  const name = match ? match.name : id;

  return (
    <BaseDisplay
      id={id}
      name={name}
      fallback={fallback}
      showIdTooltip={showIdTooltip}
      typographyProps={typographyProps}
      sx={sx}
    />
  );
}

// ---------------------------------------------------------------------------
// 5. CustomerName
// ---------------------------------------------------------------------------
export function CustomerName({
  id,
  fallback = '—',
  linkToProfile = false,
  showIdTooltip = true,
  typographyProps,
  sx,
}: DisplayProps & { linkToProfile?: boolean }) {
  const { data: customers = [], isLoading } = useDisplayLookup<CustomerItem>('/v1/customers');
  if (!id) return <>{fallback}</>;
  if (isLoading && customers.length === 0) return <Skeleton width={100} height={20} sx={{ display: 'inline-block' }} />;

  const match = customers.find((c) => c.id === id);
  const name = match ? match.fullName : id;

  if (linkToProfile) {
    return (
      <Tooltip title={`Customer ID: ${id}`} arrow placement="top">
        <Link
          component={RouterLink}
          to={`/customers/${id}`}
          underline="hover"
          color="primary.main"
          fontWeight="medium"
          sx={sx}
        >
          {name}
        </Link>
      </Tooltip>
    );
  }

  return (
    <BaseDisplay
      id={id}
      name={name}
      fallback={fallback}
      showIdTooltip={showIdTooltip}
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
  fallback = '—',
  linkToLead = false,
  showCategory = true,
  showIdTooltip = true,
  typographyProps,
  sx,
}: DisplayProps & { linkToLead?: boolean; showCategory?: boolean }) {
  const { data: leads = [], isLoading } = useDisplayLookup<LeadItem>('/v1/leads');
  if (!id) return <>{fallback}</>;
  if (isLoading && leads.length === 0) return <Skeleton width={110} height={20} sx={{ display: 'inline-block' }} />;

  const match = leads.find((l) => l.id === id);
  let name = id;
  if (match) {
    name = showCategory && match.productCategory ? `${match.fullName} (${match.productCategory})` : match.fullName;
  }

  if (linkToLead) {
    return (
      <Tooltip title={`Lead ID: ${id}`} arrow placement="top">
        <Link
          component={RouterLink}
          to={`/leads/${id}`}
          underline="hover"
          color="primary.main"
          fontWeight="medium"
          sx={sx}
        >
          {name}
        </Link>
      </Tooltip>
    );
  }

  return (
    <BaseDisplay
      id={id}
      name={name}
      fallback={fallback}
      showIdTooltip={showIdTooltip}
      typographyProps={typographyProps}
      sx={sx}
    />
  );
}

// ---------------------------------------------------------------------------
// 7. ApplicationName / ApplicationBadge
// ---------------------------------------------------------------------------
export function ApplicationName({
  id,
  fallback = '—',
  linkToApp = false,
  showIdTooltip = true,
  typographyProps,
  sx,
}: DisplayProps & { linkToApp?: boolean }) {
  const { data: apps = [], isLoading } = useDisplayLookup<ApplicationItem>('/v1/applications');
  if (!id) return <>{fallback}</>;
  if (isLoading && apps.length === 0) return <Skeleton width={120} height={20} sx={{ display: 'inline-block' }} />;

  const match = apps.find((a) => a.id === id);
  const text = match
    ? `${match.productCategory} • ₹${Number(match.requestedAmount).toLocaleString('en-IN')}`
    : `App #${id.slice(-6)}`;

  if (linkToApp) {
    return (
      <Tooltip title={`Application ID: ${id}`} arrow placement="top">
        <Link
          component={RouterLink}
          to={`/applications/${id}`}
          underline="hover"
          color="primary.main"
          fontWeight="medium"
          sx={sx}
        >
          {text}
        </Link>
      </Tooltip>
    );
  }

  return (
    <BaseDisplay
      id={id}
      name={text}
      fallback={fallback}
      showIdTooltip={showIdTooltip}
      typographyProps={typographyProps}
      sx={sx}
    />
  );
}

// ---------------------------------------------------------------------------
// 8. ProductName
// ---------------------------------------------------------------------------
export function ProductName({
  id,
  fallback = '—',
  showIdTooltip = true,
  typographyProps,
  sx,
}: DisplayProps) {
  const { data: products = [], isLoading } = useDisplayLookup<ProductItem>('/v1/products');
  if (!id) return <>{fallback}</>;
  if (isLoading && products.length === 0) return <Skeleton width={100} height={20} sx={{ display: 'inline-block' }} />;

  const match = products.find((p) => p.id === id);
  const name = match ? match.name : id;

  return (
    <BaseDisplay
      id={id}
      name={name}
      fallback={fallback}
      showIdTooltip={showIdTooltip}
      typographyProps={typographyProps}
      sx={sx}
    />
  );
}
