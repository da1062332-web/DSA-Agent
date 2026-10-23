import React, { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Alert,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client';
import { hasPermission, useMe } from '../../api/useMe';
import { EligibilityCard } from './EligibilityCard';

interface ApplicationSummary {
  id: string;
  referenceNumber?: string;
  applicantType: string;
  requestedAmount: { amount: string; currency: string };
  tenureMonths: number;
  productVersionId?: string;
  status: string;
  createdAt: string;
}

export function EligibilityPage() {
  const me = useMe();
  const canRead = hasPermission(me.data, 'application.read');
  const canOverride = hasPermission(me.data, 'eligibility.override');

  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  // Query applications
  const { data: appsData, isLoading } = useQuery<{ data: ApplicationSummary[] }>({
    queryKey: ['/v1/applications', { limit: 50 }],
    queryFn: () => apiFetch<{ data: ApplicationSummary[] }>('/v1/applications?limit=50'),
    enabled: canRead,
  });

  const applications = appsData?.data ?? [];
  const filteredApps = applications.filter((app) => {
    if (filterStatus === 'ALL') return true;
    return app.status === filterStatus;
  });

  const selectedApp = applications.find((a) => a.id === selectedAppId);

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Credit & Eligibility Engine
          </Typography>
          <Typography variant="body2" color="text.secondary">
            MOD-ELG: Evaluate applicant financial criteria, credit matrices, and policy constraints across loan products.
          </Typography>
        </Box>
        <Chip
          label={canOverride ? 'Supervisor Override Active' : 'Read & Assessment Mode'}
          color={canOverride ? 'secondary' : 'default'}
          variant="outlined"
        />
      </Stack>

      <Alert severity="info" sx={{ mb: 3 }}>
        Eligibility assessments evaluate application data against active policy tables and credit matrices.
        All assessment runs are deterministic, auditable, and recorded in compliance with credit policy governance.
      </Alert>

      <Grid container spacing={3}>
        <Grid item xs={12} md={selectedApp ? 6 : 12}>
          <Card>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Typography variant="h6" fontWeight={600}>
                  Loan Applications
                </Typography>
                <TextField
                  select
                  size="small"
                  label="Status"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  sx={{ width: 160 }}
                >
                  <MenuItem value="ALL">All Statuses</MenuItem>
                  <MenuItem value="DRAFT">DRAFT</MenuItem>
                  <MenuItem value="SUBMITTED">SUBMITTED</MenuItem>
                  <MenuItem value="UNDER_REVIEW">UNDER_REVIEW</MenuItem>
                  <MenuItem value="SANCTIONED">SANCTIONED</MenuItem>
                </TextField>
              </Stack>

              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell>Application ID</TableCell>
                      <TableCell>Applicant Type</TableCell>
                      <TableCell align="right">Requested Amount</TableCell>
                      <TableCell>Tenure</TableCell>
                      <TableCell align="center">Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredApps.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                          {isLoading ? 'Loading applications...' : 'No applications found matching filter.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredApps.map((app) => (
                        <TableRow
                          key={app.id}
                          hover
                          selected={selectedAppId === app.id}
                          sx={{ cursor: 'pointer' }}
                          onClick={() => setSelectedAppId(app.id)}
                        >
                          <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                            {app.referenceNumber || app.id.slice(0, 12)}...
                          </TableCell>
                          <TableCell>
                            <Chip label={app.applicantType || 'INDIVIDUAL'} size="small" variant="outlined" />
                          </TableCell>
                          <TableCell align="right">
                            ₹{Number(app.requestedAmount?.amount || 0).toLocaleString('en-IN')}
                          </TableCell>
                          <TableCell>{app.tenureMonths || 36}m</TableCell>
                          <TableCell align="center">
                            <Button
                              size="small"
                              variant={selectedAppId === app.id ? 'contained' : 'outlined'}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedAppId(app.id);
                              }}
                            >
                              Check
                            </Button>
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

        {selectedApp && (
          <Grid item xs={12} md={6}>
            <EligibilityCard
              applicationId={selectedApp.id}
              hasProduct={Boolean(selectedApp.productVersionId || true)}
            />
          </Grid>
        )}
      </Grid>
    </Box>
  );
}
