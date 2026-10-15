// apps/api/src/modules/reporting/types.ts — Reporting & Metrics Internal Types
import type {
  AggregationType,
  CanonicalMetricCode,
  ControlTotalsDto,
  DimensionType,
  ExportFileFormat,
  ExportJobDto,
  ExportStatus,
  MetricCategory,
  MetricDefinitionDto,
  MetricUnit,
  ReportCatalogueItem,
  ReportCode,
  ReportRunDto,
  ReportScheduleDto,
  ScheduleFrequency,
} from '@dsa/contracts';

export interface MetricDefinitionRow {
  tenant_id: string;
  code: CanonicalMetricCode;
  name: string;
  description: string;
  category: MetricCategory;
  unit: MetricUnit;
  aggregation_type: AggregationType;
  source_domain: string;
  version?: number;
  formula?: Record<string, unknown>;
  date_basis?: 'CREATED_AT' | 'UPDATED_AT' | 'EVENT_AT' | 'DISBURSED_AT';
  grain?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY';
  filters?: Record<string, unknown>;
  owner?: string;
  effective_from?: string;
  created_at: string;
}

export function toMetricDefinitionDto(row: MetricDefinitionRow): MetricDefinitionDto {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    category: row.category,
    unit: row.unit,
    aggregationType: row.aggregation_type,
    sourceDomain: row.source_domain,
    version: row.version ?? 1,
    formula: row.formula ?? {},
    dateBasis: row.date_basis ?? 'CREATED_AT',
    grain: row.grain ?? 'DAILY',
    filters: row.filters ?? {},
    owner: row.owner ?? 'SYSTEM',
    effectiveFrom: row.effective_from,
    createdAt: row.created_at,
  };
}

export interface PeriodBounds {
  period: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  startIso: string; // ISO 8601 UTC
  endIso: string; // ISO 8601 UTC
}

export function parsePeriodBounds(period: string): PeriodBounds {
  if (period.includes('-Q')) {
    const [yearStr, qStr] = period.split('-Q');
    const year = parseInt(yearStr!, 10);
    const q = parseInt(qStr!, 10);
    let startM = '01';
    let endM = '03';
    let endD = '31';
    if (q === 2) {
      startM = '04';
      endM = '06';
      endD = '30';
    } else if (q === 3) {
      startM = '07';
      endM = '09';
      endD = '30';
    } else if (q === 4) {
      startM = '10';
      endM = '12';
      endD = '31';
    }
    const startDate = `${year}-${startM}-01`;
    const endDate = `${year}-${endM}-${endD}`;
    return {
      period,
      startDate,
      endDate,
      startIso: `${startDate}T00:00:00.000Z`,
      endIso: `${endDate}T23:59:59.999Z`,
    };
  }

  // Monthly: YYYY-MM
  const [yearStr, monthStr] = period.split('-');
  const year = parseInt(yearStr!, 10);
  const month = parseInt(monthStr!, 10);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startDate = `${year}-${monthStr}-01`;
  const endDate = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
  return {
    period,
    startDate,
    endDate,
    startIso: `${startDate}T00:00:00.000Z`,
    endIso: `${endDate}T23:59:59.999Z`,
  };
}

export interface MetricQueryParams {
  period: string;
  metricCodes?: string[];
  dimensionType?: DimensionType;
  dimensionId?: string;
  branchId?: string;
  userId?: string;
  productId?: string;
  allowedBranchIds: string[];
  allowedOwnUserId: string | null;
  isTenantWide: boolean;
}

export interface DashboardQueryParams {
  period: string;
  branchId?: string;
  userId?: string;
  productId?: string;
  allowedBranchIds: string[];
  allowedOwnUserId: string | null;
  isTenantWide: boolean;
}

// SUB-RPT.04: Report Run Entities
export interface ReportRunRow {
  id: string;
  tenant_id: string;
  report_code: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  parameters: Record<string, unknown>;
  row_count: number;
  result_summary: Record<string, unknown>;
  created_by: string;
  created_at: string;
  completed_at: string | null;
  download_url: string | null;
  error_message: string | null;
}

