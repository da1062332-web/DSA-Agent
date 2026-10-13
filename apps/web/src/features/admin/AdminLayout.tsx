// /admin shell (owner: Dev 1): wraps the administration screens (organisation, branches, teams, work queues). Navigation
// is the sidebar's Administration group, so there is no tab bar here. Only users with config.manage or user.manage reach
// these screens; the API enforces the same permissions on every write. Lenders and products sit in their own domain
// (/lenders, /products), not here.
import { Alert, Container } from '@mui/material';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { hasPermission, useMe } from '../../api/useMe';

export function AdminLayout() {
  const me = useMe();
  const { pathname } = useLocation();
  if (pathname === '/admin') return <Navigate to="/admin/organisation" replace />;

  const allowed = hasPermission(me.data, 'config.manage') || hasPermission(me.data, 'user.manage');

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      {allowed ? (
        <Outlet />
      ) : (
        <Alert severity="warning">You need the configuration or user management permission.</Alert>
      )}
    </Container>
  );
}
