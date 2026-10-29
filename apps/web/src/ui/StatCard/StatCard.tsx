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
import { NotSet } from '../NotSet';

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

function formatValue(value: string | number | null | undefined, format: StatCardProps['format']): React.ReactNode {
  if (value === null || value === undefined) return <NotSet />;
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
        borderRadius: '10px',
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        boxShadow: 'none',
        textDecoration: 'none',
        color: 'inherit',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        ...(isClickable && {
          cursor: 'pointer',
          '&:hover': {
            borderColor: '#B8D5E7',
            boxShadow: '0 2px 8px -2px rgba(33, 89, 136, 0.12)',
          },
        }),
      }}
    >
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            fontWeight={600}
            textTransform="uppercase"
            letterSpacing={0.6}
          >
            {title}
          </Typography>
          {icon && (
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: () => {
                  if (effectiveStatus === 'success') return '#F0FDF4';
                  if (effectiveStatus === 'warning') return '#FFFBEB';
                  if (effectiveStatus === 'error') return '#FEF2F2';
                  if (effectiveStatus === 'default' || effectiveStatus === 'secondary') return '#F1F5F9';
                  return '#EEF4FA'; // primary / info
                },
                color: () => {
                  if (effectiveStatus === 'success') return '#15803D';
                  if (effectiveStatus === 'warning') return '#D97706';
                  if (effectiveStatus === 'error') return '#DC2626';
                  if (effectiveStatus === 'default' || effectiveStatus === 'secondary') return '#475569';
                  return '#215988'; // primary / info
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
            fontWeight={600}
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
                    <TrendingUpIcon sx={{ fontSize: '14px !important', color: '#15803D !important' }} />
                  ) : (
                    <TrendingDownIcon sx={{ fontSize: '14px !important', color: '#DC2626 !important' }} />
                  )
                }
                label={`${trend.value >= 0 ? '+' : ''}${trend.value}%${trend.label ? ` ${trend.label}` : ''}`}
                size="small"
                sx={{
                  height: 20,
                  fontSize: 11,
                  fontWeight: 700,
                  bgcolor: trend.value >= 0 ? '#F0FDF4' : '#FEF2F2',
                  color: trend.value >= 0 ? '#15803D' : '#DC2626',
                  border: '1px solid',
                  borderColor: trend.value >= 0 ? '#BBF7D0' : '#FECACA',
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
