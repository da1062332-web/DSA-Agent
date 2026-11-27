// /approvals (owner: Dev 1; DSA Notion MODULE 40, SUB-ADM.06). The customer-tenant side of two governed workflows:
//   - support access: a platform operator asks, the tenant administrator approves, denies or revokes (SOD-06);
//   - finance approvals (QA plan Module 13B): commission plans and payout requests waiting for an independent checker
//     (SOD-02, SOD-03), listed with a link to the screen where the decision is taken.
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
import type { SupportAccessGrant } from '@dsa/contracts';
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ConnectorName, LenderName, UserName } from '../../shell/display';
import { fetchCommissionPlans } from '../commission/api';
import { fetchPayoutRequests } from '../payouts/api';
import { hasPermission, useMe } from '../../api/useMe';
import { useToast } from '../../shell/toast';
import { useCommand, useList } from '../admin/api';
import { ErrorAlert, Loading, PageHeader, StatusChip } from '../admin/components';
import { GRANT_STATUS_LABELS, grantAction, grantWindowEnded } from './rules';

const GRANTS = '/v1/support-access-requests';
const when = (iso: string) => new Date(iso).toLocaleString();

export function ApprovalsPage() {
  const me = useMe();
  const canSupport = hasPermission(me.data, 'config.manage');
  const canPlans = hasPermission(me.data, 'commission.plan.approve');
  const canPayouts = hasPermission(me.data, 'payout.approve');
  const showFinance = canPlans || canPayouts;

  const allowedTabs = [canSupport && 'support', showFinance && 'finance'].filter(Boolean) as ('support' | 'finance')[];

  const defaultTab = canSupport ? 'support' : 'finance';
  const [tab, setTab] = useState<'support' | 'finance'>(defaultTab);

  useEffect(() => {
    if (allowedTabs.length > 0 && !allowedTabs.includes(tab)) {
      setTab(allowedTabs[0]!);
    }
  }, [allowedTabs, tab]);

  if (me.isPending) {
    return <Loading />;
  }

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle="Support access and finance approvals for your organisation. Nobody approves their own request."
      />
      {!canSupport && !showFinance && (
        <Alert severity="warning" data-testid="approvals.noAccess">
          You don't have access to approvals. Ask your administrator to grant you the permission.
        </Alert>
      )}
      {(canSupport || showFinance) && (
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
          {canSupport && <Tab value="support" label="Support access" data-testid="approvals.tab.support" />}
          {showFinance && <Tab value="finance" label="Finance" data-testid="approvals.tab.finance" />}
        </Tabs>
      )}
      {canSupport && tab === 'support' && <SupportAccessTab canSupport={canSupport} />}
      {showFinance && tab === 'finance' && (
        <FinanceApprovalsTab meId={me.data?.id} canPlans={canPlans} canPayouts={canPayouts} />
      )}
    </>
  );
}

