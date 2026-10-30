// apps/web/src/features/lender-cases/LenderCaseDetailPage.tsx — owner: Dev 4 (MOD-LCS Case Detail)
import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Chip, CircularProgress, Container, Grid, Stack, Tab, Tabs, Typography } from '@mui/material';
import {
  fetchLenderCase,
  fetchLenderCaseHistory,
  fetchLenderCaseQueries,
  fetchSubmissionPackage,
} from './api';
import { LenderCasePanel } from './LenderCasePanel';
import { ApplicationName, LenderName, UserName } from '../../shell/display';
import { AppCard, DataTable, PageHeader, type ColumnDef } from '../../ui';
import { NotSet } from '../../ui/NotSet';

type TabKey = 'overview' | 'package' | 'queries' | 'history';

const TAB_LABELS: Record<TabKey, string> = {
  overview: 'Overview',
  package: 'Package & Documents',
  queries: 'Queries',
  history: 'Status History',
};

/** Shows an enum value readably, e.g. UNDER_PROCESSING → "under processing". */
const readable = (value: string | null | undefined): string => (value ? value.replace(/_/g, ' ').toLowerCase() : '');

const dateTime = (iso: string | null | undefined): React.ReactNode =>
  iso ? new Date(iso).toLocaleString() : <NotSet />;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Typography variant="body2">
      <strong>{label}:</strong> {children}
    </Typography>
  );
}

