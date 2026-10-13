import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Grid,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { fetchPermissions } from './api';
import type { Permission } from './types';

export function PermissionsCatalogPage() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>('');
  const [domainFilter, setDomainFilter] = useState<string>('ALL');

  useEffect(() => {
    loadCatalog();
  }, []);

  async function loadCatalog() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPermissions();
      setPermissions(res.data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load permissions catalog.');
    } finally {
      setLoading(false);
    }
  }

  // Extract unique domains (e.g. "lead", "task", "application", "rule", etc.)
  const domains: string[] = Array.from(new Set(permissions.map((p) => p.code.split('.')[0]))).filter((d): d is string => Boolean(d)).sort();

  const filtered = permissions.filter((p) => {
    const domain = p.code.split('.')[0];
    const matchesDomain = domainFilter === 'ALL' || domain === domainFilter;
    const matchesSearch =
      search === '' ||
      p.code.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase());
    return matchesDomain && matchesSearch;
  });

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }} flexWrap="wrap" gap={2}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Permissions Catalog
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Global catalog of platform permissions governed by Role-Based Access Control (RBAC).
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" component={RouterLink} to="/roles">
            &larr; Back to Roles
          </Button>
          <Button variant="outlined" onClick={loadCatalog} disabled={loading}>
            Refresh
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Filter and Search Bar */}
      <Card sx={{ mb: 4, p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
          <TextField
            placeholder="Search permissions by code or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            size="small"
            fullWidth
            InputProps={{
              startAdornment: <InputAdornment position="start">🔍</InputAdornment>,
            }}
          />
          <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', maxWidth: '100%', py: 0.5 }}>
            <Chip
              label="All"
              clickable
              color={domainFilter === 'ALL' ? 'primary' : 'default'}
              variant={domainFilter === 'ALL' ? 'filled' : 'outlined'}
              onClick={() => setDomainFilter('ALL')}
            />
            {domains.map((dom) => (
              <Chip
                key={dom}
                label={dom}
                clickable
                color={domainFilter === dom ? 'primary' : 'default'}
                variant={domainFilter === dom ? 'filled' : 'outlined'}
                onClick={() => setDomainFilter(dom)}
              />
            ))}
          </Stack>
        </Stack>
      </Card>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : filtered.length === 0 ? (
        <Alert severity="info">No permissions matched your query.</Alert>
      ) : (
        <Grid container spacing={2}>
          {filtered.map((perm) => {
            const domain = perm.code.split('.')[0];
            return (
              <Grid item xs={12} sm={6} md={4} key={perm.code}>
                <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 2, boxShadow: 1 }}>
                  <CardContent sx={{ flexGrow: 1 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                      <Chip label={domain} size="small" color="primary" variant="outlined" />
                      <Chip label={perm.introducedIn} size="small" variant="filled" sx={{ fontSize: '0.7rem' }} />
                    </Stack>
                    <Typography variant="subtitle1" fontWeight={700} sx={{ fontFamily: 'monospace', mb: 0.5 }}>
                      {perm.code}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {perm.description}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}
    </Container>
  );
}
