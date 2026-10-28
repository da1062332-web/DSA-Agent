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
  /** "bars" lists each stage with a bar; "funnel" draws the stages as one tapering funnel. */
  variant?: 'bars' | 'funnel';
}

const DEFAULT_STAGE_PALETTE = [
  '#3876BE', // BG/500 Ocean Blue
  '#215988', // BG/700 Deep Blue
  '#FF642F', // Secondary Coral
  '#F89344', // Primary Tangerine
  '#059669', // Emerald
];

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
        borderRadius: 2.5,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px 0 rgba(0, 0, 0, 0.02)',
      }}
    >
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={700} sx={{ letterSpacing: '-0.01em', lineHeight: 1.3 }}>
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
            sx={{ fontWeight: 600, fontSize: 11, borderColor: 'divider' }}
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
        ) : variant === 'funnel' ? (
          <FunnelVisual stages={stages} onStageClick={onStageClick} />
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

/** Height of a stage band as a share of the drawing: a stage with no items still shows as a thin band. */
const MIN_BAND_SHARE = 0.08;
/** Drawing units: the SVG keeps these proportions and stretches to the card width. */
const DRAW_WIDTH = 1000;
const DRAW_HEIGHT = 100;
const BAND_GAP = 6;

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

/** The stages as one horizontal funnel, with each stage's label and count under its band. */
function FunnelVisual({ stages, onStageClick }: { stages: FunnelStage[]; onStageClick?: (stage: FunnelStage) => void }) {
  const count = stages.length;
  const peak = Math.max(...stages.map((s) => s.count), 1);
  const shares = stages.map((s) => Math.max(MIN_BAND_SHARE, s.count / peak));
  // The funnel edge at each boundary: the bands meet halfway between neighbouring stages.
  const edges = shares.map((share, i) => (i === 0 ? share : ((shares[i - 1] ?? 0) + share) / 2));
  edges.push(shares[count - 1] ?? MIN_BAND_SHARE);
  const segmentWidth = DRAW_WIDTH / count;
  const first = stages[0]?.count ?? 0;
  const last = stages[count - 1]?.count ?? 0;

  return (
    <Box data-testid="pipeline-funnel">
      <Box
        component="svg"
        viewBox={`0 0 ${DRAW_WIDTH} ${DRAW_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Funnel of stages"
        sx={{
          width: '100%',
          height: 200,
          display: 'block',
          '& polygon': { cursor: 'pointer', transition: 'opacity 0.15s ease' },
          '& polygon:hover': { opacity: 0.8 },
        }}
      >
        {stages.map((stage, i) => {
          const x0 = i * segmentWidth + BAND_GAP / 2;
          const x1 = (i + 1) * segmentWidth - BAND_GAP / 2;
          const h0 = (edges[i] ?? 0) * DRAW_HEIGHT;
          const h1 = (edges[i + 1] ?? 0) * DRAW_HEIGHT;
          const top0 = DRAW_HEIGHT / 2 - h0 / 2;
          const top1 = DRAW_HEIGHT / 2 - h1 / 2;
          const points = `${x0},${top0} ${x1},${top1} ${x1},${top1 + h1} ${x0},${top0 + h0}`;
          return (
            <Tooltip key={stage.key} arrow placement="top" title={<FunnelTooltip stage={stage} index={i} stages={stages} />}>
              <polygon
                points={points}
                fill={stage.color ?? DEFAULT_STAGE_PALETTE[i % DEFAULT_STAGE_PALETTE.length]}
              />
            </Tooltip>
          );
        })}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`, gap: 1, mt: 1.5 }}>
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
                borderRadius: 2,
                ...(isClickable && { cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }),
              }}
            >
              <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.2 }}>
                {stage.count}
              </Typography>
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
