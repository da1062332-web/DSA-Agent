// apps/web/src/features/rules/RuleVersionDetailPage.tsx — owner: Developer 6 (Module 23: Business Rule Engine)
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Can } from '../../shell/Can';
import {
  fetchRuleSetVersion,
  publishVersion,
  reinstateVersion,
  reviewVersion,
  simulateRuleSetVersion,
  submitVersion,
  suspendVersion,
  updateRuleSetVersion,
  validateRuleSetVersion,
} from './api';
import type {
  HitPolicy,
  RuleSetDefinition,
  RuleSetVersionResponse,
  SimulationResponse,
  ValidationReportResponse,
  VersionStatus,
} from './types';

function getStatusColor(
  status: VersionStatus,
): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'APPROVED':
      return 'primary';
    case 'IN_REVIEW':
      return 'warning';
    case 'SCHEDULED':
      return 'info';
    case 'SUSPENDED':
      return 'error';
    case 'SUPERSEDED':
    case 'RETIRED':
    case 'ABANDONED':
      return 'default';
    case 'DRAFT':
    default:
      return 'secondary';
  }
}

export function RuleVersionDetailPage() {
  const { versionId } = useParams<{ versionId: string }>();
  const navigate = useNavigate();

  const [version, setVersion] = useState<RuleSetVersionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Draft editor state
  const [definitionJson, setDefinitionJson] = useState('');
  const [hitPolicy, setHitPolicy] = useState<HitPolicy>('FIRST');
  const [changeReason, setChangeReason] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);

  // Validation report state
  const [validationReport, setValidationReport] = useState<ValidationReportResponse | null>(null);
  const [validating, setValidating] = useState(false);

  // Simulation state
  const [simOpen, setSimOpen] = useState(false);
  const [simFactsJson, setSimFactsJson] = useState('{\n  "lead": {\n    "branch_id": "br_mumbai"\n  }\n}');
  const [simRunning, setSimRunning] = useState(false);
  const [simResult, setSimResult] = useState<SimulationResponse | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

  // Lifecycle modals
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitReason, setSubmitReason] = useState('');

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewAction, setReviewAction] = useState<'APPROVE' | 'REJECT' | 'REQUEST_CHANGES'>('APPROVE');
  const [reviewSeat, setReviewSeat] = useState<
    'RULE_APPROVER' | 'RISK_OFFICER' | 'COMPLIANCE' | 'SUPER_ADMIN'
  >('RULE_APPROVER');
  const [reviewComment, setReviewComment] = useState('');

  const [publishOpen, setPublishOpen] = useState(false);
  const [publishReason, setPublishReason] = useState('');
  const [publishEffFrom, setPublishEffFrom] = useState('');

  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');

  const [reinstateOpen, setReinstateOpen] = useState(false);
  const [reinstateReason, setReinstateReason] = useState('');

  const [actionLoading, setActionLoading] = useState(false);

  const loadVersion = useCallback(async () => {
    if (!versionId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetchRuleSetVersion(versionId);
      const v = (res as any)?.data?.data ?? res.data ?? res;
      setVersion(v);
      setHitPolicy(v.hitPolicy);
      setDefinitionJson(JSON.stringify(v.definition, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rule version');
    } finally {
      setLoading(false);
    }
  }, [versionId]);

  useEffect(() => {
    loadVersion();
  }, [loadVersion]);

  // Save draft
  const handleSaveDraft = async () => {
    if (!version) return;
    try {
      setSavingDraft(true);
      setError(null);
      setSuccessMsg(null);
      let parsed: RuleSetDefinition;
      try {
        parsed = JSON.parse(definitionJson);
      } catch {
        throw new Error('Definition is not valid JSON.');
      }

      const res = await updateRuleSetVersion(
        version.id,
        {
          definition: parsed,
          hitPolicy,
          changeReason: changeReason.trim() || undefined,
        },
        version.lockVersion,
      );

      setVersion(res.data);
      setValidationReport(null); // invalidates stale validation
      setSuccessMsg('Draft definition updated successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft');
    } finally {
      setSavingDraft(false);
    }
  };

  // Run validation
  const handleValidate = async () => {
    if (!version) return;
    try {
      setValidating(true);
      setError(null);
      const rep = await validateRuleSetVersion(version.id);
      setValidationReport(rep);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setValidating(false);
    }
  };

  // Run simulation
  const handleSimulate = async () => {
    if (!version) return;
    try {
      setSimRunning(true);
      setSimError(null);
      let facts: Record<string, unknown> = {};
      try {
        facts = JSON.parse(simFactsJson);
      } catch {
        throw new Error('Invalid JSON facts format.');
      }
      const res = await simulateRuleSetVersion(version.id, { facts });
      setSimResult((res as any)?.data ?? res);
    } catch (err) {
      setSimError(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setSimRunning(false);
    }
  };

  // Submit version
  const handleSubmit = async () => {
    if (!version) return;
    try {
      setActionLoading(true);
      setError(null);
      await submitVersion(version.id, { changeReason: submitReason.trim() || 'Ready for compliance review' });
      setSubmitOpen(false);
      loadVersion();
      setSuccessMsg('Version successfully submitted for review.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setActionLoading(false);
    }
  };

  // Review version
  const handleReview = async () => {
    if (!version) return;
    try {
      setActionLoading(true);
      setError(null);
      await reviewVersion(version.id, {
        seat: reviewSeat,
        action: reviewAction,
        comment: reviewComment.trim() || 'Reviewed',
        reviewedContentHash: version.contentHash,
      });
      setReviewOpen(false);
      loadVersion();
      setSuccessMsg(`Version review completed: ${reviewAction}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review action failed');
    } finally {
      setActionLoading(false);
    }
  };

  // Publish version
  const handlePublish = async () => {
    if (!version) return;
    try {
      setActionLoading(true);
      setError(null);
      await publishVersion(version.id, {
        reason: publishReason.trim() || 'Production release',
        effectiveFrom: publishEffFrom || undefined,
      });
      setPublishOpen(false);
      loadVersion();
      setSuccessMsg('Version published to ACTIVE status.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setActionLoading(false);
    }
  };

  // Suspend version
  const handleSuspend = async () => {
    if (!version) return;
    try {
      setActionLoading(true);
      setError(null);
      await suspendVersion(version.id, {
        suspendReason: suspendReason.trim() || 'Emergency stop requested',
      });
      setSuspendOpen(false);
      loadVersion();
      setSuccessMsg('Version successfully suspended.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suspension failed');
    } finally {
      setActionLoading(false);
    }
  };

  // Reinstate version
  const handleReinstate = async () => {
    if (!version) return;
    try {
      setActionLoading(true);
      setError(null);
      await reinstateVersion(version.id, {
        reason: reinstateReason.trim() || 'Independent review completed; reinstated',
      });
      setReinstateOpen(false);
      loadVersion();
      setSuccessMsg('Version reinstated to ACTIVE status.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reinstatement failed');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ py: 8, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (error && !version) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Alert severity="error">{error}</Alert>
        <Button sx={{ mt: 2 }} onClick={() => navigate('/rules')}>
          Back to Rule Sets
        </Button>
      </Container>
    );
  }

  if (!version) return null;

  const isDraft = version.status === 'DRAFT';
  const isReview = version.status === 'IN_REVIEW';
  const isApproved = version.status === 'APPROVED';
  const isActive = version.status === 'ACTIVE';
  const isSuspended = version.status === 'SUSPENDED';

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={3}>
        <Box>
          <Button size="small" onClick={() => navigate(`/rules/${version.ruleSetId}`)} sx={{ mb: 1 }}>
            ← Back to Rule Set
          </Button>
          <Stack direction="row" spacing={2} alignItems="center">
            <Typography variant="h4" fontWeight={700}>
              Version {version.versionNo}
            </Typography>
            <Chip size="medium" label={version.status} color={getStatusColor(version.status)} />
            <Chip size="medium" label={`Hit Policy: ${version.hitPolicy}`} variant="outlined" />
          </Stack>
          <Typography variant="caption" color="text.secondary" fontFamily="monospace">
            ID: {version.id} | Hash: {version.contentHash}
          </Typography>
        </Box>

        {/* Action Toolbar */}
        <Stack direction="row" spacing={1.5} flexWrap="wrap">
          <Can action="rule.simulate">
            <Button variant="outlined" onClick={() => setSimOpen(true)}>
              Simulate / Test
            </Button>
          </Can>
          <Button variant="outlined" onClick={handleValidate} disabled={validating}>
            {validating ? 'Validating...' : 'Validate'}
          </Button>

          {isDraft && (
            <Can action="rule.author">
              <Button
                variant="contained"
                color="primary"
                onClick={() => setSubmitOpen(true)}
                disabled={!validationReport || validationReport.result !== 'PASS'}
              >
                Submit for Review
              </Button>
            </Can>
          )}

          {isReview && (
            <Can action="rule.approve">
              <Button variant="contained" color="warning" onClick={() => setReviewOpen(true)}>
                Review / Approve (SOD-01)
              </Button>
            </Can>
          )}

          {isApproved && (
            <Can action="rule.publish">
              <Button variant="contained" color="success" onClick={() => setPublishOpen(true)}>
                Publish to Production
              </Button>
            </Can>
          )}

          {isActive && (
            <Can action="rule.suspend">
              <Button variant="contained" color="error" onClick={() => setSuspendOpen(true)}>
                Emergency Suspend
              </Button>
            </Can>
          )}

          {isSuspended && (
            <Can action="rule.publish">
              <Button variant="contained" color="primary" onClick={() => setReinstateOpen(true)}>
                Reinstate Version
              </Button>
            </Can>
          )}
        </Stack>
      </Stack>

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

      {/* Validation Report Banner */}
      {validationReport && (
        <Alert severity={validationReport.result === 'PASS' ? 'success' : 'error'} sx={{ mb: 3 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            Validation Status: {validationReport.result} (Content Hash:{' '}
            {validationReport.contentHash.slice(0, 16)}...)
          </Typography>
          {validationReport.issues.length === 0 ? (
            <Typography variant="body2">No syntax, complexity, or reachability issues detected.</Typography>
          ) : (
            <Box mt={1}>
              {validationReport.issues.map((iss, i) => (
                <Typography key={i} variant="caption" display="block">
                  [{iss.severity}] {iss.code}: {iss.message} {iss.ruleUid ? `(Rule: ${iss.ruleUid})` : ''}
                </Typography>
              ))}
            </Box>
          )}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Left: Definition & Editor */}
        <Grid item xs={12} md={7}>
          <Card variant="outlined">
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6" fontWeight={600}>
                  {isDraft ? 'Draft Rule Definition' : 'Locked Rule Definition (Read-Only)'}
                </Typography>
                {isDraft && (
                  <Can action="rule.author">
                    <Button variant="contained" size="small" onClick={handleSaveDraft} disabled={savingDraft}>
                      {savingDraft ? 'Saving...' : 'Save Draft'}
                    </Button>
                  </Can>
                )}
              </Stack>

              {isDraft && (
                <Grid container spacing={2} mb={2}>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel id="edit-hit-policy-label">Hit Policy</InputLabel>
                      <Select
                        labelId="edit-hit-policy-label"
                        value={hitPolicy}
                        label="Hit Policy"
                        onChange={(e) => setHitPolicy(e.target.value as HitPolicy)}
                      >
                        <MenuItem value="UNIQUE">UNIQUE</MenuItem>
                        <MenuItem value="FIRST">FIRST</MenuItem>
                        <MenuItem value="PRIORITY">PRIORITY</MenuItem>
                        <MenuItem value="COLLECT">COLLECT</MenuItem>
                        <MenuItem value="RULE_ORDER">RULE_ORDER</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Change Reason"
                      value={changeReason}
                      onChange={(e) => setChangeReason(e.target.value)}
                      placeholder="Reason for this revision"
                    />
                  </Grid>
                </Grid>
              )}

              <TextField
                fullWidth
                multiline
                rows={20}
                value={definitionJson}
                onChange={(e) => isDraft && setDefinitionJson(e.target.value)}
                disabled={!isDraft}
                sx={{
                  fontFamily: 'monospace',
                  '& textarea': { fontFamily: 'Consolas, monospace', fontSize: '0.875rem' },
                }}
                helperText={
                  isDraft
                    ? 'JSON AST Definition containing rules array, condition trees, and actions.'
                    : 'Immutable after leaving DRAFT state.'
                }
              />
            </CardContent>
          </Card>
        </Grid>

        {/* Right: Rules Overview & Metadata */}
        <Grid item xs={12} md={5}>
          <Card variant="outlined" sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" fontWeight={600} mb={2}>
                Rules Inspection ({version.definition?.rules?.length ?? 0} rules)
              </Typography>
              {version.definition?.rules?.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No rules defined in this version.
                </Typography>
              ) : (
                <Stack spacing={1.5}>
                  {version.definition?.rules?.map((r, i) => (
                    <Paper key={r.uid} variant="outlined" sx={{ p: 1.5 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="subtitle2" fontWeight={600}>
                          #{i + 1}: {r.name}
                        </Typography>
                        <Chip
                          size="small"
                          label={r.enabled ? 'Enabled' : 'Disabled'}
                          color={r.enabled ? 'success' : 'default'}
                        />
                      </Stack>
                      <Typography
                        variant="caption"
                        fontFamily="monospace"
                        color="text.secondary"
                        display="block"
                      >
                        UID: {r.uid} {r.orderNo !== undefined ? `| Order: ${r.orderNo}` : ''}{' '}
                        {r.priority !== undefined ? `| Priority: ${r.priority}` : ''}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                        Outputs: {JSON.stringify(r.output)}
                      </Typography>
                    </Paper>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>

          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                Version Audit & Lineage
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                Created By: {version.createdBy}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                Editors: {(version.editors || []).join(', ')}
              </Typography>
              {version.submittedBy && (
                <Typography variant="caption" color="text.secondary" display="block">
                  Submitted By: {version.submittedBy}
                </Typography>
              )}
              {version.publishedBy && (
                <Typography variant="caption" color="text.secondary" display="block">
                  Published By: {version.publishedBy}
                </Typography>
              )}
              {version.suspendedBy && (
                <Typography variant="caption" color="error" display="block">
                  Suspended By: {version.suspendedBy} (Reason: {version.suspendReason})
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Simulation Dialog */}
      <Dialog open={simOpen} onClose={() => setSimOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Safe Rule Simulation Environment</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {simError && <Alert severity="error">{simError}</Alert>}
            <Typography variant="body2" color="text.secondary">
              Evaluate this rule version against synthetic business inputs without modifying live customer or
              lead records.
            </Typography>
            <TextField
              label="Synthetic Facts (JSON)"
              fullWidth
              multiline
              rows={6}
              value={simFactsJson}
              onChange={(e) => setSimFactsJson(e.target.value)}
              sx={{ '& textarea': { fontFamily: 'Consolas, monospace', fontSize: '0.875rem' } }}
            />
            <Button variant="contained" onClick={handleSimulate} disabled={simRunning}>
              {simRunning ? 'Evaluating...' : 'Run Simulation'}
            </Button>

            {simResult && (
              <Box mt={2}>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="subtitle1" fontWeight={700}>
                  Simulation Outcome: {simResult.status}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  Duration: {simResult.summary.durationUs} µs | Fallback Applied:{' '}
                  {simResult.summary.fallbackApplied ? 'YES' : 'NO'}
                </Typography>
                <Box mt={1}>
                  <Typography variant="subtitle2">Matched Rules:</Typography>
                  {simResult.summary.matchedRuleUids.length === 0 ? (
                    <Typography variant="caption" color="text.secondary">
                      No rules matched the synthetic input.
                    </Typography>
                  ) : (
                    simResult.summary.matchedRuleUids.map((uid) => (
                      <Chip key={uid} label={uid} size="small" sx={{ mr: 0.5, mt: 0.5 }} color="primary" />
                    ))
                  )}
                </Box>
                <Box mt={2}>
                  <Typography variant="subtitle2">Outputs:</Typography>
                  <Paper sx={{ p: 1.5, bgcolor: '#f8f9fa' }}>
                    <Typography variant="caption" component="pre" sx={{ m: 0 }}>
                      {JSON.stringify(simResult.summary.outputs, null, 2)}
                    </Typography>
                  </Paper>
                </Box>
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSimOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Submit for Review Dialog */}
      <Dialog
        open={submitOpen}
        onClose={() => !actionLoading && setSubmitOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Submit Version for Review</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} pt={1}>
            <Typography variant="body2" color="text.secondary">
              Submitting freezes the rule draft into IN_REVIEW state for compliance and maker-checker
              approval.
            </Typography>
            <TextField
              label="Submission Notes"
              fullWidth
              value={submitReason}
              onChange={(e) => setSubmitReason(e.target.value)}
              placeholder="e.g. Validation passed, ready for risk approval"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSubmitOpen(false)} disabled={actionLoading}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={actionLoading}
            data-testid="rules.confirm-submit-version"
          >
            {actionLoading ? 'Submitting...' : 'Submit Version'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Review / Approve Dialog */}
      <Dialog
        open={reviewOpen}
        onClose={() => !actionLoading && setReviewOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Independent Maker-Checker Review (SOD-01)</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} pt={1}>
            <Alert severity="info">
              Per SOD-01 separation of duties, authors and editors of this rule version cannot approve their
              own version.
            </Alert>
            <FormControl fullWidth>
              <InputLabel id="review-action-label">Review Action</InputLabel>
              <Select
                labelId="review-action-label"
                value={reviewAction}
                label="Review Action"
                onChange={(e) => setReviewAction(e.target.value as 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES')}
              >
                <MenuItem value="APPROVE">APPROVE</MenuItem>
                <MenuItem value="REJECT">REJECT</MenuItem>
                <MenuItem value="REQUEST_CHANGES">REQUEST_CHANGES</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel id="review-seat-label">Approval Seat</InputLabel>
              <Select
                labelId="review-seat-label"
                value={reviewSeat}
                label="Approval Seat"
                onChange={(e) =>
                  setReviewSeat(
                    e.target.value as 'RULE_APPROVER' | 'RISK_OFFICER' | 'COMPLIANCE' | 'SUPER_ADMIN',
                  )
                }
              >
                <MenuItem value="RULE_APPROVER">RULE_APPROVER</MenuItem>
                <MenuItem value="RISK_OFFICER">RISK_OFFICER</MenuItem>
                <MenuItem value="COMPLIANCE">COMPLIANCE</MenuItem>
                <MenuItem value="SUPER_ADMIN">SUPER_ADMIN</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Reviewer Comments"
              fullWidth
              required
              multiline
              rows={2}
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              placeholder="e.g. Approved against regulatory compliance guidelines"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReviewOpen(false)} disabled={actionLoading}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color={reviewAction === 'APPROVE' ? 'success' : 'error'}
            onClick={handleReview}
            disabled={actionLoading}
          >
            {actionLoading ? 'Recording...' : `Confirm ${reviewAction}`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Publish Dialog */}
      <Dialog
        open={publishOpen}
        onClose={() => !actionLoading && setPublishOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Publish Rule Version to Production</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} pt={1}>
            <Alert severity="warning">
              Publishing will make this version ACTIVE. Any currently active version in this rule set will be
              transitioned to SUPERSEDED.
            </Alert>
            <TextField
              label="Publication Reason"
              fullWidth
              required
              value={publishReason}
              onChange={(e) => setPublishReason(e.target.value)}
              placeholder="e.g. Production launch of Q4 underwriting policies"
            />
            <TextField
              label="Effective From (optional, ISO Timestamp)"
              fullWidth
              value={publishEffFrom}
              onChange={(e) => setPublishEffFrom(e.target.value)}
              placeholder="e.g. Leave blank for immediate activation"
              helperText="Set a future date to transition into SCHEDULED status"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPublishOpen(false)} disabled={actionLoading}>
            Cancel
          </Button>
          <Button variant="contained" color="success" onClick={handlePublish} disabled={actionLoading}>
            {actionLoading ? 'Publishing...' : 'Publish to Production'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Suspend Dialog */}
      <Dialog
        open={suspendOpen}
        onClose={() => !actionLoading && setSuspendOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Emergency Suspend Rule Version</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} pt={1}>
            <Alert severity="error">
              Suspends evaluation of this rule version. Fallback behavior configured on the decision
              definition will be used.
            </Alert>
            <TextField
              label="Suspension Reason"
              fullWidth
              required
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="e.g. Anomaly detected in lead assignment throughput"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSuspendOpen(false)} disabled={actionLoading}>
            Cancel
          </Button>
          <Button variant="contained" color="error" onClick={handleSuspend} disabled={actionLoading}>
            {actionLoading ? 'Suspending...' : 'Confirm Suspension'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reinstate Dialog */}
      <Dialog
        open={reinstateOpen}
        onClose={() => !actionLoading && setReinstateOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Reinstate Suspended Version</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} pt={1}>
            <Alert severity="info">
              Per separation of duties, the user who suspended this rule version cannot reinstate it.
            </Alert>
            <TextField
              label="Reinstatement Justification"
              fullWidth
              required
              value={reinstateReason}
              onChange={(e) => setReinstateReason(e.target.value)}
              placeholder="e.g. Investigation completed and confirmed safe"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReinstateOpen(false)} disabled={actionLoading}>
            Cancel
          </Button>
          <Button variant="contained" color="primary" onClick={handleReinstate} disabled={actionLoading}>
            {actionLoading ? 'Reinstating...' : 'Confirm Reinstate'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
