// Shell with auth guard and navigation (owner: Dev 1).
// Guard order: signed in → profile loads from /v1/me → TOTP passed this session when the user has a factor, or
// enrolled when the role requires MFA (Doc 03 §5.1). The API re-checks the token on every call.
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link as RouterLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { errorText, registerStepUpRefusedHandler } from '../api/client';
import { PLATFORM_TENANT_ID } from '@dsa/contracts';
import { hasPermission, mfaRequired, useMe, useTenant } from '../api/useMe';
import { useAuth } from '../auth/AuthProvider';
import { StepUpProvider } from '../auth/StepUpProvider';
import { mfaProjectState } from '../auth/mfa-project';
import { mfaSkipRequested } from '../auth/test-auth';

import { ROLE_LABELS, resolveUserRoles } from '../features/dashboard/role-routing';
import { NotificationCenter } from '../features/notifications/NotificationCenter';
import { routeAllowed } from './access';
import { Forbidden } from './Forbidden';
import { MenuIcon } from './icons';
import { SidebarContent } from './Sidebar';

const TOPBAR_HEIGHT = 56;
// Top bar palette (Brand Swatch Guide): deep navy (BG/700) with white text and a tangerine accent line.
const TOPBAR_BG = '#215988';
const TOPBAR_ACCENT = '#F89344';

