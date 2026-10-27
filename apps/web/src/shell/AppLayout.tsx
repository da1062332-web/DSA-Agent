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
import { errorText } from '../api/client';
import { PLATFORM_TENANT_ID } from '@dsa/contracts';
import { hasPermission, mfaRequired, useMe, useTenant } from '../api/useMe';
import { useAuth } from '../auth/AuthProvider';
import { StepUpProvider } from '../auth/StepUpProvider';
import { mfaSkipRequested } from '../auth/test-auth';

import { NotificationCenter } from '../features/notifications/NotificationCenter';
import { routeAllowed } from './access';
import { Forbidden } from './Forbidden';
import { MenuIcon } from './icons';
import { SidebarContent } from './Sidebar';

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dsa_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const DEFAULT_SIDEBAR_WIDTH = 290;
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
        <CircularProgress sx={{ color: '#F89344' }} />
      </Centered>
    );
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!aal || me.isPending)
    return (
      <Centered>
        <CircularProgress sx={{ color: '#F89344' }} />
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
  const skipMfa = mfaSkipRequested();
  const needsChallenge = !skipMfa && aal.next === 'aal2' && aal.current !== 'aal2';
  const needsEnrolment = !skipMfa && aal.next !== 'aal2' && mfaRequired(me.data);
  if (needsChallenge || needsEnrolment)
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  const isAdmin = hasPermission(me.data, 'config.manage') || hasPermission(me.data, 'user.manage');
  const platformRealm = me.data?.tenantId === PLATFORM_TENANT_ID;
  // Route guard (audit F-08): by this point the profile and its grants are loaded (the spinner above covers the wait), and a missing
  // profile has no grants, so the check fails closed. The same rules drive the sidebar and the Home cards.
  const pageAllowed = routeAllowed(location.pathname, (code) => hasPermission(me.data, code), platformRealm);

  return (
    <StepUpProvider>
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        {/* Pinned to the top while the page scrolls, and above the sidebar, which sits just below it. */}
        <AppBar
          position="sticky"
          elevation={0}
          sx={{
            top: 0,
            zIndex: (t) => t.zIndex.drawer + 1,
            bgcolor: '#ffffff',
            color: '#0f172a',
            borderBottom: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04)',
          }}
        >
          <Toolbar disableGutters sx={{ minHeight: 64, px: { xs: 2, md: 3 } }}>
            {/* Mobile menu toggle for narrow screens */}
            {!wide && (
              <IconButton
                color="inherit"
                onClick={() => setDrawerOpen(true)}
                data-testid="shell.menu"
                aria-label="Open menu"
                sx={{
                  mr: 1.5,
                  color: '#334155',
                  '&:hover': { bgcolor: 'rgba(15, 23, 42, 0.06)', color: '#0f172a' },
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
                  width: 36,
                  height: 36,
                  borderRadius: 1.5,
                  objectFit: 'contain',
                  flexShrink: 0,
                }}
              />
              <Typography
                variant="h6"
                sx={{
                  color: '#0f172a',
                  fontWeight: 800,
                  letterSpacing: '-0.02em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  fontSize: { xs: '1.1rem', md: '1.25rem' },
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
            </Box>

            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ color: '#334155' }}>
                <NotificationCenter />
              </Box>
              <Button
                color="inherit"
                onClick={(e) => setMenu(e.currentTarget)}
                data-testid="shell.account"
                sx={{
                  textTransform: 'none',
                  bgcolor: 'rgba(15, 23, 42, 0.04)',
                  '&:hover': { bgcolor: 'rgba(15, 23, 42, 0.08)' },
                  border: '1px solid #e2e8f0',
                  borderRadius: 2,
                  px: 1.5,
                  py: 0.5,
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: '#0f172a',
                }}
              >
                {me.data?.displayName}
              </Button>
              <Menu
                anchorEl={menu}
                open={!!menu}
                onClose={() => setMenu(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              >
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
                top: { md: 64 },
                height: { md: 'calc(100vh - 64px)', xs: '100%' },
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
                    bgcolor: 'rgba(248, 147, 68, 0.4)',
                  },
                  ...(isResizing && {
                    bgcolor: '#F89344 !important',
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
          <Box component="main" sx={{ flex: 1, minWidth: 0, p: { xs: 2, md: 3 } }}>
            {pageAllowed ? <Outlet /> : <Forbidden />}
          </Box>
        </Box>
      </Box>
    </StepUpProvider>
  );
}
