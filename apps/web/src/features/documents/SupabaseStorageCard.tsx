import React from 'react';
// apps/web/src/features/documents/SupabaseStorageCard.tsx — Direct Supabase Storage Cloud Explorer
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  deleteSupabaseStorageFile,
  getSupabaseSignedUrl,
  listSupabaseStorageFiles,
  uploadDirectToSupabase,
  type SupabaseStorageFile,
} from './api';
import { NotSet } from '../../ui/NotSet';

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatDate(isoString?: string | null): React.ReactNode {
  if (!isoString) return <NotSet />;
  try {
    const d = new Date(isoString);
    return d.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export function SupabaseStorageCard() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const {
    data: files = [],
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ['supabase-storage-documents'],
    queryFn: () => listSupabaseStorageFiles('Documents'),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      return await uploadDirectToSupabase(file, 'Documents');
    },
    onSuccess: (res) => {
      setToastMessage(`Uploaded ${res.path.split('/').pop()} successfully!`);
      qc.invalidateQueries({ queryKey: ['supabase-storage-documents'] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setToastMessage(`Error: ${msg}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (path: string) => {
      return await deleteSupabaseStorageFile(`Documents/${path}`);
    },
    onSuccess: () => {
      setToastMessage('Document deleted successfully.');
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['supabase-storage-documents'] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      setToastMessage(`Error: ${msg}`);
    },
  });

  const handlePreview = async (fileName: string) => {
    try {
      const url = await getSupabaseSignedUrl(`Documents/${fileName}`, 3600);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to generate link';
      setToastMessage(msg);
    }
  };

  const handleCopyLink = async (fileName: string) => {
    try {
      const url = await getSupabaseSignedUrl(`Documents/${fileName}`, 3600);
      await navigator.clipboard.writeText(url);
      setToastMessage('Signed preview link copied to clipboard (valid 1 hr)!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not copy link';
      setToastMessage(msg);
    }
  };

  return (
    <Card sx={{ mt: 3 }} data-testid="supabase-storage-card">
      <CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1} mb={2}>
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h6">Supabase Cloud Storage</Typography>
              <Chip label="Bucket: Media / Documents" size="small" color="primary" variant="outlined" />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Upload documents directly from the browser or inspect files stored in your Supabase bucket.
            </Typography>
          </Box>

          <Stack direction="row" spacing={1}>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              accept=".pdf,.png,.jpg,.jpeg"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) uploadMutation.mutate(file);
              }}
            />
            <Button
              variant="contained"
              size="small"
              disabled={uploadMutation.isPending}
              onClick={() => fileInputRef.current?.click()}
              startIcon={uploadMutation.isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {uploadMutation.isPending ? 'Uploading...' : 'Upload Document'}
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() => refetch()}
              disabled={isLoading || isRefetching}
            >
              Refresh
            </Button>
          </Stack>
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error instanceof Error ? error.message : 'Failed to load storage files.'}
          </Alert>
        )}

        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={32} />
          </Box>
        ) : files.length === 0 ? (
          <Box sx={{ py: 3, textAlign: 'center', bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography color="text.secondary">No files in Media/Documents yet. Upload one above!</Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>File Name</TableCell>
                  <TableCell>Format</TableCell>
                  <TableCell align="right">Size</TableCell>
                  <TableCell>Uploaded</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {files.map((file: SupabaseStorageFile) => {
                  const ext = file.name.split('.').pop()?.toUpperCase() || 'FILE';
                  return (
                    <TableRow key={file.name} hover>
                      <TableCell sx={{ fontWeight: 500 }}>
                        {file.name}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={ext}
                          size="small"
                          color={ext === 'PDF' ? 'error' : 'info'}
                          variant="outlined"
                          sx={{ fontSize: '0.72rem', height: 20 }}
                        />
                      </TableCell>
                      <TableCell align="right" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                        {formatBytes(file.metadata?.size)}
                      </TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>
                        {formatDate(file.created_at || file.updated_at)}
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => handlePreview(file.name)}
                          >
                            Preview
                          </Button>
                          <Button
                            size="small"
                            variant="text"
                            onClick={() => handleCopyLink(file.name)}
                          >
                            Copy Link
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            variant="text"
                            onClick={() => setDeleteTarget(file.name)}
                          >
                            Delete
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>

      {/* Confirmation Dialog for Deletion */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete from Supabase Storage?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to permanently delete <strong>{deleteTarget}</strong> from your Supabase <code>Media/Documents</code> bucket?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleteMutation.isPending}
            onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete Permanently'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Feedback Toast */}
      <Snackbar
        open={!!toastMessage}
        autoHideDuration={4000}
        onClose={() => setToastMessage(null)}
        message={toastMessage}
      />
    </Card>
  );
}
