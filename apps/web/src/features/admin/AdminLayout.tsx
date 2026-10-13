// /admin shell (owner: Dev 1): tabs for the Platform Foundation admin screens. Only users with config.manage or
// user.manage reach it; the API enforces the same permissions on every write.
import { Alert, Box, Container, Tab, Tabs } from '@mui/material';
import { Link as RouterLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { hasPermission, useMe } from '../../api/useMe';

const TABS = [
  { to: '/admin/organisation', label: 'Organisation' },
  { to: '/admin/branches', label: 'Branches' },
  { to: '/admin/lenders', label: 'Lenders' },
  { to: '/admin/teams', label: 'Teams' },
  { to: '/admin/queues', label: 'Work queues' },
];

export function AdminLayout() {
  const me = useMe();
  const { pathname } = useLocation();
  if (pathname === '/admin') return <Navigate to="/admin/organisation" replace />;

  const allowed = hasPermission(me.data, 'config.manage') || hasPermission(me.data, 'user.manage');
  const current = TABS.find((t) => pathname.startsWith(t.to))?.to ?? false;

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={current} variant="scrollable">
          {TABS.map((t) => (
            <Tab
              key={t.to}
              value={t.to}
              label={t.label}
              component={RouterLink}
              to={t.to}
              data-testid={`admin.tab.${t.to.split('/')[2]}`}
            />
          ))}
        </Tabs>
      </Box>
      {allowed ? (
        <Outlet />
      ) : (
        <Alert severity="warning">You need the configuration or user management permission.</Alert>
      )}
    </Container>
  );
}
