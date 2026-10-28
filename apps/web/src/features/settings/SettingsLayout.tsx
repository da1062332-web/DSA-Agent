// Settings layout shell (owner: Dev 1)
// Wraps settings routes, providing route error handling and top navigation context.
import { Box, Container } from '@mui/material';
import { Outlet } from 'react-router-dom';

export function SettingsLayout() {
  return (
    <Box sx={{ width: '100%', minHeight: '100%', bgcolor: '#ffffff' }}>
      <Container maxWidth={false} disableGutters>
        <Outlet />
      </Container>
    </Box>
  );
}
