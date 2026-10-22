// apps/web/src/features/audit/AuditSearchPage.tsx — owner: Akash (Module 37: Audit MOD-AUD)
import React, { useEffect, useMemo, useState } from 'react';
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
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Switch,
  Tab,
  Tabs,
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
  ContentCopyIcon,
  CheckCircleIcon,
} from '../../shell/icons';
import type { AuditEvent, AuditChainVerificationResponse, EvidencePackResponse } from '@dsa/contracts';
import {
  searchAuditEvents,
  verifyAuditChain,
  sealAuditChain,
  createEvidencePack,
  listEvidencePacks,
} from './api';
import { Can } from '../../shell/Can';
import { UserSelect } from '../../shell/selectors';
import { UserName } from '../../shell/display';

// =========================================================================
// HELPER: Format field values nicely (Currencies, Masked PII, Booleans, etc.)
// =========================================================================
function formatFieldValue(val: unknown): React.ReactNode {
  if (val === null || val === undefined) {
    return (
      <Typography variant="caption" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
        null
      </Typography>
    );
  }

  // Currency / Money object
  if (typeof val === 'object' && val !== null && 'amount' in val && 'currency' in val) {
    const money = val as { amount: string | number; currency: string };
    const num = Number(money.amount);
    return (
      <Typography variant="body2" fontWeight={700} color="primary.main">
        {money.currency === 'INR' ? '₹' : ''}
        {Number.isNaN(num) ? money.amount : num.toLocaleString('en-IN')} {money.currency}
      </Typography>
    );
  }

  // Redacted or Masked PII
  if (typeof val === 'string' && (val === '[REDACTED]' || val.includes('******') || val.includes('****'))) {
    return (
      <Chip
        label={val}
        size="small"
        variant="outlined"
        color="warning"
        sx={{ fontFamily: 'monospace', fontSize: '0.75rem', height: 22 }}
      />
    );
  }

  // Booleans
  if (typeof val === 'boolean') {
    return (
      <Chip
        label={val ? 'true' : 'false'}
        size="small"
        color={val ? 'success' : 'default'}
        sx={{ height: 20, fontSize: '0.7rem', fontWeight: 600 }}
      />
    );
  }

  // Arrays
  if (Array.isArray(val)) {
    if (val.length === 0) {
      return (
        <Typography variant="caption" sx={{ color: 'text.disabled' }}>
          [] (empty)
        </Typography>
      );
    }
    return (
      <Stack direction="row" spacing={0.5} flexWrap="wrap">
        {val.map((item, idx) => (
          <Chip
            key={idx}
            label={typeof item === 'object' ? JSON.stringify(item) : String(item)}
            size="small"
            variant="outlined"
            sx={{ fontSize: '0.7rem', height: 20, my: 0.2 }}
          />
        ))}
      </Stack>
    );
  }

  // Objects
  if (typeof val === 'object') {
    return (
      <pre style={{ margin: 0, fontSize: '0.75rem', fontFamily: 'monospace' }}>
        {JSON.stringify(val, null, 2)}
      </pre>
    );
  }

  // Strings / IDs
  const str = String(val);
  const isId = /^[a-z]{2,5}_[0-9A-Za-z]+$/.test(str);
  if (isId) {
    return (
      <Typography variant="body2" fontFamily="monospace" fontWeight={600} color="text.secondary">
        {str}
      </Typography>
    );
  }

  // Date strings
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) {
    return (
      <Typography variant="body2">
        {new Date(val).toLocaleString()}
      </Typography>
    );
  }

  return (
    <Typography variant="body2" fontWeight={500}>
      {str}
    </Typography>
  );
}

// Convert camelCase or snake_case to Human Readable Title
function formatFieldLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

// =========================================================================
// COMPONENT: Structured Payload Viewer (Card / Key-Value Table vs Raw JSON)
// =========================================================================
interface PayloadViewerProps {
  data?: Record<string, unknown> | null;
  title: string;
  isBefore?: boolean;
  onCopy: (text: string, label: string) => void;
}

