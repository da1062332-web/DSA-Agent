// Cards on /applications/:id for the rest of the loan file (owner: Dev 3; DSA Notion MODULE 16 and 20):
//   PartiesCard     API-APP-006 / 006-LIST  co-applicants and guarantors (application.update)
//   OwnersCard      API-APP-011             sales owner and operations owner (application.assign)
// Each card shows only what the caller's permissions and the application's status allow (rules.ts); the API re-checks everything.
import { Card, CardContent, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { hasPermission, useMe } from '../../api/useMe';
import { CustomerName, UserName } from '../../shell/display';
import { CustomerSelect, UserSelect } from '../../shell/selectors';
import { AppButton, FieldGrid } from '../../ui';
import { useCommand, useLookup } from '../admin/api';
import { ErrorAlert } from '../admin/components';
import type { Application } from './ApplicationsPage';
import {
  canAssignOwners,
  canChangeParties,
  canRemoveParty,
  hasRestrictedNumber,
  isValidAssignmentReason,
  type PartyView,
} from './rules';

interface Party extends PartyView {
  id: string;
  customerId: string;
  partyType: 'INDIVIDUAL' | 'ENTITY';
  relationshipToPrimary: string | null;
  createdAt: string;
}

const ROLE_LABELS: Record<Party['role'], string> = {
  PRIMARY: 'Primary applicant',
  CO_APPLICANT: 'Co-applicant',
  GUARANTOR: 'Guarantor',
};
const RELATIONSHIPS = ['SPOUSE', 'PARENT', 'CHILD', 'SIBLING', 'PARTNER', 'DIRECTOR', 'OTHER'] as const;
const readable = (code: string) => code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ');

/** Co-applicants and guarantors. Adding one asks for their documents too while the file is collecting documents. */
export function PartiesCard({ app }: { app: Application }) {
  const me = useMe();
  const canEdit = hasPermission(me.data, 'application.update') && canChangeParties(app.status);
  const parties = useLookup<Party>(`/v1/applications/${app.id}/parties`);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [role, setRole] = useState<'CO_APPLICANT' | 'GUARANTOR'>('CO_APPLICANT');
  const [relationship, setRelationship] = useState('');

  const change = useCommand<
    | {
        action: 'ADD';
        customerId: string;
        role: 'CO_APPLICANT' | 'GUARANTOR';
        relationshipToPrimary?: string;
      }
    | { action: 'REMOVE'; partyId: string },
    unknown
  >(
    () => ({ path: `/v1/applications/${app.id}/parties`, method: 'POST', version: app.version }),
    [
      [`/v1/applications/${app.id}`],
      [`/v1/applications/${app.id}/parties`],
      ['application-checklist', app.id],
    ],
  );

  const current = (parties.data ?? []).filter((p) => p.removedAt === null);
  return (
    <Card sx={{ mb: 3 }} data-testid="application.parties">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Applicants and guarantors
        </Typography>
        <ErrorAlert error={parties.error ?? change.error} />
        <Stack spacing={1} sx={{ mb: canEdit ? 2 : 0 }}>
          {current.map((p) => (
            <Stack
              key={p.id}
              direction="row"
              spacing={2}
              alignItems="center"
              data-testid={`application.party.${p.id}`}
            >
              <Typography variant="body2" sx={{ minWidth: 150 }}>
                {ROLE_LABELS[p.role]}
              </Typography>
              <Typography variant="body2" component="span" sx={{ flex: 1 }}>
                <CustomerName id={p.customerId} linkToProfile />
                {p.relationshipToPrimary ? ` · ${readable(p.relationshipToPrimary)}` : ''}
              </Typography>
              {canEdit && canRemoveParty(p) && (
                <AppButton
                  size="small"
                  variant="ghost"
                  loading={change.isPending}
                  dataTestId={`application.party-remove.${p.id}`}
                  onClick={() => change.mutate({ action: 'REMOVE', partyId: p.id })}
                >
                  Remove
                </AppButton>
              )}
            </Stack>
          ))}
          {!parties.isPending && current.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No parties recorded.
            </Typography>
          )}
        </Stack>
        {canEdit && (
          <FieldGrid minColumnWidth={220} spanNonFields>
            <CustomerSelect
              value={customerId}
              onChange={setCustomerId}
              label="Customer to add"
              data-testid="application.party-customer"
            />
            <TextField
              select
              size="small"
              label="Role"
              value={role}
              onChange={(e) => setRole(e.target.value as 'CO_APPLICANT' | 'GUARANTOR')}
            >
              <MenuItem value="CO_APPLICANT">Co-applicant</MenuItem>
              <MenuItem value="GUARANTOR">Guarantor</MenuItem>
            </TextField>
            <TextField
              select
              size="small"
              label="Relationship to the primary applicant"
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
            >
              <MenuItem value="">Not recorded</MenuItem>
              {RELATIONSHIPS.map((r) => (
                <MenuItem key={r} value={r}>
                  {readable(r)}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction="row" justifyContent="flex-end">
              <AppButton
                variant="primary"
                loading={change.isPending}
                disabled={!customerId}
                dataTestId="application.party-add"
                onClick={() =>
                  customerId &&
                  change.mutate(
                    {
                      action: 'ADD',
                      customerId,
                      role,
                      ...(relationship ? { relationshipToPrimary: relationship } : {}),
                    },
                    { onSuccess: () => setCustomerId(null) },
                  )
                }
              >
                Add party
              </AppButton>
            </Stack>
          </FieldGrid>
        )}
        {!canChangeParties(app.status) && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Parties can change while the application is Draft, Documents pending or Under review.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

/** The sales owner and the operations owner, changed with a reason. */
export function OwnersCard({ app }: { app: Application }) {
  const me = useMe();
  const [sales, setSales] = useState<string | null>(app.salesOwnerId);
  const [ops, setOps] = useState<string | null>(app.opsOwnerId);
  const [reason, setReason] = useState('');
  const assign = useCommand<
    { salesOwnerUserId?: string; opsOwnerUserId?: string | null; reason: string },
    Application
  >(
    () => ({ path: `/v1/applications/${app.id}/assignments`, method: 'POST', version: app.version }),
    [[`/v1/applications/${app.id}`], ['/v1/applications']],
  );
  if (!hasPermission(me.data, 'application.assign') || !canAssignOwners(app.status)) return null;

  const changed = (sales ?? null) !== app.salesOwnerId || (ops ?? null) !== app.opsOwnerId;
  const restricted = hasRestrictedNumber(reason);
  return (
    <Card sx={{ mb: 3 }} data-testid="application.owners">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Owners
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Now: sales <UserName id={app.salesOwnerId} fallback="not assigned" />, operations{' '}
          <UserName id={app.opsOwnerId} fallback="not assigned" />.
        </Typography>
        <ErrorAlert error={assign.error} />
        <FieldGrid minColumnWidth={240} spanNonFields>
          <UserSelect
            value={sales}
            onChange={setSales}
            label="Sales owner"
            data-testid="application.sales-owner"
          />
          <UserSelect
            value={ops}
            onChange={setOps}
            label="Operations owner"
            allowNone
            data-testid="application.ops-owner"
          />
          <TextField
            size="small"
            label="Reason for the change"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            error={restricted}
            helperText={restricted ? 'Do not enter PAN, Aadhaar or account numbers.' : '3 to 200 characters.'}
          />
          <Stack direction="row" justifyContent="flex-end">
            <AppButton
              variant="primary"
              loading={assign.isPending}
              disabled={!changed || !sales || !isValidAssignmentReason(reason) || restricted}
              dataTestId="application.assign"
              onClick={() =>
                assign.mutate(
                  {
                    ...(sales !== app.salesOwnerId && sales ? { salesOwnerUserId: sales } : {}),
                    ...(ops !== app.opsOwnerId ? { opsOwnerUserId: ops } : {}),
                    reason: reason.trim(),
                  },
                  { onSuccess: () => setReason('') },
                )
              }
            >
              Change owners
            </AppButton>
          </Stack>
        </FieldGrid>
      </CardContent>
    </Card>
  );
}
