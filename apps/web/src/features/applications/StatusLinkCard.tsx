// The customer status link on the application (task P3-05, checklist 6.5). Share creates a link that opens the customer's status page
// without a sign-in, and copies it. The link works for seven days.
import { useState } from 'react';
import { Button, Typography } from '@mui/material';
import { apiFetch, errorText } from '../../api/client';
import { useToast } from '../../shell/toast';
import { AppCard } from '../../ui';

export function StatusLinkCard({ applicationId }: { applicationId: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const share = async () => {
    setBusy(true);
    try {
      const res = await apiFetch<{ url: string; expiresAt: string }>(`/v1/applications/${applicationId}/status-link`, {
        method: 'POST',
      });
      const link = `${window.location.origin}${res.url}`;
      await navigator.clipboard.writeText(link);
      toast.success('Status link copied. It works for seven days.');
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppCard
      title="Customer status"
      subtitle="Send the customer a link to see the stage and the documents still needed. No sign-in is needed."
      dataTestId="application.status-link"
      actions={
        <Button
          variant="outlined"
          size="small"
          onClick={share}
          disabled={busy}
          data-testid="application.share-status-link"
        >
          Share status link
        </Button>
      }
    >
      <Typography variant="body2" color="text.secondary">
        The link expires after seven days. Create a new one to extend it.
      </Typography>
    </AppCard>
  );
}
