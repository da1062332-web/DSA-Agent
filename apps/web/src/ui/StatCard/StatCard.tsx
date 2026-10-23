import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Chip,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { TrendingUpIcon, TrendingDownIcon } from '../../shell/icons';

export interface StatCardProps {
  title: string;
  value: string | number | null | undefined;
  subtitle?: string;
  subtext?: string;
  format?: 'currency' | 'percent' | 'number' | 'raw';
  trend?: {
    value: number;
    label?: string;
  };
  status?: 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'error' | 'default';
  colorVariant?: 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'error' | 'default';
  icon?: React.ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  to?: string;
  onClick?: () => void;
  dataTestId?: string;
}

function formatValue(value: string | number | null | undefined, format: StatCardProps['format']): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  switch (format) {
    case 'currency':
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
      }).format(value);
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'number':
      return new Intl.NumberFormat('en-IN').format(value);
    case 'raw':
    default:
      return String(value);
  }
}

export function StatCard({
  title,
  value,
  subtitle,
  subtext,
  format = 'raw',
  trend,
  status = 'primary',
  colorVariant,
  icon,
  isLoading = false,
  isError = false,
  to,
  onClick,
  dataTestId,
}: StatCardProps) {
  const isClickable = Boolean(to || onClick);
  const effectiveStatus = colorVariant ?? status;
  const effectiveSubtitle = subtext ?? subtitle;

  return (
    <Card
      data-testid={dataTestId}
      component={to ? RouterLink : 'div'}
      to={to}
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      sx={{
        borderRadius: 2.5,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04)',
        textDecoration: 'none',
        color: 'inherit',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        ...(isClickable && {
          cursor: 'pointer',
          '&:hover': {
            borderColor: '#B8D5E7',
            boxShadow: '0 4px 14px -2px rgba(33, 89, 136, 0.08)',
            transform: 'translateY(-1px)',
          },
        }),
      }}
    >
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            fontWeight={700}
            textTransform="uppercase"
            letterSpacing={0.5}
          >
            {title}
          </Typography>
          {icon && (
            <Box
              sx={{
                width: 38,
                height: 38,
                borderRadius: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: () => {
                  if (effectiveStatus === 'success') return '#ECFDF5';
                  if (effectiveStatus === 'warning') return '#FFF7ED';
                  if (effectiveStatus === 'error') return '#FFF1EC';
                  if (effectiveStatus === 'info') return '#EBF4F9';
                  if (effectiveStatus === 'secondary') return '#FFF1EC';
                  return '#FFF7ED';
                },
                color: () => {
                  if (effectiveStatus === 'success') return '#059669';
                  if (effectiveStatus === 'warning') return '#F89344';
                  if (effectiveStatus === 'error') return '#FF642F';
                  if (effectiveStatus === 'info') return '#215988';
                  if (effectiveStatus === 'secondary') return '#FF642F';
                  return '#F89344';
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
            <Skeleton variant="text" width="60%" height={38} />
            <Skeleton variant="text" width="40%" height={20} />
          </Box>
        ) : isError ? (
          <Typography variant="body2" color="error.main" sx={{ my: 1, fontWeight: 600 }}>
            Failed to load
          </Typography>
        ) : (
          <Typography
            variant="h4"
            fontWeight={800}
            color="text.primary"
            sx={{ letterSpacing: '-0.02em', my: 0.5, lineHeight: 1.2 }}
          >
            {formatValue(value, format)}
          </Typography>
        )}

        {(effectiveSubtitle || trend) && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            {trend && (
              <Chip
                icon={
                  trend.value >= 0 ? (
                    <TrendingUpIcon sx={{ fontSize: '14px !important', color: '#059669 !important' }} />
                  ) : (
                    <TrendingDownIcon sx={{ fontSize: '14px !important', color: '#FF642F !important' }} />
                  )
                }
                label={`${trend.value >= 0 ? '+' : ''}${trend.value}%${trend.label ? ` ${trend.label}` : ''}`}
                size="small"
                sx={{
                  height: 20,
                  fontSize: 11,
                  fontWeight: 700,
                  bgcolor: trend.value >= 0 ? '#ECFDF5' : '#FFF1EC',
                  color: trend.value >= 0 ? '#059669' : '#FF642F',
                  border: '1px solid',
                  borderColor: trend.value >= 0 ? '#A7F3D0' : '#FECDD3',
                }}
              />
            )}
            {effectiveSubtitle && (
              <Typography variant="caption" color="text.secondary">
                {effectiveSubtitle}
              </Typography>
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