/** What waits for a finance checker. The decision itself is taken on the Commission and Payouts screens. */
function FinanceApprovalsTab({
  meId,
  canPlans,
  canPayouts,
}: {
  meId?: string;
  canPlans: boolean;
  canPayouts: boolean;
}) {
  const plans = useQuery({
    queryKey: ['approvals', 'commission-plans'],
    // The list endpoint returns every plan; approval moves a DRAFT or PENDING_APPROVAL plan to ACTIVE.
    queryFn: async () => {
      const all = await fetchCommissionPlans({ limit: 100 });
      return { data: all.data.filter((p) => p.status === 'DRAFT' || p.status === 'PENDING_APPROVAL') };
    },
    enabled: canPlans,
  });
  const payouts = useQuery({
    queryKey: ['approvals', 'payout-requests'],
    queryFn: () => fetchPayoutRequests({ status: 'SUBMITTED', limit: 100 }),
    enabled: canPayouts,
  });
  const own = (who: string | undefined) =>
    who && who === meId ? (
      <Typography variant="caption" color="warning.main">
        You made this, so another approver must decide.
      </Typography>
    ) : null;
  return (
    <Stack spacing={3}>
      {canPlans && (
        <Card>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="h6">Commission plans awaiting approval (SOD-02)</Typography>
              <Button component={RouterLink} to="/commission" size="small">
                Open Commission
              </Button>
            </Stack>
            <ErrorAlert error={plans.error} />
            {plans.isLoading ? (
              <Loading />
            ) : (plans.data?.data ?? []).length === 0 ? (
              <Typography color="text.secondary">No plans are waiting for approval.</Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Plan</TableCell>
                    <TableCell>Lender</TableCell>
                    <TableCell>Event and basis</TableCell>
                    <TableCell>Updated</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(plans.data?.data ?? []).map((p) => (
                    <TableRow key={p.id} data-testid="approvals.finance.plan">
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>
                          <LenderName id={p.lenderId} /> Plan
                        </Typography>
                        <Box sx={{ mt: 0.5 }}>
                          <Typography variant="caption" color="text.secondary">
                            Created by <UserName id={p.createdBy} fallback={p.createdBy} />
                          </Typography>
                        </Box>
                        {own(p.createdBy)}
                      </TableCell>
                      <TableCell>
                        <LenderName id={p.lenderId} typographyProps={{ fontWeight: 600 }} />
                      </TableCell>
                      <TableCell>
                        {p.qualifyingEvent} · {p.basis}
                      </TableCell>
                      <TableCell>{when(p.updatedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
      {canPayouts && (
        <Card>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="h6">Payout requests awaiting approval (SOD-03)</Typography>
              <Button component={RouterLink} to="/payouts" size="small">
                Open Payouts
              </Button>
            </Stack>
            <ErrorAlert error={payouts.error} />
            {payouts.isLoading ? (
              <Loading />
            ) : (payouts.data?.data ?? []).length === 0 ? (
              <Typography color="text.secondary">No payout requests are waiting for approval.</Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Request</TableCell>
                    <TableCell>Connector</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell>Submitted</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(payouts.data?.data ?? []).map((r) => (
                    <TableRow key={r.id} data-testid="approvals.finance.payout">
                      <TableCell>
                        {own(r.submittedBy)}
                      </TableCell>
                      <TableCell>
                        <ConnectorName id={r.connectorId} typographyProps={{ fontWeight: 600 }} />
                      </TableCell>
                      <TableCell align="right">
                        {r.currency} {r.total}
                      </TableCell>
                      <TableCell>{when(r.submittedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}

function SupportAccessTab({ canSupport = true }: { canSupport?: boolean }) {
  const list = useList<SupportAccessGrant>(GRANTS, {}, 100, canSupport);
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <Alert severity="info" sx={{ mb: 2 }}>
        A platform operator asked to look at your organisation's configuration for a limited time (at most 4
        hours). Approve only a request you recognise. You can revoke an approved access at any time.
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
  // The window can end while the page is open: decide it again from the clock on every render.
  const windowEnded = grantWindowEnded(grant, new Date());
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
      <TableCell>
        <UserName id={grant.requester} fallback={grant.requester} />
      </TableCell>
      <TableCell>
        <Typography variant="caption">
          {when(grant.startsAt)} to {when(grant.endsAt)}
        </Typography>
      </TableCell>
      <TableCell>
        <StatusChip
          active={grant.status === 'APPROVED'}
          label={windowEnded ? GRANT_STATUS_LABELS.EXPIRED : GRANT_STATUS_LABELS[grant.status]}
        />
      </TableCell>
      <TableCell align="right">
        {action === 'DECIDE' && windowEnded && (
          // Faint, disabled buttons plus the reason, so it is clear why nothing can be done here.
          <Stack spacing={0.5} alignItems="flex-end" data-testid="approvals.grant.closed">
            <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ opacity: 0.4 }}>
              <Button size="small" variant="outlined" color="inherit" disabled>
                Approve
              </Button>
              <Button size="small" variant="outlined" color="inherit" disabled>
                Deny
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Closed: the access window ended on {when(grant.endsAt)}. It can no longer be approved or denied.
            </Typography>
          </Stack>
        )}
        {action === 'DECIDE' && !windowEnded && (
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button
              size="small"
              variant="contained"
              color="success"
              disabled={busy}
              onClick={() =>
                decide.mutate(
                  { decision: 'APPROVED' },
                  { onSuccess: () => toast.success('Access approved.') },
                )
              }
            >
              Approve
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="error"
              disabled={busy}
              onClick={() =>
                decide.mutate({ decision: 'DENIED' }, { onSuccess: () => toast.success('Access denied.') })
              }
            >
              Deny
            </Button>
          </Stack>
        )}
        {action === 'REVOKE' && (
          <Button
            size="small"
            variant="outlined"
            color="error"
            disabled={busy}
            onClick={() => revoke.mutate({})}
          >
            Revoke
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}