const initials = (name?: string) =>
  (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('') || '?';

const Centered = ({ children }: { children: React.ReactNode }) => (
  <Box
    sx={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      width: '100vw',
      px: 2,
    }}
  >
    {children}
  </Box>
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
  // While the project has authenticator sign-in off and the API has not been told (SUPABASE_MFA_ENABLED=false), the API refuses every
  // call with STEP_UP_REQUIRED and the pages just look empty. Say what is wrong once a request has failed that way.
  const [stepUpBlocked, setStepUpBlocked] = useState(false);
  useEffect(() => {
    registerStepUpRefusedHandler(() => setStepUpBlocked(true));
    return () => registerStepUpRefusedHandler(null);
  }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dsa_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const DEFAULT_SIDEBAR_WIDTH = 272;
  const MIN_SIDEBAR_WIDTH = 240;
  const MAX_SIDEBAR_WIDTH = 420;
  const STEP_SIDEBAR_WIDTH = 35;
  const COLLAPSED_WIDTH = 72;

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('dsa_sidebar_width');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= MIN_SIDEBAR_WIDTH && parsed <= MAX_SIDEBAR_WIDTH) {
          return parsed;
        }
      }
    } catch {
      // Storage can be blocked or unavailable; the preference simply is not remembered.
    }
    return DEFAULT_SIDEBAR_WIDTH;
  });

  const [isResizing, setIsResizing] = useState(false);

  const handleIncreaseWidth = () => {
    setSidebarWidth((prev) => {
      const next = Math.min(MAX_SIDEBAR_WIDTH, prev + STEP_SIDEBAR_WIDTH);
      try {
        localStorage.setItem('dsa_sidebar_width', String(next));
      } catch {
      // Storage can be blocked or unavailable; the preference simply is not remembered.
    }
      return next;
    });
  };

  const handleDecreaseWidth = () => {
    setSidebarWidth((prev) => {
      const next = Math.max(MIN_SIDEBAR_WIDTH, prev - STEP_SIDEBAR_WIDTH);
      try {
        localStorage.setItem('dsa_sidebar_width', String(next));
      } catch {
      // Storage can be blocked or unavailable; the preference simply is not remembered.
    }
      return next;
    });
  };

  const handleResetWidth = () => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    try {
      localStorage.setItem('dsa_sidebar_width', String(DEFAULT_SIDEBAR_WIDTH));
    } catch {
      // Storage can be blocked or unavailable; the preference simply is not remembered.
    }
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      setSidebarWidth((latest) => {
        try {
          localStorage.setItem('dsa_sidebar_width', String(latest));
        } catch {
      // Storage can be blocked or unavailable; the preference simply is not remembered.
    }
        return latest;
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const toggleSidebarCollapse = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('dsa_sidebar_collapsed', String(next));
      } catch {
        // storage unavailable (private mode or blocked); safe to ignore
      }
      return next;
    });
  };

  const handleOpenSection = (_sectionTitle: string) => {
    setSidebarCollapsed(false);
    try {
      localStorage.setItem('dsa_sidebar_collapsed', 'false');
    } catch {
      // storage unavailable (private mode or blocked); safe to ignore
    }
  };

  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('md'));
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  const effectiveSidebarWidth = wide ? (sidebarCollapsed ? COLLAPSED_WIDTH : sidebarWidth) : sidebarWidth;

  if (session === undefined)
    return (
      <Centered>
        <CircularProgress />
      </Centered>
    );
  if (!session) {
    const isPlatformOnly =
      location.pathname === '/platform-admin' ||
      location.pathname.startsWith('/platform-admin/') ||
      location.pathname === '/platform-console' ||
      location.pathname.startsWith('/platform-console/');
    const safeFrom = isPlatformOnly ? '/' : location.pathname;
    return <Navigate to="/login" replace state={{ from: safeFrom }} />;
  }
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

  // No second step when the project has authenticator sign-in off (learned at sign-in), or in a development build that switches it off.
  // The API still enforces step-up for sensitive actions whatever the screen does.
  const skipMfa = mfaSkipRequested() || mfaProjectState() === 'disabled';
  const needsChallenge = !skipMfa && aal.next === 'aal2' && aal.current !== 'aal2';
  const needsEnrolment = !skipMfa && aal.next !== 'aal2' && mfaRequired(me.data);
  if (needsChallenge || needsEnrolment)
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  const roleLabel = resolveUserRoles(me.data).map((role) => ROLE_LABELS[role])[0];
  const isAdmin = hasPermission(me.data, 'config.manage') || hasPermission(me.data, 'user.manage');
  const platformRealm = me.data?.tenantId === PLATFORM_TENANT_ID;
  // Route guard (audit F-08): by this point the profile and its grants are loaded (the spinner above covers the wait), and a missing
  // profile has no grants, so the check fails closed. The same rules drive the sidebar and the Home cards.
  const pageAllowed = routeAllowed(location.pathname, (code) => hasPermission(me.data, code), platformRealm);

  return (
    <StepUpProvider>
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        {/* Permanently fixed to top of viewport while content scrolls underneath */}
        <AppBar
          position="fixed"
          elevation={0}
          sx={{
            top: 0,
            left: 0,
            right: 0,
            zIndex: (t) => t.zIndex.drawer + 1,
            bgcolor: TOPBAR_BG,
            color: '#ffffff',
            boxShadow: 'none',
            // Brand accent line along the bottom edge; drawn inside the bar so the bar keeps its height.
            '&::after': {
              content: '""',
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 3,
              bgcolor: TOPBAR_ACCENT,
            },
          }}
        >
          <Toolbar disableGutters sx={{ minHeight: TOPBAR_HEIGHT, px: { xs: 2, md: 2.5 } }}>
            {/* Mobile menu toggle for narrow screens */}
            {!wide && (
              <IconButton
                color="inherit"
                onClick={() => setDrawerOpen(true)}
                data-testid="shell.menu"
                aria-label="Open menu"
                sx={{
                  mr: 1.5,
                  color: '#ffffff',
                  '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.12)' },
                }}
              >
                <MenuIcon fontSize="small" />
              </IconButton>
            )}

            {/* App Logo and Name properly positioned in navbar */}
            <Box
              component={RouterLink}
              to="/"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1.5,
                textDecoration: 'none',
                userSelect: 'none',
              }}
            >
              <Box
                component="img"
                src="/logo.png"
                alt="DSA Platform Logo"
                sx={{
                  width: 32,
                  height: 32,
                  objectFit: 'contain',
                  flexShrink: 0,
                  // The logo is blue on transparent; show it as a white mark on the navy bar.
                  filter: 'brightness(0) invert(1)',
                }}
              />
              <Typography
                variant="h6"
                sx={{
                  color: '#ffffff',
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                  fontSize: { xs: '1rem', md: '1.0625rem' },
                }}
              >
                {tenant.data?.legalName ?? 'DSA CRM'}
              </Typography>
            </Box>

            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ color: '#ffffff' }}>
                <NotificationCenter />
              </Box>
              <Button
                color="inherit"
                onClick={(e) => setMenu(e.currentTarget)}
                data-testid="shell.account"
                sx={{
                  height: 'auto',
                  textTransform: 'none',
                  borderRadius: 2,
                  gap: 1,
                  pl: 0.75,
                  pr: { xs: 0.75, sm: 1.5 },
                  py: 0.5,
                  color: '#ffffff',
                  '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.12)' },
                }}
              >
                <Avatar
                  sx={{ width: 30, height: 30, fontSize: 12, fontWeight: 600, bgcolor: 'rgba(255, 255, 255, 0.18)', color: '#ffffff' }}
                >
                  {initials(me.data?.displayName)}
                </Avatar>
                <Box sx={{ display: { xs: 'none', sm: 'block' }, textAlign: 'left', minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, lineHeight: 1.25 }}>
                    {me.data?.displayName}
                  </Typography>
                  {roleLabel && (
                    <Typography sx={{ fontSize: '0.6875rem', color: 'rgba(255, 255, 255, 0.78)', lineHeight: 1.25 }}>
                      {roleLabel}
                    </Typography>
                  )}
                </Box>
              </Button>
              <Menu
                anchorEl={menu}
                open={!!menu}
                onClose={() => setMenu(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              >
                <MenuItem disabled sx={{ opacity: '1 !important' }}>
                  <ListItemText
                    primary={me.data?.displayName}
                    secondary={me.data?.email}
                    primaryTypographyProps={{ fontWeight: 600, fontSize: '0.875rem' }}
                    secondaryTypographyProps={{ fontSize: '0.75rem' }}
                  />
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
        <Box sx={{ display: 'flex', pt: `${TOPBAR_HEIGHT}px` }}>
          <Drawer
            variant={wide ? 'permanent' : 'temporary'}
            open={wide || drawerOpen}
            onClose={() => setDrawerOpen(false)}
            sx={{
              width: effectiveSidebarWidth,
              flexShrink: 0,
              boxSizing: 'border-box',
              transition: (t) =>
                isResizing
                  ? 'none'
                  : t.transitions.create('width', {
                      easing: t.transitions.easing.sharp,
                      duration: t.transitions.duration.shorter,
                    }),
              '& .MuiDrawer-paper': {
                width: effectiveSidebarWidth,
                boxSizing: 'border-box',
                top: { md: TOPBAR_HEIGHT },
                height: { md: `calc(100vh - ${TOPBAR_HEIGHT}px)`, xs: '100%' },
                overflowX: 'hidden',
                overflowY: 'auto',
                overscrollBehavior: 'contain',
                borderRight: '1px solid',
                borderColor: 'divider',
                scrollbarWidth: 'thin',
                scrollbarColor: '#cbd5e1 transparent',
                '&::-webkit-scrollbar': {
                  width: '6px',
                },
                '&::-webkit-scrollbar-track': {
                  background: 'transparent',
                },
                '&::-webkit-scrollbar-thumb': {
                  background: '#cbd5e1',
                  borderRadius: '3px',
                },
                '&::-webkit-scrollbar-thumb:hover': {
                  background: '#94a3b8',
                },
                transition: (t) =>
                  isResizing
                    ? 'none'
                    : t.transitions.create('width', {
                        easing: t.transitions.easing.sharp,
                        duration: t.transitions.duration.shorter,
                      }),
              },
            }}
          >
            {/* Draggable resize handle on right edge of sidebar */}
            {wide && !sidebarCollapsed && (
              <Box
                onMouseDown={(e) => {
                  e.preventDefault();
                  setIsResizing(true);
                }}
                onDoubleClick={handleResetWidth}
                sx={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  width: 6,
                  height: '100%',
                  cursor: 'col-resize',
                  zIndex: 20,
                  transition: 'background-color 0.15s ease',
                  '&:hover': {
                    bgcolor: 'rgba(33, 89, 136, 0.3)',
                  },
                  ...(isResizing && {
                    bgcolor: '#215988 !important',
                    width: 4,
                  }),
                }}
                title="Drag to resize sidebar width (double-click to reset)"
              />
            )}
            <SidebarContent
              isAdmin={isAdmin}
              can={(code) => hasPermission(me.data, code)}
              platformRealm={platformRealm}
              onNavigate={() => setDrawerOpen(false)}
              collapsed={wide && sidebarCollapsed}
              onToggleCollapse={wide ? toggleSidebarCollapse : () => setDrawerOpen(false)}
              onOpenSection={wide ? handleOpenSection : undefined}
              currentWidth={sidebarWidth}
              minWidth={MIN_SIDEBAR_WIDTH}
              maxWidth={MAX_SIDEBAR_WIDTH}
              onIncreaseWidth={wide && !sidebarCollapsed ? handleIncreaseWidth : undefined}
              onDecreaseWidth={wide && !sidebarCollapsed ? handleDecreaseWidth : undefined}
              onResetWidth={wide && !sidebarCollapsed ? handleResetWidth : undefined}
            />
          </Drawer>
          <Box component="main" sx={{ flex: 1, minWidth: 0, bgcolor: '#ffffff', p: { xs: 2, md: 3 } }}>
            {stepUpBlocked && mfaProjectState() === 'disabled' && (
              <Alert severity="warning" sx={{ mb: 2 }} data-testid="shell.mfa-blocked">
                <strong>Two-step verification is required for your role, but it is switched off for this project.</strong> The API is
                refusing your requests until that is resolved. Ask an administrator to turn on authenticator (TOTP) sign-in in
                Supabase. For local development, set <code>SUPABASE_MFA_ENABLED=false</code> in <code>apps/api/.env</code> and
                restart the API.
              </Alert>
            )}
            {pageAllowed ? <Outlet /> : <Forbidden />}
          </Box>
        </Box>
      </Box>
    </StepUpProvider>
  );
}
