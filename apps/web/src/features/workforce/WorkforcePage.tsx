// apps/web/src/features/workforce/WorkforcePage.tsx — Module 26: Workforce (MOD-WRK) UI
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { hasPermission, useMe } from '../../api/useMe';
import {
  checkIn,
  checkOut,
  createDelegation,
  endDelegation,
  getAgents,
  getAttendance,
  getDelegations,
  getMyTodayAttendance,
  updateAgentCapacity,
  updateMyAvailability,
} from './api';
import type {
  AgentWorkforceSummary,
  AvailabilityStatus,
  CreateDelegationInput,
  DelegationRecord,
} from './types';

const AVAILABILITY_CONFIG: Record<
  AvailabilityStatus,
  { label: string; color: 'success' | 'warning' | 'default' | 'info'; bg: string }
> = {
  AVAILABLE: { label: 'Available', color: 'success', bg: '#ecfdf5' },
  BUSY: { label: 'Busy', color: 'warning', bg: '#fffbeb' },
  OFF_DUTY: { label: 'Off Duty', color: 'default', bg: '#f1f5f9' },
  ON_LEAVE: { label: 'On Leave', color: 'info', bg: '#eff6ff' },
};

export function WorkforcePage() {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const canManageUsers = hasPermission(me, 'user.manage') || hasPermission(me, 'config.manage');
  const canManageAttendance =
    hasPermission(me, 'attendance.manage') || hasPermission(me, 'user.manage') || hasPermission(me, 'config.manage');

  const [activeTab, setActiveTab] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Capacity edit state
  const [editingAgent, setEditingAgent] = useState<AgentWorkforceSummary | null>(null);
  const [editCapacityVal, setEditCapacityVal] = useState<number>(10);

  // Delegation modal state
  const [isDelegationOpen, setIsDelegationOpen] = useState<boolean>(false);
  const [delegatorId, setDelegatorId] = useState<string>('');
  const [delegateId, setDelegateId] = useState<string>('');
  const [startsAtDate, setStartsAtDate] = useState<string>('');
  const [endsAtDate, setEndsAtDate] = useState<string>('');
  const [delegationReason, setDelegationReason] = useState<string>('');
  const [delegationError, setDelegationError] = useState<string | null>(null);

  // Attendance note state
  const [attendanceNote, setAttendanceNote] = useState<string>('');

  // 1. Queries
  const agentsQuery = useQuery({
    queryKey: ['workforce-agents'],
    queryFn: () => getAgents(),
  });

  const delegationsQuery = useQuery({
    queryKey: ['workforce-delegations'],
    queryFn: () => getDelegations(),
  });

  const myAttendanceQuery = useQuery({
    queryKey: ['workforce-my-attendance-today'],
    queryFn: () => getMyTodayAttendance(),
  });

  const attendanceLogQuery = useQuery({
    queryKey: ['workforce-attendance-log'],
    queryFn: () => getAttendance(),
  });

  // Current user's availability from agentsQuery or fallback
  const myAgentRecord = agentsQuery.data?.find((a) => a.id === me?.id);
  const currentAvailability: AvailabilityStatus =
    myAgentRecord?.availability ?? 'AVAILABLE';

  // 2. Mutations
  const availabilityMutation = useMutation({
    mutationFn: (newStatus: AvailabilityStatus) => updateMyAvailability(newStatus),
    onSuccess: (_, newStatus) => {
      queryClient.invalidateQueries({ queryKey: ['workforce-agents'] });
      setToastMessage({ type: 'success', text: `Availability set to ${AVAILABILITY_CONFIG[newStatus].label}` });
    },
    onError: (err: any) => {
      setToastMessage({ type: 'error', text: err?.message || 'Failed to update availability.' });
    },
  });

  const capacityMutation = useMutation({
    mutationFn: ({ agentId, capacity }: { agentId: string; capacity: number }) =>
      updateAgentCapacity(agentId, capacity),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workforce-agents'] });
      setEditingAgent(null);
      setToastMessage({ type: 'success', text: 'Capacity limit updated successfully.' });
    },
    onError: (err: any) => {
      setToastMessage({ type: 'error', text: err?.message || 'Failed to update capacity limit.' });
    },
  });

  const createDelegationMutation = useMutation({
    mutationFn: (input: CreateDelegationInput) => createDelegation(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workforce-delegations'] });
      setIsDelegationOpen(false);
      setDelegationReason('');
      setDelegationError(null);
      setToastMessage({ type: 'success', text: 'Leave coverage delegation created successfully.' });
    },
    onError: (err: any) => {
      setDelegationError(err?.message || 'Failed to create delegation. Overlapping ranges are excluded.');
    },
  });

  const endDelegationMutation = useMutation({
    mutationFn: (id: string) => endDelegation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workforce-delegations'] });
      setToastMessage({ type: 'success', text: 'Leave delegation ended.' });
    },
    onError: (err: any) => {
      setToastMessage({ type: 'error', text: err?.message || 'Failed to end delegation.' });
    },
  });

  const checkInMutation = useMutation({
    mutationFn: (notes?: string) => checkIn(notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workforce-my-attendance-today'] });
      queryClient.invalidateQueries({ queryKey: ['workforce-attendance-log'] });
      setAttendanceNote('');
      setToastMessage({ type: 'success', text: 'Checked in successfully.' });
    },
    onError: (err: any) => {
      setToastMessage({ type: 'error', text: err?.message || 'Failed to check in.' });
    },
  });

  const checkOutMutation = useMutation({
    mutationFn: (notes?: string) => checkOut(notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workforce-my-attendance-today'] });
      queryClient.invalidateQueries({ queryKey: ['workforce-attendance-log'] });
      setAttendanceNote('');
      setToastMessage({ type: 'success', text: 'Checked out successfully. Have a great evening!' });
    },
    onError: (err: any) => {
      setToastMessage({ type: 'error', text: err?.message || 'Failed to check out.' });
    },
  });

  const todayRecord = myAttendanceQuery.data;

  // Filtered agents
  const filteredAgents = (agentsQuery.data || []).filter((agent) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return agent.displayName.toLowerCase().includes(q) || agent.email.toLowerCase().includes(q);
  });

  const handleOpenDelegationModal = () => {
    setDelegatorId(me?.id || '');
    setDelegateId('');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date();
    dayAfter.setDate(dayAfter.getDate() + 3);
    setStartsAtDate(tomorrow.toISOString().slice(0, 10));
    setEndsAtDate(dayAfter.toISOString().slice(0, 10));
    setDelegationError(null);
    setIsDelegationOpen(true);
  };

  const handleSaveDelegation = () => {
    if (!delegatorId || !delegateId || !startsAtDate || !endsAtDate) {
      setDelegationError('Please fill out all required fields.');
      return;
    }
    if (delegatorId === delegateId) {
      setDelegationError('Delegator and delegate cannot be the same user.');
      return;
    }
    if (new Date(endsAtDate) < new Date(startsAtDate)) {
      setDelegationError('End date must be on or after start date.');
      return;
    }

    createDelegationMutation.mutate({
      delegatorId,
      delegateId,
      startsAt: new Date(startsAtDate).toISOString(),
      endsAt: new Date(endsAtDate + 'T23:59:59.999Z').toISOString(),
      reason: delegationReason || undefined,
    });
  };

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1400, mx: 'auto' }}>
      {/* Page Header */}
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ color: '#0f172a', letterSpacing: '-0.02em' }}>
            Workforce Management
          </Typography>
          <Typography variant="body2" sx={{ color: '#64748b', mt: 0.5 }}>
            Availability & capacity routing, leave coverage planner, and daily attendance.
          </Typography>
        </Box>

        {/* Self Availability Switcher Banner */}
        <Card sx={{ borderRadius: 3, boxShadow: '0 4px 12px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0', p: 1.5 }}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Typography variant="caption" fontWeight={600} sx={{ color: '#475569', textTransform: 'uppercase' }}>
              My Status:
            </Typography>
            {(['AVAILABLE', 'BUSY', 'OFF_DUTY', 'ON_LEAVE'] as AvailabilityStatus[]).map((status) => {
              const isSelected = currentAvailability === status;
              const config = AVAILABILITY_CONFIG[status];
              return (
                <Chip
                  key={status}
                  label={config.label}
                  color={isSelected ? config.color : 'default'}
                  variant={isSelected ? 'filled' : 'outlined'}
                  size="small"
                  clickable
                  disabled={availabilityMutation.isPending}
                  onClick={() => availabilityMutation.mutate(status)}
                  sx={{
                    fontWeight: isSelected ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    transform: isSelected ? 'scale(1.05)' : 'none',
                  }}
                />
              );
            })}
          </Stack>
        </Card>
      </Stack>

      {/* Toast Alert */}
      {toastMessage && (
        <Alert
          severity={toastMessage.type}
          onClose={() => setToastMessage(null)}
          sx={{ mb: 3, borderRadius: 2 }}
        >
          {toastMessage.text}
        </Alert>
      )}

      {/* Navigation Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: '#e2e8f0', mb: 3 }}>
        <Tabs
          value={activeTab}
          onChange={(_, val) => setActiveTab(val)}
          sx={{
            '& .MuiTab-root': { fontWeight: 600, textTransform: 'none', fontSize: '0.95rem' },
          }}
        >
          <Tab label="Capacity & Availability (SUB-WRK.01)" id="tab-capacity" />
          <Tab label="Leave Coverage Planner (SUB-WRK.02)" id="tab-leave" />
          <Tab label="Attendance & Check-in (SUB-WRK.03)" id="tab-attendance" />
        </Tabs>
      </Box>

      {/* TAB 0: Capacity & Availability */}
      {activeTab === 0 && (
        <Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems="center" spacing={2} sx={{ mb: 2 }}>
            <TextField
              size="small"
              placeholder="Search agent by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              sx={{ width: { xs: '100%', sm: 320 }, bgcolor: '#fff' }}
            />
            <Typography variant="caption" sx={{ color: '#64748b' }}>
              Showing {filteredAgents.length} active workforce members
            </Typography>
          </Stack>

          <Card sx={{ borderRadius: 3, border: '1px solid #e2e8f0', boxShadow: 'none' }}>
            <TableContainer>
              <Table>
                <TableHead sx={{ bgcolor: '#f8fafc' }}>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, color: '#475569' }}>Agent</TableCell>
                    <TableCell sx={{ fontWeight: 600, color: '#475569' }}>Branch</TableCell>
                    <TableCell sx={{ fontWeight: 600, color: '#475569' }}>Working Status</TableCell>
                    <TableCell sx={{ fontWeight: 600, color: '#475569' }}>Active Workload</TableCell>
                    <TableCell sx={{ fontWeight: 600, color: '#475569' }}>Capacity Meter</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, color: '#475569' }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {agentsQuery.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                        <CircularProgress size={32} />
                      </TableCell>
                    </TableRow>
                  ) : filteredAgents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 6, color: '#94a3b8' }}>
                        No workforce agents found matching your query.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAgents.map((agent) => {
                      const statusConfig = AVAILABILITY_CONFIG[agent.availability] || AVAILABILITY_CONFIG.AVAILABLE;
                      const activeItems = (agent.activeLeadCount || 0) + (agent.activeApplicationCount || 0);
                      const capacity = agent.capacity || 10;
                      const percent = Math.min(Math.round((activeItems / capacity) * 100), 100);

                      let barColor: 'success' | 'warning' | 'error' = 'success';
                      if (percent >= 90) barColor = 'error';
                      else if (percent >= 70) barColor = 'warning';

                      const canEditThisAgent = canManageUsers || agent.id === me?.id;

                      return (
                        <TableRow key={agent.id} hover>
                          <TableCell>
                            <Typography variant="body2" fontWeight={600} sx={{ color: '#0f172a' }}>
                              {agent.displayName}
                            </Typography>
                            <Typography variant="caption" sx={{ color: '#64748b' }}>
                              {agent.email}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ color: '#334155' }}>
                              {agent.primaryBranchId || 'General'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={statusConfig.label}
                              color={statusConfig.color}
                              size="small"
                              sx={{ fontWeight: 600, fontSize: '0.75rem' }}
                            />
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" fontWeight={600}>
                              {activeItems}{' '}
                              <Typography component="span" variant="caption" sx={{ color: '#64748b' }}>
                                ({agent.activeLeadCount} leads, {agent.activeApplicationCount} apps)
                              </Typography>
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ minWidth: 160 }}>
                            <Stack spacing={0.5}>
                              <Stack direction="row" justifyContent="space-between">
                                <Typography variant="caption" sx={{ color: '#64748b' }}>
                                  {activeItems} of {capacity}
                                </Typography>
                                <Typography variant="caption" fontWeight={600} sx={{ color: '#475569' }}>
                                  {percent}%
                                </Typography>
                              </Stack>
                              <LinearProgress
                                variant="determinate"
                                value={percent}
                                color={barColor}
                                sx={{ height: 6, borderRadius: 3 }}
                              />
                            </Stack>
                          </TableCell>
                          <TableCell align="right">
                            {canEditThisAgent && (
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => {
                                  setEditingAgent(agent);
                                  setEditCapacityVal(agent.capacity || 10);
                                }}
                                sx={{ textTransform: 'none', borderRadius: 2 }}
                              >
                                Edit Capacity
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Box>
      )}

      {/* TAB 1: Leave Coverage & Delegations */}
      {activeTab === 1 && (
        <Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="h6" fontWeight={600} sx={{ color: '#1e293b' }}>
              Active & Scheduled Delegations
            </Typography>
            <Button
              variant="contained"
              onClick={handleOpenDelegationModal}
              sx={{ textTransform: 'none', borderRadius: 2, bgcolor: '#2563eb' }}
            >
              + Create Leave Delegation
            </Button>
          </Stack>

          <Card sx={{ borderRadius: 3, border: '1px solid #e2e8f0', boxShadow: 'none' }}>
            <TableContainer>
              <Table>
                <TableHead sx={{ bgcolor: '#f8fafc' }}>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, color: '#475569' }}>On Leave (Delegator)</TableCell>
                    <TableCell sx={{ fontWeight: 600, color: '#475569' }}>Covering Agent (Delegate)</TableCell>
                    <TableCell sx={{ fontWeight: 600, color: '#475569' }}>Coverage Window</TableCell>
                    <TableCell sx={{ fontWeight: 600, color: '#475569' }}>Reason</TableCell>
                    <TableCell sx={{ fontWeight: 600, color: '#475569' }}>Status</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, color: '#475569' }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {delegationsQuery.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                        <CircularProgress size={32} />
                      </TableCell>
                    </TableRow>
                  ) : (delegationsQuery.data || []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 6, color: '#94a3b8' }}>
                        No leave delegations currently recorded.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (delegationsQuery.data || []).map((dlg) => {
                      const isActive = dlg.status === 'ACTIVE';
                      const canEnd = canManageUsers || dlg.delegatorId === me?.id;
                      const starts = new Date(dlg.startsAt).toLocaleDateString();
                      const ends = new Date(dlg.endsAt).toLocaleDateString();

                      return (
                        <TableRow key={dlg.id} hover>
                          <TableCell>
                            <Typography variant="body2" fontWeight={600} sx={{ color: '#0f172a' }}>
                              {dlg.delegatorName || dlg.delegatorId}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ color: '#0f172a' }}>
                              {dlg.delegateName || dlg.delegateId}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ color: '#334155' }}>
                              {starts} → {ends}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ color: '#64748b' }}>
                              {dlg.reason || '—'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={dlg.status}
                              color={isActive ? 'success' : 'default'}
                              size="small"
                              sx={{ fontWeight: 600, fontSize: '0.75rem' }}
                            />
                          </TableCell>
                          <TableCell align="right">
                            {isActive && canEnd && (
                              <Button
                                size="small"
                                color="error"
                                variant="outlined"
                                disabled={endDelegationMutation.isPending}
                                onClick={() => endDelegationMutation.mutate(dlg.id)}
                                sx={{ textTransform: 'none', borderRadius: 2 }}
                              >
                                End Coverage
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Box>
      )}

      {/* TAB 2: Attendance Tracking */}
      {activeTab === 2 && (
        <Box>
          <Grid container spacing={3} sx={{ mb: 4 }}>
            {/* Action Card: Check In / Out */}
            <Grid item xs={12} md={5}>
              <Card sx={{ borderRadius: 3, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
                <CardContent sx={{ p: 3 }}>
                  <Typography variant="subtitle2" sx={{ color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Today's Attendance
                  </Typography>
                  <Typography variant="h5" fontWeight={700} sx={{ color: '#0f172a', mt: 0.5, mb: 2 }}>
                    {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </Typography>

                  {/* Status Banner */}
                  <Box
                    sx={{
                      p: 2,
                      borderRadius: 2,
                      bgcolor: todayRecord?.checkOut ? '#f1f5f9' : todayRecord?.checkIn ? '#ecfdf5' : '#fffbeb',
                      border: '1px solid',
                      borderColor: todayRecord?.checkOut ? '#e2e8f0' : todayRecord?.checkIn ? '#a7f3d0' : '#fde68a',
                      mb: 2.5,
                    }}
                  >
                    <Typography variant="caption" fontWeight={600} sx={{ color: '#475569', textTransform: 'uppercase' }}>
                      Status:
                    </Typography>
                    <Typography variant="h6" fontWeight={700} sx={{ color: '#0f172a' }}>
                      {todayRecord?.checkOut
                        ? 'Completed for today'
                        : todayRecord?.checkIn
                        ? 'Clocked In'
                        : 'Not Checked In'}
                    </Typography>
                    {todayRecord?.checkIn && (
                      <Typography variant="caption" sx={{ color: '#059669', display: 'block', mt: 0.5 }}>
                        Check In: {new Date(todayRecord.checkIn).toLocaleTimeString()}
                      </Typography>
                    )}
                    {todayRecord?.checkOut && (
                      <Typography variant="caption" sx={{ color: '#64748b', display: 'block' }}>
                        Check Out: {new Date(todayRecord.checkOut).toLocaleTimeString()}
                      </Typography>
                    )}
                  </Box>

                  {/* Notes input */}
                  <TextField
                    fullWidth
                    size="small"
                    label="Attendance Notes (Optional)"
                    placeholder="e.g. Work from home, client visits..."
                    value={attendanceNote}
                    onChange={(e) => setAttendanceNote(e.target.value)}
                    sx={{ mb: 2 }}
                  />

                  {/* Buttons */}
                  <Stack direction="row" spacing={2}>
                    <Button
                      fullWidth
                      variant="contained"
                      color="success"
                      disabled={Boolean(todayRecord?.checkIn) || checkInMutation.isPending}
                      onClick={() => checkInMutation.mutate(attendanceNote || undefined)}
                      sx={{ py: 1.2, fontWeight: 600, textTransform: 'none', borderRadius: 2 }}
                    >
                      {checkInMutation.isPending ? <CircularProgress size={20} color="inherit" /> : 'Check In'}
                    </Button>
                    <Button
                      fullWidth
                      variant="contained"
                      color="warning"
                      disabled={!todayRecord?.checkIn || Boolean(todayRecord?.checkOut) || checkOutMutation.isPending}
                      onClick={() => checkOutMutation.mutate(attendanceNote || undefined)}
                      sx={{ py: 1.2, fontWeight: 600, textTransform: 'none', borderRadius: 2 }}
                    >
                      {checkOutMutation.isPending ? <CircularProgress size={20} color="inherit" /> : 'Check Out'}
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>

            {/* Attendance Overview Card */}
            <Grid item xs={12} md={7}>
              <Card sx={{ borderRadius: 3, border: '1px solid #e2e8f0', boxShadow: 'none', height: '100%' }}>
                <CardContent sx={{ p: 3 }}>
                  <Typography variant="h6" fontWeight={600} sx={{ color: '#0f172a', mb: 2 }}>
                    Workforce Attendance Log
                  </Typography>
                  <TableContainer sx={{ maxHeight: 320 }}>
                    <Table size="small">
                      <TableHead sx={{ bgcolor: '#f8fafc' }}>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600 }}>Employee</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>In</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Out</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {attendanceLogQuery.isLoading ? (
                          <TableRow>
                            <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                              <CircularProgress size={24} />
                            </TableCell>
                          </TableRow>
                        ) : (attendanceLogQuery.data || []).length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} align="center" sx={{ py: 4, color: '#94a3b8' }}>
                              No attendance records logged yet.
                            </TableCell>
                          </TableRow>
                        ) : (
                          (attendanceLogQuery.data || []).map((row) => (
                            <TableRow key={row.id}>
                              <TableCell sx={{ fontWeight: 500 }}>{row.userName || row.userId}</TableCell>
                              <TableCell>{row.date}</TableCell>
                              <TableCell>{row.checkIn ? new Date(row.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</TableCell>
                              <TableCell>{row.checkOut ? new Date(row.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</TableCell>
                              <TableCell>
                                <Chip label={row.status} size="small" color="success" sx={{ fontSize: '0.7rem' }} />
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Box>
      )}

      {/* Edit Capacity Dialog */}
      <Dialog open={Boolean(editingAgent)} onClose={() => setEditingAgent(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Update Capacity Limit</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: '#64748b', mb: 2 }}>
            Set maximum concurrent lead routing limit for <strong>{editingAgent?.displayName}</strong>.
          </Typography>
          <TextField
            fullWidth
            type="number"
            label="Capacity Limit"
            value={editCapacityVal}
            onChange={(e) => setEditCapacityVal(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
            helperText="Allowed range: 0 - 100 leads"
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setEditingAgent(null)} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={capacityMutation.isPending}
            onClick={() => {
              if (editingAgent) {
                capacityMutation.mutate({ agentId: editingAgent.id, capacity: editCapacityVal });
              }
            }}
            sx={{ textTransform: 'none', bgcolor: '#2563eb' }}
          >
            {capacityMutation.isPending ? <CircularProgress size={20} color="inherit" /> : 'Save Capacity'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create Delegation Dialog */}
      <Dialog open={isDelegationOpen} onClose={() => setIsDelegationOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Create Leave Coverage Delegation</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {delegationError && (
              <Alert severity="error" sx={{ borderRadius: 2 }}>
                {delegationError}
              </Alert>
            )}

            <TextField
              select
              fullWidth
              label="On Leave (Delegator)"
              value={delegatorId}
              onChange={(e) => setDelegatorId(e.target.value)}
              disabled={!canManageUsers}
              helperText={!canManageUsers ? 'You are creating delegation for your own account' : undefined}
            >
              {(agentsQuery.data || []).map((agent) => (
                <MenuItem key={agent.id} value={agent.id}>
                  {agent.displayName} ({agent.email})
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              fullWidth
              label="Covering Agent (Delegate)"
              value={delegateId}
              onChange={(e) => setDelegateId(e.target.value)}
            >
              {(agentsQuery.data || [])
                .filter((agent) => agent.id !== delegatorId)
                .map((agent) => (
                  <MenuItem key={agent.id} value={agent.id}>
                    {agent.displayName} ({agent.availability})
                  </MenuItem>
                ))}
            </TextField>

            <Stack direction="row" spacing={2}>
              <TextField
                fullWidth
                type="date"
                label="Coverage Starts"
                InputLabelProps={{ shrink: true }}
                value={startsAtDate}
                onChange={(e) => setStartsAtDate(e.target.value)}
              />
              <TextField
                fullWidth
                type="date"
                label="Coverage Ends"
                InputLabelProps={{ shrink: true }}
                value={endsAtDate}
                onChange={(e) => setEndsAtDate(e.target.value)}
              />
            </Stack>

            <TextField
              fullWidth
              label="Reason for Delegation (Optional)"
              placeholder="e.g. Annual leave, Medical leave"
              value={delegationReason}
              onChange={(e) => setDelegationReason(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setIsDelegationOpen(false)} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={createDelegationMutation.isPending}
            onClick={handleSaveDelegation}
            sx={{ textTransform: 'none', bgcolor: '#2563eb' }}
          >
            {createDelegationMutation.isPending ? <CircularProgress size={20} color="inherit" /> : 'Confirm Delegation'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
