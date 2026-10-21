import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Paper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material';
import type { MessageRecord, MessageTemplate } from '@dsa/contracts';
import { ApiError, apiFetch } from '../../api/client';
import { TemplateEditor } from './TemplateEditor';
import { MessageComposer } from './MessageComposer';
import { Can } from '../../shell/Can';

export interface MessagingPageProps {
  defaultTab?: number;
}

export function MessagingPage({ defaultTab = 0 }: MessagingPageProps) {
  const [tabIndex, setTabIndex] = useState(defaultTab);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [denied, setDenied] = useState(false);

  const fetchTemplates = useCallback(async () => {
    try {
      setTemplates((await apiFetch<{ data: MessageTemplate[] }>('/v1/message-templates')).data ?? []);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'FORBIDDEN') setDenied(true);
    }
  }, []);

  const fetchMessages = useCallback(async () => {
    try {
      setMessages((await apiFetch<{ data: MessageRecord[] }>('/v1/messages')).data ?? []);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'FORBIDDEN') setDenied(true);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
    fetchMessages();
  }, [fetchTemplates, fetchMessages]);

  useEffect(() => {
    if (tabIndex === 2) {
      fetchMessages();
    }
  }, [tabIndex, fetchMessages]);

  const handleTemplateCreated = (tmpl: MessageTemplate) => {
    setTemplates((prev) => [tmpl, ...prev]);
  };

  const handleMessageSent = (msg: MessageRecord) => {
    setMessages((prev) => [msg, ...prev]);
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {denied && (
        <Alert severity="warning" sx={{ mb: 2 }} data-testid="messaging.noAccess">
          You don't have access to messaging. Ask your administrator to grant you the message.send permission.
        </Alert>
      )}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Omnichannel Messaging (MOD-MSG)
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Templates &bull; Dispatch &bull; Delivery Tracking &bull; Consent & Quiet Hours Guard
          </Typography>
        </Box>
        <Can action="config.manage">
          <Button variant="contained" onClick={() => setEditorOpen(true)}>
            New Template
          </Button>
        </Can>
      </Box>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={tabIndex} onChange={(_, val) => setTabIndex(val)}>
          <Tab label="Message Templates (SUB-MSG.01)" />
          <Tab label="Dispatch & Send Guard (SUB-MSG.02/04)" />
          <Tab label="Delivery History (SUB-MSG.03)" />
        </Tabs>
      </Box>

      {/* Tab 0: Templates */}
      {tabIndex === 0 && (
        <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
          <CardContent sx={{ p: 0 }}>
            <TableContainer component={Paper} elevation={0}>
              <Table>
                <TableHead sx={{ bgcolor: '#f8fafc' }}>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Code</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Channel</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Category</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Version</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Variables</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {templates.map((t) => (
                    <TableRow key={t.id} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{t.code}</TableCell>
                      <TableCell>
                        <Chip size="small" label={t.channel} color="primary" variant="outlined" />
                      </TableCell>
                      <TableCell>{t.category}</TableCell>
                      <TableCell>v{t.version}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={t.status}
                          color={t.status === 'APPROVED' ? 'success' : 'default'}
                        />
                      </TableCell>
                      <TableCell>
                        {t.variables.map((v) => (
                          <Chip key={v.name} size="small" label={v.name} sx={{ mr: 0.5, mb: 0.5 }} />
                        ))}
                      </TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>
                        {new Date(t.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                  {templates.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                        No templates found. Click &quot;New Template&quot; above to create one.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {/* Tab 1: Dispatch */}
      {tabIndex === 1 && <MessageComposer templates={templates} onMessageSent={handleMessageSent} />}

      {/* Tab 2: History */}
      {tabIndex === 2 && (
        <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
          <CardContent sx={{ p: 0 }}>
            <TableContainer component={Paper} elevation={0}>
              <Table>
                <TableHead sx={{ bgcolor: '#f8fafc' }}>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>ID</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Channel</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Subject</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Recipient (Masked)</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Provider</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Dispatched At</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {messages.map((m) => (
                    <TableRow key={m.id} hover>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{m.id}</TableCell>
                      <TableCell>
                        <Chip size="small" label={m.channel} color="primary" variant="outlined" />
                      </TableCell>
                      <TableCell>
                        {m.subjectType}: {m.subjectId.slice(0, 12)}...
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{m.recipientMasked}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={m.status}
                          color={
                            m.status === 'SENT' || m.status === 'DELIVERED'
                              ? 'success'
                              : m.status === 'BLOCKED'
                                ? 'error'
                                : 'warning'
                          }
                        />
                      </TableCell>
                      <TableCell>{m.provider}</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>
                        {new Date(m.createdAt).toLocaleTimeString()}
                      </TableCell>
                    </TableRow>
                  ))}
                  {messages.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                        No dispatched messages in session. Use Tab &quot;Dispatch & Send Guard&quot; to test.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      <TemplateEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSuccess={handleTemplateCreated}
      />
    </Container>
  );
}
