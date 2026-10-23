import { Box, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import React from 'react';

export type DateRangeScope = 'today' | 'week' | 'month' | 'quarter' | 'all';

export interface DashboardDateFilterProps {
  value: DateRangeScope;
  onChange: (scope: DateRangeScope) => void;
  dataTestId?: string;
}

export function DashboardDateFilter({
  value,
  onChange,
  dataTestId = 'dashboard-date-filter',
}: DashboardDateFilterProps) {
  const handleChange = (
    _event: React.MouseEvent<HTMLElement>,
    newValue: DateRangeScope | null,
  ) => {
    if (newValue !== null) {
      onChange(newValue);
    }
  };

  return (
    <Box data-testid={dataTestId} sx={{ display: 'inline-flex', alignItems: 'center' }}>
      <ToggleButtonGroup
        value={value}
        exclusive
        onChange={handleChange}
        size="small"
        aria-label="dashboard date range"
        sx={{
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          p: 0.25,
          '& .MuiToggleButton-root': {
            px: { xs: 1, sm: 1.5 },
            py: 0.4,
            fontSize: 12,
            textTransform: 'none',
            fontWeight: 500,
            borderRadius: 1.5,
            border: 0,
            color: 'text.secondary',
            '&.Mui-selected': {
              fontWeight: 700,
              bgcolor: 'action.selected',
              color: 'primary.main',
            },
          },
        }}
      >
        <ToggleButton value="today" aria-label="today">
          Today
        </ToggleButton>
        <ToggleButton value="week" aria-label="this week">
          This Week
        </ToggleButton>
        <ToggleButton value="month" aria-label="this month">
          This Month
        </ToggleButton>
        <ToggleButton value="quarter" aria-label="quarter">
          Quarter
        </ToggleButton>
        <ToggleButton value="all" aria-label="all time">
          All
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );
}
