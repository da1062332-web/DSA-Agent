// Cards on /applications/:id for the rest of the loan file (owner: Dev 3; DSA Notion MODULE 16 and 20):
//   PartiesCard     API-APP-006 / 006-LIST  co-applicants and guarantors (application.update); P1-03: a co-applicant names their
//                   relationship (only those that fit the primary applicant are offered), and a new customer can be created inline.
//                   2026-11-28: the customer is found by mobile or name (POST /v1/customers/search), never picked from the whole list.
//   OwnersCard      API-APP-011             sales owner and operations owner (application.assign)
// Each card shows only what the caller's permissions and the application's status allow (rules.ts); the API re-checks everything.
import { partyRelationshipIssue, relationshipsForPrimary, type PartyRelationship } from '@dsa/contracts';
import {
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { hasPermission, useMe } from '../../api/useMe';
import { CustomerName, UserName } from '../../shell/display';
import { UserSelect } from '../../shell/selectors';
import { AppButton, FieldGrid } from '../../ui';
import { useCommand, useLookup } from '../admin/api';
import { isValidMobile } from '../leads/validation';
import { ErrorAlert } from '../admin/components';
import type { Application } from './ApplicationsPage';
import { CustomerSearchField, type FoundCustomer } from './CustomerSearchField';
import { isMobileTerm } from './customer-search';
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
const readable = (code: string) => code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ');

/** Co-applicants and guarantors. Adding one asks for their documents too while the file is collecting documents. */
export function PartiesCard({ app }: { app: Application }) {
  const me = useMe();
  const canEdit = hasPermission(me.data, 'application.update') && canChangeParties(app.status);
  const parties = useLookup<Party>(`/v1/applications/${app.id}/parties`);
  const [customer, setCustomer] = useState<FoundCustomer | null>(null);
  const customerId = customer?.id ?? null;
  const [role, setRole] = useState<'CO_APPLICANT' | 'GUARANTOR'>('CO_APPLICANT');
  const [relationship, setRelationship] = useState<PartyRelationship | ''>('');
  /** null: closed; a string: open, pre-filled with what was typed in the search. */
  const [creating, setCreating] = useState<string | null>(null);
  const canCreateCustomer = hasPermission(me.data, 'customer.create');

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
  const primaryType = current.find((p) => p.role === 'PRIMARY')?.partyType ?? 'INDIVIDUAL';
  // With the person chosen, offer only what fits both party types (a company cannot be a spouse).
  const relationships = relationshipsForPrimary(primaryType).filter(
    (r) =>
      !customer ||
      partyRelationshipIssue({
        role,
        relationship: r,
        primaryPartyType: primaryType,
        partyType: customer.partyType,
      }) === null,
  );
  // The API refuses a co-applicant without a relationship (422 REQUIRED); a guarantor may leave it out.
  const relationshipMissing = role === 'CO_APPLICANT' && !relationship;
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
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <CustomerSearchField
                value={customer}
                onChange={(c) => {
                  setCustomer(c);
                  setRelationship('');
                }}
                excludeIds={current.map((p) => p.customerId)}
                onCreateNew={canCreateCustomer ? (typed) => setCreating(typed) : undefined}
                dataTestId="application.party-customer"
              />
              {canCreateCustomer && (
                <AppButton
                  size="small"
                  variant="ghost"
                  dataTestId="application.party-new-customer"
                  onClick={() => setCreating('')}
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  New customer
                </AppButton>
              )}
            </Stack>
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
              onChange={(e) => setRelationship(e.target.value as PartyRelationship | '')}
              required={role === 'CO_APPLICANT'}
              helperText={relationshipMissing ? 'Required for a co-applicant.' : ' '}
              inputProps={{ 'data-testid': 'application.party-relationship' }}
            >
              {role === 'GUARANTOR' && <MenuItem value="">Not recorded</MenuItem>}
              {relationships.map((r) => (
                <MenuItem key={r} value={r}>
                  {readable(r)}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction="row" justifyContent="flex-end">
              <AppButton
                variant="primary"
                loading={change.isPending}
                disabled={!customerId || relationshipMissing}
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
                    {
                      onSuccess: () => {
                        setCustomer(null);
                        setRelationship('');
                      },
                    },
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
        {creating !== null && (
          <QuickCustomerDialog
            branchId={app.branchId}
            typed={creating}
            onClose={() => setCreating(null)}
            onCreated={(c) => {
              setCustomer(c);
              setCreating(null);
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

interface NewCustomerBody {
  partyType: 'INDIVIDUAL' | 'ENTITY';
  fullName: string;
  homeBranchId: string;
  primaryMobile?: string;
}

/** Creates a customer (API-CUST-001, customer.create) in the application's branch and hands its id back to the parties card. */
function QuickCustomerDialog({
  branchId,
  typed,
  onClose,
  onCreated,
}: {
  branchId: string;
  /** What was typed in the search: a mobile goes to the mobile field, anything else to the name. */
  typed: string;
  onClose: () => void;
  onCreated: (customer: FoundCustomer) => void;
}) {
  const [partyType, setPartyType] = useState<NewCustomerBody['partyType']>('INDIVIDUAL');
  const [fullName, setFullName] = useState(isMobileTerm(typed) ? '' : typed);
  const [mobile, setMobile] = useState(isMobileTerm(typed) ? typed : '');
  const create = useCommand<NewCustomerBody, FoundCustomer>(
    () => ({ path: '/v1/customers', method: 'POST' }),
    [['/v1/customers']],
    'Customer created.',
  );
  const name = fullName.trim();
  const nameProblem =
    name.length < 2 || name.length > 200
      ? 'Enter the full name (2 to 200 characters).'
      : hasRestrictedNumber(name)
        ? 'Do not enter PAN, Aadhaar or account numbers.'
        : null;
  const mobileProblem = mobile.trim() && !isValidMobile(mobile) ? 'Enter a valid mobile number.' : null;

  return (
    <Dialog open onClose={create.isPending ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>New customer</DialogTitle>
      <DialogContent>
        <ErrorAlert error={create.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            size="small"
            label="Customer type"
            value={partyType}
            onChange={(e) => setPartyType(e.target.value as NewCustomerBody['partyType'])}
          >
            <MenuItem value="INDIVIDUAL">Individual</MenuItem>
            <MenuItem value="ENTITY">Company or firm</MenuItem>
          </TextField>
          <TextField
            size="small"
            label="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            error={!!fullName && !!nameProblem}
            helperText={fullName ? (nameProblem ?? ' ') : ' '}
            inputProps={{ 'data-testid': 'application.new-customer-name', maxLength: 200 }}
          />
          <TextField
            size="small"
            label="Mobile (optional)"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            error={!!mobileProblem}
            helperText={mobileProblem ?? ' '}
            inputProps={{ 'data-testid': 'application.new-customer-mobile', inputMode: 'tel' }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <AppButton variant="ghost" disabled={create.isPending} onClick={onClose}>
          Cancel
        </AppButton>
        <AppButton
          variant="primary"
          loading={create.isPending}
          disabled={!!nameProblem || !!mobileProblem}
          dataTestId="application.new-customer-create"
          onClick={() =>
            create.mutate(
              {
                partyType,
                fullName: name,
                homeBranchId: branchId,
                ...(mobile.trim() ? { primaryMobile: mobile.trim() } : {}),
              },
              { onSuccess: (c) => onCreated({ ...c, fullName: c.fullName ?? name, partyType }) },
            )
          }
        >
          Create
        </AppButton>
      </DialogActions>
    </Dialog>
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
