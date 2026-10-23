import React from 'react';
import { Grid } from '@mui/material';

export interface StatCardGridProps {
  children: React.ReactNode;
  columns?: { xs?: number; sm?: number; md?: number; lg?: number };
}

export function StatCardGrid({ children, columns = { xs: 12, sm: 6, md: 3 } }: StatCardGridProps) {
  const items = React.Children.toArray(children);

  return (
    <Grid container spacing={2} sx={{ mb: 3 }}>
      {items.map((item, idx) => (
        <Grid item key={idx} xs={columns.xs ?? 12} sm={columns.sm ?? 6} md={columns.md ?? 3} lg={columns.lg}>
          {item}
        </Grid>
      ))}
    </Grid>
  );
}
