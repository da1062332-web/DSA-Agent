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
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import { assignUserRole, fetchBranches, fetchRoles, fetchUserById, removeUserRole, updateUser } from './api';
import { DeleteAccountDialog } from './DeleteAccountDialog';
import { InvitationPanel } from './InvitationPanel';
import { displayStatus, userActions } from './user-actions';
import { Can } from '../../shell/Can';
import { PageHeader } from '../../ui';
import type { Branch, Role, UserSummary } from './types';

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  // Set only when the user was just created by the invitation form, and the server recorded the invitation for sending.
  const invitationSent = Boolean(
    (useLocation().state as { invitationSent?: boolean } | null)?.invitationSent,
  );

  const [user, setUser] = useState<UserSummary | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<number>(0);

  // Editable Profile fields
  const [displayName, setDisplayName] = useState<string>('');
  const [mobileE164, setMobileE164] = useState<string>('');
  const [primaryBranchId, setPrimaryBranchId] = useState<string>('');
  const [availability, setAvailability] = useState<string>('AVAILABLE');
  const [isUpdating, setIsUpdating] = useState<boolean>(false);

  // Status Dialog
  const [statusConfirmOpen, setStatusConfirmOpen] = useState<boolean>(false);
  const [deleteOpen, setDeleteOpen] = useState<boolean>(false);
  const navigate = useNavigate();
  const [pendingStatus, setPendingStatus] = useState<'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED'>('ACTIVE');

  // Role Assignment Dialog
  const [roleDialogOpen, setRoleDialogOpen] = useState<boolean>(false);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [selectedScope, setSelectedScope] = useState<string>('TENANT');
  const [isAssigningRole, setIsAssigningRole] = useState<boolean>(false);

  // Current session user ID to detect self-actions (SOD-05)
  const currentSessionUser = (() => {
    try {
      const raw = sessionStorage.getItem('dsa_auth_user') || localStorage.getItem('dsa_auth_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();
  const isSelf = currentSessionUser?.id === user?.id || currentSessionUser?.email === user?.email;

  const loadUser = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [userData, branchesList, rolesList] = await Promise.all([
        fetchUserById(id),
        fetchBranches().catch(() => []),
        fetchRoles().catch(() => []),
      ]);

      setUser(userData);
      setDisplayName(userData.displayName);
      setMobileE164(userData.mobileE164 || '');
      setPrimaryBranchId(userData.primaryBranchId);
      setAvailability(userData.availability);

      setBranches(branchesList);
      setRoles(rolesList);
    } catch (err) {
      setError((err as Error).message || 'Failed to load user details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUser();
  }, [id]);

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setSuccessMessage(null);
    setIsUpdating(true);

    try {
      const updated = await updateUser(
        user.id,
        {
          displayName: displayName.trim(),
          mobileE164: mobileE164.trim() || null,
          primaryBranchId,
          availability: availability as any,
        },
        user.lockVersion,
      );

      setUser(updated);
      setSuccessMessage('User profile updated successfully.');
    } catch (err) {
      setError((err as Error).message || 'Failed to update user profile.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleStatusChange = async () => {
    if (!user) return;
    setIsUpdating(true);
    setError(null);
    try {
      const updated = await updateUser(user.id, { status: pendingStatus }, user.lockVersion);
      setUser(updated);
      setSuccessMessage(`Account status changed to ${pendingStatus}.`);
      setStatusConfirmOpen(false);
    } catch (err) {
      setError((err as Error).message || 'Failed to update account status.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAssignRole = async () => {
    if (!user || !selectedRoleId) return;
    setIsAssigningRole(true);
    setError(null);
    try {
      await assignUserRole(user.id, selectedRoleId, selectedScope);
      setSuccessMessage('Role assigned successfully.');
      setRoleDialogOpen(false);
      setSelectedRoleId('');
      await loadUser();
    } catch (err) {
      setError((err as Error).message || 'Failed to assign role.');
    } finally {
      setIsAssigningRole(false);
    }
  };

  const handleRemoveRole = async (roleName: string) => {
    if (!user) return;
    const roleObj = roles.find((r) => r.name === roleName || r.code === roleName || r.id === roleName);
    if (!roleObj) {
      setError(`Role definition for "${roleName}" was not found.`);
      return;
    }

    if (!window.confirm(`Are you sure you want to unassign role "${roleName}"?`)) return;

    setError(null);
    try {
      await removeUserRole(user.id, roleObj.id);
      setSuccessMessage(`Role "${roleName}" unassigned.`);
      await loadUser();
    } catch (err) {
      setError((err as Error).message || 'Failed to remove role.');
    }
  };

  const getBranchName = (branchId: string) => {
    const b = branches.find((item) => item.id === branchId);
    return b ? `${b.name} (${b.code})` : branchId;
  };

  if (loading) {
    return (
      <Container maxWidth={false} disableGutters sx={{ py: 8, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (!user) {
    return (
      <Container maxWidth={false} disableGutters>
        <Alert severity="error">User not found or access denied.</Alert>
        <Button component={RouterLink} to="/users" sx={{ mt: 2 }}>
          Back to Staff Directory
        </Button>
      </Container>
    );
  }

  // Which actions this account allows (user-actions.ts, the same rules the API enforces). A deleted account allows none.
  const actions = userActions(user);

  return (
    <Container maxWidth={false} disableGutters>
      {/* Back button */}
      <Button component={RouterLink} to="/users" variant="text" sx={{ mb: 2, fontWeight: 500 }}>
        &larr; Back to Staff Directory
      </Button>

      {invitationSent && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {`${user.displayName} was invited. The invitation e-mail to ${user.email} is on its way and usually arrives within a few minutes. They become active when they set their password and sign in. If it does not arrive, use Resend invitation.`}
        </Alert>
      )}

      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar
              sx={{ width: 64, height: 64, bgcolor: 'primary.main', fontSize: '1.5rem', fontWeight: 700 }}
            >
              {user.displayName.charAt(0).toUpperCase()}
            </Avatar>
            {user.displayName}
          </Box>
        }
        subtitle={
          <>
            <Typography variant="body2" color="text.secondary">
              {user.email}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Primary Branch: <strong>{getBranchName(user.primaryBranchId)}</strong>
            </Typography>
          </>
        }
        badge={
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              label={displayStatus(user)}
              color={
                user.status === 'ACTIVE' ? 'success' : user.status === 'SUSPENDED' ? 'warning' : 'default'
              }
              sx={{ fontWeight: 600 }}
            />
            <Chip label={`Availability: ${user.availability}`} variant="outlined" />
            <Chip label={`Version: ${user.lockVersion}`} size="small" sx={{ bgcolor: 'action.hover' }} />
          </Stack>
        }
      />

      {user.deleted && (
        <Alert severity="info" sx={{ mb: 3 }} data-testid="users.detail.deleted">
          This account was deleted. Its name, e-mail address and mobile number were erased and it can never
          sign in again. It is kept only so that the leads, tasks and history it worked on stay readable, and
          it cannot be changed.
        </Alert>
      )}

      {/* Feedback Alerts */}
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

      {/* Navigation Tabs */}
      <Paper sx={{ borderRadius: 2, mb: 3 }}>
        <Tabs
          value={activeTab}
          onChange={(_e, v) => setActiveTab(v)}
          sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
        >
          <Tab label="Profile Settings" />
          <Tab label="Account Status" />
          <Tab label={`Roles (${user.assignedRoles.length})`} />
          <Tab label="Audit & Details" />
        </Tabs>
      </Paper>

      {/* TAB 0: Profile Settings */}
      {activeTab === 0 && (
        <Card sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Edit User Profile
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Update display name, contact phone, branch location, and dispatch availability.
            </Typography>

            <Box component="form" onSubmit={handleProfileSave}>
              <Grid container spacing={3}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    required
                    fullWidth
                    label="Display Name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    disabled={!actions.edit}
                    data-testid="users.detail.displayName"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    disabled
                    label="Email Address (Locked)"
                    value={user.email}
                    helperText="Email changes must be requested through identity administration."
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Mobile Number (E.164 format)"
                    value={mobileE164}
                    onChange={(e) => setMobileE164(e.target.value)}
                    disabled={!actions.edit}
                    helperText="e.g. +919876543210"
                    data-testid="users.detail.mobile"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth required>
                    <InputLabel>Primary Branch</InputLabel>
                    <Select
                      value={primaryBranchId}
                      label="Primary Branch"
                      onChange={(e) => setPrimaryBranchId(e.target.value)}
                      disabled={!actions.edit}
                    >
                      {branches.map((b) => (
                        <MenuItem key={b.id} value={b.id}>
                          {b.name} ({b.code})
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Operational Availability</InputLabel>
                    <Select
                      value={availability}
                      label="Operational Availability"
                      onChange={(e) => setAvailability(e.target.value)}
                      disabled={!actions.edit}
                    >
                      <MenuItem value="AVAILABLE">AVAILABLE</MenuItem>
                      <MenuItem value="BUSY">BUSY</MenuItem>
                      <MenuItem value="OFF_DUTY">OFF_DUTY</MenuItem>
                      <MenuItem value="ON_LEAVE">ON_LEAVE</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>

              <Box sx={{ mt: 4, display: 'flex', justifyContent: 'flex-end' }}>
                <Can action="user.manage">
                  {actions.edit && (
                    <Button
                      type="submit"
                      variant="contained"
                      size="large"
                      disabled={isUpdating}
                      data-testid="users.detail.saveProfile"
                    >
                      {isUpdating ? <CircularProgress size={24} /> : 'Save Profile Changes'}
                    </Button>
                  )}
                </Can>
              </Box>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* TAB 1: Account Status Controls */}
      {activeTab === 1 && (
        <Card sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Account Status & Security Controls
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Manage access status. Deactivated or suspended accounts are instantly barred from performing
              operations.
            </Typography>

            {isSelf && (
              <Alert severity="info" sx={{ mb: 3 }}>
                <strong>Separation of Duties Notice:</strong> You are currently viewing your own profile. You
                cannot deactivate or suspend your own account to prevent administrative lockout.
              </Alert>
            )}

            <Paper variant="outlined" sx={{ p: 3, mb: 3, borderRadius: 2 }}>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Current Status:{' '}
                <Chip
                  label={displayStatus(user)}
                  color={
                    user.status === 'ACTIVE' ? 'success' : user.status === 'SUSPENDED' ? 'warning' : 'default'
                  }
                  sx={{ ml: 1, fontWeight: 700 }}
                />
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {user.status === 'ACTIVE' &&
                  'User is active and possesses full operational access based on assigned roles.'}
                {user.status === 'INVITED' &&
                  'Invitation pending. The user becomes active after setting a password and signing in.'}
                {user.status === 'SUSPENDED' &&
                  'User is temporarily suspended. Inbound requests are rejected.'}
                {user.status === 'DEACTIVATED' &&
                  !user.deleted &&
                  'User is deactivated. Access is blocked until the account is activated again.'}
                {user.deleted && 'This account was deleted. Nothing about it can be changed.'}
              </Typography>
            </Paper>

            {user.status === 'INVITED' && (
              <Can action="user.manage">
                <Box sx={{ mb: 3 }}>
                  <InvitationPanel userId={user.id} canResend />
                </Box>
              </Can>
            )}

            <Stack direction="row" spacing={2} flexWrap="wrap">
              <Can action="user.manage">
                {/* An invited user becomes active only by signing in with their own password (D4); the API refuses it too. */}
                {actions.activate && (
                  <Button
                    variant="contained"
                    color="success"
                    onClick={() => {
                      setPendingStatus('ACTIVE');
                      setStatusConfirmOpen(true);
                    }}
                    disabled={isSelf}
                  >
                    Activate Account
                  </Button>
                )}
                {actions.suspend && (
                  <Button
                    variant="contained"
                    color="warning"
                    onClick={() => {
                      setPendingStatus('SUSPENDED');
                      setStatusConfirmOpen(true);
                    }}
                    disabled={isSelf}
                  >
                    Suspend Account
                  </Button>
                )}
                {/* Delete replaces Deactivate: the details are erased for good (DeleteAccountDialog). */}
                {actions.delete && (
                  <Button
                    variant="outlined"
                    color="error"
                    onClick={() => setDeleteOpen(true)}
                    disabled={isSelf}
                  >
                    Delete Account
                  </Button>
                )}
              </Can>
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* TAB 2: Roles & Permissions */}
      {activeTab === 2 && (
        <Card sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Box>
                <Typography variant="h6" fontWeight={600}>
                  Assigned Roles
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Roles define what operations this staff member is authorized to perform.
                </Typography>
              </Box>
              {actions.edit && (
                <Can action="role.manage">
                  <Button
                    variant="contained"
                    onClick={() => setRoleDialogOpen(true)}
                    disabled={isSelf}
                    data-testid="users.detail.addRole"
                  >
                    + Assign Role
                  </Button>
                </Can>
              )}
            </Box>

            {isSelf && (
              <Alert severity="warning" sx={{ mb: 3 }}>
                <strong>SOD-05 Enforcement:</strong> Under Separation of Duties regulations, administrators
                are prohibited from assigning or unassigning roles to their own account.
              </Alert>
            )}

            {user.assignedRoles.length === 0 ? (
              <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', borderRadius: 2 }}>
                <Typography variant="body1" color="text.secondary">
                  No roles currently assigned to this user.
                </Typography>
              </Paper>
            ) : (
              <Grid container spacing={2}>
                {user.assignedRoles.map((roleName) => (
                  <Grid item xs={12} sm={6} key={roleName}>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 2,
                        borderRadius: 2,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Box>
                        <Typography variant="subtitle2" fontWeight={600}>
                          {roleName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Active Role Assignment
                        </Typography>
                      </Box>
                      <Can action="role.manage">
                        <Button
                          size="small"
                          color="error"
                          onClick={() => handleRemoveRole(roleName)}
                          disabled={isSelf || !actions.edit}
                        >
                          Remove
                        </Button>
                      </Can>
                    </Paper>
                  </Grid>
                ))}
              </Grid>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 3: Audit & Details */}
      {activeTab === 3 && (
        <Card sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h6" fontWeight={600} gutterBottom>
              System Metadata & Audit
            </Typography>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" color="text.secondary">
                  Optimistic Concurrency Lock Version
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {user.lockVersion}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" color="text.secondary">
                  Account Type
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {user.userType}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" color="text.secondary">
                  Created Timestamp
                </Typography>
                <Typography variant="body2">{new Date(user.createdAt).toLocaleString()}</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" color="text.secondary">
                  Last Updated Timestamp
                </Typography>
                <Typography variant="body2">{new Date(user.updatedAt).toLocaleString()}</Typography>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}

      {/* Status Confirm Dialog */}
      <DeleteAccountDialog
        open={deleteOpen}
        user={user}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => navigate('/users', { replace: true })}
      />

      <Dialog open={statusConfirmOpen} onClose={() => setStatusConfirmOpen(false)}>
        <DialogTitle>Confirm Account Status Change</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to transition <strong>{user.displayName}</strong> to status{' '}
            <strong>{pendingStatus}</strong>?
          </DialogContentText>
          {pendingStatus === 'DEACTIVATED' && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              The account will be deactivated and will immediately lose all system privileges.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatusConfirmOpen(false)} disabled={isUpdating}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color={pendingStatus === 'ACTIVE' ? 'success' : 'warning'}
            onClick={handleStatusChange}
            disabled={isUpdating}
          >
            {isUpdating ? <CircularProgress size={20} /> : `Confirm ${pendingStatus}`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Role Assignment Dialog */}
      <Dialog open={roleDialogOpen} onClose={() => setRoleDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Assign Role to {user.displayName}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Select an existing tenant role to assign to this staff member.
          </DialogContentText>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth required>
              <InputLabel>Role</InputLabel>
              <Select value={selectedRoleId} label="Role" onChange={(e) => setSelectedRoleId(e.target.value)}>
                {roles.map((r) => (
                  <MenuItem key={r.id} value={r.id}>
                    {r.name} ({r.code})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Assignment Scope</InputLabel>
              <Select
                value={selectedScope}
                label="Assignment Scope"
                onChange={(e) => setSelectedScope(e.target.value)}
              >
                <MenuItem value="TENANT">TENANT (Full Organization Scope)</MenuItem>
                <MenuItem value="BRANCH">BRANCH (Scoped to Assigned Branches)</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRoleDialogOpen(false)} disabled={isAssigningRole}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleAssignRole}
            disabled={isAssigningRole || !selectedRoleId}
          >
            {isAssigningRole ? <CircularProgress size={20} /> : 'Assign Role'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
