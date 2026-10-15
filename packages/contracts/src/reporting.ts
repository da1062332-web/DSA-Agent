// packages/contracts/src/reporting.ts — Canonical Reporting & Performance Contracts (MOD-RPT / DOM-L)
import { z } from 'zod';
import { DimensionTypeEnum, TARGET_PERIOD_REGEX } from './target';

// Canonical Metric Codes supported in MOD-RPT
export const CanonicalMetricCodeEnum = z.enum([
  'DISBURSEMENT_AMOUNT',
  'LEAD_COUNT',
  'SANCTION_COUNT',
  'LEAD_QUALIFIED_COUNT',
  'LEAD_CONVERTED_COUNT',
  'ACTIVITY_COUNT',
  'SANCTION_AMOUNT',
  'DISBURSEMENT_COUNT',
  'LEAD_CONVERSION_RATE',
]);
export type CanonicalMetricCode = z.infer<typeof CanonicalMetricCodeEnum>;

export const MetricCategoryEnum = z.enum(['ACTIVITY', 'OUTCOME', 'EFFICIENCY']);
export type MetricCategory = z.infer<typeof MetricCategoryEnum>;

export const MetricUnitEnum = z.enum(['COUNT', 'INR', 'PERCENTAGE']);
export type MetricUnit = z.infer<typeof MetricUnitEnum>;

export const AggregationTypeEnum = z.enum(['SUM', 'COUNT', 'AVG', 'RATIO']);
export type AggregationType = z.infer<typeof AggregationTypeEnum>;

// ENT-094: metric_definition
export const MetricDefinitionDtoSchema = z.object({
  code: CanonicalMetricCodeEnum,
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  category: MetricCategoryEnum,
  unit: MetricUnitEnum,
  aggregationType: AggregationTypeEnum,
  sourceDomain: z.string().min(1).max(50),
  version: z.number().int().positive().default(1),
  formula: z.record(z.unknown()).default({}),
  dateBasis: z.enum(['CREATED_AT', 'UPDATED_AT', 'EVENT_AT', 'DISBURSED_AT']).default('CREATED_AT'),
  grain: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY']).default('DAILY'),
  filters: z.record(z.unknown()).default({}),
  owner: z.string().default('SYSTEM'),
  effectiveFrom: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});
export type MetricDefinitionDto = z.infer<typeof MetricDefinitionDtoSchema>;

// API-RPT-001: Query parameters for GET /v1/metrics
export const MetricsQuerySchema = z.object({
  period: z.string().regex(TARGET_PERIOD_REGEX, {
    message: 'Period must be in YYYY-MM (month) or YYYY-Q# (quarter) format.',
  }),
  metricCodes: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(',').map((s) => s.trim()) : undefined)),
  dimensionType: DimensionTypeEnum.optional(),
  dimensionId: z.string().min(1).optional(),
  branchId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
});
export type MetricsQuery = z.infer<typeof MetricsQuerySchema>;

// Metric computation result item
export const MetricResultDtoSchema = z.object({
  metricCode: CanonicalMetricCodeEnum,
  metricName: z.string(),
  category: MetricCategoryEnum,
  unit: MetricUnitEnum,
  period: z.string(),
  dimensionType: DimensionTypeEnum.optional(),
  dimensionId: z.string().optional(),
  actualValue: z.number(),
  targetValue: z.number().nullable(),
  achievementPercentage: z.number().nullable(),
  freshness: z.string().datetime(),
  calculationNote: z.string().optional(),
});
export type MetricResultDto = z.infer<typeof MetricResultDtoSchema>;

export const MetricsQueryResponseSchema = z.object({
  data: z.array(MetricResultDtoSchema),
  meta: z.object({
    period: z.string(),
    asOf: z.string().datetime(),
    tenantId: z.string(),
  }),
});
export type MetricsQueryResponse = z.infer<typeof MetricsQueryResponseSchema>;

// API-RPT-002: Query parameters for GET /v1/dashboards/:code
export const DashboardQuerySchema = z.object({
  period: z
    .string()
    .regex(TARGET_PERIOD_REGEX, {
      message: 'Period must be in YYYY-MM (month) or YYYY-Q# (quarter) format.',
    })
    .default('2026-10'),
  branchId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
});
export type DashboardQuery = z.infer<typeof DashboardQuerySchema>;

