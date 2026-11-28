// Small layout pieces shared by the loan-file sections (owner: Bhushan, 2026-11-28).
import { Box, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

/** A titled, bordered section with an optional action on the right. */
export function Section({
  title,
  action,
  children,
  testId,
  fill = false,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
  /** Stretch to the height of its grid row, so the cards of a row line up. */
  fill?: boolean;
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
        ...(fill ? { height: '100%', display: 'flex', flexDirection: 'column' } : {}),
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

/** One headline figure of the file, the same size as its neighbours: a label, the figure, a line under it, and a link. */
export function Tile({
  label,
  value,
  sub,
  action,
  children,
  testId,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
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
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}
      >
        {label}
      </Typography>
      <Typography component="div" sx={{ fontSize: 22, fontWeight: 700, lineHeight: 1.3, mt: 0.5 }} noWrap>
        {value}
      </Typography>
      {sub && (
        <Typography variant="body2" color="text.secondary" component="div" sx={{ mt: 0.25 }}>
          {sub}
        </Typography>
      )}
      {children}
      {action && <Box sx={{ mt: 'auto', pt: 1.5 }}>{action}</Box>}
    </Box>
  );
}
