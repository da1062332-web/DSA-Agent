// The work of one stage of a loan file (owner: Bhushan, 2026-11-28). The stepper above picks the stage; this shows what the stage is
// for, a "to finish this step" checklist ticked from the file's own data, the action that moves the file on (only on the stage the
// file is at), and the cards for that stage's work. A finished stage stays open to look back at; an upcoming one says what it needs.
import type { CollateralView, CustomerProfileView, LenderMatchRun } from '@dsa/contracts';
import { Alert, Box, Chip, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, apiFetch } from '../../../api/client';
import { hasPermission, useMe } from '../../../api/useMe';
import { AppButton } from '../../../ui';
import { useLookup, useResource } from '../../admin/api';
import { ChecklistCard } from '../../documents/ChecklistCard';
import { useChecklist } from '../../documents/api';
import { LenderCasePanel } from '../../lender-cases/LenderCasePanel';
import type { Application } from '../ApplicationsPage';
import { CollateralCard } from '../CollateralCard';
import { LenderMatchesCard } from '../LenderMatchesCard';
import { JOURNEY, stagePosition, type JourneyState } from '../loan-file';
import { openChecks, stageChecks, type CheckState, type FileFacts } from '../stage-checks';
import { ApplicantsTab } from './ApplicantsTab';
import { EligibilityTab } from './EligibilityTab';

interface Party {
  role: 'PRIMARY' | 'CO_APPLICANT' | 'GUARANTOR';
  removedAt: string | null;
}

const MARK: Record<CheckState, { symbol: string; color: string; label: string }> = {
  done: { symbol: '✓', color: 'success.main', label: 'Done' },
  todo: { symbol: '○', color: 'warning.main', label: 'To do' },
  optional: { symbol: '–', color: 'text.disabled', label: 'Optional' },
  unknown: { symbol: '?', color: 'text.disabled', label: 'Cannot be checked with your permissions' },
};

/** Everything the checklists need, read once for the file. A part the caller cannot read stays null ("not known"). */
export function useFileFacts(app: Application): FileFacts {
  const me = useMe();
  const parties = useLookup<Party>(`/v1/applications/${app.id}/parties`);
  const collateral = useLookup<CollateralView>(`/v1/applications/${app.id}/collateral`);
  const profile = useResource<CustomerProfileView>(`/v1/customers/${app.customerId}/profile`);
  const inputs = useResource<{ declaredMonthlyIncome: unknown; verifiedMonthlyIncome: unknown }>(
    `/v1/applications/${app.id}/eligibility-inputs`,
  );
  const checklist = useChecklist(app.id);
  const canMatch = hasPermission(me.data, 'lender_match.run');
  const matchBase = `/v1/applications/${app.id}/lender-matches`;
  const match = useQuery({
    queryKey: [matchBase, 'latest'],
    queryFn: () =>
      apiFetch<LenderMatchRun>(`${matchBase}/latest`).catch((e: unknown) => {
        if (e instanceof ApiError && e.httpStatus === 404) return null;
        throw e;
      }),
    enabled: canMatch,
  });
  const canCases = hasPermission(me.data, 'lender_case.read');
  const cases = useLookup<{ status: string }>(`/v1/applications/${app.id}/lender-cases`, {}, canCases);

  const live = (parties.data ?? []).filter((p) => p.removedAt === null);
  const onApplication = !!(inputs.data?.declaredMonthlyIncome || inputs.data?.verifiedMonthlyIncome);
  const borrowerIncome =
    onApplication || profile.data?.monthlyIncome ? true : profile.error && inputs.error ? null : false;
  const summary = checklist.data?.summary;
  return {
    productCategory: app.productCategory,
    productChosen: !!app.productVersionId,
    tenureMonths: app.tenureMonths,
    purposeCode: app.purposeCode,
    borrowerIncome,
    coApplicants: live.filter((p) => p.role === 'CO_APPLICANT').length,
    collateralItems: collateral.error ? null : (collateral.data?.length ?? 0),
    checklist: summary
      ? {
          total: summary.total,
          outstandingMandatory: summary.outstandingMandatory,
          complete: summary.complete,
        }
      : null,
    eligibleLenders: canMatch && match.data !== undefined ? (match.data?.eligibleCount ?? 0) : null,
    lenderCases: canCases && cases.data ? cases.data.map((c) => c.status) : null,
  };
}

