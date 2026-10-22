// The document checklist of one application (owner: Dev 3; DSA Notion MODULE 20, API-APP-007 and API-APP-008). Each row offers the
// document actions this user may take (upload, view, review, waive: ChecklistItemActions); customers can also upload through
// Document sharing. "Check completeness" asks the API whether every mandatory item is accepted, waived or not applicable.
import {
  Alert,
  Button,
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
import { useMutation } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import { ErrorAlert, Loading } from '../admin/components';
import { checkCompleteness, useChecklist } from './api';
import { ChecklistItemActions } from './ChecklistItemActions';
import { groupByParty, nextAction, progressText, readable, STATUS_LABELS, statusTone } from './model';

export function ChecklistCard({ applicationId }: { applicationId: string }) {
  const q = useChecklist(applicationId);
  const check = useMutation({ meta: { silent: true }, mutationFn: () => checkCompleteness(applicationId) });
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
                      <TableCell>Actions</TableCell>
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
                        <TableCell>
                          <ChecklistItemActions item={i} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ))}
            {check.data && (
              <Alert
                severity={check.data.result === 'COMPLETE' ? 'success' : 'warning'}
                sx={{ mb: 2 }}
                data-testid="documents.completeness-result"
              >
                {check.data.result === 'COMPLETE'
                  ? 'Complete: every mandatory document is accepted, waived or not applicable.'
                  : `Incomplete: ${check.data.reasons.map((r) => readable(r.text)).join('; ')}.`}
              </Alert>
            )}
            <ErrorAlert error={check.error} />
            <Stack direction="row" spacing={2} alignItems="center">
              <Button
                size="small"
                variant="outlined"
                disabled={check.isPending}
                onClick={() => check.mutate()}
                data-testid="documents.check-completeness"
              >
                Check completeness
              </Button>
              <RouterLink to="/document-sharing">Document sharing</RouterLink>
              <RouterLink to="/verifications">Verification</RouterLink>
            </Stack>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
