// apps/web/src/shell/display.tsx — Reusable human-friendly name display components for IDs
import React from 'react';
import { Box, Link, Skeleton, Tooltip, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { useOptionalAuth } from '../auth/AuthProvider';
import { useMe, hasPermission } from '../api/useMe';
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
function useDisplayLookup<T>(
  path: string,
  query?: Record<string, string | number | undefined>,
  enabled = true,
) {
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
    enabled,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Friendly ID Formatter (Avoids showing raw database ULIDs to users)
// ---------------------------------------------------------------------------
export function formatFriendlyId(id: string | null | undefined): string {
  if (!id) return '—';
  if (id.startsWith('cust_')) {
    return `Customer (${id.slice(-6)})`;
  }
  if (id.startsWith('usr_')) {
    return `User (${id.slice(-6)})`;
  }
  if (id.startsWith('app_')) {
    return `Application #${id.slice(-6)}`;
  }
  if (id.startsWith('br_')) {
    return `Branch (${id.slice(-6)})`;
  }
  if (id.startsWith('lnd_')) {
    return `Lender (${id.slice(-6)})`;
  }
  if (id.startsWith('ver_') || id.startsWith('vrf_')) {
    return `Verification #${id.slice(-6)}`;
  }
  if (id.startsWith('ten_')) {
    return `Tenant (${id.slice(-6)})`;
  }
  if (id.startsWith('lead_')) {
    return `Lead #${id.slice(-6)}`;
  }
  if (id.length > 20) {
    return `#${id.slice(-6)}`;
  }
  return id;
}

// ---------------------------------------------------------------------------
// Lookup Hooks
// ---------------------------------------------------------------------------
export function useBranchName(id: string | null | undefined): string | null {
  const { data: branches = [] } = useDisplayLookup<BranchItem>('/v1/branches');
  if (!id) return null;
  const match = branches.find((b) => b.id === id);
  return match ? match.name : formatFriendlyId(id);
}

export function useUserName(id: string | null | undefined): string | null {
  const { data: users = [], isLoading } = useDisplayLookup<UserItem>('/v1/users');
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
    enabled: Boolean(id && !match && !isLoading),
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (!id) return null;
  const name =
    match
      ? match.displayName || match.fullName || (match as any).name || match.email || id
      : singleUser;
  return name || formatFriendlyId(id);
}

export function useConnectorName(id: string | null | undefined): string | null {
  const { data: connectors = [] } = useDisplayLookup<ConnectorItem>(
    '/v1/connectors',
    undefined,
    Boolean(id),
  );
  if (!id) return null;
  const match = connectors.find((c) => c.id === id);
  if (!match) return formatFriendlyId(id);
  const displayName = match.tradeName || match.legalName || match.contactName || match.fullName || id;
  const firm = match.firmName || match.tradeName;
  return firm && firm !== displayName ? `${displayName} (${firm})` : displayName;
}

export function useLenderName(id: string | null | undefined): string | null {
  const { data: lenders = [] } = useDisplayLookup<LenderItem>(
    '/v1/lenders',
    undefined,
    Boolean(id),
  );
  if (!id) return null;
  const match = lenders.find((l) => l.id === id);
  return match ? match.name : formatFriendlyId(id);
}

export function useCustomerName(id: string | null | undefined): string | null {
  const session = useOptionalAuth()?.session;
  const me = useMe().data;
  const canReadCustomer = session ? hasPermission(me, 'customer.read') : true;

  const { data: customers = [], isLoading } = useDisplayLookup<CustomerItem>(
    '/v1/customers',
    undefined,
    canReadCustomer,
  );
  const match = id && canReadCustomer ? customers.find((c) => c.id === id) : null;

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
    enabled: Boolean(canReadCustomer && id && !match && !isLoading),
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (!id) return null;
  return match ? match.fullName : singleCustomer || formatFriendlyId(id);
}

export function useLeadName(id: string | null | undefined): string | null {
  const { data: leads = [] } = useDisplayLookup<LeadItem>('/v1/leads');
  if (!id) return null;
  const match = leads.find((l) => l.id === id);
  return match ? `${match.fullName} (${match.productCategory})` : formatFriendlyId(id);
}

export function useProductName(id: string | null | undefined): string | null {
  const { data: products = [] } = useDisplayLookup<ProductItem>('/v1/products');
  if (!id) return null;
  const match = products.find((p) => p.id === id);
  return match ? match.name : formatFriendlyId(id);
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
  const isRawId = !name || name === id;
  const text = !isRawId ? name : formatFriendlyId(id);

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
      <Tooltip title={`Full ID: ${id}`} arrow placement="top">
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
  const name = match ? match.name : null;

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
    enabled: Boolean(id && !match && !isLoading),
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (!id) return <>{fallback}</>;
  if (isLoading && users.length === 0 && !singleUser) {
    return <Skeleton width={90} height={20} sx={{ display: 'inline-block' }} />;
  }

  const name = match
    ? match.displayName || match.fullName || (match as any).name || match.email || (match as any).emailMasked
    : singleUser || (fallback !== '—' && fallback !== 'Unassigned' ? fallback : null);

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
  const { data: connectors = [], isLoading } = useDisplayLookup<ConnectorItem>(
    '/v1/connectors',
    undefined,
    Boolean(id),
  );
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
  const { data: lenders = [], isLoading } = useDisplayLookup<LenderItem>(
    '/v1/lenders',
    undefined,
    Boolean(id),
  );
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
  const session = useOptionalAuth()?.session;
  const me = useMe().data;
  const canReadCustomer = session ? hasPermission(me, 'customer.read') : true;

  const { data: customers = [], isLoading } = useDisplayLookup<CustomerItem>(
    '/v1/customers',
    undefined,
    canReadCustomer,
  );
  const match = id && canReadCustomer ? customers.find((c) => c.id === id) : null;

  const { data: singleCustomer, isLoading: isSingleLoading } = useQuery({
    queryKey: ['/v1/customers', id],
    queryFn: async () => {
      try {
        const res = await apiFetch<any>(`/v1/customers/${id}`);
        return (res?.fullName || res?.data?.fullName || res?.name || null) as string | null;
      } catch {
        return null;
      }
    },
    enabled: Boolean(canReadCustomer && id && !match && !isLoading),
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (!id) return <>{fallback}</>;
  if (canReadCustomer && (isLoading || (isSingleLoading && !match)) && !singleCustomer && (!fallback || fallback === id || fallback === '—')) {
    return <Skeleton width={100} height={20} sx={{ display: 'inline-block' }} />;
  }

  const validFallback = typeof fallback === 'string' && fallback !== id && fallback !== '—' ? fallback : null;
  const name = match ? match.fullName : singleCustomer || validFallback;

  if (linkToProfile && canReadCustomer) {
    return (
      <Tooltip title={`Full ID: ${id}`} arrow placement="top">
        <Link
          component={RouterLink}
          to={`/customers/${id}`}
          underline="hover"
          color="primary.main"
          fontWeight="medium"
          sx={sx}
        >
          {name || formatFriendlyId(id)}
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
function formatAppAmount(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === 'number') return val.toLocaleString('en-IN');
  if (typeof val === 'string') {
    const num = Number(val);
    return isNaN(num) ? val : num.toLocaleString('en-IN');
  }
  if (typeof val === 'object' && val !== null && 'amount' in val) {
    const num = Number((val as any).amount);
    return isNaN(num) ? String((val as any).amount) : num.toLocaleString('en-IN');
  }
  return null;
}

export function ApplicationName({
  id,
  fallback = '—',
  linkToApp = false,
  showIdTooltip = true,
  compact = false,
  typographyProps,
  sx,
}: DisplayProps & { linkToApp?: boolean; compact?: boolean }) {
  const { data: apps = [], isLoading } = useDisplayLookup<ApplicationItem>('/v1/applications');
  if (!id) return <>{fallback}</>;
  if (isLoading && apps.length === 0) return <Skeleton width={120} height={20} sx={{ display: 'inline-block' }} />;

  const match = apps.find((a) => a.id === id);
  const appIdDisplay = `App #${id.slice(-6)}`;
  const amt = match ? formatAppAmount(match.requestedAmount) : null;
  const subtitle = match
    ? [match.productCategory, amt ? `₹${amt}` : null].filter(Boolean).join(' • ')
    : null;

  if (compact) {
    const text = subtitle ? `${appIdDisplay} (${subtitle})` : appIdDisplay;
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

  const content = (
    <Box sx={{ display: 'inline-flex', flexDirection: 'column', verticalAlign: 'middle', textAlign: 'inherit', ...sx }}>
      <Typography
        component="span"
        variant="body2"
        fontWeight={600}
        color={linkToApp ? 'primary.main' : 'text.primary'}
        {...typographyProps}
      >
        {appIdDisplay}
      </Typography>
      {subtitle && (
        <Typography
          component="span"
          variant="caption"
          color="text.secondary"
          sx={{ fontWeight: 500, fontSize: '0.75rem', lineHeight: 1.25 }}
        >
          {subtitle}
        </Typography>
      )}
    </Box>
  );

  if (linkToApp) {
    return (
      <Tooltip title={`Application ID: ${id}`} arrow placement="top">
        <Link
          component={RouterLink}
          to={`/applications/${id}`}
          underline="hover"
          sx={{ display: 'inline-block', textDecoration: 'none' }}
        >
          {content}
        </Link>
      </Tooltip>
    );
  }

  return (
    <Tooltip title={`Application ID: ${id}`} arrow placement="top">
      {content}
    </Tooltip>
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
