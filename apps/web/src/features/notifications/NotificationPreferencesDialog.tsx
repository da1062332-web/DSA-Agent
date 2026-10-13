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
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationPreferences,
  type UserProfile,
} from '@dsa/contracts';

export interface NotificationPreferencesDialogProps {
  open: boolean;
  onClose: () => void;
  apiBaseUrl?: string;
}

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  TASK: 'Task Updates & Assignments',
  LEAD: 'Lead Status & Communications',
  APPLICATION: 'Loan Application Updates',
  SYSTEM: 'System Notices & Operations',
  ALERT: 'Alerts & SLA Warnings',
};

export function NotificationPreferencesDialog({
  open,
  onClose,
  apiBaseUrl = '/v1',
}: NotificationPreferencesDialogProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [lockVersion, setLockVersion] = useState<number | null>(null);

  const [preferences, setPreferences] = useState<NotificationPreferences>({
    channels: {
      inApp: true,
      email: true,
      sms: false,
      whatsapp: false,
    },
    digestFrequency: 'IMMEDIATE',
    mutedCategories: [],
  });

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      const token = sessionStorage.getItem('dsa_auth_token') || localStorage.getItem('dsa_auth_token');
      const res = await fetch(`${apiBaseUrl}/me`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        throw new Error(`Failed to load profile preferences: HTTP ${res.status}`);
      }

      const etag = res.headers.get('ETag');
      const data: UserProfile = await res.json();

      setPreferences(data.notificationPreferences);
      if (etag) {
        setLockVersion(parseInt(etag.replace(/["']/g, ''), 10));
      } else {
        setLockVersion(data.lockVersion);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    if (open) {
      fetchProfile();
    }
  }, [open, fetchProfile]);

  const handleSave = async () => {
    if (lockVersion === null) return;
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const token = sessionStorage.getItem('dsa_auth_token') || localStorage.getItem('dsa_auth_token');
      const res = await fetch(`${apiBaseUrl}/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `"${lockVersion}"`,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ preferences }),
      });

      if (res.status === 412) {
        setError('Preferences were modified concurrently in another tab or session. Reloading latest preferences...');
        await fetchProfile();
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || `Failed to save preferences: HTTP ${res.status}`);
      }

      const updated: UserProfile = await res.json();
      const newEtag = res.headers.get('ETag');
      if (newEtag) {
        setLockVersion(parseInt(newEtag.replace(/["']/g, ''), 10));
      } else {
        setLockVersion(updated.lockVersion);
      }
      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const toggleCategoryMute = (cat: NotificationCategory) => {
    setPreferences((prev) => {
      const isMuted = prev.mutedCategories.includes(cat);
      const nextMuted = isMuted
        ? prev.mutedCategories.filter((c) => c !== cat)
        : [...prev.mutedCategories, cat];
      return { ...prev, mutedCategories: nextMuted };
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
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
                Configure where you would like to receive notifications and alerts. External channels remain subject to consent and quiet hours.
              </Typography>
              <FormGroup>
                <FormControlLabel
                  control={
                    <Switch
                      checked={preferences.channels.inApp}
                      onChange={(e) =>
                        setPreferences((p) => ({
                          ...p,
                          channels: { ...p.channels, inApp: e.target.checked },
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
                      checked={preferences.channels.email}
                      onChange={(e) =>
                        setPreferences((p) => ({
                          ...p,
                          channels: { ...p.channels, email: e.target.checked },
                        }))
                      }
                    />
                  }
                  label="Email Delivery"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={preferences.channels.sms}
                      onChange={(e) =>
                        setPreferences((p) => ({
                          ...p,
                          channels: { ...p.channels, sms: e.target.checked },
                        }))
                      }
                    />
                  }
                  label="SMS Delivery"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={preferences.channels.whatsapp}
                      onChange={(e) =>
                        setPreferences((p) => ({
                          ...p,
                          channels: { ...p.channels, whatsapp: e.target.checked },
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
                  value={preferences.digestFrequency}
                  onChange={(e) =>
                    setPreferences((p) => ({
                      ...p,
                      digestFrequency: e.target.value as NotificationPreferences['digestFrequency'],
                    }))
                  }
                >
                  <FormControlLabel value="IMMEDIATE" control={<Radio />} label="Immediate (Real-time as events occur)" />
                  <FormControlLabel value="DAILY_DIGEST" control={<Radio />} label="Daily Digest (Summary once per day)" />
                  <FormControlLabel value="MUTED" control={<Radio />} label="Muted (Do not send email/external notifications)" />
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
                          checked={preferences.mutedCategories.includes(cat)}
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
        <Button onClick={handleSave} variant="contained" disabled={loading || saving || lockVersion === null}>
          {saving ? 'Saving...' : 'Save Preferences'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
