// Route stub used until a screen owner replaces the element in their feature's routes.tsx.
import { Alert, Box, Typography } from '@mui/material';
import { useLocation } from 'react-router-dom';

export function Placeholder({ name, owner }: { name: string; owner: string }) {
  const { pathname } = useLocation();
  return (
    <Box data-testid="shell.placeholder" sx={{ p: 3 }}>
      <Typography variant="h5" gutterBottom>
        {name}
      </Typography>
      <Alert severity="info">
        Not implemented yet. Owner: {owner}. Route: <code>{pathname}</code>
      </Alert>
    </Box>
  );
}
