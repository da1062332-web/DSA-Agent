// The top of the loan file (owner: Bhushan, 2026-11-28 redesign): what loan, for whom, how much, where it stands. Product, amount and
// borrower read like the front sheet of a paper loan file; the journey below shows the stage.
import { Box, Chip, Divider, Link, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { hasPermission, useMe } from '../../../api/useMe';
import { BranchName, CustomerName } from '../../../shell/display';
import { AppButton } from '../../../ui';
import { useResource } from '../../admin/api';
import type { ProductVersion } from '../../admin/ProductsPage';
import type { Application } from '../ApplicationsPage';
import {
  APPLICANT_TYPE_LABELS,
  PRODUCT_LABELS,
  applicationNumber,
  fileDate,
  formatInr,
  humanize,
  statusTone,
  type JourneyState,
} from '../loan-file';
import { STATUS_LABELS } from '../rules';
import { JourneyStepper } from './JourneyStepper';

function Fact({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <Box sx={{ minWidth: 0 }} data-testid={testId}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600, display: 'block' }}
      >
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ fontWeight: 600, mt: 0.25 }} noWrap>
        {children}
      </Typography>
    </Box>
  );
}

export function LoanFileHeader({
  app,
  journey,
  selectedStage,
  onSelectStage,
}: {
  app: Application;
  journey: JourneyState;
  selectedStage?: number;
  onSelectStage?: (index: number) => void;
}) {
  const me = useMe();
  const version = useResource<ProductVersion & { productName?: string }>(
    app.productVersionId ? `/v1/product-versions/${app.productVersionId}` : null,
  );
  const product = useResource<{ name: string }>(
    version.data ? `/v1/products/${version.data.productId}` : null,
  );
  const loanName = PRODUCT_LABELS[app.productCategory] ?? 'Loan';

  return (
    <Box
      data-testid="application.header"
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: '12px',
        bgcolor: 'background.paper',
        mb: 3,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          px: { xs: 2, md: 3 },
          pt: 2.5,
          pb: 2,
          bgcolor: '#F8FAFC',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="caption" color="text.secondary">
          <Link component={RouterLink} to="/applications" underline="hover" color="inherit">
            Applications
          </Link>{' '}
          / {applicationNumber(app.id)}
        </Typography>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          justifyContent="space-between"
          alignItems={{ md: 'flex-start' }}
          sx={{ mt: 1 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography
                variant="h5"
                component="h1"
                sx={{ fontWeight: 700 }}
                data-testid="application.title"
              >
                {loanName} application
              </Typography>
              <Chip
                label={STATUS_LABELS[app.status]}
                color={statusTone(app.status)}
                size="small"
                sx={{ fontWeight: 700 }}
                data-testid="application.status"
              />
              {app.onHold && <Chip label="On hold" color="warning" variant="outlined" size="small" />}
            </Stack>
            <Typography variant="body2" color="text.secondary" component="div" sx={{ mt: 0.75 }}>
              <Box component="span" sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'text.primary' }}>
                {applicationNumber(app.id)}
              </Box>
              {' · Borrower '}
              <Box component="span" sx={{ display: 'inline-flex', fontWeight: 600 }}>
                <CustomerName id={app.customerId} linkToProfile />
              </Box>
              {` · Opened ${fileDate(app.createdAt)} · Updated ${fileDate(app.updatedAt)}`}
            </Typography>
          </Box>
          <Stack direction="row" spacing={3} alignItems="center" sx={{ flexShrink: 0 }}>
            <Box sx={{ textAlign: { md: 'right' } }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
              >
                Loan amount requested
              </Typography>
              <Typography
                sx={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1, color: 'primary.main' }}
                data-testid="application.amount"
              >
                {formatInr(app.requestedAmount)}
              </Typography>
            </Box>
            {hasPermission(me.data, 'document.upload') && (
              <AppButton
                size="small"
                variant="outlined"
                to={`/document-sharing?applicationId=${encodeURIComponent(app.id)}&action=upload-link`}
                dataTestId="application.upload-link"
                sx={{ whiteSpace: 'nowrap' }}
              >
                Send upload link
              </AppButton>
            )}
          </Stack>
        </Stack>
      </Box>

      <Box
        sx={{
          px: { xs: 2, md: 3 },
          py: 2,
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(6, minmax(0, 1fr))' },
        }}
      >
        <Fact label="Tenure" testId="application.fact-tenure">
          {app.tenureMonths ? `${app.tenureMonths} months` : 'Not set'}
        </Fact>
        <Fact label="Purpose">{app.purposeCode ? humanize(app.purposeCode) : 'Not set'}</Fact>
        <Fact label="Applicant type">
          {APPLICANT_TYPE_LABELS[app.applicantType] ?? humanize(app.applicantType)}
        </Fact>
        <Fact label="Product">
          {product.data?.name
            ? `${product.data.name} · v${version.data?.versionNo}`
            : app.productVersionId
              ? version.data
                ? `Version ${version.data.versionNo}`
                : '…'
              : 'Not chosen'}
        </Fact>
        <Fact label="Branch">
          <BranchName id={app.branchId} />
        </Fact>
        <Fact label="Category">{app.productCategory}</Fact>
      </Box>
      <Divider />
      <Box sx={{ px: { xs: 1, md: 3 }, py: 2 }}>
        <JourneyStepper state={journey} selected={selectedStage} onSelect={onSelectStage} />
      </Box>
    </Box>
  );
}