// CMP-PERF.02.1: Team Performance Dashboard DTO
export const TeamPerformanceDashboardDtoSchema = z.object({
  dashboardCode: z.literal('TEAM_PERFORMANCE'),
  title: z.string(),
  period: z.string(),
  asOf: z.string().datetime(),
  summary: z.object({
    leads: z.object({
      actual: z.number(),
      target: z.number().nullable(),
      achievementPercentage: z.number().nullable(),
    }),
    sanctions: z.object({
      count: z.number(),
      amount: z.number(),
      targetCount: z.number().nullable(),
      achievementPercentage: z.number().nullable(),
    }),
    disbursements: z.object({
      count: z.number(),
      amount: z.number(),
      targetAmount: z.number().nullable(),
      achievementPercentage: z.number().nullable(),
    }),
    conversionRate: z.number(), // percentage
    activityCount: z.number(),
  }),
  funnel: z.array(
    z.object({
      stage: z.string(),
      count: z.number(),
      rate: z.number(),
    }),
  ),
  breakdown: z.array(
    z.object({
      dimensionType: DimensionTypeEnum,
      dimensionId: z.string(),
      dimensionName: z.string(),
      leadCount: z.number(),
      sanctionCount: z.number(),
      disbursementAmount: z.number(),
      disbursementTarget: z.number().nullable(),
      achievementPercentage: z.number().nullable(),
    }),
  ),
});
export type TeamPerformanceDashboardDto = z.infer<typeof TeamPerformanceDashboardDtoSchema>;

// CMP-PERF.03.1: Leaderboard Dashboard DTO
export const LeaderboardEntryDtoSchema = z.object({
  entityId: z.string(),
  entityName: z.string(),
  dimensionType: DimensionTypeEnum,
  branchName: z.string().optional(),
  volume: z.number(),
  sanctionCount: z.number(),
  disbursementAmount: z.number(),
  conversionRate: z.number(),
  rank: z.number().nullable(), // null when ranking rules pending approval
  score: z.number().nullable(), // null when ranking rules pending approval
  guardrailStatus: z.enum(['NORMAL', 'WARNING', 'PENALTY', 'INSUFFICIENT_DATA']).default('NORMAL'),
});
export type LeaderboardEntryDto = z.infer<typeof LeaderboardEntryDtoSchema>;

export const LeaderboardDashboardDtoSchema = z.object({
  dashboardCode: z.literal('LEADERBOARD'),
  title: z.string(),
  period: z.string(),
  asOf: z.string().datetime(),
  rankingStatus: z.enum(['ACTIVE', 'BLOCKED_PENDING_APPROVAL']),
  unresolvedDecisions: z.array(z.string()),
  entries: z.array(LeaderboardEntryDtoSchema),
});
export type LeaderboardDashboardDto = z.infer<typeof LeaderboardDashboardDtoSchema>;

// Executive Dashboard DTO
export const ExecutiveDashboardDtoSchema = z.object({
  dashboardCode: z.literal('EXECUTIVE'),
  title: z.string(),
  period: z.string(),
  asOf: z.string().datetime(),
  portfolioSummary: z.object({
    totalLeads: z.number(),
    qualifiedLeads: z.number(),
    sanctionedAmount: z.number(),
    disbursedAmount: z.number(),
    conversionRate: z.number(),
    activeBranches: z.number(),
  }),
  growthTrends: z.array(
    z.object({
      label: z.string(),
      leads: z.number(),
      sanctions: z.number(),
      disbursements: z.number(),
    }),
  ),
  topBranches: z.array(
    z.object({
      branchId: z.string(),
      branchName: z.string(),
      disbursedAmount: z.number(),
      targetAmount: z.number().nullable(),
      achievementRate: z.number().nullable(),
    }),
  ),
});
export type ExecutiveDashboardDto = z.infer<typeof ExecutiveDashboardDtoSchema>;

