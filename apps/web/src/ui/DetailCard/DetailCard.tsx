import React from 'react';
import { Box, Card, CardContent, Divider, Stack, Typography } from '@mui/material';

export interface DetailCardProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
  dataTestId?: string;
}

export function DetailCard({
  title,
  subtitle,
  actions,
  badge,
  children,
  dataTestId,
}: DetailCardProps) {
  const hasHeader = Boolean(title || actions || badge);

  return (
    <Card
      data-testid={dataTestId}
      sx={{
        borderRadius: '10px',
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        boxShadow: 'none',
        mb: 3,
        overflow: 'hidden',
      }}
    >
      {hasHeader && (
        <>
          <Box sx={{ px: 2.5, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Stack direction="row" spacing={1.5} alignItems="center">
                {typeof title === 'string' ? (
                  <Typography variant="h6" fontWeight={600} sx={{ letterSpacing: '-0.01em' }}>
                    {title}
                  </Typography>
                ) : (
                  title
                )}
                {badge}
              </Stack>
              {subtitle && (
                <Typography variant="caption" color="text.secondary">
                  {subtitle}
                </Typography>
              )}
            </Box>
            {actions && (
              <Stack direction="row" spacing={1} alignItems="center">
                {actions}
              </Stack>
            )}
          </Box>
          <Divider />
        </>
      )}
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>{children}</CardContent>
    </Card>
  );
}
