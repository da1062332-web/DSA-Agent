import React, { useEffect, useState } from 'react';
import {
  Alert,
  Avatar,
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
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { fetchBranches, fetchUsers, updateUser } from './api';
import type { Branch, UserSummary } from './types';

export function UserListPage() {
  const navigate = useNavigate();

  const [users, setUsers] = useState<UserSummary[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [branchFilter, setBranchFilter] = useState<string>('');

  // Status toggle dialog
  const [statusDialogUser, setStatusDialogUser] = useState<UserSummary | null>(null);
  const [targetStatus, setTargetStatus] = useState<'ACTIVE' | 'DEACTIVATED' | 'SUSPENDED'>('ACTIVE');
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersResponse, branchesList] = await Promise.all([
        fetchUsers({
          status: statusFilter || undefined,
          search: search.trim() || undefined,
        }),
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

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Staff User Management
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Manage NBFC staff directory, branch allocations, account credentials, and permissions.
          </Typography>
        </Box>
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
      </Box>

      {/* Metrics Row */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardContent sx={{ py: 2 }}>
              <Typography variant="body2" color="text.secondary" fontWeight={500}>
                Total Users
              </Typography>
              <Typography variant="h5" fontWeight={700} sx={{ mt: 0.5 }}>
                {users.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardContent sx={{ py: 2 }}>
              <Typography variant="body2" color="success.main" fontWeight={500}>
                Active Users
              </Typography>
              <Typography variant="h5" fontWeight={700} sx={{ mt: 0.5 }}>
                {users.filter((u) => u.status === 'ACTIVE').length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardContent sx={{ py: 2 }}>
              <Typography variant="body2" color="warning.main" fontWeight={500}>
                Suspended / Inactive
              </Typography>
              <Typography variant="h5" fontWeight={700} sx={{ mt: 0.5 }}>
                {users.filter((u) => u.status === 'SUSPENDED' || u.status === 'DEACTIVATED').length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

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
      <Paper sx={{ p: 2, mb: 3, borderRadius: 2 }}>
        <Box component="form" onSubmit={handleSearchSubmit} sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="Search name, email, or mobile..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ flexGrow: 1, minWidth: 220 }}
            data-testid="users.search-input"
          />
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
          <Button type="submit" variant="outlined" sx={{ minWidth: 100 }}>
            Search
          </Button>
          <Button variant="text" onClick={() => { setSearch(''); setStatusFilter(''); setBranchFilter(''); void loadData(); }}>
            Reset
          </Button>
        </Box>
      </Paper>

      {/* Users Table */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : filteredUsers.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: 'center', borderRadius: 2 }}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No staff users found matching your criteria.
          </Typography>
          <Button variant="contained" component={RouterLink} to="/users/new" sx={{ mt: 2 }}>
            Create First User
          </Button>
        </Paper>
      ) : (
        <TableContainer component={Paper} sx={{ borderRadius: 2, boxShadow: 1 }}>
          <Table sx={{ minWidth: 800 }}>
            <TableHead sx={{ bgcolor: 'action.hover' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Staff Member</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Contact</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Primary Branch</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Roles</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Availability</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredUsers.map((user) => (
                <TableRow key={user.id} hover>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Avatar sx={{ bgcolor: 'primary.main', width: 38, height: 38, fontSize: '0.9rem' }}>
                        {user.displayName.charAt(0).toUpperCase()}
                      </Avatar>
                      <Box>
                        <Typography variant="body1" fontWeight={600}>
                          {user.displayName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                          {user.id}
                        </Typography>
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{user.email}</Typography>
                    {user.mobileE164 && (
                      <Typography variant="caption" color="text.secondary">
                        {user.mobileE164}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{getBranchName(user.primaryBranchId)}</Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {user.assignedRoles.length > 0 ? (
                        user.assignedRoles.map((role) => (
                          <Chip key={role} label={role} size="small" variant="outlined" sx={{ my: 0.25 }} />
                        ))
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          None
                        </Typography>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={user.status}
                      size="small"
                      color={getStatusChipColor(user.status)}
                      sx={{ fontWeight: 600 }}
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={user.availability}
                      size="small"
                      variant="outlined"
                      color={getAvailabilityChipColor(user.availability)}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => navigate(`/users/${user.id}`)}
                        data-testid={`users.view.${user.id}`}
                      >
                        View & Edit
                      </Button>
                      {user.status === 'ACTIVE' ? (
                        <Button
                          size="small"
                          color="warning"
                          onClick={() => {
                            setStatusDialogUser(user);
                            setTargetStatus('SUSPENDED');
                          }}
                        >
                          Suspend
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          color="success"
                          onClick={() => {
                            setStatusDialogUser(user);
                            setTargetStatus('ACTIVE');
                          }}
                        >
                          Activate
                        </Button>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Status Toggle Dialog */}
      <Dialog open={Boolean(statusDialogUser)} onClose={() => setStatusDialogUser(null)}>
        <DialogTitle>Confirm Status Change</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to change the account status for{' '}
            <strong>{statusDialogUser?.displayName}</strong> ({statusDialogUser?.email}) to{' '}
            <strong>{targetStatus}</strong>?
          </DialogContentText>
          {targetStatus === 'DEACTIVATED' && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              Deactivating this account will prevent the user from performing any operations in the system.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatusDialogUser(null)} disabled={actionLoading}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color={targetStatus === 'ACTIVE' ? 'success' : 'warning'}
            onClick={handleStatusChangeConfirm}
            disabled={actionLoading}
          >
            {actionLoading ? <CircularProgress size={20} /> : `Confirm ${targetStatus}`}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
