// Shell with auth guard and navigation (owner: Dev 1).
import { useEffect, useState } from 'react';
import { AppBar, Box, Button, Chip, Toolbar, Typography } from '@mui/material';
import { Link as RouterLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

const NAV = [
  { to: '/leads', label: 'Leads' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/applications', label: 'Applications' },
  { to: '/rules', label: 'Rules' },
  { to: '/decisions', label: 'Decisions' },
  { to: '/users', label: 'Users' },
  { to: '/roles', label: 'Access Control' },
  { to: '/config', label: 'Configuration' },
];

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [currentUser, setCurrentUser] = useState<{ email: string; displayName: string } | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem('dsa_auth_user');
    if (!raw) {
      // First time opening app: strictly require login first (no dashboard without login)
      navigate('/login', { replace: true });
    } else {
      try {
        setCurrentUser(JSON.parse(raw));
      } catch {
        navigate('/login', { replace: true });
      }
    }
  }, [location.pathname, navigate]);

  const handleSignOut = () => {
    sessionStorage.removeItem('dsa_auth_user');
    sessionStorage.removeItem('dsa_auth_token');
    localStorage.removeItem('dsa_auth_user');
    localStorage.removeItem('dsa_auth_token');
    setCurrentUser(null);
    navigate('/login', { replace: true });
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0}>
        <Toolbar sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Typography
            variant="h6"
            component={RouterLink}
            to="/"
            sx={{ color: 'inherit', textDecoration: 'none', mr: 2, fontWeight: 700 }}
          >
            DSA CRM
          </Typography>
          {NAV.map((item) => (
            <Button
              key={item.to}
              color="inherit"
              component={RouterLink}
              to={item.to}
              data-testid={`shell.nav.${item.label.toLowerCase()}`}
            >
              {item.label}
            </Button>
          ))}

          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {currentUser ? (
              <>
                <Chip
                  label={currentUser.email}
                  size="small"
                  sx={{ bgcolor: 'rgba(255,255,255,0.15)', color: 'inherit' }}
                />
                <Button color="inherit" size="small" variant="outlined" onClick={handleSignOut} sx={{ borderColor: 'rgba(255,255,255,0.5)' }}>
                  Sign Out
                </Button>
              </>
            ) : (
              <Button color="inherit" component={RouterLink} to="/login">
                Sign In
              </Button>
            )}
          </Box>
        </Toolbar>
      </AppBar>
      <Box component="main">
        <Outlet />
      </Box>
    </Box>
  );
}
