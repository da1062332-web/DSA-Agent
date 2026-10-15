// /applications (owner: Dev 3; DSA Notion MODULE 16, API-APP-002). The applications the caller may see: RM sees own,
// branch roles see their branch, org owner sees the tenant. The server applies the scope; the screen only lists.
import {
  Alert,
  Card,
  Chip,
  Link,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
} from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { hasPermission, useMe } from '../../api/useMe';
import { useList } from '../admin/api';
import { ErrorAlert, LoadMore, Loading, PageHeader } from '../admin/components';
import { APPLICATION_STATUSES, STATUS_LABELS, type ApplicationStatus } from './rules';

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
    <>
      <PageHeader
        title="Applications"
        subtitle="Loan files from conversion to closure. You see the applications in your scope."
      />
      {!canRead && (
        <Alert severity="warning" data-testid="applications.noAccess">
          You don't have permission to view applications. Ask your administrator for the application read
          permission.
        </Alert>
      )}
      {canRead && <ApplicationsList />}
    </>
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

  return (
    <>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField
          size="small"
          select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          sx={{ minWidth: 200 }}
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
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="true">On hold</MenuItem>
          <MenuItem value="false">Not on hold</MenuItem>
        </TextField>
      </Stack>
      <ErrorAlert error={list.error} />
      {list.isPending ? (
        <Loading />
      ) : (
        <Card>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Application</TableCell>
                  <TableCell>Product</TableCell>
                  <TableCell>Amount</TableCell>
                  <TableCell>Tenure</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Hold</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      No applications match.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((a) => (
                  <TableRow key={a.id} hover>
                    <TableCell>
                      <Link
                        component={RouterLink}
                        to={`/applications/${a.id}`}
                        data-testid="applications.open"
                      >
                        {a.id}
                      </Link>
                    </TableCell>
                    <TableCell>{a.productCategory}</TableCell>
                    <TableCell>
                      {a.currency} {a.requestedAmount}
                    </TableCell>
                    <TableCell>{a.tenureMonths ? `${a.tenureMonths} months` : '—'}</TableCell>
                    <TableCell>{STATUS_LABELS[a.status]}</TableCell>
                    <TableCell>
                      {a.onHold ? <Chip size="small" color="warning" label="On hold" /> : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}
      <LoadMore
        hasNext={!!list.hasNextPage}
        loading={list.isFetchingNextPage}
        onClick={() => void list.fetchNextPage()}
      />
    </>
  );
}
