// apps/web/src/features/verification/VerificationListPage.tsx — owner: Developer 2
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  FormControl,
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
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchVerifications } from './api';
import type { VerificationOutcome, VerificationPriority, VerificationRequest, VerificationStatus } from './types';
import { VerificationCreateDialog } from './VerificationCreateDialog';

function getStatusColor(status: VerificationStatus): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' {
  switch (status) {
    case 'INITIATED':
      return 'info';
    case 'ASSIGNED':
      return 'primary';
    case 'IN_PROGRESS':
      return 'warning';
    case 'VERIFIED':
      return 'success';
    case 'REJECTED':
      return 'error';
    case 'WAIVED':
      return 'secondary';
    case 'CANCELLED':
      return 'default';
    default:
      return 'default';
  }
}

function getOutcomeColor(outcome?: VerificationOutcome | null): 'default' | 'success' | 'error' | 'warning' {
  switch (outcome) {
    case 'POSITIVE':
      return 'success';
    case 'NEGATIVE':
      return 'error';
    case 'REFER_TO_CREDIT':
      return 'warning';
    default:
      return 'default';
  }
}

function getPriorityColor(priority: VerificationPriority): 'default' | 'error' | 'warning' | 'info' {
  switch (priority) {
    case 'HIGH':
      return 'error';
    case 'MEDIUM':
      return 'warning';
    case 'LOW':
      return 'info';
    default:
      return 'default';
  }
}

export function VerificationListPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<VerificationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');

  // Dialog
  const [createOpen, setCreateOpen] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params: Record<string, string> = {};
      if (statusFilter !== 'ALL') params.status = statusFilter;
      if (typeFilter !== 'ALL') params.verificationType = typeFilter;
      if (priorityFilter !== 'ALL') params.priority = priorityFilter;

      const res = await fetchVerifications(params);
      setData(res.data);
    } catch (err) {
      setError((err as Error).message || 'Failed to load verification requests');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, priorityFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const verifiedCount = data.filter((v) => v.status === 'VERIFIED').length;
  const inProgressCount = data.filter((v) => v.status === 'IN_PROGRESS' || v.status === 'ASSIGNED').length;
  const pendingCount = data.filter((v) => v.status === 'INITIATED').length;

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Verification Cases (Module 19)
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Manage document attestation, identity KYC, and field investigation workflows
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button
            variant="outlined"
            onClick={() => navigate('/verifications/workbench')}
            sx={{ fontWeight: 600 }}
          >
            Workbench View
          </Button>
          <Button
            variant="contained"
            onClick={() => setCreateOpen(true)}
            data-testid="verification.btn.create"
            sx={{ fontWeight: 600 }}
          >
            + New Verification
          </Button>
        </Stack>
      </Box>

      {/* KPI Summary Cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr 1fr' }, gap: 2, mb: 3 }}>
        <Card variant="outlined">
          <CardContent sx={{ py: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Total Verifications
            </Typography>
            <Typography variant="h5" fontWeight={700}>
              {data.length}
            </Typography>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent sx={{ py: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Pending Initiation
            </Typography>
            <Typography variant="h5" fontWeight={700} color="info.main">
              {pendingCount}
            </Typography>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent sx={{ py: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Under Review / Assigned
            </Typography>
            <Typography variant="h5" fontWeight={700} color="warning.main">
              {inProgressCount}
            </Typography>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent sx={{ py: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Verified / Complete
            </Typography>
            <Typography variant="h5" fontWeight={700} color="success.main">
              {verifiedCount}
            </Typography>
          </CardContent>
        </Card>
      </Box>

      {/* Filters Bar */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="filter-status-label">Status</InputLabel>
            <Select
              labelId="filter-status-label"
              value={statusFilter}
              label="Status"
              onChange={(e) => setStatusFilter(e.target.value)}
              data-testid="verification.filter.status"
            >
              <MenuItem value="ALL">All Statuses</MenuItem>
              <MenuItem value="INITIATED">Initiated</MenuItem>
              <MenuItem value="ASSIGNED">Assigned</MenuItem>
              <MenuItem value="IN_PROGRESS">In Progress</MenuItem>
              <MenuItem value="VERIFIED">Verified</MenuItem>
              <MenuItem value="REJECTED">Rejected</MenuItem>
              <MenuItem value="WAIVED">Waived</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel id="filter-type-label">Verification Type</InputLabel>
            <Select
              labelId="filter-type-label"
              value={typeFilter}
              label="Verification Type"
              onChange={(e) => setTypeFilter(e.target.value)}
              data-testid="verification.filter.type"
            >
              <MenuItem value="ALL">All Types</MenuItem>
              <MenuItem value="DOCUMENT_REVIEW">Document Review</MenuItem>
              <MenuItem value="IDENTITY_KYC">Identity & KYC</MenuItem>
              <MenuItem value="RESIDENCE_FI">Residence FI</MenuItem>
              <MenuItem value="OFFICE_FI">Office FI</MenuItem>
              <MenuItem value="EMPLOYMENT">Employment Check</MenuItem>
              <MenuItem value="BANK_STATEMENT">Bank Statement</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel id="filter-prio-label">Priority</InputLabel>
            <Select
              labelId="filter-prio-label"
              value={priorityFilter}
              label="Priority"
              onChange={(e) => setPriorityFilter(e.target.value)}
              data-testid="verification.filter.priority"
            >
              <MenuItem value="ALL">All Priorities</MenuItem>
              <MenuItem value="HIGH">High</MenuItem>
              <MenuItem value="MEDIUM">Medium</MenuItem>
              <MenuItem value="LOW">Low</MenuItem>
            </Select>
          </FormControl>

          <Button variant="outlined" size="small" onClick={loadData} sx={{ ml: 'auto' }}>
            Refresh
          </Button>
        </Stack>
      </Paper>

      {/* Error state */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Main Table */}
      <TableContainer component={Paper} variant="outlined">
        <Table size="medium">
          <TableHead sx={{ bgcolor: 'action.hover' }}>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Verification ID</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Application ID</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Priority</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Outcome</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Assignee / Branch</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Created At</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>
                Actions
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 6 }}>
                  <CircularProgress size={32} />
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    Loading verification records...
                  </Typography>
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 6 }}>
                  <Typography variant="body1" color="text.secondary">
                    No verification records found.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              data.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{row.id}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{row.applicationId}</TableCell>
                  <TableCell>
                    <Chip label={row.verificationType.replace(/_/g, ' ')} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <Chip label={row.priority} size="small" color={getPriorityColor(row.priority)} />
                  </TableCell>
                  <TableCell>
                    <Chip label={row.status} size="small" color={getStatusColor(row.status)} />
                  </TableCell>
                  <TableCell>
                    {row.outcome ? (
                      <Chip label={row.outcome} size="small" color={getOutcomeColor(row.outcome)} />
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        —
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{row.assignedToUserId ?? 'Unassigned'}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.branchId}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{new Date(row.createdAt).toLocaleDateString()}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => navigate(`/verifications/${row.id}`)}
                      data-testid={`verification.row.view.${row.id}`}
                    >
                      View Case
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Create Dialog */}
      <VerificationCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={loadData}
      />
    </Container>
  );
}
