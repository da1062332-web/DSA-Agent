// Property collateral card on /applications/:id (owner: Bhushan, task P1-03; migration 0111). Lists the pledged properties and,
// with application.update while the file is Draft, Documents pending or Under review, adds, edits and removes them. The value is
// typed in rupees and sent as { amount, currency }; the API stores whole paise. Each item has its own version (If-Match).
import {
  COLLATERAL_OCCUPANCY_TYPES,
  COLLATERAL_OWNERSHIP_TYPES,
  COLLATERAL_PROPERTY_TYPES,
  type CollateralView,
} from '@dsa/contracts';
import { Card, CardContent, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { hasPermission, useMe } from '../../api/useMe';
import { AppButton, ConfirmDialog, FieldGrid } from '../../ui';
import { useCommand, useLookup } from '../admin/api';
import { ErrorAlert, formatDate } from '../admin/components';
import type { Application } from './ApplicationsPage';
import {
  EMPTY_COLLATERAL,
  OCCUPANCY_LABELS,
  OWNERSHIP_LABELS,
  PROPERTY_TYPE_LABELS,
  amountToRupees,
  collateralProblem,
  toCollateralBody,
  type CollateralForm,
} from './collateral';
import { formatMoney } from './eligibility';
import { canChangeParties } from './rules';

const today = () => new Date().toISOString().slice(0, 10);

const fromItem = (c: CollateralView): CollateralForm => ({
  propertyType: c.propertyType,
  addressLine1: c.addressLine1,
  city: c.city,
  state: c.state,
  pincode: c.pincode,
  value: amountToRupees(c.estimatedMarketValue.amount),
  ownershipType: c.ownershipType,
  occupancyType: c.occupancyType ?? '',
  appraisalDate: c.appraisalDate ?? '',
});

export function CollateralCard({ app }: { app: Application }) {
  const me = useMe();
  // Same states as parties: nothing changes once the file is with a lender.
  const canEdit = hasPermission(me.data, 'application.update') && canChangeParties(app.status);
  const items = useLookup<CollateralView>(`/v1/applications/${app.id}/collateral`);
  const [form, setForm] = useState<CollateralForm>(EMPTY_COLLATERAL);
  const [editing, setEditing] = useState<CollateralView | null>(null);
  const listKey = [`/v1/applications/${app.id}/collateral`];

  const add = useCommand<ReturnType<typeof toCollateralBody>, CollateralView>(
    () => ({ path: `/v1/applications/${app.id}/collateral`, method: 'POST' }),
    [listKey],
    'Collateral added.',
  );
  const edit = useCommand<ReturnType<typeof toCollateralBody>, CollateralView>(
    () => ({
      path: `/v1/applications/${app.id}/collateral/${editing?.id}`,
      method: 'PATCH',
      version: editing?.lockVersion ?? 0,
    }),
    [listKey],
    'Collateral saved.',
  );
  const [removing, setRemoving] = useState<CollateralView | null>(null);
  const remove = useCommand<undefined, unknown>(
    () => ({
      path: `/v1/applications/${app.id}/collateral/${removing?.id}`,
      method: 'DELETE',
      version: removing?.lockVersion ?? 0,
    }),
    [listKey],
    'Collateral removed.',
  );

  const problem = collateralProblem(form, today());
  const set = (patch: Partial<CollateralForm>) => setForm((f) => ({ ...f, ...patch }));
  const reset = () => {
    setForm(EMPTY_COLLATERAL);
    setEditing(null);
  };
  // A refused edit (most often 409: someone else changed the item) leaves this screen holding an old version, and every retry
  // would be refused again. Reload the list and refill the form from the item as it is now, so the next save sends its current
  // version; the error stays on screen until then. An item removed meanwhile closes the form.
  const reloadAfterRefusedEdit = async (id: string) => {
    const fresh = (await items.refetch()).data?.find((c) => c.id === id);
    if (fresh) {
      setEditing(fresh);
      setForm(fromItem(fresh));
    } else reset();
  };
  const save = () => {
    if (problem) return;
    const body = toCollateralBody(form);
    if (editing) {
      const id = editing.id;
      edit.mutate(body, { onSuccess: reset, onError: () => void reloadAfterRefusedEdit(id) });
    } else add.mutate(body, { onSuccess: reset });
  };
  const data = items.data ?? [];

  return (
    <Card sx={{ mb: 3 }} data-testid="application.collateral">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Property collateral
        </Typography>
        <ErrorAlert error={items.error ?? add.error ?? edit.error ?? remove.error} />
        <Stack spacing={1} sx={{ mb: canEdit ? 2 : 0 }}>
          {data.map((c) => (
            <Stack
              key={c.id}
              direction="row"
              spacing={2}
              alignItems="center"
              data-testid={`application.collateral-item.${c.id}`}
            >
              <Typography variant="body2" sx={{ minWidth: 150 }}>
                {PROPERTY_TYPE_LABELS[c.propertyType]}
              </Typography>
              <Typography variant="body2" sx={{ flex: 1 }}>
                {c.addressLine1}, {c.city}, {c.state} {c.pincode} · {OWNERSHIP_LABELS[c.ownershipType]}
                {c.occupancyType ? ` · ${OCCUPANCY_LABELS[c.occupancyType]}` : ''}
                {c.appraisalDate ? ` · appraised ${formatDate(c.appraisalDate)}` : ''}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {formatMoney(c.estimatedMarketValue)}
              </Typography>
              {canEdit && (
                <>
                  <AppButton
                    size="small"
                    variant="ghost"
                    dataTestId={`application.collateral-edit.${c.id}`}
                    onClick={() => {
                      setEditing(c);
                      setForm(fromItem(c));
                    }}
                  >
                    Edit
                  </AppButton>
                  <AppButton
                    size="small"
                    variant="ghost"
                    dataTestId={`application.collateral-remove.${c.id}`}
                    onClick={() => setRemoving(c)}
                  >
                    Remove
                  </AppButton>
                </>
              )}
            </Stack>
          ))}
          {!items.isPending && data.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No property pledged.
            </Typography>
          )}
        </Stack>
        {canEdit && (
          <>
            {editing && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Editing {PROPERTY_TYPE_LABELS[editing.propertyType].toLowerCase()} at {editing.addressLine1}.
              </Typography>
            )}
            <FieldGrid minColumnWidth={220} spanNonFields>
              <TextField
                select
                size="small"
                label="Property type"
                value={form.propertyType}
                onChange={(e) => set({ propertyType: e.target.value as CollateralForm['propertyType'] })}
                inputProps={{ 'data-testid': 'application.collateral-type' }}
              >
                {COLLATERAL_PROPERTY_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>
                    {PROPERTY_TYPE_LABELS[t]}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label="Address"
                value={form.addressLine1}
                onChange={(e) => set({ addressLine1: e.target.value })}
                inputProps={{ 'data-testid': 'application.collateral-address', maxLength: 200 }}
              />
              <TextField
                size="small"
                label="City"
                value={form.city}
                onChange={(e) => set({ city: e.target.value })}
                inputProps={{ 'data-testid': 'application.collateral-city', maxLength: 80 }}
              />
              <TextField
                size="small"
                label="State"
                value={form.state}
                onChange={(e) => set({ state: e.target.value })}
                inputProps={{ 'data-testid': 'application.collateral-state', maxLength: 80 }}
              />
              <TextField
                size="small"
                label="Pincode"
                value={form.pincode}
                onChange={(e) => set({ pincode: e.target.value })}
                inputProps={{
                  'data-testid': 'application.collateral-pincode',
                  inputMode: 'numeric',
                  maxLength: 6,
                }}
              />
              <TextField
                size="small"
                label="Estimated market value (₹)"
                value={form.value}
                onChange={(e) => set({ value: e.target.value })}
                helperText="In rupees, for example 50,00,000"
                inputProps={{ 'data-testid': 'application.collateral-value', inputMode: 'decimal' }}
              />
              <TextField
                select
                size="small"
                label="Ownership"
                value={form.ownershipType}
                onChange={(e) => set({ ownershipType: e.target.value as CollateralForm['ownershipType'] })}
                inputProps={{ 'data-testid': 'application.collateral-ownership' }}
              >
                {COLLATERAL_OWNERSHIP_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>
                    {OWNERSHIP_LABELS[t]}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                label="Occupancy (optional)"
                value={form.occupancyType}
                onChange={(e) => set({ occupancyType: e.target.value as CollateralForm['occupancyType'] })}
                inputProps={{ 'data-testid': 'application.collateral-occupancy' }}
              >
                <MenuItem value="">Not recorded</MenuItem>
                {COLLATERAL_OCCUPANCY_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>
                    {OCCUPANCY_LABELS[t]}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                type="date"
                label="Appraisal date (optional)"
                value={form.appraisalDate}
                onChange={(e) => set({ appraisalDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
                inputProps={{ 'data-testid': 'application.collateral-appraisal-date', max: today() }}
              />
              <Stack direction="row" justifyContent="flex-end" spacing={1} alignItems="center">
                {editing && (
                  <AppButton variant="ghost" dataTestId="application.collateral-cancel" onClick={reset}>
                    Cancel
                  </AppButton>
                )}
                <AppButton
                  variant="primary"
                  loading={add.isPending || edit.isPending}
                  disabled={!!problem}
                  dataTestId="application.collateral-save"
                  onClick={save}
                >
                  {editing ? 'Save changes' : 'Add property'}
                </AppButton>
              </Stack>
            </FieldGrid>
            {problem && form !== EMPTY_COLLATERAL && (
              <Typography
                variant="caption"
                color="text.secondary"
                data-testid="application.collateral-problem"
              >
                {problem}
              </Typography>
            )}
          </>
        )}
        <ConfirmDialog
          open={removing !== null}
          title="Remove this property?"
          description={
            removing
              ? `${PROPERTY_TYPE_LABELS[removing.propertyType]} at ${removing.addressLine1}, ${removing.city}. It stays in the audit trail.`
              : ''
          }
          confirmLabel="Remove"
          severity="error"
          isLoading={remove.isPending}
          onClose={() => setRemoving(null)}
          onConfirm={() =>
            remove.mutate(undefined, {
              onSuccess: () => setRemoving(null),
              // Refused (for example a newer version): close the dialog and reload, so a second try sends the current version.
              onError: () => {
                setRemoving(null);
                void items.refetch();
              },
            })
          }
          dataTestId="application.collateral-remove-dialog"
          confirmTestId="application.collateral-remove-confirm"
        />
      </CardContent>
    </Card>
  );
}
