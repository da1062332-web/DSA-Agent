// apps/web/src/features/verification/VerificationListPage.tsx — owner: Developer 2
import {
  Box,
  Button,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchVerifications } from './api';
import type {
  VerificationRequest,
} from './types';
import { VerificationCreateDialog } from './VerificationCreateDialog';
import { Can } from '../../shell/Can';
import { ApplicationName, BranchName, UserName } from '../../shell/display';
import {
  PageHeader,
  StatCard,
  StatCardGrid,
  FilterToolbar,
  DataTable,
  StatusBadge,
  type ColumnDef,
} from '../../ui';

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

  const columns: ColumnDef<VerificationRequest>[] = [
    {
      id: 'id',
      header: 'Verification ID',
      accessor: (row) => (
        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
          {row.id}
        </Typography>
      ),
    },
    {
      id: 'applicationId',
      header: 'Application ID',
      accessor: (row) => <ApplicationName id={row.applicationId} linkToApp />,
    },
    {
      id: 'verificationType',
      header: 'Type',
      accessor: (row) => (
        <StatusBadge
          status="info"
          label={row.verificationType.replace(/_/g, ' ')}
          variant="outlined"
          dot={false}
        />
      ),
    },
    {
      id: 'priority',
      header: 'Priority',
      accessor: (row) => (
        <StatusBadge
          status={row.priority === 'HIGH' ? 'error' : row.priority === 'MEDIUM' ? 'warning' : 'info'}
          label={row.priority}
          variant="outlined"
        />
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (row) => <StatusBadge status={row.status} />,
    },
    {
      id: 'outcome',
      header: 'Outcome',
      accessor: (row) =>
        row.outcome ? (
          <StatusBadge
            status={row.outcome === 'POSITIVE' ? 'success' : row.outcome === 'NEGATIVE' ? 'error' : 'warning'}
            label={row.outcome}
          />
        ) : (
          <Typography variant="caption" color="text.secondary">
            —
          </Typography>
        ),
    },
    {
      id: 'assignee',
      header: 'Assignee / Branch',
      accessor: (row) => (
        <Box>
          <UserName id={row.assignedToUserId} fallback="Unassigned" typographyProps={{ fontWeight: 500, variant: 'body2' }} />
          <Typography variant="caption" color="text.secondary" display="block">
            <BranchName id={row.branchId} />
          </Typography>
        </Box>
      ),
    },
    {
      id: 'createdAt',
      header: 'Created At',
      accessor: (row) => (
        <Typography variant="body2">{new Date(row.createdAt).toLocaleDateString()}</Typography>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      accessor: (row) => (
        <Button
          variant="outlined"
          size="small"
          onClick={() => navigate(`/verifications/${row.id}`)}
          data-testid={`verification.row.view.${row.id}`}
          sx={{ borderRadius: 1.5, textTransform: 'none', fontWeight: 600, fontSize: 12 }}
        >
          View Case
        </Button>
      ),
    },
  ];

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header */}
      <PageHeader
        title="Verification Cases (Module 19)"
        subtitle="Manage document attestation, identity KYC, and field investigation workflows"
        actions={
          <Stack direction="row" spacing={1.5}>
            <Button
              variant="outlined"
              onClick={() => navigate('/verifications/workbench')}
              sx={{ fontWeight: 600, borderRadius: 2, textTransform: 'none' }}
            >
              Workbench View
            </Button>
            <Can action="verification.perform">
              <Button
                variant="contained"
                color="primary"
                onClick={() => setCreateOpen(true)}
                data-testid="verification.btn.create"
                sx={{ fontWeight: 700, borderRadius: 2, textTransform: 'none' }}
              >
                + New Verification
              </Button>
            </Can>
          </Stack>
        }
      />

      {/* KPI Summary Cards */}
      <StatCardGrid columns={{ xs: 12, sm: 6, md: 3 }}>
        <StatCard
          title="Total Verifications"
          value={data.length}
          status="primary"
          subtitle="All investigation cases"
        />
        <StatCard
          title="Pending Initiation"
          value={pendingCount}
          status="info"
          subtitle="Queued for assignment"
        />
        <StatCard
          title="Under Review / Assigned"
          value={inProgressCount}
          status="warning"
          subtitle="Active investigations"
        />
        <StatCard
          title="Verified / Complete"
          value={verifiedCount}
          status="success"
          subtitle="Completed outcomes"
        />
      </StatCardGrid>

      {/* Filters Bar */}
      <FilterToolbar
        onReset={loadData}
        filters={
          <>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="filter-status-label">Status</InputLabel>
              <Select
                labelId="filter-status-label"
                value={statusFilter}
                label="Status"
                onChange={(e) => setStatusFilter(e.target.value)}
                data-testid="verification.filter.status"
                sx={{ borderRadius: 2 }}
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
                sx={{ borderRadius: 2 }}
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
                sx={{ borderRadius: 2 }}
              >
                <MenuItem value="ALL">All Priorities</MenuItem>
                <MenuItem value="HIGH">High</MenuItem>
                <MenuItem value="MEDIUM">Medium</MenuItem>
                <MenuItem value="LOW">Low</MenuItem>
              </Select>
            </FormControl>

            <Button
              variant="outlined"
              size="small"
              onClick={loadData}
              sx={{ borderRadius: 1.5, textTransform: 'none', fontWeight: 600, height: 40 }}
            >
              Refresh
            </Button>
          </>
        }
      />

      {/* Main Table */}
      <DataTable<VerificationRequest>
        columns={columns}
        data={data}
        keyExtractor={(row) => row.id}
        isLoading={loading}
        isError={Boolean(error)}
        error={error}
        onRetry={loadData}
        emptyTitle="No verification records found."
        emptyDescription="There are currently no cases matching the active filters."
      />

      {/* Create Dialog */}
      <VerificationCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onSuccess={loadData} />
    </Container>
  );
}
