// apps/web/src/shell/selectors.tsx — Unified dynamic selector components for IDs across DSA CRM
import React from 'react';
import {
  Autocomplete,
  Box,
  CircularProgress,
  MenuItem,
  TextField,
  Typography,
  createFilterOptions,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';

export interface BaseSelectorProps {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  allowNone?: boolean;
  error?: boolean;
  helperText?: string;
  sx?: any;
  'data-testid'?: string;
}

/** Resilient lookup hook handling array, { data: [] }, or { items: [] } */
function useLookupItems<T>(path: string, query?: Record<string, string | number | undefined>) {
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
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// 1. BRANCH SELECTOR
// ---------------------------------------------------------------------------
export interface BranchItem {
  id: string;
  code: string;
  name: string;
}

export function BranchSelect({
  value,
  onChange,
  label = 'Branch',
  placeholder = 'Select branch...',
  required = false,
  disabled = false,
  size = 'small',
  fullWidth = true,
  allowNone = false,
  error = false,
  helperText,
  sx,
  'data-testid': testId,
}: BaseSelectorProps) {
  const { data: branches = [], isLoading } = useLookupItems<BranchItem>('/v1/branches', { status: 'ACTIVE' });

  return (
    <TextField
      select
      fullWidth={fullWidth}
      size={size}
      label={label}
      value={value ?? ''}
      required={required}
      disabled={disabled || isLoading}
      error={error}
      helperText={helperText}
      sx={sx}
      onChange={(e) => onChange(e.target.value || null)}
      data-testid={testId}
      SelectProps={{
        displayEmpty: true,
      }}
    >
      {allowNone && (
        <MenuItem value="">
          <em>None (All Branches)</em>
        </MenuItem>
      )}
      {branches.map((b) => (
        <MenuItem key={b.id} value={b.id}>
          {b.code} — {b.name}
        </MenuItem>
      ))}
      {value && !branches.some((b) => b.id === value) && (
        <MenuItem key={value} value={value}>
          {value}
        </MenuItem>
      )}
    </TextField>
  );
}

// ---------------------------------------------------------------------------
// 2. USER SELECTOR (Single & Multi)
// ---------------------------------------------------------------------------
export interface UserItem {
  id: string;
  displayName?: string;
  email?: string;
  fullName?: string;
  status?: string;
}

export function UserSelect({
  value,
  onChange,
  label = 'User / Agent',
  placeholder = 'Search by name or email...',
  required = false,
  disabled = false,
  size = 'small',
  fullWidth = true,
  allowNone = false,
  error = false,
  helperText,
  sx,
  'data-testid': testId,
}: BaseSelectorProps) {
  const { data: users = [], isLoading } = useLookupItems<UserItem>('/v1/users', { status: 'ACTIVE' });

  const filter = createFilterOptions<UserItem>({
    stringify: (u) => `${u.displayName ?? u.fullName ?? ''} ${u.email ?? ''} ${u.id}`,
  });

  const selectedOption = users.find((u) => u.id === value) || (value ? ({ id: value, displayName: value } as UserItem) : null);

  return (
    <Autocomplete<UserItem, false, false, false>
      size={size}
      fullWidth={fullWidth}
      disabled={disabled}
      loading={isLoading}
      options={users}
      value={selectedOption}
      filterOptions={filter}
      sx={sx}
      isOptionEqualToValue={(opt, val) => opt.id === val.id}
      getOptionLabel={(opt) => opt.displayName || opt.fullName || opt.email || opt.id}
      onChange={(_e, opt) => onChange(opt ? opt.id : null)}
      renderOption={(props, opt) => (
        <li {...props} key={opt.id}>
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Typography variant="body2" fontWeight={600}>
              {opt.displayName || opt.fullName || opt.email || opt.id}
            </Typography>
            {opt.email && (
              <Typography variant="caption" color="text.secondary">
                {opt.email} • {opt.id}
              </Typography>
            )}
          </Box>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          required={required}
          error={error}
          helperText={helperText}
          data-testid={testId}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {isLoading ? <CircularProgress color="inherit" size={18} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// 3. CONNECTOR SELECTOR
// ---------------------------------------------------------------------------
export interface ConnectorItem {
  id: string;
  legalName?: string;
  tradeName?: string;
  contactName?: string;
  mobile?: string;
  status?: string;
  code?: string;
  fullName?: string;
  firmName?: string;
}

export function ConnectorSelect({
  value,
  onChange,
  label = 'Connector',
  placeholder = 'Select or search connector...',
  required = false,
  disabled = false,
  size = 'small',
  fullWidth = true,
  error = false,
  helperText,
  sx,
  'data-testid': testId,
}: BaseSelectorProps) {
  const { data: connectors = [], isLoading } = useLookupItems<ConnectorItem>('/v1/connectors');

  const filter = createFilterOptions<ConnectorItem>({
    stringify: (c) => `${c.tradeName ?? ''} ${c.contactName ?? ''} ${c.legalName ?? ''} ${c.mobile ?? ''} ${c.id}`,
  });

  const selectedOption =
    connectors.find((c) => c.id === value) ||
    (value ? ({ id: value, tradeName: value } as ConnectorItem) : null);

  return (
    <Autocomplete<ConnectorItem, false, false, false>
      size={size}
      fullWidth={fullWidth}
      disabled={disabled}
      loading={isLoading}
      options={connectors}
      value={selectedOption}
      filterOptions={filter}
      sx={sx}
      isOptionEqualToValue={(opt, val) => opt.id === val.id}
      getOptionLabel={(opt) => {
        const match = connectors.find((c) => c.id === opt.id);
        const name = opt.tradeName || opt.legalName || opt.contactName || match?.tradeName || match?.legalName;
        return name || opt.id;
      }}
      onChange={(_e, opt) => onChange(opt ? opt.id : null)}
      renderOption={(props, opt) => {
        const name = opt.tradeName || opt.contactName || opt.legalName || 'Unnamed Connector';
        return (
          <li {...props} key={opt.id}>
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              <Typography variant="body2" fontWeight={600}>
                {name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {opt.mobile ? `Mobile: ${opt.mobile} • ` : ''}ID: {opt.id}
              </Typography>
            </Box>
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          required={required}
          error={error}
          helperText={helperText}
          data-testid={testId}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {isLoading ? <CircularProgress color="inherit" size={18} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// 4. LEAD SELECTOR
// ---------------------------------------------------------------------------
export interface LeadItem {
  id: string;
  fullName: string;
  mobileMasked?: string;
  productCategory?: string;
  state?: string;
}

export function LeadSelect({
  value,
  onChange,
  label = 'Lead',
  placeholder = 'Select or search lead by name...',
  required = false,
  disabled = false,
  size = 'small',
  fullWidth = true,
  error = false,
  helperText,
  sx,
  'data-testid': testId,
}: BaseSelectorProps) {
  const { data: leads = [], isLoading } = useLookupItems<LeadItem>('/v1/leads');

  const filter = createFilterOptions<LeadItem>({
    stringify: (l) => `${l.fullName ?? ''} ${l.mobileMasked ?? ''} ${l.productCategory ?? ''} ${l.id}`,
  });

  const selectedOption =
    leads.find((l) => l.id === value) || (value ? ({ id: value, fullName: value } as LeadItem) : null);

  return (
    <Autocomplete<LeadItem, false, false, false>
      size={size}
      fullWidth={fullWidth}
      disabled={disabled}
      loading={isLoading}
      options={leads}
      value={selectedOption}
      filterOptions={filter}
      sx={sx}
      isOptionEqualToValue={(opt, val) => opt.id === val.id}
      getOptionLabel={(opt) => {
        const match = leads.find((l) => l.id === opt.id);
        const name = opt.fullName || match?.fullName;
        if (name && name !== opt.id) {
          return `${name} (${opt.productCategory || match?.productCategory || 'Lead'})`;
        }
        return opt.id;
      }}
      onChange={(_e, opt) => onChange(opt ? opt.id : null)}
      renderOption={(props, opt) => (
        <li {...props} key={opt.id}>
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Typography variant="body2" fontWeight={600}>
              {opt.fullName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {opt.productCategory ? `[${opt.productCategory}] ` : ''}
              {opt.mobileMasked ? `${opt.mobileMasked} • ` : ''}ID: {opt.id}
            </Typography>
          </Box>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          required={required}
          error={error}
          helperText={helperText}
          data-testid={testId}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {isLoading ? <CircularProgress color="inherit" size={18} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// 5. APPLICATION SELECTOR
// ---------------------------------------------------------------------------
export interface ApplicationItem {
  id: string;
  productCategory?: string;
  requestedAmount?: string | { amount?: string; currency?: string };
  status?: string;
  applicantName?: string;
}

export function ApplicationSelect({
  value,
  onChange,
  label = 'Loan Application',
  placeholder = 'Select or search application...',
  required = false,
  disabled = false,
  size = 'small',
  fullWidth = true,
  error = false,
  helperText,
  sx,
  'data-testid': testId,
}: BaseSelectorProps) {
  const { data: applications = [], isLoading } = useLookupItems<ApplicationItem>('/v1/applications');

  const filter = createFilterOptions<ApplicationItem>({
    stringify: (a) => `${a.id} ${a.productCategory ?? ''} ${a.status ?? ''} ${a.applicantName ?? ''}`,
  });

  const selectedOption =
    applications.find((a) => a.id === value) ||
    (value ? ({ id: value, productCategory: '' } as ApplicationItem) : null);

  const formatAmount = (amt: any) => {
    if (!amt) return '';
    if (typeof amt === 'object') return `₹${Number(amt.amount || 0).toLocaleString('en-IN')}`;
    return `₹${Number(amt).toLocaleString('en-IN')}`;
  };

  return (
    <Autocomplete<ApplicationItem, false, false, false>
      size={size}
      fullWidth={fullWidth}
      disabled={disabled}
      loading={isLoading}
      options={applications}
      value={selectedOption}
      filterOptions={filter}
      sx={sx}
      isOptionEqualToValue={(opt, val) => opt.id === val.id}
      getOptionLabel={(opt) => {
        const match = applications.find((a) => a.id === opt.id);
        const name = opt.applicantName || match?.applicantName;
        const cat = opt.productCategory || match?.productCategory;
        if (name) {
          return `${name} — ${cat ? `[${cat}] ` : ''}App #${opt.id.slice(-6)}`;
        }
        return `${cat ? `[${cat}] ` : ''}App #${opt.id}`;
      }}
      onChange={(_e, opt) => onChange(opt ? opt.id : null)}
      renderOption={(props, opt) => (
        <li {...props} key={opt.id}>
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Typography variant="body2" fontWeight={600}>
              {opt.applicantName ? `${opt.applicantName} • ` : ''}App #{opt.id}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {opt.productCategory ? `Product: ${opt.productCategory} • ` : ''}
              {opt.status ? `Status: ${opt.status} • ` : ''}
              {formatAmount(opt.requestedAmount)}
            </Typography>
          </Box>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          required={required}
          error={error}
          helperText={helperText}
          data-testid={testId}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {isLoading ? <CircularProgress color="inherit" size={18} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// 6. CUSTOMER SELECTOR
// ---------------------------------------------------------------------------
export interface CustomerItem {
  id: string;
  fullName: string;
  primaryPhoneMasked?: string;
  emailMasked?: string;
}

export function CustomerSelect({
  value,
  onChange,
  label = 'Customer',
  placeholder = 'Select or search customer by name...',
  required = false,
  disabled = false,
  size = 'small',
  fullWidth = true,
  error = false,
  helperText,
  sx,
  'data-testid': testId,
}: BaseSelectorProps) {
  const { data: customers = [], isLoading } = useLookupItems<CustomerItem>('/v1/customers');

  const filter = createFilterOptions<CustomerItem>({
    stringify: (c) => `${c.fullName ?? ''} ${c.primaryPhoneMasked ?? ''} ${c.emailMasked ?? ''} ${c.id}`,
  });

  const selectedOption =
    customers.find((c) => c.id === value) ||
    (value ? ({ id: value, fullName: value } as CustomerItem) : null);

  return (
    <Autocomplete<CustomerItem, false, false, false>
      size={size}
      fullWidth={fullWidth}
      disabled={disabled}
      loading={isLoading}
      options={customers}
      value={selectedOption}
      filterOptions={filter}
      sx={sx}
      isOptionEqualToValue={(opt, val) => opt.id === val.id}
      getOptionLabel={(opt) => {
        const match = customers.find((c) => c.id === opt.id);
        const name = opt.fullName || match?.fullName;
        return name || opt.id;
      }}
      onChange={(_e, opt) => onChange(opt ? opt.id : null)}
      renderOption={(props, opt) => (
        <li {...props} key={opt.id}>
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Typography variant="body2" fontWeight={600}>
              {opt.fullName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {opt.primaryPhoneMasked ? `${opt.primaryPhoneMasked} • ` : ''}ID: {opt.id}
            </Typography>
          </Box>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          required={required}
          error={error}
          helperText={helperText}
          data-testid={testId}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {isLoading ? <CircularProgress color="inherit" size={18} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// 7. LENDER SELECTOR
// ---------------------------------------------------------------------------
export interface LenderItem {
  id: string;
  name: string;
  code?: string;
  status?: string;
}

export function LenderSelect({
  value,
  onChange,
  label = 'Lender / Bank',
  placeholder = 'Select lender...',
  required = false,
  disabled = false,
  size = 'small',
  fullWidth = true,
  allowNone = false,
  error = false,
  helperText,
  sx,
  'data-testid': testId,
}: BaseSelectorProps) {
  const { data: lenders = [], isLoading } = useLookupItems<LenderItem>('/v1/lenders', { status: 'ACTIVE' });

  return (
    <TextField
      select
      fullWidth={fullWidth}
      size={size}
      label={label}
      value={value ?? ''}
      required={required}
      disabled={disabled || isLoading}
      error={error}
      helperText={helperText}
      sx={sx}
      onChange={(e) => onChange(e.target.value || null)}
      data-testid={testId}
    >
      {allowNone && (
        <MenuItem value="">
          <em>None</em>
        </MenuItem>
      )}
      {lenders.map((l) => (
        <MenuItem key={l.id} value={l.id}>
          {l.name} {l.code ? `(${l.code})` : ''}
        </MenuItem>
      ))}
      {value && !lenders.some((l) => l.id === value) && (
        <MenuItem key={value} value={value}>
          {value}
        </MenuItem>
      )}
    </TextField>
  );
}

// ---------------------------------------------------------------------------
// 8. LOAN PRODUCT SELECTOR
// ---------------------------------------------------------------------------
export interface ProductItem {
  id: string;
  name: string;
  category?: string;
  code?: string;
}

export function ProductSelect({
  value,
  onChange,
  label = 'Loan Product',
  placeholder = 'Select product...',
  required = false,
  disabled = false,
  size = 'small',
  fullWidth = true,
  allowNone = false,
  error = false,
  helperText,
  sx,
  'data-testid': testId,
}: BaseSelectorProps) {
  const { data: products = [], isLoading } = useLookupItems<ProductItem>('/v1/products', { status: 'ACTIVE' });

  return (
    <TextField
      select
      fullWidth={fullWidth}
      size={size}
      label={label}
      value={value ?? ''}
      required={required}
      disabled={disabled || isLoading}
      error={error}
      helperText={helperText}
      sx={sx}
      onChange={(e) => onChange(e.target.value || null)}
      data-testid={testId}
    >
      {allowNone && (
        <MenuItem value="">
          <em>None</em>
        </MenuItem>
      )}
      {products.map((p) => (
        <MenuItem key={p.id} value={p.id}>
          {p.name} {p.category ? `[${p.category}]` : ''}
        </MenuItem>
      ))}
      {value && !products.some((p) => p.id === value) && (
        <MenuItem key={value} value={value}>
          {value}
        </MenuItem>
      )}
    </TextField>
  );
}
