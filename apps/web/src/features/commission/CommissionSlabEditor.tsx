// apps/web/src/features/commission/CommissionSlabEditor.tsx
// P2-01 / TASK-141: the lender's payout grid. A band is (product category x monthly volume) -> rate or flat amount,
// effective-dated. volumeFrom is inclusive and volumeTo exclusive, so bands tile without overlapping.
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { errorText } from '../../api/client';
import { DataTable, type ColumnDef } from '../../ui';
import { NotSet } from '../../ui/NotSet';
import { RowAction } from '../../shell/RowAction';
import {
  createCommissionPlanSlab,
  fetchCommissionPlanSlabs,
  previewCommissionSlab,
  updateCommissionPlanSlab,
} from './api';
import {
  PRODUCT_CATEGORIES,
  type CommissionPlan,
  type CommissionPlanSlab,
  type ProductCategory,
  type SlabPreviewResponse,
} from './types';

const today = () => new Date().toISOString().slice(0, 10);

/** "1250" bps reads as "12.50%" to anyone used to a rate card; the API only ever sees the integer. */
const formatBps = (bps: number) => `${(bps / 100).toFixed(2)}%`;

const formatRupees = (amount: string | null) =>
  amount === null ? null : `₹${Number(amount).toLocaleString('en-IN')}`;

/** The top band has no upper bound: "₹5,00,000 and above" rather than a made-up ceiling. */
function formatBand(slab: CommissionPlanSlab): string {
  const from = Number(slab.volumeFrom).toLocaleString('en-IN');
  if (slab.volumeTo === null) return `₹${from} and above`;
  return `₹${from} – ₹${Number(slab.volumeTo).toLocaleString('en-IN')}`;
}

