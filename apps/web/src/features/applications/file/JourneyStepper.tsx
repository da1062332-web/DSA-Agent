// The road of a loan file, Draft to Disbursed, with the current stage marked (owner: Bhushan, 2026-11-28 loan-file redesign).
// A file that left the road (rejected, withdrawn, cancelled) shows where it stopped and why.
import { Box, Typography } from '@mui/material';
import { JOURNEY, type JourneyState } from '../loan-file';

const OUTCOME_LABEL = {
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
  CANCELLED: 'Cancelled',
  CLOSED: 'Closed',
} as const;

export function JourneyStepper({ state }: { state: JourneyState }) {
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
          <Box
            key={step.status}
            sx={{ position: 'relative', textAlign: 'center', px: 0.5 }}
            data-testid={`application.journey.${step.status}`}
            data-state={stopHere ? 'stopped' : done ? 'done' : current ? 'current' : 'todo'}
          >
            {/* the line to the next stage */}
            {i < JOURNEY.length - 1 && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 13,
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
          </Box>
        );
      })}
    </Box>
  );
}
