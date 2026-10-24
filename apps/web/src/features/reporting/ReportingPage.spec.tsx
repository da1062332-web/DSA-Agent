// apps/web/src/features/reporting/ReportingPage.spec.tsx — Tests for MOD-RPT Reporting UI
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ReportingPage } from './ReportingPage';

vi.mock('../../api/useMe', () => ({
  useMe: () => ({
    data: {
      id: 'usr_01JTESTUSER',
      grants: [
        { code: 'report.read', scope: 'TENANT', branchIds: [] },
        { code: 'report.manage', scope: 'TENANT', branchIds: [] },
        { code: 'export.run', scope: 'TENANT', branchIds: [] },
        { code: 'report.schedule', scope: 'TENANT', branchIds: [] },
      ],
    },
    isLoading: false,
  }),
  hasPermission: () => true,
}));

vi.mock('./api', () => ({
  useMetricDefinitions: () => ({
    data: {
      data: [
        {
          tenantId: 'ten_default',
          code: 'LEAD_COUNT',
          name: 'Lead Intake Count',
          category: 'ACTIVITY',
          unit: 'COUNT',
          aggregationType: 'COUNT',
          sourceDomain: 'CRM',
          formula: { type: 'COUNT', source_table: 'app.lead' },
          version: 1,
          grain: 'DAILY',
          dateBasis: 'CREATED_AT',
          owner: 'SYSTEM',
          effectiveFrom: '2026-10-01T00:00:00.000Z',
        },
      ],
    },
    isLoading: false,
  }),
  useReportCatalogue: () => ({
    data: {
      data: [
        {
          code: 'RPT_LEAD_PIPELINE',
          title: 'Lead Pipeline Register',
          category: 'LEADS',
          description: 'Detailed record-level register of leads',
          supportedFormats: ['CSV', 'XLSX', 'JSON'],
        },
        {
          code: 'RPT_DISBURSEMENT_REGISTER',
          title: 'Disbursement Tranche Register',
          category: 'DISBURSEMENTS',
          description: 'Comprehensive disbursement audit with net amounts',
          supportedFormats: ['CSV', 'XLSX'],
        },
      ],
    },
    isLoading: false,
  }),
  useReportRuns: () => ({
    data: {
      data: [
        {
          id: 'rpr_test001',
          tenantId: 'ten_default',
          reportCode: 'RPT_DISBURSEMENT_REGISTER',
          status: 'COMPLETED',
          parameters: {},
          rowCount: 42,
          resultSummary: {},
          createdBy: 'usr_01JTESTUSER',
          createdAt: '2026-10-14T10:00:00.000Z',
          completedAt: '2026-10-14T10:01:00.000Z',
          downloadUrl: '/downloads/rpr_test001.csv',
          errorMessage: null,
        },
      ],
    },
    isLoading: false,
  }),
  useExports: () => ({
    data: {
      data: [
        {
          id: 'exp_test001',
          tenantId: 'ten_default',
          requesterId: 'usr_01JTESTUSER',
          scopeType: 'TENANT',
          scopeId: null,
          exportType: 'METRICS',
          fileFormat: 'CSV',
          filters: {},
          rowCount: 25,
          fileKey: 'exports/exp_test001.csv',
          status: 'COMPLETED',
          downloadUrl: '/downloads/exp_test001.csv',
          expiresAt: '2026-10-15T10:00:00.000Z',
          downloadedAt: null,
          createdAt: '2026-10-14T10:00:00.000Z',
        },
      ],
    },
    isLoading: false,
  }),
  useReportSchedules: () => ({
    data: {
      data: [
        {
          id: 'sch_test001',
          tenantId: 'ten_default',
          reportCode: 'RPT_DISBURSEMENT_REGISTER',
          frequency: 'WEEKLY',
          filters: {},
          recipientEmails: ['ops@dsa.test'],
          recipientScope: 'TENANT',
          createdBy: 'usr_01JTESTUSER',
          isActive: true,
          lastRunAt: null,
          nextRunAt: '2026-10-21T08:00:00.000Z',
          createdAt: '2026-10-14T10:00:00.000Z',
        },
      ],
    },
    isLoading: false,
  }),
  useControlTotals: () => ({
    data: {
      summaryDate: '2026-10-12',
      tenantId: 'ten_default',
      oltpTotals: {
        leads: 10,
        sanctions: 4,
        sanctionAmount: 5000000,
        disbursements: 3,
        disbursementAmount: 4000000,
      },
      projectionTotals: {
        leads: 10,
        sanctions: 4,
        sanctionAmount: 5000000,
        disbursements: 3,
        disbursementAmount: 4000000,
      },
      variance: {
        leadsDiff: 0,
        sanctionsDiff: 0,
        sanctionAmountDiff: 0,
        disbursementsDiff: 0,
        disbursementAmountDiff: 0,
      },
      reconciled: true,
      asOf: '2026-10-14T10:00:00.000Z',
    },
    isLoading: false,
  }),
  useExecutiveDashboard: () => ({
    data: {
      dashboardCode: 'EXECUTIVE',
      title: 'Executive Portfolio Summary',
      period: '2026-10',
      asOf: '2026-10-14T10:00:00.000Z',
      portfolioSummary: {
        totalLeads: 120,
        qualifiedLeads: 80,
        sanctionedAmount: 50000000,
        disbursedAmount: 42000000,
        conversionRate: 35,
        activeBranches: 4,
      },
      growthTrends: [],
      topBranches: [],
    },
    isLoading: false,
  }),
  useBranchDashboard: () => ({ data: null, isLoading: false }),
  useOperationsDashboard: () => ({ data: null, isLoading: false }),
  useFinanceDashboard: () => ({ data: null, isLoading: false }),
  useConnectorDashboard: () => ({ data: null, isLoading: false }),
  useStartReportRun: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateExport: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateReportSchedule: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteReportSchedule: () => ({ mutate: vi.fn(), isPending: false }),
  useRefreshProjections: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
}));

describe('ReportingPage (MOD-RPT Suite)', () => {
  it('renders standard report catalogue and recent runs', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ReportingPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(html).toContain('Reports and Analytics');
    expect(html).toContain('Lead Pipeline Register');
    expect(html).toContain('Disbursement Tranche Register');
    expect(html).toContain('Run Report');
    expect(html).toContain('rpr_test001');
  });
});
