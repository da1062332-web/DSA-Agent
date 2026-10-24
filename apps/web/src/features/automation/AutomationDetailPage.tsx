// apps/web/src/features/automation/AutomationDetailPage.tsx — owner: Akash (Module 24: Workflow Automation MOD-WFA)
import React, { useEffect, useState } from 'react';
import {
  Stack,
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
  Grid,
  Paper,
  Tab,
  Tabs,
  Typography,
  Alert,
  CircularProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import {
  ArrowBackIcon,
  PlayArrowIcon,
  CheckCircleIcon,
  CancelIcon,
  HourglassEmptyIcon,
} from '../../shell/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '../../ui';
import type { AutomationDefinition, AutomationVersion, StepDefinition } from '@dsa/contracts';
import {
  getAutomation,
  listAutomationVersions,
  createAutomationVersion,
  reviewAutomationVersion,
  updateAutomation,
} from './api';

export function AutomationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [definition, setDefinition] = useState<AutomationDefinition | null>(null);
  const [versions, setVersions] = useState<AutomationVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<AutomationVersion | null>(null);

  // Review Dialog
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewAction, setReviewAction] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [reviewReason, setReviewReason] = useState('');

  // New Version Dialog
  const [newVersionDialogOpen, setNewVersionDialogOpen] = useState(false);
  const [changeReason, setChangeReason] = useState('');

  const loadData = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [detailRes, versionsRes] = await Promise.all([getAutomation(id), listAutomationVersions(id)]);
      setDefinition(detailRes.definition);
      setVersions(versionsRes);
      setSelectedVersion(versionsRes[0] ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load automation details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  const handleReview = async () => {
    if (!id || !selectedVersion) return;
    try {
      setLoading(true);
      await reviewAutomationVersion(id, selectedVersion.id, {
        action: reviewAction,
        reason: reviewReason.trim() || undefined,
      });
      setSuccessMsg(`Version ${selectedVersion.versionNo} reviewed successfully: ${reviewAction}`);
      setReviewDialogOpen(false);
      setReviewReason('');
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Review action failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNewDraftVersion = async () => {
    if (!id || !selectedVersion) return;
    try {
      setLoading(true);
      const newVer = await createAutomationVersion(id, {
        triggerConfig: selectedVersion.triggerConfig,
        steps: selectedVersion.steps,
        changeReason: changeReason.trim() || 'Updated automation steps pipeline',
      });
      setSuccessMsg(`Draft Version ${newVer.versionNo} created.`);
      setNewVersionDialogOpen(false);
      setChangeReason('');
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create new version');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!definition || !id) return;
    // Statuses of an automation definition: DRAFT, ACTIVE, INACTIVE, ARCHIVED.
    const newStatus = definition.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      setLoading(true);
      const updated = await updateAutomation(id, { status: newStatus }, definition.lockVersion);
      setDefinition(updated);
      setSuccessMsg(`Rule status updated to ${newStatus}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to toggle status');
    } finally {
      setLoading(false);
    }
  };

  if (loading && !definition) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!definition) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Automation rule not found.</Alert>
      </Box>
    );
  }

  return (
    <Box>
      <PageHeader
        title={definition.name}
        backTo="/automations"
        badge={
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              label={definition.status}
              color={definition.status === 'ACTIVE' ? 'success' : definition.status === 'DRAFT' ? 'warning' : 'default'}
              size="small"
            />
            <Chip label={definition.entityType} variant="outlined" size="small" />
            <Chip label={definition.triggerType} color="primary" variant="outlined" size="small" />
          </Stack>
        }
        subtitle={
          <>
            <Typography variant="body2" fontFamily="monospace" color="text.secondary">
              Rule Code: <strong>{definition.code}</strong> | ID: {definition.id}
            </Typography>
            {definition.description && (
              <Typography variant="body2" color="text.secondary">
                {definition.description}
              </Typography>
            )}
          </>
        }
        actions={
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <Button
              variant="outlined"
              color={definition.status === 'ACTIVE' ? 'warning' : 'success'}
              onClick={handleToggleStatus}
            >
              {definition.status === 'ACTIVE' ? 'Disable Rule' : 'Activate Rule'}
            </Button>
            <Button variant="contained" onClick={() => setNewVersionDialogOpen(true)}>
              Draft New Version
            </Button>
          </Box>
        }
      />

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

      {/* Version Management & Pipeline View */}
      <Grid container spacing={3}>
        {/* Left: Version History Column */}
        <Grid item xs={12} md={4}>
          <Paper elevation={2} sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
              Rule Versions ({versions.length})
            </Typography>
            <List sx={{ width: '100%' }}>
              {versions.map((ver) => {
                const isSelected = selectedVersion?.id === ver.id;
                return (
                  <ListItem key={ver.id} disablePadding sx={{ mb: 1 }}>
                    <ListItemButton
                      selected={isSelected}
                      onClick={() => setSelectedVersion(ver)}
                      sx={{
                        borderRadius: 1,
                        border: isSelected ? '1px solid' : '1px solid transparent',
                        borderColor: isSelected ? 'primary.main' : 'divider',
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        {ver.status === 'ACTIVE' ? (
                          <CheckCircleIcon color="success" fontSize="small" />
                        ) : ver.status === 'DRAFT' || ver.status === 'PENDING_APPROVAL' ? (
                          <HourglassEmptyIcon color="warning" fontSize="small" />
                        ) : (
                          <CancelIcon color="disabled" fontSize="small" />
                        )}
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Box
                            sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                          >
                            <Typography variant="body2" fontWeight={600}>
                              Version {ver.versionNo}
                            </Typography>
                            <Chip size="small" label={ver.status} variant="outlined" />
                          </Box>
                        }
                        secondary={
                          <Typography variant="caption" color="text.secondary">
                            Created: {new Date(ver.createdAt).toLocaleDateString()}
                            {ver.authorId ? ` by ${ver.authorId.slice(0, 8)}...` : ''}
                          </Typography>
                        }
                      />
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
          </Paper>
        </Grid>

        {/* Right: Step Pipeline Designer View */}
        <Grid item xs={12} md={8}>
          <Paper elevation={2} sx={{ p: 3 }}>
            {selectedVersion ? (
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Box>
                    <Typography variant="h6" fontWeight={700}>
                      Version {selectedVersion.versionNo} Pipeline
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Content Hash: {selectedVersion.contentHash.slice(0, 16)}... | Steps:{' '}
                      {selectedVersion.steps.length}
                    </Typography>
                  </Box>

                  {/* Maker-Checker Actions */}
                  {(selectedVersion.status === 'DRAFT' || selectedVersion.status === 'PENDING_APPROVAL') && (
                    <Button variant="contained" color="primary" onClick={() => setReviewDialogOpen(true)}>
                      Review & Approve (Checker)
                    </Button>
                  )}
                </Box>

                <Divider sx={{ my: 2 }} />

                {/* Trigger Configuration Summary */}
                <Card variant="outlined" sx={{ mb: 3, backgroundColor: 'action.hover' }}>
                  <CardContent sx={{ py: 1.5 }}>
                    <Typography variant="subtitle2" fontWeight={600} color="primary.main">
                      Trigger Configuration
                    </Typography>
                    <Typography variant="body2">
                      Event Source:{' '}
                      <strong>{selectedVersion.triggerConfig.eventType ?? 'Scheduled / Manual'}</strong>
                    </Typography>
                    {selectedVersion.triggerConfig.filters &&
                      selectedVersion.triggerConfig.filters.length > 0 && (
                        <Typography
                          variant="caption"
                          fontFamily="monospace"
                          color="text.secondary"
                          display="block"
                        >
                          Filters:{' '}
                          {selectedVersion.triggerConfig.filters
                            .map((f) => `${f.field} ${f.op} ${JSON.stringify(f.value)}`)
                            .join(', ')}
                        </Typography>
                      )}
                  </CardContent>
                </Card>

                {/* Steps Pipeline Visualizer */}
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
                  Workflow Step Sequence
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {selectedVersion.steps.map((step, idx) => (
                    <Card key={step.id || idx} variant="outlined" sx={{ p: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Chip size="small" label={`Step ${idx + 1}`} color="primary" />
                          <Typography variant="body1" fontWeight={600}>
                            {step.name}
                          </Typography>
                          <Chip size="small" variant="outlined" label={step.type} />
                        </Box>
                        {step.isSkippable && (
                          <Chip size="small" color="secondary" label="Skippable" variant="outlined" />
                        )}
                      </Box>
                      <Box sx={{ mt: 1, pl: 4 }}>
                        <Typography variant="caption" color="text.secondary">
                          Step ID: <code>{step.id}</code> | Config: {JSON.stringify(step.config)}
                        </Typography>
                      </Box>
                    </Card>
                  ))}
                </Box>
              </Box>
            ) : (
              <Typography color="text.secondary">
                Select a version to inspect its execution pipeline.
              </Typography>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Review Dialog */}
      <Dialog open={reviewDialogOpen} onClose={() => setReviewDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Maker-Checker Version Review</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Reviewing Version {selectedVersion?.versionNo} for <strong>{definition.name}</strong>.
          </Typography>
          <FormControl fullWidth>
            <InputLabel>Review Decision</InputLabel>
            <Select
              value={reviewAction}
              label="Review Decision"
              onChange={(e) => setReviewAction(e.target.value as any)}
            >
              <MenuItem value="APPROVE">APPROVE (Publish to Active)</MenuItem>
              <MenuItem value="REJECT">REJECT (Send back with feedback)</MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Review Comments"
            placeholder="Audit explanation for approval or rejection..."
            value={reviewReason}
            onChange={(e) => setReviewReason(e.target.value)}
            multiline
            rows={3}
            fullWidth
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setReviewDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color={reviewAction === 'APPROVE' ? 'success' : 'error'}
            onClick={handleReview}
          >
            Submit Review
          </Button>
        </DialogActions>
      </Dialog>

      {/* Draft New Version Dialog */}
      <Dialog
        open={newVersionDialogOpen}
        onClose={() => setNewVersionDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Create New Draft Version</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <Typography variant="body2" color="text.secondary">
            A new version will be created based on Version {selectedVersion?.versionNo}.
          </Typography>
          <TextField
            label="Change Reason"
            placeholder="Why is a new version needed? (e.g. Added SMS notification step)"
            value={changeReason}
            onChange={(e) => setChangeReason(e.target.value)}
            multiline
            rows={3}
            fullWidth
            required
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setNewVersionDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!changeReason.trim() || loading}
            onClick={handleCreateNewDraftVersion}
          >
            Create Draft
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
