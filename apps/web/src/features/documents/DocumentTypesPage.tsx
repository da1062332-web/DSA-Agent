// /documents/types (owner: Dev 3, MOD-DOC; API-DOC-007 / API-DOC-008). The document types this tenant asks for: the platform
// defaults plus its own. Any signed-in staff member can read the list; adding or changing a type needs config.manage. Saving a
// default type stores the tenant's own copy of it.
import {
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  FormLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from '@mui/material';
import { DOCUMENT_CATEGORIES, DOCUMENT_MIME_TYPES, type DocumentType } from '@dsa/contracts';
import { useState } from 'react';
import { hasPermission, useMe } from '../../api/useMe';
import { AppButton, DataTable, PageHeader, StatusBadge } from '../../ui';
import { NotSet } from '../../ui/NotSet';
import { useCommand, useLookup } from '../admin/api';
import { ErrorAlert, Loading } from '../admin/components';
import { documentTypeProblem } from './model';

const SENSITIVITIES = ['S1', 'S2', 'S3'] as const;
const RETENTION_CLASSES = ['R-CFG', 'R-OPS', 'R-LOAN', 'R-FIN', 'R-AUD', 'R-SHORT'] as const;
const MIME_LABELS: Record<(typeof DOCUMENT_MIME_TYPES)[number], string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
};
const readable = (code: string) => code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ');
const megabytes = (bytes: number) => `${Math.round((bytes / 1_048_576) * 10) / 10} MB`;

