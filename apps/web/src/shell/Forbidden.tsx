// Shown instead of a page the signed-in user's permissions do not allow (audit F-08). The API refuses the same requests; this stops the
// page shell from rendering and calling endpoints that can only answer 403.
import { Alert, Box, Button, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

export function Forbidden() {
  return (
    <Box data-testid="shell.forbidden" sx={{ maxWidth: 560, mx: 'auto', mt: 6 }}>
      <Alert severity="warning" sx={{ mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          You do not have permission to access this page.
        </Typography>
        <Typography variant="body2">
          Ask an administrator if you need access. Nothing was loaded for this page.
        </Typography>
      </Alert>
      <Button component={RouterLink} to="/" variant="contained">
        Back to Home
      </Button>
    </Box>
  );
}
