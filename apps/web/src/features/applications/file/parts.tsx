// Small layout pieces shared by the loan-file sections (owner: Bhushan, 2026-11-28).
import { Box, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

/** A titled, bordered section with an optional action on the right. */
export function Section({
  title,
  action,
  children,
  testId,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Box
      data-testid={testId}
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: '12px',
        bgcolor: 'background.paper',
        p: 2.5,
        minWidth: 0,
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        {action}
      </Stack>
      {children}
    </Box>
  );
}

/** Label and value in two columns, the way a loan file's front sheet reads. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={2} sx={{ py: 0.75, borderBottom: 1, borderColor: 'grey.100' }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: 150, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ fontWeight: 600, minWidth: 0 }}>
        {children}
      </Typography>
    </Stack>
  );
}
