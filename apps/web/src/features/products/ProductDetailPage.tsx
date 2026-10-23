import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { errorText } from '../../api/client';
import { hasPermission, useMe } from '../../api/useMe';
import { createProductVersion, fetchProductById } from './api';
import type { CreateProductVersionInput, LoanProduct } from './types';

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const canManage = hasPermission(me.data, 'product.manage') || hasPermission(me.data, 'config.manage');

  const [product, setProduct] = useState<LoanProduct | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Add Version Dialog
  const [addVersionOpen, setAddVersionOpen] = useState<boolean>(false);
  const [verEffectiveFrom, setVerEffectiveFrom] = useState<string>(
    new Date().toISOString().split('T')[0] || '',
  );
  const [verAmountMin, setVerAmountMin] = useState<number>(500000);
  const [verAmountMax, setVerAmountMax] = useState<number>(50000000);
  const [verTenureMin, setVerTenureMin] = useState<number>(12);
  const [verTenureMax, setVerTenureMax] = useState<number>(240);
  const [verRateText, setVerRateText] = useState<string>('8.50% - 11.00% p.a.');
  const [verFeeText, setVerFeeText] = useState<string>('0.5% + GST');
  const [verDocProfileId, setVerDocProfileId] = useState<string>('');
  const [savingVersion, setSavingVersion] = useState<boolean>(false);
  const [versionError, setVersionError] = useState<string | null>(null);

  const loadProduct = async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const found = await fetchProductById(id);
      setProduct(found);
      if (found.activeVersion) {
        setVerAmountMin(Number(found.activeVersion.amountMin));
        setVerAmountMax(Number(found.activeVersion.amountMax));
        setVerTenureMin(found.activeVersion.tenureMin);
        setVerTenureMax(found.activeVersion.tenureMax);
        setVerRateText(found.activeVersion.illustrativeRateText || '');
        setVerFeeText(found.activeVersion.feeText || '');
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProduct();
  }, [id]);

  const handleCreateVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return;
    if (verAmountMin > verAmountMax) {
      setVersionError('Min amount cannot exceed max amount.');
      return;
    }
    try {
      setSavingVersion(true);
      setVersionError(null);
      const input: CreateProductVersionInput = {
        effectiveFrom: verEffectiveFrom,
        amountMin: verAmountMin,
        amountMax: verAmountMax,
        tenureMin: verTenureMin,
        tenureMax: verTenureMax,
        illustrativeRateText: verRateText.trim() || undefined,
        feeText: verFeeText.trim() || undefined,
        documentProfileId: verDocProfileId.trim() || undefined,
      };
      const createdVer = await createProductVersion(product.id, input);
      setSuccessMsg(`Version ${createdVer.versionNo} created successfully and pinned as active.`);
      setAddVersionOpen(false);
      await loadProduct();
    } catch (err) {
      setVersionError(errorText(err));
    } finally {
      setSavingVersion(false);
    }
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (!product) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">Loan product not found.</Alert>
        <Button component={RouterLink} to="/products" sx={{ mt: 2 }}>
          Back to Catalogue
        </Button>
      </Container>
    );
  }

  const versionsList = product.versions ?? (product.activeVersion ? [product.activeVersion] : []);

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Button component={RouterLink} to="/products" sx={{ mb: 2 }}>
        ← Back to Product Catalogue
      </Button>

      {successMsg && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg(null)}>
          {successMsg}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Product Overview Card */}
      <Card sx={{ mb: 4 }}>
        <CardHeader
          title={
            <Stack direction="row" spacing={2} alignItems="center">
              <Typography variant="h5" fontWeight={700}>
                {product.name}
              </Typography>
              <Chip label={product.category} size="small" variant="outlined" />
              <Chip
                label={product.secured ? 'Secured' : 'Unsecured'}
                size="small"
                color={product.secured ? 'primary' : 'default'}
              />
              <Chip
                label={product.status}
                size="small"
                color={product.status === 'ACTIVE' ? 'success' : 'default'}
              />
            </Stack>
          }
          subheader={`Lender: ${product.lenderName || product.lenderId} | Active Version: v${product.activeVersionNo ?? 1}`}
        />
        <Divider />
        <CardContent>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={3}>
              <Typography variant="caption" color="text.secondary">
                Loan Amount Limits
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {product.activeVersion
                  ? `₹${Number(product.activeVersion.amountMin).toLocaleString('en-IN')} – ₹${Number(product.activeVersion.amountMax).toLocaleString('en-IN')}`
                  : '—'}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={3}>
              <Typography variant="caption" color="text.secondary">
                Tenure Limits
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {product.activeVersion
                  ? `${product.activeVersion.tenureMin} – ${product.activeVersion.tenureMax} Months`
                  : '—'}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={3}>
              <Typography variant="caption" color="text.secondary">
                Illustrative Rate
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {product.activeVersion?.illustrativeRateText || 'Variable / Floating'}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={3}>
              <Typography variant="caption" color="text.secondary">
                Processing Fee
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {product.activeVersion?.feeText || 'As applicable'}
              </Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Version Management Section */}
      <Card>
        <CardHeader
          title={
            <Typography variant="h6" fontWeight={700}>
              Product Version Governance (CMP-PRD.03.1)
            </Typography>
          }
          subheader="Effective-dated, immutable versions pinned by applications and lender cases"
          action={
            canManage && (
              <Button
                variant="contained"
                size="small"
                onClick={() => {
                  setVersionError(null);
                  setAddVersionOpen(true);
                }}
              >
                Create New Version
              </Button>
            )
          }
        />
        <Divider />
        <TableContainer>
          <Table>
            <TableHead sx={{ bgcolor: 'grey.50' }}>
              <TableRow>
                <TableCell>
                  <strong>Version</strong>
                </TableCell>
                <TableCell>
                  <strong>Effective From</strong>
                </TableCell>
                <TableCell>
                  <strong>Amount Range (₹)</strong>
                </TableCell>
                <TableCell>
                  <strong>Tenure Range</strong>
                </TableCell>
                <TableCell>
                  <strong>Rate Terms</strong>
                </TableCell>
                <TableCell>
                  <strong>Fee Terms</strong>
                </TableCell>
                <TableCell>
                  <strong>Document Profile</strong>
                </TableCell>
                <TableCell>
                  <strong>Status</strong>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {versionsList.map((ver) => (
                <TableRow key={ver.id || ver.versionNo}>
                  <TableCell>
                    <Chip
                      label={`v${ver.versionNo}`}
                      size="small"
                      color={ver.versionNo === product.activeVersionNo ? 'primary' : 'default'}
                    />
                  </TableCell>
                  <TableCell>{new Date(ver.effectiveFrom).toLocaleDateString()}</TableCell>
                  <TableCell>
                    ₹{Number(ver.amountMin).toLocaleString('en-IN')} – ₹
                    {Number(ver.amountMax).toLocaleString('en-IN')}
                  </TableCell>
                  <TableCell>
                    {ver.tenureMin} – {ver.tenureMax} mos
                  </TableCell>
                  <TableCell>{ver.illustrativeRateText || '—'}</TableCell>
                  <TableCell>{ver.feeText || '—'}</TableCell>
                  <TableCell>{ver.documentProfileId || 'Default Master'}</TableCell>
                  <TableCell>
                    <Chip
                      label={ver.versionNo === product.activeVersionNo ? 'ACTIVE PINNED' : 'HISTORICAL'}
                      size="small"
                      variant="outlined"
                      color={ver.versionNo === product.activeVersionNo ? 'success' : 'default'}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Create Version Modal */}
      <Dialog open={addVersionOpen} onClose={() => setAddVersionOpen(false)} maxWidth="md" fullWidth>
        <form onSubmit={handleCreateVersion}>
          <DialogTitle>Create Immutable Product Version</DialogTitle>
          <DialogContent>
            {versionError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {versionError}
              </Alert>
            )}
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 1 }}>
              Product versions are append-only and cannot be altered once created. Applications currently
              referencing previous versions will remain pinned to their historical version.
            </Typography>

            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  required
                  fullWidth
                  type="date"
                  label="Effective From Date"
                  InputLabelProps={{ shrink: true }}
                  value={verEffectiveFrom}
                  onChange={(e) => setVerEffectiveFrom(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Document Master Profile ID"
                  placeholder="e.g. doc_profile_hl_standard"
                  value={verDocProfileId}
                  onChange={(e) => setVerDocProfileId(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  required
                  fullWidth
                  type="number"
                  label="Min Loan Amount (₹)"
                  value={verAmountMin}
                  onChange={(e) => setVerAmountMin(Math.max(0, Number(e.target.value)))}
                  inputProps={{ min: 0 }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  required
                  fullWidth
                  type="number"
                  label="Max Loan Amount (₹)"
                  value={verAmountMax}
                  onChange={(e) => setVerAmountMax(Math.max(0, Number(e.target.value)))}
                  inputProps={{ min: 0 }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  required
                  fullWidth
                  type="number"
                  label="Min Tenure (Months)"
                  value={verTenureMin}
                  onChange={(e) => setVerTenureMin(Math.max(1, Number(e.target.value)))}
                  inputProps={{ min: 1 }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  required
                  fullWidth
                  type="number"
                  label="Max Tenure (Months)"
                  value={verTenureMax}
                  onChange={(e) => setVerTenureMax(Math.max(1, Number(e.target.value)))}
                  inputProps={{ min: 1 }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Illustrative Rate Text"
                  value={verRateText}
                  onChange={(e) => setVerRateText(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Fee Text"
                  value={verFeeText}
                  onChange={(e) => setVerFeeText(e.target.value)}
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAddVersionOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={savingVersion}>
              {savingVersion ? <CircularProgress size={24} /> : 'Publish New Version'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Container>
  );
}
