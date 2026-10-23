// apps/web/src/features/connectors/ConnectorSelect.tsx
// Picker over active connectors (MOD-CON; API-CON-002), so forms never ask for a typed raw connector ID.
// Provides a searchable Autocomplete by partner name, contact person, mobile, and PAN, with freeSolo fallback.

import React from 'react';
import { Autocomplete, Box, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, errorText } from '../../api/client';
import { useMe, hasPermission } from '../../api/useMe';
import type { ConnectorResource } from '@dsa/contracts';

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
  placeholder = 'Select or search partner by name/PAN...',
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
  const canRead = hasPermission(me.data, 'connector.read');

  const query = useQuery({
    queryKey: ['connectors', 'select', status],
    queryFn: async () => {
      try {
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        const res = await apiFetch<{ items?: ConnectorResource[]; data?: ConnectorResource[] }>(
          `/v1/connectors?${params.toString()}`
        );
        return res?.items ?? res?.data ?? (Array.isArray(res) ? res : []);
      } catch {
        return [];
      }
    },
    enabled: canRead,
    retry: false,
    staleTime: 60_000,
  });

  const connectors = query.data ?? [];
  const selectedConnector = connectors.find((c) => c.id === value) ?? null;

  if (!canRead) {
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
          return match ? (match.tradeName || match.legalName || match.id) : option;
        }
        return option.tradeName || option.legalName || option.id;
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
              {option.tradeName || option.legalName}
              {option.tradeName && option.legalName && option.tradeName !== option.legalName ? ` (${option.legalName})` : ''}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              ID: {option.id}
              {option.contactPerson ? ` · Contact: ${option.contactPerson}` : ''}
              {option.panMasked ? ` · PAN: ${option.panMasked}` : ''}
              {option.mobileE164 ? ` · Mobile: ${option.mobileE164}` : ''}
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
          helperText={
            helperText ??
            (query.isError ? errorText(query.error) : undefined)
          }
          inputProps={{
            ...params.inputProps,
            'data-testid': testId,
          }}
        />
      )}
    />
  );
}
