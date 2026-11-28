// Lender pack profile on /lenders/:id (owner: Dipanshu; task P2-04, API-LND-PCK-001/002). The order a lender wants documents in
// and how each file in the downloaded pack is named. A lender without a profile uses the default (manifest order, {seq}_{docType}).
// Viewing needs a lender permission or lender_case.submit; saving needs lender.manage or config.manage and sends the version it
// loaded (If-Match; "0" creates the lender's profile). The preview uses the same naming function as the download.
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { LenderPackProfile } from '@dsa/contracts';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, errorText } from '../../api/client';
import { hasPermission, useMe } from '../../api/useMe';
import { useLookup } from '../admin/api';
import { move, patternError, previewNames } from './pack-profile';

interface DocumentTypeOption {
  code: string;
  name: string;
}

export function LenderPackProfileCard({ lenderId }: { lenderId: string }) {
  const me = useMe();
  const canRead = ['lender.read', 'lender.manage', 'config.manage', 'lender_case.submit'].some((c) =>
    hasPermission(me.data, c),
  );
  const canEdit = hasPermission(me.data, 'lender.manage') || hasPermission(me.data, 'config.manage');
  const path = `/v1/lenders/${lenderId}/pack-profile`;
  const profile = useQuery({
    queryKey: [path],
    queryFn: () => apiFetch<LenderPackProfile>(path),
    enabled: canRead,
  });
  const types = useLookup<DocumentTypeOption>('/v1/document-types', {}, canRead);
  const [editing, setEditing] = useState(false);

  if (!canRead) return null;
  const p = profile.data;
  const typeName = (code: string) => types.data?.find((t) => t.code === code)?.name ?? code;

  return (
    <Card sx={{ mb: 4 }} data-testid="lenderPack.card">
      <CardHeader
        title={
          <Typography variant="h6" fontWeight={700}>
            Document pack
          </Typography>
        }
        subheader="How this lender wants the submission pack: the document order and the file names in the downloaded ZIP."
        action={
          canEdit &&
          p && (
            <Button
              variant="outlined"
              size="small"
              onClick={() => setEditing(true)}
              data-testid="lenderPack.edit"
            >
              Edit pack profile
            </Button>
          )
        }
      />
      <Divider />
      <CardContent>
        {profile.error ? <Alert severity="error">{errorText(profile.error)}</Alert> : null}
        {p ? (
          <Stack spacing={2}>
            {p.isDefault ? (
              <Alert severity="info" data-testid="lenderPack.default">
                No pack profile yet: files keep the package order and are named {p.filenamePattern}.
              </Alert>
            ) : null}
            <Box>
              <Typography variant="caption" color="text.secondary">
                Document order
              </Typography>
              <Stack
                direction="row"
                spacing={1}
                flexWrap="wrap"
                useFlexGap
                sx={{ mt: 0.5 }}
                data-testid="lenderPack.order"
              >
                {p.documentOrder.length === 0 ? (
                  <Typography variant="body2">As in the package</Typography>
                ) : (
                  p.documentOrder.map((code, i) => (
                    <Chip key={code} size="small" label={`${i + 1}. ${typeName(code)}`} />
                  ))
                )}
              </Stack>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                File name pattern
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }} data-testid="lenderPack.pattern">
                {p.filenamePattern}
              </Typography>
            </Box>
          </Stack>
        ) : null}
      </CardContent>
      {editing && p ? (
        <PackProfileDialog
          path={path}
          profile={p}
          types={types.data ?? []}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </Card>
  );
}

function PackProfileDialog({
  path,
  profile,
  types,
  onClose,
}: {
  path: string;
  profile: LenderPackProfile;
  types: DocumentTypeOption[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [order, setOrder] = useState<string[]>(profile.documentOrder);
  const [pattern, setPattern] = useState(profile.filenamePattern);
  const [adding, setAdding] = useState('');
  const save = useMutation({
    meta: { handled: true },
    mutationFn: () =>
      apiFetch<LenderPackProfile>(path, {
        method: 'PUT',
        version: profile.version,
        body: { documentOrder: order, filenamePattern: pattern.trim() },
      }),
    onSuccess: (saved) => {
      qc.setQueryData([path], saved);
      onClose();
    },
  });
  const error = patternError(pattern.trim());
  const preview = previewNames(order, pattern.trim());
  const name = (code: string) => types.find((t) => t.code === code)?.name ?? code;
  const available = types.filter((t) => !order.includes(t.code));

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Pack profile</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            List the document types in the order the lender wants them. Types you do not list follow, in the
            package order.
          </Typography>
          <List dense data-testid="lenderPack.dialog.order">
            {order.map((code, i) => (
              <ListItem
                key={code}
                secondaryAction={
                  <Stack direction="row">
                    <IconButton
                      size="small"
                      aria-label="Move up"
                      disabled={i === 0}
                      onClick={() => setOrder(move(order, i, -1))}
                      data-testid={`lenderPack.up.${code}`}
                    >
                      ↑
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label="Move down"
                      disabled={i === order.length - 1}
                      onClick={() => setOrder(move(order, i, 1))}
                      data-testid={`lenderPack.down.${code}`}
                    >
                      ↓
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label="Remove"
                      onClick={() => setOrder(order.filter((c) => c !== code))}
                      data-testid={`lenderPack.remove.${code}`}
                    >
                      ×
                    </IconButton>
                  </Stack>
                }
              >
                <ListItemText primary={`${i + 1}. ${name(code)}`} secondary={code} />
              </ListItem>
            ))}
          </List>
          <TextField
            select
            size="small"
            label="Add a document type"
            value={adding}
            onChange={(e) => {
              setOrder([...order, e.target.value]);
              setAdding('');
            }}
            disabled={available.length === 0 || order.length >= 60}
            inputProps={{ 'data-testid': 'lenderPack.add' }}
          >
            {available.map((t) => (
              <MenuItem key={t.code} value={t.code}>
                {t.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="File name pattern"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            error={!!error}
            helperText={
              error ?? 'Tokens: {seq} (required), {docType}, {party}, {original}. The extension is added.'
            }
            inputProps={{ 'data-testid': 'lenderPack.patternInput' }}
          />
          {preview.length ? (
            <Box data-testid="lenderPack.preview">
              <Typography variant="caption" color="text.secondary">
                Example file names
              </Typography>
              {preview.map((n) => (
                <Typography key={n} variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {n}
                </Typography>
              ))}
            </Box>
          ) : null}
          {save.error ? <Alert severity="error">{errorText(save.error)}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!!error || save.isPending}
          onClick={() => save.mutate()}
          data-testid="lenderPack.save"
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
