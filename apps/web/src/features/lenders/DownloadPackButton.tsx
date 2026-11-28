// "Download pack" for a lender case (owner: Dipanshu; task P2-04, API-LCS-PCK-001). Shown on the case's frozen package to users with
// lender_case.submit. The API builds the ZIP from the frozen manifest, in the lender's pack profile order and names, and audits it.
import { Alert, Button, Stack } from '@mui/material';
import { useState } from 'react';
import { apiDownload, errorText } from '../../api/client';
import { hasPermission, useMe } from '../../api/useMe';

export function DownloadPackButton({ lenderCaseId, frozen }: { lenderCaseId: string; frozen: boolean }) {
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!hasPermission(me.data, 'lender_case.submit')) return null;

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiDownload(`/v1/lender-cases/${lenderCaseId}/pack`, `lender-pack-${lenderCaseId}.zip`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={1} alignItems="flex-start">
      <Button
        variant="contained"
        size="small"
        disabled={!frozen || busy}
        onClick={download}
        title={frozen ? undefined : 'Freeze the package first.'}
        data-testid="lenderPack.download"
      >
        {busy ? 'Preparing pack…' : 'Download pack'}
      </Button>
      {error ? (
        <Alert severity="error" onClose={() => setError(null)} data-testid="lenderPack.downloadError">
          {error}
        </Alert>
      ) : null}
    </Stack>
  );
}
