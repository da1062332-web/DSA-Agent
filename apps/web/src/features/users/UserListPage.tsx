import React, { useEffect, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { fetchBranches, fetchUsers, updateUser } from './api';
import { Can } from '../../shell/Can';
import {
  ConfirmDialog,
  DataTable,
  FilterToolbar,
  PageHeader,
  StatCard,
  StatCardGrid,
  StatusBadge,
  type ColumnDef,
} from '../../ui';
import type { Branch, UserListItem } from './types';
import { RowAction } from '../../shell/RowAction';
import { displayStatus, userActions } from './user-actions';

export function UserListPage() {
  const navigate = useNavigate();

  const [users, setUsers] = useState<UserListItem[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [branchFilter, setBranchFilter] = useState<string>('');

  // Status toggle dialog
  const [statusDialogUser, setStatusDialogUser] = useState<UserListItem | null>(null);
  const [targetStatus, setTargetStatus] = useState<'ACTIVE' | 'DEACTIVATED' | 'SUSPENDED'>('ACTIVE');
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersResponse, branchesList] = await Promise.all([
        // Deleted accounts are left out of the directory unless the "Deleted" filter asks for them.
        fetchUsers(
          statusFilter === 'DELETED'
            ? { deleted: 'only', search: search.trim() || undefined }
            : { status: statusFilter || undefined, search: search.trim() || undefined, deleted: 'exclude' },
        ),
        fetchBranches().catch(() => []),
      ]);
      setUsers(usersResponse.data);
      setBranches(branchesList);
    } catch (err) {
      setError((err as Error).message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void loadData();
  };

  const handleStatusChangeConfirm = async () => {
    if (!statusDialogUser) return;
    setActionLoading(true);
    setError(null);
    try {
      await updateUser(statusDialogUser.id, { status: targetStatus }, statusDialogUser.lockVersion);
      setSuccessMessage(`User "${statusDialogUser.displayName}" status updated to ${targetStatus}.`);
      setStatusDialogUser(null);
      await loadData();
    } catch (err) {
      setError((err as Error).message || 'Failed to update user status.');
    } finally {
      setActionLoading(false);
    }
  };

  const getBranchName = (branchId: string) => {
    const branch = branches.find((b) => b.id === branchId);
    return branch ? `${branch.name} (${branch.code})` : branchId;
  };

  const filteredUsers = users.filter((u) => {
    if (branchFilter && u.primaryBranchId !== branchFilter) return false;
    return true;
  });

  const getStatusChipColor = (status: string): 'success' | 'info' | 'warning' | 'default' => {
    switch (status) {
      case 'ACTIVE':
        return 'success';
      case 'INVITED':
        return 'info';
      case 'SUSPENDED':
        return 'warning';
      case 'DEACTIVATED':
      default:
        return 'default';
    }
  };

  const getAvailabilityChipColor = (av: string): 'success' | 'warning' | 'default' | 'secondary' => {
    switch (av) {
      case 'AVAILABLE':
        return 'success';
      case 'BUSY':
        return 'warning';
      case 'ON_LEAVE':
        return 'secondary';
      default:
        return 'default';
    }
  };

  const userColumns: ColumnDef<UserListItem>[] = [
    {
      id: 'staff',
      header: 'Staff Member',
      accessor: (user) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar sx={{ bgcolor: 'primary.main', width: 38, height: 38, fontSize: '0.9rem' }}>
            {user.displayName.charAt(0).toUpperCase()}
          </Avatar>
          <Box>
            <Typography variant="body1" fontWeight={600}>
              {user.displayName}
            </Typography>
          </Box>
        </Box>
      ),
    },
    {
      id: 'contact',
      header: 'Contact',
      accessor: (user) => (
        <Box>
          <Typography variant="body2">{user.emailMasked}</Typography>
          {user.mobileMasked && (
            <Typography variant="caption" color="text.secondary">
              {user.mobileMasked}
            </Typography>
          )}
        </Box>
      ),
    },
    {
      id: 'branch',
      header: 'Primary Branch',
      accessor: (user) => <Typography variant="body2">{getBranchName(user.primaryBranchId)}</Typography>,
    },
    {
      id: 'roles',
      header: 'Roles',
      accessor: (user) => (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          {(user.assignedRoles ?? []).length > 0 ? (
            (user.assignedRoles ?? []).map((role) => (
              <Chip key={role} label={role} size="small" variant="outlined" sx={{ my: 0.25 }} />
            ))
          ) : (
            <Typography variant="caption" color="text.secondary">
              None
            </Typography>
          )}
        </Stack>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (user) => <StatusBadge status={displayStatus(user)} dataTestId={`users.status.${user.id}`} />,
    },
    {
      id: 'availability',
      header: 'Availability',
      accessor: (user) => (
        <Chip
          label={user.availability}
          size="small"
          color={getAvailabilityChipColor(user.availability)}
          sx={{ fontWeight: 600, fontSize: '0.75rem' }}
        />
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      accessor: (user) => (
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            onClick={() => navigate(`/users/${user.id}`)}
            data-testid={`users.view.${user.id}`}
            sx={{ textTransform: 'none', borderRadius: 1.5 }}
          >
            View & Edit
          </Button>
          {/* Only the actions the API accepts (user-actions.ts): no Activate for invited users, nothing for deleted ones. */}
          {userActions(user).suspend && (
            <RowAction action="user.manage">
              <Button
                size="small"
                color="warning"
                onClick={() => {
                  setStatusDialogUser(user);
                  setTargetStatus('SUSPENDED');
                }}
                sx={{ textTransform: 'none' }}
                data-testid={`users.suspend.${user.id}`}
              >
                Suspend
              </Button>
            </RowAction>
          )}
          {userActions(user).activate && (
            <RowAction action="user.manage">
              <Button
                size="small"
                color="success"
                onClick={() => {
                  setStatusDialogUser(user);
                  setTargetStatus('ACTIVE');
                }}
                sx={{ textTransform: 'none' }}
                data-testid={`users.activate.${user.id}`}
              >
                Activate
              </Button>
            </RowAction>
          )}
        </Stack>
      ),
    },
  ];

  return (
    <Container maxWidth={false} disableGutters>
      {/* Header */}
      <PageHeader
        title="Staff User Management"
        subtitle="Manage NBFC staff directory, branch allocations, account credentials, and permissions."
        actions={
          <Can action="user.manage">
            <Button
              variant="contained"
              size="large"
              component={RouterLink}
              to="/users/new"
              sx={{ borderRadius: 2, px: 3, fontWeight: 600 }}
              data-testid="users.add-button"
            >
              + Add New User
            </Button>
          </Can>
        }
      />

      {/* Metrics Row */}
      <StatCardGrid columns={{ xs: 1, sm: 3, md: 3 }} sx={{ mb: 3 }}>
        <StatCard title="Total Users" value={users.length} subtext="Total directory headcount" />
        <StatCard
          title="Active Users"
          value={users.filter((u) => u.status === 'ACTIVE').length}
          subtext="Provisioned staff active"
          colorVariant="success"
        />
        <StatCard
          title="Suspended / Inactive"
          value={users.filter((u) => u.status === 'SUSPENDED' || u.status === 'DEACTIVATED').length}
          subtext="Requires admin review"
          colorVariant="warning"
        />
      </StatCardGrid>

      {/* Alerts */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {successMessage && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccessMessage(null)}>
          {successMessage}
        </Alert>
      )}

      {/* Filter Toolbar */}
      <FilterToolbar
        searchPlaceholder="Search name, email, or mobile..."
        searchValue={search}
        onSearchChange={setSearch}
        searchTestId="users.search-input"
        onApply={loadData}
        onReset={() => {
          setSearch('');
          setStatusFilter('');
          setBranchFilter('');
          void loadData();
        }}
        filters={
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Status</InputLabel>
              <Select
                value={statusFilter}
                label="Status"
                onChange={(e) => setStatusFilter(e.target.value)}
                data-testid="users.status-filter"
              >
                <MenuItem value="">All Statuses</MenuItem>
                <MenuItem value="ACTIVE">Active</MenuItem>
                <MenuItem value="INVITED">Invited</MenuItem>
                <MenuItem value="SUSPENDED">Suspended</MenuItem>
                <MenuItem value="DEACTIVATED">Deactivated</MenuItem>
                <MenuItem value="DELETED">Deleted</MenuItem>
              </Select>
            </FormControl>
            {branches.length > 0 && (
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel>Branch</InputLabel>
                <Select
                  value={branchFilter}
                  label="Branch"
                  onChange={(e) => setBranchFilter(e.target.value)}
                  data-testid="users.branch-filter"
                >
                  <MenuItem value="">All Branches</MenuItem>
                  {branches.map((b) => (
                    <MenuItem key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Stack>
        }
      />

      {/* Users Table */}
      <DataTable<UserListItem>
        columns={userColumns}
        data={filteredUsers}
        loading={loading}
        emptyTitle="No staff users found matching your criteria."
        emptyAction={
          <Button variant="contained" component={RouterLink} to="/users/new" sx={{ mt: 2 }}>
            Create First User
          </Button>
        }
      />

      {/* Status Toggle Dialog */}
      <ConfirmDialog
        open={Boolean(statusDialogUser)}
        title="Confirm Status Change"
        description={
          <Box>
            <Typography variant="body2" color="text.secondary">
              Are you sure you want to change the account status for{' '}
              <strong>{statusDialogUser?.displayName}</strong> ({statusDialogUser?.emailMasked}) to{' '}
              <strong>{targetStatus}</strong>?
            </Typography>
            {targetStatus === 'DEACTIVATED' && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                Deactivating this account will prevent the user from performing any operations in the system.
              </Alert>
            )}
          </Box>
        }
        confirmLabel={`Confirm ${targetStatus}`}
        severity={targetStatus === 'ACTIVE' ? 'primary' : 'warning'}
        isLoading={actionLoading}
        onConfirm={handleStatusChangeConfirm}
        onClose={() => setStatusDialogUser(null)}
      />
    </Container>
  );
}
