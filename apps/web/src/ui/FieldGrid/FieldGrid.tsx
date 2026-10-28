import { Box } from '@mui/material';
import type { ReactNode } from 'react';

interface FieldGridProps {
  children: ReactNode;
  /** Narrowest a column may get before the grid wraps to fewer columns. */
  minColumnWidth?: number;
  /**
   * Form layouts: fields take one cell each, and any other child (text, button row, alert) spans the full width.
   * Leave it off for label/value strips, where every child is one cell.
   */
  spanNonFields?: boolean;
  dataTestId?: string;
}

/**
 * Responsive grid that fills its container. Columns grow to fill the width and wrap as the container narrows,
 * so forms and detail strips never leave dead space on wide screens.
 */
export function FieldGrid({ children, minColumnWidth = 240, spanNonFields = false, dataTestId }: FieldGridProps) {
  return (
    <Box
      data-testid={dataTestId}
      sx={{
        display: 'grid',
        gap: 2,
        alignItems: 'start',
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minColumnWidth}px), 1fr))`,
        ...(spanNonFields && { '& > :not(.MuiFormControl-root)': { gridColumn: '1 / -1' } }),
      }}
    >
      {children}
    </Box>
  );
}

/** A row of action buttons inside a FieldGrid. It spans the full width and sits on the right. */
export function FieldGridActions({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1 }}>
      {children}
    </Box>
  );
}
