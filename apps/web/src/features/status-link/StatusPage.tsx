// The customer's status page at /status/:token (task P3-05, checklist 6.4). No sign-in and no sidebar. It shows the stage, the documents
// still needed and the date of the last update, and nothing that names the customer.
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Box, CircularProgress, Container, Stack, Typography } from '@mui/material';
import { apiFetch } from '../../api/client';
import { linkErrorMessage, pendingLine, updatedLine, type PublicStatusView } from './status-view';

export function StatusPage() {
  const { token = '' } = useParams();
  const status = useQuery({
    queryKey: ['public-status', token],
    queryFn: () => apiFetch<PublicStatusView>(`/public/v1/status/${encodeURIComponent(token)}`),
    retry: false,
    refetchOnWindowFocus: false,
  });

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: 4 }}>
      <Container maxWidth="xs" sx={{ px: 2 }}>
        <Typography variant="overline" color="text.secondary">
          Your application
        </Typography>

        {status.isLoading && (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <CircularProgress size={28} />
          </Box>
        )}

        {status.isError && (
          <Stack spacing={1} sx={{ mt: 1 }} data-testid="status.error">
            <Typography variant="h5" fontWeight={700}>
              {linkErrorMessage(status.error).title}
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {linkErrorMessage(status.error).body}
            </Typography>
          </Stack>
        )}

        {status.data && (
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            <Typography variant="h5" fontWeight={700} data-testid="status.stage">
              {status.data.stage}
            </Typography>
            {pendingLine(status.data.pendingDocuments) && (
              <Typography variant="body1" data-testid="status.pending">
                {pendingLine(status.data.pendingDocuments)}
              </Typography>
            )}
            {updatedLine(status.data.lastUpdated) && (
              <Typography variant="body2" color="text.secondary" data-testid="status.updated">
                {updatedLine(status.data.lastUpdated)}
              </Typography>
            )}
          </Stack>
        )}
      </Container>
    </Box>
  );
}
