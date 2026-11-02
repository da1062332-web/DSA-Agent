// /admin shell (owner: Dev 1): wraps the administration screens (organisation, branches, teams, work queues). Navigation
// is the sidebar's Administration group, so there is no tab bar here. Only users with config.manage or user.manage reach
// these screens; the API enforces the same permissions on every write. Lenders and products sit in their own domain
// (/lenders, /products), not here.
import { Alert, Container } from '@mui/material';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { hasPermission, useMe } from '../../api/useMe';
import { canPerformAction, routeAllowed } from '../../shell/access';

const ADMIN_SCREENS = ['/admin/organisation', '/admin/branches', '/admin/teams', '/admin/queues'];

export function AdminLayout() {
  const me = useMe();
  const { pathname } = useLocation();
  const can = (code: string) => hasPermission(me.data, code);
  if (pathname === '/admin') {
    // The first administration screen this user may open: a role that holds only team.manage goes to Teams, not to Organisation.
    const first = ADMIN_SCREENS.find((p) => routeAllowed(p, can, false, me.data?.disabledModules));
    return <Navigate to={first ?? ADMIN_SCREENS[0]!} replace />;
  }

  const allowed =
    canPerformAction('org.manage', can) ||
    canPerformAction('team.manage', can) ||
    canPerformAction('settings.manage', can);

  return (
    <Container maxWidth={false} disableGutters>
      {allowed ? (
        <Outlet />
      ) : (
        <Alert severity="warning">You need the configuration or user management permission.</Alert>
      )}
    </Container>
  );
}
