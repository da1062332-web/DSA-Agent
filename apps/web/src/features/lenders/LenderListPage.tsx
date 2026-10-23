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
  DialogContentText,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
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
import { DataTable, PageHeader } from '../../ui';
import { Link as RouterLink } from 'react-router-dom';
import { errorText } from '../../api/client';
import { hasPermission, useMe } from '../../api/useMe';
import { createLender, fetchLenders, updateLender } from './api';
import type { CreateLenderInput, Lender, LenderStatus, LenderType } from './types';

export function LenderListPage() {
  const me = useMe();
  const canManage = hasPermission(me.data, 'lender.manage') || hasPermission(me.data, 'config.manage');

  const [lenders, setLenders] = useState<Lender[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');

  // Add Lender Dialog
  const [createDialogOpen, setCreateDialogOpen] = useState<boolean>(false);
  const [formName, setFormName] = useState<string>('');
  const [formType, setFormType] = useState<LenderType>('BANK');
  const [formRegulatorRef, setFormRegulatorRef] = useState<string>('');
  const [creating, setCreating] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Status Change Dialog
  const [statusDialogOpen, setStatusDialogOpen] = useState<boolean>(false);
  const [selectedLender, setSelectedLender] = useState<Lender | null>(null);
  const [targetStatus, setTargetStatus] = useState<LenderStatus>('ACTIVE');
  const [statusUpdating, setStatusUpdating] = useState<boolean>(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const loadLenders = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchLenders({
        status: statusFilter || undefined,
        type: typeFilter || undefined,
        limit: 50,
      });
      setLenders(res.data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLenders();
  }, [statusFilter, typeFilter]);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setCreateError('Lender name is required.');
      return;
    }

    try {
      setCreating(true);
      setCreateError(null);
      const input: CreateLenderInput = {
        name: formName.trim(),
        lenderType: formType,
        regulatorRef: formRegulatorRef.trim() || undefined,
      };
      await createLender(input);
      setSuccessMsg(`Lender "${formName.trim()}" created successfully.`);
      setCreateDialogOpen(false);
      setFormName('');
      setFormRegulatorRef('');
      await loadLenders();
    } catch (err) {
      setCreateError(errorText(err));
    } finally {
      setCreating(false);
    }
  };

  const handleOpenStatusDialog = (lender: Lender, nextStatus: LenderStatus) => {
    setSelectedLender(lender);
    setTargetStatus(nextStatus);
    setStatusError(null);
    setStatusDialogOpen(true);
  };

  const handleStatusSubmit = async () => {
    if (!selectedLender) return;
    try {
      setStatusUpdating(true);
      setStatusError(null);
      await updateLender(selectedLender.id, selectedLender.lockVersion, {
        status: targetStatus,
      });
      setSuccessMsg(`Lender "${selectedLender.name}" status updated to ${targetStatus}.`);
      setStatusDialogOpen(false);
      await loadLenders();
    } catch (err) {
      setStatusError(errorText(err));
    } finally {
      setStatusUpdating(false);
    }
  };

  const filteredLenders = lenders.filter((l) => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return (
      l.name.toLowerCase().includes(term) || (l.regulatorRef && l.regulatorRef.toLowerCase().includes(term))
    );
  });

  const getStatusChipColor = (status: LenderStatus) => {
    switch (status) {
      case 'ACTIVE':
        return 'success';
      case 'PAUSED':
        return 'warning';
      case 'TERMINATED':
        return 'error';
      default:
        return 'default';
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <PageHeader
        title="Lender Directory"
        subtitle="Module 14 / 28 — Lender standing, empanelment agreements, and escalation contacts"
        actions={
          canManage && (
            <Button
              variant="contained"
              color="primary"
              onClick={() => {
                setCreateError(null);
                setCreateDialogOpen(true);
              }}
            >
              Add Lender
            </Button>
          )
        }
      />

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
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                size="small"
                label="Search Lenders"
                placeholder="Name or RBI regulator ref..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Grid>
            <Grid item xs={6} sm={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Status</InputLabel>
                <Select value={statusFilter} label="Status" onChange={(e) => setStatusFilter(e.target.value)}>
                  <MenuItem value="">All Statuses</MenuItem>
                  <MenuItem value="ACTIVE">Active</MenuItem>
                  <MenuItem value="PAUSED">Paused</MenuItem>
                  <MenuItem value="TERMINATED">Terminated</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6} sm={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Type</InputLabel>
                <Select value={typeFilter} label="Type" onChange={(e) => setTypeFilter(e.target.value)}>
                  <MenuItem value="">All Types</MenuItem>
                  <MenuItem value="BANK">Bank</MenuItem>
                  <MenuItem value="NBFC">NBFC</MenuItem>
                  <MenuItem value="HFC">HFC</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={2}>
              <Button fullWidth variant="outlined" onClick={loadLenders} disabled={loading}>
                Refresh
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <DataTable<(typeof filteredLenders)[number]>
        dataTestId="lenders.table"
        loading={loading}
        data={filteredLenders}
        keyExtractor={(lender) => lender.id}
        emptyMessage="No lenders found matching the criteria."
        columns={[
          {
            id: 'name',
            header: 'Lender Name',
            render: (lender) => (
              <Typography component={RouterLink} to={`/lenders/${lender.id}`} sx={{ fontWeight: 600, color: 'primary.main', textDecoration: 'none' }}>
                {lender.name}
              </Typography>
            ),
          },
          { id: 'type', header: 'Type', render: (lender) => <Chip label={lender.lenderType} size="small" variant="outlined" /> },
          { id: 'regulator', header: 'Regulator Ref', render: (lender) => lender.regulatorRef || '—' },
          {
            id: 'status',
            header: 'Status',
            render: (lender) => <Chip label={lender.status} size="small" color={getStatusChipColor(lender.status)} />,
          },
          { id: 'empanelments', header: 'Empanelments', render: (lender) => lender.empanelments?.length ?? 0 },
          {
            id: 'actions',
            header: 'Actions',
            align: 'right',
            render: (lender) => (
              <Stack direction="row" spacing={1} justifyContent="flex-end">
                <Button size="small" component={RouterLink} to={`/lenders/${lender.id}`} variant="outlined">
                  Manage
                </Button>
                {canManage && lender.status === 'ACTIVE' && (
                  <Button size="small" color="warning" onClick={() => handleOpenStatusDialog(lender, 'PAUSED')}>
                    Pause
                  </Button>
                )}
                {canManage && lender.status === 'PAUSED' && (
                  <Button size="small" color="success" onClick={() => handleOpenStatusDialog(lender, 'ACTIVE')}>
                    Activate
                  </Button>
                )}
              </Stack>
            ),
          },
        ]}
      />

      {/* Create Lender Modal */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleCreateSubmit}>
          <DialogTitle>Add New Lender</DialogTitle>
          <DialogContent>
            {createError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {createError}
              </Alert>
            )}
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                required
                fullWidth
                label="Lender Legal Name"
                placeholder="e.g. HDFC Bank, ICICI Bank, Bajaj Housing Finance"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
              <FormControl fullWidth>
                <InputLabel>Lender Type</InputLabel>
                <Select
                  value={formType}
                  label="Lender Type"
                  onChange={(e) => setFormType(e.target.value as LenderType)}
                >
                  <MenuItem value="BANK">Commercial Bank</MenuItem>
                  <MenuItem value="NBFC">NBFC</MenuItem>
                  <MenuItem value="HFC">Housing Finance Company (HFC)</MenuItem>
                </Select>
              </FormControl>
              <TextField
                fullWidth
                label="RBI / Regulator Reference"
                placeholder="e.g. RBI/NBFC/ND-SI/0452"
                value={formRegulatorRef}
                onChange={(e) => setFormRegulatorRef(e.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={creating}>
              {creating ? <CircularProgress size={24} /> : 'Create Lender'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Change Status Modal */}
      <Dialog open={statusDialogOpen} onClose={() => setStatusDialogOpen(false)}>
        <DialogTitle>Confirm Status Change</DialogTitle>
        <DialogContent>
          {statusError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {statusError}
            </Alert>
          )}
          <DialogContentText>
            Are you sure you want to transition lender <strong>{selectedLender?.name}</strong> to{' '}
            <strong>{targetStatus}</strong>?
            {targetStatus === 'PAUSED' && (
              <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
                Warning: When a lender is PAUSED, loan origination gates block case creation with 422
                LENDER_PAUSED.
              </Typography>
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatusDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleStatusSubmit}
            variant="contained"
            color={targetStatus === 'PAUSED' ? 'warning' : 'primary'}
            disabled={statusUpdating}
          >
            {statusUpdating ? <CircularProgress size={24} /> : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
