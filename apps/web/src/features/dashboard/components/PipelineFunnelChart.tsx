import {
  Box,
  Card,
  CardContent,
  Chip,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { formatIndianCurrency } from './KpiMetricCard';

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  amount?: number;
  color?: string;
  to?: string;
}

export interface PipelineFunnelChartProps {
  title?: string;
  subtitle?: string;
  stages: FunnelStage[];
  isLoading?: boolean;
  emptyMessage?: string;
  onStageClick?: (stage: FunnelStage) => void;
  dataTestId?: string;
}

export function PipelineFunnelChart({
  title = 'Pipeline Conversion Funnel',
  subtitle,
  stages,
  isLoading = false,
  emptyMessage = 'No pipeline activity recorded in this period',
  onStageClick,
  dataTestId,
}: PipelineFunnelChartProps) {
  const topStageCount = stages.length > 0 ? Math.max(stages[0]?.count ?? 0, 1) : 1;
  const totalCount = stages.reduce((sum, s) => sum + s.count, 0);

  return (
    <Card
      data-testid={dataTestId}
      sx={{
        height: '100%',
        borderRadius: 2.5,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px 0 rgba(0, 0, 0, 0.02)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <CardContent sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2.5 }}>
          <Box>
            <Typography variant="h6" fontWeight={700} gutterBottom sx={{ letterSpacing: '-0.01em' }}>
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="body2" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
          <Chip
            label={`${totalCount} Total Items`}
            size="small"
            variant="outlined"
            sx={{ fontWeight: 600, fontSize: 11, borderColor: 'divider' }}
          />
        </Stack>

        {isLoading ? (
          <Stack spacing={2.5} sx={{ my: 'auto' }}>
            {[1, 2, 3, 4].map((i) => (
              <Box key={i}>
                <Skeleton variant="text" width="40%" height={24} />
                <Skeleton variant="rounded" width="100%" height={28} sx={{ mt: 0.5 }} />
              </Box>
            ))}
          </Stack>
        ) : totalCount === 0 ? (
          <Box
            sx={{
              my: 'auto',
              py: 5,
              px: 2,
              textAlign: 'center',
              bgcolor: 'action.hover',
              borderRadius: 2,
              border: '1px dashed',
              borderColor: 'divider',
            }}
          >
            <Typography variant="body2" fontWeight={600} color="text.primary" gutterBottom>
              {emptyMessage}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Incoming files will automatically populate conversion stages.
            </Typography>
          </Box>
        ) : (
          <Stack spacing={2} sx={{ my: 'auto' }}>
            {stages.map((stage, idx) => {
              const conversionPercent =
                stages[0] && stages[0].count > 0
                  ? Math.round((stage.count / stages[0].count) * 100)
                  : 0;

              const stagePercentageOfTop = Math.min(
                100,
                Math.max(6, (stage.count / topStageCount) * 100),
              );

              const isClickable = Boolean(stage.to || onStageClick);

              return (
                <Box
                  key={stage.key}
                  component={stage.to ? RouterLink : 'div'}
                  to={stage.to}
                  onClick={() => onStageClick?.(stage)}
                  role={isClickable ? 'button' : undefined}
                  tabIndex={isClickable ? 0 : undefined}
                  sx={{
                    textDecoration: 'none',
                    color: 'inherit',
                    borderRadius: 2,
                    p: 1.25,
                    transition: 'all 0.15s ease',
                    border: '1px solid transparent',
                    ...(isClickable && {
                      cursor: 'pointer',
                      '&:hover': {
                        bgcolor: 'action.hover',
                        borderColor: 'divider',
                      },
                    }),
                  }}
                >
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.75 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" fontWeight={600} color="text.primary">
                        {stage.label}
                      </Typography>
                      {idx > 0 && (
                        <Chip
                          label={`${conversionPercent}%`}
                          size="small"
                          sx={{ height: 18, fontSize: 10, fontWeight: 700, bgcolor: 'action.selected' }}
                        />
                      )}
                    </Stack>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Typography variant="body2" fontWeight={800} color="text.primary">
                        {stage.count}
                      </Typography>
                      {stage.amount !== undefined && (
                        <Typography variant="caption" color="text.secondary" fontWeight={500}>
                          ({formatIndianCurrency(stage.amount)})
                        </Typography>
                      )}
                    </Stack>
                  </Stack>

                  {/* Funnel Progress Track */}
                  <Box
                    sx={{
                      width: '100%',
                      height: 10,
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                      overflow: 'hidden',
                    }}
                  >
                    <Box
                      sx={{
                        width: `${stagePercentageOfTop}%`,
                        height: '100%',
                        bgcolor: stage.color ?? 'primary.main',
                        borderRadius: 1,
                        transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                      }}
                    />
                  </Box>
                </Box>
              );
            })}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
