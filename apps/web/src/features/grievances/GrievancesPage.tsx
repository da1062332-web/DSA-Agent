import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Container,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import type {
  ComplainantType,
  Complaint,
  ComplaintCategory,
  ComplaintChannel,
  ComplaintStatus,
} from './types';

export function GrievancesPage({ initialTab = 0 }: { initialTab?: number } = {}) {
  const [activeTab, setActiveTab] = useState<number>(initialTab);

  // Simulated intake form state (for UI verification)
  const [complainantType, setComplainantType] = useState<ComplainantType>('CUSTOMER');
  const [complainantName, setComplainantName] = useState<string>('Rajesh Sharma');
  const [complainantId, setComplainantId] = useState<string>('cust_demo_8971');
  const [channel, setChannel] = useState<ComplaintChannel>('PORTAL');
  const [category, setCategory] = useState<ComplaintCategory>('DELAY_IN_DISBURSEMENT');
  const [description, setDescription] = useState<string>(
    'Loan sanction letter received 14 days ago, but disbursement tranche not yet credited by lender.',
  );
  const [submittedAck, setSubmittedAck] = useState<string | null>(null);

  // Mock queue demonstrating documented queue CMP-GRV.02.1
  const [queue] = useState<Complaint[]>([
    {
      id: 'cmp_001',
      tenantId: 'tnt_default',
      ackRef: 'GRV-2026-00084',
      complainantType: 'CUSTOMER',
      complainantId: 'cust_4821',
      complainantName: 'Amit Verma',
      channel: 'PORTAL',
      category: 'DELAY_IN_DISBURSEMENT',
      description: 'Disbursement delay for HDFC Home Loan application.',
      status: 'IN_REVIEW',
      ownerId: 'usr_compliance_lead',
      dueAt: new Date(Date.now() + 86400000 * 2).toISOString(),
      createdAt: new Date().toISOString(),
    },
    {
      id: 'cmp_002',
      tenantId: 'tnt_default',
      ackRef: 'GRV-2026-00085',
      complainantType: 'CONNECTOR',
      complainantId: 'con_003',
      complainantName: 'Sunil Mehta (Partner)',
      channel: 'EMAIL',
      category: 'INCORRECT_CHARGES',
      description: 'Lender charged ₹2,500 additional legal inspection fee.',
      status: 'REFERRED_TO_LENDER',
      ownerId: 'usr_ops_01',
      dueAt: new Date(Date.now() + 86400000 * 4).toISOString(),
      createdAt: new Date(Date.now() - 86400000).toISOString(),
    },
  ]);

  const handleSimulateIntake = (e: React.FormEvent) => {
    e.preventDefault();
    const ack = `GRV-2026-${Math.floor(10000 + Math.random() * 90000)}`;
    setSubmittedAck(ack);
  };

  const getStatusColor = (status: ComplaintStatus) => {
    switch (status) {
      case 'SUBMITTED':
        return 'default';
      case 'IN_REVIEW':
        return 'warning';
      case 'REFERRED_TO_LENDER':
        return 'info';
      case 'RESOLVED':
        return 'success';
      case 'CLOSED':
        return 'default';
      default:
        return 'default';
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Grievances & Customer Complaints
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Module 13 — Grievance intake, SLA tracking, lender referrals, and escalation management (MOD-GRV)
          </Typography>
        </Box>
        <Chip label="Deferred R2 / TASK-427" color="warning" variant="outlined" />
      </Stack>

      <Alert severity="info" sx={{ mb: 3 }}>
        <strong>Canonical Scope Notice:</strong> In accordance with the canonical Notion specification for{' '}
        <strong>MODULE 13 — Grievances (MOD-GRV)</strong>, this subsystem has an MVP owner of{' '}
        <em>"none (deferred, TASK-427)"</em> with target priority <strong>P1 / R2</strong> (Release 2).
        Backend endpoints (<code>POST /v1/complaints</code>, <code>GET /v1/complaints</code>) are scheduled for
        R2 implementation once CRM Customers (MOD-CUST) and Tasks (MOD-TASK) are fully unified.
      </Alert>

      <Paper sx={{ mb: 3 }}>
        <Tabs value={activeTab} onChange={(_, val) => setActiveTab(val)}>
          <Tab label="1. Complaint Queue & SLA Tracking (CMP-GRV.02.1)" />
          <Tab label="2. Complaint Intake Form (CMP-GRV.01.1)" />
        </Tabs>
      </Paper>

      {activeTab === 0 && (
        <Card>
          <CardHeader
            title="Complaint Resolution & SLA Queue (CMP-GRV.02.1)"
            subheader="Monitors complaint owner, due date, lender referral, and resolution status"
          />
          <Divider />
          <TableContainer>
            <Table>
              <TableHead sx={{ bgcolor: 'grey.50' }}>
                <TableRow>
                  <TableCell><strong>Ack Ref</strong></TableCell>
                  <TableCell><strong>Complainant</strong></TableCell>
                  <TableCell><strong>Type</strong></TableCell>
                  <TableCell><strong>Channel</strong></TableCell>
                  <TableCell><strong>Category</strong></TableCell>
                  <TableCell><strong>Status</strong></TableCell>
                  <TableCell><strong>SLA Due Date</strong></TableCell>
                  <TableCell align="right"><strong>Action</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {queue.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell><strong>{c.ackRef}</strong></TableCell>
                    <TableCell>{c.complainantName}</TableCell>
                    <TableCell>
                      <Chip label={c.complainantType} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell>{c.channel}</TableCell>
                    <TableCell>{c.category.replace(/_/g, ' ')}</TableCell>
                    <TableCell>
                      <Chip label={c.status} size="small" color={getStatusColor(c.status)} />
                    </TableCell>
                    <TableCell>{new Date(c.dueAt).toLocaleDateString()}</TableCell>
                    <TableCell align="right">
                      <Button size="small" variant="outlined" disabled>
                        Review (R2)
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      {activeTab === 1 && (
        <Card>
          <CardHeader
            title="Complaint Intake Form (CMP-GRV.01.1)"
            subheader="Records customer complaints, issues acknowledgment reference, and attaches lender referrals"
          />
          <Divider />
          <CardContent>
            {submittedAck && (
              <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSubmittedAck(null)}>
                Complaint registered with Acknowledgement Reference: <strong>{submittedAck}</strong>.
                Notification issued to customer. (Simulation Preview)
              </Alert>
            )}

            <form onSubmit={handleSimulateIntake}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={4}>
                  <FormControl fullWidth>
                    <InputLabel>Complainant Type</InputLabel>
                    <Select
                      value={complainantType}
                      label="Complainant Type"
                      onChange={(e) => setComplainantType(e.target.value as ComplainantType)}
                    >
                      <MenuItem value="CUSTOMER">Primary Applicant / Customer</MenuItem>
                      <MenuItem value="CO_APPLICANT">Co-Applicant</MenuItem>
                      <MenuItem value="CONNECTOR">Connector / Channel Partner</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    required
                    fullWidth
                    label="Complainant Name"
                    value={complainantName}
                    onChange={(e) => setComplainantName(e.target.value)}
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    required
                    fullWidth
                    label="Complainant Customer ID"
                    value={complainantId}
                    onChange={(e) => setComplainantId(e.target.value)}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Submission Channel</InputLabel>
                    <Select
                      value={channel}
                      label="Submission Channel"
                      onChange={(e) => setChannel(e.target.value as ComplaintChannel)}
                    >
                      <MenuItem value="PORTAL">Customer Portal</MenuItem>
                      <MenuItem value="EMAIL">Support Email</MenuItem>
                      <MenuItem value="PHONE">Phone / Helpline</MenuItem>
                      <MenuItem value="IN_PERSON">Branch / In Person</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Complaint Category</InputLabel>
                    <Select
                      value={category}
                      label="Complaint Category"
                      onChange={(e) => setCategory(e.target.value as ComplaintCategory)}
                    >
                      <MenuItem value="DELAY_IN_DISBURSEMENT">Delay in Disbursement</MenuItem>
                      <MenuItem value="INCORRECT_CHARGES">Incorrect Processing Fee / Charges</MenuItem>
                      <MenuItem value="LENDER_MISCOMMUNICATION">Lender Miscommunication</MenuItem>
                      <MenuItem value="DOCUMENT_MISPLACEMENT">Document Misplacement</MenuItem>
                      <MenuItem value="STAFF_BEHAVIOUR">Staff Conduct / SLA Breach</MenuItem>
                      <MenuItem value="OTHER">Other Issue</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    required
                    fullWidth
                    multiline
                    rows={4}
                    label="Detailed Grievance Description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </Grid>
                <Grid item xs={12}>
                  <Button type="submit" variant="contained">
                    Generate Acknowledgement Reference (Preview)
                  </Button>
                </Grid>
              </Grid>
            </form>
          </CardContent>
        </Card>
      )}
    </Container>
  );
}