export function CommissionSlabEditor({
  plan,
  canEdit,
}: {
  plan: CommissionPlan;
  canEdit: boolean;
}) {
  // An ACTIVE plan's grid is frozen: past calculations were priced on these bands, so changing one would make an
  // invoice disagree with the calculation behind it. Retire a band with an end date and add its replacement instead.
  const editable = canEdit && plan.status === 'DRAFT';

  const [slabs, setSlabs] = useState<CommissionPlanSlab[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Add-a-band form
  const [category, setCategory] = useState<ProductCategory>('PL');
  const [volumeFrom, setVolumeFrom] = useState('0');
  const [volumeTo, setVolumeTo] = useState('');
  const [rateKind, setRateKind] = useState<'RATE' | 'FLAT'>('RATE');
  const [ratePercent, setRatePercent] = useState('1.25');
  const [flatAmount, setFlatAmount] = useState('5000.00');
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Preview
  const [previewCategory, setPreviewCategory] = useState<ProductCategory>('PL');
  const [previewVolume, setPreviewVolume] = useState('1000000.00');
  const [previewBasis, setPreviewBasis] = useState('1000000.00');
  const [preview, setPreview] = useState<SlabPreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchCommissionPlanSlabs(plan.id);
      setSlabs(res.data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [plan.id]);

  useEffect(() => {
    void load();
    setPreview(null);
  }, [load]);

  const handleAddBand = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const percent = Number(ratePercent);
    if (rateKind === 'RATE' && (!Number.isFinite(percent) || percent < 0)) {
      setFormError('Enter the rate as a percentage, for example 1.25.');
      return;
    }
    // The API takes basis points, not a percentage: 1.25% is 125 bps. Rounding here keeps a typed "1.255"
    // from becoming a fraction of a basis point the database cannot hold.
    const rateBps = rateKind === 'RATE' ? Math.round(percent * 100) : null;
    try {
      setSaving(true);
      await createCommissionPlanSlab(plan.id, {
        productCategory: category,
        volumeFrom: volumeFrom.trim() || '0',
        volumeTo: volumeTo.trim() === '' ? null : volumeTo.trim(),
        rateBps,
        flatAmount: rateKind === 'FLAT' ? flatAmount.trim() : null,
        effectiveFrom,
      });
      setNotice(`Band added for ${category}.`);
      setVolumeTo('');
      await load();
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  // A band is never deleted — a calculation points at it. Ending it keeps the history and stops it matching.
  const handleRetire = async (slab: CommissionPlanSlab) => {
    try {
      setError(null);
      await updateCommissionPlanSlab(plan.id, slab.id, slab.lockVersion, { effectiveTo: today() });
      setNotice(`Band retired with effect from ${today()}. It stays on past calculations.`);
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setPreviewing(true);
      setPreviewError(null);
      setPreview(null);
      const res = await previewCommissionSlab(plan.id, {
        productCategory: previewCategory,
        monthlyVolume: previewVolume.trim(),
        basisAmount: previewBasis.trim(),
      });
      setPreview(res);
    } catch (err) {
      setPreviewError(errorText(err));
    } finally {
      setPreviewing(false);
    }
  };

  const columns: ColumnDef<CommissionPlanSlab>[] = [
    {
      id: 'productCategory',
      header: 'Product',
      accessor: (s) => <strong>{s.productCategory}</strong>,
    },
    { id: 'band', header: 'Monthly volume band', accessor: formatBand },
    {
      id: 'rate',
      header: 'Rate / flat amount',
      accessor: (s) =>
        s.rateBps !== null ? formatBps(s.rateBps) : <strong>{formatRupees(s.flatAmount)}</strong>,
    },
    { id: 'effectiveFrom', header: 'Effective from', accessor: (s) => s.effectiveFrom },
    {
      id: 'effectiveTo',
      header: 'Effective to',
      accessor: (s) => s.effectiveTo ?? <NotSet>Open</NotSet>,
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      accessor: (s) => (
        <RowAction allowed={editable && s.effectiveTo === null}>
          <Button
            size="small"
            color="warning"
            data-testid="commission.slab-retire"
            onClick={() => handleRetire(s)}
          >
            Retire
          </Button>
        </RowAction>
      ),
    },
  ];

  return (
    <Stack spacing={3}>
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}

      {!editable && canEdit && (
        <Alert severity="info" data-testid="commission.slab-frozen-notice">
          This plan is {plan.status}, so its grid is read-only. Past calculations were priced on these bands —
          retire a band and add its replacement on a new plan version rather than editing one in place.
        </Alert>
      )}

      <Card>
        <CardHeader
          title="Payout grid"
          subheader="Monthly volume decides the rate. Each band's lower bound is included and its upper bound excluded, so bands tile without overlapping."
        />
        <Divider />
        <DataTable<CommissionPlanSlab>
          columns={columns}
          data={slabs}
          loading={loading}
          emptyTitle="No bands yet. Add one below — until then a calculation for this lender has no rate to use and will be refused."
        />
      </Card>

      {editable && (
        <Card>
          <CardHeader title="Add a band" />
          <Divider />
          <CardContent>
            <form onSubmit={handleAddBand}>
              {formError && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {formError}
                </Alert>
              )}
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-start">
                <TextField
                  select
                  size="small"
                  label="Product"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ProductCategory)}
                  sx={{ minWidth: 120 }}
                  inputProps={{ 'data-testid': 'commission.slab-product' }}
                >
                  {PRODUCT_CATEGORIES.map((c) => (
                    <MenuItem key={c} value={c}>
                      {c}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  size="small"
                  label="Volume from (₹)"
                  value={volumeFrom}
                  onChange={(e) => setVolumeFrom(e.target.value)}
                  inputProps={{ 'data-testid': 'commission.slab-volume-from' }}
                />
                <TextField
                  size="small"
                  label="Volume to (₹)"
                  placeholder="Leave empty for the top band"
                  value={volumeTo}
                  onChange={(e) => setVolumeTo(e.target.value)}
                  helperText="Empty = no upper limit"
                  inputProps={{ 'data-testid': 'commission.slab-volume-to' }}
                />
                <TextField
                  select
                  size="small"
                  label="Pays"
                  value={rateKind}
                  onChange={(e) => setRateKind(e.target.value as 'RATE' | 'FLAT')}
                  sx={{ minWidth: 150 }}
                  inputProps={{ 'data-testid': 'commission.slab-rate-kind' }}
                >
                  <MenuItem value="RATE">A rate (%)</MenuItem>
                  <MenuItem value="FLAT">A flat amount</MenuItem>
                </TextField>
                {rateKind === 'RATE' ? (
                  <TextField
                    size="small"
                    label="Rate (%)"
                    value={ratePercent}
                    onChange={(e) => setRatePercent(e.target.value)}
                    helperText="1.25 = 125 bps"
                    inputProps={{ 'data-testid': 'commission.slab-rate-percent' }}
                  />
                ) : (
                  <TextField
                    size="small"
                    label="Flat amount (₹)"
                    value={flatAmount}
                    onChange={(e) => setFlatAmount(e.target.value)}
                    inputProps={{ 'data-testid': 'commission.slab-flat-amount' }}
                  />
                )}
                <TextField
                  size="small"
                  type="date"
                  label="Effective from"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  inputProps={{ 'data-testid': 'commission.slab-effective-from' }}
                />
                <Button
                  type="submit"
                  variant="contained"
                  disabled={saving}
                  data-testid="commission.slab-add"
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  {saving ? 'Adding…' : 'Add band'}
                </Button>
              </Stack>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader
          title="What would this pay?"
          subheader="Checks a volume against the grid without writing anything."
        />
        <Divider />
        <CardContent>
          <form onSubmit={handlePreview}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-start">
              <TextField
                select
                size="small"
                label="Product"
                value={previewCategory}
                onChange={(e) => setPreviewCategory(e.target.value as ProductCategory)}
                sx={{ minWidth: 120 }}
                inputProps={{ 'data-testid': 'commission.slab-preview-product' }}
              >
                {PRODUCT_CATEGORIES.map((c) => (
                  <MenuItem key={c} value={c}>
                    {c}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label="This month's volume (₹)"
                value={previewVolume}
                onChange={(e) => setPreviewVolume(e.target.value)}
                inputProps={{ 'data-testid': 'commission.slab-preview-volume' }}
              />
              <TextField
                size="small"
                label="This tranche (₹)"
                value={previewBasis}
                onChange={(e) => setPreviewBasis(e.target.value)}
                helperText="The amount the rate applies to"
                inputProps={{ 'data-testid': 'commission.slab-preview-basis' }}
              />
              <Button
                type="submit"
                variant="outlined"
                disabled={previewing}
                data-testid="commission.slab-preview"
                sx={{ whiteSpace: 'nowrap' }}
              >
                {previewing ? 'Checking…' : 'Check'}
              </Button>
            </Stack>
          </form>

          {previewError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {previewError}
            </Alert>
          )}

          {preview && (
            <Box sx={{ mt: 2 }} data-testid="commission.slab-preview-result">
              {preview.matched ? (
                <Typography variant="h6">
                  ₹{Number(previewVolume).toLocaleString('en-IN')} in {previewCategory} this month →{' '}
                  {preview.rateBps !== null ? formatBps(preview.rateBps) : formatRupees(preview.flatAmount)} →{' '}
                  <strong>{formatRupees(preview.grossAmount)}</strong>
                </Typography>
              ) : (
                <Alert severity="warning">
                  No band covers ₹{Number(previewVolume).toLocaleString('en-IN')} in {previewCategory} today. A
                  calculation at this volume would be refused rather than priced at a default rate.
                </Alert>
              )}
            </Box>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}
