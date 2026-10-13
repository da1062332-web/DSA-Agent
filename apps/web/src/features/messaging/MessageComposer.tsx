// apps/web/src/features/messaging/MessageComposer.tsx — CMP-MSG.02.1
import React, { useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import {
  MESSAGE_CHANNELS,
  type MessageChannel,
  type MessageRecord,
  type MessageTemplate,
} from '@dsa/contracts';

export interface MessageComposerProps {
  templates: MessageTemplate[];
  onMessageSent?: (msg: MessageRecord) => void;
  apiBaseUrl?: string;
}

export function MessageComposer({
  templates,
  onMessageSent,
  apiBaseUrl = '/v1',
}: MessageComposerProps) {
  const [subjectType, setSubjectType] = useState<'LEAD' | 'CUSTOMER' | 'LOAN_APPLICATION'>('LEAD');
  const [subjectId, setSubjectId] = useState('');
  const [channel, setChannel] = useState<MessageChannel>('EMAIL');
  const [selectedTemplateCode, setSelectedTemplateCode] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientMobile, setRecipientMobile] = useState('');
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [sendResult, setSendResult] = useState<{
    success: boolean;
    data?: MessageRecord;
    error?: { code: string; message: string; issue?: string; details?: unknown };
  } | null>(null);

  const activeTemplate = templates.find(
    (t) => t.code === selectedTemplateCode && t.channel === channel,
  );

  const handleTemplateChange = (code: string) => {
    setSelectedTemplateCode(code);
    const tmpl = templates.find((t) => t.code === code && t.channel === channel);
    if (tmpl) {
      const initialVars: Record<string, string> = {};
      for (const v of tmpl.variables) {
        initialVars[v.name] = '';
      }
      setVariables(initialVars);
    }
  };

  const handleVariableChange = (name: string, value: string) => {
    setVariables((prev) => ({ ...prev, [name]: value }));
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSendResult(null);

    try {
      const token = sessionStorage.getItem('dsa_auth_token') || localStorage.getItem('dsa_auth_token');
      const idemKey = `idem_send_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      const res = await fetch(`${apiBaseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idemKey,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          subjectType,
          subjectId: subjectId.trim(),
          channel,
          templateCode: selectedTemplateCode,
          recipient: {
            ...(channel === 'EMAIL' ? { email: recipientEmail.trim() } : {}),
            ...(channel === 'SMS' || channel === 'WHATSAPP' ? { mobile: recipientMobile.trim() } : {}),
          },
          variables,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        const issue = data.error?.details?.[0]?.issue;
        setSendResult({
          success: false,
          error: {
            code: data.error?.code || 'ERROR',
            message: data.error?.message || 'Failed to dispatch message',
            issue,
            details: data.error?.details,
          },
        });
      } else {
        setSendResult({ success: true, data });
        if (onMessageSent) onMessageSent(data);
      }
    } catch (err: unknown) {
      setSendResult({
        success: false,
        error: {
          code: 'CLIENT_ERROR',
          message: err instanceof Error ? err.message : 'Network request failed',
        },
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
      <CardContent sx={{ p: 3 }}>
        <Typography variant="h6" fontWeight={700} gutterBottom>
          Message Dispatch & Send-Eligibility Guard
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Every outbound send is guarded against consent revocation, quiet hours (21:00-09:00),
          suppression preferences, and tenant isolation policies.
        </Typography>

        <form onSubmit={handleSend}>
          <Grid container spacing={2.5}>
            <Grid item xs={12} sm={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Subject Type</InputLabel>
                <Select
                  value={subjectType}
                  label="Subject Type"
                  onChange={(e) => setSubjectType(e.target.value as 'LEAD' | 'CUSTOMER' | 'LOAN_APPLICATION')}
                >
                  <MenuItem value="LEAD">LEAD</MenuItem>
                  <MenuItem value="CUSTOMER">CUSTOMER</MenuItem>
                  <MenuItem value="LOAN_APPLICATION">LOAN APPLICATION</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={8}>
              <TextField
                size="small"
                fullWidth
                required
                label="Subject ID"
                placeholder="e.g. lead_01J00000000000000000000001"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
              />
            </Grid>

            <Grid item xs={12} sm={4}>
              <FormControl fullWidth size="small">
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

            <Grid item xs={12} sm={8}>
              <FormControl fullWidth size="small">
                <InputLabel>Approved Template</InputLabel>
                <Select
                  value={selectedTemplateCode}
                  label="Approved Template"
                  onChange={(e) => handleTemplateChange(e.target.value)}
                >
                  {templates
                    .filter((t) => t.channel === channel && t.status === 'APPROVED')
                    .map((t) => (
                      <MenuItem key={t.id} value={t.code}>
                        {t.code} (v{t.version} &bull; {t.category})
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
            </Grid>

            {channel === 'EMAIL' ? (
              <Grid item xs={12}>
                <TextField
                  size="small"
                  fullWidth
                  required
                  type="email"
                  label="Recipient Email"
                  placeholder="borrower@example.com"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  helperText="Masked on storage (e.g. b******r@example.com)"
                />
              </Grid>
            ) : (
              <Grid item xs={12}>
                <TextField
                  size="small"
                  fullWidth
                  required
                  label="Recipient Mobile Number (E.164)"
                  placeholder="+919876543210"
                  value={recipientMobile}
                  onChange={(e) => setRecipientMobile(e.target.value)}
                  helperText="Masked on storage (e.g. +91 98****3210)"
                />
              </Grid>
            )}

            {/* Template Variables Inputs */}
            {activeTemplate && activeTemplate.variables.length > 0 && (
              <Grid item xs={12}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  Template Variables:
                </Typography>
                <Grid container spacing={1.5}>
                  {activeTemplate.variables.map((v) => (
                    <Grid item xs={12} sm={6} key={v.name}>
                      <TextField
                        size="small"
                        fullWidth
                        required={v.required}
                        label={v.name}
                        placeholder={v.description || `Value for {{${v.name}}}`}
                        value={variables[v.name] || ''}
                        onChange={(e) => handleVariableChange(v.name, e.target.value)}
                      />
                    </Grid>
                  ))}
                </Grid>
              </Grid>
            )}

            <Grid item xs={12}>
              <Button
                type="submit"
                variant="contained"
                disabled={loading || !selectedTemplateCode || !subjectId}
                sx={{ px: 4, py: 1 }}
              >
                {loading ? 'Evaluating Eligibility & Sending...' : 'Dispatch Message'}
              </Button>
            </Grid>
          </Grid>
        </form>

        {/* Send Eligibility Result Feedback */}
        {sendResult && (
          <Box sx={{ mt: 3 }}>
            <Divider sx={{ mb: 2 }} />
            {sendResult.success && sendResult.data ? (
              <Alert severity="success">
                <AlertTitle sx={{ fontWeight: 700 }}>Message Successfully Sent!</AlertTitle>
                <Typography variant="body2">
                  ID: <strong>{sendResult.data.id}</strong> &bull; Status:{' '}
                  <Chip size="small" label={sendResult.data.status} color="success" />
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  Recipient Masked: <code>{sendResult.data.recipientMasked}</code> &bull; Provider:{' '}
                  <code>{sendResult.data.provider}</code>
                </Typography>
              </Alert>
            ) : (
              <Alert severity="error">
                <AlertTitle sx={{ fontWeight: 700 }}>
                  {sendResult.error?.code === 'SEND_BLOCKED'
                    ? '422 SEND_BLOCKED: Send-Eligibility Guard Blocked This Dispatch'
                    : `Dispatch Failed: ${sendResult.error?.code}`}
                </AlertTitle>
                <Typography variant="body2">{sendResult.error?.message}</Typography>
                {sendResult.error?.issue && (
                  <Box sx={{ mt: 1 }}>
                    <Chip
                      label={`Reason Code: ${sendResult.error.issue}`}
                      color="error"
                      variant="outlined"
                      size="small"
                    />
                  </Box>
                )}
              </Alert>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
