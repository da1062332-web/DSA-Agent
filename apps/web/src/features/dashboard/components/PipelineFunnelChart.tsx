import {
  Box,
  Card,
  CardContent,
  Chip,
  LinearProgress,
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
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        boxShadow: 'none',
      }}
    >
      <CardContent sx={{ p: 3 }}>
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" fontWeight={700} gutterBottom>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>

        {isLoading ? (
          <Stack spacing={2.5}>
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
              py: 6,
              textAlign: 'center',
              bgcolor: 'action.hover',
              borderRadius: 1.5,
              border: '1px dashed',
              borderColor: 'divider',
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {emptyMessage}
            </Typography>
          </Box>
        ) : (
          <Stack spacing={2.5}>
            {stages.map((stage, idx) => {
              const conversionPercent =
                stages[0] && stages[0].count > 0
                  ? Math.round((stage.count / stages[0].count) * 100)
                  : 0;

              const stagePercentageOfTop = Math.min(
                100,
                Math.max(8, (stage.count / topStageCount) * 100),
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
                    borderRadius: 1.5,
                    p: 1,
                    transition: 'all 0.15s ease',
                    ...(isClickable && {
                      cursor: 'pointer',
                      '&:hover': {
                        bgcolor: 'action.hover',
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
                          sx={{ height: 18, fontSize: 10, fontWeight: 600 }}
                        />
                      )}
                    </Stack>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Typography variant="body2" fontWeight={700}>
                        {stage.count}
                      </Typography>
                      {stage.amount !== undefined && (
                        <Typography variant="caption" color="text.secondary">
                          ({formatIndianCurrency(stage.amount)})
                        </Typography>
                      )}
                    </Stack>
                  </Stack>

                  {/* Funnel Progress Bar */}
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
                        transition: 'width 0.5s ease-in-out',
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
