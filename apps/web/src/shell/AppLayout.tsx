// Shell with auth guard and role-based navigation (owner: Dev 1).
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
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { errorText } from '../api/client';
import { mfaRequired, useMe, useTenant } from '../api/useMe';
import { useAuth } from '../auth/AuthProvider';
import { StepUpProvider } from '../auth/StepUpProvider';
import { NotificationCenter } from '../features/notifications/NotificationCenter';
import {
  getAdministrativeNav,
  getOperationalNav,
  isNavActive,
} from './navigation';

const Centered = ({ children }: { children: React.ReactNode }) => (
  <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10, px: 2 }}>{children}</Box>
);

const MenuIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
  </svg>
);

const CloseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  </svg>
);

const ExpandMoreIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" />
  </svg>
);

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, aal, signOut } = useAuth();
  const me = useMe();
  const tenant = useTenant();

  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [adminAnchor, setAdminAnchor] = useState<HTMLElement | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

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

  const operationalItems = getOperationalNav(me.data);
  const administrativeItems = getAdministrativeNav(me.data);
  const isAdminActive = administrativeItems.some((item) => isNavActive(location.pathname, item.to));

  return (
    <StepUpProvider>
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <AppBar position="static" elevation={1}>
          <Toolbar sx={{ gap: 1, flexWrap: 'nowrap' }}>
            {/* Mobile Hamburger Button */}
            <IconButton
              color="inherit"
              aria-label="open navigation menu"
              onClick={() => setMobileOpen(true)}
              data-testid="shell.mobile.menu"
              edge="start"
              sx={{ display: { xs: 'inline-flex', md: 'none' }, mr: 0.5 }}
            >
              <MenuIcon />
            </IconButton>

            {/* Brand Logo / Legal Name */}
            <Typography
              variant="h6"
              component={RouterLink}
              to="/"
              sx={{
                color: 'inherit',
                textDecoration: 'none',
                mr: { xs: 1, md: 2 },
                fontWeight: 700,
                whiteSpace: 'nowrap',
                letterSpacing: '0.02em',
                flexShrink: 0,
              }}
            >
              {tenant.data?.legalName ?? 'DSA CRM'}
            </Typography>

            {/* Desktop Navigation */}
            <Box
              sx={{
                display: { xs: 'none', md: 'flex' },
                alignItems: 'center',
                gap: 0.5,
                flexWrap: 'nowrap',
                overflowX: 'auto',
                py: 0.5,
              }}
            >
              {operationalItems.map((item) => {
                const active = isNavActive(location.pathname, item.to);
                return (
                  <Button
                    key={item.to}
                    component={RouterLink}
                    to={item.to}
                    aria-current={active ? 'page' : undefined}
                    data-testid={item.testId}
                    sx={{
                      color: 'inherit',
                      fontWeight: active ? 700 : 500,
                      backgroundColor: active ? 'rgba(255, 255, 255, 0.18)' : 'transparent',
                      borderBottom: active ? '2px solid #ffffff' : '2px solid transparent',
                      borderRadius: '4px',
                      px: 1.25,
                      py: 0.5,
                      textTransform: 'none',
                      fontSize: '0.875rem',
                      whiteSpace: 'nowrap',
                      '&:hover': {
                        backgroundColor: 'rgba(255, 255, 255, 0.24)',
                      },
                    }}
                  >
                    {item.label}
                  </Button>
                );
              })}

              {/* Administration Dropdown Menu */}
              {administrativeItems.length > 0 && (
                <>
                  <Button
                    aria-haspopup="true"
                    aria-expanded={Boolean(adminAnchor)}
                    aria-controls={adminAnchor ? 'admin-nav-menu' : undefined}
                    data-testid="shell.nav.administration"
                    onClick={(e) => setAdminAnchor(e.currentTarget)}
                    endIcon={<ExpandMoreIcon />}
                    sx={{
                      color: 'inherit',
                      fontWeight: isAdminActive ? 700 : 500,
                      backgroundColor: isAdminActive ? 'rgba(255, 255, 255, 0.18)' : 'transparent',
                      borderBottom: isAdminActive ? '2px solid #ffffff' : '2px solid transparent',
                      borderRadius: '4px',
                      px: 1.25,
                      py: 0.5,
                      textTransform: 'none',
                      fontSize: '0.875rem',
                      whiteSpace: 'nowrap',
                      '&:hover': {
                        backgroundColor: 'rgba(255, 255, 255, 0.24)',
                      },
                    }}
                  >
                    Administration
                  </Button>
                  <Menu
                    id="admin-nav-menu"
                    anchorEl={adminAnchor}
                    open={Boolean(adminAnchor)}
                    onClose={() => setAdminAnchor(null)}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                    transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                    PaperProps={{
                      sx: {
                        mt: 0.5,
                        minWidth: 180,
                        boxShadow: 3,
                        borderRadius: 1.5,
                      },
                    }}
                  >
                    {administrativeItems.map((item) => {
                      const active = isNavActive(location.pathname, item.to);
                      return (
                        <MenuItem
                          key={item.to}
                          component={RouterLink}
                          to={item.to}
                          selected={active}
                          data-testid={item.testId}
                          onClick={() => setAdminAnchor(null)}
                          sx={{
                            fontWeight: active ? 600 : 400,
                            py: 1,
                          }}
                        >
                          {item.label}
                        </MenuItem>
                      );
                    })}
                  </Menu>
                </>
              )}
            </Box>

            {/* Right Account & Notifications */}
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
              <NotificationCenter />
              <Button
                color="inherit"
                onClick={(e) => setMenu(e.currentTarget)}
                data-testid="shell.account"
                sx={{ textTransform: 'none', fontWeight: 500 }}
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

        {/* Mobile Navigation Drawer */}
        <Drawer
          anchor="left"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          data-testid="shell.mobile.drawer"
          PaperProps={{
            sx: { width: 280, bgcolor: 'background.paper' },
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              p: 2,
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
            }}
          >
            <Typography variant="h6" fontWeight={700}>
              {tenant.data?.legalName ?? 'DSA CRM'}
            </Typography>
            <IconButton
              color="inherit"
              onClick={() => setMobileOpen(false)}
              aria-label="close navigation menu"
              size="small"
            >
              <CloseIcon />
            </IconButton>
          </Box>

          <List sx={{ pt: 1, pb: 3 }}>
            {operationalItems.length > 0 && (
              <>
                <ListSubheader
                  sx={{
                    bgcolor: 'transparent',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Operations
                </ListSubheader>
                {operationalItems.map((item) => {
                  const active = isNavActive(location.pathname, item.to);
                  return (
                    <ListItem key={item.to} disablePadding>
                      <ListItemButton
                        component={RouterLink}
                        to={item.to}
                        selected={active}
                        data-testid={`mobile.${item.testId}`}
                        onClick={() => setMobileOpen(false)}
                        sx={{
                          mx: 1,
                          borderRadius: 1,
                          '&.Mui-selected': {
                            bgcolor: 'action.selected',
                          },
                        }}
                      >
                        <ListItemText
                          primary={item.label}
                          primaryTypographyProps={{
                            fontWeight: active ? 700 : 500,
                            color: active ? 'primary.main' : 'inherit',
                          }}
                        />
                      </ListItemButton>
                    </ListItem>
                  );
                })}
              </>
            )}

            {administrativeItems.length > 0 && (
              <>
                <Divider sx={{ my: 1.5 }} />
                <ListSubheader
                  sx={{
                    bgcolor: 'transparent',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Administration
                </ListSubheader>
                {administrativeItems.map((item) => {
                  const active = isNavActive(location.pathname, item.to);
                  return (
                    <ListItem key={item.to} disablePadding>
                      <ListItemButton
                        component={RouterLink}
                        to={item.to}
                        selected={active}
                        data-testid={`mobile.${item.testId}`}
                        onClick={() => setMobileOpen(false)}
                        sx={{
                          mx: 1,
                          borderRadius: 1,
                          '&.Mui-selected': {
                            bgcolor: 'action.selected',
                          },
                        }}
                      >
                        <ListItemText
                          primary={item.label}
                          primaryTypographyProps={{
                            fontWeight: active ? 700 : 500,
                            color: active ? 'primary.main' : 'inherit',
                          }}
                        />
                      </ListItemButton>
                    </ListItem>
                  );
                })}
              </>
            )}

            <Divider sx={{ my: 1.5 }} />
            <ListSubheader
              sx={{
                bgcolor: 'transparent',
                fontWeight: 700,
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Account
            </ListSubheader>
            <ListItem disablePadding>
              <ListItemButton
                component={RouterLink}
                to="/notifications"
                onClick={() => setMobileOpen(false)}
                data-testid="shell.mobile.notifications"
                sx={{ mx: 1, borderRadius: 1 }}
              >
                <ListItemText primary="Notifications" />
              </ListItemButton>
            </ListItem>
            <ListItem disablePadding>
              <ListItemButton
                component={RouterLink}
                to="/account/security"
                onClick={() => setMobileOpen(false)}
                data-testid="shell.mobile.security"
                sx={{ mx: 1, borderRadius: 1 }}
              >
                <ListItemText primary="Security & MFA" />
              </ListItemButton>
            </ListItem>
            <ListItem disablePadding>
              <ListItemButton
                onClick={() => {
                  setMobileOpen(false);
                  void signOut();
                }}
                data-testid="shell.mobile.signout"
                sx={{ mx: 1, borderRadius: 1, color: 'error.main' }}
              >
                <ListItemText primary="Sign out" primaryTypographyProps={{ color: 'error.main' }} />
              </ListItemButton>
            </ListItem>
          </List>
        </Drawer>

        <Box component="main">
          <Outlet />
        </Box>
      </Box>
    </StepUpProvider>
  );
}
