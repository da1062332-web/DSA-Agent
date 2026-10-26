import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, Container, Tab, Tabs, Typography } from '@mui/material';
import type { MessageRecord, MessageTemplate } from '@dsa/contracts';
import { ApiError, apiFetch, errorText } from '../../api/client';
import { hasPermission, useMe } from '../../api/useMe';
import { isSimulatedProvider } from './simulated';
import { TemplateEditor } from './TemplateEditor';
import { MessageComposer } from './MessageComposer';
import { Can } from '../../shell/Can';
import { ApplicationName, CustomerName, LeadName } from '../../shell/display';
import { DataTable, DetailCard, PageHeader } from '../../ui';
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
  const [actionError, setActionError] = useState<string | null>(null);
  const me = useMe();
  const canApprove = hasPermission(me.data, 'config.manage');
  const canSend = hasPermission(me.data, 'message.send');

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

  // Approval is a separate step by a different person from the author (the server refuses the author).
  const approveTemplate = async (t: MessageTemplate) => {
    setActionError(null);
    try {
      await apiFetch(`/v1/message-templates/${t.id}/approval`, { method: 'POST' });
      await fetchTemplates();
    } catch (err) {
      setActionError(errorText(err));
    }
  };

  // Test only: gives a SIMULATED message a delivery result. The server refuses this for real providers.
  const setSimulatedDelivery = async (m: MessageRecord, outcome: 'DELIVERED' | 'UNDELIVERED') => {
    setActionError(null);
    try {
      await apiFetch(`/v1/messages/${m.id}/simulate-delivery`, { method: 'POST', body: { outcome } });
      await fetchMessages();
    } catch (err) {
      setActionError(errorText(err));
    }
  };

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
      render: (t) => (
        <Chip size="small" label={t.status} color={t.status === 'APPROVED' ? 'success' : t.status === 'DRAFT' ? 'warning' : 'default'} />
      ),
    },
    {
      id: 'approve',
      header: 'Approval',
      render: (t) => {
        if (t.status !== 'DRAFT') return null;
        if (canApprove && me.data?.id !== t.createdBy) {
          return (
            <Button size="small" variant="outlined" color="success" onClick={() => approveTemplate(t)}>
              Approve
            </Button>
          );
        }
        return (
          <Box sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>
            {me.data?.id === t.createdBy ? 'Waiting for another approver' : 'Needs an approver'}
          </Box>
        );
      },
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
    {
      id: 'subject',
      header: 'Subject',
      render: (m) => {
        let subjectNode = null;
        if (m.subjectType === 'LEAD') {
          subjectNode = <LeadName id={m.subjectId} linkToLead />;
        } else if (m.subjectType === 'CUSTOMER') {
          subjectNode = <CustomerName id={m.subjectId} linkToProfile />;
        } else if (m.subjectType === 'APPLICATION' || m.subjectType === 'LOAN_APPLICATION') {
          subjectNode = <ApplicationName id={m.subjectId} linkToApp />;
        }

        return (
          <Box>
            {subjectNode && (
              <Box sx={{ fontWeight: 600, color: 'text.primary', mb: 0.25 }}>
                {subjectNode}
              </Box>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
              {m.subjectType} • {m.subjectId}
            </Typography>
          </Box>
        );
      },
    },
    { id: 'recipient', header: 'Recipient (Masked)', render: (m) => <Box sx={{ fontFamily: 'monospace' }}>{m.recipientMasked}</Box> },
    {
      id: 'status',
      header: 'Status',
      render: (m) => (
        <Chip
          size="small"
          label={m.status}
          color={isSimulatedProvider(m.provider) ? 'warning' : m.status === 'SENT' || m.status === 'DELIVERED' ? 'success' : m.status === 'BLOCKED' ? 'error' : 'warning'}
        />
      ),
    },
    {
      id: 'provider',
      header: 'Provider',
      render: (m) =>
        isSimulatedProvider(m.provider) ? (
          <Box>
            <Chip size="small" color="warning" label="SIMULATED — NOT SENT" sx={{ mb: 0.5 }} />
            <Typography variant="caption" display="block" color="text.secondary">
              {m.provider}
            </Typography>
          </Box>
        ) : (
          m.provider
        ),
    },
    {
      id: 'simulate',
      header: 'Test result',
      render: (m) =>
        isSimulatedProvider(m.provider) && m.status === 'SENT' && canSend ? (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Button size="small" variant="outlined" onClick={() => setSimulatedDelivery(m, 'DELIVERED')}>
              Mark delivered
            </Button>
            <Button size="small" variant="outlined" color="error" onClick={() => setSimulatedDelivery(m, 'UNDELIVERED')}>
              Mark undelivered
            </Button>
          </Box>
        ) : null,
    },
    {
      id: 'dispatched',
      header: 'Dispatched At',
      render: (m) => <Box sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>{new Date(m.createdAt).toLocaleTimeString()}</Box>,
    },
  ];

  return (
    <Container maxWidth={false} disableGutters>
      {denied && (
        <Alert severity="warning" sx={{ mb: 2 }} data-testid="messaging.noAccess">
          You don't have access to messaging. Ask your administrator to grant you the message.send permission.
        </Alert>
      )}
      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}
      <PageHeader
        title="Messaging"
        subtitle="Templates • Dispatch • Delivery Tracking • Consent & Quiet Hours Guard"
        actions={
          <Can action="config.manage">
            <Button variant="contained" onClick={() => setEditorOpen(true)}>
              New Template
            </Button>
          </Can>
        }
      />

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={tabIndex} onChange={(_, val) => setTabIndex(val)}>
          <Tab label="Message Templates" />
          <Tab label="Dispatch & Send Guard" />
          <Tab label="Delivery History" />
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
