import React, { useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, Grid, MenuItem, TextField } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client';
import { hasPermission, useMe } from '../../api/useMe';
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
        <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
          {app.referenceNumber || `${app.id.slice(0, 12)}...`}
        </span>
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
      id: 'action',
      header: 'Action',
      align: 'center',
      render: (app) => (
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
      ),
    },
  ];

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Credit & Eligibility Engine"
        subtitle="MOD-ELG: Evaluate applicant financial criteria, credit matrices, and policy constraints across loan products."
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
          title="Selected"
          value={selectedApp ? selectedApp.referenceNumber || selectedApp.id.slice(0, 12) : 'None'}
          format="raw"
          status="primary"
        />
      </StatCardGrid>

      <Grid container spacing={3}>
        <Grid item xs={12} md={selectedApp ? 6 : 12}>
          <DetailCard title="Loan Applications" subtitle="Choose an application to run its eligibility check.">
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