function Checklist({ items }: { items: ReturnType<typeof stageChecks> }) {
  return (
    <Stack spacing={1} data-testid="application.stage-checklist">
      {items.map((c) => (
        <Stack key={c.label} direction="row" spacing={1.5} alignItems="flex-start" data-state={c.state}>
          <Box
            title={MARK[c.state].label}
            sx={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              fontSize: 13,
              fontWeight: 700,
              color: c.state === 'done' ? '#fff' : MARK[c.state].color,
              bgcolor: c.state === 'done' ? 'success.main' : 'transparent',
              border: c.state === 'done' ? 'none' : '2px solid',
              borderColor: MARK[c.state].color,
            }}
          >
            {MARK[c.state].symbol}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="body2"
              sx={{
                fontWeight: c.state === 'todo' ? 600 : 500,
                color: c.state === 'optional' ? 'text.secondary' : 'text.primary',
              }}
            >
              {c.label}
              {c.state === 'optional' && ' (optional)'}
            </Typography>
            {c.hint && c.state !== 'done' && (
              <Typography variant="caption" color="text.secondary">
                {c.hint}
              </Typography>
            )}
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}

export function StagePanel({
  app,
  journey,
  index,
  onSelect,
  nextStep,
  loanRequest,
}: {
  app: Application;
  journey: JourneyState;
  index: number;
  onSelect: (index: number) => void;
  /** The other actions on the file (withdraw, cancel, send back), shown after the step's work on the stage the file is at. */
  nextStep: ReactNode;
  /** The loan request form (the Draft stage). */
  loanRequest: ReactNode;
}) {
  const me = useMe();
  const stage = JOURNEY[index]!;
  const position = stagePosition(index, journey);
  const facts = useFileFacts(app);
  const checks = stageChecks(stage.key, facts);
  const open = openChecks(checks);
  const current = journey.activeIndex;
  // An upcoming step's work can be previewed (a DSA often checks eligibility before the documents are in); it does not move the file.
  const [preview, setPreview] = useState(false);
  useEffect(() => setPreview(false), [index]);

  const chip =
    position === 'current'
      ? { label: 'Current step', color: 'primary' as const }
      : position === 'done'
        ? { label: 'Done', color: 'success' as const }
        : position === 'stopped'
          ? { label: 'Stopped here', color: 'error' as const }
          : { label: 'Upcoming', color: 'default' as const };

  let work: ReactNode = null;
  switch (stage.key) {
    case 'draft':
      work = (
        <>
          <ApplicantsTab app={app} />
          {loanRequest}
          <CollateralCard app={app} />
        </>
      );
      break;
    case 'documents':
      work = (
        <>
          {hasPermission(me.data, 'document.upload') && (
            <Stack direction="row" justifyContent="flex-end" sx={{ mb: -1 }}>
              <AppButton
                size="small"
                variant="outlined"
                to={`/document-sharing?applicationId=${encodeURIComponent(app.id)}&action=upload-link`}
                dataTestId="application.stage-upload-link"
              >
                Send the customer an upload link
              </AppButton>
            </Stack>
          )}
          <ChecklistCard applicationId={app.id} />
        </>
      );
      break;
    case 'review':
      work = <EligibilityTab app={app} />;
      break;
    case 'ready':
      work = (
        <>
          {hasPermission(me.data, 'lender_match.run') && (
            <LenderMatchesCard applicationId={app.id} productCategory={app.productCategory} />
          )}
          <div data-slot="application.lender-cases">
            <LenderCasePanel applicationId={app.id} />
          </div>
        </>
      );
      break;
    default:
      work = (
        <div data-slot="application.lender-cases">
          <LenderCasePanel applicationId={app.id} />
        </div>
      );
  }

  return (
    <Box data-testid={`application.stage-panel.${stage.key}`}>
      <Box
        sx={{
          border: 1,
          borderColor: position === 'current' ? 'primary.light' : 'divider',
          borderRadius: '12px',
          bgcolor: 'background.paper',
          p: 2.5,
          mb: 3,
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.5 }}>
            Step {index + 1} of {JOURNEY.length}
          </Typography>
          <Chip size="small" label={chip.label} color={chip.color} sx={{ fontWeight: 700 }} />
        </Stack>
        <Typography variant="h6" sx={{ fontWeight: 700, mt: 0.5 }}>
          {stage.label}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {stage.purpose}
        </Typography>
        <Typography
          variant="caption"
          component="div"
          sx={{ mt: 0.5, mb: 2 }}
          data-testid="application.stage-moves-on"
        >
          <b>How it moves on:</b> {stage.movesOn}
        </Typography>

        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          {position === 'done' ? 'What this step needed' : 'To finish this step'}
          {position !== 'done' && open > 0 ? ` · ${open} to do` : ''}
        </Typography>
        <Checklist items={checks} />

        {position === 'upcoming' && (
          <Alert severity="info" sx={{ mt: 2 }} data-testid="application.stage-upcoming">
            The file is at {JOURNEY[current]?.label ?? 'an earlier step'}. This step opens once that one is
            finished.{' '}
            <Box
              component="button"
              type="button"
              onClick={() => onSelect(current)}
              sx={{
                border: 0,
                p: 0,
                bgcolor: 'transparent',
                color: 'primary.main',
                cursor: 'pointer',
                font: 'inherit',
                textDecoration: 'underline',
              }}
            >
              Go to the current step
            </Box>
            {' · '}
            <Box
              component="button"
              type="button"
              onClick={() => setPreview((p) => !p)}
              data-testid="application.stage-preview"
              sx={{
                border: 0,
                p: 0,
                bgcolor: 'transparent',
                color: 'primary.main',
                cursor: 'pointer',
                font: 'inherit',
                textDecoration: 'underline',
              }}
            >
              {preview ? 'Hide the preview' : 'Preview this step'}
            </Box>
          </Alert>
        )}
      </Box>

      {(position !== 'upcoming' || preview) && <Box sx={{ '& > *': { mb: 3 } }}>{work}</Box>}

      {/* Last, after the step's work: withdraw, cancel or send back is decided once the documents and eligibility have been seen. */}
      {position === 'current' || position === 'stopped' ? nextStep : null}
    </Box>
  );
}
