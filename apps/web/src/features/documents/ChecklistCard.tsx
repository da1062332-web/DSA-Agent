// The document checklist of one application (owner: Dev 3, MOD-DOC checklist slice, API-APP-007). Read only: items move through
// document sharing (customer upload) and verification (reviewer attestation); upload, storage and scanning are TASK-401.
import {
  Alert,
  Card,
  CardContent,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { ErrorAlert, Loading } from '../admin/components';
import { useChecklist } from './api';
import { groupByParty, nextAction, progressText, readable, STATUS_LABELS, statusTone } from './model';

export function ChecklistCard({ applicationId }: { applicationId: string }) {
  const q = useChecklist(applicationId);
  return (
    <Card sx={{ mt: 3 }} data-testid="checklist-card">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Documents
        </Typography>
        <ErrorAlert error={q.error} />
        {q.isLoading ? (
          <Loading />
        ) : q.data ? (
          <>
            <Alert
              severity={q.data.summary.complete ? 'success' : q.data.summary.total === 0 ? 'info' : 'warning'}
              sx={{ mb: 2 }}
            >
              {progressText(q.data.summary)}
            </Alert>
            {groupByParty(q.data.data).map((g) => (
              <TableContainer key={g.partyId} sx={{ mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
                  Applicant {g.partyId}
                </Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Document</TableCell>
                      <TableCell>Required</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Next step</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {g.items.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell>
                          {readable(i.documentTypeCode)}
                          {i.requiredCount > 1 ? ` (${i.requiredCount})` : ''}
                          {i.periodMonths ? `, last ${i.periodMonths} months` : ''}
                        </TableCell>
                        <TableCell>{i.mandatory ? 'Yes' : 'Optional'}</TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Chip size="small" color={statusTone(i.status)} label={STATUS_LABELS[i.status]} />
                            {i.rejectReason && (
                              <Typography variant="caption">{readable(i.rejectReason)}</Typography>
                            )}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.secondary">
                            {nextAction(i) ?? '-'}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ))}
            <Stack direction="row" spacing={2}>
              <RouterLink to="/document-sharing">Document sharing</RouterLink>
              <RouterLink to="/verifications">Verification</RouterLink>
            </Stack>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
