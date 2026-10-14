import { Alert, AlertTitle, Box, Button, Container, Stack, Typography } from '@mui/material';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';

export function RouteErrorBoundary() {
  const error = useRouteError();

  let message = 'An unexpected error occurred while loading this page.';
  if (isRouteErrorResponse(error)) {
    message = `${error.status} ${error.statusText}: ${error.data || message}`;
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Box sx={{ p: 2 }}>
        <Alert
          severity="error"
          sx={{ borderRadius: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        >
          <AlertTitle sx={{ fontWeight: 600 }}>Application Error</AlertTitle>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {message}
          </Typography>
        </Alert>
        <Stack direction="row" spacing={2} sx={{ mt: 3, justifyContent: 'center' }}>
          <Button variant="outlined" onClick={() => (window.location.href = '/')}>
            Return to Dashboard
          </Button>
          <Button variant="contained" onClick={() => window.location.reload()}>
            Try Again
          </Button>
        </Stack>
      </Box>
    </Container>
  );
}
