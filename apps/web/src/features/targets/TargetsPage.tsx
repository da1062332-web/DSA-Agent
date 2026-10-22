// apps/web/src/features/targets/TargetsPage.tsx — owner: Dev 5 (MOD-PERF Targets UI)
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
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
import { useState } from 'react';
import { hasPermission, useMe } from '../../api/useMe';
import { BranchSelect, UserPicker } from '../admin/components';
import { useLookup } from '../admin/api';
import type { Product } from '../admin/ProductsPage';
import { useApproveTarget, useCreateTarget, useTargetHistory, useTargets } from './api';
import {
  DIMENSION_LABELS,
  METRIC_LABELS,
  formatTargetValue,
  type CreateTargetRequest,
  type DimensionType,
  type MetricCode,
  type TargetDto,
  type TargetStatus,
  type TargetUnit,
} from './types';

export function TargetsPage() {
  const { data: me } = useMe();
  const hasManage = hasPermission(me, 'target.manage');

  const [tabStatus, setTabStatus] = useState<string>('ALL');
  const [filterPeriod, setFilterPeriod] = useState<string>('');
  const [filterDimensionType, setFilterDimensionType] = useState<string>('');
  const [filterMetricCode, setFilterMetricCode] = useState<string>('');

  // Modals
  const [createOpen, setCreateOpen] = useState(false);
  const [historyTargetId, setHistoryTargetId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<TargetDto | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  // Form State
  const [period, setPeriod] = useState('2026-10');
  const [dimensionType, setDimensionType] = useState<DimensionType>('BRANCH');
  const [dimensionId, setDimensionId] = useState('');
  const [metricCode, setMetricCode] = useState<MetricCode>('DISBURSEMENT_AMOUNT');
  const [targetValue, setTargetValue] = useState<string>('5000000');
  const [formError, setFormError] = useState<string | null>(null);

  // Queries & Mutations
  const query = {
    period: filterPeriod || undefined,
    dimensionType: (filterDimensionType as DimensionType) || undefined,
    metricCode: (filterMetricCode as MetricCode) || undefined,
    status: tabStatus === 'ALL' ? undefined : (tabStatus as TargetStatus),
    limit: 20,
  };

  const { data, isLoading, isError, error } = useTargets(query);
  const { data: historyData, isLoading: historyLoading } = useTargetHistory(historyTargetId);
  const products = useLookup<Product>('/v1/products', { status: 'ACTIVE' });
  const createMutation = useCreateTarget();
  const approveMutation = useApproveTarget();

  const handleMetricChange = (newMetric: MetricCode) => {
    setMetricCode(newMetric);
    if (newMetric === 'DISBURSEMENT_AMOUNT') {
      setTargetValue('5000000');
    } else {
      setTargetValue('50');
    }
  };

  const computedUnit: TargetUnit = metricCode === 'DISBURSEMENT_AMOUNT' ? 'INR' : 'COUNT';

  const handleCreateSubmit = async () => {
    setFormError(null);
    const num = Number(targetValue);
    if (isNaN(num) || num < 0) {
      setFormError('Target value must be a valid non-negative number.');
      return;
    }
    if (!dimensionId.trim()) {
      setFormError('Dimension ID is required.');
      return;
    }

    const payload: CreateTargetRequest = {
      period,
      dimensionType,
      dimensionId: dimensionId.trim(),
      metricCode,
      targetValue: num,
      unit: computedUnit,
    };

    try {
      await createMutation.mutateAsync(payload);
      setCreateOpen(false);
      setDimensionId('');
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create target.');
    }
  };

  const handleApprove = async (target: TargetDto) => {
    try {
      await approveMutation.mutateAsync({
        id: target.id,
        version: target.lockVersion,
        input: { decision: 'APPROVE' },
      });
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Approval failed');
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectTarget) return;
    if (!rejectionReason.trim() || rejectionReason.trim().length < 3) {
      alert('Rejection reason must be at least 3 characters.');
      return;
    }

    try {
      await approveMutation.mutateAsync({
        id: rejectTarget.id,
        version: rejectTarget.lockVersion,
        input: {
          decision: 'REJECT',
          rejectionReason: rejectionReason.trim(),
        },
      });
      setRejectTarget(null);
      setRejectionReason('');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Rejection failed');
    }
  };

  const getStatusChip = (status: TargetStatus) => {
    switch (status) {
      case 'APPROVED':
        return <Chip label="Approved" color="success" size="small" variant="filled" />;
      case 'PENDING_APPROVAL':
        return <Chip label="Pending Approval" color="warning" size="small" variant="filled" />;
      case 'SUPERSEDED':
        return <Chip label="Superseded" size="small" variant="outlined" />;
      case 'REJECTED':
        return <Chip label="Rejected" color="error" size="small" variant="filled" />;
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h5" fontWeight={700} color="text.primary">
            Performance Targets (MOD-PERF SUB-PERF.01)
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Operational target setting, version revisions, and dual-control approvals (SOD-04).
          </Typography>
        </Box>
        {hasManage && (
          <Button variant="contained" color="primary" onClick={() => setCreateOpen(true)}>
            Create Target
          </Button>
        )}
      </Stack>

      {/* Tabs */}
      <Tabs
        value={tabStatus}
        onChange={(_, val) => setTabStatus(val)}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="All" value="ALL" />
        <Tab label="Pending Approval" value="PENDING_APPROVAL" />
        <Tab label="Approved" value="APPROVED" />
        <Tab label="Superseded" value="SUPERSEDED" />
        <Tab label="Rejected" value="REJECTED" />
      </Tabs>

      {/* Filter Bar */}
      <Card sx={{ p: 2, mb: 3 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField
            size="small"
            label="Period (YYYY-MM or YYYY-Q#)"
            value={filterPeriod}
            onChange={(e) => setFilterPeriod(e.target.value)}
            placeholder="e.g. 2026-10"
            sx={{ minWidth: 200 }}
          />
          <TextField
            select
            size="small"
            label="Dimension Type"
            value={filterDimensionType}
            onChange={(e) => setFilterDimensionType(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">All Dimensions</MenuItem>
            <MenuItem value="BRANCH">Branch</MenuItem>
            <MenuItem value="USER">User</MenuItem>
            <MenuItem value="PRODUCT">Loan Product</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label="Metric Code"
            value={filterMetricCode}
            onChange={(e) => setFilterMetricCode(e.target.value)}
            sx={{ minWidth: 220 }}
          >
            <MenuItem value="">All Metrics</MenuItem>
            <MenuItem value="DISBURSEMENT_AMOUNT">Disbursement Amount</MenuItem>
            <MenuItem value="LEAD_COUNT">Lead Count</MenuItem>
            <MenuItem value="SANCTION_COUNT">Sanction Count</MenuItem>
          </TextField>
        </Stack>
      </Card>

      {/* Error state */}
      {isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error?.message || 'Failed to load targets.'}
        </Alert>
      )}

      {/* Table */}
      <TableContainer component={Card}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              <TableCell>Period</TableCell>
              <TableCell>Dimension</TableCell>
              <TableCell>Dimension ID</TableCell>
              <TableCell>Metric</TableCell>
              <TableCell align="right">Target Value</TableCell>
              <TableCell>Actuals</TableCell>
              <TableCell align="center">Ver</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Created By</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={10} align="center" sx={{ py: 4 }}>
                  <Typography variant="body2" color="text.secondary">
                    Loading targets...
                  </Typography>
                </TableCell>
              </TableRow>
            ) : data?.items?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} align="center" sx={{ py: 4 }}>
                  <Typography variant="body2" color="text.secondary">
                    No targets found matching the current filters.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              data?.items?.map((item) => {
                const isCreator = me?.id === item.createdBy;
                const canApprove = item.status === 'PENDING_APPROVAL' && hasManage && !isCreator;

                return (
                  <TableRow key={item.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{item.period}</TableCell>
                    <TableCell>{DIMENSION_LABELS[item.dimensionType]}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {item.dimensionId}
                    </TableCell>
                    <TableCell>{METRIC_LABELS[item.metricCode]}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>
                      {formatTargetValue(item.targetValue, item.unit)}
                    </TableCell>
                    <TableCell>
                      <Tooltip title="Actuals computation deferred pending MOD-RPT (Reporting module)">
                        <Typography variant="caption" sx={{ fontStyle: 'italic', color: 'text.secondary' }}>
                          — (Pending MOD-RPT)
                        </Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="center">
                      <Chip label={`v${item.version}`} size="small" />
                    </TableCell>
                    <TableCell>{getStatusChip(item.status)}</TableCell>
                    <TableCell sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
                      {item.createdBy}
                    </TableCell>
                    <TableCell align="center">
                      <Stack direction="row" spacing={1} justifyContent="center">
                        {item.status === 'PENDING_APPROVAL' && (
                          <>
                            {isCreator ? (
                              <Tooltip title="Creator cannot self-approve target (Dual-Control SOD-04)">
                                <span>
                                  <Button size="small" disabled variant="outlined">
                                    Approve
                                  </Button>
                                </span>
                              </Tooltip>
                            ) : canApprove ? (
                              <>
                                <Button
                                  size="small"
                                  variant="contained"
                                  color="success"
                                  onClick={() => handleApprove(item)}
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  color="error"
                                  onClick={() => setRejectTarget(item)}
                                >
                                  Reject
                                </Button>
                              </>
                            ) : null}
                          </>
                        )}
                        <Button size="small" variant="text" onClick={() => setHistoryTargetId(item.id)}>
                          History
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Create Target Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Performance Target (API-PERF-001)</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {formError && <Alert severity="error">{formError}</Alert>}

            <TextField
              label="Period"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              helperText="Format: YYYY-MM (e.g. 2026-10) or YYYY-Q# (e.g. 2026-Q4)"
              fullWidth
              required
            />

            <TextField
              select
              label="Dimension Type"
              value={dimensionType}
              onChange={(e) => {
                setDimensionType(e.target.value as DimensionType);
                setDimensionId('');
              }}
              fullWidth
              required
            >
              <MenuItem value="BRANCH">Branch</MenuItem>
              <MenuItem value="USER">User / Agent</MenuItem>
              <MenuItem value="PRODUCT">Loan Product</MenuItem>
            </TextField>

            {dimensionType === 'BRANCH' ? (
              <BranchSelect
                required
                value={dimensionId || null}
                onChange={(id) => setDimensionId(id ?? '')}
                label="Target Branch"
              />
            ) : dimensionType === 'USER' ? (
              <UserPicker
                multiple={false}
                label="Target User / Agent"
                value={dimensionId || null}
                onChange={(id) => setDimensionId(id ?? '')}
                freeSolo
              />
            ) : dimensionType === 'PRODUCT' ? (
              <TextField
                select
                fullWidth
                required
                label="Target Loan Product"
                value={dimensionId}
                onChange={(e) => setDimensionId(e.target.value)}
              >
                {(products.data ?? []).map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name} ({p.category})
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              <TextField
                label="Dimension ID"
                value={dimensionId}
                onChange={(e) => setDimensionId(e.target.value)}
                helperText="e.g. br_01JMUMBAI... or usr_01J... or prd_01J..."
                fullWidth
                required
              />
            )}

            <TextField
              select
              label="Metric Code"
              value={metricCode}
              onChange={(e) => handleMetricChange(e.target.value as MetricCode)}
              fullWidth
              required
            >
              <MenuItem value="DISBURSEMENT_AMOUNT">Disbursement Amount (₹)</MenuItem>
              <MenuItem value="LEAD_COUNT">Lead Count</MenuItem>
              <MenuItem value="SANCTION_COUNT">Sanction Count</MenuItem>
            </TextField>

            <TextField
              label="Unit"
              value={computedUnit}
              disabled
              helperText="Automatically locked: INR for Disbursement, COUNT for Leads/Sanctions"
              fullWidth
            />

            <TextField
              type="number"
              label="Target Value"
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              fullWidth
              required
            />

            <Alert severity="info">
              Targets are created in <strong>PENDING_APPROVAL</strong> status with <strong>version 1</strong>{' '}
              (or next version if revising an existing slice). Dual-control approval is required before it
              becomes active.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating...' : 'Create Target'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reject Target Dialog */}
      <Dialog open={Boolean(rejectTarget)} onClose={() => setRejectTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Reject Performance Target</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2">
              Rejecting target for slice{' '}
              <strong>
                {rejectTarget?.period} - {rejectTarget?.metricCode}
              </strong>
              . Please state the reason:
            </Typography>
            <TextField
              label="Rejection Reason"
              multiline
              rows={3}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="e.g. Target too high for this branch given seasonal variance..."
              fullWidth
              required
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectTarget(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleRejectSubmit}
            disabled={approveMutation.isPending}
          >
            Confirm Rejection
          </Button>
        </DialogActions>
      </Dialog>

      {/* Target History Dialog */}
      <Dialog
        open={Boolean(historyTargetId)}
        onClose={() => setHistoryTargetId(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Target Slice Revision History</DialogTitle>
        <DialogContent dividers>
          {historyLoading ? (
            <Typography sx={{ py: 3 }} align="center" color="text.secondary">
              Loading revision history...
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'action.hover' }}>
                  <TableCell>Version</TableCell>
                  <TableCell>Target Value</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Approved By</TableCell>
                  <TableCell>Approved Date</TableCell>
                  <TableCell>Rejection Reason</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {historyData?.items?.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell sx={{ fontWeight: 600 }}>v{h.version}</TableCell>
                    <TableCell>{formatTargetValue(h.targetValue, h.unit)}</TableCell>
                    <TableCell>{getStatusChip(h.status)}</TableCell>
                    <TableCell>{h.approvedBy ?? '—'}</TableCell>
                    <TableCell>{h.approvedAt ? h.approvedAt.slice(0, 10) : '—'}</TableCell>
                    <TableCell>{h.rejectionReason ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryTargetId(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
