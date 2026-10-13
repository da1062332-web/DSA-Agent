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
import { hasPermission, mfaRequired, useMe, useTenant } from '../api/useMe';
import { useAuth } from '../auth/AuthProvider';
import { StepUpProvider } from '../auth/StepUpProvider';

import { NotificationCenter } from '../features/notifications/NotificationCenter';
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

  const needsChallenge = aal.next === 'aal2' && aal.current !== 'aal2';
  const needsEnrolment = aal.next !== 'aal2' && mfaRequired(me.data);
  if (needsChallenge || needsEnrolment)
    return <Navigate to="/mfa" replace state={{ from: location.pathname }} />;

  const isAdmin = hasPermission(me.data, 'config.manage') || hasPermission(me.data, 'user.manage');

  return (
    <StepUpProvider>
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <AppBar position="static" elevation={0}>
          <Toolbar sx={{ gap: 1, flexWrap: 'wrap' }}>
            <Typography
              variant="h6"
              component={RouterLink}
              to="/"
              sx={{ color: 'inherit', textDecoration: 'none', mr: 2, fontWeight: 700 }}
            >
              {tenant.data?.legalName ?? 'DSA CRM'}
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
                sx={{ textTransform: 'none' }}
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
              '& .MuiDrawer-paper': { width: 260, boxSizing: 'border-box', top: { md: 64 } },
            }}
          >
            <SidebarContent isAdmin={isAdmin} onNavigate={() => setDrawerOpen(false)} />
          </Drawer>
          <Box component="main" sx={{ flex: 1, minWidth: 0, p: { xs: 2, md: 3 } }}>
            <Outlet />
          </Box>
        </Box>
      </Box>
    </StepUpProvider>
  );
}