// Branch Dashboard DTO
export const BranchDashboardDtoSchema = z.object({
  dashboardCode: z.literal('BRANCH'),
  title: z.string(),
  period: z.string(),
  branchId: z.string(),
  branchName: z.string(),
  asOf: z.string().datetime(),
  summary: z.object({
    leadCount: z.number(),
    sanctionAmount: z.number(),
    disbursementAmount: z.number(),
    conversionRate: z.number(),
    teamMembersCount: z.number(),
  }),
  officerPerformance: z.array(
    z.object({
      userId: z.string(),
      userName: z.string(),
      leadCount: z.number(),
      sanctionCount: z.number(),
      disbursementAmount: z.number(),
      conversionRate: z.number(),
    }),
  ),
});
export type BranchDashboardDto = z.infer<typeof BranchDashboardDtoSchema>;

// Operations Dashboard DTO
export const OperationsDashboardDtoSchema = z.object({
  dashboardCode: z.literal('OPERATIONS'),
  title: z.string(),
  period: z.string(),
  asOf: z.string().datetime(),
  throughput: z.object({
    leadsProcessed: z.number(),
    activeApplications: z.number(),
    pendingVerifications: z.number(),
    casesInUnderwriting: z.number(),
    sanctionsAwaitingDisbursement: z.number(),
  }),
  slaPerformance: z.object({
    totalTasks: z.number(),
    completedOnTime: z.number(),
    breachedTasks: z.number(),
    onTimeRate: z.number(),
  }),
});
export type OperationsDashboardDto = z.infer<typeof OperationsDashboardDtoSchema>;

// Finance Dashboard DTO
export const FinanceDashboardDtoSchema = z.object({
  dashboardCode: z.literal('FINANCE'),
  title: z.string(),
  period: z.string(),
  asOf: z.string().datetime(),
  disbursements: z.object({
    grossSanctionedAmount: z.number(),
    netDisbursedAmount: z.number(),
    pendingDisbursementAmount: z.number(),
    trancheCount: z.number(),
    averageTicketSize: z.number(),
  }),
  productBreakdown: z.array(
    z.object({
      productId: z.string(),
      productName: z.string(),
      sanctionCount: z.number(),
      disbursedAmount: z.number(),
      sharePercentage: z.number(),
    }),
  ),
});
export type FinanceDashboardDto = z.infer<typeof FinanceDashboardDtoSchema>;

// Connector Channel Dashboard DTO
export const ConnectorDashboardDtoSchema = z.object({
  dashboardCode: z.literal('CONNECTOR'),
  title: z.string(),
  period: z.string(),
  asOf: z.string().datetime(),
  channelSummary: z.object({
    totalConnectors: z.number(),
    activeConnectors: z.number(),
    leadsSourced: z.number(),
    disbursedVolume: z.number(),
  }),
  topPartners: z.array(
    z.object({
      connectorId: z.string(),
      connectorName: z.string(),
      leadsCount: z.number(),
      disbursedAmount: z.number(),
    }),
  ),
});
export type ConnectorDashboardDto = z.infer<typeof ConnectorDashboardDtoSchema>;

export type AnyDashboardDto =
  | TeamPerformanceDashboardDto
  | LeaderboardDashboardDto
  | ExecutiveDashboardDto
  | BranchDashboardDto
  | OperationsDashboardDto
  | FinanceDashboardDto
  | ConnectorDashboardDto;

// SUB-RPT.04: Report Catalogue & Runs
export const ReportCodeEnum = z.enum([
  'RPT_LEAD_PIPELINE',
  'RPT_DISBURSEMENT_REGISTER',
  'RPT_SANCTION_LEDGER',
  'RPT_BRANCH_SUMMARY',
  'RPT_ACTIVITY_AUDIT',
  'RPT_TARGET_ACHIEVEMENT',
]);
export type ReportCode = z.infer<typeof ReportCodeEnum>;

export const ReportCatalogueItemSchema = z.object({
  code: ReportCodeEnum,
  title: z.string(),
  category: z.enum(['LEADS', 'DISBURSEMENTS', 'SANCTIONS', 'OPERATIONS', 'AUDIT']),
  description: z.string(),
  supportedFormats: z.array(z.enum(['CSV', 'XLSX', 'JSON'])),
});
export type ReportCatalogueItem = z.infer<typeof ReportCatalogueItemSchema>;

