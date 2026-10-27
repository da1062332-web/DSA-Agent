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
import { ApiError, apiFetch } from '../../api/client';
import { Can } from '../../shell/Can';
import { isSimulatedProvider } from './simulated';
import { ApplicationSelect, CustomerSelect, LeadSelect } from '../../shell/selectors';
import {
  MESSAGE_CHANNELS,
  type MessageChannel,
  type MessageRecord,
  type MessageTemplate,
} from '@dsa/contracts';

export interface MessageComposerProps {
  templates: MessageTemplate[];
  onMessageSent?: (msg: MessageRecord) => void;
}

export function MessageComposer({ templates, onMessageSent }: MessageComposerProps) {
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

  const activeTemplate = templates.find((t) => t.code === selectedTemplateCode && t.channel === channel);

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
      const data = await apiFetch<MessageRecord>('/v1/messages', {
        method: 'POST',
        body: {
          subjectType,
          subjectId: subjectId.trim(),
          channel,
          templateCode: selectedTemplateCode,
          recipient: {
            ...(channel === 'EMAIL' ? { email: recipientEmail.trim() } : {}),
            ...(channel === 'SMS' || channel === 'WHATSAPP' ? { mobile: recipientMobile.trim() } : {}),
          },
          variables,
        },
      });
      setSendResult({ success: true, data });
      if (onMessageSent) onMessageSent(data);
    } catch (err: unknown) {
      // SEND_BLOCKED carries the guard's reason (consent, quiet hours, suppression) in its first detail.
      setSendResult({
        success: false,
        error:
          err instanceof ApiError
            ? { code: err.code, message: err.message, issue: err.details[0]?.issue, details: err.details }
            : {
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
          Every outbound send is guarded against consent revocation, quiet hours (21:00-09:00), suppression
          preferences, and tenant isolation policies.
        </Typography>

        <form onSubmit={handleSend}>
          <Grid container spacing={2.5}>
            <Grid item xs={12} sm={4}>
              <FormControl fullWidth size="small">
                <InputLabel id="composer-subject-label">Subject Type</InputLabel>
                <Select
                  labelId="composer-subject-label"
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
              {subjectType === 'LEAD' && (
                <LeadSelect
                  size="small"
                  fullWidth
                  required
                  label="Select Lead"
                  value={subjectId || null}
                  onChange={(id) => setSubjectId(id ?? '')}
                />
              )}
              {subjectType === 'CUSTOMER' && (
                <CustomerSelect
                  size="small"
                  fullWidth
                  required
                  label="Select Customer"
                  value={subjectId || null}
                  onChange={(id) => setSubjectId(id ?? '')}
                />
              )}
              {subjectType === 'LOAN_APPLICATION' && (
                <ApplicationSelect
                  size="small"
                  fullWidth
                  required
                  label="Select Loan Application"
                  value={subjectId || null}
                  onChange={(id) => setSubjectId(id ?? '')}
                />
              )}
            </Grid>

            <Grid item xs={12} sm={4}>
              <FormControl fullWidth size="small">
                <InputLabel id="composer-channel-label">Channel</InputLabel>
                <Select
                  labelId="composer-channel-label"
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
                <InputLabel id="composer-template-label">Approved Template</InputLabel>
                <Select
                  labelId="composer-template-label"
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

            <Grid item xs={12} display="flex" justifyContent="flex-end">
              <Can action="message.send">
                <Button
                  type="submit"
                  variant="contained"
                  disabled={loading || !selectedTemplateCode || !subjectId}
                  sx={{ px: 4, py: 1 }}
                >
                  {loading ? 'Evaluating Eligibility & Sending...' : 'Dispatch Message'}
                </Button>
              </Can>
            </Grid>
          </Grid>
        </form>

        {/* Send Eligibility Result Feedback */}
        {sendResult && (
          <Box sx={{ mt: 3 }}>
            <Divider sx={{ mb: 2 }} />
            {sendResult.success && sendResult.data && sendResult.data.status !== 'BLOCKED' && sendResult.data.status !== 'FAILED' ? (
              <Alert severity={isSimulatedProvider(sendResult.data.provider) ? 'info' : 'success'}>
                <AlertTitle sx={{ fontWeight: 700 }}>
                  {isSimulatedProvider(sendResult.data.provider)
                    ? 'SIMULATED — NOT SENT'
                    : 'Message Successfully Sent!'}
                </AlertTitle>
                <Typography variant="body2">
                  Status:{' '}
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
                  {(sendResult.data?.status === 'BLOCKED' || sendResult.error?.code === 'SEND_BLOCKED')
                    ? '422 SEND_BLOCKED: Send-Eligibility Guard Blocked This Dispatch'
                    : `Dispatch Failed: ${sendResult.error?.code || 'ERROR'}`}
                </AlertTitle>
                <Typography variant="body2">
                  {sendResult.data?.statusHistory?.[0]?.reason || sendResult.error?.message}
                </Typography>
                {(sendResult.data?.statusHistory?.[0]?.reason || sendResult.error?.issue) && (
                  <Box sx={{ mt: 1 }}>
                    <Chip
                      label={`Reason Code: ${sendResult.data?.statusHistory?.[0]?.reason || sendResult.error?.issue}`}
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
