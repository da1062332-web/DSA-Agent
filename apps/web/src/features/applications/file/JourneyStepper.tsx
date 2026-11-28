// The road of a loan file, Draft to Disbursed, with the current stage marked (owner: Bhushan, 2026-11-28 loan-file redesign).
// A file that left the road (rejected, withdrawn, cancelled) shows where it stopped and why. Each stage is a button: it opens that
// stage's work below, and the stage being viewed is underlined.
import { Box, ButtonBase, Typography } from '@mui/material';
import { JOURNEY, type JourneyState } from '../loan-file';

const OUTCOME_LABEL = {
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
  CANCELLED: 'Cancelled',
  CLOSED: 'Closed',
} as const;

export function JourneyStepper({
  state,
  selected,
  onSelect,
}: {
  state: JourneyState;
  /** The stage being viewed, when the stepper drives the page. */
  selected?: number;
  onSelect?: (index: number) => void;
}) {
  const stopped = state.outcome !== null && state.outcome !== 'CLOSED';
  return (
    <Box
      data-testid="application.journey"
      sx={{ display: 'grid', gridTemplateColumns: `repeat(${JOURNEY.length}, minmax(0, 1fr))`, pt: 1 }}
    >
      {JOURNEY.map((step, i) => {
        const done = i < state.activeIndex || (i === state.activeIndex && state.activeDone);
        const current = i === state.activeIndex && !state.activeDone;
        const stopHere = current && stopped;
        const tone = stopHere ? 'error.main' : done ? 'success.main' : current ? 'primary.main' : 'grey.300';
        return (
          <ButtonBase
            key={step.status}
            component="div"
            disabled={!onSelect}
            onClick={() => onSelect?.(i)}
            aria-current={selected === i ? 'step' : undefined}
            aria-label={`${step.label}: ${stopHere ? 'stopped here' : done ? 'done' : current ? 'current stage' : 'upcoming'}`}
            sx={{
              position: 'relative',
              display: 'block',
              textAlign: 'center',
              px: 0.5,
              pt: 0.5,
              pb: 1,
              borderRadius: '8px',
              cursor: onSelect ? 'pointer' : 'default',
              bgcolor: selected === i ? 'rgba(33, 89, 136, 0.06)' : 'transparent',
              '&:hover': onSelect ? { bgcolor: 'rgba(33, 89, 136, 0.08)' } : undefined,
              '&::after':
                selected === i
                  ? {
                      content: '""',
                      position: 'absolute',
                      left: '20%',
                      right: '20%',
                      bottom: 0,
                      height: 3,
                      borderRadius: 2,
                      bgcolor: 'primary.main',
                    }
                  : undefined,
            }}
            data-testid={`application.stage-${step.key}`}
            data-state={stopHere ? 'stopped' : done ? 'done' : current ? 'current' : 'todo'}
          >
            {/* the line to the next stage */}
            {i < JOURNEY.length - 1 && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 17,
                  left: '50%',
                  width: '100%',
                  height: 2,
                  bgcolor: done ? 'success.main' : 'grey.200',
                }}
              />
            )}
            <Box
              sx={{
                position: 'relative',
                mx: 'auto',
                width: 28,
                height: 28,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                fontSize: 13,
                fontWeight: 700,
                bgcolor: done || current ? tone : 'background.paper',
                color: done || current ? '#fff' : 'text.disabled',
                border: '2px solid',
                borderColor: tone,
                boxShadow: current && !stopped ? '0 0 0 4px rgba(33, 89, 136, 0.15)' : 'none',
              }}
            >
              {stopHere ? '✕' : done ? '✓' : i + 1}
            </Box>
            <Typography
              variant="caption"
              component="div"
              sx={{
                mt: 0.75,
                fontWeight: current || done ? 700 : 500,
                color: stopHere
                  ? 'error.main'
                  : current
                    ? 'primary.main'
                    : done
                      ? 'text.primary'
                      : 'text.secondary',
                lineHeight: 1.3,
              }}
            >
              {stopHere ? OUTCOME_LABEL[state.outcome!] : step.label}
            </Typography>
            <Typography
              variant="caption"
              component="div"
              color="text.secondary"
              sx={{ display: { xs: 'none', lg: 'block' }, fontSize: 11, lineHeight: 1.3, mt: 0.25 }}
            >
              {stopHere
                ? `Stopped at ${step.label.toLowerCase()}`
                : current && state.partial
                  ? 'Partly paid out'
                  : step.hint}
            </Typography>
          </ButtonBase>
        );
      })}
    </Box>
  );
}
