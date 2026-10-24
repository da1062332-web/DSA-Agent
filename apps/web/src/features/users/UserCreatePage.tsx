import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  Container,
  Divider,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { PageHeader } from '../../ui';
import { createUser, fetchBranches, fetchRoles } from './api';
import type { Branch, Role } from './types';

export function UserCreatePage() {
  const navigate = useNavigate();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loadingLookups, setLoadingLookups] = useState<boolean>(true);

  // Form Fields
  const [displayName, setDisplayName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [mobileE164, setMobileE164] = useState<string>('');
  const [primaryBranchId, setPrimaryBranchId] = useState<string>('');
  const [status, setStatus] = useState<'ACTIVE' | 'INVITED'>('ACTIVE');
  const [availability, setAvailability] = useState<'AVAILABLE' | 'BUSY' | 'OFF_DUTY' | 'ON_LEAVE'>(
    'AVAILABLE',
  );
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);

  // Errors & Loading
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    async function loadLookups() {
      try {
        const [branchesList, rolesList] = await Promise.all([
          fetchBranches().catch(() => []),
          fetchRoles().catch(() => []),
        ]);
        setBranches(branchesList);
        setRoles(rolesList);
        const firstBranch = branchesList[0];
        if (firstBranch) {
          setPrimaryBranchId(firstBranch.id);
        }
      } catch (_err) {
        setErrorMessage('Failed to load branches and roles options.');
      } finally {
        setLoadingLookups(false);
      }
    }
    void loadLookups();
  }, []);

  const handleRoleToggle = (roleId: string) => {
    setSelectedRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId],
    );
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!displayName.trim()) {
      errors.displayName = 'Full name is required.';
    } else if (displayName.trim().length > 100) {
      errors.displayName = 'Full name cannot exceed 100 characters.';
    }

    if (!email.trim()) {
      errors.email = 'Email address is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = 'Please enter a valid email address.';
    }

    if (mobileE164.trim() && !/^\+[1-9][0-9]{7,14}$/.test(mobileE164.trim())) {
      errors.mobileE164 = 'Must be in E.164 international format (e.g. +919876543210).';
    }

    if (!primaryBranchId) {
      errors.primaryBranchId = 'Please select a primary branch.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const created = await createUser({
        displayName: displayName.trim(),
        email: email.trim().toLowerCase(),
        mobileE164: mobileE164.trim() || null,
        primaryBranchId,
        status,
        availability,
        roleIds: selectedRoleIds,
      });

      navigate(`/users/${created.id}`);
    } catch (err) {
      setErrorMessage((err as Error).message || 'Failed to create user.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Container maxWidth="md" disableGutters sx={{ mx: 0 }}>
      {/* Navigation */}
      <Button component={RouterLink} to="/users" variant="text" sx={{ mb: 2, fontWeight: 500 }}>
        &larr; Back to Staff Directory
      </Button>

      <PageHeader
        title="Create New Staff User"
        subtitle="Provision a new user account with branch association, contact details, and role assignments."
      />

      <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
        <CardContent sx={{ p: 4 }}>

          {errorMessage && (
            <Alert severity="error" sx={{ mb: 3 }} onClose={() => setErrorMessage(null)}>
              {errorMessage}
            </Alert>
          )}

          {loadingLookups ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Box component="form" onSubmit={handleSubmit} noValidate>
              <Grid container spacing={3}>
                {/* Full Name */}
                <Grid item xs={12} sm={6}>
                  <TextField
                    required
                    fullWidth
                    label="Full Name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    error={Boolean(fieldErrors.displayName)}
                    helperText={fieldErrors.displayName || 'e.g. Rahul Sharma'}
                    data-testid="users.create.displayName"
                  />
                </Grid>

                {/* Email Address */}
                <Grid item xs={12} sm={6}>
                  <TextField
                    required
                    fullWidth
                    type="email"
                    label="Work Email Address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    error={Boolean(fieldErrors.email)}
                    helperText={fieldErrors.email || 'Unique email within this organization'}
                    data-testid="users.create.email"
                  />
                </Grid>

                {/* Mobile Number */}
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Mobile Number (E.164 format)"
                    value={mobileE164}
                    onChange={(e) => setMobileE164(e.target.value)}
                    error={Boolean(fieldErrors.mobileE164)}
                    helperText={fieldErrors.mobileE164 || 'e.g. +919876543210'}
                    data-testid="users.create.mobile"
                  />
                </Grid>

                {/* Primary Branch */}
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth required error={Boolean(fieldErrors.primaryBranchId)}>
                    <InputLabel>Primary Branch</InputLabel>
                    <Select
                      value={primaryBranchId}
                      label="Primary Branch"
                      onChange={(e) => setPrimaryBranchId(e.target.value)}
                      data-testid="users.create.branch"
                    >
                      {branches.map((b) => (
                        <MenuItem key={b.id} value={b.id}>
                          {b.name} ({b.code})
                        </MenuItem>
                      ))}
                    </Select>
                    {fieldErrors.primaryBranchId && (
                      <FormHelperText>{fieldErrors.primaryBranchId}</FormHelperText>
                    )}
                  </FormControl>
                </Grid>

                {/* Initial Status */}
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Account Status</InputLabel>
                    <Select
                      value={status}
                      label="Account Status"
                      onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'INVITED')}
                      data-testid="users.create.status"
                    >
                      <MenuItem value="ACTIVE">ACTIVE (Immediate Access)</MenuItem>
                      <MenuItem value="INVITED">INVITED (Pending Acceptance)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Initial Availability */}
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Initial Availability</InputLabel>
                    <Select
                      value={availability}
                      label="Initial Availability"
                      onChange={(e) =>
                        setAvailability(e.target.value as 'AVAILABLE' | 'BUSY' | 'OFF_DUTY' | 'ON_LEAVE')
                      }
                      data-testid="users.create.availability"
                    >
                      <MenuItem value="AVAILABLE">AVAILABLE (Receives Tasks/Leads)</MenuItem>
                      <MenuItem value="BUSY">BUSY (High Workload)</MenuItem>
                      <MenuItem value="OFF_DUTY">OFF_DUTY</MenuItem>
                      <MenuItem value="ON_LEAVE">ON_LEAVE</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Role Assignments Section */}
                <Grid item xs={12}>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="subtitle1" fontWeight={600} sx={{ mt: 1, mb: 1 }}>
                    Role Assignments
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Assign tenant roles to grant permissions for lead routing, underwriting, and origination.
                  </Typography>

                  {roles.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No roles configured in this tenant yet.
                    </Typography>
                  ) : (
                    <FormGroup row>
                      <Grid container spacing={1}>
                        {roles.map((role) => (
                          <Grid item xs={12} sm={6} key={role.id}>
                            <FormControlLabel
                              control={
                                <Checkbox
                                  checked={selectedRoleIds.includes(role.id)}
                                  onChange={() => handleRoleToggle(role.id)}
                                  data-testid={`users.create.role.${role.code}`}
                                />
                              }
                              label={
                                <Box>
                                  <Typography variant="body2" fontWeight={600}>
                                    {role.name}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {role.code} &bull; {role.permissions.length} permissions
                                  </Typography>
                                </Box>
                              }
                            />
                          </Grid>
                        ))}
                      </Grid>
                    </FormGroup>
                  )}
                </Grid>
              </Grid>

              {/* Form Actions */}
              <Box sx={{ mt: 4, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                <Button variant="outlined" component={RouterLink} to="/users" disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={isSubmitting}
                  data-testid="users.create.submit"
                >
                  {isSubmitting ? <CircularProgress size={24} /> : 'Create Staff User'}
                </Button>
              </Box>
            </Box>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
