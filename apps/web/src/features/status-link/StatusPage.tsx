// The customer's status page at /status/:token (task P3-05, checklist 6.4). No sign-in, no sidebar and no internal navigation. It shows the
// stage, the progress along the customer's path, the documents still needed and the date of the last update. It shows nothing that names
// the customer or the application: the API returns only those fields.
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Box, Button, Skeleton, Stack, Typography } from '@mui/material';
import { apiFetch } from '../../api/client';
import {
  AssignmentIcon,
  AutorenewIcon,
  CancelIcon,
  CheckCircleIcon,
  HourglassEmptyIcon,
  LockIcon,
} from '../../shell/icons';
import {
  progressSteps,
  STATUS_ERROR_COPY,
  statusErrorKind,
  updatedLine,
  type ProgressStep,
  type PublicStatusView,
  type StatusErrorKind,
} from './status-view';

const NAVY = '#215988';
const NAVY_DARK = '#174368';
const NAVY_TINT = '#EEF4FA';
const GREEN = '#15803D';
const AMBER_TINT = '#FEF3C7';
const AMBER_TEXT = '#92400E';
const BORDER = '#E2E8F0';

/** A card on the white canvas: a 1px border and a faint shadow, with a modest radius. */
const cardSx = {
  border: '1px solid',
  borderColor: BORDER,
  borderRadius: '12px',
  bgcolor: '#FFFFFF',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
  p: { xs: 2, sm: 3 },
  minWidth: 0,
};

/** A short fade-up on entry. Users who ask for reduced motion get none. */
const entranceSx = {
  animation: 'statusEnter 320ms ease-out both',
  '@keyframes statusEnter': {
    from: { opacity: 0, transform: 'translateY(6px)' },
    to: { opacity: 1, transform: 'none' },
  },
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
};

export function StatusPage() {
  const { token = '' } = useParams();
  const status = useQuery({
    queryKey: ['public-status', token],
    queryFn: () => apiFetch<PublicStatusView>(`/public/v1/status/${encodeURIComponent(token)}`),
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const previous = document.title;
    document.title = 'Application status · DSA CRM';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <Box component="main" sx={{ minHeight: '100vh', bgcolor: '#FFFFFF', display: 'flex', flexDirection: 'column' }}>
      <Header />

      <Box sx={{ flex: 1, width: '100%', maxWidth: 560, mx: 'auto', px: { xs: 2, sm: 3 }, py: { xs: 3, sm: 5 } }}>
        <Typography
          component="h1"
          sx={{ fontSize: { xs: 22, sm: 26 }, fontWeight: 600, color: '#0F172A', lineHeight: 1.25 }}
        >
          Your Application Status
        </Typography>

        {status.isLoading && <LoadingState />}

        {status.isError && (
          <ErrorState kind={statusErrorKind(status.error)} onRetry={() => void status.refetch()} />
        )}

        {status.data && <StatusContent view={status.data} />}
      </Box>

      <Footer />
    </Box>
  );
}

function Header() {
  return (
    <Box
      component="header"
      sx={{
        borderBottom: '1px solid',
        borderColor: BORDER,
        bgcolor: '#FFFFFF',
        px: { xs: 2, sm: 3 },
        py: 1.5,
      }}
    >
      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ maxWidth: 560, mx: 'auto' }}>
        <Box component="img" src="/logo.png" alt="" sx={{ height: 26, width: 'auto', display: 'block' }} />
        <Typography sx={{ fontWeight: 600, color: NAVY_DARK, fontSize: 15, lineHeight: 1.2 }}>DSA CRM</Typography>
        <Typography
          sx={{ ml: 'auto', color: '#64748B', fontSize: 13, textAlign: 'right', lineHeight: 1.2, whiteSpace: 'nowrap' }}
        >
          Application tracking
        </Typography>
      </Stack>
    </Box>
  );
}

function StatusContent({ view }: { view: PublicStatusView }) {
  const steps = progressSteps(view.progress);
  return (
    <Stack spacing={2} sx={{ mt: 2.5, ...entranceSx }}>
      <StageCard view={view} />
      {steps.length > 0 && <ProgressCard steps={steps} />}
      <PendingCard documents={view.pendingDocuments} />
    </Stack>
  );
}

