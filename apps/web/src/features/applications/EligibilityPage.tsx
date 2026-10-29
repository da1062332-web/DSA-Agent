// /eligibility (owner: Dev 3; DSA Notion MODULE 17). The applications in the user's scope, with their preliminary eligibility checks.
// Pages load on demand from the server and the status filter is applied by the server. The search narrows the rows already loaded.
import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { hasPermission, useMe } from '../../api/useMe';
import { CustomerName } from '../../shell/display';
import { CancelIcon, VisibilityIcon } from '../../shell/icons';
import { DataTable, DetailCard, FilterToolbar, PageHeader, StatusBadge } from '../../ui';
import type { ColumnDef } from '../../ui';
import { NotSet } from '../../ui/NotSet';
import { useList } from '../admin/api';
import { ErrorAlert, LoadMore } from '../admin/components';
import { EligibilityCard } from './EligibilityCard';
import { formatRequested, formatTenure } from './eligibility';
import { APPLICATION_STATUSES, STATUS_LABELS, type ApplicationStatus } from './rules';

interface ApplicationRow {
  id: string;
  customerId: string;
  applicantType: string;
  status: ApplicationStatus;
  requestedAmount: string;
  currency: string;
  tenureMonths: number | null;
  productVersionId: string | null;
  createdAt: string;
}

const STATUS_TONE: Record<ApplicationStatus, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  DRAFT: 'neutral',
  DOCUMENTS_PENDING: 'warning',
  UNDER_REVIEW: 'info',
  READY_FOR_SUBMISSION: 'success',
  SUBMITTED: 'info',
  SANCTIONED: 'success',
  PARTIALLY_DISBURSED: 'success',
  DISBURSED: 'success',
  CLOSED: 'neutral',
  REJECTED: 'error',
  WITHDRAWN: 'neutral',
  CANCELLED: 'neutral',
};

const readable = (code: string) => code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ');

export function EligibilityPage() {
  const me = useMe();
  const canRead = hasPermission(me.data, 'application.read');
  const canOverride = hasPermission(me.data, 'eligibility.override');
  const [status, setStatus] = useState<'ALL' | ApplicationStatus>('ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ApplicationRow | null>(null);

  const list = useList<ApplicationRow>('/v1/applications', status === 'ALL' ? {} : { status }, 50, canRead);
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (a) =>
        a.id.toLowerCase().includes(q) ||
        readable(a.applicantType).toLowerCase().includes(q) ||
        STATUS_LABELS[a.status]?.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const columns: ColumnDef<ApplicationRow>[] = [
    {
      id: 'customer',
      header: 'Customer',
      render: (app) => <CustomerName id={app.customerId} linkToProfile />,
    },
    {
      id: 'applicant',
      header: 'Applicant type',
      render: (app) => <Chip label={readable(app.applicantType)} size="small" variant="outlined" />,
    },
    {
      id: 'status',
      header: 'Status',
      render: (app) => <StatusBadge status={STATUS_TONE[app.status]} label={STATUS_LABELS[app.status]} />,
    },
    {
      id: 'amount',
      header: 'Requested amount',
      align: 'right',
      render: (app) => formatRequested(app.requestedAmount, app.currency) ?? <NotSet>Not recorded</NotSet>,
    },
    {
      id: 'tenure',
      header: 'Tenure',
      render: (app) => formatTenure(app.tenureMonths) ?? <NotSet>Not recorded</NotSet>,
    },
    {
      id: 'product',
      header: 'Product',
      align: 'center',
      render: (app) =>
        app.productVersionId ? (
          <Chip label="Chosen" size="small" color="success" variant="outlined" />
        ) : (
          <Chip label="Not chosen" size="small" color="warning" variant="outlined" />
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
            setSelected(app);
          }}
          data-testid={`eligibility.view.${app.id}`}
          sx={{ textTransform: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}
        >
          View eligibility
        </Button>
      ),
    },
  ];

  if (!canRead) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">You need the application read permission to see eligibility checks.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Eligibility"
        subtitle="Preliminary checks of applications against the approved eligibility rules."
        badge={
          <Chip
            label={canOverride ? 'Can record overrides' : 'Read only'}
            color={canOverride ? 'secondary' : 'default'}
            variant="outlined"
          />
        }
      />

      <Alert severity="info" sx={{ mb: 3 }}>
        A check runs the approved rules on the figures recorded for the application. Missing, out-of-date or
        unverified figures are shown as pending, and a pending check is never a pass. A check does not approve
        a loan.
      </Alert>

      <DetailCard title="Applications" subtitle="Open an application to see or run its eligibility check.">
        <FilterToolbar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search the loaded applications by id, applicant type or status"
          searchTestId="eligibility.search"
          filters={
            <TextField
              select
              size="small"
              label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value as 'ALL' | ApplicationStatus)}
              sx={{ minWidth: 200 }}
              inputProps={{ 'data-testid': 'eligibility.status' }}
            >
              <MenuItem value="ALL">All statuses</MenuItem>
              {APPLICATION_STATUSES.map((s) => (
                <MenuItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </MenuItem>
              ))}
            </TextField>
          }
        />
        <ErrorAlert error={list.error} />
        <DataTable<ApplicationRow>
          dataTestId="eligibility.table"
          data={visible}
          columns={columns}
          keyExtractor={(app) => app.id}
          onRowClick={(app) => setSelected(app)}
          emptyMessage={list.isPending ? 'Loading applications…' : 'No applications match this filter.'}
        />
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 2 }}>
          <Typography variant="body2" color="text.secondary" data-testid="eligibility.loaded">
            {`${rows.length} application${rows.length === 1 ? '' : 's'} loaded${list.hasNextPage ? ', more available' : ''}.`}
          </Typography>
          <LoadMore
            hasNext={!!list.hasNextPage}
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          />
        </Stack>
      </DetailCard>

      <Dialog
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        maxWidth="md"
        fullWidth
        data-testid="eligibility.dialog"
      >
        <DialogTitle
          sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', pb: 1.5 }}
        >
          <Box>
            <Typography variant="h6" fontWeight={700}>
              Eligibility
            </Typography>
            {selected && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.75 }} flexWrap="wrap">
                <Typography variant="body2" color="text.secondary">
                  Application <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{selected.id}</span>
                </Typography>
                <StatusBadge status={STATUS_TONE[selected.status]} label={STATUS_LABELS[selected.status]} />
                <Typography variant="caption" color="text.secondary">
                  {formatRequested(selected.requestedAmount, selected.currency) ??
                    'Requested amount not recorded'}
                  {formatTenure(selected.tenureMonths) ? ` · ${formatTenure(selected.tenureMonths)}` : ''}
                </Typography>
              </Stack>
            )}
          </Box>
          <Button aria-label="close" onClick={() => setSelected(null)} size="small" sx={{ minWidth: 0 }}>
            <CancelIcon fontSize="small" />
          </Button>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 3 }}>
          {selected && (
            <EligibilityCard
              applicationId={selected.id}
              applicationStatus={selected.status}
              hasProduct={Boolean(selected.productVersionId)}
              variant="dialog"
            />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setSelected(null)} variant="outlined">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
