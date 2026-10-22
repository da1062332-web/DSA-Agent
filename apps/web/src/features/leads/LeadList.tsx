import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { UserPicker } from '../admin/components';
import { Can } from '../../shell/Can';
import { fetchLeads } from './api';
import type { LeadResource } from './types';

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

  const getStateColor = (state: LeadResource['state']) => {
    switch (state) {
      case 'NEW':
        return 'info';
      case 'CONTACT_ATTEMPTED':
      case 'IN_PROGRESS':
        return 'warning';
      case 'QUALIFIED':
        return 'success';
      case 'CONVERTED':
        return 'primary';
      case 'DISQUALIFIED':
      case 'NOT_CONTACTABLE':
        return 'error';
      default:
        return 'default';
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h4" component="h1" fontWeight="bold">
            Leads
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage, qualify, and convert loan enquiry leads
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Can action="lead.merge">
            <Button
              variant="outlined"
              component={RouterLink}
              to="/leads/duplicates"
              data-testid="leads.duplicates-button"
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
            >
              Create Lead
            </Button>
          </Can>
        </Stack>
      </Stack>

      {/* Filter Bar */}
      <Card sx={{ p: 2, mb: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="lead-state-filter-label">State</InputLabel>
            <Select
              labelId="lead-state-filter-label"
              value={stateFilter}
              label="State"
              onChange={(e) => setStateFilter(e.target.value)}
              data-testid="leads.filter.state"
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

          <Button variant="outlined" onClick={handleFilterApply} data-testid="leads.filter.apply">
            Apply
          </Button>
          <Button variant="text" color="inherit" onClick={handleFilterReset}>
            Reset
          </Button>
        </Stack>
      </Card>

      {/* Error state */}
      {isError && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" onClick={() => refetch()}>
              Retry
            </Button>
          }
        >
          {(error as Error)?.message || 'Failed to load leads'}
        </Alert>
      )}

      {/* Loading state */}
      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {/* Table */}
      {!isLoading && !isError && (
        <Card>
          <TableContainer>
            <Table data-testid="leads.table">
              <TableHead>
                <TableRow>
                  <TableCell>
                    <strong>Name</strong>
                  </TableCell>
                  <TableCell>
                    <strong>Mobile (Masked)</strong>
                  </TableCell>
                  <TableCell>
                    <strong>Product</strong>
                  </TableCell>
                  <TableCell>
                    <strong>Indicative Amount</strong>
                  </TableCell>
                  <TableCell>
                    <strong>State</strong>
                  </TableCell>
                  <TableCell>
                    <strong>Priority</strong>
                  </TableCell>
                  <TableCell align="right">
                    <strong>Actions</strong>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data?.data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                      <Typography variant="body1" color="text.secondary">
                        No leads found.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.data.map((lead) => (
                    <TableRow key={lead.id} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight="medium">
                          {lead.fullName}
                        </Typography>
                        {lead.duplicateFlag !== 'NONE' && (
                          <Chip
                            label={`Dup: ${lead.duplicateFlag}`}
                            size="small"
                            color="warning"
                            variant="outlined"
                            sx={{ mt: 0.5, fontSize: '0.7rem' }}
                          />
                        )}
                      </TableCell>
                      <TableCell>{lead.mobileMasked}</TableCell>
                      <TableCell>{lead.productCategory}</TableCell>
                      <TableCell>
                        {lead.indicativeAmount
                          ? `${lead.indicativeAmount.currency} ${lead.indicativeAmount.amount}`
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <Chip label={lead.state} size="small" color={getStateColor(lead.state)} />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={lead.priority}
                          size="small"
                          variant="outlined"
                          color={
                            lead.priority === 'HIGH'
                              ? 'error'
                              : lead.priority === 'LOW'
                                ? 'default'
                                : 'warning'
                          }
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          component={RouterLink}
                          to={`/leads/${lead.id}`}
                          data-testid={`leads.view.${lead.id}`}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Pagination controls */}
          <Box sx={{ p: 2, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button size="small" disabled={cursorHistory.length === 0} onClick={handlePrevPage}>
              Previous
            </Button>
            <Button
              size="small"
              disabled={!data?.meta?.nextCursor}
              onClick={handleNextPage}
              data-testid="leads.pagination.next"
            >
              Next
            </Button>
          </Box>
        </Card>
      )}
    </Container>
  );
}
