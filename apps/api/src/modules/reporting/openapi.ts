// apps/api/src/modules/reporting/openapi.ts — OpenAPI 3.1 definitions for MOD-RPT
import {
  BranchDashboardDtoSchema,
  ConnectorDashboardDtoSchema,
  ControlTotalsDtoSchema,
  CreateExportDtoSchema,
  CreateReportRunDtoSchema,
  CreateReportScheduleDtoSchema,
  DashboardQuerySchema,
  ExecutiveDashboardDtoSchema,
  ExportJobDtoSchema,
  FinanceDashboardDtoSchema,
  LeaderboardDashboardDtoSchema,
  MetricDefinitionDtoSchema,
  MetricsQueryResponseSchema,
  MetricsQuerySchema,
  OperationsDashboardDtoSchema,
  ReportCatalogueItemSchema,
  ReportRunDtoSchema,
  ReportScheduleDtoSchema,
  TeamPerformanceDashboardDtoSchema,
} from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { z } from 'zod';

export const tags = [
  {
    name: 'Reporting',
    description: 'Canonical reporting, metrics engine and performance dashboards (MOD-RPT / DOM-L).',
  },
];

export function registerOpenApi(registry: OpenAPIRegistry): void {
  // API-RPT-001: Get Metrics
  registry.registerPath({
    method: 'get',
    path: '/v1/metrics',
    operationId: 'API-RPT-001',
    summary: 'API-RPT-001: Query Canonical Operational & Outcome Metrics',
    tags: ['Reporting'],
    security: [{ bearerAuth: [] }],
    request: {
      query: MetricsQuerySchema,
    },
    responses: {
      200: {
        description: 'Computed metrics response with target comparisons',
        content: {
          'application/json': {
            schema: MetricsQueryResponseSchema,
          },
        },
      },
      403: {
        description: 'Missing report.read permission or branch access violation',
      },
    },
  });

  // ENT-094: List Metric Definitions
  registry.registerPath({
    method: 'get',
    path: '/v1/metrics/definitions',
    operationId: 'API-RPT-REG-01',
    summary: 'List Canonical Metric Definitions (ENT-094)',
    tags: ['Reporting'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'List of metric definitions',
        content: {
          'application/json': {
            schema: z.object({ data: z.array(MetricDefinitionDtoSchema) }),
          },
        },
      },
    },
  });

  // API-RPT-002: Retrieve Performance Dashboard
  registry.registerPath({
    method: 'get',
    path: '/v1/dashboards/{code}',
    operationId: 'API-RPT-002',
    summary: 'API-RPT-002: Retrieve Aggregated Performance Dashboard',
    tags: ['Reporting'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({
        code: z.string().describe('Dashboard code (EXECUTIVE, BRANCH, TEAM_PERFORMANCE, OPERATIONS, FINANCE, CONNECTOR, LEADERBOARD)'),
      }),
      query: DashboardQuerySchema,
    },
    responses: {
      200: {
        description: 'Dashboard representation',
        content: {
          'application/json': {
            schema: z.union([
              TeamPerformanceDashboardDtoSchema,
              LeaderboardDashboardDtoSchema,
              ExecutiveDashboardDtoSchema,
              BranchDashboardDtoSchema,
              OperationsDashboardDtoSchema,
              FinanceDashboardDtoSchema,
              ConnectorDashboardDtoSchema,
            ]),
          },
        },
      },
      404: {
        description: 'Dashboard code not found',
      },
    },
  });

  // FR-RPT-008: Daily Control Totals Reconciliation
  registry.registerPath({
    method: 'get',
    path: '/v1/reporting/control-totals',
    operationId: 'FR-RPT-008',
    summary: 'Daily Reporting Control Totals Reconciliation',
    tags: ['Reporting'],
    security: [{ bearerAuth: [] }],
    request: {
      query: z.object({
        summaryDate: z.string().optional().describe('YYYY-MM-DD date to reconcile'),
      }),
    },
    responses: {
      200: {
        description: 'Reconciliation comparison between OLTP sources and reporting projection',
        content: {
          'application/json': {
            schema: ControlTotalsDtoSchema,
          },
        },
      },
    },
  });

  // POST /v1/reporting/refresh: Privileged projection rebuild
  registry.registerPath({
    method: 'post',
    path: '/v1/reporting/refresh',
    operationId: 'API-RPT-REFRESH',
    summary: 'Refresh Operational Summary Reporting Projections',
    tags: ['Reporting'],
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
              endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Projections refreshed successfully',
        content: {
          'application/json': {
            schema: z.object({
              status: z.string(),
              refreshedAt: z.string(),
            }),
          },
        },
      },
      403: {
        description: 'Missing report.manage or config.manage permission',
      },
    },
  });

  // SUB-RPT.04: List Report Catalogue
  registry.registerPath({
    method: 'get',
    path: '/v1/reports',
    operationId: 'API-RPT-CATALOGUE',
    summary: 'List Available Report Catalogue Items',
    tags: ['Reporting'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Catalogue of standard tabular reports',
        content: {
          'application/json': {
            schema: z.object({ data: z.array(ReportCatalogueItemSchema) }),
          },
        },
      },
    },
  });

  // API-RPT-003: Start Asynchronous Report Run
  registry.registerPath({
    method: 'post',
    path: '/v1/reports/{code}/runs',
    operationId: 'API-RPT-003',
    summary: 'API-RPT-003: Execute Asynchronous Report Run',
    tags: ['Reporting'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({
        code: z.string().describe('Report code from catalogue'),
      }),
      body: {
        content: {
          'application/json': {
            schema: CreateReportRunDtoSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Report run created and queued',
        content: {
          'application/json': {
            schema: ReportRunDtoSchema,
          },
        },
      },
      404: {
        description: 'Report code not found in catalogue',
      },
    },
  });

  // API-RPT-004: Get Report Run Status
  registry.registerPath({
    method: 'get',
    path: '/v1/report-runs/{id}',
    operationId: 'API-RPT-004',
    summary: 'API-RPT-004: Retrieve Report Run Status & Results',
    tags: ['Reporting'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({
        id: z.string(),
      }),
    },
    responses: {
      200: {
        description: 'Report run details and result download link',
        content: {
          'application/json': {
            schema: ReportRunDtoSchema,
          },
        },
      },
      404: {
        description: 'Report run not found',
      },
    },
  });

  // API-RPT-006: Create Record-Level Export Job
  registry.registerPath({
    method: 'post',
    path: '/v1/exports',
    operationId: 'API-RPT-006',
    summary: 'API-RPT-006: Initiate Asynchronous Record-Level Export (ENT-111)',
    tags: ['Reporting'],
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        content: {
          'application/json': {
            schema: CreateExportDtoSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Export job initiated',
        content: {
          'application/json': {
            schema: ExportJobDtoSchema,
          },
        },
      },
      403: {
        description: 'Missing export.run permission or role scope violation',
      },
    },
  });

  // API-RPT-007: Get Export Job Status
  registry.registerPath({
    method: 'get',
    path: '/v1/exports/{id}',
    operationId: 'API-RPT-007',
    summary: 'API-RPT-007: Retrieve Export Job Status & Expiring Download Access',
    tags: ['Reporting'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({
        id: z.string(),
      }),
    },
    responses: {
      200: {
        description: 'Export job status and expiring presigned download URL',
        content: {
          'application/json': {
            schema: ExportJobDtoSchema,
          },
        },
      },
      404: {
        description: 'Export job not found',
      },
      410: {
        description: 'Export file has expired (exceeded 24 hours retention)',
      },
    },
  });

  // API-RPT-005: Create Recurring Report Schedule
  registry.registerPath({
    method: 'post',
    path: '/v1/report-schedules',
    operationId: 'API-RPT-005',
    summary: 'API-RPT-005: Create Recurring Report Distribution Schedule',
    tags: ['Reporting'],
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        content: {
          'application/json': {
            schema: CreateReportScheduleDtoSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Report distribution schedule registered',
        content: {
          'application/json': {
            schema: ReportScheduleDtoSchema,
          },
        },
      },
      403: {
        description: 'Missing report.schedule permission',
      },
    },
  });
}
