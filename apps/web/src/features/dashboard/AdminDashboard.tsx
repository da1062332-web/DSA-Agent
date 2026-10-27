import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { hasPermission, useMe } from '../../api/useMe';
import { PLATFORM_TENANT_ID } from '@dsa/contracts';
import { routeAllowed } from '../../shell/access';
import { useList } from '../admin/api';
import type { Application } from '../applications/ApplicationsPage';
import { fetchBranches, fetchUsers } from '../users/api';
import { fetchLeads } from '../leads/api';
import { searchAuditEvents } from '../audit/api';
import {
  DashboardDateFilter,
  type DateRangeScope,
  KpiMetricCard,
  PipelineFunnelChart,
} from './components';
import { NotSet } from '../../ui/NotSet';

interface AdminDashboardProps {
  role?: 'ROLE-TENANT-ADMIN' | 'ROLE-ORG-OWNER';
}

export function AdminDashboard({ role }: AdminDashboardProps) {
  const me = useMe();
  const [dateScope, setDateScope] = useState<DateRangeScope>('month');

  const isOwner = role === 'ROLE-ORG-OWNER' || me.data?.roles?.includes('ROLE-ORG-OWNER');
  const roleTitle = isOwner ? 'Organisation Owner' : 'Tenant Admin';

  const platformRealm = me.data?.tenantId === PLATFORM_TENANT_ID;
  const canAccess = (path: string) =>
    routeAllowed(path, (code) => hasPermission(me.data, code), platformRealm);

  // Permission access guards
  const canBranches = canAccess('/admin/branches');
  const canUsers = canAccess('/users');
  const canRoles = canAccess('/roles');
  const canApplications = canAccess('/applications');
  const canSanctions = canAccess('/sanctions');
  const canAudit = canAccess('/audit');
  const canLeads = canAccess('/leads');

  // Active branches - only queried if user has access
  const {
    data: branchesData,
    isLoading: branchesLoading,
    isError: branchesError,
  } = useQuery({
    queryKey: ['admin-branches-summary'],
    queryFn: () => fetchBranches(),
    enabled: canBranches,
  });

  // Staff users - only queried if user has access
  const {
    data: usersData,
    isLoading: usersLoading,
    isError: usersError,
  } = useQuery({
    queryKey: ['admin-users-summary'],
    queryFn: () => fetchUsers({ limit: 100 }),
    enabled: canUsers,
  });

  // Active Applications - only queried if user has access
  const {
    data: appPages,
    isLoading: appsLoading,
    isError: appsError,
  } = useList<Application>('/v1/applications', {}, 100, canApplications);

  // Inbound Leads - only queried if user has access
  const {
    data: leadsData,
    isLoading: leadsLoading,
    isError: leadsError,
  } = useQuery({
    queryKey: ['admin-leads-summary', dateScope],
    queryFn: () => fetchLeads({ limit: 100 }),
    enabled: canLeads,
  });

  // Audit Events - only queried if user has access
  const {
    data: auditData,
    isLoading: auditLoading,
    isError: auditError,
  } = useQuery({
    queryKey: ['admin-audit-events-summary'],
    queryFn: () => searchAuditEvents({ limit: 20 }),
    enabled: canAudit,
  });

  const branches = branchesData ?? [];
  const users = usersData?.data ?? [];
  const applications: Application[] = appPages?.pages?.flatMap((p) => p.data ?? []) ?? [];
  const leads = leadsData?.data ?? [];
  const auditEvents = auditData?.data ?? [];

  // Funnel calculations
  const newAppsCount = applications.filter(
    (a) => a.status === 'DRAFT' || a.status === 'SUBMITTED',
  ).length;
  const underReviewCount = applications.filter((a) => a.status === 'UNDER_REVIEW').length;
  const sanctionedCount = applications.filter((a) => a.status === 'SANCTIONED').length;
  const disbursedCount = applications.filter(
    (a) => a.status === 'DISBURSED' || a.status === 'PARTIALLY_DISBURSED',
  ).length;

  const disbursedTotal = applications
    .filter((a) => a.status === 'DISBURSED' || a.status === 'SANCTIONED' || a.status === 'PARTIALLY_DISBURSED')
    .reduce((sum, a) => sum + (Number(a.requestedAmount) || 0), 0);

  // Core Administration modules (strictly important executive governance cards)
  const adminModules = [
    {
      title: 'User Management',
      desc: 'Manage staff accounts, invitations, branch assignments, and roles.',
      to: '/users',
      badge: 'Users',
    },
    {
      title: 'Access Control',
      desc: 'Configure tenant roles, permission policies, and RBAC matrix.',
      to: '/roles',
      badge: 'Access Control',
    },
    {
      title: 'Organisation & Branches',
      desc: 'Configure branch hierarchy, operational queues, and tenant settings.',
      to: '/admin/branches',
      badge: 'Governance',
    },
    {
      title: 'Audit & Governance',
      desc: 'Immutable append-only audit trail with hash-chain integrity verification.',
      to: '/audit',
      badge: 'Audit',
    },
    {
      title: 'Commissions & Payouts',
      desc: 'Commission rule tiers, rate slabs, partner splits, and earnings calculation.',
      to: '/commission',
      badge: 'Commissions',
    },
    {
      title: 'Reporting & Analytics',
      desc: 'Standard report catalogue, operational KPIs, export jobs, and pipeline projections.',
      to: '/reports',
      badge: 'Reports',
    },
  ];

  const platformRealm = me.data?.tenantId === PLATFORM_TENANT_ID;
  const allowedModules = adminModules.filter((m) =>
    routeAllowed(m.to, (code) => hasPermission(me.data, code), platformRealm),
  );

  return (
    <Box sx={{ width: '100%', py: 1 }} data-testid="admin-dashboard">
      {/* Executive Command Header */}
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2, sm: 2.5 },
          mb: 2.5,
          borderRadius: 2.5,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2,
        }}
      >
        <Box>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="h5" fontWeight={800} sx={{ letterSpacing: '-0.02em' }}>
              {roleTitle} Command Center
            </Typography>
            <Chip
              label={roleTitle}
              color="primary"
              size="small"
              sx={{ fontWeight: 700, fontSize: 11 }}
            />
            <Chip
              label="● Tenant Active"
              color="success"
              size="small"
              variant="outlined"
              sx={{ fontWeight: 600, fontSize: 11 }}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Comprehensive tenant governance, branch network oversight, staff access control, and operational metrics.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
          <DashboardDateFilter value={dateScope} onChange={setDateScope} />
          <Button variant="contained" color="primary" component={RouterLink} to="/users" sx={{ fontWeight: 700 }}>
            Manage Staff
          </Button>
          <Button variant="outlined" component={RouterLink} to="/admin/branches">
            Branches
          </Button>
          <Button variant="outlined" component={RouterLink} to="/roles">
            Access Control
          </Button>
          <Button variant="outlined" component={RouterLink} to="/audit">
            Audit Log
          </Button>
        </Stack>
      </Paper>

      {/* KPI Overview Cards */}
      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Disbursed Volume"
            value={disbursedTotal > 0 ? disbursedTotal : null}
            format={disbursedTotal > 0 ? 'currency' : 'raw'}
            subtitle={disbursedTotal > 0 ? 'Total portfolio volume' : 'No sanctions recorded'}
            isLoading={appsLoading}
            isError={appsError}
            to="/sanctions"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Total Originations"
            value={applications.length}
            subtitle="Active files across all branches"
            isLoading={appsLoading}
            isError={appsError}
            to="/applications"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Active Staff Users"
            value={users.length}
            subtitle="Configured personnel accounts"
            isLoading={usersLoading}
            isError={usersError}
            to="/users"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiMetricCard
            title="Operating Branches"
            value={branches.length}
            subtitle="Registered branch locations"
            isLoading={branchesLoading}
            isError={branchesError}
            to="/admin/branches"
          />
        </Grid>
      </Grid>

      {/* Middle Row: Balanced Funnel & Audit Overview */}
      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
        <Grid item xs={12} lg={7}>
          <PipelineFunnelChart
            title="Organisation Origination Pipeline"
            stages={[
              { key: 'leads', label: 'Inbound Leads', count: leads.length, color: '#f59e0b' },
              { key: 'files', label: 'New Files', count: newAppsCount, color: '#1d5fd1' },
              { key: 'review', label: 'Under Review', count: underReviewCount, color: '#0288d1' },
              { key: 'sanctioned', label: 'Sanctioned', count: sanctionedCount, color: '#10b981' },
              { key: 'disbursed', label: 'Disbursed', count: disbursedCount, color: '#059669' },
            ]}
          />
        </Grid>
        <Grid item xs={12} lg={5}>
          <Card
            sx={{
              height: '100%',
              borderRadius: 2.5,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px 0 rgba(0, 0, 0, 0.02)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <CardContent sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Box>
                  <Typography variant="h6" fontWeight={700}>
                    Governance &amp; Audit Trail
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Immutable append-only cryptographic log
                  </Typography>
                </Box>
                <Button size="small" component={RouterLink} to="/audit" sx={{ fontWeight: 600 }}>
                  View Full Audit &rarr;
                </Button>
              </Box>
              {auditLoading ? (
                <Typography color="text.secondary">Loading audit events...</Typography>
              ) : auditEvents.length === 0 ? (
                <Typography color="text.secondary">No recent audit log entries recorded.</Typography>
              ) : (
                <Stack spacing={1.5} sx={{ overflowY: 'auto', flex: 1 }}>
                  {auditEvents.slice(0, 5).map((evt: any) => (
                    <Box
                      key={evt.id}
                      sx={{
                        p: 1.5,
                        borderRadius: 2,
                        bgcolor: 'action.hover',
                        border: '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="caption" fontWeight={700}>
                          {evt.action || 'EVENT'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {evt.occurredAt ? new Date(evt.occurredAt).toLocaleTimeString() : <NotSet />}
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Actor: {evt.actorUserId || 'SYSTEM'} · Resource: {evt.resourceType || 'RECORD'}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Core Administration & Governance Modules */}
      <Box sx={{ mt: 1 }}>
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" fontWeight={700}>
            Core Administration &amp; Governance
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Essential executive control portals for workforce oversight, access control, organization hierarchy, and regulatory compliance.
          </Typography>
        </Box>
        <Grid container spacing={2.5}>
          {allowedModules.map((card) => (
            <Grid item xs={12} sm={6} md={4} key={card.to}>
              <Card
                variant="outlined"
                sx={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  borderRadius: 2.5,
                  bgcolor: 'background.paper',
                  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px 0 rgba(0, 0, 0, 0.02)',
                  transition: 'all 0.2s',
                  '&:hover': {
                    boxShadow: '0 4px 12px 0 rgba(0, 0, 0, 0.06)',
                    borderColor: 'primary.main',
                    transform: 'translateY(-2px)',
                  },
                }}
              >
                <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Typography variant="subtitle1" fontWeight={700}>
                      {card.title}
                    </Typography>
                    <Chip label={card.badge} size="small" variant="outlined" sx={{ fontWeight: 600, fontSize: 11 }} />
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ flex: 1, mb: 2 }}>
                    {card.desc}
                  </Typography>
                  <Button
                    size="small"
                    variant="contained"
                    component={RouterLink}
                    to={card.to}
                    sx={{ alignSelf: 'flex-start', fontWeight: 600 }}
                  >
                    Open
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>
    </Box>
  );
}
