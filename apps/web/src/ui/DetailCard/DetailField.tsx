import React from 'react';
import { Box, Typography } from '@mui/material';
import { NotSet } from '../NotSet';

export interface DetailFieldProps {
  label: string;
  value: React.ReactNode;
  fallback?: React.ReactNode;
  copyable?: boolean;
}

export function DetailField({ label, value, fallback = <NotSet /> }: DetailFieldProps) {
  const displayValue = value === null || value === undefined || value === '' ? fallback : value;

  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        fontWeight={600}
        textTransform="uppercase"
        letterSpacing={0.5}
        display="block"
        gutterBottom
      >
        {label}
      </Typography>
      <Box sx={{ fontSize: '0.875rem', fontWeight: 600, color: 'text.primary', wordBreak: 'break-word' }}>
        {displayValue}
      </Box>
    </Box>
  );
}
