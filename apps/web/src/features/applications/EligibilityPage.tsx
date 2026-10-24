import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client';
import { hasPermission, useMe } from '../../api/useMe';
import { CancelIcon, VisibilityIcon } from '../../shell/icons';
import {
  DataTable,
  DetailCard,
  FilterToolbar,
  PageHeader,
  StatCard,
  StatCardGrid,
  StatusBadge,
} from '../../ui';
import type { ColumnDef } from '../../ui';
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

const STATUS_OPTIONS = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'SANCTIONED'] as const;

const STATUS_TONE: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'warning',
  SANCTIONED: 'success',
};

export function EligibilityPage() {
  const me = useMe();
  const canRead = hasPermission(me.data, 'application.read');
  const canOverride = hasPermission(me.data, 'eligibility.override');

  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [search, setSearch] = useState('');

  const { data: appsData, isLoading } = useQuery<{ data: ApplicationSummary[] }>({
    queryKey: ['/v1/applications', { limit: 50 }],
    queryFn: () => apiFetch<{ data: ApplicationSummary[] }>('/v1/applications?limit=50'),
    enabled: canRead,
  });

  const applications = useMemo(() => appsData?.data ?? [], [appsData]);
  const filteredApps = useMemo(() => {
    const q = search.trim().toLowerCase();
    return applications.filter((app) => {
      if (filterStatus !== 'ALL' && app.status !== filterStatus) return false;
      if (!q) return true;
      return (
        app.id.toLowerCase().includes(q) ||
        (app.referenceNumber ?? '').toLowerCase().includes(q) ||
        (app.applicantType ?? '').toLowerCase().includes(q)
      );
    });
  }, [applications, filterStatus, search]);

  const selectedApp = applications.find((a) => a.id === selectedAppId);
  const sanctioned = applications.filter((a) => a.status === 'SANCTIONED').length;
  const underReview = applications.filter((a) => a.status === 'UNDER_REVIEW').length;

  const columns: ColumnDef<ApplicationSummary>[] = [
    {
      id: 'id',
      header: 'Application ID',
      render: (app) => (
        <Tooltip title={`Full ID: ${app.id}`} arrow placement="top">
          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
            {app.referenceNumber || (app.id.length > 16 ? `${app.id.slice(0, 16)}...` : app.id)}
          </span>
        </Tooltip>
      ),
    },
    {
      id: 'applicant',
      header: 'Applicant Type',
      render: (app) => <Chip label={app.applicantType || 'INDIVIDUAL'} size="small" variant="outlined" />,
    },
    {
      id: 'status',
      header: 'Status',
      render: (app) => <StatusBadge status={STATUS_TONE[app.status] ?? 'neutral'} label={app.status} />,
    },
    {
      id: 'amount',
      header: 'Requested Amount',
      align: 'right',
      render: (app) => `₹${Number(app.requestedAmount?.amount || 0).toLocaleString('en-IN')}`,
    },
    { id: 'tenure', header: 'Tenure', render: (app) => `${app.tenureMonths || 36}m` },
    {
      id: 'product',
      header: 'Product Assigned',
      align: 'center',
      render: (app) =>
        app.productVersionId ? (
          <Chip label="Configured" size="small" color="success" variant="outlined" />
        ) : (
          <Chip label="Not Assigned" size="small" color="warning" variant="outlined" />
        ),
    },
    {
      id: 'action',
      header: 'Action',
      align: 'center',
      render: (app) => (
        <Button
          size="small"
          variant="contained"
          color="primary"
          startIcon={<VisibilityIcon fontSize="small" />}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedAppId(app.id);
          }}
          data-testid={`eligibility.view.${app.id}`}
          sx={{ textTransform: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}
        >
          View Eligibility
        </Button>
      ),
    },
  ];

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Credit & Eligibility Engine"
        subtitle="Evaluate applicant financial criteria, credit matrices, and policy constraints across loan products."
        badge={
          <Chip
            label={canOverride ? 'Supervisor Override Active' : 'Read & Assessment Mode'}
            color={canOverride ? 'secondary' : 'default'}
            variant="outlined"
          />
        }
      />

      <Alert severity="info" sx={{ mb: 3 }}>
        Eligibility assessments evaluate application data against active policy tables and credit matrices. All
        assessment runs are deterministic, auditable, and recorded in compliance with credit policy governance.
      </Alert>

      <StatCardGrid columns={{ xs: 12, sm: 6, md: 3 }}>
        <StatCard title="Applications" value={applications.length} format="number" status="default" />
        <StatCard title="Under review" value={underReview} format="number" status="warning" />
        <StatCard title="Sanctioned" value={sanctioned} format="number" status="success" />
        <StatCard
          title="Configured products"
          value={applications.filter((a) => Boolean(a.productVersionId)).length}
          format="number"
          status="primary"
        />
      </StatCardGrid>

      <Grid container spacing={3}>
        <Grid item xs={12}>
          <DetailCard
            title="Loan Applications"
            subtitle="Select an application or click 'View Eligibility' to inspect or run an assessment in a popup."
          >
            <FilterToolbar
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search by reference, ID or applicant type"
              searchTestId="eligibility.search"
              filters={
                <TextFieldStatus
                  value={filterStatus}
                  onChange={setFilterStatus}
                />
              }
            />
            <DataTable<ApplicationSummary>
              dataTestId="eligibility.table"
              data={filteredApps}
              columns={columns}
              keyExtractor={(app) => app.id}
              onRowClick={(app) => setSelectedAppId(app.id)}
              emptyMessage={
                isLoading ? 'Loading applications...' : 'No applications found matching filter.'
              }
            />
          </DetailCard>
        </Grid>
      </Grid>

      {/* Eligibility Assessment Popup Modal */}
      <Dialog
        open={Boolean(selectedApp)}
        onClose={() => setSelectedAppId(null)}
        maxWidth="md"
        fullWidth
        data-testid="eligibility.dialog"
      >
        <DialogTitle
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            pb: 1.5,
          }}
        >
          <Box>
            <Typography variant="h6" fontWeight={700}>
              Eligibility Assessment
            </Typography>
            {selectedApp && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.75 }} flexWrap="wrap">
                <Typography variant="body2" color="text.secondary">
                  Application:{' '}
                  <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                    {selectedApp.referenceNumber || selectedApp.id}
                  </span>
                </Typography>
                <Chip label={selectedApp.applicantType || 'INDIVIDUAL'} size="small" variant="outlined" />
                <StatusBadge status={STATUS_TONE[selectedApp.status] ?? 'neutral'} label={selectedApp.status} />
                <Typography variant="caption" color="text.secondary">
                  ₹{Number(selectedApp.requestedAmount?.amount || 0).toLocaleString('en-IN')} • {selectedApp.tenureMonths || 36}m
                </Typography>
              </Stack>
            )}
          </Box>
          <IconButton
            aria-label="close"
            onClick={() => setSelectedAppId(null)}
            size="small"
            sx={{ color: 'text.secondary' }}
          >
            <CancelIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 3 }}>
          {selectedApp && (
            <EligibilityCard
              applicationId={selectedApp.id}
              hasProduct={Boolean(selectedApp.productVersionId)}
              variant="dialog"
            />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
          {selectedApp && (
            <Button
              component={RouterLink}
              to={`/applications/${selectedApp.id}`}
              size="small"
              variant="text"
            >
              Open Application Details
            </Button>
          )}
          <Button onClick={() => setSelectedAppId(null)} variant="outlined">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function TextFieldStatus({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <TextField
      select
      size="small"
      label="Status"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      sx={{ minWidth: 180 }}
    >
      <MenuItem value="ALL">All Statuses</MenuItem>
      {STATUS_OPTIONS.map((s) => (
        <MenuItem key={s} value={s}>
          {s}
        </MenuItem>
      ))}
    </TextField>
  );
}
