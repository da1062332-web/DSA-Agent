import React from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import { InboxIcon } from '../../shell/icons';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  compact?: boolean;
  dataTestId?: string;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  compact = false,
  dataTestId,
}: EmptyStateProps) {
  return (
    <Box
      data-testid={dataTestId}
      sx={{
        py: compact ? 4 : 6,
        px: 3,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Box
        sx={{
          width: compact ? 44 : 56,
          height: compact ? 44 : 56,
          borderRadius: '50%',
          bgcolor: 'action.hover',
          color: 'text.secondary',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mb: 2,
          '& svg': { fontSize: compact ? 24 : 30 },
        }}
      >
        {icon || <InboxIcon />}
      </Box>

      <Typography variant="subtitle1" fontWeight={700} color="text.primary" gutterBottom>
        {title}
      </Typography>

      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420, mb: action ? 2.5 : 0 }}>
          {description}
        </Typography>
      )}

      {action && <Box sx={{ mt: 1 }}>{action}</Box>}
    </Box>
  );
}