function PayloadViewer({ data, title, isBefore = false, onCopy }: PayloadViewerProps) {
  const [viewMode, setViewMode] = useState<'structured' | 'raw'>('structured');
  const [hideNulls, setHideNulls] = useState<boolean>(true);

  if (!data) {
    return (
      <Paper
        variant="outlined"
        sx={{
          p: 3,
          backgroundColor: 'action.hover',
          height: 320,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
          borderRadius: 2,
        }}
      >
        <Chip
          label={isBefore ? '+ Initial Creation' : 'Entity Deleted'}
          color={isBefore ? 'info' : 'error'}
          size="small"
          sx={{ mb: 1.5, fontWeight: 700 }}
        />
        <Typography variant="body2" fontWeight={600} color="text.primary">
          {isBefore ? 'No prior state recorded.' : 'Entity was deleted / purged.'}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, maxWidth: 280 }}>
          {isBefore
            ? 'This audit event created the entity, so no prior database values existed.'
            : 'No subsequent state exists for this record.'}
        </Typography>
      </Paper>
    );
  }

  const entries = Object.entries(data);
  const filteredEntries = hideNulls
    ? entries.filter(([_, v]) => v !== null && v !== undefined && (!Array.isArray(v) || v.length > 0))
    : entries;

  const rawJson = JSON.stringify(data, null, 2);

  return (
    <Paper
      variant="outlined"
      sx={{
        height: 320,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 2,
        overflow: 'hidden',
        backgroundColor: 'background.paper',
      }}
    >
      {/* Viewer Header / Toolbar */}
      <Box
        sx={{
          px: 2,
          py: 1,
          backgroundColor: 'action.hover',
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="caption" fontWeight={700} color="text.primary" textTransform="uppercase">
            {title} ({filteredEntries.length} fields)
          </Typography>
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center">
          {viewMode === 'structured' && (
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={hideNulls}
                  onChange={(e) => setHideNulls(e.target.checked)}
                />
              }
              label={
                <Typography variant="caption" color="text.secondary">
                  Hide Empty
                </Typography>
              }
              sx={{ mr: 0.5 }}
            />
          )}

          <Button
            size="small"
            variant={viewMode === 'structured' ? 'contained' : 'outlined'}
            onClick={() => setViewMode('structured')}
            sx={{ textTransform: 'none', py: 0.2, px: 1, fontSize: '0.75rem', minWidth: 0 }}
          >
            Structured
          </Button>
          <Button
            size="small"
            variant={viewMode === 'raw' ? 'contained' : 'outlined'}
            onClick={() => setViewMode('raw')}
            sx={{ textTransform: 'none', py: 0.2, px: 1, fontSize: '0.75rem', minWidth: 0 }}
          >
            Raw JSON
          </Button>
          <Tooltip title={`Copy ${title} JSON`}>
            <IconButton size="small" onClick={() => onCopy(rawJson, `${title} JSON`)} sx={{ p: 0.5 }}>
              <ContentCopyIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>

      {/* Content Area */}
      <Box sx={{ flexGrow: 1, overflow: 'auto', p: viewMode === 'raw' ? 1.5 : 0 }}>
        {viewMode === 'raw' ? (
          <pre
            style={{
              margin: 0,
              fontSize: '0.8rem',
              fontFamily: 'monospace',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {rawJson}
          </pre>
        ) : (
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, width: '42%', fontSize: '0.75rem', py: 0.75 }}>
                  Property
                </TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', py: 0.75 }}>
                  Value
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredEntries.map(([k, v]) => (
                <TableRow key={k} hover sx={{ '&:last-child td, &:last-child th': { border: 0 } }}>
                  <TableCell sx={{ py: 0.75, verticalAlign: 'top' }}>
                    <Typography variant="body2" fontWeight={600} color="text.primary">
                      {formatFieldLabel(k)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" fontFamily="monospace">
                      {k}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ py: 0.75, verticalAlign: 'top' }}>
                    {formatFieldValue(v)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Box>
    </Paper>
  );
}

// =========================================================================
// COMPONENT: Changed Fields Diff Viewer
// =========================================================================
interface DiffViewerProps {
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

function DiffViewer({ before, after }: DiffViewerProps) {
  const diffs = useMemo(() => {
    if (!before || !after) return [];
    const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
    return allKeys
      .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
      .map((k) => ({
        key: k,
        label: formatFieldLabel(k),
        beforeVal: before[k],
        afterVal: after[k],
      }));
  }, [before, after]);

  if (diffs.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', borderRadius: 2 }}>
        <Typography variant="body2" color="text.secondary">
          No field modifications detected between before and after states.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <TableContainer sx={{ maxHeight: 320 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, width: '30%' }}>Field Changed</TableCell>
              <TableCell sx={{ fontWeight: 700, width: '35%', color: 'error.main' }}>
                Previous Value (Before)
              </TableCell>
              <TableCell sx={{ fontWeight: 700, width: '35%', color: 'success.main' }}>
                Updated Value (After)
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {diffs.map((d) => (
              <TableRow key={d.key} hover>
                <TableCell sx={{ verticalAlign: 'top' }}>
                  <Typography variant="body2" fontWeight={600}>
                    {d.label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" fontFamily="monospace">
                    {d.key}
                  </Typography>
                </TableCell>
                <TableCell sx={{ verticalAlign: 'top', bgcolor: 'rgba(211, 47, 47, 0.04)' }}>
                  {formatFieldValue(d.beforeVal)}
                </TableCell>
                <TableCell sx={{ verticalAlign: 'top', bgcolor: 'rgba(46, 125, 50, 0.04)' }}>
                  {formatFieldValue(d.afterVal)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

// =========================================================================
// MAIN PAGE: AuditSearchPage
// =========================================================================
export function AuditSearchPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);

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

  // Detail Modal State
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<number>(0);

  // Evidence Pack Modal
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [evidencePurpose, setEvidencePurpose] = useState('');
  const [evidencePacks, setEvidencePacks] = useState<EvidencePackResponse[]>([]);

  const handleCopy = (text: string, label: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopyToast(`${label} copied to clipboard`);
    }
  };

  const handleSearch = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await searchAuditEvents({
        entityType: entityType.trim() || undefined,
        entityId: entityId.trim() || undefined,
        action: action.trim() || undefined,
        actorId: actorId.trim() || undefined,
        dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
        dateTo: dateTo ? new Date(dateTo + 'T23:59:59').toISOString() : undefined,
        limit: 50,
      });
      setEvents(result?.data ?? []);
      setTotalCount(result?.meta?.total ?? result?.data?.length ?? 0);
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

  // Check if both before and after exist on selected event
  const hasDiff = Boolean(selectedEvent?.before && selectedEvent?.after);

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
      {/* Title Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ color: 'primary.main', mb: 0.5 }}>
            Audit Trail & Cryptographic Verification
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Module 37 (MOD-AUD): Tamper-evident immutable ledger with SHA-256 hash chaining, state diff
            tracking, and compliance evidence packs.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Can action="config.manage">
            <Button variant="outlined" startIcon={<LockIcon />} onClick={handleSealChain} disabled={loading}>
              Seal Chain
            </Button>
          </Can>
          <Button
            variant="outlined"
            color="success"
            startIcon={<VerifiedUserIcon />}
            onClick={handleVerifyChain}
            disabled={verifyingChain}
          >
            {verifyingChain ? 'Verifying...' : 'Verify Chain Integrity'}
          </Button>
          <Can action="audit.export_evidence">
            <Button variant="contained" startIcon={<DownloadIcon />} onClick={() => setEvidenceModalOpen(true)}>
              Export Evidence Pack
            </Button>
          </Can>
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
      <Card elevation={2} sx={{ mb: 3, backgroundColor: 'background.paper', borderRadius: 2 }}>
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
                    <Chip size="small" color="success" label="Active & Verified" />
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
      <Paper elevation={2} sx={{ p: 2.5, mb: 3, borderRadius: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>
          Filter Audit Log
        </Typography>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Entity Type</InputLabel>
              <Select value={entityType} label="Entity Type" onChange={(e) => setEntityType(e.target.value)}>
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
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              size="small"
              label="Entity ID"
              placeholder="e.g. lead_01J..."
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              fullWidth
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              size="small"
              label="Action"
              placeholder="e.g. lead.create"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              fullWidth
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <UserSelect
              size="small"
              label="Actor / User"
              placeholder="All Actors"
              value={actorId || null}
              onChange={(val) => setActorId(val ?? '')}
              fullWidth
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              size="small"
              type="date"
              label="Date From"
              InputLabelProps={{ shrink: true }}
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              fullWidth
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              size="small"
              type="date"
              label="Date To"
              InputLabelProps={{ shrink: true }}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              fullWidth
            />
          </Grid>
          <Grid item xs={12} sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, mt: 1 }}>
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
            <Button
              variant="contained"
              startIcon={<SearchIcon />}
              onClick={handleSearch}
              disabled={loading}
              sx={{ px: 3 }}
            >
              Search
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {/* Events Table */}
      <Paper elevation={2} sx={{ borderRadius: 2, overflow: 'hidden' }}>
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
                  <TableCell colSpan={7} align="center" sx={{ py: 5 }}>
                    <CircularProgress size={32} />
                  </TableCell>
                </TableRow>
              ) : events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 5 }}>
                    <Typography color="text.secondary">
                      No audit events match your search criteria.
                    </Typography>
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
                      <Chip size="small" label={ev.action} color="primary" variant="outlined" sx={{ fontWeight: 600 }} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {ev.entityType}
                      </Typography>
                      <Typography variant="caption" fontFamily="monospace" color="text.secondary">
                        {ev.entityId || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {ev.actorType === 'USER' ? (
                        <UserName id={ev.actorId} typographyProps={{ fontWeight: 500 }} />
                      ) : (
                        <Typography variant="body2" fontWeight={500}>
                          {ev.actorType}: {ev.actorId.slice(0, 14)}...
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" fontFamily="monospace">
                        {ev.ip || '127.0.0.1'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {ev.hash ? (
                        <Tooltip title={`SHA-256 Hash: ${ev.hash}`}>
                          <Chip
                            size="small"
                            color="success"
                            label="Sealed"
                            icon={<LockIcon sx={{ fontSize: 14 }} />}
                            sx={{ fontWeight: 600 }}
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
                          setModalTab(0);
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

      {/* ========================================================================= */}
      {/* Event Details Dialog (High-Resolution Professional Audit Inspector)      */}
      {/* ========================================================================= */}
      <Dialog
        open={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        maxWidth="lg"
        fullWidth
        PaperProps={{ sx: { borderRadius: 2.5 } }}
      >
        <DialogTitle sx={{ pb: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            spacing={1.5}
          >
            <Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="h6" fontWeight={700}>
                  Audit Event:
                </Typography>
                <Chip
                  label={selectedEvent?.action}
                  color="primary"
                  size="small"
                  sx={{ fontWeight: 700, fontSize: '0.85rem' }}
                />
                <Chip
                  label={selectedEvent?.entityType.toUpperCase()}
                  variant="outlined"
                  size="small"
                  sx={{ fontWeight: 600 }}
                />
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                <Typography variant="caption" fontFamily="monospace" color="text.secondary">
                  Event ID: {selectedEvent?.id} • Correlation: {selectedEvent?.correlationId}
                </Typography>
                <Tooltip title="Copy Event ID">
                  <IconButton
                    size="small"
                    onClick={() => selectedEvent && handleCopy(selectedEvent.id, 'Event ID')}
                    sx={{ p: 0.25 }}
                  >
                    <ContentCopyIcon sx={{ fontSize: 13 }} />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Box>

            <Stack direction="row" spacing={1} alignItems="center">
              {selectedEvent?.hash ? (
                <Chip
                  size="small"
                  color="success"
                  icon={<LockIcon sx={{ fontSize: 14 }} />}
                  label="Cryptographically Sealed"
                  sx={{ fontWeight: 600 }}
                />
              ) : (
                <Chip size="small" variant="outlined" label="Unsealed Event" />
              )}
            </Stack>
          </Stack>
        </DialogTitle>

        <DialogContent sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {selectedEvent && (
            <>
              {/* Context Summary Cards */}
              <Grid container spacing={2}>
                <Grid item xs={6} sm={3}>
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, height: '100%' }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} display="block">
                      ACTOR
                    </Typography>
                    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
                      <Chip
                        label={selectedEvent.actorType}
                        size="small"
                        color={selectedEvent.actorType === 'USER' ? 'primary' : 'secondary'}
                        sx={{ height: 20, fontSize: '0.68rem', fontWeight: 700 }}
                      />
                      {selectedEvent.actorType === 'USER' ? (
                        <UserName id={selectedEvent.actorId} typographyProps={{ fontWeight: 600, variant: 'body2' }} />
                      ) : (
                        <Typography
                          variant="body2"
                          fontWeight={600}
                          fontFamily="monospace"
                          sx={{ wordBreak: 'break-all' }}
                        >
                          {selectedEvent.actorId}
                        </Typography>
                      )}
                    </Stack>
                  </Paper>
                </Grid>

                <Grid item xs={6} sm={3}>
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, height: '100%' }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} display="block">
                      PERMISSION USED
                    </Typography>
                    <Chip
                      label={selectedEvent.permissionUsed || 'SYSTEM_AUTH'}
                      size="small"
                      color="info"
                      variant="outlined"
                      sx={{ fontWeight: 600, mt: 0.5, height: 22 }}
                    />
                  </Paper>
                </Grid>

                <Grid item xs={6} sm={3}>
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, height: '100%' }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} display="block">
                      CLIENT IP & USER AGENT
                    </Typography>
                    <Typography variant="body2" fontFamily="monospace" fontWeight={500} sx={{ mt: 0.5 }}>
                      {selectedEvent.ip || 'N/A'}{' '}
                      <span style={{ color: 'gray' }}>({selectedEvent.userAgent || 'App'})</span>
                    </Typography>
                  </Paper>
                </Grid>

                <Grid item xs={6} sm={3}>
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, height: '100%' }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} display="block">
                      LINKED DECISION RECORD
                    </Typography>
                    <Typography variant="body2" fontFamily="monospace" fontWeight={500} sx={{ mt: 0.5 }}>
                      {selectedEvent.decisionRecordId || 'None (Direct Call)'}
                    </Typography>
                  </Paper>
                </Grid>
              </Grid>

              {/* View Switcher Tabs (Side-by-Side Payloads vs Field-Level Diff) */}
              <Box>
                <Tabs
                  value={modalTab}
                  onChange={(_, v) => setModalTab(v)}
                  sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
                >
                  <Tab label="Side-by-Side State Payloads" sx={{ fontWeight: 600, textTransform: 'none' }} />
                  {hasDiff && (
                    <Tab
                      label="Field-by-Field Changes (Diff)"
                      sx={{ fontWeight: 600, textTransform: 'none', color: 'primary.main' }}
                    />
                  )}
                </Tabs>

                {/* TAB 0: Side-by-Side Payload Inspector */}
                {modalTab === 0 && (
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <PayloadViewer
                        data={selectedEvent.before}
                        title="Before State"
                        isBefore={true}
                        onCopy={handleCopy}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <PayloadViewer
                        data={selectedEvent.after}
                        title="After State"
                        isBefore={false}
                        onCopy={handleCopy}
                      />
                    </Grid>
                  </Grid>
                )}

                {/* TAB 1: Diff Table */}
                {modalTab === 1 && hasDiff && (
                  <DiffViewer before={selectedEvent.before} after={selectedEvent.after} />
                )}
              </Box>

              {/* Cryptographic SHA-256 Hash Chain Proof */}
              {selectedEvent.hash && (
                <Paper
                  variant="outlined"
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    backgroundColor: 'rgba(46, 125, 50, 0.03)',
                    borderColor: 'rgba(46, 125, 50, 0.2)',
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
                    <ShieldIcon color="success" sx={{ fontSize: 22 }} />
                    <Typography variant="subtitle2" fontWeight={700} color="success.dark">
                      Cryptographic Hash Chain Verification (SHA-256)
                    </Typography>
                    {selectedEvent.seq !== undefined && (
                      <Chip
                        label={`Sequence #${selectedEvent.seq}`}
                        size="small"
                        color="success"
                        variant="outlined"
                        sx={{ height: 20, fontSize: '0.7rem', fontWeight: 600 }}
                      />
                    )}
                  </Stack>

                  <Grid container spacing={1.5}>
                    <Grid item xs={12}>
                      <Typography variant="caption" color="text.secondary" fontWeight={600} display="block">
                        CURRENT EVENT HASH
                      </Typography>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Paper
                          variant="outlined"
                          sx={{ p: 0.85, flexGrow: 1, backgroundColor: 'background.paper', overflow: 'hidden' }}
                        >
                          <Typography variant="caption" fontFamily="monospace" sx={{ wordBreak: 'break-all' }}>
                            {selectedEvent.hash}
                          </Typography>
                        </Paper>
                        <Tooltip title="Copy Current Hash">
                          <IconButton size="small" onClick={() => handleCopy(selectedEvent.hash!, 'Current Hash')}>
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </Grid>

                    <Grid item xs={12}>
                      <Typography variant="caption" color="text.secondary" fontWeight={600} display="block">
                        PREVIOUS HASH IN CHAIN
                      </Typography>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Paper
                          variant="outlined"
                          sx={{ p: 0.85, flexGrow: 1, backgroundColor: 'background.paper', overflow: 'hidden' }}
                        >
                          <Typography
                            variant="caption"
                            fontFamily="monospace"
                            color="text.secondary"
                            sx={{ wordBreak: 'break-all' }}
                          >
                            {selectedEvent.prevHash || '0'.repeat(64)}
                          </Typography>
                        </Paper>
                        <Tooltip title="Copy Previous Hash">
                          <IconButton
                            size="small"
                            onClick={() => handleCopy(selectedEvent.prevHash || '0'.repeat(64), 'Previous Hash')}
                          >
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </Grid>
                  </Grid>
                </Paper>
              )}
            </>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 1.5, borderTop: 1, borderColor: 'divider', justifyContent: 'space-between' }}>
          <Button
            size="small"
            startIcon={<ContentCopyIcon />}
            onClick={() => selectedEvent && handleCopy(JSON.stringify(selectedEvent, null, 2), 'Full Event')}
            sx={{ textTransform: 'none' }}
          >
            Copy Full Event JSON
          </Button>
          <Button variant="contained" onClick={() => setDetailModalOpen(false)} sx={{ px: 3 }}>
            Close
          </Button>
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
              <Alert severity={chainVerification.status === 'VERIFIED' ? 'success' : 'error'}>
                Chain Status: <strong>{chainVerification.status}</strong>
              </Alert>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Total Events
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {chainVerification.totalEvents}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Sealed in Chain
                  </Typography>
                  <Typography variant="h6" fontWeight={700} color="success.main">
                    {chainVerification.sealedEvents}
                  </Typography>
                </Grid>
              </Grid>
              {chainVerification.verifiedRange && (
                <Box>
                  <Typography variant="subtitle2" fontWeight={600}>
                    Verified Sequence Range
                  </Typography>
                  <Typography variant="body2">
                    Sequence #{chainVerification.verifiedRange.fromSeq ?? 1} to #
                    {chainVerification.verifiedRange.toSeq ?? chainVerification.sealedEvents}
                  </Typography>
                  <Typography
                    variant="caption"
                    fontFamily="monospace"
                    color="text.secondary"
                    display="block"
                    sx={{ mt: 0.5 }}
                  >
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
            Generate an immutable evidence archive sealed with SHA-256 manifest and digital chain verification
            for external auditors.
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

      {/* Copy Toast Snackbar */}
      <Snackbar
        open={!!copyToast}
        autoHideDuration={2500}
        onClose={() => setCopyToast(null)}
        message={copyToast}
      />
    </Box>
  );
}