export function toReportRunDto(row: ReportRunRow): ReportRunDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    reportCode: row.report_code,
    status: row.status,
    parameters: row.parameters,
    rowCount: row.row_count,
    resultSummary: row.result_summary,
    createdBy: row.created_by,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    downloadUrl: row.download_url,
    errorMessage: row.error_message,
  };
}

// SUB-RPT.05: Export Job Entities
export interface ExportJobRow {
  id: string;
  tenant_id: string;
  requester_id: string;
  scope_type: 'TENANT' | 'BRANCH' | 'USER';
  scope_id: string | null;
  export_type: string;
  file_format: ExportFileFormat;
  filters: Record<string, unknown>;
  row_count: number;
  file_key: string | null;
  status: ExportStatus;
  download_url: string | null;
  expires_at: string;
  downloaded_at: string | null;
  created_at: string;
}

export function toExportJobDto(row: ExportJobRow): ExportJobDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    requesterId: row.requester_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    exportType: row.export_type,
    fileFormat: row.file_format,
    filters: row.filters,
    rowCount: row.row_count,
    fileKey: row.file_key,
    status: row.status,
    downloadUrl: row.download_url,
    expiresAt: row.expires_at,
    downloadedAt: row.downloaded_at,
    createdAt: row.created_at,
  };
}

// SUB-RPT.05: Report Schedule Entities
export interface ReportScheduleRow {
  id: string;
  tenant_id: string;
  report_code: string;
  frequency: ScheduleFrequency;
  filters: Record<string, unknown>;
  recipient_emails: string[];
  recipient_scope: 'TENANT' | 'BRANCH';
  created_by: string;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string;
  created_at: string;
}

export function toReportScheduleDto(row: ReportScheduleRow): ReportScheduleDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    reportCode: row.report_code,
    frequency: row.frequency,
    filters: row.filters,
    recipientEmails: row.recipient_emails,
    recipientScope: row.recipient_scope,
    createdBy: row.created_by,
    isActive: row.is_active,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
  };
}

// Canonical Report Catalogue Catalog
export const CANONICAL_REPORT_CATALOGUE: ReportCatalogueItem[] = [
  {
    code: 'RPT_LEAD_PIPELINE',
    title: 'Lead Pipeline Register',
    category: 'LEADS',
    description: 'Detailed record-level register of leads, qualification status, and pipeline progression.',
    supportedFormats: ['CSV', 'XLSX', 'JSON'],
  },
  {
    code: 'RPT_DISBURSEMENT_REGISTER',
    title: 'Disbursement Tranche Register',
    category: 'DISBURSEMENTS',
    description: 'Comprehensive disbursement audit with net amounts, UTR numbers, and lender verifications.',
    supportedFormats: ['CSV', 'XLSX'],
  },
  {
    code: 'RPT_SANCTION_LEDGER',
    title: 'Sanction Approval Ledger',
    category: 'SANCTIONS',
    description: 'All loan sanction events with sanctioned amounts, rate terms, and approver details.',
    supportedFormats: ['CSV', 'XLSX'],
  },
  {
    code: 'RPT_BRANCH_SUMMARY',
    title: 'Branch Performance Rollup',
    category: 'OPERATIONS',
    description: 'Aggregated branch metrics across leads, disbursements, targets, and achievement ratios.',
    supportedFormats: ['CSV', 'XLSX', 'JSON'],
  },
  {
    code: 'RPT_ACTIVITY_AUDIT',
    title: 'Client Activity Audit Log',
    category: 'AUDIT',
    description: 'Complete audit log of agent interactions, calls, physical visits, and client notes.',
    supportedFormats: ['CSV', 'JSON'],
  },
  {
    code: 'RPT_TARGET_ACHIEVEMENT',
    title: 'Target vs Achievement Report',
    category: 'OPERATIONS',
    description: 'Detailed target achievement analysis across branches and loan officers with variances.',
    supportedFormats: ['CSV', 'XLSX', 'JSON'],
  },
];