export function LenderCaseDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>('overview');

  const caseQuery = useQuery({
    queryKey: ['lender-case', id],
    queryFn: () => (id ? fetchLenderCase(id) : Promise.reject(new Error('Missing ID'))),
    enabled: !!id,
  });
  const c = caseQuery.data?.case;

  const queriesQuery = useQuery({
    queryKey: ['lender-case-queries', id],
    queryFn: () => fetchLenderCaseQueries(id!),
    enabled: !!id && tab === 'queries',
  });

  const historyQuery = useQuery({
    queryKey: ['lender-case-history', id],
    queryFn: () => fetchLenderCaseHistory(id!),
    enabled: !!id && tab === 'history',
  });

  const packageQuery = useQuery({
    queryKey: ['lender-case-package', id],
    queryFn: () => fetchSubmissionPackage(id!),
    enabled: !!id && tab === 'package' && !!c?.packageId,
  });

  if (caseQuery.isLoading) {
    return (
      <Container maxWidth={false} disableGutters sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (caseQuery.error || !c) {
    return (
      <Container maxWidth={false} disableGutters>
        <Alert severity="error">Failed to load lender case details.</Alert>
      </Container>
    );
  }

  const queryColumns: ColumnDef<NonNullable<typeof queriesQuery.data>[number]>[] = [
    { id: 'raised', header: 'Raised', render: (q) => dateTime(q.createdAt) },
    { id: 'raisedBy', header: 'Raised by', render: (q) => <UserName id={q.createdBy} /> },
    {
      id: 'question',
      header: 'Question',
      render: (q) => (
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
          {q.text}
        </Typography>
      ),
    },
    {
      id: 'requested',
      header: 'Requested',
      render: (q) =>
        q.requestedItems.length === 0 ? (
          <NotSet />
        ) : (
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
            {q.requestedItems.map((item) => (
              <Chip key={item} label={readable(item)} size="small" variant="outlined" />
            ))}
          </Stack>
        ),
    },
    { id: 'due', header: 'Lender due', render: (q) => (q.lenderDueDate ? new Date(q.lenderDueDate).toLocaleDateString() : <NotSet />) },
    {
      id: 'state',
      header: 'Status',
      render: (q) =>
        q.respondedAt ? (
          <Chip label="Answered" size="small" color="success" />
        ) : (
          <Chip label="Open" size="small" color="warning" />
        ),
    },
    {
      id: 'answer',
      header: 'Answer',
      render: (q) =>
        q.responseText ? (
          <Box>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {q.responseText}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Answered {dateTime(q.respondedAt)}
              {q.responseDocumentReferences.length > 0
                ? ` · ${q.responseDocumentReferences.length} document${q.responseDocumentReferences.length === 1 ? '' : 's'} sent`
                : ''}
            </Typography>
          </Box>
        ) : (
          <NotSet />
        ),
    },
  ];

  const historyColumns: ColumnDef<NonNullable<typeof historyQuery.data>[number]>[] = [
    { id: 'when', header: 'When', render: (h) => dateTime(h.occurredAt) },
    {
      id: 'change',
      header: 'Change',
      render: (h) => (
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
          <Chip label={h.fromStatus ? readable(h.fromStatus) : 'new attempt'} size="small" variant="outlined" />
          <Typography variant="caption">→</Typography>
          <Chip label={readable(h.toStatus)} size="small" color="primary" />
        </Stack>
      ),
    },
    { id: 'source', header: 'Source', render: (h) => readable(h.statusSource) },
    { id: 'reason', header: 'Reason', render: (h) => h.reasonText || <NotSet /> },
    { id: 'by', header: 'By', render: (h) => <UserName id={h.actor} /> },
  ];

  const documents = (packageQuery.data?.manifest.documents ?? []) as { documentTypeCode: string; sha256: string }[];
  const waiverCount = Array.isArray(packageQuery.data?.manifest.waivers)
    ? (packageQuery.data?.manifest.waivers as unknown[]).length
    : 0;

  return (
    <Container maxWidth={false} disableGutters>
      <PageHeader
        title={`Lender attempt #${c.attemptNo}`}
        badge={<Chip label={readable(c.status)} color="primary" />}
        actions={
          ['SANCTIONED', 'PARTIALLY_DISBURSED', 'DISBURSED'].includes(c.status) ? (
            <Button
              variant="contained"
              size="small"
              onClick={() => navigate(`/sanctions/${c.id}`)}
              data-testid="lender-case.manage-sanction"
            >
              Sanctions & Disbursals
            </Button>
          ) : undefined
        }
        subtitle={
          <Typography variant="body2" color="text.secondary" component="span">
            Lender: <LenderName id={c.lenderId} /> · Application: <ApplicationName id={c.applicationId} linkToApp />
          </Typography>
        }
      />

      <Tabs value={tab} onChange={(_, value: TabKey) => setTab(value)} sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
        {(Object.keys(TAB_LABELS) as TabKey[]).map((key) => (
          <Tab key={key} value={key} label={TAB_LABELS[key]} data-testid={`lender-case.tab.${key}`} />
        ))}
      </Tabs>

      {tab === 'overview' && (
        <>
          <Grid container spacing={3} mb={3}>
            <Grid item xs={12} md={6}>
              <AppCard title="Placement" divider>
                <Stack spacing={1}>
                  <Field label="Lender">
                    <LenderName id={c.lenderId} typographyProps={{ fontWeight: 500 }} />
                  </Field>
                  <Field label="Channel">{c.submissionChannel ? readable(c.submissionChannel) : <NotSet />}</Field>
                  <Field label="Lender reference">{c.lenderReference || <NotSet />}</Field>
                  <Field label="Submitted">{dateTime(c.submittedAt)}</Field>
                  {c.declineReasonCode && <Field label="Decline reason">{readable(c.declineReasonCode)}</Field>}
                </Stack>
              </AppCard>
            </Grid>
            <Grid item xs={12} md={6}>
              <AppCard title="Audit" divider>
                <Stack spacing={1}>
                  <Field label="Status source">{c.statusSource ? readable(c.statusSource) : <NotSet />}</Field>
                  <Field label="Package built">{c.packageId ? 'Yes' : 'Not yet'}</Field>
                  <Field label="Created">{dateTime(c.createdAt)}</Field>
                  <Field label="Last status change">{dateTime(c.lastStatusAt)}</Field>
                  <Field label="Record version">{c.lockVersion}</Field>
                </Stack>
              </AppCard>
            </Grid>
          </Grid>

          {/* The attempt actions for this application (build, submit, status, queries, withdraw). */}
          <LenderCasePanel applicationId={c.applicationId} />
        </>
      )}

      {tab === 'package' && (
        <>
          {!c.packageId ? (
            <Alert severity="info">No submission package has been built for this attempt yet.</Alert>
          ) : packageQuery.isLoading ? (
            <CircularProgress />
          ) : packageQuery.error || !packageQuery.data ? (
            <Alert severity="error">Failed to load the submission package.</Alert>
          ) : (
            <>
              <AppCard title="Frozen package" divider sx={{ mb: 3 }}>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={4}>
                    <Field label="Kind">{readable(packageQuery.data.kind)}</Field>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Field label="Built">{dateTime(packageQuery.data.builtAt)}</Field>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Field label="Frozen">{dateTime(packageQuery.data.frozenAt)}</Field>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Field label="Consents relied on">{packageQuery.data.consentIds.length}</Field>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Field label="Waivers">{waiverCount}</Field>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                      <strong>Manifest SHA-256:</strong>{' '}
                      <Box component="span" sx={{ fontFamily: 'monospace' }}>
                        {packageQuery.data.manifestSha256}
                      </Box>
                    </Typography>
                  </Grid>
                </Grid>
              </AppCard>
              <DataTable<(typeof documents)[number]>
                dataTestId="lender-case.package.documents"
                data={documents}
                keyExtractor={(d, i) => `${d.documentTypeCode}-${i}`}
                emptyTitle="No documents in this package"
                columns={[
                  { id: 'type', header: 'Document', render: (d) => readable(d.documentTypeCode) },
                  {
                    id: 'sha',
                    header: 'SHA-256',
                    render: (d) => (
                      <Box component="span" sx={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                        {d.sha256}
                      </Box>
                    ),
                  },
                ]}
              />
            </>
          )}
        </>
      )}

      {tab === 'queries' && (
        <DataTable<NonNullable<typeof queriesQuery.data>[number]>
          dataTestId="lender-case.queries"
          data={queriesQuery.data ?? []}
          keyExtractor={(q) => q.id}
          isLoading={queriesQuery.isLoading}
          isError={!!queriesQuery.error}
          error={queriesQuery.error}
          onRetry={() => queriesQuery.refetch()}
          emptyTitle="No queries from the lender"
          emptyDescription="Queries the lender raises on this attempt appear here, with the answer once it is sent."
          columns={queryColumns}
        />
      )}

      {tab === 'history' && (
        <DataTable<NonNullable<typeof historyQuery.data>[number]>
          dataTestId="lender-case.history"
          data={historyQuery.data ?? []}
          keyExtractor={(h) => h.id}
          isLoading={historyQuery.isLoading}
          isError={!!historyQuery.error}
          error={historyQuery.error}
          onRetry={() => historyQuery.refetch()}
          emptyTitle="No status changes yet"
          columns={historyColumns}
        />
      )}
    </Container>
  );
}
