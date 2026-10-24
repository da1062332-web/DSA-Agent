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
  Stack,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { fetchPermissions } from './api';
import {
  FilterToolbar,
  PageHeader,
  StatCard,
  StatCardGrid,
} from '../../ui';
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
  const domains: string[] = Array.from(new Set(permissions.map((p) => p.code.split('.')[0])))
    .filter((d): d is string => Boolean(d))
    .sort();

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
    <Container maxWidth={false} disableGutters>
      <PageHeader
        title="Permissions Catalog"
        subtitle="Global catalog of platform permissions governed by Role-Based Access Control (RBAC)."
        actions={
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" component={RouterLink} to="/roles">
              &larr; Back to Roles
            </Button>
            <Button variant="outlined" onClick={loadCatalog} disabled={loading}>
              Refresh
            </Button>
          </Stack>
        }
      />

      <StatCardGrid columns={{ xs: 1, sm: 3, md: 3 }} sx={{ mb: 3 }}>
        <StatCard
          title="Total Permissions"
          value={permissions.length}
          subtext="Standard platform capabilities"
        />
        <StatCard
          title="Permission Domains"
          value={domains.length}
          subtext="Functional subsystem scopes"
          colorVariant="info"
        />
        <StatCard
          title="Active Filter Count"
          value={filtered.length}
          subtext="Matching current filters"
          colorVariant="secondary"
        />
      </StatCardGrid>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Filter and Search Bar */}
      <FilterToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search permissions by code or description..."
        filters={
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
        }
      />

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
                <Card
                  sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: 2,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                    border: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <CardContent sx={{ flexGrow: 1 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                      <Chip label={domain} size="small" color="primary" variant="outlined" />
                      <Chip
                        label={perm.introducedIn}
                        size="small"
                        variant="filled"
                        sx={{ fontSize: '0.7rem' }}
                      />
                    </Stack>
                    <Typography
                      variant="subtitle1"
                      fontWeight={700}
                      sx={{ fontFamily: 'monospace', mb: 0.5 }}
                    >
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
