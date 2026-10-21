// apps/web/src/features/notifications/NotificationPreferencesDialog.tsx — SUB-NTF.02
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  FormLabel,
  Grid,
  Radio,
  RadioGroup,
  Switch,
  Typography,
} from '@mui/material';
import { ApiError, apiRequest, errorText } from '../../api/client';
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationPreferences,
  type UserProfile,
} from '@dsa/contracts';

export interface NotificationPreferencesDialogProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  TASK: 'Task Updates & Assignments',
  LEAD: 'Lead Status & Communications',
  APPLICATION: 'Loan Application Updates',
  SYSTEM: 'System Notices & Operations',
  ALERT: 'Alerts & SLA Warnings',
};

const DEFAULT_PREFERENCES: NotificationPreferences = {
  channels: {
    inApp: true,
    email: false,
    sms: false,
    whatsapp: false,
  },
  digestFrequency: 'IMMEDIATE',
  mutedCategories: [],
};

export function NotificationPreferencesDialog({ open, onClose }: NotificationPreferencesDialogProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [lockVersion, setLockVersion] = useState<number | null>(null);

  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, etag }: { data: any; etag?: string } = await apiRequest('/v1/me');

      const rawPrefs = data?.notificationPreferences ?? data?.data?.notificationPreferences;
      if (rawPrefs && typeof rawPrefs === 'object') {
        setPreferences({
          channels: {
            inApp: rawPrefs.channels?.inApp ?? true,
            email: rawPrefs.channels?.email ?? false,
            sms: rawPrefs.channels?.sms ?? false,
            whatsapp: rawPrefs.channels?.whatsapp ?? false,
          },
          digestFrequency: rawPrefs.digestFrequency ?? 'IMMEDIATE',
          mutedCategories: Array.isArray(rawPrefs.mutedCategories) ? rawPrefs.mutedCategories : [],
        });
      } else {
        setPreferences(DEFAULT_PREFERENCES);
      }

      if (etag) {
        const parsed = parseInt(etag.replace(/["']/g, ''), 10);
        setLockVersion(isNaN(parsed) ? 0 : parsed);
      } else if (typeof data?.lockVersion === 'number') {
        setLockVersion(data.lockVersion);
      } else if (typeof data?.data?.lockVersion === 'number') {
        setLockVersion(data.data.lockVersion);
      } else {
        setLockVersion(0);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchProfile();
    }
  }, [open, fetchProfile]);

  const handleSave = async () => {
    const versionToSend = lockVersion ?? 0;
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: updated, etag: newEtag }: { data: any; etag?: string } = await apiRequest('/v1/me', {
        method: 'PATCH',
        body: { preferences },
        version: versionToSend,
      });
      if (newEtag) {
        const parsed = parseInt(newEtag.replace(/["']/g, ''), 10);
        setLockVersion(isNaN(parsed) ? (updated?.lockVersion ?? 0) : parsed);
      } else if (typeof updated?.lockVersion === 'number') {
        setLockVersion(updated.lockVersion);
      }
      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 800);
    } catch (err) {
      // The API answers a stale If-Match with 409 VERSION_CONFLICT: reload the current preferences.
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        setError(
          'Preferences were changed in another tab or session. The latest preferences are loaded again.',
        );
        await fetchProfile();
        return;
      }
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleCategoryMute = (cat: NotificationCategory) => {
    setPreferences((prev) => {
      const current = prev?.mutedCategories ?? [];
      const isMuted = current.includes(cat);
      const nextMuted = isMuted ? current.filter((c) => c !== cat) : [...current, cat];
      return {
        ...(prev ?? DEFAULT_PREFERENCES),
        channels: prev?.channels ?? DEFAULT_PREFERENCES.channels,
        digestFrequency: prev?.digestFrequency ?? 'IMMEDIATE',
        mutedCategories: nextMuted,
      };
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth disablePortal>
      <DialogTitle>Notification Preferences</DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress size={32} />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {success && <Alert severity="success">Preferences saved successfully!</Alert>}

            {/* Channels */}
            <Box>
              <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
                Delivery Channels
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Configure where you would like to receive notifications and alerts. External channels remain
                subject to consent and quiet hours.
              </Typography>
              <FormGroup>
                <FormControlLabel
                  control={
                    <Switch
                      checked={preferences?.channels?.inApp ?? true}
                      onChange={(e) =>
                        setPreferences((p) => ({
                          ...(p ?? DEFAULT_PREFERENCES),
                          channels: {
                            ...(p?.channels ?? DEFAULT_PREFERENCES.channels),
                            inApp: e.target.checked,
                          },
                        }))
                      }
                      color="primary"
                    />
                  }
                  label="In-App Notifications (Notification Center bell & inbox)"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={preferences?.channels?.email ?? false}
                      onChange={(e) =>
                        setPreferences((p) => ({
                          ...(p ?? DEFAULT_PREFERENCES),
                          channels: {
                            ...(p?.channels ?? DEFAULT_PREFERENCES.channels),
                            email: e.target.checked,
                          },
                        }))
                      }
                    />
                  }
                  label="Email Delivery"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={preferences?.channels?.sms ?? false}
                      onChange={(e) =>
                        setPreferences((p) => ({
                          ...(p ?? DEFAULT_PREFERENCES),
                          channels: {
                            ...(p?.channels ?? DEFAULT_PREFERENCES.channels),
                            sms: e.target.checked,
                          },
                        }))
                      }
                    />
                  }
                  label="SMS Delivery"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={preferences?.channels?.whatsapp ?? false}
                      onChange={(e) =>
                        setPreferences((p) => ({
                          ...(p ?? DEFAULT_PREFERENCES),
                          channels: {
                            ...(p?.channels ?? DEFAULT_PREFERENCES.channels),
                            whatsapp: e.target.checked,
                          },
                        }))
                      }
                    />
                  }
                  label="WhatsApp Delivery"
                />
              </FormGroup>
            </Box>

            <Divider />

            {/* Digest Frequency */}
            <Box>
              <FormControl component="fieldset">
                <FormLabel component="legend" sx={{ fontWeight: 600, fontSize: '0.875rem' }}>
                  Digest Frequency
                </FormLabel>
                <RadioGroup
                  value={preferences?.digestFrequency ?? 'IMMEDIATE'}
                  onChange={(e) =>
                    setPreferences((p) => ({
                      ...(p ?? DEFAULT_PREFERENCES),
                      digestFrequency: e.target.value as NotificationPreferences['digestFrequency'],
                    }))
                  }
                >
                  <FormControlLabel
                    value="IMMEDIATE"
                    control={<Radio />}
                    label="Immediate (Real-time as events occur)"
                  />
                  <FormControlLabel
                    value="DAILY_DIGEST"
                    control={<Radio />}
                    label="Daily Digest (Summary once per day)"
                  />
                  <FormControlLabel
                    value="MUTED"
                    control={<Radio />}
                    label="Muted (Do not send email/external notifications)"
                  />
                </RadioGroup>
              </FormControl>
            </Box>

            <Divider />

            {/* Muted Categories */}
            <Box>
              <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
                Muted Notification Categories
              </Typography>
              <FormHelperText sx={{ mb: 1 }}>
                Checked categories will be silenced and will not generate notifications.
              </FormHelperText>
              <Grid container spacing={1}>
                {NOTIFICATION_CATEGORIES.map((cat) => (
                  <Grid item xs={12} sm={6} key={cat}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={(preferences?.mutedCategories ?? []).includes(cat)}
                          onChange={() => toggleCategoryMute(cat)}
                          color="error"
                        />
                      }
                      label={CATEGORY_LABELS[cat] || cat}
                    />
                  </Grid>
                ))}
              </Grid>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} variant="contained" disabled={loading || saving}>
          {saving ? 'Saving...' : 'Save Preferences'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
