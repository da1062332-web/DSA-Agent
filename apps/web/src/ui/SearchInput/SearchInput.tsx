import React from 'react';
import {
  IconButton,
  InputAdornment,
  TextField,
  type TextFieldProps,
} from '@mui/material';
import { SearchIcon, CloseIcon } from '../../shell/icons';

export interface SearchInputProps extends Omit<TextFieldProps, 'variant'> {
  value: string;
  onSearchChange?: (value: string) => void;
  onClear?: () => void;
  placeholder?: string;
  dataTestId?: string;
}

/**
 * Standard reusable enterprise search input component.
 * Features consistent height, search icon, clear action, and clean slate styling.
 */
export function SearchInput({
  value,
  onSearchChange,
  onClear,
  onChange,
  placeholder = 'Search...',
  size = 'small',
  dataTestId,
  sx,
  ...rest
}: SearchInputProps) {
  const handleClear = () => {
    onSearchChange?.('');
    onClear?.();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onSearchChange?.(e.target.value);
    onChange?.(e);
  };

  return (
    <TextField
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      size={size}
      data-testid={dataTestId}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
          </InputAdornment>
        ),
        endAdornment: value ? (
          <InputAdornment position="end">
            <IconButton
              size="small"
              onClick={handleClear}
              aria-label="Clear search"
              edge="end"
              sx={{ p: 0.5, color: 'text.secondary' }}
            >
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </InputAdornment>
        ) : null,
        sx: {
          borderRadius: 2,
          backgroundColor: '#FFFFFF',
          fontSize: '0.875rem',
          '& fieldset': {
            borderColor: '#CBD5E1',
          },
          '&:hover fieldset': {
            borderColor: '#94A3B8',
          },
          '&.Mui-focused fieldset': {
            borderColor: '#F89344',
          },
        },
      }}
      sx={{
        minWidth: { xs: '100%', sm: 260 },
        ...sx,
      }}
      {...rest}
    />
  );
}
