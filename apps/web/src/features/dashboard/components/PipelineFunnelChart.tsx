import {
  Box,
  Card,
  CardContent,
  Chip,
  Skeleton,
  Stack,
  Tooltip,
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
  /** "bars" lists each stage with a horizontal bar; "columns" draws the stages as vertical columns on a count axis. */
  variant?: 'bars' | 'columns';
}

const DEFAULT_STAGE_PALETTE = ['#3876BE', '#215988', '#64748B', '#16A34A', '#15803D'];

export function PipelineFunnelChart({
  title = 'Pipeline Conversion Funnel',
  subtitle,
  stages,
  isLoading = false,
  emptyMessage = 'No pipeline activity recorded in this period',
  onStageClick,
  dataTestId,
  variant = 'bars',
}: PipelineFunnelChartProps) {
  const peakStageCount = stages.length > 0 ? Math.max(...stages.map((s) => s.count), 1) : 1;
  const totalCount = stages.reduce((sum, s) => sum + s.count, 0);

  return (
    <Card
      data-testid={dataTestId}
      sx={{
        borderRadius: '10px',
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        boxShadow: 'none',
      }}
    >
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={600} sx={{ letterSpacing: '-0.01em', lineHeight: 1.3 }}>
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
          <Chip
            label={`${totalCount} Total Items`}
            size="small"
            variant="outlined"
            sx={{ fontWeight: 500, fontSize: 11, borderColor: 'divider', color: 'text.secondary' }}
          />
        </Stack>

        {isLoading ? (
          <Stack spacing={2}>
            {[1, 2, 3, 4].map((i) => (
              <Box key={i}>
                <Skeleton variant="text" width="40%" height={20} />
                <Skeleton variant="rounded" width="100%" height={16} sx={{ mt: 0.5 }} />
              </Box>
            ))}
          </Stack>
        ) : totalCount === 0 ? (
          <Box
            sx={{
              py: 4,
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
        ) : variant === 'columns' ? (
          <ColumnsVisual stages={stages} onStageClick={onStageClick} />
        ) : (
          <Stack spacing={1.5}>
            {stages.map((stage, idx) => {
              const firstCount = stages[0]?.count ?? 0;
              const referenceBase = firstCount > 0 ? firstCount : peakStageCount;
              const conversionPercent =
                referenceBase > 0 ? Math.round((stage.count / referenceBase) * 100) : 0;

              const stagePercentageOfPeak = Math.min(
                100,
                Math.max(stage.count > 0 ? 8 : 2, (stage.count / peakStageCount) * 100),
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
                    p: 1,
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
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" fontWeight={600} color="text.primary">
                        {stage.label}
                      </Typography>
                      {idx > 0 && stage.count > 0 && (
                        <Chip
                          label={`${conversionPercent}%`}
                          size="small"
                          sx={{
                            height: 18,
                            fontSize: 10,
                            fontWeight: 700,
                            bgcolor: 'rgba(56, 118, 190, 0.08)',
                            color: '#215988',
                          }}
                        />
                      )}
                    </Stack>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Typography variant="body2" fontWeight={700} color="text.primary">
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
                      height: 8,
                      bgcolor: '#f1f5f9',
                      borderRadius: 1,
                      overflow: 'hidden',
                    }}
                  >
                    <Box
                      sx={{
                        width: `${stagePercentageOfPeak}%`,
                        height: '100%',
                        bgcolor: stage.color ?? DEFAULT_STAGE_PALETTE[idx % DEFAULT_STAGE_PALETTE.length],
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

/** What the tooltip of a funnel band says: the stage, its count, and its conversion from the first and previous stage. */
function FunnelTooltip({ stage, index, stages }: { stage: FunnelStage; index: number; stages: FunnelStage[] }) {
  const first = stages[0]?.count ?? 0;
  const previous = index > 0 ? (stages[index - 1]?.count ?? 0) : null;
  const ofFirst = first > 0 ? Math.round((stage.count / first) * 100) : null;
  const fromPrevious = previous !== null && previous > 0 ? Math.round((stage.count / previous) * 100) : null;
  return (
    <Box sx={{ p: 0.5 }}>
      <Typography variant="body2" fontWeight={700}>
        {stage.label}
      </Typography>
      <Typography variant="caption" display="block">
        {stage.count} in this stage
      </Typography>
      {index > 0 && ofFirst !== null && (
        <Typography variant="caption" display="block">
          {ofFirst}% of {stages[0]?.label.toLowerCase()}
        </Typography>
      )}
      {index > 0 && fromPrevious !== null && (
        <Typography variant="caption" display="block">
          {fromPrevious}% from {stages[index - 1]?.label.toLowerCase()}
        </Typography>
      )}
    </Box>
  );
}

const PLOT_HEIGHT = 220;
const AXIS_WIDTH = 36;
const AXIS_INTERVALS = 4;

/** Step of a count axis with four intervals that always lands on whole numbers: 1, 2, 5, 10, 20, 50, 100 ... */
function axisStep(peak: number): number {
  for (let magnitude = 1; ; magnitude *= 10) {
    for (const multiple of [1, 2, 5]) {
      const step = multiple * magnitude;
      if (step * AXIS_INTERVALS >= peak) return step;
    }
  }
}

/** The stages as vertical columns on a count axis, with each stage's label and share of the first stage under its column. */
function ColumnsVisual({ stages, onStageClick }: { stages: FunnelStage[]; onStageClick?: (stage: FunnelStage) => void }) {
  const count = stages.length;
  const peak = Math.max(...stages.map((s) => s.count), 1);
  const step = axisStep(peak);
  const axisMax = step * AXIS_INTERVALS;
  const ticks = Array.from({ length: AXIS_INTERVALS + 1 }, (_, i) => i * step);
  const first = stages[0]?.count ?? 0;
  const last = stages[count - 1]?.count ?? 0;
  const columns = `repeat(${count}, minmax(0, 1fr))`;

  return (
    <Box data-testid="pipeline-funnel">
      <Box sx={{ display: 'flex', mt: 3 }}>
        <Box aria-hidden sx={{ position: 'relative', width: AXIS_WIDTH, height: PLOT_HEIGHT, flexShrink: 0 }}>
          {ticks.map((tick) => (
            <Typography
              key={tick}
              variant="caption"
              sx={{
                position: 'absolute',
                right: 8,
                bottom: `${(tick / axisMax) * 100}%`,
                transform: 'translateY(50%)',
                lineHeight: 1,
                color: 'text.secondary',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {new Intl.NumberFormat('en-IN').format(tick)}
            </Typography>
          ))}
        </Box>

        <Box sx={{ position: 'relative', flex: 1, height: PLOT_HEIGHT, borderBottom: '1px solid', borderColor: 'grey.400' }}>
          {ticks.slice(1).map((tick) => (
            <Box
              key={tick}
              aria-hidden
              sx={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: `${(tick / axisMax) * 100}%`,
                borderTop: '1px dashed',
                borderColor: 'grey.200',
              }}
            />
          ))}
          <Box sx={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: columns }}>
            {stages.map((stage) => {
              const height = (stage.count / axisMax) * 100;
              return (
                <Tooltip
                  key={stage.key}
                  arrow
                  placement="top"
                  title={<FunnelTooltip stage={stage} index={stages.indexOf(stage)} stages={stages} />}
                >
                  <Box sx={{ position: 'relative', '&:hover .stage-bar': { bgcolor: 'primary.dark' } }}>
                    <Typography
                      sx={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: `calc(${height}% + 6px)`,
                        textAlign: 'center',
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        lineHeight: 1.2,
                      }}
                    >
                      {stage.count}
                    </Typography>
                    <Box
                      className="stage-bar"
                      sx={{
                        position: 'absolute',
                        bottom: 0,
                        left: '50%',
                        width: '56%',
                        maxWidth: 72,
                        height: `${height}%`,
                        transform: 'translateX(-50%)',
                        bgcolor: 'primary.main',
                        borderRadius: '4px 4px 0 0',
                        transition: 'height 0.4s ease, background-color 0.15s ease',
                      }}
                    />
                  </Box>
                </Tooltip>
              );
            })}
          </Box>
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: columns, ml: `${AXIS_WIDTH}px`, mt: 1.5 }}>
        {stages.map((stage, i) => {
          const share = first > 0 ? Math.round((stage.count / first) * 100) : null;
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
                textAlign: 'center',
                p: 0.5,
                borderRadius: 1,
                ...(isClickable && { cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }),
              }}
            >
              <Typography variant="body2" fontWeight={600} color="text.primary">
                {stage.label}
              </Typography>
              {i > 0 && share !== null && (
                <Typography variant="caption" color="text.secondary">
                  {share}% of {stages[0]?.label.toLowerCase()}
                </Typography>
              )}
            </Box>
          );
        })}
      </Box>

      <Stack direction="row" justifyContent="center" spacing={3} sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary">
          Overall conversion:{' '}
          <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
            {first > 0 ? `${Math.round((last / first) * 100)}%` : '—'}
          </Box>{' '}
          from {stages[0]?.label.toLowerCase()} to {stages[count - 1]?.label.toLowerCase()}
        </Typography>
      </Stack>
    </Box>
  );
}
