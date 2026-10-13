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
  Container,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import type { NotificationCategory, NotificationRecord } from '@dsa/contracts';
import { getStoredAuthToken } from '../../auth/token';
import { NotificationPreferencesDialog } from './NotificationPreferencesDialog';

const CATEGORY_COLORS: Record<NotificationCategory, 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'> = {
  TASK: 'info',
  LEAD: 'primary',
  APPLICATION: 'secondary',
  SYSTEM: 'default',
  ALERT: 'error',
};

export function NotificationsPage({ apiBaseUrl = '/v1' }: { apiBaseUrl?: string }) {
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
      const token = getStoredAuthToken();
      const statusQuery = filterTab === 'UNREAD' ? '&status=UNREAD' : '';
      const res = await fetch(`${apiBaseUrl}/notifications?limit=50${statusQuery}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        throw new Error(`Failed to load notifications: HTTP ${res.status}`);
      }

      const body = await res.json().catch(() => null);
      setNotifications(body?.data || []);
      setUnreadCount(body?.meta?.unreadCount ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error fetching inbox');
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, filterTab]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkAsRead = async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      const token = getStoredAuthToken();
      const res = await fetch(`${apiBaseUrl}/notifications/read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ notificationIds: ids }),
      });

      if (res.ok) {
        const nowIso = new Date().toISOString();
        setNotifications((prev) =>
          prev.map((n) => (ids.includes(n.id) ? { ...n, readAt: nowIso } : n)),
        );
        setUnreadCount((c) => Math.max(0, c - ids.length));
      }
    } catch {
      // Ignore
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <div>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Notification Inbox
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage your personal alerts, assignments, and updates
          </Typography>
        </div>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={() => setPreferencesOpen(true)}>
            Preferences
          </Button>
          {unreadCount > 0 && (
            <Button
              variant="contained"
              onClick={() => handleMarkAsRead(notifications.filter((n) => !n.readAt).map((n) => n.id))}
            >
              Mark all read ({unreadCount})
            </Button>
          )}
        </Stack>
      </Box>

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
                  ) : <span />}
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

      <NotificationPreferencesDialog
        open={preferencesOpen}
        onClose={() => setPreferencesOpen(false)}
        apiBaseUrl={apiBaseUrl}
      />
    </Container>
  );
}