function StageCard({ view }: { view: PublicStatusView }) {
  const updated = updatedLine(view.lastUpdated);
  return (
    <Box sx={cardSx} data-testid="status.stage-card">
      <Stack spacing={1.25}>
        <Box
          component="span"
          data-testid="status.badge"
          sx={{
            alignSelf: 'flex-start',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            px: 1,
            py: 0.5,
            borderRadius: '6px',
            bgcolor: view.progress.closed ? '#F1F5F9' : NAVY_TINT,
            color: view.progress.closed ? '#475569' : NAVY_DARK,
            fontSize: 12.5,
            fontWeight: 600,
            lineHeight: 1,
          }}
        >
          <Box
            component="span"
            sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: view.progress.closed ? '#94A3B8' : NAVY }}
          />
          {view.progress.closed ? 'Closed' : 'In progress'}
        </Box>

        <Box>
          <Typography sx={{ fontSize: 12, color: '#64748B', fontWeight: 500, letterSpacing: 0.2 }}>
            Current stage
          </Typography>
          <Typography
            data-testid="status.stage"
            sx={{ fontSize: { xs: 22, sm: 26 }, fontWeight: 600, color: NAVY_DARK, lineHeight: 1.2, overflowWrap: 'anywhere' }}
          >
            {view.stage}
          </Typography>
        </Box>

        {updated && (
          <Typography data-testid="status.updated" sx={{ fontSize: 13.5, color: '#475569' }}>
            {updated}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}

function ProgressCard({ steps }: { steps: ProgressStep[] }) {
  return (
    <Box sx={cardSx} data-testid="status.progress">
      <Typography component="h2" sx={{ fontSize: 16, fontWeight: 600, color: '#0F172A', mb: 2 }}>
        Application progress
      </Typography>
      <Box component="ol" aria-label="Application progress" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {steps.map((step, index) => (
          <ProgressRow key={step.label} step={step} isLast={index === steps.length - 1} />
        ))}
      </Box>
    </Box>
  );
}

function ProgressRow({ step, isLast }: { step: ProgressStep; isLast: boolean }) {
  const completed = step.state === 'completed';
  const current = step.state === 'current';
  return (
    <Box
      component="li"
      aria-current={current ? 'step' : undefined}
      sx={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 1.5, pb: isLast ? 0 : 2.25, minWidth: 0 }}
    >
      {!isLast && (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            left: 10.5,
            top: 24,
            bottom: 0,
            width: 2,
            bgcolor: completed ? GREEN : BORDER,
          }}
        />
      )}
      <Box sx={{ width: 22, height: 22, flexShrink: 0, display: 'grid', placeItems: 'center', position: 'relative' }}>
        {completed && <CheckCircleIcon sx={{ fontSize: 22, color: GREEN }} />}
        {current && (
          <Box
            sx={{
              width: 14,
              height: 14,
              borderRadius: '50%',
              bgcolor: NAVY,
              boxShadow: `0 0 0 4px ${NAVY_TINT}`,
            }}
          />
        )}
        {step.state === 'upcoming' && (
          <Box sx={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #CBD5E1', bgcolor: '#FFFFFF' }} />
        )}
      </Box>
      <Typography
        sx={{
          fontSize: 14.5,
          lineHeight: 1.35,
          pt: 0.25,
          minWidth: 0,
          overflowWrap: 'anywhere',
          fontWeight: current ? 600 : 500,
          color: current ? NAVY_DARK : completed ? '#0F172A' : '#94A3B8',
        }}
      >
        {step.label}
      </Typography>
    </Box>
  );
}

