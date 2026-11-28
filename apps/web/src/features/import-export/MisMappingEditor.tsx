// apps/web/src/features/import-export/MisMappingEditor.tsx — P1-07 / TASK-140.
// The lender's saved mapping: how that bank's daily sheet is read. Set up once by operations, used every morning,
// so this screen is edited rarely and depended on constantly.
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useSaveLenderMisMapping, type LenderMisMapping } from './api';
import { errorText } from '../../api/client';

const DATE_FORMATS = ['DD-MM-YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'DD-MMM-YYYY'] as const;

/** Our statuses, as the stage words map onto them. */
const CASE_STATUSES = [
  'SUBMITTED',
  'UNDER_PROCESSING',
  'QUERY_RAISED',
  'QUERY_RESPONDED',
  'SANCTIONED',
  'REJECTED',
  'WITHDRAWN',
  'PARTIALLY_DISBURSED',
  'DISBURSED',
  'CLOSED',
] as const;

const MIS_FIELDS = [
  { value: 'lenderReference', label: 'Lender reference (required)' },
  { value: 'status', label: 'Stage (required)' },
  { value: 'reasonText', label: 'Remarks' },
  { value: 'disbursedAmount', label: 'Disbursed amount' },
  { value: 'disbursedOn', label: 'Disbursed on' },
] as const;

interface Pair {
  key: string;
  value: string;
}

const toPairs = (record: Record<string, string> | undefined): Pair[] =>
  Object.entries(record ?? {}).map(([key, value]) => ({ key, value }));

const toRecord = (pairs: Pair[]): Record<string, string> =>
  Object.fromEntries(pairs.filter((p) => p.key.trim() && p.value).map((p) => [p.key.trim(), p.value]));

export function MisMappingEditor({
  lenderId,
  mapping,
}: {
  lenderId: string | null;
  mapping: LenderMisMapping | null;
}) {
  const save = useSaveLenderMisMapping();

  const [columns, setColumns] = useState<Pair[]>([]);
  const [statuses, setStatuses] = useState<Pair[]>([]);
  const [dateFormat, setDateFormat] = useState<string>('DD-MM-YYYY');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Reloads whenever the lender changes, so switching banks never shows the previous one's mapping.
  useEffect(() => {
    setColumns(toPairs(mapping?.columnMap));
    setStatuses(toPairs(mapping?.statusMap));
    setDateFormat(mapping?.dateFormat ?? 'DD-MM-YYYY');
    setError(null);
    setSaved(false);
  }, [lenderId, mapping]);

  if (!lenderId) {
    return (
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="body2" color="text.secondary">
            Choose a lender above to see or edit how its sheet is read.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const setPair = (list: Pair[], setList: (p: Pair[]) => void, index: number, patch: Partial<Pair>) => {
    setList(list.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const handleSave = async () => {
    setError(null);
    setSaved(false);
    try {
      await save.mutateAsync({
        lenderId,
        input: { columnMap: toRecord(columns), statusMap: toRecord(statuses), dateFormat },
      });
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Card sx={{ mb: 3 }} data-testid="import.mis-mapping-editor">
      <CardHeader
        title="How this bank's sheet is read"
        subheader={
          mapping
            ? `Version ${mapping.version}${mapping.lastImportAt ? ` · last import ${mapping.lastImportAt.slice(0, 10)}` : ' · never imported'}`
            : 'No mapping saved yet'
        }
      />
      <Divider />
      <CardContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {saved && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSaved(false)}>
            Saved. Tomorrow&apos;s sheet will be read with this mapping.
          </Alert>
        )}

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Columns
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          The heading as it appears in the bank&apos;s file, and what it holds.
        </Typography>
        <Stack spacing={1.5} sx={{ mb: 3 }}>
          {columns.map((pair, i) => (
            <Stack direction="row" spacing={1} key={`col-${i}`}>
              <TextField
                size="small"
                label="Column heading"
                value={pair.key}
                onChange={(e) => setPair(columns, setColumns, i, { key: e.target.value })}
                inputProps={{ 'data-testid': `import.mis-column-key-${i}` }}
                sx={{ flex: 1 }}
              />
              <TextField
                select
                size="small"
                label="Holds"
                value={pair.value}
                onChange={(e) => setPair(columns, setColumns, i, { value: e.target.value })}
                inputProps={{ 'data-testid': `import.mis-column-field-${i}` }}
                sx={{ flex: 1 }}
              >
                {MIS_FIELDS.map((f) => (
                  <MenuItem key={f.value} value={f.value}>
                    {f.label}
                  </MenuItem>
                ))}
              </TextField>
              <IconButton
                aria-label="Remove column"
                data-testid={`import.mis-column-remove-${i}`}
                onClick={() => setColumns(columns.filter((_, idx) => idx !== i))}
              >
                ×
              </IconButton>
            </Stack>
          ))}
          <Button
            size="small"
            data-testid="import.mis-column-add"
            onClick={() => setColumns([...columns, { key: '', value: '' }])}
            sx={{ alignSelf: 'flex-start' }}
          >
            Add column
          </Button>
        </Stack>

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Stage words
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          The bank&apos;s own word for a stage, and the status it means here. Matched ignoring case and spacing, so
          &quot;Disb Done&quot; covers &quot;DISB DONE&quot; too. A word that is not listed becomes an exception
          naming itself, rather than being guessed at.
        </Typography>
        <Stack spacing={1.5} sx={{ mb: 3 }}>
          {statuses.map((pair, i) => (
            <Stack direction="row" spacing={1} key={`st-${i}`}>
              <TextField
                size="small"
                label="The bank writes"
                value={pair.key}
                onChange={(e) => setPair(statuses, setStatuses, i, { key: e.target.value })}
                inputProps={{ 'data-testid': `import.mis-status-word-${i}` }}
                sx={{ flex: 1 }}
              />
              <TextField
                select
                size="small"
                label="Means"
                value={pair.value}
                onChange={(e) => setPair(statuses, setStatuses, i, { value: e.target.value })}
                inputProps={{ 'data-testid': `import.mis-status-value-${i}` }}
                sx={{ flex: 1 }}
              >
                {CASE_STATUSES.map((st) => (
                  <MenuItem key={st} value={st}>
                    {st}
                  </MenuItem>
                ))}
              </TextField>
              <IconButton
                aria-label="Remove stage word"
                data-testid={`import.mis-status-remove-${i}`}
                onClick={() => setStatuses(statuses.filter((_, idx) => idx !== i))}
              >
                ×
              </IconButton>
            </Stack>
          ))}
          <Button
            size="small"
            data-testid="import.mis-status-add"
            onClick={() => setStatuses([...statuses, { key: '', value: '' }])}
            sx={{ alignSelf: 'flex-start' }}
          >
            Add stage word
          </Button>
        </Stack>

        <Stack direction="row" spacing={2} alignItems="center">
          <TextField
            select
            size="small"
            label="Dates are written"
            value={dateFormat}
            onChange={(e) => setDateFormat(e.target.value)}
            inputProps={{ 'data-testid': 'import.mis-date-format' }}
            helperText="Stated, never guessed: 03-04-2026 is a real date read either way."
            sx={{ minWidth: 220 }}
          >
            {DATE_FORMATS.map((f) => (
              <MenuItem key={f} value={f}>
                {f}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            data-testid="import.mis-save"
            disabled={save.isPending}
            onClick={handleSave}
          >
            {save.isPending ? 'Saving…' : 'Save mapping'}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
