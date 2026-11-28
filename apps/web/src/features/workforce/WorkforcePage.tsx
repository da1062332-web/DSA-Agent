// apps/web/src/features/workforce/WorkforcePage.tsx — Module 26: Workforce UI (attendance and check-in).
// Capacity, availability and leave delegations were removed with task P0-02.
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { hasPermission, useMe } from '../../api/useMe';
import { DataTable, PageHeader } from '../../ui';
import { checkIn, checkOut, getAttendance, getMyTodayAttendance } from './api';
import { NotSet } from '../../ui/NotSet';

export function WorkforcePage() {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const canManageAttendance =
    hasPermission(me, 'attendance.manage') || hasPermission(me, 'user.manage') || hasPermission(me, 'config.manage');

  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [attendanceNote, setAttendanceNote] = useState<string>('');

  const myAttendanceQuery = useQuery({
    queryKey: ['workforce-my-attendance-today'],
    queryFn: () => getMyTodayAttendance(),
  });

  const attendanceLogQuery = useQuery({
    queryKey: ['workforce-attendance-log'],
    queryFn: () => getAttendance(),
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

  return (
    <Box>
      <PageHeader title="Workforce Management" subtitle="Daily attendance and check-in." />

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
                  Workforce Attendance Log {canManageAttendance ? '(All Agents)' : '(My Log)'}
                </Typography>
                <DataTable<(typeof attendanceLogQuery.data extends (infer D)[] | undefined ? D : never)>
                  dataTestId="wrk.table.attendance"
                  loading={attendanceLogQuery.isLoading}
                  data={attendanceLogQuery.data || []}
                  keyExtractor={(row) => row.id}
                  emptyMessage="No attendance records logged yet."
                  columns={[
                    { id: 'employee', header: 'Employee', render: (row) => <Box sx={{ fontWeight: 500 }}>{row.userName || row.userId}</Box> },
                    { id: 'date', header: 'Date', render: (row) => row.date },
                    {
                      id: 'in',
                      header: 'In',
                      render: (row) => (row.checkIn ? new Date(row.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : <NotSet />),
                    },
                    {
                      id: 'out',
                      header: 'Out',
                      render: (row) => (row.checkOut ? new Date(row.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : <NotSet />),
                    },
                    {
                      id: 'status',
                      header: 'Status',
                      render: (row) => <Chip label={row.status} size="small" color="success" sx={{ fontSize: '0.7rem' }} />,
                    },
                  ]}
                />
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
}
