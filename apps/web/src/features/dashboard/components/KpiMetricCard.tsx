import {
  Box,
  Card,
  CardContent,
  Chip,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import { Link as RouterLink } from 'react-router-dom';

export interface KpiMetricCardProps {
  title: string;
  value?: number | string | null;
  format?: 'currency' | 'percent' | 'number' | 'raw';
  subtitle?: string;
  trend?: {
    value: number;
    isPositive?: boolean;
    periodLabel?: string;
  };
  status?: 'success' | 'warning' | 'error' | 'info' | 'primary';
  icon?: React.ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  unavailableMessage?: string;
  to?: string;
  onClick?: () => void;
  dataTestId?: string;
}

export function formatIndianCurrency(amount: number): string {
  if (Math.abs(amount) >= 10000000) {
    return `₹${(amount / 10000000).toFixed(2)} Cr`;
  }
  if (Math.abs(amount) >= 100000) {
    return `₹${(amount / 100000).toFixed(2)} L`;
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatMetricValue(
  value: number | string | null | undefined,
  format: KpiMetricCardProps['format'] = 'raw',
): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  switch (format) {
    case 'currency':
      return formatIndianCurrency(value);
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'number':
      return new Intl.NumberFormat('en-IN').format(value);
    case 'raw':
    default:
      return String(value);
  }
}

export function KpiMetricCard({
  title,
  value,
  format = 'raw',
  subtitle,
  trend,
  status = 'primary',
  icon,
  isLoading = false,
  isError = false,
  unavailableMessage,
  to,
  onClick,
  dataTestId,
}: KpiMetricCardProps) {
  const isClickable = Boolean(to || onClick);
  const isUnavailable = (value === null || value === undefined) && !isLoading && !isError;

  const cardContent = (
    <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1} sx={{ mb: 1.5 }}>
        <Typography variant="caption" color="text.secondary" fontWeight={600} textTransform="uppercase" letterSpacing={0.5}>
          {title}
        </Typography>
        {icon && (
          <Box sx={{ color: `${status}.main`, display: 'flex', alignItems: 'center' }}>
            {icon}
          </Box>
        )}
      </Stack>

      {isLoading ? (
        <Box sx={{ my: 1 }}>
          <Skeleton variant="text" width="60%" height={40} />
          <Skeleton variant="text" width="40%" height={20} />
        </Box>
      ) : isError ? (
        <Typography variant="body2" color="error.main" sx={{ my: 1 }}>
          Failed to load metric
        </Typography>
      ) : isUnavailable ? (
        <Box sx={{ my: 1 }}>
          <Chip
            label={unavailableMessage ?? 'Data Unavailable'}
            size="small"
            variant="outlined"
            color="default"
            sx={{ fontSize: 11, fontWeight: 500 }}
          />
        </Box>
      ) : (
        <Typography
          variant="h4"
          fontWeight={700}
          color="text.primary"
          sx={{
            my: 0.5,
            fontSize: { xs: '1.5rem', sm: '1.75rem', md: '2rem' },
            letterSpacing: '-0.02em',
          }}
        >
          {formatMetricValue(value, format)}
        </Typography>
      )}

      {(subtitle || trend) && !isLoading && !isError && (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
          {trend && (
            <Chip
              size="small"
              label={`${trend.isPositive !== false ? '+' : ''}${trend.value}%`}
              color={trend.isPositive !== false ? 'success' : 'error'}
              sx={{ height: 20, fontSize: 11, fontWeight: 600, px: 0.5 }}
            />
          )}
          {subtitle && (
            <Typography variant="caption" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Stack>
      )}
    </CardContent>
  );

  return (
    <Card
      data-testid={dataTestId}
      component={to ? RouterLink : 'div'}
      to={to}
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        boxShadow: 'none',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'all 0.2s ease-in-out',
        ...(isClickable && {
          cursor: 'pointer',
          '&:hover': {
            borderColor: `${status}.main`,
            boxShadow: 2,
            transform: 'translateY(-2px)',
          },
        }),
      }}
    >
      {cardContent}
    </Card>
  );
}
