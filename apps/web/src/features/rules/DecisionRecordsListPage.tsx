// apps/web/src/features/rules/DecisionRecordsListPage.tsx — owner: Developer 6 (Module 23: Business Rule Engine)
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchDecisionRecords } from './api';
import type { DecisionKey, DecisionRecordResponse } from './types';

const MVP_DECISION_KEYS: DecisionKey[] = [
  'DK-lead.duplicate',
  'DK-customer.duplicate',
  'DK-lead.assignment',
  'DK-sla.target',
  'DK-document.requirements',
  'DK-application.completeness',
];

export function DecisionRecordsListPage() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<DecisionRecordResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [decisionFilter, setDecisionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const loadRecords = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchDecisionRecords({
        decisionKey: decisionFilter || undefined,
        status: statusFilter || undefined,
      });
      setRecords(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load decision execution records');
    } finally {
      setLoading(false);
    }
  }, [decisionFilter, statusFilter]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Button size="small" onClick={() => navigate('/rules')} sx={{ mb: 1 }}>
            ← Back to Rules
          </Button>
          <Typography variant="h4" fontWeight={700}>
            Decision Execution Audit Records
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Immutable audit log of all live decisions evaluated by the rule engine
          </Typography>
        </Box>
      </Stack>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={5}>
              <FormControl fullWidth size="small">
                <InputLabel id="decision-filter-label">Decision Key</InputLabel>
                <Select
                  labelId="decision-filter-label"
                  value={decisionFilter}
                  label="Decision Key"
                  onChange={(e) => setDecisionFilter(e.target.value)}
                >
                  <MenuItem value="">
                    <em>All Decisions</em>
                  </MenuItem>
                  {MVP_DECISION_KEYS.map((k) => (
                    <MenuItem key={k} value={k}>
                      {k}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControl fullWidth size="small">
                <InputLabel id="status-filter-label">Status</InputLabel>
                <Select
                  labelId="status-filter-label"
                  value={statusFilter}
                  label="Status"
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <MenuItem value="">
                    <em>All Statuses</em>
                  </MenuItem>
                  <MenuItem value="MATCHED">MATCHED</MenuItem>
                  <MenuItem value="NO_MATCH">NO_MATCH</MenuItem>
                  <MenuItem value="ERROR">ERROR</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={3}>
              <Button
                fullWidth
                variant="outlined"
                onClick={() => {
                  setDecisionFilter('');
                  setStatusFilter('');
                }}
              >
                Reset Filters
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box display="flex" justifyContent="center" py={8}>
          <CircularProgress />
        </Box>
      ) : records.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: 'center' }}>
          <Typography variant="h6" color="text.secondary">
            No decision execution records found
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Live decision evaluations will be logged here with input hashes and matched rules.
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Record ID</TableCell>
                <TableCell>Decision Key</TableCell>
                <TableCell>Subject</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Matched Rules</TableCell>
                <TableCell>Duration</TableCell>
                <TableCell>Evaluated At</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {records.map((r) => (
                <TableRow
                  key={r.id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/decisions/${r.id}`)}
                >
                  <TableCell>
                    <Typography variant="subtitle2" fontFamily="monospace">
                      {r.id}
                    </Typography>
                    {r.ruleSetVersionId && (
                      <Typography variant="caption" color="text.secondary">
                        Ver: {r.ruleSetVersionId.slice(0, 14)}...
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={r.decisionKey} color="primary" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {r.subjectType ? `${r.subjectType}:${r.subjectId?.slice(0, 10)}...` : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={r.status}
                      color={
                        r.status === 'OK'
                          ? 'success'
                          : r.status === 'NO_MATCH'
                          ? 'warning'
                          : 'error'
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {r.matchedRuleUids.length > 0 ? r.matchedRuleUids.join(', ') : 'None'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {r.durationUs ? `${r.durationUs} µs` : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {new Date(r.evaluationTime).toLocaleString()}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      variant="text"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/decisions/${r.id}`);
                      }}
                    >
                      View Trace
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Container>
  );
}
