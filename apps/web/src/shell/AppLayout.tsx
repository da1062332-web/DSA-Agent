// Shell with auth guard and navigation (owner: Dev 1).
// Guard order: signed in → profile loads from /v1/me → TOTP passed this session when the user has a factor, or
// enrolled when the role requires MFA (Doc 03 §5.1). The API re-checks the token on every call.
import {
  Alert,
  AppBar,
  Box,
  Button,
  CircularProgress,
  Divider,
  Drawer,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link as RouterLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { errorText } from '../api/client';
import { PLATFORM_TENANT_ID } from '@dsa/contracts';
import { hasPermission, mfaRequired, useMe, useTenant } from '../api/useMe';
import { useAuth } from '../auth/AuthProvider';
import { StepUpProvider } from '../auth/StepUpProvider';

import { NotificationCenter } from '../features/notifications/NotificationCenter';
import { routeAllowed } from './access';
import { Forbidden } from './Forbidden';
import { SidebarContent } from './Sidebar';

const Centered = ({ children }: { children: React.ReactNode }) => (
  <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10, px: 2 }}>{children}</Box>
);

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, aal, signOut } = useAuth();
  const me = useMe();
  // Only call the API once the sign-in has passed the mandatory MFA check (see the guard below).
  const mfaPassed =
    !!session &&
    !!aal &&
    !me.isPending &&
    !(aal.next === 'aal2' && aal.current !== 'aal2') &&
    !(aal.next !== 'aal2' && mfaRequired(me.data));
  const tenant = useTenant(mfaPassed);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('md'));
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  if (session === undefined)
    return (
      <Centered>
        <CircularProgress />
      </Centered>
    );
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!aal || me.isPending)
    return (
      <Centered>
        <CircularProgress />
      </Centered>
    );
  if (me.isError) {
    return (
      <Centered>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void signOut()}>
              Sign out
            </Button>
          }
        >
          Your account could not be loaded: {errorText(me.error)}
        </Alert>
      </Centered>
    );
  }

  // Development builds only: a production build ignores it. The API enforces MFA whatever the screen does.
  const skipMfa = import.meta.env?.DEV === true && import.meta.env?.VITE_DISABLE_MFA === 'true';
  const needsChallenge = !skipMfa && aal.next === 'aal2' && aal.current !== 'aal2';
  const needsEnrolment = !skipMfa && aal.next !== 'aal2' && mfaRequired(me.data);
  if (needsChallenge || needsEnrolment)
    return <Navigate to="/mfa" replace state={{ from: location.pathname }} />;

  const isAdmin = hasPermission(me.data, 'config.manage') || hasPermission(me.data, 'user.manage');
  const platformRealm = me.data?.tenantId === PLATFORM_TENANT_ID;
  // Route guard (audit F-08): by this point the profile and its grants are loaded (the spinner above covers the wait), and a missing
  // profile has no grants, so the check fails closed. The same rules drive the sidebar and the Home cards.
  const pageAllowed = routeAllowed(location.pathname, (code) => hasPermission(me.data, code), platformRealm);

  return (
    <StepUpProvider>
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        {/* Pinned to the top while the page scrolls, and above the sidebar, which sits just below it. */}
        <AppBar position="sticky" elevation={0} sx={{ top: 0, zIndex: (t) => t.zIndex.drawer + 1 }}>
          <Toolbar sx={{ gap: 1, flexWrap: 'wrap' }}>
            <Typography
              variant="h6"
              component={RouterLink}
              to="/"
              sx={{
                color: '#ffffff',
                textDecoration: 'none',
                mr: 2,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                display: 'flex',
                alignItems: 'center',
                gap: 1,
              }}
            >
              {tenant.data?.legalName ?? 'DSA CRM'}
              <Box
                component="span"
                sx={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: '#F89344',
                }}
              />
            </Typography>
            {!wide && (
              <Button color="inherit" onClick={() => setDrawerOpen(true)} data-testid="shell.menu">
                Menu
              </Button>
            )}

            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
              <NotificationCenter />
              <Button
                color="inherit"
                onClick={(e) => setMenu(e.currentTarget)}
                data-testid="shell.account"
                sx={{
                  textTransform: 'none',
                  bgcolor: 'rgba(255, 255, 255, 0.12)',
                  '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.20)' },
                  borderRadius: 2,
                  px: 1.5,
                  py: 0.5,
                  fontSize: '0.875rem',
                  color: '#ffffff',
                }}
              >
                {me.data?.displayName}
              </Button>
              <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
                <MenuItem disabled>
                  <ListItemText primary={me.data?.displayName} secondary={me.data?.email} />
                </MenuItem>
                <Divider />
                <MenuItem
                  onClick={() => {
                    setMenu(null);
                    navigate('/account/security');
                  }}
                >
                  Security
                </MenuItem>
                <MenuItem
                  data-testid="shell.signout"
                  onClick={() => {
                    setMenu(null);
                    void signOut();
                  }}
                >
                  Sign out
                </MenuItem>
              </Menu>
            </Box>
          </Toolbar>
        </AppBar>
        <Box sx={{ display: 'flex' }}>
          <Drawer
            variant={wide ? 'permanent' : 'temporary'}
            open={wide || drawerOpen}
            onClose={() => setDrawerOpen(false)}
            sx={{
              width: 260,
              flexShrink: 0,
              // On desktop the sidebar sits below the 64px header, so it must be 64px shorter than the window,
              // or its last items hang off the bottom of the screen and cannot be scrolled into view.
              '& .MuiDrawer-paper': {
                width: 260,
                boxSizing: 'border-box',
                top: { md: 64 },
                height: { md: 'calc(100vh - 64px)', xs: '100%' },
                overflowY: 'auto',
                overscrollBehavior: 'contain',
              },
            }}
          >
            <SidebarContent
              isAdmin={isAdmin}
              can={(code) => hasPermission(me.data, code)}
              platformRealm={platformRealm}
              onNavigate={() => setDrawerOpen(false)}
            />
          </Drawer>
          <Box component="main" sx={{ flex: 1, minWidth: 0, p: { xs: 2, md: 3 } }}>
            {pageAllowed ? <Outlet /> : <Forbidden />}
          </Box>
        </Box>
      </Box>
    </StepUpProvider>
  );
}
