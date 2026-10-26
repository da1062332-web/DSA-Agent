// apps/web/src/features/messaging/TemplateEditor.tsx — CMP-MSG.01.1
import React, { useRef, useState } from 'react';
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

// Languages the messaging templates can be written in (ISO codes, as the server stores them).
const LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi (हिन्दी)' },
  { code: 'mr', label: 'Marathi (मराठी)' },
  { code: 'ta', label: 'Tamil (தமிழ்)' },
  { code: 'te', label: 'Telugu (తెలుగు)' },
  { code: 'gu', label: 'Gujarati (ગુજરાતી)' },
  { code: 'bn', label: 'Bengali (বাংলা)' },
  { code: 'kn', label: 'Kannada (ಕನ್ನಡ)' },
];

// Variables used in lending messages. Clicking one puts {{name}} into the body at the cursor and declares it.
const COMMON_VARIABLES: { name: string; description: string }[] = [
  { name: 'applicantName', description: 'Applicant full name' },
  { name: 'customerName', description: 'Customer full name' },
  { name: 'leadName', description: 'Lead full name' },
  { name: 'applicationId', description: 'Loan application ID' },
  { name: 'loanAmount', description: 'Loan amount (INR)' },
  { name: 'status', description: 'Application or case status' },
  { name: 'productName', description: 'Loan product name' },
  { name: 'lenderName', description: 'Lender name' },
  { name: 'branchName', description: 'Branch name' },
  { name: 'agentName', description: 'Sales or relationship manager name' },
  { name: 'agentMobile', description: 'Sales or relationship manager mobile' },
  { name: 'dueDate', description: 'Due date (DD/MM/YYYY)' },
  { name: 'paymentAmount', description: 'Payment amount (INR)' },
  { name: 'documentName', description: 'Document required' },
  { name: 'companyName', description: 'Company name' },
  { name: 'supportPhone', description: 'Support phone number' },
];

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
  // The starting body uses both variables, so both are declared.
  const [newVarName, setNewVarName] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddVariable = () => {
    const trimmed = newVarName.trim();
    if (/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      insertVariable(trimmed, '');
      setNewVarName('');
    }
  };


  // Working state: the variables are exactly the {{placeholders}} in the body, so nothing is declared that the message
  // does not use, and nothing used is missed. A variable keeps its description and required flag if it was already there.
  React.useEffect(() => {
    const names = Array.from(new Set(Array.from(body.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g), (m) => m[1]!)));
    setVariables((prev) =>
      names.map(
        (name) =>
          prev.find((v) => v.name === name) ?? {
            name,
            required: true,
            description: COMMON_VARIABLES.find((c) => c.name === name)?.description ?? '',
          },
      ),
    );
  }, [body]);

  // Puts {{name}} into the body at the cursor and declares the variable.
  const insertVariable = (name: string, description: string) => {
    const token = `{{${name}}}`;
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    if (!variables.some((v) => v.name === name)) {
      setVariables((prev) => [...prev, { name, required: true, description }]);
    }
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
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
        <DialogTitle sx={{ fontWeight: 700 }}>Create Message Template</DialogTitle>
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
                <InputLabel id="template-channel-label">Channel</InputLabel>
                <Select
                  labelId="template-channel-label"
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
                <InputLabel id="template-category-label">Category</InputLabel>
                <Select
                  labelId="template-category-label"
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
              <FormControl fullWidth>
                <InputLabel id="template-language-label">Language</InputLabel>
                <Select
                  labelId="template-language-label"
                  label="Language"
                  value={language}
                  onChange={(e) => setLanguage(String(e.target.value))}
                  data-testid="template.language"
                >
                  {LANGUAGES.map((l) => (
                    <MenuItem key={l.code} value={l.code}>
                      {l.label} ({l.code})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12}>
              <TextField
                label="Template Body"
                multiline
                rows={4}
                fullWidth
                required
                value={body}
                inputRef={bodyRef}
                onChange={(e) => setBody(e.target.value)}
                helperText="Click a common variable below to insert it at the cursor, or type {{variableName}}. Variables are declared automatically."
              />
            </Grid>

            {/* Common variables: click to insert */}
            <Grid item xs={12}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                Common variables (click to insert):
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }} data-testid="template.common-variables">
                {COMMON_VARIABLES.map((c) => {
                  const declared = variables.some((v) => v.name === c.name);
                  return (
                    <Chip
                      key={c.name}
                      size="small"
                      clickable
                      color={declared ? 'primary' : 'default'}
                      variant={declared ? 'filled' : 'outlined'}
                      label={`{{${c.name}}}`}
                      title={c.description}
                      onClick={() => insertVariable(c.name, c.description)}
                    />
                  );
                })}
              </Box>
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
                    title={v.description || v.name}
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
            {loading ? 'Creating...' : 'Save as draft (needs approval)'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
