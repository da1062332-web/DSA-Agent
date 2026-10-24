import React from 'react';
import { Box, Breadcrumbs, Button, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { ArrowBackIcon } from '../../shell/icons';

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  backTo?: string;
  dataTestId?: string;
}

export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  badge,
  actions,
  backTo,
  dataTestId,
}: PageHeaderProps) {
  return (
    <Box sx={{ mb: 3 }} data-testid={dataTestId}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumbs aria-label="breadcrumb" sx={{ mb: 1.5, fontSize: '0.8125rem' }}>
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return isLast || !crumb.to ? (
              <Typography key={idx} color="text.primary" sx={{ fontSize: 'inherit', fontWeight: 600 }}>
                {crumb.label}
              </Typography>
            ) : (
              <Link
                key={idx}
                component={RouterLink}
                to={crumb.to}
                color="inherit"
                underline="hover"
                sx={{ fontSize: 'inherit', color: 'text.secondary', '&:hover': { color: 'info.main' } }}
              >
                {crumb.label}
              </Link>
            );
          })}
        </Breadcrumbs>
      )}

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={2}
      >
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            {backTo && (
              <Button
                component={RouterLink}
                to={backTo}
                size="small"
                variant="outlined"
                color="inherit"
                startIcon={<ArrowBackIcon fontSize="small" />}
                sx={{
                  minWidth: 'auto',
                  px: 1.25,
                  py: 0.4,
                  fontSize: '0.75rem',
                  borderRadius: 1.5,
                  borderColor: 'divider',
                }}
              >
                Back
              </Button>
            )}
            {typeof title === 'string' ? (
              <Typography
                variant="h4"
                component="h1"
                fontWeight={700}
                sx={{ letterSpacing: '-0.02em', color: 'text.primary', lineHeight: 1.25 }}
              >
                {title}
              </Typography>
            ) : (
              title
            )}
            {badge}
          </Stack>

          {subtitle && (
            <Typography
              component="div"
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.75, maxWidth: 840 }}
            >
              {subtitle}
            </Typography>
          )}
        </Box>

        {actions && (
          <Stack direction="row" spacing={1.5} alignItems="center" flexShrink={0} flexWrap="wrap">
            {actions}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
