import React from 'react';
import {
  Box,
  Button,
  Card,
  InputAdornment,
  Stack,
  TextField,
} from '@mui/material';
import { SearchIcon } from '../../shell/icons';

export interface FilterToolbarProps {
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  searchPlaceholder?: string;
  searchTestId?: string;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
  onApply?: () => void;
  onReset?: () => void;
  onRefresh?: () => void;
  applyTestId?: string;
  resetTestId?: string;
  children?: React.ReactNode;
  dataTestId?: string;
}

export function FilterToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search records...',
  searchTestId,
  filters,
  actions,
  onApply,
  onReset,
  onRefresh,
  applyTestId,
  resetTestId,
  children,
  dataTestId,
}: FilterToolbarProps) {
  const hasSearch = onSearchChange !== undefined;

  return (
    <Card
      data-testid={dataTestId}
      sx={{
        p: 1.5,
        mb: 2.5,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: '10px',
        bgcolor: 'background.paper',
        boxShadow: 'none',
      }}
    >
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        alignItems={{ xs: 'stretch', md: 'center' }}
        justifyContent="space-between"
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          flexWrap="wrap"
          sx={{ flex: 1 }}
        >
          {hasSearch && (
            <TextField
              size="small"
              value={searchValue ?? ''}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              data-testid={searchTestId}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                  </InputAdornment>
                ),
              }}
              sx={{
                minWidth: { xs: '100%', sm: 220, md: 260 },
                '& .MuiOutlinedInput-root': {
                  bgcolor: '#ffffff',
                },
              }}
            />
          )}

          {filters}
          {children}

          {(onApply || onReset) && (
            <Stack direction="row" spacing={1} alignItems="center">
              {onApply && (
                <Button
                  variant="contained"
                  color="primary"
                  size="medium"
                  onClick={onApply}
                  data-testid={applyTestId}
                  sx={{ px: 2.5, fontWeight: 600, textTransform: 'none' }}
                >
                  Apply
                </Button>
              )}
              {onReset && (
                <Button
                  variant="text"
                  color="inherit"
                  size="medium"
                  onClick={onReset}
                  data-testid={resetTestId}
                  sx={{ px: 2, color: 'text.secondary', textTransform: 'none', fontWeight: 600 }}
                >
                  Reset
                </Button>
              )}
              {onRefresh && (
                <Button
                  variant="outlined"
                  size="medium"
                  onClick={onRefresh}
                  sx={{ px: 2, textTransform: 'none', fontWeight: 600 }}
                >
                  Refresh
                </Button>
              )}
            </Stack>
          )}

          {!onApply && !onReset && onRefresh && (
            <Button
              variant="outlined"
              size="medium"
              onClick={onRefresh}
              sx={{ px: 2, textTransform: 'none', fontWeight: 600 }}
            >
              Refresh
            </Button>
          )}
        </Stack>

        {actions && (
          <Stack direction="row" spacing={1} alignItems="center" flexShrink={0}>
            {actions}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
