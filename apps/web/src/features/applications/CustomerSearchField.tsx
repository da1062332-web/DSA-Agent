// Find an existing customer to put on a loan file (owner: Bhushan, 2026-11-28). Works the way a DSA executive does it: type the
// person's 10-digit mobile (exact match) or part of their name, pick from the masked results, or create the person when they are not
// on the books yet. Nothing is listed before something is typed, and the term goes in the request body (POST /v1/customers/search),
// never in a URL. People already on the file are left out.
import { Autocomplete, Box, Link, Stack, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import { searchHint, searchProblem, searchTerm } from './customer-search';

export interface FoundCustomer {
  id: string;
  partyType: 'INDIVIDUAL' | 'ENTITY';
  fullName: string;
  primaryMobileMasked?: string | null;
  primaryEmailMasked?: string | null;
}

export function CustomerSearchField({
  value,
  onChange,
  excludeIds,
  onCreateNew,
  label = 'Find customer by mobile or name',
  dataTestId,
}: {
  value: FoundCustomer | null;
  onChange: (customer: FoundCustomer | null) => void;
  excludeIds: string[];
  /** Offered when nothing matches: open the create form, pre-filled with what was typed. */
  onCreateNew?: (typed: string) => void;
  label?: string;
  dataTestId?: string;
}) {
  const [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(input), 300);
    return () => clearTimeout(t);
  }, [input]);

  const term = searchTerm(debounced);
  const problem = searchProblem(input);
  const results = useQuery({
    queryKey: ['customer-search', term, [...excludeIds].sort().join(',')],
    queryFn: () =>
      apiFetch<{ data: FoundCustomer[] }>('/v1/customers/search', {
        method: 'POST',
        body: { query: term, excludeIds, limit: 20 },
      }).then((r) => r.data),
    enabled: term !== null,
    staleTime: 15_000,
  });

  const options = term ? (results.data ?? []) : [];
  const noOptions =
    searchHint(input) ??
    problem ??
    (results.isFetching || term === null ? 'Searching…' : 'No customer found.');

  return (
    <Box sx={{ minWidth: 0 }}>
      <Autocomplete<FoundCustomer, false, false, false>
        size="small"
        fullWidth
        value={value}
        options={options}
        loading={results.isFetching}
        filterOptions={(x) => x}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        getOptionLabel={(o) => o.fullName}
        inputValue={input}
        onInputChange={(_e, v, reason) => {
          if (reason !== 'reset') setInput(v);
        }}
        onChange={(_e, v) => onChange(v)}
        noOptionsText={
          <Stack spacing={0.5}>
            <span>{noOptions}</span>
            {onCreateNew && term !== null && !results.isFetching && !problem && !searchHint(input) && (
              <Link
                component="button"
                type="button"
                underline="hover"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onCreateNew(input.trim())}
                data-testid="application.party-create-from-search"
                sx={{ textAlign: 'left' }}
              >
                Create “{input.trim()}” as a new customer
              </Link>
            )}
          </Stack>
        }
        renderOption={(props, o) => {
          const { key, ...rest } = props as typeof props & { key: string };
          return (
            <li key={key} {...rest} data-testid={`application.party-option.${o.id}`}>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {o.fullName}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {o.partyType === 'ENTITY' ? 'Company or firm' : 'Individual'}
                  {o.primaryMobileMasked ? ` · ${o.primaryMobileMasked}` : ''}
                  {o.primaryEmailMasked ? ` · ${o.primaryEmailMasked}` : ''}
                </Typography>
              </Box>
            </li>
          );
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            placeholder="98XXXXXXXX or name"
            inputProps={{ ...params.inputProps, 'data-testid': dataTestId, autoComplete: 'off' }}
          />
        )}
      />
    </Box>
  );
}
