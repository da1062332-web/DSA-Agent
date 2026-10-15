import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { errorText } from '../../api/client';
import { hasPermission, useMe } from '../../api/useMe';
import { fetchLenders } from '../lenders/api';
import type { Lender } from '../lenders/types';
import { createProduct, fetchProducts, updateProductStatus } from './api';
import type {
  CreateProductInput,
  LoanProduct,
  ProductCategory,
  ProductStatus,
} from './types';

export function ProductCataloguePage() {
  const me = useMe();
  const canManage = hasPermission(me.data, 'config.manage');

  const [products, setProducts] = useState<LoanProduct[]>([]);
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [lenderFilter, setLenderFilter] = useState<string>('');

  // Create Product Dialog
  const [createDialogOpen, setCreateDialogOpen] = useState<boolean>(false);
  const [formLenderId, setFormLenderId] = useState<string>('');
  const [formName, setFormName] = useState<string>('');
  const [formCategory, setFormCategory] = useState<ProductCategory>('HOME_LOAN');
  const [formApplicantTypes] = useState<string[]>(['SALARIED', 'SELF_EMPLOYED']);
  const [formSecured, setFormSecured] = useState<boolean>(true);
  const [formAmountMin, setFormAmountMin] = useState<number>(500000);
  const [formAmountMax, setFormAmountMax] = useState<number>(50000000);
  const [formTenureMin, setFormTenureMin] = useState<number>(12);
  const [formTenureMax, setFormTenureMax] = useState<number>(240);
  const [formRateText, setFormRateText] = useState<string>('8.50% - 11.00% p.a.');
  const [formFeeText, setFormFeeText] = useState<string>('0.5% + GST');
  const [creating, setCreating] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [prodRes, lendRes] = await Promise.all([
        fetchProducts({
          category: categoryFilter || undefined,
          status: statusFilter || undefined,
          lenderId: lenderFilter || undefined,
          limit: 100,
        }),
        fetchLenders({ limit: 100 }),
      ]);
      setProducts(prodRes.data);
      setLenders(lendRes.data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [categoryFilter, statusFilter, lenderFilter]);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formLenderId) {
      setCreateError('Please select a lender.');
      return;
    }
    if (!formName.trim()) {
      setCreateError('Product name is required.');
      return;
    }
    if (formAmountMin > formAmountMax) {
      setCreateError('Minimum amount cannot exceed maximum amount.');
      return;
    }

    try {
      setCreating(true);
      setCreateError(null);
      const input: CreateProductInput = {
        lenderId: formLenderId,
        name: formName.trim(),
        category: formCategory,
        applicantTypes: formApplicantTypes,
        secured: formSecured,
        amountMin: formAmountMin,
        amountMax: formAmountMax,
        tenureMin: formTenureMin,
        tenureMax: formTenureMax,
        illustrativeRateText: formRateText.trim() || undefined,
        feeText: formFeeText.trim() || undefined,
      };
      await createProduct(input);
      setSuccessMsg(`Loan product "${formName.trim()}" created with initial version 1.`);
      setCreateDialogOpen(false);
      setFormName('');
      await loadData();
    } catch (err) {
      setCreateError(errorText(err));
    } finally {
      setCreating(false);
    }
  };

  const handleToggleStatus = async (product: LoanProduct) => {
    const nextStatus: ProductStatus = product.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      setError(null);
      await updateProductStatus(product.id, nextStatus);
      setSuccessMsg(`Product "${product.name}" status updated to ${nextStatus}.`);
      await loadData();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const selectedLenderObj = lenders.find((l) => l.id === formLenderId);

  const filteredProducts = products.filter((p) => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(term) ||
      (p.lenderName && p.lenderName.toLowerCase().includes(term))
    );
  });

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Loan Product Catalogue
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Module 15 / 29 — Lender product catalogue, parameter ranges, and immutable version governance
          </Typography>
        </Box>
        {canManage && (
          <Button
            variant="contained"
            color="primary"
            onClick={() => {
              setCreateError(null);
              setCreateDialogOpen(true);
            }}
          >
            Add Loan Product
          </Button>
        )}
      </Stack>

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

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={3}>
              <TextField
                fullWidth
                size="small"
                label="Search Products"
                placeholder="Product or lender name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Grid>
            <Grid item xs={6} sm={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Category</InputLabel>
                <Select
                  value={categoryFilter}
                  label="Category"
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <MenuItem value="">All Categories</MenuItem>
                  <MenuItem value="HOME_LOAN">Home Loan</MenuItem>
                  <MenuItem value="LAP">Loan Against Property</MenuItem>
                  <MenuItem value="BUSINESS_LOAN">Business Loan</MenuItem>
                  <MenuItem value="PERSONAL_LOAN">Personal Loan</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6} sm={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Lender</InputLabel>
                <Select
                  value={lenderFilter}
                  label="Lender"
                  onChange={(e) => setLenderFilter(e.target.value)}
                >
                  <MenuItem value="">All Lenders</MenuItem>
                  {lenders.map((l) => (
                    <MenuItem key={l.id} value={l.id}>
                      {l.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6} sm={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Status</InputLabel>
                <Select
                  value={statusFilter}
                  label="Status"
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <MenuItem value="">All Statuses</MenuItem>
                  <MenuItem value="ACTIVE">Active</MenuItem>
                  <MenuItem value="INACTIVE">Inactive</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6} sm={1}>
              <Button fullWidth variant="outlined" onClick={loadData} disabled={loading}>
                ↻
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <TableContainer component={Paper}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}>
            <CircularProgress />
          </Box>
        ) : filteredProducts.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="body1" color="text.secondary">
              No products found matching the search criteria.
            </Typography>
          </Box>
        ) : (
          <Table>
            <TableHead sx={{ bgcolor: 'grey.100' }}>
              <TableRow>
                <TableCell><strong>Product Name</strong></TableCell>
                <TableCell><strong>Lender</strong></TableCell>
                <TableCell><strong>Category</strong></TableCell>
                <TableCell><strong>Security</strong></TableCell>
                <TableCell><strong>Amount Range (₹)</strong></TableCell>
                <TableCell><strong>Tenure (Months)</strong></TableCell>
                <TableCell><strong>Active Ver</strong></TableCell>
                <TableCell><strong>Status</strong></TableCell>
                <TableCell align="right"><strong>Actions</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredProducts.map((p) => (
                <TableRow key={p.id} hover>
                  <TableCell>
                    <Typography
                      component={RouterLink}
                      to={`/products/${p.id}`}
                      sx={{ fontWeight: 600, color: 'primary.main', textDecoration: 'none' }}
                    >
                      {p.name}
                    </Typography>
                  </TableCell>
                  <TableCell>{p.lenderName || p.lenderId}</TableCell>
                  <TableCell>
                    <Chip label={p.category} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={p.secured ? 'Secured' : 'Unsecured'}
                      size="small"
                      color={p.secured ? 'primary' : 'default'}
                    />
                  </TableCell>
                  <TableCell>
                    {p.activeVersion
                      ? `₹${Number(p.activeVersion.amountMin).toLocaleString('en-IN')} – ₹${Number(p.activeVersion.amountMax).toLocaleString('en-IN')}`
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {p.activeVersion
                      ? `${p.activeVersion.tenureMin} – ${p.activeVersion.tenureMax}`
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <Chip label={`v${p.activeVersionNo ?? 1}`} size="small" />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={p.status}
                      size="small"
                      color={p.status === 'ACTIVE' ? 'success' : 'default'}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button
                        size="small"
                        component={RouterLink}
                        to={`/products/${p.id}`}
                        variant="outlined"
                      >
                        Versions
                      </Button>
                      {canManage && (
                        <Button
                          size="small"
                          color={p.status === 'ACTIVE' ? 'warning' : 'success'}
                          onClick={() => handleToggleStatus(p)}
                        >
                          {p.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                        </Button>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableContainer>

      {/* Create Product Modal */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="md" fullWidth>
        <form onSubmit={handleCreateSubmit}>
          <DialogTitle>Add New Loan Product</DialogTitle>
          <DialogContent>
            {createError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {createError}
              </Alert>
            )}

            {selectedLenderObj && selectedLenderObj.status === 'PAUSED' && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                Notice: The selected lender is currently <strong>PAUSED</strong>. Product creation is blocked by gate rule <code>LENDER_PAUSED</code>.
              </Alert>
            )}

            <Grid container spacing={2} sx={{ mt: 0.5 }}>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth required>
                  <InputLabel>Select Lender</InputLabel>
                  <Select
                    value={formLenderId}
                    label="Select Lender"
                    onChange={(e) => setFormLenderId(e.target.value)}
                  >
                    {lenders.map((l) => (
                      <MenuItem key={l.id} value={l.id}>
                        {l.name} ({l.status})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  required
                  fullWidth
                  label="Product Name"
                  placeholder="e.g. Premium Home Loan, Standard LAP"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Product Category</InputLabel>
                  <Select
                    value={formCategory}
                    label="Product Category"
                    onChange={(e) => setFormCategory(e.target.value as ProductCategory)}
                  >
                    <MenuItem value="HOME_LOAN">Home Loan</MenuItem>
                    <MenuItem value="LAP">Loan Against Property (LAP)</MenuItem>
                    <MenuItem value="BUSINESS_LOAN">Business Loan</MenuItem>
                    <MenuItem value="PERSONAL_LOAN">Personal Loan</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formSecured}
                      onChange={(e) => setFormSecured(e.target.checked)}
                    />
                  }
                  label="Secured Facility"
                  sx={{ mt: 1 }}
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  required
                  fullWidth
                  type="number"
                  label="Min Loan Amount (₹)"
                  value={formAmountMin}
                  onChange={(e) => setFormAmountMin(Number(e.target.value))}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  required
                  fullWidth
                  type="number"
                  label="Max Loan Amount (₹)"
                  value={formAmountMax}
                  onChange={(e) => setFormAmountMax(Number(e.target.value))}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  required
                  fullWidth
                  type="number"
                  label="Min Tenure (Months)"
                  value={formTenureMin}
                  onChange={(e) => setFormTenureMin(Number(e.target.value))}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  required
                  fullWidth
                  type="number"
                  label="Max Tenure (Months)"
                  value={formTenureMax}
                  onChange={(e) => setFormTenureMax(Number(e.target.value))}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Illustrative Interest Rate"
                  value={formRateText}
                  onChange={(e) => setFormRateText(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Processing Fee Text"
                  value={formFeeText}
                  onChange={(e) => setFormFeeText(e.target.value)}
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={creating}>
              {creating ? <CircularProgress size={24} /> : 'Create Product'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Container>
  );
}
