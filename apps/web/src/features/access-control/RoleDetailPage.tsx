import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  Divider,
  FormControlLabel,
  Grid,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { deleteRole, fetchPermissions, fetchRoleById, updateRole } from './api';
import { Can } from '../../shell/Can';
import type { Permission, Role } from './types';

export function RoleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [role, setRole] = useState<Role | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState<string>('');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

  useEffect(() => {
    if (id) {
      loadRole(id);
    }
  }, [id]);

  async function loadRole(roleId: string) {
    setLoading(true);
    setError(null);
    try {
      const [roleRes, permsRes] = await Promise.all([fetchRoleById(roleId), fetchPermissions()]);
      setRole(roleRes.data);
      setEtag(roleRes.etag);
      setName(roleRes.data.name);
      setSelectedPermissions(roleRes.data.permissions);
      setPermissions(permsRes.data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load role details.');
    } finally {
      setLoading(false);
    }
  }

  function handleTogglePermission(code: string) {
    if (selectedPermissions.includes(code)) {
      setSelectedPermissions(selectedPermissions.filter((p) => p !== code));
    } else {
      setSelectedPermissions([...selectedPermissions, code]);
    }
  }

  function handleSelectAllDomain(domain: string) {
    const domainPerms = permissions.filter((p) => p.code.startsWith(domain + '.')).map((p) => p.code);
    const allSelected = domainPerms.every((c) => selectedPermissions.includes(c));
    if (allSelected) {
      setSelectedPermissions(selectedPermissions.filter((c) => !domainPerms.includes(c)));
    } else {
      setSelectedPermissions(Array.from(new Set([...selectedPermissions, ...domainPerms])));
    }
  }

  async function handleSave() {
    if (!id || !role) return;
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const updated = await updateRole(
        id,
        {
          name: name.trim(),
          permissions: selectedPermissions,
        },
        etag || undefined,
      );
      setRole(updated);
      setSuccessMsg(`Role ${updated.name} updated successfully! (Version ${updated.version})`);
      // Reload role to get fresh ETag
      await loadRole(id);
    } catch (err: any) {
      setError(err?.message || 'Failed to update role.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!id || !role || role.isTemplate) return;
    if (!window.confirm(`Are you sure you want to delete role "${role.name}"?`)) return;

    setSaving(true);
    setError(null);
    try {
      await deleteRole(id);
      navigate('/roles', { replace: true });
    } catch (err: any) {
      setError(err?.message || 'Failed to delete role.');
      setSaving(false);
    }
  }

  // Group permissions by prefix/domain
  const domains: string[] = Array.from(new Set(permissions.map((p) => p.code.split('.')[0])))
    .filter((d): d is string => Boolean(d))
    .sort();

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!role) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Alert severity="error">Role not found.</Alert>
        <Button sx={{ mt: 2 }} variant="outlined" component={RouterLink} to="/roles">
          &larr; Back to Roles
        </Button>
      </Container>
    );
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
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Typography variant="h4" fontWeight={700}>
              {role.name}
            </Typography>
            {role.isTemplate ? (
              <Chip label="System Template" color="primary" variant="outlined" size="small" />
            ) : (
              <Chip label="Custom Role" color="secondary" variant="filled" size="small" />
            )}
            <Chip label={`v${role.version}`} size="small" variant="outlined" />
          </Stack>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.secondary', mt: 0.5 }}>
            {role.code} &bull; ID: {role.id}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" component={RouterLink} to="/roles">
            &larr; Back to Roles
          </Button>
          {!role.isTemplate && (
            <Can action="role.manage">
              <Button variant="outlined" color="error" onClick={handleDelete} disabled={saving}>
                Delete Role
              </Button>
            </Can>
          )}
          <Can action="role.manage">
            <Button variant="contained" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
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

      <Grid container spacing={3}>
        {/* Role Metadata Form */}
        <Grid item xs={12} md={4}>
          <Card sx={{ borderRadius: 2, boxShadow: 1, height: '100%' }}>
            <CardHeader title="Role Profile" subheader="Configure basic attributes" />
            <Divider />
            <CardContent>
              <Stack spacing={2.5}>
                <TextField
                  label="Role Code"
                  value={role.code}
                  disabled
                  fullWidth
                  helperText="Unique role code (system generated and immutable)"
                />
                <TextField
                  label="Role Display Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  fullWidth
                  required
                />
                <TextField
                  label="Concurrency Version"
                  value={role.version}
                  disabled
                  fullWidth
                  helperText="Optimistic lock version (ETag guarded)"
                />
                <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1.5 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Permissions Assigned: <strong>{selectedPermissions.length}</strong> of{' '}
                    {permissions.length}
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Permissions Matrix */}
        <Grid item xs={12} md={8}>
          <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
            <CardHeader
              title="Permissions Matrix"
              subheader="Toggle platform capabilities granted by this role"
              action={
                <Button size="small" onClick={() => setSelectedPermissions(permissions.map((p) => p.code))}>
                  Select All
                </Button>
              }
            />
            <Divider />
            <CardContent>
              <Stack spacing={3}>
                {domains.map((dom) => {
                  const domPerms = permissions.filter((p) => p.code.startsWith(dom + '.'));
                  const countSelected = domPerms.filter((p) => selectedPermissions.includes(p.code)).length;
                  return (
                    <Box
                      key={dom}
                      sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2 }}
                    >
                      <Stack
                        direction="row"
                        justifyContent="space-between"
                        alignItems="center"
                        sx={{ mb: 1.5 }}
                      >
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography
                            variant="subtitle1"
                            fontWeight={700}
                            sx={{ textTransform: 'capitalize' }}
                          >
                            {dom} Module
                          </Typography>
                          <Chip
                            label={`${countSelected}/${domPerms.length}`}
                            size="small"
                            color={countSelected > 0 ? 'primary' : 'default'}
                            variant="outlined"
                          />
                        </Stack>
                        <Button size="small" variant="text" onClick={() => handleSelectAllDomain(dom)}>
                          {countSelected === domPerms.length ? 'Deselect Module' : 'Select All'}
                        </Button>
                      </Stack>
                      <Grid container spacing={1}>
                        {domPerms.map((p) => (
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
                                  <Typography
                                    variant="body2"
                                    fontWeight={600}
                                    sx={{ fontFamily: 'monospace' }}
                                  >
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
                    </Box>
                  );
                })}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}