export const CreateReportRunDtoSchema = z.object({
  parameters: z.record(z.unknown()).default({}),
  format: z.enum(['CSV', 'XLSX', 'JSON']).default('CSV'),
});
export type CreateReportRunDto = z.infer<typeof CreateReportRunDtoSchema>;

export const ReportRunDtoSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  reportCode: z.string(),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']),
  parameters: z.record(z.unknown()),
  rowCount: z.number(),
  resultSummary: z.record(z.unknown()),
  createdBy: z.string(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  downloadUrl: z.string().nullable(),
  errorMessage: z.string().nullable(),
});
export type ReportRunDto = z.infer<typeof ReportRunDtoSchema>;

// SUB-RPT.05: Exports and Schedules
export const ExportFileFormatEnum = z.enum(['CSV', 'XLSX', 'JSON']);
export type ExportFileFormat = z.infer<typeof ExportFileFormatEnum>;

export const ExportStatusEnum = z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']);
export type ExportStatus = z.infer<typeof ExportStatusEnum>;

export const CreateExportDtoSchema = z.object({
  exportType: z.string().min(2).max(50),
  fileFormat: ExportFileFormatEnum.default('CSV'),
  filters: z.record(z.unknown()).default({}),
  scopeType: z.enum(['TENANT', 'BRANCH', 'USER']).default('TENANT'),
  scopeId: z.string().optional(),
});
export type CreateExportDto = z.infer<typeof CreateExportDtoSchema>;

export const ExportJobDtoSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  requesterId: z.string(),
  scopeType: z.enum(['TENANT', 'BRANCH', 'USER']),
  scopeId: z.string().nullable(),
  exportType: z.string(),
  fileFormat: ExportFileFormatEnum,
  filters: z.record(z.unknown()),
  rowCount: z.number(),
  fileKey: z.string().nullable(),
  status: ExportStatusEnum,
  downloadUrl: z.string().nullable(),
  expiresAt: z.string().datetime(),
  downloadedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ExportJobDto = z.infer<typeof ExportJobDtoSchema>;

export const ScheduleFrequencyEnum = z.enum(['DAILY', 'WEEKLY', 'MONTHLY']);
export type ScheduleFrequency = z.infer<typeof ScheduleFrequencyEnum>;

export const CreateReportScheduleDtoSchema = z.object({
  reportCode: z.string().min(3).max(50),
  frequency: ScheduleFrequencyEnum,
  filters: z.record(z.unknown()).default({}),
  recipientEmails: z.array(z.string().email()).min(1),
  recipientScope: z.enum(['TENANT', 'BRANCH']).default('TENANT'),
});
export type CreateReportScheduleDto = z.infer<typeof CreateReportScheduleDtoSchema>;

export const ReportScheduleDtoSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  reportCode: z.string(),
  frequency: ScheduleFrequencyEnum,
  filters: z.record(z.unknown()),
  recipientEmails: z.array(z.string()),
  recipientScope: z.enum(['TENANT', 'BRANCH']),
  createdBy: z.string(),
  isActive: z.boolean(),
  lastRunAt: z.string().datetime().nullable(),
  nextRunAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type ReportScheduleDto = z.infer<typeof ReportScheduleDtoSchema>;

// FR-RPT-008: Daily Control Totals Reconciliation DTO
export const ControlTotalsDtoSchema = z.object({
  summaryDate: z.string(),
  tenantId: z.string(),
  oltpTotals: z.object({
    leads: z.number(),
    sanctions: z.number(),
    sanctionAmount: z.number(),
    disbursements: z.number(),
    disbursementAmount: z.number(),
  }),
  projectionTotals: z.object({
    leads: z.number(),
    sanctions: z.number(),
    sanctionAmount: z.number(),
    disbursements: z.number(),
    disbursementAmount: z.number(),
  }),
  variance: z.object({
    leadsDiff: z.number(),
    sanctionsDiff: z.number(),
    sanctionAmountDiff: z.number(),
    disbursementsDiff: z.number(),
    disbursementAmountDiff: z.number(),
  }),
  reconciled: z.boolean(),
  asOf: z.string().datetime(),
});
export type ControlTotalsDto = z.infer<typeof ControlTotalsDtoSchema>;
