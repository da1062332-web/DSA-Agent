// apps/web/src/features/notifications/NotificationCenter.tsx — CMP-NTF.01.1
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  Popover,
  SvgIcon,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import type { NotificationCategory, NotificationRecord } from '@dsa/contracts';
import { ApiError, apiFetch, apiStream, errorText } from '../../api/client';
import { NotificationPreferencesDialog } from './NotificationPreferencesDialog';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface NotificationCenterProps {}

function BellIcon(props: React.ComponentProps<typeof SvgIcon>) {
  return (
    <SvgIcon {...props}>
      <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z" />
    </SvgIcon>
  );
}

function SettingsIcon(props: React.ComponentProps<typeof SvgIcon>) {
  return (
    <SvgIcon {...props}>
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </SvgIcon>
  );
}

function CheckIcon(props: React.ComponentProps<typeof SvgIcon>) {
  return (
    <SvgIcon {...props}>
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
    </SvgIcon>
  );
}

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

export function NotificationCenter(_props: NotificationCenterProps) {
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [filterTab, setFilterTab] = useState<'ALL' | 'UNREAD'>('ALL');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [preferencesOpen, setPreferencesOpen] = useState<boolean>(false);
  const [streamStatus, setStreamStatus] = useState<'connected' | 'reconnecting' | 'disconnected'>(
    'disconnected',
  );

  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const open = Boolean(anchorEl);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body = await apiFetch<{ data: NotificationRecord[]; meta?: { unreadCount?: number } }>(
        '/v1/notifications',
        { query: { limit: 25, status: filterTab === 'UNREAD' ? 'UNREAD' : undefined } },
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

  // SSE Live Stream Connection
  useEffect(() => {
    let isSubscribed = true;
    let failures = 0;

    const connectSse = async () => {
      try {
        setStreamStatus('reconnecting');
        const controller = new AbortController();
        abortControllerRef.current = controller;

        const res = await apiStream('/v1/notifications/stream', controller.signal);

        failures = 0;
        setStreamStatus('connected');

        if (!res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (isSubscribed) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() ?? '';

          for (const block of lines) {
            if (!block.trim()) continue;

            let eventType = 'message';
            let dataStr = '';

            for (const line of block.split('\n')) {
              if (line.startsWith('event: ')) {
                eventType = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                dataStr = line.slice(6).trim();
              }
            }

            if (eventType === 'notification.created' && dataStr) {
              try {
                const newRecord: NotificationRecord = JSON.parse(dataStr);
                setNotifications((prev) => [newRecord, ...prev.filter((n) => n.id !== newRecord.id)]);
                setUnreadCount((c) => c + 1);
              } catch {
                // Ignore malformed event data
              }
            }
          }
        }
      } catch (err: unknown) {
        if (!isSubscribed) return;
        if (err instanceof Error && err.name === 'AbortError') return;

        // A refusal (401 sign-in or step-up needed, 403 no access, 404) will not clear by retrying every few seconds, and each
        // retry is another failed request in the console. Stop; the bell still loads its list through the normal requests.
        if (
          err instanceof ApiError &&
          err.httpStatus >= 400 &&
          err.httpStatus < 500 &&
          err.httpStatus !== 408 &&
          err.httpStatus !== 429
        ) {
          setStreamStatus('disconnected');
          return;
        }

        setStreamStatus('reconnecting');
        // Back off 5 s, 10 s, 20 s ... up to 60 s while the API or network is down.
        failures += 1;
        const delay = Math.min(60_000, 5_000 * 2 ** (failures - 1));
        reconnectTimeoutRef.current = setTimeout(() => {
          if (isSubscribed) {
            connectSse();
          }
        }, delay);
      }
    };

    connectSse();

    return () => {
      isSubscribed = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  const handleMarkAsRead = async (notificationIds: string[]) => {
    const validIds = (notificationIds || [])
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

  const handleNotificationClick = async (notif: NotificationRecord) => {
    if (!notif.readAt) {
      await handleMarkAsRead([notif.id]);
    }
    setAnchorEl(null);
    if (notif.deepLink && notif.deepLink.startsWith('/')) {
      navigate(notif.deepLink);
    }
  };


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

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton
          color="inherit"
          onClick={(e) => setAnchorEl(e.currentTarget)}
          aria-label="Open notifications center"
          aria-controls={open ? 'notification-popover' : undefined}
          aria-haspopup="true"
          aria-expanded={open ? 'true' : undefined}
          data-testid="notifications.bell-button"
        >
          <Badge badgeContent={unreadCount} color="error" max={99}>
            <BellIcon />
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        id="notification-popover"
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: { width: 380, maxHeight: 520, display: 'flex', flexDirection: 'column' },
        }}
      >
        {/* Header */}
        <Box
          sx={{
            p: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            bgcolor: 'background.paper',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Notifications
            </Typography>
            <Tooltip title={`Live stream: ${streamStatus}`}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor:
                    streamStatus === 'connected'
                      ? 'success.main'
                      : streamStatus === 'reconnecting'
                        ? 'warning.main'
                        : 'text.disabled',
                }}
              />
            </Tooltip>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title="Preferences">
              <IconButton
                size="small"
                onClick={() => {
                  setAnchorEl(null);
                  setPreferencesOpen(true);
                }}
                aria-label="Notification Preferences"
                data-testid="notifications.preferences-button"
              >
                <SettingsIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {unreadCount > 0 && (
              <Button
                size="small"
                onClick={handleMarkAllAsRead}
                startIcon={<CheckIcon fontSize="small" />}
                sx={{ fontSize: '0.75rem' }}
                data-testid="notifications.mark-all-read"
              >
                Mark all read
              </Button>
            )}
          </Box>
        </Box>

        {/* Filter Tabs */}
        <Tabs
          value={filterTab}
          onChange={(_, val) => setFilterTab(val)}
          variant="fullWidth"
          sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 36 }}
        >
          <Tab label="All" value="ALL" sx={{ minHeight: 36, py: 0.5, fontSize: '0.8rem' }} />
          <Tab
            label={`Unread (${unreadCount})`}
            value="UNREAD"
            sx={{ minHeight: 36, py: 0.5, fontSize: '0.8rem' }}
          />
        </Tabs>

        {/* List Content */}
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          {loading && notifications.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : error ? (
            <Alert severity="error" sx={{ m: 1.5 }}>
              {error}
            </Alert>
          ) : notifications.length === 0 ? (
            <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
              <Typography variant="body2">No notifications found.</Typography>
            </Box>
          ) : (
            <List disablePadding>
              {notifications.map((notif, idx) => (
                <React.Fragment key={notif.id}>
                  <ListItem
                    disablePadding
                    sx={{
                      bgcolor: notif.readAt ? 'transparent' : 'action.hover',
                      transition: 'background-color 0.2s',
                    }}
                  >
                    <ListItemButton
                      onClick={() => handleNotificationClick(notif)}
                      sx={{
                        py: 1.25,
                        px: 2,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                      }}
                      data-testid={`notification-item-${notif.id}`}
                    >
                      <Box sx={{ width: '100%', display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                        <Chip
                          label={notif.category.replace(/_/g, ' ')}
                          size="small"
                          color={CATEGORY_COLORS[notif.category] || 'default'}
                          sx={{ height: 18, fontSize: '0.65rem' }}
                        />
                        <Typography variant="caption" color="text.secondary">
                          {new Date(notif.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </Typography>
                      </Box>
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: notif.readAt ? 400 : 600,
                          color: notif.readAt ? 'text.primary' : 'primary.main',
                        }}
                      >
                        {notif.title}
                      </Typography>
                      {notif.deepLink && (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25 }}>
                          Link: {notif.deepLink}
                        </Typography>
                      )}
                    </ListItemButton>
                  </ListItem>
                  {idx < notifications.length - 1 && <Divider component="li" />}
                </React.Fragment>
              ))}
            </List>
          )}
        </Box>
      </Popover>

      <NotificationPreferencesDialog open={preferencesOpen} onClose={() => setPreferencesOpen(false)} />
    </>
  );
}
