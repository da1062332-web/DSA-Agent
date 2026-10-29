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
import { NotSet } from '../../../ui/NotSet';

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
): React.ReactNode {
  if (value === null || value === undefined) return <NotSet />;
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
    <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 }, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <Box>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={700} textTransform="uppercase" letterSpacing={0.5}>
            {title}
          </Typography>
          {icon && (
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: 1.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: () => {
                  if (status === 'success') return '#F0FDF4';
                  if (status === 'warning') return '#FFFBEB';
                  if (status === 'error') return '#FEF2F2';
                  return '#EEF4FA'; // info / primary
                },
                color: () => {
                  if (status === 'success') return '#15803D';
                  if (status === 'warning') return '#D97706';
                  if (status === 'error') return '#DC2626';
                  return '#215988'; // info / primary
                },
                '& svg': { fontSize: 20 },
              }}
            >
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
          <Typography variant="body2" color="error.main" sx={{ my: 1, fontWeight: 600 }}>
            Failed to load metric
          </Typography>
        ) : isUnavailable ? (
          <Box sx={{ my: 1 }}>
            <Chip
              label={unavailableMessage ?? 'Data Unavailable'}
              size="small"
              variant="outlined"
              color="default"
              sx={{ fontSize: 11, fontWeight: 600, bgcolor: 'action.hover' }}
            />
          </Box>
        ) : (
          <Typography
            variant="h4"
            fontWeight={700}
            color="text.primary"
            sx={{
              my: 0.5,
              fontSize: { xs: '1.6rem', sm: '1.85rem', md: '2.1rem' },
              letterSpacing: '-0.025em',
              lineHeight: 1.2,
            }}
          >
            {formatMetricValue(value, format)}
          </Typography>
        )}
      </Box>

      {(subtitle || trend) && !isLoading && !isError && (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', gap: 0.5 }}>
          {trend && (
            <Chip
              size="small"
              label={`${trend.isPositive !== false ? '+' : ''}${trend.value}%`}
              color={trend.isPositive !== false ? 'success' : 'error'}
              sx={{ height: 20, fontSize: 11, fontWeight: 700, px: 0.5 }}
            />
          )}
          {subtitle && (
            <Typography variant="caption" color="text.secondary" fontWeight={500}>
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
        borderRadius: 2.5,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px 0 rgba(0, 0, 0, 0.02)',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        ...(isClickable && {
          cursor: 'pointer',
          '&:hover': {
            borderColor: `${status}.main`,
            boxShadow: '0 6px 16px -2px rgba(0, 0, 0, 0.08), 0 2px 6px -1px rgba(0, 0, 0, 0.04)',
            transform: 'translateY(-2px)',
          },
        }),
      }}
    >
      {cardContent}
    </Card>
  );
}
