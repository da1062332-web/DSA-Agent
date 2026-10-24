import React from 'react';
import {
  Button as MuiButton,
  type ButtonProps as MuiButtonProps,
  CircularProgress,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

export type AppButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outlined'
  | 'ghost'
  | 'danger'
  | 'success';

export interface AppButtonProps extends Omit<MuiButtonProps, 'variant' | 'color'> {
  variant?: AppButtonVariant;
  size?: 'small' | 'medium' | 'large';
  loading?: boolean;
  loadingText?: string;
  icon?: React.ReactNode;
  endIcon?: React.ReactNode;
  to?: string;
  dataTestId?: string;
}

const VARIANT_STYLES: Record<AppButtonVariant, any> = {
  primary: {
    backgroundColor: '#F89344',
    color: '#ffffff',
    border: '1px solid transparent',
    boxShadow: '0 1px 2px rgba(248, 147, 68, 0.2)',
    '&:hover': {
      backgroundColor: '#D97324',
      boxShadow: '0 2px 4px rgba(217, 115, 36, 0.25)',
    },
    '&:active': {
      backgroundColor: '#C5641B',
    },
    '&.Mui-disabled': {
      backgroundColor: 'rgba(248, 147, 68, 0.45)',
      color: '#ffffff',
    },
  },
  secondary: {
    backgroundColor: '#215988',
    color: '#ffffff',
    border: '1px solid transparent',
    boxShadow: '0 1px 2px rgba(33, 89, 136, 0.2)',
    '&:hover': {
      backgroundColor: '#174368',
      boxShadow: '0 2px 4px rgba(23, 67, 104, 0.25)',
    },
    '&:active': {
      backgroundColor: '#103250',
    },
    '&.Mui-disabled': {
      backgroundColor: 'rgba(33, 89, 136, 0.45)',
      color: '#ffffff',
    },
  },
  outlined: {
    backgroundColor: '#ffffff',
    color: '#0F172A',
    border: '1px solid #CBD5E1',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
    '&:hover': {
      backgroundColor: '#F8FAFC',
      borderColor: '#94A3B8',
      color: '#0F172A',
    },
    '&:active': {
      backgroundColor: '#F1F5F9',
    },
    '&.Mui-disabled': {
      borderColor: '#E2E8F0',
      color: '#94A3B8',
    },
  },
  ghost: {
    backgroundColor: 'transparent',
    color: '#475569',
    border: '1px solid transparent',
    '&:hover': {
      backgroundColor: '#F1F5F9',
      color: '#0F172A',
    },
    '&:active': {
      backgroundColor: '#E2E8F0',
    },
    '&.Mui-disabled': {
      color: '#94A3B8',
    },
  },
  danger: {
    backgroundColor: '#DC2626',
    color: '#ffffff',
    border: '1px solid transparent',
    boxShadow: '0 1px 2px rgba(220, 38, 38, 0.2)',
    '&:hover': {
      backgroundColor: '#B91C1C',
      boxShadow: '0 2px 4px rgba(185, 28, 28, 0.25)',
    },
    '&:active': {
      backgroundColor: '#991B1B',
    },
    '&.Mui-disabled': {
      backgroundColor: 'rgba(220, 38, 38, 0.45)',
      color: '#ffffff',
    },
  },
  success: {
    backgroundColor: '#059669',
    color: '#ffffff',
    border: '1px solid transparent',
    boxShadow: '0 1px 2px rgba(5, 150, 105, 0.2)',
    '&:hover': {
      backgroundColor: '#047857',
      boxShadow: '0 2px 4px rgba(4, 120, 87, 0.25)',
    },
    '&:active': {
      backgroundColor: '#065F46',
    },
    '&.Mui-disabled': {
      backgroundColor: 'rgba(5, 150, 105, 0.45)',
      color: '#ffffff',
    },
  },
};

const SIZE_STYLES: Record<'small' | 'medium' | 'large', any> = {
  small: {
    height: 32,
    padding: '4px 12px',
    fontSize: '0.8125rem',
    borderRadius: '6px',
    gap: '6px',
  },
  medium: {
    height: 38,
    padding: '6px 16px',
    fontSize: '0.875rem',
    borderRadius: '8px',
    gap: '8px',
  },
  large: {
    height: 44,
    padding: '10px 22px',
    fontSize: '0.9375rem',
    borderRadius: '8px',
    gap: '10px',
  },
};

/**
 * Standard reusable enterprise button component across DSA CRM.
 * Enforces unified heights, paddings, fonts, border radii, brand colors,
 * router navigation, and accessible loading state.
 */
export const AppButton = React.forwardRef<HTMLButtonElement, AppButtonProps>(
  (
    {
      variant = 'primary',
      size = 'medium',
      loading = false,
      loadingText,
      icon,
      startIcon,
      endIcon,
      to,
      disabled = false,
      children,
      dataTestId,
      sx,
      ...rest
    },
    ref,
  ) => {
    const spinnerSize = size === 'small' ? 14 : size === 'large' ? 20 : 16;
    const effectiveStartIcon = loading ? (
      <CircularProgress size={spinnerSize} color="inherit" thickness={4} />
    ) : (
      icon || startIcon
    );

    const routerProps = to
      ? {
          component: RouterLink,
          to,
        }
      : {};

    return (
      <MuiButton
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading}
        startIcon={effectiveStartIcon}
        endIcon={endIcon}
        data-testid={dataTestId}
        {...routerProps}
        {...rest}
        sx={{
          textTransform: 'none',
          fontWeight: 600,
          letterSpacing: 0,
          whiteSpace: 'nowrap',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.15s ease-in-out',
          ...SIZE_STYLES[size],
          ...VARIANT_STYLES[variant],
          ...sx,
        }}
      >
        {loading && loadingText ? loadingText : children}
      </MuiButton>
    );
  },
);

AppButton.displayName = 'AppButton';
