import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, Container, Tab, Tabs, Typography } from '@mui/material';
import type { MessageRecord, MessageTemplate } from '@dsa/contracts';
import { ApiError, apiFetch } from '../../api/client';
import { TemplateEditor } from './TemplateEditor';
import { MessageComposer } from './MessageComposer';
import { Can } from '../../shell/Can';
import { DataTable, DetailCard } from '../../ui';
import type { ColumnDef } from '../../ui';

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

  const templateColumns: ColumnDef<MessageTemplate>[] = [
    { id: 'code', header: 'Code', render: (t) => <Box sx={{ fontWeight: 600 }}>{t.code}</Box> },
    {
      id: 'channel',
      header: 'Channel',
      render: (t) => <Chip size="small" label={t.channel} color="primary" variant="outlined" />,
    },
    { id: 'category', header: 'Category', render: (t) => t.category },
    { id: 'version', header: 'Version', render: (t) => `v${t.version}` },
    {
      id: 'status',
      header: 'Status',
      render: (t) => <Chip size="small" label={t.status} color={t.status === 'APPROVED' ? 'success' : 'default'} />,
    },
    {
      id: 'variables',
      header: 'Variables',
      render: (t) => t.variables.map((v) => <Chip key={v.name} size="small" label={v.name} sx={{ mr: 0.5, mb: 0.5 }} />),
    },
    {
      id: 'created',
      header: 'Created',
      render: (t) => <Box sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>{new Date(t.createdAt).toLocaleDateString()}</Box>,
    },
  ];

  const messageColumns: ColumnDef<MessageRecord>[] = [
    { id: 'id', header: 'ID', render: (m) => <Box sx={{ fontFamily: 'monospace' }}>{m.id}</Box> },
    {
      id: 'channel',
      header: 'Channel',
      render: (m) => <Chip size="small" label={m.channel} color="primary" variant="outlined" />,
    },
    { id: 'subject', header: 'Subject', render: (m) => `${m.subjectType}: ${m.subjectId.slice(0, 12)}...` },
    { id: 'recipient', header: 'Recipient (Masked)', render: (m) => <Box sx={{ fontFamily: 'monospace' }}>{m.recipientMasked}</Box> },
    {
      id: 'status',
      header: 'Status',
      render: (m) => (
        <Chip
          size="small"
          label={m.status}
          color={m.status === 'SENT' || m.status === 'DELIVERED' ? 'success' : m.status === 'BLOCKED' ? 'error' : 'warning'}
        />
      ),
    },
    { id: 'provider', header: 'Provider', render: (m) => m.provider },
    {
      id: 'dispatched',
      header: 'Dispatched At',
      render: (m) => <Box sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>{new Date(m.createdAt).toLocaleTimeString()}</Box>,
    },
  ];

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
        <DetailCard title="Message Templates" subtitle="Approved templates drive every outbound message.">
          <DataTable<MessageTemplate>
            dataTestId="msg.table.templates"
            data={templates}
            columns={templateColumns}
            keyExtractor={(t) => t.id}
            emptyMessage='No templates found. Click "New Template" above to create one.'
          />
        </DetailCard>
      )}

      {/* Tab 1: Dispatch */}
      {tabIndex === 1 && <MessageComposer templates={templates} onMessageSent={handleMessageSent} />}

      {/* Tab 2: History */}
      {tabIndex === 2 && (
        <DetailCard title="Delivery History" subtitle="Messages dispatched during this session.">
          <DataTable<MessageRecord>
            dataTestId="msg.table.history"
            data={messages}
            columns={messageColumns}
            keyExtractor={(m) => m.id}
            emptyMessage='No dispatched messages in session. Use Tab "Dispatch & Send Guard" to test.'
          />
        </DetailCard>
      )}

      <TemplateEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSuccess={handleTemplateCreated}
      />
    </Container>
  );
}
