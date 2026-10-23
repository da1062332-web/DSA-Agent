// apps/web/src/features/activities/ActivitiesPage.tsx — Module 10: Activities (MOD-ACT)
import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import Alert from '@mui/material/Alert';
import { apiFetch, errorText } from '../../api/client';
import { LogActivityForm } from './LogActivityForm';
import type { Activity } from '@dsa/contracts';
import { UserName } from '../../shell/display';
import { DataTable } from '../../ui';

// Lists the caller's own activities (GET /v1/activities without a subject). A subject's activities are on its timeline.
export function ActivitiesPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchActivities = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const json = await apiFetch<{ data: Activity[] }>('/v1/activities');
      setActivities(json.data ?? []);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  const handleActivityLogged = (newActivity: Activity) => {
    setActivities((prev) => [newActivity, ...prev]);
    fetchActivities();
  };

  const handleHideActivity = async (activity: Activity) => {
    try {
      await apiFetch<Activity>(`/v1/activities/${encodeURIComponent(activity.id)}`, {
        method: 'PATCH',
        body: { isHidden: true },
        version: activity.lockVersion,
      });
      setActivities((prev) => prev.filter((a) => a.id !== activity.id));
    } catch (err) {
      setError(errorText(err));
    }
  };

  const getKindColor = (kind: string) => {
    switch (kind) {
      case 'CALL':
        return 'primary';
      case 'MEETING':
        return 'secondary';
      case 'NOTE':
        return 'info';
      case 'TASK_FOLLOWUP':
        return 'warning';
      case 'VISIT':
        return 'success';
      default:
        return 'default';
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} data-testid="activities.error">
          {error}
        </Alert>
      )}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Activities & Interactions (MOD-ACT)
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Module 10 &bull; Interaction Logging &bull; Calls, Meetings, Notes &bull; S2/S3 Data Protection
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button variant="outlined" onClick={fetchActivities}>
            Refresh
          </Button>
          <Button variant="contained" onClick={() => setFormOpen(true)} data-testid="activity.log-button">
            + Log Activity
          </Button>
        </Box>
      </Box>

      <Card sx={{ borderRadius: 2, boxShadow: 1 }}>
        <CardContent sx={{ p: 0 }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress />
            </Box>
          ) : (
            <DataTable<Activity>
              dataTestId="act.table"
              data={activities}
              keyExtractor={(a) => a.id}
              emptyMessage='No activities logged yet. Click "Log Activity" above to record your first interaction.'
              columns={[
                {
                  id: 'kind',
                  header: 'Kind',
                  render: (a) => <Chip size="small" label={a.kind} color={getKindColor(a.kind) as any} variant="filled" />,
                },
                {
                  id: 'subject',
                  header: 'Subject',
                  render: (a) => (
                    <>
                      <Typography variant="body2" fontWeight={600}>
                        {a.subjectType}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                        {a.subjectId}
                      </Typography>
                    </>
                  ),
                },
                {
                  id: 'outcome',
                  header: 'Outcome',
                  render: (a) =>
                    a.outcomeCode ? (
                      <Chip size="small" label={a.outcomeCode} variant="outlined" />
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        —
                      </Typography>
                    ),
                },
                {
                  id: 'duration',
                  header: 'Duration',
                  render: (a) => (a.durationSeconds ? `${Math.round(a.durationSeconds / 60)} min` : '—'),
                },
                {
                  id: 'note',
                  header: 'Note',
                  render: (a) => (
                    <Box sx={{ maxWidth: 280, wordBreak: 'break-word' }}>
                      <Typography variant="body2">{a.note || '—'}</Typography>
                    </Box>
                  ),
                },
                {
                  id: 'by',
                  header: 'Logged By',
                  render: (a) => <UserName id={a.actorId} typographyProps={{ fontWeight: 500 }} />,
                },
                {
                  id: 'occurred',
                  header: 'Occurred At',
                  render: (a) => (
                    <Box sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>{new Date(a.occurredAt).toLocaleString()}</Box>
                  ),
                },
                {
                  id: 'actions',
                  header: 'Actions',
                  align: 'right',
                  render: (a) => (
                    <Button
                      size="small"
                      color="inherit"
                      sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                      onClick={() => handleHideActivity(a)}
                    >
                      Hide
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </CardContent>
      </Card>

      <LogActivityForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSuccess={handleActivityLogged}
        defaultSubjectType="LEAD"
      />
    </Container>
  );
}
