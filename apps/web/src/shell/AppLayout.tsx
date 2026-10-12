// Minimal shell (owner: Dev 1). UI-PLT-001 adds sign-in state, permission-gated navigation and the
// StepUpDialog; features link to each other by URL only.
import { AppBar, Box, Button, Toolbar, Typography } from '@mui/material';
import { Link as RouterLink, Outlet } from 'react-router-dom';

const NAV = [
  { to: '/leads', label: 'Leads' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/applications', label: 'Applications' },
  { to: '/rules', label: 'Rules' },
  { to: '/decisions', label: 'Decisions' },
];

export function AppLayout() {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0}>
        <Toolbar sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Typography
            variant="h6"
            component={RouterLink}
            to="/"
            sx={{ color: 'inherit', textDecoration: 'none', mr: 2 }}
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
        </Toolbar>
      </AppBar>
      <Box component="main">
        <Outlet />
      </Box>
    </Box>
  );
}
