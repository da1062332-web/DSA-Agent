// /approvals (owner: Dev 1; DSA Notion MODULE 40, SUB-ADM.06 and SUB-ADM.07). The customer-tenant side of two governed workflows:
//   - support access: a platform operator asks, the tenant administrator approves, denies or revokes (SOD-06);
//   - data corrections: tenant staff request, a different person approves (SOD-08), and the executor service runs it.
// It shows only this tenant's records (the API and the database enforce that). It is not part of the Platform Console, which only
// platform operators can open.
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import type { DataCorrectionRequest, SupportAccessGrant } from '@dsa/contracts';
import { useState } from 'react';
import { hasPermission, useMe } from '../../api/useMe';
import { useToast } from '../../shell/toast';
import { useCommand, useList } from '../admin/api';
import { ErrorAlert, Loading, PageHeader, StatusChip } from '../admin/components';
import {
  CORRECTION_STATUS_LABELS,
  GRANT_STATUS_LABELS,
  NO_DIFF_NOTE,
  canDecideCorrection,
  grantAction,
  isValidChangeDescription,
  isValidCorrection,
  isValidJustification,
  isValidScriptRef,
  isValidTargetEntity,
} from './rules';

const GRANTS = '/v1/support-access-requests';
const CORRECTIONS = '/v1/data-corrections';
const when = (iso: string) => new Date(iso).toLocaleString();

export function ApprovalsPage() {
  const me = useMe();
  const canSupport = hasPermission(me.data, 'config.manage');
  const canRequest = hasPermission(me.data, 'data_correction.request');
  const canApprove = hasPermission(me.data, 'data_correction.approve');
  const showCorrections = canRequest || canApprove;
  const [tab, setTab] = useState<'support' | 'corrections'>(canSupport ? 'support' : 'corrections');

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle="Support access and data corrections for your organisation. Platform operators cannot approve their own requests."
      />
      {!canSupport && !showCorrections && (
        <Alert severity="warning" data-testid="approvals.noAccess">
          You don't have access to approvals. Ask your administrator to grant you the permission.
        </Alert>
      )}
      {(canSupport || showCorrections) && (
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
          {canSupport && <Tab value="support" label="Support access" data-testid="approvals.tab.support" />}
          {showCorrections && <Tab value="corrections" label="Data corrections" data-testid="approvals.tab.corrections" />}
        </Tabs>
      )}
      {canSupport && tab === 'support' && <SupportAccessTab />}
      {showCorrections && tab === 'corrections' && (
        <CorrectionsTab meId={me.data?.id} canRequest={canRequest} canApprove={canApprove} />
      )}
    </>
  );
}

