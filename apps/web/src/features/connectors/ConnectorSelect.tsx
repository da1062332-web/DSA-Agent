// apps/web/src/features/connectors/ConnectorSelect.tsx
// Picker over connectors (MOD-CON), so forms never ask for a typed raw connector ID.
// It reads GET /v1/connectors/lookup, which returns only id, legal name, status and branch. The directory (PAN, mobile, e-mail, bank
// and agreement data) is not needed to pick a partner, so this picker never asks for it.

import React from 'react';
import { Autocomplete, Box, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, errorText } from '../../api/client';
import { useMe, hasPermission } from '../../api/useMe';
import type { ConnectorLookupItem } from '@dsa/contracts';

// The permissions the API accepts for the lookup (ConnectorService.lookupConnectors). The API decides; this list only decides
// whether to show the picker or a plain text field.
const LOOKUP_PERMISSIONS = [
  'connector.read',
  'connector.manage',
  'lead.create',
  'finance.view',
  'share.create',
];

export interface ConnectorSelectProps {
  value: string | null;
  onChange: (connectorId: string | null) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  error?: boolean;
  helperText?: string;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  status?: string;
  testId?: string;
  allowFreeText?: boolean;
}

export function ConnectorSelect({
  value,
  onChange,
  label = 'Sourcing Connector / DSA',
  placeholder = 'Select or search partner by name...',
  required = false,
  disabled = false,
  error = false,
  helperText,
  size = 'medium',
  fullWidth = true,
  status = 'ACTIVE',
  testId = 'lead-form.connector',
  allowFreeText = true,
}: ConnectorSelectProps) {
  const me = useMe();
  const canLookup = LOOKUP_PERMISSIONS.some((code) => hasPermission(me.data, code));

  const query = useQuery({
    queryKey: ['connectors', 'lookup', status],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      const res = await apiFetch<{ items: ConnectorLookupItem[] }>(
        `/v1/connectors/lookup?${params.toString()}`,
      );
      return res.items;
    },
    enabled: canLookup,
    retry: false,
    staleTime: 60_000,
  });

  const connectors = query.data ?? [];
  const selectedConnector = connectors.find((c) => c.id === value) ?? null;

  if (!canLookup) {
    return (
      <TextField
        fullWidth={fullWidth}
        size={size}
        label={label}
        placeholder={placeholder ?? 'e.g. con_01...'}
        required={required}
        disabled={disabled}
        error={error}
        helperText={helperText}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value.trim() || null)}
        inputProps={{
          'data-testid': testId,
        }}
      />
    );
  }

  return (
    <Autocomplete
      freeSolo={allowFreeText}
      fullWidth={fullWidth}
      disabled={disabled}
      options={connectors}
      getOptionLabel={(option) => {
        if (typeof option === 'string') {
          const match = connectors.find((c) => c.id === option);
          return match ? match.legalName || match.id : option;
        }
        return option.legalName || option.id;
      }}
      isOptionEqualToValue={(option, val) => {
        const valId = typeof val === 'string' ? val : val.id;
        return option.id === valId;
      }}
      value={selectedConnector || value || ''}
      onChange={(_e, newValue) => {
        if (!newValue) {
          onChange(null);
        } else if (typeof newValue === 'string') {
          onChange(newValue.trim() || null);
        } else {
          onChange(newValue.id);
        }
      }}
      onInputChange={(_e, newInputValue, reason) => {
        if (reason === 'input' && allowFreeText) {
          onChange(newInputValue.trim() || null);
        }
      }}
      loading={query.isPending}
      renderOption={(props, option) => (
        <li {...props} key={option.id}>
          <Box sx={{ display: 'flex', flexDirection: 'column', py: 0.5, width: '100%' }}>
            <Typography variant="body2" fontWeight={600} color="text.primary">
              {option.legalName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              ID: {option.id} · {option.status}
            </Typography>
          </Box>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          size={size}
          label={label}
          placeholder={placeholder}
          required={required}
          error={error || query.isError}
          helperText={helperText ?? (query.isError ? errorText(query.error) : undefined)}
          inputProps={{
            ...params.inputProps,
            'data-testid': testId,
          }}
        />
      )}
    />
  );
}