function PendingCard({ documents }: { documents: string[] }) {
  return (
    <Box sx={cardSx} data-testid="status.pending-card">
      <Typography component="h2" sx={{ fontSize: 16, fontWeight: 600, color: '#0F172A', mb: 1.5 }}>
        Pending Documents
      </Typography>
      {documents.length === 0 ? (
        <Stack direction="row" spacing={1.25} alignItems="center" data-testid="status.no-pending">
          <CheckCircleIcon sx={{ fontSize: 20, color: GREEN }} />
          <Typography sx={{ fontSize: 14.5, color: '#334155' }}>No pending documents</Typography>
        </Stack>
      ) : (
        <Stack spacing={1} component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }} data-testid="status.pending">
          {documents.map((name) => (
            <Stack
              key={name}
              component="li"
              direction="row"
              spacing={1.25}
              alignItems="center"
              sx={{ border: '1px solid', borderColor: BORDER, borderRadius: '8px', px: 1.5, py: 1.25, minWidth: 0 }}
            >
              <AssignmentIcon sx={{ fontSize: 20, color: '#64748B', flexShrink: 0 }} />
              <Typography sx={{ flex: 1, minWidth: 0, fontSize: 14.5, color: '#0F172A', overflowWrap: 'anywhere' }}>
                {name}
              </Typography>
              <Box
                component="span"
                sx={{
                  flexShrink: 0,
                  px: 0.9,
                  py: 0.35,
                  borderRadius: '4px',
                  bgcolor: AMBER_TINT,
                  color: AMBER_TEXT,
                  fontSize: 11.5,
                  fontWeight: 700,
                  letterSpacing: 0.3,
                  textTransform: 'uppercase',
                }}
              >
                Pending
              </Box>
            </Stack>
          ))}
        </Stack>
      )}
    </Box>
  );
}

function LoadingState() {
  return (
    <Stack spacing={2} sx={{ mt: 2.5 }} data-testid="status.loading">
      <Box sx={cardSx}>
        <Skeleton variant="text" width="30%" height={18} />
        <Skeleton variant="text" width="70%" height={36} />
        <Skeleton variant="text" width="45%" height={18} />
      </Box>
      <Box sx={cardSx}>
        <Skeleton variant="text" width="40%" height={22} />
        <Skeleton variant="rounded" height={120} sx={{ mt: 1.5, borderRadius: '8px' }} />
      </Box>
    </Stack>
  );
}

const ERROR_ICON: Record<StatusErrorKind, typeof LockIcon> = {
  expired: LockIcon,
  'rate-limited': HourglassEmptyIcon,
  network: CancelIcon,
};

function ErrorState({ kind, onRetry }: { kind: StatusErrorKind; onRetry: () => void }) {
  const copy = STATUS_ERROR_COPY[kind];
  const Icon = ERROR_ICON[kind];
  return (
    <Box sx={{ ...cardSx, mt: 2.5, ...entranceSx }} role="alert" data-testid={`status.error.${kind}`}>
      <Stack spacing={1.5} alignItems="flex-start">
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: '10px',
            bgcolor: NAVY_TINT,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Icon sx={{ fontSize: 22, color: NAVY }} />
        </Box>
        <Typography component="p" sx={{ fontSize: 17, fontWeight: 600, color: '#0F172A', lineHeight: 1.35 }}>
          {copy.title}
        </Typography>
        {copy.body && <Typography sx={{ fontSize: 14.5, color: '#475569' }}>{copy.body}</Typography>}
        {kind === 'network' && (
          <Button
            variant="contained"
            size="medium"
            onClick={onRetry}
            startIcon={<AutorenewIcon />}
            data-testid="status.retry"
            sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px', boxShadow: 'none' }}
          >
            Try again
          </Button>
        )}
      </Stack>
    </Box>
  );
}

function Footer() {
  return (
    <Box component="footer" sx={{ borderTop: '1px solid', borderColor: BORDER, px: { xs: 2, sm: 3 }, py: 2.5 }}>
      <Stack spacing={0.75} sx={{ maxWidth: 560, mx: 'auto' }}>
        <Typography sx={{ fontSize: 12.5, color: '#64748B', lineHeight: 1.5 }}>
          This page displays limited application information.
        </Typography>
        <Typography sx={{ fontSize: 12.5, color: '#475569', lineHeight: 1.5 }}>
          For assistance, please contact your relationship manager.
        </Typography>
      </Stack>
    </Box>
  );
}
