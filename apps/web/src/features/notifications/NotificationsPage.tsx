// apps/web/src/features/notifications/NotificationsPage.tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import type { NotificationCategory, NotificationRecord } from '@dsa/contracts';
import { apiFetch, errorText } from '../../api/client';
import { PageHeader, StatCard, StatCardGrid, AppButton, PageContainer } from '../../ui';
import { NotificationPreferencesDialog } from './NotificationPreferencesDialog';

const CATEGORY_COLORS: Record<
  NotificationCategory,
  'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'
> = {
  TASK: 'info',
  LEAD: 'primary',
  APPLICATION: 'secondary',
  SYSTEM: 'default',
  ALERT: 'error',
};

export function NotificationsPage() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [filterTab, setFilterTab] = useState<'ALL' | 'UNREAD'>('ALL');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [preferencesOpen, setPreferencesOpen] = useState<boolean>(false);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body = await apiFetch<{ data: NotificationRecord[]; meta?: { unreadCount?: number } }>(
        '/v1/notifications',
        { query: { limit: 50, status: filterTab === 'UNREAD' ? 'UNREAD' : undefined } },
      );
      setNotifications(body.data ?? []);
      setUnreadCount(body.meta?.unreadCount ?? 0);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [filterTab]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);


  /** Marks every unread notification of the user as read on the server, not only the ones loaded here. */
  const handleMarkAllAsRead = async () => {
    try {
      await apiFetch('/v1/notifications/read-all', { method: 'POST' });
      const nowIso = new Date().toISOString();
      setNotifications((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: nowIso })));
      setUnreadCount(0);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const handleMarkAsRead = async (ids: string[]) => {
    const validIds = (ids || [])
      .map((id) => (typeof id === 'string' ? id.trim() : ''))
      .filter((id) => id.length > 0);
    if (validIds.length === 0) return;
    try {
      const normalizedIds = validIds.map((id) =>
        !id.startsWith('ntf_') && /^[0-9A-Za-z]{26}$/.test(id) ? `ntf_${id}` : id,
      );
      await apiFetch('/v1/notifications/read', { method: 'POST', body: { notificationIds: normalizedIds } });
      const nowIso = new Date().toISOString();
      setNotifications((prev) =>
        prev.map((n) =>
          validIds.includes(n.id) || normalizedIds.includes(n.id) ? { ...n, readAt: nowIso } : n,
        ),
      );
      setUnreadCount((c) => Math.max(0, c - validIds.length));
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Notification Inbox"
        subtitle="Manage your personal alerts, assignments, and updates"
        actions={
          <Stack direction="row" spacing={1}>
            <AppButton variant="outlined" size="small" onClick={() => setPreferencesOpen(true)}>
              Preferences
            </AppButton>
            {unreadCount > 0 && (
              <AppButton
                variant="primary"
                size="small"
                onClick={handleMarkAllAsRead}
              >
                Mark all read ({unreadCount})
              </AppButton>
            )}
          </Stack>
        }
      />

      <StatCardGrid columns={{ xs: 12, sm: 4 }}>
        <StatCard title="Total" value={notifications.length} format="number" status="default" />
        <StatCard title="Unread" value={unreadCount} format="number" status="primary" />
        <StatCard title="Read" value={notifications.length - unreadCount} format="number" status="success" />
      </StatCardGrid>

      <Paper sx={{ mb: 3 }}>
        <Tabs value={filterTab} onChange={(_, val) => setFilterTab(val)}>
          <Tab label="All Notifications" value="ALL" />
          <Tab label={`Unread (${unreadCount})`} value="UNREAD" />
        </Tabs>
      </Paper>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
          <CircularProgress />
        </Box>
      ) : error ? (
        <Alert severity="error">{error}</Alert>
      ) : notifications.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: 'center' }}>
          <Typography color="text.secondary">No notifications found.</Typography>
        </Paper>
      ) : (
        <Stack spacing={1.5}>
          {notifications.map((notif) => (
            <Card
              key={notif.id}
              variant="outlined"
              sx={{
                bgcolor: notif.readAt ? 'background.paper' : 'action.hover',
                borderLeft: notif.readAt ? undefined : '4px solid #1976d2',
              }}
            >
              <CardContent sx={{ pb: '16px !important' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Chip
                    label={notif.category.replace(/_/g, ' ')}
                    size="small"
                    color={CATEGORY_COLORS[notif.category] || 'default'}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {new Date(notif.createdAt).toLocaleString()}
                  </Typography>
                </Box>
                <Typography variant="subtitle1" sx={{ fontWeight: notif.readAt ? 500 : 700 }}>
                  {notif.title}
                </Typography>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1.5 }}>
                  {notif.deepLink ? (
                    <Button
                      size="small"
                      onClick={() => {
                        if (!notif.readAt) handleMarkAsRead([notif.id]);
                        navigate(notif.deepLink);
                      }}
                    >
                      Open Link
                    </Button>
                  ) : (
                    <span />
                  )}
                  {!notif.readAt && (
                    <Button size="small" color="inherit" onClick={() => handleMarkAsRead([notif.id])}>
                      Mark Read
                    </Button>
                  )}
                </Box>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <NotificationPreferencesDialog open={preferencesOpen} onClose={() => setPreferencesOpen(false)} />
    </PageContainer>
  );
}
