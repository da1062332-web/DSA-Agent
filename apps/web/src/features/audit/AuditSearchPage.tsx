// apps/web/src/features/audit/AuditSearchPage.tsx — owner: Akash (Module 37: Audit MOD-AUD)
import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';
import {
  VerifiedUserIcon,
  SearchIcon,
  RefreshIcon,
  DownloadIcon,
  VisibilityIcon,
  LockIcon,
  ShieldIcon,
} from '../../shell/icons';
import type {
  AuditEvent,
  AuditChainVerificationResponse,
  EvidencePackResponse,
} from '@dsa/contracts';
import {
  searchAuditEvents,
  verifyAuditChain,
  sealAuditChain,
  createEvidencePack,
  listEvidencePacks,
} from './api';

export function AuditSearchPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Search Results
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);

  // Filters
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Chain Verification State
  const [chainVerification, setChainVerification] = useState<AuditChainVerificationResponse | null>(null);
  const [verifyingChain, setVerifyingChain] = useState(false);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);

  // Detail Modal
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  // Evidence Pack Modal
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [evidencePurpose, setEvidencePurpose] = useState('');
  const [evidencePacks, setEvidencePacks] = useState<EvidencePackResponse[]>([]);

  const handleSearch = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await searchAuditEvents({
        entityType: entityType.trim() || undefined,
        entityId: entityId.trim() || undefined,
        action: action.trim() || undefined,
        actorId: actorId.trim() || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        limit: 50,
      });
      setEvents(result.data);
      setTotalCount(result.meta.total ?? result.data.length);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to search audit events');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyChain = async () => {
    setVerifyingChain(true);
    setError(null);
    try {
      const res = await verifyAuditChain();
      setChainVerification(res);
      setVerifyModalOpen(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Chain verification check failed');
    } finally {
      setVerifyingChain(false);
    }
  };

  const handleSealChain = async () => {
    setLoading(true);
    try {
      const res = await sealAuditChain();
      setSuccessMsg(`Cryptographic hash chain sealed ${res.sealedCount} events.`);
      await handleSearch();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to seal audit chain');
    } finally {
      setLoading(false);
    }
  };

  const handleExportEvidence = async () => {
    if (!evidencePurpose.trim()) return;
    try {
      setLoading(true);
      const pack = await createEvidencePack({
        entityType: entityType.trim() || undefined,
        entityId: entityId.trim() || undefined,
        purpose: evidencePurpose.trim(),
      });
      setSuccessMsg(`Evidence pack ${pack.id} export requested.`);
      setEvidenceModalOpen(false);
      setEvidencePurpose('');
      const packs = await listEvidencePacks();
      setEvidencePacks(packs);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Evidence export failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    handleSearch();
  }, []);

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
      {/* Title Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ color: 'primary.main', mb: 0.5 }}>
            Audit Trail & Cryptographic Verification
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Module 37 (MOD-AUD): Tamper-evident immutable ledger with SHA-256 hash chaining, state diff tracking, and compliance evidence packs.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button
            variant="outlined"
            startIcon={<LockIcon />}
            onClick={handleSealChain}
            disabled={loading}
          >
            Seal Chain
          </Button>
          <Button
            variant="outlined"
            color="success"
            startIcon={<VerifiedUserIcon />}
            onClick={handleVerifyChain}
            disabled={verifyingChain}
          >
            {verifyingChain ? 'Verifying...' : 'Verify Chain Integrity'}
          </Button>
          <Button
            variant="contained"
            startIcon={<DownloadIcon />}
            onClick={() => setEvidenceModalOpen(true)}
          >
            Export Evidence Pack
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {successMsg && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccessMsg(null)}>
          {successMsg}
        </Alert>
      )}

      {/* Chain Status Card */}
      <Card elevation={2} sx={{ mb: 3, backgroundColor: 'background.paper' }}>
        <CardContent sx={{ py: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={4}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <ShieldIcon color="primary" sx={{ fontSize: 36 }} />
                <Box>
                  <Typography variant="caption" color="text.secondary" textTransform="uppercase">
                    Chain Health
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="h6" fontWeight={700}>
                      SHA-256 Hash Chained
                    </Typography>
                    <Chip size="small" color="success" label="Active" />
                  </Box>
                </Box>
              </Box>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Typography variant="caption" color="text.secondary" textTransform="uppercase">
                Logged Tenant Events
              </Typography>
              <Typography variant="h6" fontWeight={700}>
                {totalCount} Events Recorded
              </Typography>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Typography variant="caption" color="text.secondary" textTransform="uppercase">
                Audit Standards
              </Typography>
              <Typography variant="body2" fontWeight={600} color="text.secondary">
                RBI Digital Lending Guidelines & Section 65B Evidence Act Ready
              </Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Filter / Search Panel */}
      <Paper elevation={2} sx={{ p: 2.5, mb: 3 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>
          Filter Audit Log
        </Typography>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6} md={2.5}>
            <FormControl fullWidth size="small">
              <InputLabel>Entity Type</InputLabel>
              <Select
                value={entityType}
                label="Entity Type"
                onChange={(e) => setEntityType(e.target.value)}
              >
                <MenuItem value="">All Entities</MenuItem>
                <MenuItem value="lead">Lead</MenuItem>
                <MenuItem value="application">Application</MenuItem>
                <MenuItem value="customer">Customer</MenuItem>
                <MenuItem value="user">User</MenuItem>
                <MenuItem value="role">Role</MenuItem>
                <MenuItem value="rule_set">Rule Set</MenuItem>
                <MenuItem value="tenant_config">Configuration</MenuItem>
                <MenuItem value="api_client">API Client</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={2.5}>
            <TextField
              size="small"
              label="Entity ID"
              placeholder="e.g. lead_01J..."
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              fullWidth
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2.5}>
            <TextField
              size="small"
              label="Action"
              placeholder="e.g. lead.create"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              fullWidth
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2.5}>
            <TextField
              size="small"
              label="Actor ID"
              placeholder="e.g. usr_01J..."
              value={actorId}
              onChange={(e) => setActorId(e.target.value)}
              fullWidth
            />
          </Grid>
          <Grid item xs={12} md={2} sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="contained"
              fullWidth
              startIcon={<SearchIcon />}
              onClick={handleSearch}
              disabled={loading}
            >
              Search
            </Button>
            <Button
              variant="outlined"
              onClick={() => {
                setEntityType('');
                setEntityId('');
                setAction('');
                setActorId('');
                setDateFrom('');
                setDateTo('');
              }}
            >
              Reset
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {/* Events Table */}
      <Paper elevation={2}>
        <TableContainer>
          <Table size="medium">
            <TableHead sx={{ backgroundColor: 'action.hover' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Timestamp</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Action</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Entity</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Actor</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>IP Address</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Integrity Status</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>
                  Details
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                    <CircularProgress size={32} />
                  </TableCell>
                </TableRow>
              ) : events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">No audit events match your search criteria.</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                events.map((ev) => (
                  <TableRow key={ev.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {new Date(ev.occurredAt).toLocaleTimeString()}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(ev.occurredAt).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={ev.action}
                        color="primary"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {ev.entityType}
                      </Typography>
                      <Typography variant="caption" fontFamily="monospace" color="text.secondary">
                        {ev.entityId}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {ev.actorType}: {ev.actorId.slice(0, 10)}...
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" fontFamily="monospace">
                        {ev.ip || '127.0.0.1'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {ev.hash ? (
                        <Tooltip title={`Hash: ${ev.hash}`}>
                          <Chip
                            size="small"
                            color="success"
                            label="Sealed"
                            icon={<LockIcon sx={{ fontSize: 14 }} />}
                          />
                        </Tooltip>
                      ) : (
                        <Chip size="small" variant="outlined" label="Unsealed" />
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => {
                          setSelectedEvent(ev);
                          setDetailModalOpen(true);
                        }}
                      >
                        <VisibilityIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Event Details Dialog */}
      <Dialog open={detailModalOpen} onClose={() => setDetailModalOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>
              Audit Event: {selectedEvent?.action}
            </Typography>
            <Typography variant="caption" fontFamily="monospace" color="text.secondary">
              ID: {selectedEvent?.id} | Correlation: {selectedEvent?.correlationId}
            </Typography>
          </Box>
          {selectedEvent?.hash && (
            <Chip size="small" color="success" label="Cryptographically Sealed" />
          )}
        </DialogTitle>
        <DialogContent dividers sx={{ pt: 2 }}>
          {selectedEvent && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Actor</Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {selectedEvent.actorType}: {selectedEvent.actorId}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Permission Used</Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {selectedEvent.permissionUsed || 'SYSTEM_AUTH'}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Client IP & Agent</Typography>
                  <Typography variant="body2" fontFamily="monospace">
                    {selectedEvent.ip || 'N/A'} ({selectedEvent.userAgent || 'App'})
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Linked Decision Record</Typography>
                  <Typography variant="body2" fontFamily="monospace">
                    {selectedEvent.decisionRecordId || 'None'}
                  </Typography>
                </Grid>
              </Grid>

              <Divider sx={{ my: 1 }} />

              <Typography variant="subtitle2" fontWeight={700}>
                State Mutation Payload
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" color="text.secondary">Before State</Typography>
                  <Paper variant="outlined" sx={{ p: 1.5, backgroundColor: 'action.hover', maxHeight: 220, overflow: 'auto' }}>
                    <pre style={{ margin: 0, fontSize: '0.8rem' }}>
                      {selectedEvent.before ? JSON.stringify(selectedEvent.before, null, 2) : 'null'}
                    </pre>
                  </Paper>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" color="text.secondary">After State</Typography>
                  <Paper variant="outlined" sx={{ p: 1.5, backgroundColor: 'action.hover', maxHeight: 220, overflow: 'auto' }}>
                    <pre style={{ margin: 0, fontSize: '0.8rem' }}>
                      {selectedEvent.after ? JSON.stringify(selectedEvent.after, null, 2) : 'null'}
                    </pre>
                  </Paper>
                </Grid>
              </Grid>

              {selectedEvent.hash && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="caption" color="text.secondary">SHA-256 Hash Chain</Typography>
                  <Typography variant="caption" fontFamily="monospace" display="block">
                    Current Hash: {selectedEvent.hash}
                  </Typography>
                  <Typography variant="caption" fontFamily="monospace" color="text.secondary" display="block">
                    Previous Hash: {selectedEvent.prevHash || '0'.repeat(64)}
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDetailModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Cryptographic Chain Verification Modal */}
      <Dialog open={verifyModalOpen} onClose={() => setVerifyModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <VerifiedUserIcon color="success" />
          Cryptographic Hash Chain Verification
        </DialogTitle>
        <DialogContent dividers sx={{ pt: 2 }}>
          {chainVerification && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Alert
                severity={chainVerification.status === 'VERIFIED' ? 'success' : 'error'}
              >
                Chain Status: <strong>{chainVerification.status}</strong>
              </Alert>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Total Events</Typography>
                  <Typography variant="h6" fontWeight={700}>{chainVerification.totalEvents}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Sealed in Chain</Typography>
                  <Typography variant="h6" fontWeight={700} color="success.main">
                    {chainVerification.sealedEvents}
                  </Typography>
                </Grid>
              </Grid>
              {chainVerification.verifiedRange && (
                <Box>
                  <Typography variant="subtitle2" fontWeight={600}>Verified Sequence Range</Typography>
                  <Typography variant="body2">
                    Sequence #{chainVerification.verifiedRange.fromSeq ?? 1} to #{chainVerification.verifiedRange.toSeq ?? chainVerification.sealedEvents}
                  </Typography>
                  <Typography variant="caption" fontFamily="monospace" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                    Latest Merkle Root: {chainVerification.verifiedRange.latestHash?.slice(0, 32)}...
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setVerifyModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Evidence Pack Export Modal */}
      <Dialog open={evidenceModalOpen} onClose={() => setEvidenceModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Request Compliance Evidence Pack</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Generate an immutable evidence archive sealed with SHA-256 manifest and digital chain verification for external auditors.
          </Typography>
          <TextField
            label="Audit Purpose / Regulation Reference"
            placeholder="e.g. Annual RBI Compliance Review Q4"
            value={evidencePurpose}
            onChange={(e) => setEvidencePurpose(e.target.value)}
            multiline
            rows={3}
            fullWidth
            required
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEvidenceModalOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!evidencePurpose.trim() || loading}
            onClick={handleExportEvidence}
          >
            Generate Evidence Pack
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
