import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Button,
  Chip,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
} from '@mui/material';
import { UserPicker } from '../admin/components';
import { Can } from '../../shell/Can';
import { fetchLeads } from './api';
import type { LeadResource } from './types';
import {
  PageHeader,
  FilterToolbar,
  DataTable,
  StatusBadge,
  type ColumnDef,
} from '../../ui';
import { NotSet } from '../../ui/NotSet';

export function LeadList() {
  const [stateFilter, setStateFilter] = useState<string>('');
  const [ownerFilter, setOwnerFilter] = useState<string>('');
  const [appliedState, setAppliedState] = useState<string>('');
  const [appliedOwner, setAppliedOwner] = useState<string>('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['leads', appliedState, appliedOwner, cursor],
    queryFn: () =>
      fetchLeads({
        state: appliedState || undefined,
        ownerUserId: appliedOwner || undefined,
        cursor,
        limit: 15,
      }),
  });

  const handleFilterApply = () => {
    setAppliedState(stateFilter);
    setAppliedOwner(ownerFilter);
    setCursor(undefined);
    setCursorHistory([]);
  };

  const handleFilterReset = () => {
    setStateFilter('');
    setOwnerFilter('');
    setAppliedState('');
    setAppliedOwner('');
    setCursor(undefined);
    setCursorHistory([]);
  };

  const handleNextPage = () => {
    if (data?.meta?.nextCursor) {
      setCursorHistory((prev) => [...prev, cursor || '']);
      setCursor(data.meta.nextCursor);
    }
  };

  const handlePrevPage = () => {
    if (cursorHistory.length > 0) {
      const prev = cursorHistory[cursorHistory.length - 1];
      setCursorHistory((h) => h.slice(0, -1));
      setCursor(prev || undefined);
    }
  };

  const columns: ColumnDef<LeadResource>[] = [
    {
      id: 'fullName',
      header: 'Name',
      accessor: (lead) => (
        <Box>
          <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
            {lead.fullName}
          </Box>
          {lead.duplicateFlag !== 'NONE' && (
            <Chip
              label={`Dup: ${lead.duplicateFlag}`}
              size="small"
              color="warning"
              variant="outlined"
              sx={{ ml: 1, height: 18, fontSize: '0.675rem' }}
            />
          )}
        </Box>
      ),
    },
    {
      id: 'mobileMasked',
      header: 'Mobile (Masked)',
      accessor: (lead) => lead.mobileMasked,
    },
    {
      id: 'productCategory',
      header: 'Product',
      accessor: (lead) => lead.productCategory,
    },
    {
      id: 'indicativeAmount',
      header: 'Indicative Amount',
      accessor: (lead) =>
        lead.indicativeAmount
          ? `${lead.indicativeAmount.currency} ${lead.indicativeAmount.amount}`
          : <NotSet />,
    },
    {
      id: 'state',
      header: 'State',
      accessor: (lead) => <StatusBadge status={lead.state} />,
    },
    {
      id: 'priority',
      header: 'Priority',
      accessor: (lead) => (
        <StatusBadge
          status={
            lead.priority === 'HIGH'
              ? 'error'
              : lead.priority === 'LOW'
                ? 'neutral'
                : 'warning'
          }
          label={lead.priority}
          variant="outlined"
        />
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      accessor: (lead) => (
        <Button
          size="small"
          variant="outlined"
          color="info"
          component={RouterLink}
          to={`/leads/${lead.id}`}
          data-testid={`leads.view.${lead.id}`}
          sx={{
            py: 0.25,
            px: 1.5,
            fontSize: 12,
            borderRadius: 1.5,
            textTransform: 'none',
            fontWeight: 600,
          }}
        >
          View
        </Button>
      ),
    },
  ];

  return (
    <Container maxWidth={false} disableGutters>
      <PageHeader
        title="Leads"
        subtitle="Manage, qualify, and convert loan enquiry leads"
        actions={
          <>
            <Can action="lead.merge">
              <Button
                variant="outlined"
                component={RouterLink}
                to="/leads/duplicates"
                data-testid="leads.duplicates-button"
                sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
              >
                Duplicate reviews
              </Button>
            </Can>
            <Can action="lead.create">
              <Button
                variant="contained"
                color="primary"
                component={RouterLink}
                to="/leads/new"
                data-testid="leads.create-button"
                sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700 }}
              >
                Create Lead
              </Button>
            </Can>
          </>
        }
      />

      <FilterToolbar
        onApply={handleFilterApply}
        onReset={handleFilterReset}
        applyTestId="leads.filter.apply"
        filters={
          <>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="lead-state-filter-label">State</InputLabel>
              <Select
                labelId="lead-state-filter-label"
                value={stateFilter}
                label="State"
                onChange={(e) => setStateFilter(e.target.value)}
                data-testid="leads.filter.state"
                sx={{ borderRadius: 2 }}
              >
                <MenuItem value="">
                  <em>All States</em>
                </MenuItem>
                <MenuItem value="NEW">NEW</MenuItem>
                <MenuItem value="CONTACT_ATTEMPTED">CONTACT_ATTEMPTED</MenuItem>
                <MenuItem value="IN_PROGRESS">IN_PROGRESS</MenuItem>
                <MenuItem value="QUALIFIED">QUALIFIED</MenuItem>
                <MenuItem value="CONVERTED">CONVERTED</MenuItem>
                <MenuItem value="DISQUALIFIED">DISQUALIFIED</MenuItem>
                <MenuItem value="NOT_CONTACTABLE">NOT_CONTACTABLE</MenuItem>
              </Select>
            </FormControl>

            <Box sx={{ minWidth: 220 }}>
              <UserPicker
                multiple={false}
                size="small"
                label="Owner / Staff"
                placeholder="All owners or search..."
                value={ownerFilter || null}
                onChange={(id) => setOwnerFilter(id ?? '')}
                testId="leads.filter.owner"
                freeSolo
              />
            </Box>
          </>
        }
      />

      <DataTable<LeadResource>
        columns={columns}
        data={data?.data ?? []}
        keyExtractor={(lead) => lead.id}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        emptyTitle="No leads found."
        emptyDescription="There are no leads matching your active filters."
        dataTestId="leads.table"
        pagination={{
          hasNextPage: Boolean(data?.meta?.nextCursor),
          hasPrevPage: cursorHistory.length > 0,
          onNext: handleNextPage,
          onPrev: handlePrevPage,
          nextTestId: 'leads.pagination.next',
        }}
      />
    </Container>
  );
}
