// apps/web/src/features/rules/DecisionRecordDetailPage.tsx — owner: Developer 6 (Module 23: Business Rule Engine)
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Grid,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../ui';
import { fetchDecisionRecord } from './api';
import type { DecisionRecordResponse } from './types';
import { NotSet } from '../../ui/NotSet';

export function DecisionRecordDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [record, setRecord] = useState<DecisionRecordResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRecord = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetchDecisionRecord(id);
      setRecord(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load decision record');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadRecord();
  }, [loadRecord]);

  if (loading) {
    return (
      <Container maxWidth={false} disableGutters sx={{ py: 8, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (error || !record) {
    return (
      <Container maxWidth={false} disableGutters>
        <Alert severity="error">{error || 'Decision record not found'}</Alert>
        <Button sx={{ mt: 2 }} onClick={() => navigate('/decisions')}>
          Back to Execution Logs
        </Button>
      </Container>
    );
  }

  return (
    <Container maxWidth={false} disableGutters>
      <PageHeader
        title="Decision Record"
        backTo="/decisions"
        badge={
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              size="medium"
              label={record.status}
              color={record.status === 'OK' ? 'success' : record.status === 'NO_MATCH' ? 'warning' : 'error'}
            />
            <Chip size="medium" label={record.decisionKey} color="primary" variant="outlined" />
          </Stack>
        }
        subtitle={
          <Typography variant="caption" color="text.secondary" fontFamily="monospace">
            ID: {record.id} | Evaluated: {new Date(record.evaluationTime).toLocaleString()}
          </Typography>
        }
      />

      {/* Meta cards */}
      <Grid container spacing={2} mb={3}>
        <Grid item xs={12} sm={3}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="text.secondary">
                Subject
              </Typography>
              <Typography variant="body1" fontWeight={600} mt={0.5}>
                {record.subjectType ? `${record.subjectType}: ${record.subjectId}` : 'None'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={3}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="text.secondary">
                Rule Set Version
              </Typography>
              <Typography variant="body1" fontWeight={600} mt={0.5}>
                {record.ruleSetVersionId ? (
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => navigate(`/rules/versions/${record.ruleSetVersionId}`)}
                  >
                    {record.ruleSetVersionId.slice(0, 16)}...
                  </Button>
                ) : (
                  'Fallback/None'
                )}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={3}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="text.secondary">
                Execution Duration
              </Typography>
              <Typography variant="body1" fontWeight={600} mt={0.5}>
                {record.durationUs ? `${record.durationUs} µs` : <NotSet />}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={3}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="text.secondary">
                Fallback Behavior
              </Typography>
              <Typography variant="body1" fontWeight={600} mt={0.5}>
                {record.fallbackApplied ? `APPLIED (${record.fallbackPolicy ?? 'DEFAULT'})` : 'NONE'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Matched rules */}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} mb={1}>
            Matched Rules
          </Typography>
          {record.matchedRuleUids.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No rule conditions were satisfied during this evaluation.
            </Typography>
          ) : (
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {record.matchedRuleUids.map((uid) => (
                <Chip key={uid} label={uid} color="primary" />
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>

      {/* Output and Input snapshot */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} mb={1}>
                Evaluation Outputs
              </Typography>
              <Paper sx={{ p: 2, bgcolor: '#f8f9fa' }}>
                <Typography variant="caption" component="pre" sx={{ m: 0 }}>
                  {JSON.stringify(record.outputs, null, 2)}
                </Typography>
              </Paper>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={6}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} mb={1}>
                Input Facts Snapshot
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                Input Hash: {record.inputHash}
              </Typography>
              <Paper sx={{ p: 2, bgcolor: '#f8f9fa' }}>
                <Typography variant="caption" component="pre" sx={{ m: 0 }}>
                  {JSON.stringify(record.inputSnapshot, null, 2)}
                </Typography>
              </Paper>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}
