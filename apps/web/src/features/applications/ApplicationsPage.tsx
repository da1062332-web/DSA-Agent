// /applications (owner: Dev 3; DSA Notion MODULE 16, API-APP-002). The applications the caller may see: RM sees own,
// branch roles see their branch, org owner sees the tenant. The server applies the scope; the screen only lists.
import {
  Alert,
  Box,
  Link,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { hasPermission, useMe } from '../../api/useMe';
import { useList } from '../admin/api';
import { LoadMore } from '../admin/components';
import { CustomerName } from '../../shell/display';
import { APPLICATION_STATUSES, STATUS_LABELS, type ApplicationStatus } from './rules';
import {
  PageHeader,
  FilterToolbar,
  DataTable,
  StatusBadge,
  type ColumnDef,
} from '../../ui';

export interface Application {
  id: string;
  customerId: string;
  branchId: string;
  productCategory: string;
  productVersionId: string | null;
  requestedAmount: string;
  currency: string;
  tenureMonths: number | null;
  purposeCode: string | null;
  applicantType: 'SALARIED' | 'SELF_EMPLOYED_PROFESSIONAL' | 'SELF_EMPLOYED_BUSINESS' | 'NON_INDIVIDUAL';
  status: ApplicationStatus;
  onHold: boolean;
  holdReason: string | null;
  holdUntil: string | null;
  salesOwnerId: string;
  opsOwnerId: string | null;
  opsQueueId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function ApplicationsPage() {
  const me = useMe();
  const canRead = hasPermission(me.data, 'application.read');
  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <PageHeader
        title="Applications"
        subtitle="Loan files from conversion to closure. You see the applications in your scope."
      />
      {!canRead && (
        <Alert severity="warning" data-testid="applications.noAccess" sx={{ borderRadius: 2 }}>
          You don't have permission to view applications. Ask your administrator for the application read
          permission.
        </Alert>
      )}
      {canRead && <ApplicationsList />}
    </Box>
  );
}

/** Mounted only when the caller holds application.read, so the list is never requested without it. */
function ApplicationsList() {
  const [status, setStatus] = useState('');
  const [onHold, setOnHold] = useState('');
  const list = useList<Application>(
    '/v1/applications',
    { status: status || undefined, onHold: onHold || undefined },
    50,
  );
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];

  const columns: ColumnDef<Application>[] = [
    {
      id: 'application',
      header: 'Application',
      accessor: (a) => (
        <Box>
          <Link
            component={RouterLink}
            to={`/applications/${a.id}`}
            data-testid="applications.open"
            sx={{ fontWeight: 600, display: 'block', color: 'info.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
          >
            <CustomerName id={a.customerId} fallback={`App #${a.id.slice(-6)}`} />
          </Link>
          <Typography variant="caption" color="text.secondary" fontFamily="monospace">
            {a.id}
          </Typography>
        </Box>
      ),
    },
    {
      id: 'productCategory',
      header: 'Product',
      accessor: (a) => a.productCategory,
    },
    {
      id: 'amount',
      header: 'Amount',
      accessor: (a) => `${a.currency} ${a.requestedAmount}`,
    },
    {
      id: 'tenureMonths',
      header: 'Tenure',
      accessor: (a) => (a.tenureMonths ? `${a.tenureMonths} months` : '—'),
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (a) => <StatusBadge status={a.status} label={STATUS_LABELS[a.status]} />,
    },
    {
      id: 'onHold',
      header: 'Hold',
      accessor: (a) => (a.onHold ? <StatusBadge status="warning" label="On hold" /> : '—'),
    },
  ];

  return (
    <>
      <FilterToolbar
        filters={
          <>
            <TextField
              size="small"
              select
              label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              sx={{ minWidth: 200, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
            >
              <MenuItem value="">All</MenuItem>
              {APPLICATION_STATUSES.map((s) => (
                <MenuItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              select
              label="Hold"
              value={onHold}
              onChange={(e) => setOnHold(e.target.value)}
              sx={{ minWidth: 160, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
            >
              <MenuItem value="">All</MenuItem>
              <MenuItem value="true">On hold</MenuItem>
              <MenuItem value="false">Not on hold</MenuItem>
            </TextField>
          </>
        }
      />

      <DataTable<Application>
        columns={columns}
        data={rows}
        keyExtractor={(a) => a.id}
        isLoading={list.isPending}
        isError={Boolean(list.error)}
        error={list.error}
        emptyTitle="No applications match."
        emptyDescription="Try adjusting your status or hold filter criteria."
      />

      <LoadMore
        hasNext={!!list.hasNextPage}
        loading={list.isFetchingNextPage}
        onClick={() => void list.fetchNextPage()}
      />
    </>
  );
}
