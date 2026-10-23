// apps/web/src/features/lender-cases/LenderCaseDetailPage.tsx — owner: Dev 4 (MOD-LCS Case Detail)
import React from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Grid,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { fetchLenderCase } from './api';
import { LenderCasePanel } from './LenderCasePanel';
import { ApplicationName, LenderName } from '../../shell/display';
import { PageHeader } from '../../ui';

export function LenderCaseDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['lender-case', id],
    queryFn: () => (id ? fetchLenderCase(id) : Promise.reject(new Error('Missing ID'))),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (error || !data) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">Failed to load lender case details.</Alert>
      </Container>
    );
  }

  const { case: c } = data;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <PageHeader
        title={`Lender Case: ${c.id}`}
        badge={<Chip label={c.status} color="primary" />}
        subtitle={
          <Typography variant="body2" color="text.secondary">
            Application: <ApplicationName id={c.applicationId} linkToApp /> | Attempt #{c.attemptNo}
          </Typography>
        }
      />

      <Grid container spacing={3} mb={3}>
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Case Placement Details
            </Typography>
            <Divider sx={{ mb: 1.5 }} />
            <Typography variant="body2">
              <strong>Lender:</strong> <LenderName id={c.lenderId} typographyProps={{ fontWeight: 500 }} />
            </Typography>
            <Typography variant="body2">
              <strong>Product Version:</strong> {c.productVersionId}
            </Typography>
            <Typography variant="body2">
              <strong>Empanelment ID:</strong> {c.empanelmentId}
            </Typography>
            <Typography variant="body2">
              <strong>Channel:</strong> {c.submissionChannel || '—'}
            </Typography>
            <Typography variant="body2">
              <strong>Reference:</strong> {c.lenderReference || '—'}
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Audit & Versioning
            </Typography>
            <Divider sx={{ mb: 1.5 }} />
            <Typography variant="body2">
              <strong>Lock Version:</strong> {c.lockVersion}
            </Typography>
            <Typography variant="body2">
              <strong>Package ID:</strong> {c.packageId || '—'}
            </Typography>
            <Typography variant="body2">
              <strong>Created At:</strong> {new Date(c.createdAt).toLocaleString()}
            </Typography>
            <Typography variant="body2">
              <strong>Last Status At:</strong>{' '}
              {c.lastStatusAt ? new Date(c.lastStatusAt).toLocaleString() : '—'}
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* Embed the Lender Attempts Panel for the parent application */}
      <LenderCasePanel applicationId={c.applicationId} />
    </Container>
  );
}
