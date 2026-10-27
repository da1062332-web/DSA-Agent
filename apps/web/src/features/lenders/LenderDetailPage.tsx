import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
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
import { DataTable, PageHeader } from '../../ui';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { errorText } from '../../api/client';
import { hasPermission, useMe } from '../../api/useMe';
import {
  createEmpanelment,
  fetchLenderById,
  setLenderContacts,
  updateEmpanelment,
  updateLender,
} from './api';
import type {
  CreateEmpanelmentInput,
  Empanelment,
  EmpanelmentStatus,
  Lender,
  LenderContact,
  LenderStatus,
  LenderType,
  UpdateLenderInput,
} from './types';
import { NotSet } from '../../ui/NotSet';
import { RowAction } from '../../shell/RowAction';

export function LenderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const canManage = hasPermission(me.data, 'lender.manage') || hasPermission(me.data, 'config.manage');

  const [lender, setLender] = useState<Lender | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Edit Profile Dialog
  const [editProfileOpen, setEditProfileOpen] = useState<boolean>(false);
  const [editName, setEditName] = useState<string>('');
  const [editType, setEditType] = useState<LenderType>('BANK');
  const [editRegulatorRef, setEditRegulatorRef] = useState<string>('');
  const [editStatus, setEditStatus] = useState<LenderStatus>('ACTIVE');
  const [editStatusReason, setEditStatusReason] = useState<string>('');
  const [savingProfile, setSavingProfile] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Add Empanelment Dialog
  const [addEmpDialogOpen, setAddEmpDialogOpen] = useState<boolean>(false);
  const [empDsaCode, setEmpDsaCode] = useState<string>('');
  const [empValidFrom, setEmpValidFrom] = useState<string>('');
  const [empValidTo, setEmpValidTo] = useState<string>('');
  const [empCategories, setEmpCategories] = useState<string[]>(['HOME_LOAN']);
  const [empAgreementDocId, setEmpAgreementDocId] = useState<string>('');
  const [savingEmpanelment, setSavingEmpanelment] = useState<boolean>(false);
  const [empError, setEmpError] = useState<string | null>(null);

  // Contacts Management Dialog
  const [contactsDialogOpen, setContactsDialogOpen] = useState<boolean>(false);
  const [contactRows, setContactRows] = useState<
    Array<{
      name: string;
      role: string;
      email: string;
      phone: string;
      channel: string;
      escalationLevel: number;
    }>
  >([]);
  const [savingContacts, setSavingContacts] = useState<boolean>(false);
  const [contactsError, setContactsError] = useState<string | null>(null);

  const loadLender = async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const data = await fetchLenderById(id);
      setLender(data);
      setEditName(data.name);
      setEditType(data.lenderType);
      setEditRegulatorRef(data.regulatorRef || '');
      setEditStatus(data.status);
      setEditStatusReason('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLender();
  }, [id]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lender) return;
    if ((editStatus === 'PAUSED' || editStatus === 'TERMINATED') && !editStatusReason.trim()) {
      setEditError('A reason is required to pause or terminate a lender.');
      return;
    }
    try {
      setSavingProfile(true);
      setEditError(null);
      const input: UpdateLenderInput = {
        name: editName.trim(),
        lenderType: editType,
        regulatorRef: editRegulatorRef.trim() || undefined,
        status: editStatus,
        statusReason: editStatus !== 'ACTIVE' ? editStatusReason.trim() : undefined,
      };
      const updated = await updateLender(lender.id, lender.lockVersion, input);
      setLender(updated);
      setSuccessMsg('Lender profile updated successfully.');
      setEditProfileOpen(false);
    } catch (err) {
      setEditError(errorText(err));
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAddEmpanelment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lender) return;
    if (!empDsaCode.trim()) {
      setEmpError('DSA Code is mandatory.');
      return;
    }
    try {
      setSavingEmpanelment(true);
      setEmpError(null);
      const input: CreateEmpanelmentInput = {
        dsaCode: empDsaCode.trim(),
        validFrom: empValidFrom || undefined,
        validTo: empValidTo || undefined,
        permittedCategories: empCategories,
        agreementDocumentId: empAgreementDocId.trim() || undefined,
      };
      await createEmpanelment(lender.id, input);
      setSuccessMsg(`Empanelment for DSA Code "${empDsaCode.trim()}" created successfully.`);
      setAddEmpDialogOpen(false);
      setEmpDsaCode('');
      setEmpAgreementDocId('');
      await loadLender();
    } catch (err) {
      setEmpError(errorText(err));
    } finally {
      setSavingEmpanelment(false);
    }
  };

  const handleToggleEmpanelmentStatus = async (emp: Empanelment, nextStatus: EmpanelmentStatus) => {
    try {
      setError(null);
      await updateEmpanelment(emp.id, emp.lockVersion, { status: nextStatus });
      setSuccessMsg(`Empanelment ${emp.dsaCode} updated to ${nextStatus}.`);
      await loadLender();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const handleOpenContactsDialog = () => {
    if (!lender) return;
    const existing = lender.contacts ?? [];
    if (existing.length > 0) {
      setContactRows(
        existing.map((c) => ({
          name: c.name,
          role: c.role,
          email: c.email,
          phone: c.phone,
          channel: c.channel,
          escalationLevel: c.escalationLevel,
        })),
      );
    } else {
      setContactRows([
        {
          name: '',
          role: 'Relationship Manager',
          email: '',
          phone: '',
          channel: 'EMAIL',
          escalationLevel: 1,
        },
      ]);
    }
    setContactsError(null);
    setContactsDialogOpen(true);
  };

  const handleSaveContacts = async () => {
    if (!lender) return;
    try {
      setSavingContacts(true);
      setContactsError(null);
      await setLenderContacts(lender.id, lender.lockVersion, {
        contacts: contactRows,
      });
      setSuccessMsg('Lender contacts and escalation hierarchy updated.');
      setContactsDialogOpen(false);
      await loadLender();
    } catch (err) {
      setContactsError(errorText(err));
    } finally {
      setSavingContacts(false);
    }
  };

  const addContactRow = () => {
    setContactRows([
      ...contactRows,
      {
        name: '',
        role: 'Escalation Officer',
        email: '',
        phone: '',
        channel: 'EMAIL',
        escalationLevel: Math.min(contactRows.length + 1, 5),
      },
    ]);
  };

  const updateContactRow = (
    index: number,
    patch: Partial<{
      name: string;
      role: string;
      email: string;
      phone: string;
      channel: string;
      escalationLevel: number;
    }>,
  ) => {
    setContactRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const removeContactRow = (index: number) => {
    setContactRows(contactRows.filter((_, i) => i !== index));
  };

  if (loading) {
    return (
      <Container maxWidth={false} disableGutters sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (!lender) {
    return (
      <Container maxWidth={false} disableGutters>
        <Alert severity="error">Lender not found.</Alert>
        <Button component={RouterLink} to="/lenders" sx={{ mt: 2 }}>
          Back to Lenders
        </Button>
      </Container>
    );
  }

  return (
    <Container maxWidth={false} disableGutters>
      <Button component={RouterLink} to="/lenders" sx={{ mb: 2 }}>
        ← Back to Lender Directory
      </Button>

      {successMsg && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg(null)}>
          {successMsg}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <PageHeader
        title={lender.name}
        badge={
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip label={lender.lenderType} size="small" variant="outlined" />
            <Chip
              label={lender.status}
              size="small"
              color={lender.status === 'ACTIVE' ? 'success' : lender.status === 'PAUSED' ? 'warning' : 'error'}
            />
          </Stack>
        }
        subtitle={`Lock Version: ${lender.lockVersion}`}
        actions={
          canManage && (
            <Button variant="outlined" size="small" onClick={() => setEditProfileOpen(true)}>
              Edit Profile
            </Button>
          )
        }
      />

      {/* Profile Card */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={4}>
              <Typography variant="caption" color="text.secondary">
                Regulator Reference
              </Typography>
              <Typography variant="body1" fontWeight={500}>
                {lender.regulatorRef || 'Not Specified'}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Typography variant="caption" color="text.secondary">
                Global Reference
              </Typography>
              <Typography variant="body1" fontWeight={500}>
                {lender.globalLenderRef || <NotSet />}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Typography variant="caption" color="text.secondary">
                Created At
              </Typography>
              <Typography variant="body1" fontWeight={500}>
                {new Date(lender.createdAt).toLocaleDateString()}
              </Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Empanelment Register */}
      <Card sx={{ mb: 4 }}>
        <CardHeader
          title={
            <Typography variant="h6" fontWeight={700}>
              Empanelment Register
            </Typography>
          }
          subheader="Agreements, DSA codes, permitted loan categories and geographic validity"
          action={
            canManage && (
              <Button
                variant="contained"
                size="small"
                onClick={() => {
                  setEmpError(null);
                  setAddEmpDialogOpen(true);
                }}
              >
                Add Empanelment
              </Button>
            )
          }
        />
        <Divider />
        <DataTable<NonNullable<typeof lender.empanelments>[number]>
          dataTestId="lender.table.empanelments"
          data={lender.empanelments ?? []}
          keyExtractor={(emp) => emp.id}
          emptyMessage="No active empanelment agreements registered. Case submissions will fail the empanelment gate."
          columns={[
            { id: 'code', header: 'DSA Code', render: (emp) => <strong>{emp.dsaCode}</strong> },
            {
              id: 'range',
              header: 'Valid Range',
              render: (emp) => (
                <>
                  {new Date(emp.validFrom).toLocaleDateString()} — {emp.validTo ? new Date(emp.validTo).toLocaleDateString() : 'Indefinite'}
                </>
              ),
            },
            {
              id: 'categories',
              header: 'Permitted Categories',
              render: (emp) => (
                <Stack direction="row" spacing={0.5} flexWrap="wrap">
                  {emp.permittedCategories?.map((c: string) => (
                    <Chip key={c} label={c} size="small" />
                  ))}
                </Stack>
              ),
            },
            { id: 'agreement', header: 'Agreement Ref', render: (emp) => emp.agreementDocumentId || <NotSet /> },
            {
              id: 'status',
              header: 'Status',
              render: (emp) => <Chip label={emp.status} size="small" color={emp.status === 'ACTIVE' ? 'success' : 'warning'} />,
            },
            {
              id: 'actions',
              header: 'Actions',
              align: 'right',
              render: (emp) => (
                <>
                  <RowAction allowed={canManage && emp.status === 'ACTIVE'}>
                    <Button size="small" color="warning" onClick={() => handleToggleEmpanelmentStatus(emp, 'SUSPENDED')}>
                      Suspend
                    </Button>
                  </RowAction>
                  <RowAction allowed={canManage && emp.status === 'SUSPENDED'}>
                    <Button size="small" color="success" onClick={() => handleToggleEmpanelmentStatus(emp, 'ACTIVE')}>
                      Reactivate
                    </Button>
                  </RowAction>
                </>
              ),
            },
          ]}
        />
      </Card>

      {/* Contacts & Escalation Matrix */}
      <Card>
        <CardHeader
          title={
            <Typography variant="h6" fontWeight={700}>
              Contacts & Escalation Matrix
            </Typography>
          }
          subheader="Relationship managers and escalation hierarchy levels 1 to 5"
          action={
            canManage && (
              <Button variant="outlined" size="small" onClick={handleOpenContactsDialog}>
                Manage Contacts
              </Button>
            )
          }
        />
        <Divider />
        <DataTable<NonNullable<typeof lender.contacts>[number]>
          dataTestId="lender.table.contacts"
          data={lender.contacts ?? []}
          keyExtractor={(c) => c.id}
          emptyMessage="No contacts registered for this lender."
          columns={[
            {
              id: 'level',
              header: 'Escalation Level',
              render: (c) => <Chip label={`Level ${c.escalationLevel}`} size="small" color="primary" />,
            },
            { id: 'name', header: 'Contact Name', render: (c) => <strong>{c.name}</strong> },
            { id: 'role', header: 'Role', render: (c) => c.role },
            { id: 'channel', header: 'Channel', render: (c) => c.channel },
            { id: 'email', header: 'Email', render: (c) => c.email },
            { id: 'phone', header: 'Phone', render: (c) => c.phone },
          ]}
        />
      </Card>

      {/* Edit Profile Modal */}
      <Dialog open={editProfileOpen} onClose={() => setEditProfileOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleSaveProfile}>
          <DialogTitle>Edit Lender Profile</DialogTitle>
          <DialogContent>
            {editError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {editError}
              </Alert>
            )}
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                required
                fullWidth
                label="Lender Legal Name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
              <FormControl fullWidth>
                <InputLabel>Lender Type</InputLabel>
                <Select
                  value={editType}
                  label="Lender Type"
                  onChange={(e) => setEditType(e.target.value as LenderType)}
                >
                  <MenuItem value="BANK">Commercial Bank</MenuItem>
                  <MenuItem value="NBFC">NBFC</MenuItem>
                  <MenuItem value="HFC">Housing Finance Company (HFC)</MenuItem>
                </Select>
              </FormControl>
              <TextField
                fullWidth
                label="RBI / Regulator Reference"
                value={editRegulatorRef}
                onChange={(e) => setEditRegulatorRef(e.target.value)}
              />
              <FormControl fullWidth>
                <InputLabel>Standing Status</InputLabel>
                <Select
                  value={editStatus}
                  label="Standing Status"
                  onChange={(e) => setEditStatus(e.target.value as LenderStatus)}
                >
                  <MenuItem value="ACTIVE">Active</MenuItem>
                  <MenuItem value="PAUSED">Paused</MenuItem>
                  <MenuItem value="TERMINATED">Terminated</MenuItem>
                </Select>
              </FormControl>
              {(editStatus === 'PAUSED' || editStatus === 'TERMINATED') && (
                <TextField
                  fullWidth
                  required
                  label="Status Change Reason"
                  value={editStatusReason}
                  onChange={(e) => setEditStatusReason(e.target.value)}
                  placeholder="Explain why this lender is paused or terminated"
                  helperText="Required when setting status to Paused or Terminated"
                />
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditProfileOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={savingProfile}>
              {savingProfile ? <CircularProgress size={24} /> : 'Save Changes'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Add Empanelment Modal */}
      <Dialog open={addEmpDialogOpen} onClose={() => setAddEmpDialogOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleAddEmpanelment}>
          <DialogTitle>Add Empanelment Agreement</DialogTitle>
          <DialogContent>
            {empError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {empError}
              </Alert>
            )}
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                required
                fullWidth
                label="DSA Code"
                placeholder="e.g. HDFC-DSA-9874"
                value={empDsaCode}
                onChange={(e) => setEmpDsaCode(e.target.value)}
              />
              <TextField
                fullWidth
                type="date"
                label="Valid From"
                InputLabelProps={{ shrink: true }}
                value={empValidFrom}
                onChange={(e) => setEmpValidFrom(e.target.value)}
              />
              <TextField
                fullWidth
                type="date"
                label="Valid To (Optional)"
                InputLabelProps={{ shrink: true }}
                value={empValidTo}
                onChange={(e) => setEmpValidTo(e.target.value)}
              />
              <FormControl fullWidth>
                <InputLabel>Permitted Product Categories</InputLabel>
                <Select
                  multiple
                  value={empCategories}
                  label="Permitted Product Categories"
                  onChange={(e) =>
                    setEmpCategories(typeof e.target.value === 'string' ? [e.target.value] : e.target.value)
                  }
                  renderValue={(selected) => selected.join(', ')}
                >
                  <MenuItem value="HOME_LOAN">Home Loan</MenuItem>
                  <MenuItem value="LAP">Loan Against Property (LAP)</MenuItem>
                  <MenuItem value="BUSINESS_LOAN">Business Loan</MenuItem>
                  <MenuItem value="PERSONAL_LOAN">Personal Loan</MenuItem>
                </Select>
              </FormControl>
              <TextField
                fullWidth
                label="Agreement Document ID / Storage Ref"
                placeholder="e.g. doc_empanelment_agreement_2026.pdf"
                value={empAgreementDocId}
                onChange={(e) => setEmpAgreementDocId(e.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAddEmpDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={savingEmpanelment}>
              {savingEmpanelment ? <CircularProgress size={24} /> : 'Add Empanelment'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Contacts Management Dialog */}
      <Dialog open={contactsDialogOpen} onClose={() => setContactsDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Manage Lender Contacts & Escalation Matrix</DialogTitle>
        <DialogContent>
          {contactsError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {contactsError}
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
            {contactRows.map((row, index) => (
              <Paper key={index} sx={{ p: 2, bgcolor: 'grey.50' }} variant="outlined">
                <Grid container spacing={2} alignItems="center">
                  <Grid item xs={12} sm={3}>
                    <TextField
                      required
                      fullWidth
                      size="small"
                      label="Contact Name"
                      value={row.name}
                      onChange={(e) => updateContactRow(index, { name: e.target.value })}
                    />
                  </Grid>
                  <Grid item xs={12} sm={3}>
                    <TextField
                      required
                      fullWidth
                      size="small"
                      label="Role"
                      value={row.role}
                      onChange={(e) => updateContactRow(index, { role: e.target.value })}
                    />
                  </Grid>
                  <Grid item xs={12} sm={2}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Level</InputLabel>
                      <Select
                        value={row.escalationLevel}
                        label="Level"
                        onChange={(e) => updateContactRow(index, { escalationLevel: Number(e.target.value) })}
                      >
                        {[1, 2, 3, 4, 5].map((lvl) => (
                          <MenuItem key={lvl} value={lvl}>
                            Level {lvl}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={2}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Channel</InputLabel>
                      <Select
                        value={row.channel}
                        label="Channel"
                        onChange={(e) => updateContactRow(index, { channel: String(e.target.value) })}
                      >
                        <MenuItem value="EMAIL">Email</MenuItem>
                        <MenuItem value="PHONE">Phone</MenuItem>
                        <MenuItem value="PORTAL">Portal</MenuItem>
                        <MenuItem value="IN_PERSON">In Person</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={3}>
                    <TextField
                      required
                      fullWidth
                      size="small"
                      label="Email"
                      value={row.email}
                      onChange={(e) => updateContactRow(index, { email: e.target.value })}
                    />
                  </Grid>
                  <Grid item xs={12} sm={3}>
                    <TextField
                      required
                      fullWidth
                      size="small"
                      label="Phone"
                      value={row.phone}
                      onChange={(e) => updateContactRow(index, { phone: e.target.value })}
                    />
                  </Grid>
                  <Grid item xs={12} sm={1}>
                    <Button
                      color="error"
                      size="small"
                      onClick={() => removeContactRow(index)}
                      disabled={contactRows.length === 1}
                    >
                      Remove
                    </Button>
                  </Grid>
                </Grid>
              </Paper>
            ))}
            <Button variant="outlined" onClick={addContactRow} sx={{ alignSelf: 'flex-start' }}>
              + Add Contact
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setContactsDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveContacts} variant="contained" disabled={savingContacts}>
            {savingContacts ? <CircularProgress size={24} /> : 'Save Contacts Matrix'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
