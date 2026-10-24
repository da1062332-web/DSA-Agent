import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Divider,
  Stack,
  Typography,
  type SxProps,
  type Theme,
} from '@mui/material';

export interface AppCardProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  divider?: boolean;
  padding?: 'normal' | 'dense' | 'none';
  footer?: React.ReactNode;
  children: React.ReactNode;
  dataTestId?: string;
  sx?: SxProps<Theme>;
}

const PADDING_STYLES = {
  normal: { p: { xs: 2, sm: 2.5 } },
  dense: { p: 1.5 },
  none: { p: 0 },
};

/**
 * Standard reusable enterprise section/panel Card component across DSA CRM.
 * Unifies card borders, shadows, headers, action alignment, and body paddings.
 */
export function AppCard({
  title,
  subtitle,
  icon,
  badge,
  actions,
  divider = false,
  padding = 'normal',
  footer,
  children,
  dataTestId,
  sx,
}: AppCardProps) {
  const hasHeader = Boolean(title || subtitle || icon || badge || actions);

  return (
    <Card
      data-testid={dataTestId}
      sx={{
        borderRadius: 3,
        border: '1px solid #E2E8F0',
        backgroundColor: '#FFFFFF',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px 0 rgba(0, 0, 0, 0.02)',
        mb: 3,
        overflow: 'hidden',
        ...sx,
      }}
    >
      {hasHeader && (
        <Box
          sx={{
            px: { xs: 2, sm: 2.5 },
            py: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1.5,
            backgroundColor: '#FFFFFF',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
            {icon && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'primary.main',
                  fontSize: 22,
                }}
              >
                {icon}
              </Box>
            )}
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                {typeof title === 'string' ? (
                  <Typography
                    variant="h6"
                    sx={{
                      fontSize: '1rem',
                      fontWeight: 700,
                      color: '#0F172A',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {title}
                  </Typography>
                ) : (
                  title
                )}
                {badge}
              </Stack>
              {subtitle && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, fontSize: '0.8125rem' }}>
                  {subtitle}
                </Typography>
              )}
            </Box>
          </Box>

          {actions && (
            <Stack direction="row" spacing={1} alignItems="center">
              {actions}
            </Stack>
          )}
        </Box>
      )}

      {hasHeader && (divider || padding === 'none') && <Divider sx={{ borderColor: '#E2E8F0' }} />}

      <CardContent sx={{ ...PADDING_STYLES[padding], '&:last-child': { pb: padding === 'none' ? 0 : undefined } }}>
        {children}
      </CardContent>

      {footer && (
        <>
          <Divider sx={{ borderColor: '#E2E8F0' }} />
          <Box
            sx={{
              px: { xs: 2, sm: 2.5 },
              py: 1.5,
              backgroundColor: '#F8FAFC',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 1.5,
            }}
          >
            {footer}
          </Box>
        </>
      )}
    </Card>
  );
}
