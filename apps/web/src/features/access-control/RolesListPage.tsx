import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { createRole, deleteRole, fetchPermissions, fetchRoles } from './api';
import { Can } from '../../shell/Can';
import type { Permission, Role } from './types';

export function RolesListPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [search, setSearch] = useState<string>('');

  // Create Role Modal
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createCode, setCreateCode] = useState<string>('');
  const [createName, setCreateName] = useState<string>('');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState<boolean>(false);

  // Delete Confirmation Modal
  const [deleteRoleTarget, setDeleteRoleTarget] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [rolesRes, permsRes] = await Promise.all([fetchRoles(), fetchPermissions()]);
      setRoles(rolesRes.data);
      setPermissions(permsRes.data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load roles and permissions.');
    } finally {
      setLoading(false);
    }
  }

  const filteredRoles = roles.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.code.toLowerCase().includes(search.toLowerCase()),
  );

  function handleOpenCreate() {
    setCreateCode('ROLE-');
    setCreateName('');
    setSelectedPermissions([]);
    setCreateError(null);
    setCreateOpen(true);
  }

  function handleTogglePermission(code: string) {
    if (selectedPermissions.includes(code)) {
      setSelectedPermissions(selectedPermissions.filter((p) => p !== code));
    } else {
      setSelectedPermissions([...selectedPermissions, code]);
    }
  }

  async function handleCreateSubmit() {
    const trimmedCode = createCode.trim().toUpperCase();
    const trimmedName = createName.trim();

    if (!trimmedCode.match(/^ROLE-[A-Z-]+$/)) {
      setCreateError('Role code must follow format: ROLE-[A-Z-]+ (e.g. ROLE-CREDIT-ANALYST)');
      return;
    }
    if (!trimmedName) {
      setCreateError('Please enter a role name.');
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      await createRole({
        code: trimmedCode,
        name: trimmedName,
        permissions: selectedPermissions,
      });
      setSuccessMsg(`Role ${trimmedName} (${trimmedCode}) created successfully!`);
      setCreateOpen(false);
      await loadData();
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to create role.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteRoleTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteRole(deleteRoleTarget.id);
      setSuccessMsg(`Role ${deleteRoleTarget.name} deleted successfully.`);
      setDeleteRoleTarget(null);
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete role.');
      setDeleteRoleTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 3 }}
        flexWrap="wrap"
        gap={2}
      >
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Access Control & Roles
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage tenant roles, system permissions, and role-based access security policies.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" component={RouterLink} to="/permissions">
            View Permissions Catalog
          </Button>
          <Can action="role.manage">
            <Button variant="contained" onClick={handleOpenCreate}>
              + Create Role
            </Button>
          </Can>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {successMsg && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccessMsg(null)}>
          {successMsg}
        </Alert>
      )}

      {/* Filter and Search Bar */}
      <Card sx={{ mb: 3, p: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <TextField
            placeholder="Search roles by name or role code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            size="small"
            fullWidth
            InputProps={{
              startAdornment: <InputAdornment position="start">🔍</InputAdornment>,
            }}
          />
          <Button variant="outlined" onClick={loadData} disabled={loading}>
            Refresh
          </Button>
        </Stack>
      </Card>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : filteredRoles.length === 0 ? (
        <Alert severity="info">No roles found matching your query.</Alert>
      ) : (
        <Card sx={{ borderRadius: 2, boxShadow: 1, overflow: 'hidden' }}>
          <TableContainer>
            <Table>
              <TableHead sx={{ bgcolor: 'action.hover' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Role Name & Code</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Permissions Count</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Version</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">
                    Actions
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredRoles.map((role) => (
                  <TableRow key={role.id} hover>
                    <TableCell>
                      <Typography variant="subtitle2" fontWeight={600}>
                        {role.name}
                      </Typography>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                        {role.code}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {role.isTemplate ? (
                        <Chip label="System Template" size="small" color="primary" variant="outlined" />
                      ) : (
                        <Chip label="Custom Role" size="small" color="secondary" variant="filled" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Tooltip
                        title={
                          role.permissions.length > 0 ? role.permissions.join(', ') : 'No permissions granted'
                        }
                      >
                        <Chip
                          label={`${role.permissions.length} grants`}
                          size="small"
                          variant="outlined"
                          clickable
                        />
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={`v${role.version}`}
                        size="small"
                        variant="filled"
                        sx={{ fontSize: '0.75rem' }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <Button
                          variant="outlined"
                          size="small"
                          component={RouterLink}
                          to={`/roles/${role.id}`}
                        >
                          Configure
                        </Button>
                        {!role.isTemplate && (
                          <Can action="role.manage">
                            <Button
                              variant="outlined"
                              size="small"
                              color="error"
                              onClick={() => setDeleteRoleTarget(role)}
                            >
                              Delete
                            </Button>
                          </Can>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      {/* Create Role Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create Custom Role</DialogTitle>
        <DialogContent dividers>
          {createError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {createError}
            </Alert>
          )}
          <Stack spacing={2.5}>
            <TextField
              label="Role Code"
              helperText="Must match pattern ^ROLE-[A-Z-]+$, e.g. ROLE-CREDIT-ANALYST"
              value={createCode}
              onChange={(e) => setCreateCode(e.target.value.toUpperCase())}
              fullWidth
              required
            />
            <TextField
              label="Role Name"
              placeholder="e.g. Credit Analyst"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              fullWidth
              required
            />

            <Box>
              <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                Assign Permissions ({selectedPermissions.length} selected)
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                Select the permissions that users assigned to this role will inherit.
              </Typography>
              <Card variant="outlined" sx={{ maxHeight: 280, overflowY: 'auto', p: 1.5 }}>
                <Grid container spacing={1}>
                  {permissions.map((p) => (
                    <Grid item xs={12} sm={6} key={p.code}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={selectedPermissions.includes(p.code)}
                            onChange={() => handleTogglePermission(p.code)}
                            size="small"
                          />
                        }
                        label={
                          <Box>
                            <Typography variant="body2" fontWeight={600} sx={{ fontFamily: 'monospace' }}>
                              {p.code}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {p.description}
                            </Typography>
                          </Box>
                        }
                      />
                    </Grid>
                  ))}
                </Grid>
              </Card>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setCreateOpen(false)} disabled={creating}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleCreateSubmit} disabled={creating}>
            {creating ? 'Creating...' : 'Create Role'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Role Dialog */}
      <Dialog open={Boolean(deleteRoleTarget)} onClose={() => setDeleteRoleTarget(null)}>
        <DialogTitle>Delete Role</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to permanently delete custom role <strong>{deleteRoleTarget?.name}</strong>{' '}
            ({deleteRoleTarget?.code})?
            <br />
            <br />
            Note: Roles currently assigned to any active user cannot be deleted.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRoleTarget(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleDeleteConfirm} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Confirm Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
