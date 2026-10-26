// apps/web/src/features/automation/AutomationDetailPage.tsx — owner: Akash (Module 24: Workflow Automation MOD-WFA)
import React, { useEffect, useState } from 'react';
import { validateRuleDetails, RULE_DESCRIPTION_MAX, RULE_NAME_MAX, RULE_NAME_MIN } from './create-rule';
import { useMe } from '../../api/useMe';
import { EDITABLE_STEP_TYPES, defaultTitle, newStep, toApiStep, validateSteps, withEndLast } from './step-editor';
import type { EditableStep, EditableStepType } from './step-editor';

// The events a rule can react to from this screen: lead, customer, task and application events.
const TRIGGER_EVENTS: { value: string; label: string }[] = [
  { value: 'lead.created', label: 'A new lead is created' },
  { value: 'lead.assigned', label: 'A lead is assigned to someone' },
  { value: 'lead.converted', label: 'A lead is converted to an application' },
  { value: 'customer.created', label: 'A new customer is created' },
  { value: 'task.created', label: 'A new task is created' },
  { value: 'task.completed', label: 'A task is completed' },
  { value: 'application.created', label: 'A new loan application is created' },
  { value: 'application.assigned', label: 'A loan application is assigned' },
];
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
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
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

  // Edit details dialog: name and description only. The code, trigger and subject belong to the versions.
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editShowErrors, setEditShowErrors] = useState(false);

  const me = useMe();
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
  const [draftEvent, setDraftEvent] = useState('lead.created');
  const [draftSteps, setDraftSteps] = useState<EditableStep[]>([]);
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [draftShowErrors, setDraftShowErrors] = useState(false);

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

  const openNewVersion = () => {
    const current = selectedVersion?.triggerConfig.eventType;
    setDraftEvent(TRIGGER_EVENTS.some((e) => e.value === current) ? (current as string) : 'lead.created');
    // Start from the steps of the version this draft is based on, when the editor can show every one of them.
    const sourceSteps = selectedVersion?.steps ?? [];
    const editable = sourceSteps.every((st) => EDITABLE_STEP_TYPES.some((t) => t.value === st.type));
    const starting: EditableStep[] = editable
      ? sourceSteps.map((st, i) => {
          const cfg = st.config as Record<string, unknown>;
          return {
            id: st.id || 'step_' + (i + 1),
            name: st.name,
            type: st.type as EditableStepType,
            title: String(cfg.title ?? ''),
            category: (cfg.category as EditableStep['category']) ?? 'LEAD',
            deepLink: String(cfg.deepLink ?? ''),
          };
        })
      : [];
    // Every rule finishes with End: add it if the version it started from did not have one.
    setDraftSteps(withEndLast(starting.length > 0 ? starting : [newStep('NOTIFY', []), newStep('END', [])]));
    setDraftShowErrors(false);
    setDraftErrors({});
    setNewVersionDialogOpen(true);
  };

  // Every change works on the list as shown (End always last), so the positions match the screen.
  const updateDraftStep = (index: number, patch: Partial<EditableStep>) =>
    setDraftSteps((prev) => withEndLast(prev).map((st, i) => (i === index ? { ...st, ...patch } : st)));

  const addDraftStep = (type: EditableStepType) =>
    setDraftSteps((prev) => {
      const current = withEndLast(prev);
      const step = newStep(type, current);
      const endAt = current.findIndex((st) => st.type === 'END');
      return [...current.slice(0, endAt), step, ...current.slice(endAt)];
    });

  const moveDraftStep = (index: number, by: number) =>
    setDraftSteps((prev) => {
      const current = withEndLast(prev);
      const target = index + by;
      // The End step never moves, and nothing moves past it.
      if (target < 0 || target >= current.length - 1 || current[index]?.type === 'END') return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });

  const removeDraftStep = (index: number) =>
    setDraftSteps((prev) => withEndLast(prev).filter((st, i) => i !== index || st.type === 'END'));

  const handleCreateNewDraftVersion = async () => {
    setDraftShowErrors(true);
    const finalSteps = withEndLast(draftSteps);
    const errors = validateSteps(finalSteps);
    setDraftErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (!id || !selectedVersion) return;
    try {
      setLoading(true);
      const newVer = await createAutomationVersion(id, {
        triggerConfig: { ...selectedVersion.triggerConfig, eventType: draftEvent as never },
        steps: finalSteps.map(toApiStep) as never,
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

  const editErrors = validateRuleDetails({ name: editName, description: editDescription });
  const editValid = Object.keys(editErrors).length === 0;

  const openEdit = () => {
    if (!definition) return;
    setEditName(definition.name);
    setEditDescription(definition.description ?? '');
    setEditError(null);
    setEditShowErrors(false);
    setEditOpen(true);
  };

  // Opened from the rules table with ?edit=1: show the edit dialog once the rule has loaded, then clear the flag.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (definition && searchParams.get('edit') === '1') {
      openEdit();
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition]);

  const handleSaveDetails = async () => {
    setEditShowErrors(true);
    if (!definition || !id || !editValid) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const updated = await updateAutomation(
        id,
        { name: editName.trim(), description: editDescription.trim() || null },
        definition.lockVersion,
      );
      setDefinition(updated);
      setEditOpen(false);
      setSuccessMsg('Rule details saved.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'The rule could not be saved.';
      setEditError(
        /changed by someone else/i.test(message)
          ? 'Someone else changed this rule while you were editing. Close this dialog, reload the page and try again.'
          : message,
      );
    } finally {
      setEditSaving(false);
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
        <Alert severity="error">{error ?? 'Automation rule not found.'}</Alert>
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
            <Button variant="outlined" onClick={openEdit}>
              Edit Details
            </Button>
            <Button
              variant="outlined"
              color={definition.status === 'ACTIVE' ? 'warning' : 'success'}
              onClick={handleToggleStatus}
              disabled={definition.status !== 'ACTIVE' && !definition.pinnedVersionId}
              title={definition.status !== 'ACTIVE' && !definition.pinnedVersionId ? 'Approve a version first: a rule can only run an approved version.' : undefined}
            >
              {definition.status === 'ACTIVE' ? 'Disable Rule' : 'Activate Rule'}
            </Button>
            <Button variant="contained" onClick={openNewVersion}>
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
                    <Stack spacing={0.5} alignItems="flex-end">
                      <Button
                        variant="contained"
                        color="primary"
                        disabled={!!me.data && selectedVersion.authorId === me.data.id}
                        onClick={() => setReviewDialogOpen(true)}
                      >
                        Review & Approve (Checker)
                      </Button>
                      {!!me.data && selectedVersion.authorId === me.data.id && (
                        <Typography variant="caption" color="text.secondary">
                          You wrote this version, so another person must approve it (maker-checker).
                        </Typography>
                      )}
                    </Stack>
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

      {/* Edit Details Dialog */}
      <Dialog open={editOpen} onClose={() => !editSaving && setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Rule Details</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <Alert severity="info">
            The rule code, trigger and subject are fixed for this rule. To change the trigger or the steps, use Draft
            New Version.
          </Alert>
          {editError && <Alert severity="error">{editError}</Alert>}
          <TextField
            label="Rule Name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            error={editShowErrors && !!editErrors.name}
            helperText={
              editShowErrors && editErrors.name ? editErrors.name : RULE_NAME_MIN + ' to ' + RULE_NAME_MAX + ' characters.'
            }
            fullWidth
            required
            inputProps={{ maxLength: RULE_NAME_MAX, 'data-testid': 'automation.edit.name' }}
          />
          <TextField
            label="Description"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            error={!!editErrors.description}
            helperText={editErrors.description ?? editDescription.length + ' / ' + RULE_DESCRIPTION_MAX}
            multiline
            rows={3}
            fullWidth
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditOpen(false)} disabled={editSaving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSaveDetails} disabled={editSaving} data-testid="automation.edit.save">
            {editSaving ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

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

      {/* Draft New Version Dialog: the event that starts the rule, and its steps */}
      <Dialog open={newVersionDialogOpen} onClose={() => setNewVersionDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>Create New Draft Version</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, py: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Based on Version {selectedVersion?.versionNo ?? '-'}. A different person must approve this draft before the rule can run.
          </Typography>

          <FormControl fullWidth size="small">
            <InputLabel>When should this rule run?</InputLabel>
            <Select
              value={draftEvent}
              label="When should this rule run?"
              onChange={(e) => setDraftEvent(e.target.value)}
              data-testid="automation.version.event"
            >
              {TRIGGER_EVENTS.map((ev) => (
                <MenuItem key={ev.value} value={ev.value}>
                  {ev.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Typography variant="subtitle2" fontWeight={700}>
            What happens, in order
          </Typography>
          {draftErrors[''] && (
            <Alert severity="warning" sx={{ py: 0 }}>
              {draftErrors['']}
            </Alert>
          )}

          {withEndLast(draftSteps).map((st, i) =>
            st.type === 'END' ? (
              <Box
                key={st.id}
                data-testid="automation.version.step"
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1, borderRadius: 1, bgcolor: 'action.hover' }}
              >
                <Chip size="small" label={'Step ' + (i + 1)} />
                <Typography variant="body2" fontWeight={600}>
                  End the run
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Always the last step. Nothing runs after it.
                </Typography>
              </Box>
            ) : (
              <Box
                key={st.id}
                data-testid="automation.version.step"
                sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip size="small" color="primary" label={'Step ' + (i + 1)} />
                  <FormControl size="small" sx={{ minWidth: 200 }}>
                    <Select
                      value={st.type}
                      onChange={(e) => {
                        const type = e.target.value as EditableStepType;
                        // Keep the text the person typed; otherwise start from the default text for the new type.
                        const keep = st.title && st.title !== defaultTitle(st.type);
                        updateDraftStep(i, {
                          type,
                          name: EDITABLE_STEP_TYPES.find((t) => t.value === type)?.label ?? type,
                          title: keep ? st.title : defaultTitle(type),
                        });
                      }}
                    >
                      {EDITABLE_STEP_TYPES.filter((t) => t.value !== 'END').map((t) => (
                        <MenuItem key={t.value} value={t.value}>
                          {t.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Box sx={{ flex: 1 }} />
                  <Button size="small" disabled={i === 0} onClick={() => moveDraftStep(i, -1)} aria-label="Move step up">
                    Up
                  </Button>
                  <Button
                    size="small"
                    disabled={i >= withEndLast(draftSteps).length - 2}
                    onClick={() => moveDraftStep(i, 1)}
                    aria-label="Move step down"
                  >
                    Down
                  </Button>
                  <Button size="small" color="error" onClick={() => removeDraftStep(i)} aria-label="Remove step">
                    Remove
                  </Button>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {EDITABLE_STEP_TYPES.find((t) => t.value === st.type)?.help}
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <TextField
                    label={st.type === 'NOTIFY' ? 'Message shown in the bell' : 'Task title'}
                    value={st.title}
                    onChange={(e) => updateDraftStep(i, { title: e.target.value })}
                    error={draftShowErrors && !!draftErrors[st.id]}
                    helperText={draftShowErrors && draftErrors[st.id] ? draftErrors[st.id] : ' '}
                    size="small"
                    fullWidth={st.type !== 'NOTIFY'}
                    sx={{ flex: 2 }}
                  />
                  {st.type === 'NOTIFY' && (
                    <TextField
                      label="Opens this page (optional)"
                      value={st.deepLink}
                      onChange={(e) => updateDraftStep(i, { deepLink: e.target.value })}
                      placeholder="/leads"
                      size="small"
                      sx={{ flex: 1 }}
                    />
                  )}
                </Stack>
              </Box>
            ),
          )}

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {EDITABLE_STEP_TYPES.filter((t) => t.value !== 'END').map((t) => (
              <Button key={t.value} size="small" variant="outlined" onClick={() => addDraftStep(t.value)}>
                + Add: {t.label.toLowerCase()}
              </Button>
            ))}
          </Stack>

          <TextField
            label="Why is this version needed?"
            placeholder="e.g. First version: remind the owner to call new leads"
            value={changeReason}
            onChange={(e) => setChangeReason(e.target.value)}
            size="small"
            fullWidth
            required
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Button onClick={() => setNewVersionDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!changeReason.trim() || loading}
            onClick={handleCreateNewDraftVersion}
            data-testid="automation.version.save"
          >
            Create Draft
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