export function DocumentTypesPage() {
  const me = useMe();
  const canEdit = hasPermission(me.data, 'config.manage');
  const types = useLookup<DocumentType>('/v1/document-types');
  const [editing, setEditing] = useState<DocumentType | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title="Document types"
        subtitle="The documents checklists can ask for. Defaults apply until you save your own version of a type."
        actions={
          canEdit ? (
            <AppButton variant="primary" onClick={() => setEditing('new')} dataTestId="documents.types.new">
              New document type
            </AppButton>
          ) : undefined
        }
      />
      <ErrorAlert error={types.error} />
      {types.isPending ? (
        <Loading />
      ) : (
        <DataTable<DocumentType>
          dataTestId="documents.types.table"
          data={types.data ?? []}
          keyExtractor={(t) => t.code}
          emptyMessage="No document types."
          columns={[
            { id: 'name', header: 'Name', render: (t) => t.name },
            { id: 'code', header: 'Code', render: (t) => t.code },
            { id: 'category', header: 'Category', render: (t) => readable(t.category) },
            {
              id: 'files',
              header: 'Files',
              render: (t) =>
                `${t.allowedMime.map((m) => MIME_LABELS[m as keyof typeof MIME_LABELS] ?? m).join(', ')}, up to ${megabytes(t.maxSizeBytes)}`,
            },
            {
              id: 'validity',
              header: 'Valid for',
              render: (t) => (t.validityMonths ? `${t.validityMonths} months` : <NotSet>No expiry</NotSet>),
            },
            { id: 'sensitivity', header: 'Sensitivity', render: (t) => t.sensitivity },
            {
              id: 'state',
              header: 'Status',
              render: (t) => (
                <StatusBadge
                  status={t.active ? 'success' : 'neutral'}
                  label={`${t.active ? 'Active' : 'Inactive'}${t.custom ? '' : ' (default)'}`}
                />
              ),
            },
            ...(canEdit
              ? [
                  {
                    id: 'edit',
                    header: '',
                    align: 'right' as const,
                    render: (t: DocumentType) => (
                      <AppButton
                        size="small"
                        variant="ghost"
                        onClick={() => setEditing(t)}
                        dataTestId={`documents.types.edit.${t.code}`}
                      >
                        Edit
                      </AppButton>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
      {editing && (
        <DocumentTypeDialog type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function DocumentTypeDialog({ type, onClose }: { type: DocumentType | null; onClose: () => void }) {
  const [code, setCode] = useState(type?.code ?? '');
  const [name, setName] = useState(type?.name ?? '');
  const [category, setCategory] = useState<DocumentType['category']>(type?.category ?? 'OTHER');
  const [allowedMime, setAllowedMime] = useState<string[]>(type?.allowedMime ?? ['application/pdf']);
  const [maxSizeMb, setMaxSizeMb] = useState(type ? String(type.maxSizeBytes / 1_048_576) : '10');
  const [validityMonths, setValidityMonths] = useState(
    type?.validityMonths ? String(type.validityMonths) : '',
  );
  const [sensitivity, setSensitivity] = useState<DocumentType['sensitivity']>(type?.sensitivity ?? 'S2');
  const [retentionClass, setRetentionClass] = useState(type?.retentionClass ?? 'R-LOAN');
  const [instructions, setInstructions] = useState(type?.instructions ?? '');
  const [active, setActive] = useState(type?.active ?? true);
  const save = useCommand<object, DocumentType>(
    () => ({ path: '/v1/document-types', method: 'POST' }),
    [['/v1/document-types']],
    'Document type saved.',
  );
  const problem = documentTypeProblem({ code, name, allowedMime, maxSizeMb, validityMonths, instructions });
  const toggleMime = (mime: string) =>
    setAllowedMime((now) => (now.includes(mime) ? now.filter((m) => m !== mime) : [...now, mime]));

  const submit = () =>
    save.mutate(
      {
        code,
        name: name.trim(),
        category,
        allowedMime,
        maxSizeBytes: Math.round(Number(maxSizeMb) * 1_048_576),
        validityMonths: validityMonths.trim() ? Number(validityMonths) : null,
        sensitivity,
        retentionClass,
        instructions: instructions.trim() || null,
        active,
      },
      { onSuccess: onClose },
    );

  return (
    <Dialog open onClose={save.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{type ? `Edit ${type.name}` : 'New document type'}</DialogTitle>
      <DialogContent>
        <ErrorAlert error={save.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            size="small"
            label="Code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            disabled={!!type}
            helperText={
              type ? 'The code cannot change.' : 'Upper-case letters and underscores, for example GST_RETURN.'
            }
            inputProps={{ 'data-testid': 'documents.types.code' }}
          />
          <TextField
            size="small"
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            inputProps={{ 'data-testid': 'documents.types.name' }}
          />
          <TextField
            select
            size="small"
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value as DocumentType['category'])}
          >
            {DOCUMENT_CATEGORIES.map((c) => (
              <MenuItem key={c} value={c}>
                {readable(c)}
              </MenuItem>
            ))}
          </TextField>
          <FormGroup row>
            <FormLabel sx={{ mr: 2, alignSelf: 'center' }}>File types</FormLabel>
            {DOCUMENT_MIME_TYPES.map((m) => (
              <FormControlLabel
                key={m}
                control={<Checkbox checked={allowedMime.includes(m)} onChange={() => toggleMime(m)} />}
                label={MIME_LABELS[m]}
              />
            ))}
          </FormGroup>
          <TextField
            size="small"
            type="number"
            label="Largest file (MB)"
            value={maxSizeMb}
            onChange={(e) => setMaxSizeMb(e.target.value)}
            helperText="Up to 50 MB."
          />
          <TextField
            size="small"
            type="number"
            label="Valid for (months)"
            value={validityMonths}
            onChange={(e) => setValidityMonths(e.target.value)}
            helperText="Leave blank when the document does not expire."
          />
          <TextField
            select
            size="small"
            label="Sensitivity"
            value={sensitivity}
            onChange={(e) => setSensitivity(e.target.value as DocumentType['sensitivity'])}
            helperText="S3 documents are the most restricted."
          >
            {SENSITIVITIES.map((s) => (
              <MenuItem key={s} value={s}>
                {s}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Retention class"
            value={retentionClass}
            onChange={(e) => setRetentionClass(e.target.value)}
          >
            {RETENTION_CLASSES.map((r) => (
              <MenuItem key={r} value={r}>
                {r}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Instructions for the uploader (optional)"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            multiline
            minRows={2}
            inputProps={{ maxLength: 1000 }}
          />
          <FormControlLabel
            control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />}
            label="Active: checklists can ask for this document"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <AppButton variant="ghost" onClick={onClose} disabled={save.isPending}>
          Cancel
        </AppButton>
        <AppButton
          variant="primary"
          loading={save.isPending}
          disabled={problem !== null}
          dataTestId="documents.types.save"
          onClick={submit}
        >
          Save
        </AppButton>
      </DialogActions>
    </Dialog>
  );
}
