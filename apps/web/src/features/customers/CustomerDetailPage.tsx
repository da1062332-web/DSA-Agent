// /customers/:id (owner: Dev 5; DSA Notion MODULE 8; QA plan Modules 06 and 14). The customer profile with masked contact
// points, its loan applications (with a secure document-upload link for each), consents and grievances.
import { useState } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  Link,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { getCustomer, updateCustomer, ApiError } from './api';
import { Can } from '../../shell/Can';
import { BranchSelect } from '../../shell/selectors';
import { BranchName } from '../../shell/display';
import { DetailCard, PageHeader } from '../../ui';
import { hasPermission, useMe } from '../../api/useMe';
import { useLookup } from '../admin/api';
import { STATUS_LABELS } from '../applications/rules';
import type { Application } from '../applications/ApplicationsPage';

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const me = useMe();
  const canReadApps = hasPermission(me.data, 'application.read');
  const canLink = hasPermission(me.data, 'document.upload');
  const canComplain =
    hasPermission(me.data, 'complaint.create') || hasPermission(me.data, 'complaint.manage');
  // The list endpoint has no customer filter, so the customer's applications are picked out of the caller's scope.
  const apps = useLookup<Application>('/v1/applications', {}, canReadApps);

  const [editOpen, setEditOpen] = useState(false);
  const [editFullName, setEditFullName] = useState('');
  const [editHomeBranchId, setEditHomeBranchId] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => (id ? getCustomer(id) : Promise.reject(new Error('Missing customer id'))),
    enabled: !!id,
  });

  const customer = data?.customer;
  const etag = data?.etag;

  const updateMutation = useMutation({
    mutationFn: (variables: { fullName?: string; homeBranchId?: string }) => {
      if (!id) throw new Error('Missing customer ID');
      return updateCustomer(id, variables, etag);
    },
    onSuccess: () => {
      setSuccessMessage('Customer profile updated successfully.');
      setErrorMessage(null);
      setEditOpen(false);
      queryClient.invalidateQueries({ queryKey: ['customer', id] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setErrorMessage(`${err.code}: ${err.message}`);
      } else {
        setErrorMessage((err as Error).message);
      }
    },
  });

  const handleOpenEdit = () => {
    if (customer) {
      setEditFullName(customer.fullName);
      setEditHomeBranchId(customer.homeBranchId || '');
      setEditOpen(true);
    }
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      fullName: editFullName,
      homeBranchId: editHomeBranchId || undefined,
    });
  };

  if (isLoading) {
    return (
      <Container maxWidth="lg" sx={{ py: 8, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (isError || !customer) {
    return (
      <Container maxWidth="lg" sx={{ py: 6 }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          {(error as Error)?.message || 'Customer profile not found.'}
        </Alert>
        <Button component={RouterLink} to="/customers">
          ← Back to Customers List
        </Button>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Top Navigation */}
      <Button component={RouterLink} to="/customers" sx={{ mb: 3 }}>
        ← Back to Customers
      </Button>

      <PageHeader
        title={customer.fullName}
        backTo="/customers"
        badge={
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              size="small"
              label={customer.partyType}
              color={customer.partyType === 'INDIVIDUAL' ? 'primary' : 'secondary'}
              variant="outlined"
            />
            <Chip
              size="small"
              label={customer.status}
              color={customer.status === 'ACTIVE' ? 'success' : 'default'}
            />
          </Stack>
        }
        subtitle={
          <Typography variant="body2" color="text.secondary">
            Customer ID: <strong>{customer.id}</strong> · Lock Version: {customer.lockVersion}
          </Typography>
        }
        actions={
          <Stack direction="row" spacing={1.5}>
            <Can action="customer.update">
              <Button variant="outlined" onClick={handleOpenEdit}>
                Edit Profile
              </Button>
            </Can>
            <Button
              variant="contained"
              color="secondary"
              component={RouterLink}
              to={`/customers/${customer.id}/consents`}
            >
              Manage Consents
            </Button>
          </Stack>
        }
      />

      {/* Notifications */}
      {successMessage && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccessMessage(null)}>
          {successMessage}
        </Alert>
      )}
      {errorMessage && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            errorMessage.includes('VERSION_CONFLICT') ? (
              <Button color="inherit" size="small" onClick={() => refetch()}>
                Refresh
              </Button>
            ) : undefined
          }
          onClose={() => setErrorMessage(null)}
        >
          {errorMessage}
        </Alert>
      )}

      {/* Profile Details Grid */}
      <Grid container spacing={3}>
        {/* Personal Details Card */}
        <Grid item xs={12} md={6}>
          <DetailCard title="Personal & Party Details">
              <Stack spacing={2}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Full Legal Name
                  </Typography>
                  <Typography variant="body1" fontWeight={500}>
                    {customer.fullName}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Party Type
                  </Typography>
                  <Typography variant="body1">{customer.partyType}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Primary Home Branch
                  </Typography>
                  <Box sx={{ mt: 0.5 }}>
                    <BranchName id={customer.homeBranchId} fallback="Not Assigned" typographyProps={{ variant: 'body1', fontWeight: 500 }} />
                  </Box>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Account Status
                  </Typography>
                  <Typography variant="body1">{customer.status}</Typography>
                </Box>
              </Stack>
          </DetailCard>
        </Grid>

        {/* Contact and DPDP Privacy Card */}
        <Grid item xs={12} md={6}>
          <DetailCard title="Contact & DPDP Masking">
              <Stack spacing={2}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Primary Mobile (Masked per DPDP §8)
                  </Typography>
                  <Typography variant="body1" fontWeight={500}>
                    {customer.primaryMobileMasked || '—'}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Primary Email (Masked)
                  </Typography>
                  <Typography variant="body1">{customer.primaryEmailMasked || '—'}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Profile Created
                  </Typography>
                  <Typography variant="body1">{new Date(customer.createdAt).toLocaleString()}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Last Profile Update
                  </Typography>
                  <Typography variant="body1">{new Date(customer.updatedAt).toLocaleString()}</Typography>
                </Box>
              </Stack>
          </DetailCard>
        </Grid>

        {/* DPDP Consents Lifecycle Card */}
        <Grid item xs={12} md={6}>
          <Card sx={{ borderRadius: 2, border: 1, borderColor: 'secondary.light' }}>
            <CardContent>
              <Typography variant="h6" fontWeight="bold" sx={{ mb: 1 }}>
                Consent Management
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Review active and historical borrower consent notices, purposes (contact, loan processing,
                verification checks), and record withdrawals.
              </Typography>
              <Button
                variant="outlined"
                color="secondary"
                component={RouterLink}
                to={`/customers/${customer.id}/consents`}
              >
                View & Record Consents →
              </Button>
            </CardContent>
          </Card>
        </Grid>

        {/* Loan applications of this customer (QA Module 06 step 7, Module 14 step 2) */}
        {canReadApps && (
          <Grid item xs={12}>
            <Card sx={{ borderRadius: 2 }} data-testid="customer.applications">
              <CardContent>
                <Typography variant="h6" fontWeight="bold" sx={{ mb: 1 }}>
                  Loan Applications
                </Typography>
                <Divider sx={{ mb: 1 }} />
                {apps.isLoading ? (
                  <CircularProgress size={24} />
                ) : (apps.data ?? []).filter((a) => a.customerId === customer.id).length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No applications in your scope for this customer.
                  </Typography>
                ) : (
                  <List dense disablePadding>
                    {(apps.data ?? [])
                      .filter((a) => a.customerId === customer.id)
                      .map((a) => (
                        <ListItem
                          key={a.id}
                          disableGutters
                          divider
                          secondaryAction={
                            canLink ? (
                              <Button
                                size="small"
                                component={RouterLink}
                                to={`/document-sharing?applicationId=${encodeURIComponent(a.id)}&action=upload-link`}
                                data-testid="customer.upload-link"
                              >
                                Send upload link
                              </Button>
                            ) : undefined
                          }
                        >
                          <ListItemText
                            primary={
                              <Link component={RouterLink} to={`/applications/${a.id}`}>
                                {a.id}
                              </Link>
                            }
                            secondary={`${a.productCategory} · ${a.currency} ${a.requestedAmount} · ${STATUS_LABELS[a.status] ?? a.status}`}
                          />
                        </ListItem>
                      ))}
                  </List>
                )}
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Customer Grievances & Complaints Card */}
        {canComplain && (
          <Grid item xs={12} md={6}>
            <Card sx={{ borderRadius: 2, border: 1, borderColor: 'warning.light' }}>
              <CardContent>
                <Typography variant="h6" fontWeight="bold" sx={{ mb: 1 }}>
                  Grievances & Complaints
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Track service tickets, fee disputes, and escalate borrower grievances directly to the
                  Grievances module (MOD-GRV).
                </Typography>
                <Button
                  variant="outlined"
                  color="warning"
                  component={RouterLink}
                  to={`/complaints?complainantType=CUSTOMER&complainantId=${customer.id}`}
                >
                  View Customer Grievances →
                </Button>
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>

      {/* Edit Customer Dialog */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleSaveEdit}>
          <DialogTitle>Edit Customer Profile</DialogTitle>
          <DialogContent>
            <Stack spacing={3} sx={{ mt: 1 }}>
              <TextField
                label="Full Legal Name"
                fullWidth
                required
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
              />
              <BranchSelect
                label="Home Branch"
                allowNone
                value={editHomeBranchId || null}
                onChange={(id) => setEditHomeBranchId(id ?? '')}
                helperText="Primary branch responsible for servicing this customer"
                size="medium"
                fullWidth
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Container>
  );
}