function SupportAccessTab() {
  const list = useList<SupportAccessGrant>(GRANTS, {}, 100);
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <Alert severity="info" sx={{ mb: 2 }}>
        A platform operator asked to look at your organisation's configuration for a limited time (at most 4 hours). Approve only a
        request you recognise. You can revoke an approved access at any time.
      </Alert>
      <ErrorAlert error={list.error} />
      {list.isPending ? (
        <Loading />
      ) : (
        <Card>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Incident and reason</TableCell>
                  <TableCell>Requested by</TableCell>
                  <TableCell>Access window</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      No support access requests.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((g) => (
                  <GrantRow key={g.id} grant={g} />
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}
    </>
  );
}

function GrantRow({ grant }: { grant: SupportAccessGrant }) {
  const action = grantAction(grant);
  const toast = useToast();
  const decide = useCommand<{ decision: 'APPROVED' | 'DENIED' }, SupportAccessGrant>(
    () => ({ path: `${GRANTS}/${grant.id}/approval`, method: 'POST' }),
    [[GRANTS]],
    null,
  );
  const revoke = useCommand<Record<string, never>, SupportAccessGrant>(
    () => ({ path: `${GRANTS}/${grant.id}/revocation`, method: 'POST' }),
    [[GRANTS]],
    'Access revoked.',
  );
  const busy = decide.isPending || revoke.isPending;
  return (
    <TableRow hover data-testid="approvals.grant">
      <TableCell>
        <Typography variant="body2" fontWeight={600}>
          {grant.incidentRef}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {grant.reason}
        </Typography>
      </TableCell>
      <TableCell>{grant.requester}</TableCell>
      <TableCell>
        <Typography variant="caption">
          {when(grant.startsAt)} to {when(grant.endsAt)}
        </Typography>
      </TableCell>
      <TableCell>
        <StatusChip active={grant.status === 'APPROVED'} label={GRANT_STATUS_LABELS[grant.status]} />
      </TableCell>
      <TableCell align="right">
        {action === 'DECIDE' && (
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button
              size="small"
              variant="contained"
              color="success"
              disabled={busy}
              onClick={() => decide.mutate({ decision: 'APPROVED' }, { onSuccess: () => toast.success('Access approved.') })}
            >
              Approve
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="error"
              disabled={busy}
              onClick={() => decide.mutate({ decision: 'DENIED' }, { onSuccess: () => toast.success('Access denied.') })}
            >
              Deny
            </Button>
          </Stack>
        )}
        {action === 'REVOKE' && (
          <Button size="small" variant="outlined" color="error" disabled={busy} onClick={() => revoke.mutate({})}>
            Revoke
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function CorrectionsTab({ meId, canRequest, canApprove }: { meId: string | undefined; canRequest: boolean; canApprove: boolean }) {
  const list = useList<DataCorrectionRequest>(CORRECTIONS, {}, 100);
  const [creating, setCreating] = useState(false);
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ sm: 'center' }} sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 720 }}>
          A correction changes business data, so one person asks and a different person approves (SOD-08). An approved correction is run
          by the correction executor service, never by a person on this screen.
        </Typography>
        {canRequest && (
          <Button variant="contained" onClick={() => setCreating(true)} data-testid="approvals.corrections.new">
            New correction request
          </Button>
        )}
      </Stack>
      <ErrorAlert error={list.error} />
      {list.isPending ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          No data correction requests.
        </Typography>
      ) : (
        <Stack spacing={2}>
          {rows.map((c) => (
            <CorrectionCard key={c.id} correction={c} meId={meId} canApprove={canApprove} />
          ))}
        </Stack>
      )}
      {creating && <NewCorrectionDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function CorrectionCard({ correction: c, meId, canApprove }: { correction: DataCorrectionRequest; meId: string | undefined; canApprove: boolean }) {
  const decide = useCommand<{ decision: 'APPROVED' | 'REJECTED' }, DataCorrectionRequest>(
    () => ({ path: `${CORRECTIONS}/${c.id}/approval`, method: 'POST' }),
    [[CORRECTIONS]],
    'Decision recorded.',
  );
  const may = canDecideCorrection(c, meId, canApprove);
  const own = canApprove && c.status === 'PENDING' && c.requestedBy === meId;
  return (
    <Card variant="outlined" data-testid="approvals.correction">
      <CardContent>
        <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="subtitle1" fontWeight={700}>
              {c.scriptRef}
            </Typography>
            <StatusChip active={c.status === 'EXECUTED' || c.status === 'APPROVED'} label={CORRECTION_STATUS_LABELS[c.status]} />
          </Stack>
          {may && (
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="contained" color="success" disabled={decide.isPending} onClick={() => decide.mutate({ decision: 'APPROVED' })}>
                Approve
              </Button>
              <Button size="small" variant="outlined" color="error" disabled={decide.isPending} onClick={() => decide.mutate({ decision: 'REJECTED' })}>
                Reject
              </Button>
            </Stack>
          )}
          {own && (
            <Tooltip title="You requested this correction. A different person must approve it (SOD-08).">
              <span>
                <Button size="small" variant="contained" disabled>
                  Approve
                </Button>
              </span>
            </Tooltip>
          )}
        </Stack>
        <Typography variant="body2" sx={{ mb: 1 }}>
          <strong>Justification:</strong> {c.justification}
        </Typography>
        {c.targetEntity && (
          <Typography variant="body2" sx={{ mb: 1 }}>
            <strong>Target:</strong> {c.targetEntity}
            {c.changeDescription ? `. ${c.changeDescription}` : ''}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          {c.dryRunDiff ? `Dry-run diff (${c.dryRunDiffKey ?? 'no key'}) is attached.` : NO_DIFF_NOTE}
        </Typography>
        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', color: 'text.secondary', fontSize: '0.75rem' }}>
          <span>Requested by: {c.requestedBy}</span>
          <span>Approved by: {c.approvedBy ?? 'not yet'}</span>
          <span>Executor: {c.executorIdentity}</span>
          {c.executedAt && <span>Executed: {when(c.executedAt)}</span>}
        </Box>
      </CardContent>
    </Card>
  );
}

function NewCorrectionDialog({ onClose }: { onClose: () => void }) {
  const [scriptRef, setScriptRef] = useState('SCR-');
  const [targetEntity, setTargetEntity] = useState('');
  const [changeDescription, setChangeDescription] = useState('');
  const [justification, setJustification] = useState('');
  const create = useCommand<
    { scriptRef: string; targetEntity: string; changeDescription: string; justification: string },
    DataCorrectionRequest
  >(() => ({ path: CORRECTIONS, method: 'POST' }), [[CORRECTIONS]], 'Correction requested.');
  const draft = { scriptRef, targetEntity, changeDescription, justification };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Request a data correction</DialogTitle>
      <DialogContent>
        <ErrorAlert error={create.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Script reference"
            value={scriptRef}
            onChange={(e) => setScriptRef(e.target.value)}
            error={!isValidScriptRef(scriptRef)}
            helperText="The approved script that will make the change, for example SCR-2026-001."
          />
          <TextField
            label="Target"
            value={targetEntity}
            onChange={(e) => setTargetEntity(e.target.value)}
            error={targetEntity !== '' && !isValidTargetEntity(targetEntity)}
            helperText="The kind of record, for example LEAD or CUSTOMER."
          />
          <TextField
            label="What will change"
            multiline
            minRows={2}
            value={changeDescription}
            onChange={(e) => setChangeDescription(e.target.value)}
            error={changeDescription !== '' && !isValidChangeDescription(changeDescription)}
            helperText="At least 5 characters."
          />
          <TextField
            label="Why it is needed"
            multiline
            minRows={3}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            error={justification !== '' && !isValidJustification(justification)}
            helperText="At least 10 characters. Recorded in the audit trail."
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={create.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={create.isPending || !isValidCorrection(draft)}
          onClick={() =>
            create.mutate(
              {
                scriptRef: scriptRef.trim(),
                targetEntity: targetEntity.trim(),
                changeDescription: changeDescription.trim(),
                justification: justification.trim(),
              },
              { onSuccess: onClose },
            )
          }
        >
          Request
        </Button>
      </DialogActions>
    </Dialog>
  );
}
