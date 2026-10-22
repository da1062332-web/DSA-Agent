// apps/web/src/features/messaging/TemplateEditor.tsx — CMP-MSG.01.1
import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { apiFetch, errorText } from '../../api/client';
import {
  MESSAGE_CHANNELS,
  TEMPLATE_CATEGORIES,
  type MessageChannel,
  type TemplateCategory,
  type MessageTemplate,
  type TemplateVariableDeclaration,
} from '@dsa/contracts';

export interface TemplateEditorProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (template: MessageTemplate) => void;
}

export function TemplateEditor({ open, onClose, onSuccess }: TemplateEditorProps) {
  const [code, setCode] = useState('');
  const [channel, setChannel] = useState<MessageChannel>('EMAIL');
  const [category, setCategory] = useState<TemplateCategory>('TRANSACTIONAL');
  const [language, setLanguage] = useState('en');
  const [body, setBody] = useState('Hello {{applicantName}}, your loan application status is {{status}}.');
  const [variables, setVariables] = useState<TemplateVariableDeclaration[]>([
    { name: 'applicantName', required: true, description: 'Applicant full name' },
    { name: 'status', required: true, description: 'Application state' },
  ]);
  const [newVarName, setNewVarName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddVariable = () => {
    const trimmed = newVarName.trim();
    if (trimmed && !variables.some((v) => v.name === trimmed)) {
      setVariables([...variables, { name: trimmed, required: true }]);
      setNewVarName('');
    }
  };

  const handleRemoveVariable = (name: string) => {
    setVariables(variables.filter((v) => v.name !== name));
  };

  // Extract all variables referenced in body
  const bodyVariables = React.useMemo(() => {
    const declaredNames = new Set(variables.map((v) => v.name));
    const undeclared: string[] = [];
    const matches = body.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g);
    for (const m of matches) {
      const varName = m[1];
      if (varName && !declaredNames.has(varName) && !undeclared.includes(varName)) {
        undeclared.push(varName);
      }
    }
    return { undeclared };
  }, [body, variables]);

  // Preview synthetic rendering
  const renderPreview = () => {
    let preview = body;
    for (const v of variables) {
      const syntheticVal = `[${v.name.toUpperCase()}]`;
      preview = preview.replaceAll(`{{${v.name}}}`, syntheticVal);
    }
    return preview;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (bodyVariables.undeclared.length > 0) {
      setError(`Template body uses undeclared variable(s): {{${bodyVariables.undeclared.join('}}, {{')}}}. Declare them below before approving.`);
      return;
    }

    setLoading(true);

    try {
      const data = await apiFetch<MessageTemplate>('/v1/message-templates', {
        method: 'POST',
        body: {
          code: code.trim(),
          channel,
          category,
          language: language.trim() || 'en',
          body: body.trim(),
          variables,
          status: 'APPROVED',
        },
      });

      onSuccess(data);
      onClose();
    } catch (err: unknown) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle sx={{ fontWeight: 700 }}>Create Message Template (CMP-MSG.01.1)</DialogTitle>
        <DialogContent dividers>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Template Code"
                placeholder="e.g. loan_status_notice"
                fullWidth
                required
                value={code}
                onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                helperText="Lowercase alphanumeric with ., _, or -"
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Channel</InputLabel>
                <Select
                  value={channel}
                  label="Channel"
                  onChange={(e) => setChannel(e.target.value as MessageChannel)}
                >
                  {MESSAGE_CHANNELS.map((ch) => (
                    <MenuItem key={ch} value={ch}>
                      {ch}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Category</InputLabel>
                <Select
                  value={category}
                  label="Category"
                  onChange={(e) => setCategory(e.target.value as TemplateCategory)}
                >
                  {TEMPLATE_CATEGORIES.map((cat) => (
                    <MenuItem key={cat} value={cat}>
                      {cat}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                label="Language"
                value={language}
                fullWidth
                onChange={(e) => setLanguage(e.target.value)}
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                label="Template Body"
                multiline
                rows={4}
                fullWidth
                required
                value={body}
                onChange={(e) => setBody(e.target.value)}
                helperText="Declare placeholders using {{variableName}}"
              />
            </Grid>

            {/* Variable manager */}
            <Grid item xs={12}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                Declared Variables:
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
                {variables.map((v) => (
                  <Chip
                    key={v.name}
                    label={`{{${v.name}}}`}
                    color="primary"
                    variant="outlined"
                    onDelete={() => handleRemoveVariable(v.name)}
                  />
                ))}
                {variables.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    No variables declared.
                  </Typography>
                )}
              </Box>

              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  size="small"
                  placeholder="New variable (e.g. loanAmount)"
                  value={newVarName}
                  onChange={(e) => setNewVarName(e.target.value)}
                />
                <Button variant="outlined" size="small" onClick={handleAddVariable}>
                  Add Variable
                </Button>
              </Box>
            </Grid>

            {/* Live Synthetic Preview */}
            <Grid item xs={12}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                Live Message Preview:
              </Typography>
              {bodyVariables.undeclared.length > 0 && (
                <Alert severity="warning" sx={{ mb: 1.5 }}>
                  Undeclared variable(s) found in body: <strong>{bodyVariables.undeclared.map(v => `{{${v}}}`).join(', ')}</strong>. Please declare them above or remove them from the message body.
                </Alert>
              )}
              <Paper variant="outlined" sx={{ p: 2, bgcolor: '#f8fafc', borderRadius: 1.5 }}>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                  {renderPreview()}
                </Typography>
              </Paper>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={loading}>
            {loading ? 'Creating...' : 'Save & Approve Template'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
