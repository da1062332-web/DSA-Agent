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
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { getStoredAuthToken } from '../../auth/token';
import { LogActivityForm } from './LogActivityForm';
import type { Activity } from '@dsa/contracts';

export function ActivitiesPage({ apiBaseUrl = '/v1' }: { apiBaseUrl?: string }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  const fetchActivities = useCallback(async () => {
    try {
      setLoading(true);
      const token = getStoredAuthToken();
      const res = await fetch(`${apiBaseUrl}/activities`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (res.ok) {
        const json = await res.json();
        setActivities(json.data ?? json ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  const handleActivityLogged = (newActivity: Activity) => {
    setActivities((prev) => [newActivity, ...prev]);
    fetchActivities();
  };

  const handleHideActivity = async (activity: Activity) => {
    try {
      const token = getStoredAuthToken();
      const res = await fetch(`${apiBaseUrl}/activities/${activity.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `"${activity.lockVersion}"`,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ isHidden: true }),
      });
      if (res.ok) {
        setActivities((prev) => prev.filter((a) => a.id !== activity.id));
      }
    } catch {
      // ignore
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
          <Button
            variant="contained"
            onClick={() => setFormOpen(true)}
            data-testid="activity.log-button"
          >
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
            <TableContainer component={Paper} elevation={0}>
              <Table>
                <TableHead sx={{ bgcolor: '#f8fafc' }}>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Kind</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Subject</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Outcome</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Duration</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Note</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Logged By</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Occurred At</TableCell>
                    <TableCell sx={{ fontWeight: 600, textAlign: 'right' }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {activities.map((a) => (
                    <TableRow key={a.id} hover>
                      <TableCell>
                        <Chip
                          size="small"
                          label={a.kind}
                          color={getKindColor(a.kind) as any}
                          variant="filled"
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>
                          {a.subjectType}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                          {a.subjectId}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {a.outcomeCode ? (
                          <Chip size="small" label={a.outcomeCode} variant="outlined" />
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            &mdash;
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {a.durationSeconds ? `${Math.round(a.durationSeconds / 60)} min` : '&mdash;'}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 280, wordBreak: 'break-word' }}>
                        <Typography variant="body2">{a.note || '&mdash;'}</Typography>
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        {a.actorId}
                      </TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>
                        {new Date(a.occurredAt).toLocaleString()}
                      </TableCell>
                      <TableCell sx={{ textAlign: 'right' }}>
                        <Button
                          size="small"
                          color="inherit"
                          sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                          onClick={() => handleHideActivity(a)}
                        >
                          Hide
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {activities.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} sx={{ textAlign: 'center', py: 5, color: 'text.secondary' }}>
                        No activities logged yet. Click &quot;Log Activity&quot; above to record your first interaction.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <LogActivityForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSuccess={handleActivityLogged}
        defaultSubjectType="LEAD"
        defaultSubjectId="lead_demo_01"
        apiBaseUrl={apiBaseUrl}
      />
    </Container>
  );
}
