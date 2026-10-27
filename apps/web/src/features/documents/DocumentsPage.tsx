// /documents (owner: Dev 3, MOD-DOC; QA plan Module 09 document verifier). Pick an application and work its document checklist.
// Needs application.read. The page lists the applications in the user's scope; choosing one opens its checklist below the list.
import { Alert, Box, Button, Chip, FormControl, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { hasPermission, useMe } from '../../api/useMe';
import { useList } from '../admin/api';
import { ErrorAlert, LoadMore, Loading } from '../admin/components';
import { CustomerName } from '../../shell/display';
import { APPLICATION_STATUSES, STATUS_LABELS, type ApplicationStatus } from '../applications/rules';
import { DataTable, DetailCard, FilterToolbar, PageHeader, StatCard, StatCardGrid, StatusBadge } from '../../ui';
import type { ColumnDef } from '../../ui';
import { ChecklistCard } from './ChecklistCard';
import { SupabaseStorageCard } from './SupabaseStorageCard';
import { NotSet } from '../../ui/NotSet';

interface ApplicationRow {
  id: string;
  customerId: string;
  productCategory: string;
  currency: string;
  requestedAmount: string;
  status: ApplicationStatus;
  createdAt: string;
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  DOCUMENTS_PENDING: 'warning',
  UNDER_REVIEW: 'info',
  READY_FOR_SUBMISSION: 'success',
  SUBMITTED: 'info',
  SANCTIONED: 'success',
  DISBURSED: 'success',
  REJECTED: 'error',
  WITHDRAWN: 'neutral',
  CANCELLED: 'neutral',
  CLOSED: 'neutral',
};

export function DocumentsPage() {
  const me = useMe();
  const allowed = !me.data || hasPermission(me.data, 'application.read');
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState(params.get('application') ?? '');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const apps = useList<ApplicationRow>('/v1/applications', { status: status || undefined }, 50, allowed);

  const rows = useMemo(() => apps.data?.pages.flatMap((p) => p.data) ?? [], [apps.data]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (a) =>
        a.id.toLowerCase().includes(q) ||
        (a.productCategory ?? '').toLowerCase().includes(q) ||
        STATUS_LABELS[a.status]?.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const checklistRef = useRef<HTMLDivElement | null>(null);

  const scrollToView = () => {
    if (typeof window === 'undefined') return;
    const el = checklistRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const targetY = rect.top + scrollTop - 80;

    window.scrollTo({
      top: Math.max(0, targetY),
      behavior: 'smooth',
    });
  };

  const choose = (id: string) => {
    setSelected(id);
    setParams(id ? { application: id } : {});
  };

  const showChecklist = (id: string) => {
    choose(id);
    setTimeout(scrollToView, 60);
    setTimeout(scrollToView, 220);
  };

  useEffect(() => {
    if (selected) {
      const t = setTimeout(scrollToView, 100);
      return () => clearTimeout(t);
    }
  }, [selected]);

  if (!allowed) {
    return (
      <Alert severity="warning" data-testid="documents-no-access">
        You do not have access to application documents. This needs the application read permission.
      </Alert>
    );
  }

  const chosen = rows.find((a) => a.id === selected);
  const awaiting = rows.filter((a) => a.status === 'DOCUMENTS_PENDING').length;
  const inReview = rows.filter((a) => a.status === 'UNDER_REVIEW').length;

  const columns: ColumnDef<ApplicationRow>[] = [
    {
      id: 'customer',
      header: 'Customer',
      render: (a) => <CustomerName id={a.customerId} fallback="Application" />,
    },
    { id: 'product', header: 'Product', render: (a) => a.productCategory || <NotSet /> },
    {
      id: 'amount',
      header: 'Requested amount',
      align: 'right',
      render: (a) => `${a.currency} ${Number(a.requestedAmount).toLocaleString('en-IN')}`,
    },
    {
      id: 'status',
      header: 'Status',
      render: (a) => (
        <StatusBadge status={STATUS_TONE[a.status] ?? 'neutral'} label={STATUS_LABELS[a.status] ?? a.status} />
      ),
    },
    {
      id: 'action',
      header: '',
      align: 'right',
      render: (a) => (
        <Button
          size="small"
          variant={a.id === selected ? 'contained' : 'outlined'}
          onClick={() => showChecklist(a.id)}
          data-testid={`documents.open.${a.id}`}
        >
          {a.id === selected ? 'View checklist' : 'Open checklist'}
        </Button>
      ),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Documents"
        subtitle="Choose an application to see the documents it needs and where each one stands. Upload, view, review (accept or reject with a reason) and waive from the checklist; customers can also upload through Document sharing."
      />

      <StatCardGrid columns={{ xs: 12, sm: 6, md: 3 }}>
        <StatCard title="Applications in scope" value={rows.length} format="number" status="default" />
        <StatCard title="Awaiting documents" value={awaiting} format="number" status="warning" />
        <StatCard title="Under review" value={inReview} format="number" status="info" />
        <StatCard
          title="Selected"
          value={chosen ? STATUS_LABELS[chosen.status] ?? chosen.status : 'None'}
          format="raw"
          status="primary"
        />
      </StatCardGrid>

      <ErrorAlert error={apps.error} />

      <DetailCard
        title="Applications"
        subtitle="Open an application to work its checklist."
      >
        <FilterToolbar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search by application, product or status"
          searchTestId="documents.search"
          filters={
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel id="documents-status-label">Status</InputLabel>
              <Select
                labelId="documents-status-label"
                label="Status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                data-testid="documents.status"
              >
                <MenuItem value="">All statuses</MenuItem>
                {APPLICATION_STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          }
        />

        {apps.isLoading ? (
          <Loading />
        ) : rows.length === 0 && !apps.error ? (
          <Typography color="text.secondary" data-testid="documents-empty">
            There are no applications in your scope yet.
          </Typography>
        ) : (
          <>
            <DataTable<ApplicationRow>
              dataTestId="documents.table"
              data={visible}
              columns={columns}
              keyExtractor={(a) => a.id}
              onRowClick={(a) => showChecklist(a.id)}
              emptyMessage="No applications match your search or status filter."
            />
            <LoadMore
              hasNext={!!apps.hasNextPage}
              loading={apps.isFetchingNextPage}
              onClick={() => apps.fetchNextPage()}
            />
          </>
        )}
      </DetailCard>

      <SupabaseStorageCard />

      <Box sx={{ mt: 3, scrollMarginTop: '80px' }} ref={checklistRef}>
        {selected ? (
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip label={`Application ${selected.slice(-6)}`} size="small" variant="outlined" />
              <Typography variant="body2" color="text.secondary">
                Documents for this application
              </Typography>
              <Button size="small" onClick={() => choose('')}>
                Close checklist
              </Button>
            </Stack>
            <ChecklistCard applicationId={selected} />
          </Stack>
        ) : (
          <Typography color="text.secondary" data-testid="documents-select-hint">
            Select an application above to see its document checklist.
          </Typography>
        )}
      </Box>
    </Box>
  );
}
