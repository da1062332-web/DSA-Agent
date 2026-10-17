import type { ControlTotalsDto, DimensionType, Tx } from '@dsa/contracts';
import { sql } from 'kysely';
import type {
  ExportJobRow,
  MetricDefinitionRow,
  PeriodBounds,
  ReportRunRow,
  ReportScheduleRow,
} from './types';

export interface OperationalTotals {
  leadCount: number;
  leadQualifiedCount: number;
  leadConvertedCount: number;
  activityCount: number;
  sanctionCount: number;
  sanctionAmount: number;
  disbursementCount: number;
  disbursementAmount: number;
}

export interface EntitySummaryRow {
  dimensionType: DimensionType;
  dimensionId: string;
  dimensionName: string;
  branchName?: string;
  leadCount: number;
  sanctionCount: number;
  disbursementAmount: number;
}

export interface ReportingRepository {
  listMetricDefinitions(tx: Tx, tenantId: string): Promise<MetricDefinitionRow[]>;
  getApprovedTarget(
    tx: Tx,
    tenantId: string,
    period: string,
    dimensionType: DimensionType | undefined,
    dimensionId: string | undefined,
    metricCode: string,
  ): Promise<number | null>;
  computeOperationalMetrics(
    tx: Tx,
    tenantId: string,
    bounds: PeriodBounds,
    filters: { branchId?: string; userId?: string; productId?: string },
  ): Promise<OperationalTotals>;
  getBranchBreakdown(
    tx: Tx,
    tenantId: string,
    bounds: PeriodBounds,
    branchIds: string[],
  ): Promise<EntitySummaryRow[]>;
  getUserBreakdown(
    tx: Tx,
    tenantId: string,
    bounds: PeriodBounds,
    filters: { branchId?: string; userId?: string },
  ): Promise<EntitySummaryRow[]>;
  refreshProjections(tx: Tx, tenantId: string, startDate: string, endDate: string): Promise<void>;
  getControlTotals(tx: Tx, tenantId: string, summaryDate: string): Promise<ControlTotalsDto>;

  // Submodule 4: Report Runs
  createReportRun(tx: Tx, row: ReportRunRow): Promise<ReportRunRow>;
  getReportRun(tx: Tx, tenantId: string, id: string): Promise<ReportRunRow | null>;
  listReportRuns(tx: Tx, tenantId: string): Promise<ReportRunRow[]>;
  fetchReportData(
    tx: Tx,
    tenantId: string,
    reportCode: string,
  ): Promise<{ headers: string[]; records: Array<Record<string, unknown>> }>;

  // Submodule 5: Exports
  createExportJob(tx: Tx, row: ExportJobRow): Promise<ExportJobRow>;
  getExportJob(tx: Tx, tenantId: string, id: string): Promise<ExportJobRow | null>;
  listExportJobs(tx: Tx, tenantId: string, requesterId?: string): Promise<ExportJobRow[]>;
  updateExportJobDownloadedAt(tx: Tx, tenantId: string, id: string): Promise<void>;
  fetchLeadsForExport(
    tx: Tx,
    tenantId: string,
    branchId?: string | null,
  ): Promise<Array<Record<string, unknown>>>;
  fetchCustomersForExport(
    tx: Tx,
    tenantId: string,
    branchId?: string | null,
  ): Promise<Array<Record<string, unknown>>>;
  queryOperationalSummary(
    tx: Tx,
    tenantId: string,
    filters: { branchId?: string | null },
  ): Promise<Array<Record<string, unknown>>>;

  // Submodule 5: Schedules
  createReportSchedule(tx: Tx, row: ReportScheduleRow): Promise<ReportScheduleRow>;
  listReportSchedules(tx: Tx, tenantId: string): Promise<ReportScheduleRow[]>;
  deleteReportSchedule(tx: Tx, tenantId: string, id: string): Promise<boolean>;
}

export class SqlReportingRepository implements ReportingRepository {
  async listMetricDefinitions(tx: Tx, tenantId: string): Promise<MetricDefinitionRow[]> {
    const res = await sql<MetricDefinitionRow>`
      SELECT * FROM metric_definition
      WHERE tenant_id = ${tenantId}
      ORDER BY code ASC
    `.execute(tx);
    return res.rows;
  }

  async getApprovedTarget(
    tx: Tx,
    tenantId: string,
    period: string,
    dimensionType: DimensionType | undefined,
    dimensionId: string | undefined,
    metricCode: string,
  ): Promise<number | null> {
    if (!dimensionType || !dimensionId) {
      const res = await sql<{ target_value: string }>`
        SELECT target_value FROM target
        WHERE tenant_id = ${tenantId}
          AND period = ${period}
          AND metric_code = ${metricCode}
          AND status = 'APPROVED'
        LIMIT 1
      `.execute(tx);
      return res.rows[0] ? parseFloat(res.rows[0].target_value) : null;
    }

    const res = await sql<{ target_value: string }>`
      SELECT target_value FROM target
      WHERE tenant_id = ${tenantId}
        AND period = ${period}
        AND dimension_type = ${dimensionType}
        AND dimension_id = ${dimensionId}
        AND metric_code = ${metricCode}
        AND status = 'APPROVED'
      LIMIT 1
    `.execute(tx);
    return res.rows[0] ? parseFloat(res.rows[0].target_value) : null;
  }

  async computeOperationalMetrics(
    tx: Tx,
    tenantId: string,
    bounds: PeriodBounds,
    filters: { branchId?: string; userId?: string; productId?: string },
  ): Promise<OperationalTotals> {
    // 1. Leads
    const leadRes = await sql<{
      total_leads: string;
      qualified_leads: string;
      converted_leads: string;
    }>`
      SELECT
        count(*)::text AS total_leads,
        count(*) FILTER (WHERE state IN ('QUALIFIED', 'CONVERTED'))::text AS qualified_leads,
        count(*) FILTER (WHERE state = 'CONVERTED')::text AS converted_leads
      FROM lead
      WHERE tenant_id = ${tenantId}
        AND created_at >= ${bounds.startIso}::timestamptz
        AND created_at <= ${bounds.endIso}::timestamptz
        ${filters.branchId ? sql`AND branch_id = ${filters.branchId}` : sql``}
        ${filters.userId ? sql`AND owner_user_id = ${filters.userId}` : sql``}
    `.execute(tx);

    const leadCount = parseInt(leadRes.rows[0]?.total_leads ?? '0', 10);
    const leadQualifiedCount = parseInt(leadRes.rows[0]?.qualified_leads ?? '0', 10);
    const leadConvertedCount = parseInt(leadRes.rows[0]?.converted_leads ?? '0', 10);

    // 2. Activities
    const actRes = await sql<{ total_activities: string }>`
      SELECT count(*)::text AS total_activities
      FROM activity
      WHERE tenant_id = ${tenantId}
        AND occurred_at >= ${bounds.startIso}::timestamptz
        AND occurred_at <= ${bounds.endIso}::timestamptz
        ${filters.branchId ? sql`AND actor_branch_id = ${filters.branchId}` : sql``}
        ${filters.userId ? sql`AND actor_id = ${filters.userId}` : sql``}
    `.execute(tx);
    const activityCount = parseInt(actRes.rows[0]?.total_activities ?? '0', 10);

    // 3. Sanctions
    const sancRes = await sql<{ sanction_count: string; sanction_amount: string }>`
      SELECT
        count(s.id)::text AS sanction_count,
        coalesce(sum(s.amount), 0)::text AS sanction_amount
      FROM sanction s
      JOIN lender_case lc ON lc.id = s.lender_case_id AND lc.tenant_id = s.tenant_id
      JOIN loan_application a ON a.id = lc.application_id AND a.tenant_id = s.tenant_id
      WHERE s.tenant_id = ${tenantId}
        AND s.status = 'ACTIVE'
        AND s.sanction_date >= ${bounds.startDate}::date
        AND s.sanction_date <= ${bounds.endDate}::date
        ${filters.branchId ? sql`AND a.branch_id = ${filters.branchId}` : sql``}
        ${filters.userId ? sql`AND a.sales_owner_id = ${filters.userId}` : sql``}
        ${filters.productId ? sql`AND a.product_category = ${filters.productId}` : sql``}
    `.execute(tx);
    const sanctionCount = parseInt(sancRes.rows[0]?.sanction_count ?? '0', 10);
    const sanctionAmount = parseFloat(sancRes.rows[0]?.sanction_amount ?? '0');

    // 4. Disbursements
    const disbRes = await sql<{ disbursement_count: string; disbursement_amount: string }>`
      SELECT
        count(d.id)::text AS disbursement_count,
        coalesce(sum(d.amount), 0)::text AS disbursement_amount
      FROM disbursement_tranche d
      JOIN sanction s ON s.id = d.sanction_id AND s.tenant_id = d.tenant_id
      JOIN lender_case lc ON lc.id = s.lender_case_id AND lc.tenant_id = d.tenant_id
      JOIN loan_application a ON a.id = lc.application_id AND a.tenant_id = d.tenant_id
      WHERE d.tenant_id = ${tenantId}
        AND d.status IN ('RECORDED', 'VERIFIED')
        AND d.disbursed_on >= ${bounds.startDate}::date
        AND d.disbursed_on <= ${bounds.endDate}::date
        ${filters.branchId ? sql`AND a.branch_id = ${filters.branchId}` : sql``}
        ${filters.userId ? sql`AND a.sales_owner_id = ${filters.userId}` : sql``}
        ${filters.productId ? sql`AND a.product_category = ${filters.productId}` : sql``}
    `.execute(tx);
    const disbursementCount = parseInt(disbRes.rows[0]?.disbursement_count ?? '0', 10);
    const disbursementAmount = parseFloat(disbRes.rows[0]?.disbursement_amount ?? '0');

    return {
      leadCount,
      leadQualifiedCount,
      leadConvertedCount,
      activityCount,
      sanctionCount,
      sanctionAmount,
      disbursementCount,
      disbursementAmount,
    };
  }

  async getBranchBreakdown(
    tx: Tx,
    tenantId: string,
    bounds: PeriodBounds,
    branchIds: string[],
  ): Promise<EntitySummaryRow[]> {
    const branches = await sql<{ id: string; name: string }>`
      SELECT id, name FROM branch
      WHERE tenant_id = ${tenantId}
      ${branchIds.length > 0 ? sql`AND id IN (${sql.join(branchIds.map((id) => sql`${id}`))})` : sql``}
      ORDER BY name ASC
    `.execute(tx);

    const results: EntitySummaryRow[] = [];
    for (const b of branches.rows) {
      const totals = await this.computeOperationalMetrics(tx, tenantId, bounds, {
        branchId: b.id,
      });
      results.push({
        dimensionType: 'BRANCH',
        dimensionId: b.id,
        dimensionName: b.name,
        leadCount: totals.leadCount,
        sanctionCount: totals.sanctionCount,
        disbursementAmount: totals.disbursementAmount,
      });
    }
    return results;
  }

  async getUserBreakdown(
    tx: Tx,
    tenantId: string,
    bounds: PeriodBounds,
    filters: { branchId?: string; userId?: string },
  ): Promise<EntitySummaryRow[]> {
    const users = await sql<{ id: string; name: string; branch_name: string }>`
      SELECT u.id, coalesce(u.display_name, u.email) as name, coalesce(b.name, 'Unassigned') as branch_name
      FROM app_user u
      LEFT JOIN branch b ON b.id = u.primary_branch_id AND b.tenant_id = u.tenant_id
      WHERE u.tenant_id = ${tenantId}
      ${filters.branchId ? sql`AND u.primary_branch_id = ${filters.branchId}` : sql``}
      ${filters.userId ? sql`AND u.id = ${filters.userId}` : sql``}
      ORDER BY u.display_name ASC
    `.execute(tx);

    const results: EntitySummaryRow[] = [];
    for (const u of users.rows) {
      const totals = await this.computeOperationalMetrics(tx, tenantId, bounds, {
        userId: u.id,
      });
      results.push({
        dimensionType: 'USER',
        dimensionId: u.id,
        dimensionName: u.name,
        branchName: u.branch_name,
        leadCount: totals.leadCount,
        sanctionCount: totals.sanctionCount,
        disbursementAmount: totals.disbursementAmount,
      });
    }
    return results;
  }

  async refreshProjections(tx: Tx, tenantId: string, startDate: string, endDate: string): Promise<void> {
    await sql`
      INSERT INTO rpt_daily_operational_summary (
        tenant_id,
        summary_date,
        branch_id,
        user_id,
        lead_created_count,
        lead_qualified_count,
        lead_converted_count,
        activity_count,
        sanction_count,
        sanction_amount,
        disbursement_count,
        disbursement_amount,
        refreshed_at
      )
      SELECT
        l.tenant_id,
        l.created_at::date AS summary_date,
        l.branch_id,
        l.owner_user_id AS user_id,
        count(l.id) AS lead_created_count,
        count(l.id) FILTER (WHERE l.state IN ('QUALIFIED', 'CONVERTED')) AS lead_qualified_count,
        count(l.id) FILTER (WHERE l.state = 'CONVERTED') AS lead_converted_count,
        0 AS activity_count,
        0 AS sanction_count,
        0 AS sanction_amount,
        0 AS disbursement_count,
        0 AS disbursement_amount,
        now() AS refreshed_at
      FROM lead l
      WHERE l.tenant_id = ${tenantId}
        AND l.created_at >= ${startDate}::date
        AND l.created_at <= (${endDate}::date + interval '1 day')
      GROUP BY l.tenant_id, l.created_at::date, l.branch_id, l.owner_user_id
      ON CONFLICT (tenant_id, summary_date, branch_id, user_id) DO UPDATE
      SET
        lead_created_count = EXCLUDED.lead_created_count,
        lead_qualified_count = EXCLUDED.lead_qualified_count,
        lead_converted_count = EXCLUDED.lead_converted_count,
        refreshed_at = now();
    `.execute(tx);
  }

  async getControlTotals(tx: Tx, tenantId: string, summaryDate: string): Promise<ControlTotalsDto> {
    const oltpLead = await sql<{ total: string }>`
      SELECT count(*)::text as total FROM lead
      WHERE tenant_id = ${tenantId} AND created_at::date = ${summaryDate}::date
    `.execute(tx);
    const oltpSanc = await sql<{ total: string; amount: string }>`
      SELECT count(*)::text as total, coalesce(sum(amount), 0)::text as amount FROM sanction
      WHERE tenant_id = ${tenantId} AND status = 'ACTIVE' AND sanction_date = ${summaryDate}::date
    `.execute(tx);
    const oltpDisb = await sql<{ total: string; amount: string }>`
      SELECT count(*)::text as total, coalesce(sum(amount), 0)::text as amount FROM disbursement_tranche
      WHERE tenant_id = ${tenantId} AND status IN ('RECORDED', 'VERIFIED') AND disbursed_on = ${summaryDate}::date
    `.execute(tx);

    const projRes = await sql<{
      leads: string;
      sanctions: string;
      sanction_amount: string;
      disbursements: string;
      disbursement_amount: string;
    }>`
      SELECT
        coalesce(sum(lead_created_count), 0)::text as leads,
        coalesce(sum(sanction_count), 0)::text as sanctions,
        coalesce(sum(sanction_amount), 0)::text as sanction_amount,
        coalesce(sum(disbursement_count), 0)::text as disbursements,
        coalesce(sum(disbursement_amount), 0)::text as disbursement_amount
      FROM rpt_daily_operational_summary
      WHERE tenant_id = ${tenantId} AND summary_date = ${summaryDate}::date
    `.execute(tx);

    const oltpTotals = {
      leads: parseInt(oltpLead.rows[0]?.total ?? '0', 10),
      sanctions: parseInt(oltpSanc.rows[0]?.total ?? '0', 10),
      sanctionAmount: parseFloat(oltpSanc.rows[0]?.amount ?? '0'),
      disbursements: parseInt(oltpDisb.rows[0]?.total ?? '0', 10),
      disbursementAmount: parseFloat(oltpDisb.rows[0]?.amount ?? '0'),
    };

    const projectionTotals = {
      leads: parseInt(projRes.rows[0]?.leads ?? '0', 10),
      sanctions: parseInt(projRes.rows[0]?.sanctions ?? '0', 10),
      sanctionAmount: parseFloat(projRes.rows[0]?.sanction_amount ?? '0'),
      disbursements: parseInt(projRes.rows[0]?.disbursements ?? '0', 10),
      disbursementAmount: parseFloat(projRes.rows[0]?.disbursement_amount ?? '0'),
    };

    const variance = {
      leadsDiff: Math.abs(oltpTotals.leads - projectionTotals.leads),
      sanctionsDiff: Math.abs(oltpTotals.sanctions - projectionTotals.sanctions),
      sanctionAmountDiff: Math.abs(oltpTotals.sanctionAmount - projectionTotals.sanctionAmount),
      disbursementsDiff: Math.abs(oltpTotals.disbursements - projectionTotals.disbursements),
      disbursementAmountDiff: Math.abs(oltpTotals.disbursementAmount - projectionTotals.disbursementAmount),
    };

    const reconciled =
      variance.leadsDiff === 0 &&
      variance.sanctionsDiff === 0 &&
      variance.sanctionAmountDiff === 0 &&
      variance.disbursementsDiff === 0 &&
      variance.disbursementAmountDiff === 0;

    return {
      summaryDate,
      tenantId,
      oltpTotals,
      projectionTotals,
      variance,
      reconciled,
      asOf: new Date().toISOString(),
    };
  }

  async createReportRun(tx: Tx, row: ReportRunRow): Promise<ReportRunRow> {
    const res = await sql<ReportRunRow>`
      INSERT INTO report_run (
        id, tenant_id, report_code, status, parameters, row_count, result_summary,
        created_by, created_at, completed_at, download_url, error_message
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.report_code}, ${row.status},
        ${JSON.stringify(row.parameters)}::jsonb, ${row.row_count}, ${JSON.stringify(row.result_summary)}::jsonb,
        ${row.created_by}, ${row.created_at}::timestamptz,
        ${row.completed_at ? sql`${row.completed_at}::timestamptz` : null},
        ${row.download_url}, ${row.error_message}
      )
      RETURNING *
    `.execute(tx);
    return res.rows[0]!;
  }

  async getReportRun(tx: Tx, tenantId: string, id: string): Promise<ReportRunRow | null> {
    const res = await sql<ReportRunRow>`
      SELECT * FROM report_run
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async listReportRuns(tx: Tx, tenantId: string): Promise<ReportRunRow[]> {
    const res = await sql<ReportRunRow>`
      SELECT * FROM report_run
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
      LIMIT 100
    `.execute(tx);
    return res.rows;
  }

  async createExportJob(tx: Tx, row: ExportJobRow): Promise<ExportJobRow> {
    const res = await sql<ExportJobRow>`
      INSERT INTO export_job (
        id, tenant_id, requester_id, scope_type, scope_id, export_type, file_format,
        filters, row_count, file_key, status, download_url, expires_at, downloaded_at, created_at
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.requester_id}, ${row.scope_type}, ${row.scope_id},
        ${row.export_type}, ${row.file_format}, ${JSON.stringify(row.filters)}::jsonb,
        ${row.row_count}, ${row.file_key}, ${row.status}, ${row.download_url},
        ${row.expires_at}::timestamptz,
        ${row.downloaded_at ? sql`${row.downloaded_at}::timestamptz` : null},
        ${row.created_at}::timestamptz
      )
      RETURNING *
    `.execute(tx);
    return res.rows[0]!;
  }

  async getExportJob(tx: Tx, tenantId: string, id: string): Promise<ExportJobRow | null> {
    const res = await sql<ExportJobRow>`
      SELECT * FROM export_job
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async listExportJobs(tx: Tx, tenantId: string, requesterId?: string): Promise<ExportJobRow[]> {
    const res = await sql<ExportJobRow>`
      SELECT * FROM export_job
      WHERE tenant_id = ${tenantId}
      ${requesterId ? sql`AND requester_id = ${requesterId}` : sql``}
      ORDER BY created_at DESC
      LIMIT 100
    `.execute(tx);
    return res.rows;
  }

  async updateExportJobDownloadedAt(tx: Tx, tenantId: string, id: string): Promise<void> {
    await sql`
      UPDATE export_job
         SET downloaded_at = now()
       WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
  }

  async fetchLeadsForExport(
    tx: Tx,
    tenantId: string,
    branchId?: string | null,
  ): Promise<Array<Record<string, unknown>>> {
    const branchFilter = branchId ? sql`AND branch_id = ${branchId}` : sql``;
    const res = await sql<Record<string, unknown>>`
      SELECT id, branch_id, full_name, mobile_e164, email, product_category, indicative_amount, source, state, created_at
      FROM lead
      WHERE tenant_id = ${tenantId} ${branchFilter}
      ORDER BY created_at DESC
      LIMIT 1000
    `.execute(tx);
    return res.rows;
  }

  async fetchCustomersForExport(
    tx: Tx,
    tenantId: string,
    branchId?: string | null,
  ): Promise<Array<Record<string, unknown>>> {
    const branchFilter = branchId ? sql`AND c.home_branch_id = ${branchId}` : sql``;
    const res = await sql<Record<string, unknown>>`
      SELECT
        c.id,
        c.home_branch_id as primary_branch_id,
        c.party_type as customer_type,
        c.full_name,
        cpm.value as mobile_e164,
        cpe.value as email,
        c.created_at
      FROM customer c
      LEFT JOIN customer_contact_point cpm ON cpm.customer_id = c.id AND cpm.kind = 'MOBILE' AND cpm.is_primary = true
      LEFT JOIN customer_contact_point cpe ON cpe.customer_id = c.id AND cpe.kind = 'EMAIL' AND cpe.is_primary = true
      WHERE c.tenant_id = ${tenantId} ${branchFilter}
      ORDER BY c.created_at DESC
      LIMIT 1000
    `.execute(tx);
    return res.rows;
  }

  async fetchReportData(
    tx: Tx,
    tenantId: string,
    reportCode: string,
  ): Promise<{ headers: string[]; records: Array<Record<string, unknown>> }> {
    if (reportCode === 'RPT_LEAD_PIPELINE') {
      const records = await this.fetchLeadsForExport(tx, tenantId, null);
      const headers = [
        'id',
        'branch_id',
        'full_name',
        'mobile_e164',
        'email',
        'product_category',
        'indicative_amount',
        'source',
        'state',
        'created_at',
      ];
      return { headers, records };
    }

    if (reportCode === 'RPT_DISBURSEMENT_REGISTER') {
      const res = await sql<Record<string, unknown>>`
        SELECT d.id, d.tenant_id, d.sanction_id, d.amount, d.disbursed_on, d.utr_number, d.status
        FROM disbursement_tranche d
        WHERE d.tenant_id = ${tenantId}
        ORDER BY d.disbursed_on DESC
        LIMIT 1000
      `.execute(tx);
      const headers = ['id', 'tenant_id', 'sanction_id', 'amount', 'disbursed_on', 'utr_number', 'status'];
      return { headers, records: res.rows };
    }

    if (reportCode === 'RPT_SANCTION_LEDGER') {
      const res = await sql<Record<string, unknown>>`
        SELECT s.id, s.tenant_id, s.lender_case_id, s.amount, s.sanction_date, s.status
        FROM sanction s
        WHERE s.tenant_id = ${tenantId}
        ORDER BY s.sanction_date DESC
        LIMIT 1000
      `.execute(tx);
      const headers = ['id', 'tenant_id', 'lender_case_id', 'amount', 'sanction_date', 'status'];
      return { headers, records: res.rows };
    }

    if (reportCode === 'RPT_BRANCH_SUMMARY') {
      const res = await sql<Record<string, unknown>>`
        SELECT b.id as branch_id, b.name as branch_name, b.code as branch_code, b.pincode, b.status
        FROM branch b
        WHERE b.tenant_id = ${tenantId}
        ORDER BY b.name ASC
      `.execute(tx);
      const headers = ['branch_id', 'branch_name', 'branch_code', 'pincode', 'status'];
      return { headers, records: res.rows };
    }

    if (reportCode === 'RPT_ACTIVITY_AUDIT') {
      const res = await sql<Record<string, unknown>>`
        SELECT a.id, a.actor_id, a.actor_branch_id, a.entity_type, a.entity_id, a.kind, a.occurred_at
        FROM activity a
        WHERE a.tenant_id = ${tenantId}
        ORDER BY a.occurred_at DESC
        LIMIT 1000
      `.execute(tx);
      const headers = [
        'id',
        'actor_id',
        'actor_branch_id',
        'entity_type',
        'entity_id',
        'kind',
        'occurred_at',
      ];
      return { headers, records: res.rows };
    }

    if (reportCode === 'RPT_TARGET_ACHIEVEMENT') {
      const res = await sql<Record<string, unknown>>`
        SELECT t.id, t.period, t.dimension_type, t.dimension_id, t.metric_code, t.target_value, t.unit, t.status
        FROM target t
        WHERE t.tenant_id = ${tenantId}
        ORDER BY t.created_at DESC
        LIMIT 1000
      `.execute(tx);
      const headers = [
        'id',
        'period',
        'dimension_type',
        'dimension_id',
        'metric_code',
        'target_value',
        'unit',
        'status',
      ];
      return { headers, records: res.rows };
    }

    // Default summary
    return {
      headers: ['report_code', 'status', 'generated_at'],
      records: [{ report_code: reportCode, status: 'COMPLETED', generated_at: new Date().toISOString() }],
    };
  }

  async queryOperationalSummary(
    tx: Tx,
    tenantId: string,
    filters: { branchId?: string | null },
  ): Promise<Array<Record<string, unknown>>> {
    const branchFilter = filters.branchId ? sql`AND branch_id = ${filters.branchId}` : sql``;
    const res = await sql<Record<string, unknown>>`
      SELECT summary_date, tenant_id, branch_id,
             lead_created_count AS leads_created,
             lead_qualified_count AS leads_qualified,
             lead_converted_count AS leads_converted,
             sanction_count AS sanctions_count,
             disbursement_count AS disbursements_count
      FROM rpt_daily_operational_summary
      WHERE tenant_id = ${tenantId} ${branchFilter}
      ORDER BY summary_date DESC
      LIMIT 1000
    `.execute(tx);
    return res.rows;
  }

  async createReportSchedule(tx: Tx, row: ReportScheduleRow): Promise<ReportScheduleRow> {
    const res = await sql<ReportScheduleRow>`
      INSERT INTO report_schedule (
        id, tenant_id, report_code, frequency, filters, recipient_emails,
        recipient_scope, created_by, is_active, last_run_at, next_run_at, created_at
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.report_code}, ${row.frequency},
        ${JSON.stringify(row.filters)}::jsonb, ${row.recipient_emails},
        ${row.recipient_scope}, ${row.created_by}, ${row.is_active},
        ${row.last_run_at ? sql`${row.last_run_at}::timestamptz` : null},
        ${row.next_run_at}::timestamptz,
        ${row.created_at}::timestamptz
      )
      RETURNING *
    `.execute(tx);
    return res.rows[0]!;
  }

  async listReportSchedules(tx: Tx, tenantId: string): Promise<ReportScheduleRow[]> {
    const res = await sql<ReportScheduleRow>`
      SELECT * FROM report_schedule
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
    `.execute(tx);
    return res.rows;
  }

  async deleteReportSchedule(tx: Tx, tenantId: string, id: string): Promise<boolean> {
    const res = await sql`
      DELETE FROM report_schedule
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return (res.numAffectedRows ?? 0n) > 0n;
  }
}

// In-Memory Double for isolated unit tests
export class InMemoryReportingRepository implements ReportingRepository {
  readonly metricDefinitions: MetricDefinitionRow[] = [
    {
      tenant_id: 'ten_default',
      code: 'LEAD_COUNT',
      name: 'Lead Intake Count',
      description: 'Total new leads captured within period',
      category: 'ACTIVITY',
      unit: 'COUNT',
      aggregation_type: 'COUNT',
      source_domain: 'CRM',
      version: 1,
      formula: { type: 'COUNT', table: 'lead' },
      date_basis: 'CREATED_AT',
      grain: 'DAILY',
      filters: {},
      owner: 'SYSTEM',
      created_at: '2026-10-01T00:00:00.000Z',
    },
    {
      tenant_id: 'ten_default',
      code: 'LEAD_QUALIFIED_COUNT',
      name: 'Qualified Leads',
      description: 'Total leads reaching QUALIFIED or CONVERTED status',
      category: 'ACTIVITY',
      unit: 'COUNT',
      aggregation_type: 'COUNT',
      source_domain: 'CRM',
      version: 1,
      formula: { type: 'COUNT', table: 'lead', state: 'QUALIFIED' },
      date_basis: 'CREATED_AT',
      grain: 'DAILY',
      filters: {},
      owner: 'SYSTEM',
      created_at: '2026-10-01T00:00:00.000Z',
    },
    {
      tenant_id: 'ten_default',
      code: 'LEAD_CONVERTED_COUNT',
      name: 'Converted Leads',
      description: 'Total leads converted to loan application',
      category: 'OUTCOME',
      unit: 'COUNT',
      aggregation_type: 'COUNT',
      source_domain: 'CRM',
      version: 1,
      formula: { type: 'COUNT', table: 'lead', state: 'CONVERTED' },
      date_basis: 'CREATED_AT',
      grain: 'DAILY',
      filters: {},
      owner: 'SYSTEM',
      created_at: '2026-10-01T00:00:00.000Z',
    },
    {
      tenant_id: 'ten_default',
      code: 'ACTIVITY_COUNT',
      name: 'Operational Activities',
      description: 'Total calls, meetings, and customer interactions',
      category: 'ACTIVITY',
      unit: 'COUNT',
      aggregation_type: 'COUNT',
      source_domain: 'CRM',
      version: 1,
      formula: { type: 'COUNT', table: 'activity' },
      date_basis: 'EVENT_AT',
      grain: 'DAILY',
      filters: {},
      owner: 'SYSTEM',
      created_at: '2026-10-01T00:00:00.000Z',
    },
    {
      tenant_id: 'ten_default',
      code: 'SANCTION_COUNT',
      name: 'Sanctions Approved',
      description: 'Total active loan sanctions issued',
      category: 'OUTCOME',
      unit: 'COUNT',
      aggregation_type: 'COUNT',
      source_domain: 'ORIGINATION',
      version: 1,
      formula: { type: 'COUNT', table: 'sanction' },
      date_basis: 'CREATED_AT',
      grain: 'DAILY',
      filters: {},
      owner: 'SYSTEM',
      created_at: '2026-10-01T00:00:00.000Z',
    },
    {
      tenant_id: 'ten_default',
      code: 'SANCTION_AMOUNT',
      name: 'Sanctioned Amount',
      description: 'Total rupee amount of approved sanctions',
      category: 'OUTCOME',
      unit: 'INR',
      aggregation_type: 'SUM',
      source_domain: 'ORIGINATION',
      version: 1,
      formula: { type: 'SUM', table: 'sanction', field: 'amount' },
      date_basis: 'CREATED_AT',
      grain: 'DAILY',
      filters: {},
      owner: 'SYSTEM',
      created_at: '2026-10-01T00:00:00.000Z',
    },
    {
      tenant_id: 'ten_default',
      code: 'DISBURSEMENT_COUNT',
      name: 'Disbursement Tranches',
      description: 'Total loan disbursement tranches released',
      category: 'OUTCOME',
      unit: 'COUNT',
      aggregation_type: 'COUNT',
      source_domain: 'ORIGINATION',
      version: 1,
      formula: { type: 'COUNT', table: 'disbursement_tranche' },
      date_basis: 'DISBURSED_AT',
      grain: 'DAILY',
      filters: {},
      owner: 'SYSTEM',
      created_at: '2026-10-01T00:00:00.000Z',
    },
    {
      tenant_id: 'ten_default',
      code: 'DISBURSEMENT_AMOUNT',
      name: 'Disbursement Amount',
      description: 'Total rupee amount disbursed to borrowers',
      category: 'OUTCOME',
      unit: 'INR',
      aggregation_type: 'SUM',
      source_domain: 'ORIGINATION',
      version: 1,
      formula: { type: 'SUM', table: 'disbursement_tranche', field: 'amount' },
      date_basis: 'DISBURSED_AT',
      grain: 'DAILY',
      filters: {},
      owner: 'SYSTEM',
      created_at: '2026-10-01T00:00:00.000Z',
    },
    {
      tenant_id: 'ten_default',
      code: 'LEAD_CONVERSION_RATE',
      name: 'Lead Conversion Rate',
      description: 'Ratio of converted leads to total leads created (%)',
      category: 'EFFICIENCY',
      unit: 'PERCENTAGE',
      aggregation_type: 'RATIO',
      source_domain: 'CRM',
      version: 1,
      formula: { type: 'RATIO', num: 'LEAD_CONVERTED_COUNT', den: 'LEAD_COUNT' },
      date_basis: 'CREATED_AT',
      grain: 'DAILY',
      filters: {},
      owner: 'SYSTEM',
      created_at: '2026-10-01T00:00:00.000Z',
    },
  ];

  readonly targets = new Map<string, number>();
  readonly branches = new Map<string, string>([
    ['brn_mumbai_01', 'Mumbai Central'],
    ['brn_delhi_01', 'Delhi Connaught'],
    ['brn_blr_01', 'Bengaluru Indiranagar'],
  ]);

  readonly users = new Map<string, { name: string; branchId: string; tenantId?: string }>([
    ['usr_rajesh_01', { name: 'Rajesh Sharma', branchId: 'brn_mumbai_01', tenantId: 'ten_default' }],
    ['usr_priya_02', { name: 'Priya Patel', branchId: 'brn_mumbai_01', tenantId: 'ten_default' }],
    ['usr_amit_03', { name: 'Amit Verma', branchId: 'brn_delhi_01', tenantId: 'ten_default' }],
    ['usr_sneha_04', { name: 'Sneha Rao', branchId: 'brn_blr_01', tenantId: 'ten_default' }],
  ]);

  readonly leads: Array<{
    tenantId: string;
    id: string;
    createdAt: string;
    branchId: string;
    ownerUserId?: string;
    userId?: string;
    state: string;
  }> = [];

  readonly activities: Array<{
    tenantId: string;
    id: string;
    occurredAt: string;
    branchId: string;
    actorId: string;
    kind?: string;
  }> = [];

  readonly sanctions: Array<{
    tenantId: string;
    id: string;
    sanctionDate: string;
    branchId: string;
    userId: string;
    amount: number;
    status: string;
  }> = [];

  readonly disbursements: Array<{
    tenantId: string;
    id: string;
    disbursedOn: string;
    branchId: string;
    userId: string;
    amount: number;
    status: string;
  }> = [];

  readonly reportRuns = new Map<string, ReportRunRow>();
  readonly exportJobs = new Map<string, ExportJobRow>();
  readonly reportSchedules = new Map<string, ReportScheduleRow>();

  constructor() {
    this.seedMockData();
  }

  private seedMockData(): void {
    const ten = 'ten_default';
    this.targets.set(`${ten}:2026-10:DISBURSEMENT_AMOUNT`, 10000000);
    this.targets.set(`${ten}:2026-10:LEAD_COUNT`, 100);
    this.targets.set(`${ten}:2026-10:SANCTION_COUNT`, 25);
    this.targets.set(`${ten}:2026-10:BRANCH:brn_mumbai_01:DISBURSEMENT_AMOUNT`, 5000000);
    this.targets.set(`${ten}:2026-10:BRANCH:brn_delhi_01:DISBURSEMENT_AMOUNT`, 3000000);
    this.targets.set(`${ten}:2026-10:BRANCH:brn_blr_01:DISBURSEMENT_AMOUNT`, 2000000);

    for (let i = 1; i <= 30; i++) {
      const state = i <= 8 ? 'CONVERTED' : i <= 18 ? 'QUALIFIED' : 'NEW';
      const branchId = i % 2 === 0 ? 'brn_mumbai_01' : 'brn_delhi_01';
      const ownerUserId = i % 2 === 0 ? 'usr_rajesh_01' : 'usr_amit_03';
      this.leads.push({
        tenantId: ten,
        id: `lead_${i}`,
        createdAt: `2026-10-${String(Math.min(i, 28)).padStart(2, '0')}T10:00:00.000Z`,
        branchId,
        ownerUserId,
        state,
      });
    }

    for (let i = 1; i <= 40; i++) {
      const branchId = i % 2 === 0 ? 'brn_mumbai_01' : 'brn_delhi_01';
      const actorId = i % 2 === 0 ? 'usr_rajesh_01' : 'usr_amit_03';
      this.activities.push({
        tenantId: ten,
        id: `act_${i}`,
        occurredAt: `2026-10-${String(Math.min(i, 28)).padStart(2, '0')}T12:00:00.000Z`,
        branchId,
        actorId,
        kind: 'CALL',
      });
    }

    for (let i = 1; i <= 10; i++) {
      const branchId = i % 2 === 0 ? 'brn_mumbai_01' : 'brn_delhi_01';
      const userId = i % 2 === 0 ? 'usr_rajesh_01' : 'usr_amit_03';
      this.sanctions.push({
        tenantId: ten,
        id: `snc_${i}`,
        sanctionDate: `2026-10-${String(Math.min(i * 2, 28)).padStart(2, '0')}`,
        branchId,
        userId,
        amount: 500000,
        status: 'ACTIVE',
      });
    }

    for (let i = 1; i <= 8; i++) {
      const branchId = i % 2 === 0 ? 'brn_mumbai_01' : 'brn_delhi_01';
      const userId = i % 2 === 0 ? 'usr_rajesh_01' : 'usr_amit_03';
      this.disbursements.push({
        tenantId: ten,
        id: `trn_${i}`,
        disbursedOn: `2026-10-${String(Math.min(i * 3, 28)).padStart(2, '0')}`,
        branchId,
        userId,
        amount: 450000,
        status: 'VERIFIED',
      });
    }
  }

  async listMetricDefinitions(_tx: Tx, tenantId: string): Promise<MetricDefinitionRow[]> {
    return this.metricDefinitions.filter((d) => d.tenant_id === tenantId || d.tenant_id === 'ten_default');
  }

  async getApprovedTarget(
    _tx: Tx,
    tenantId: string,
    period: string,
    dimensionType: DimensionType | undefined,
    dimensionId: string | undefined,
    metricCode: string,
  ): Promise<number | null> {
    if (dimensionType && dimensionId) {
      const key = `${tenantId}:${period}:${dimensionType}:${dimensionId}:${metricCode}`;
      if (this.targets.has(key)) return this.targets.get(key)!;
    }
    const genericKey = `${tenantId}:${period}:${metricCode}`;
    if (this.targets.has(genericKey)) return this.targets.get(genericKey)!;
    const allKey = `${tenantId}:${period}:ALL:ALL:${metricCode}`;
    if (this.targets.has(allKey)) return this.targets.get(allKey)!;
    return null;
  }

  async computeOperationalMetrics(
    _tx: Tx,
    tenantId: string,
    bounds: PeriodBounds,
    filters: { branchId?: string; userId?: string; productId?: string },
  ): Promise<OperationalTotals> {
    const startMs = new Date(bounds.startIso).getTime();
    const endMs = new Date(bounds.endIso).getTime();

    const matchingLeads = this.leads.filter((l) => {
      if (l.tenantId !== tenantId) return false;
      const ms = new Date(l.createdAt).getTime();
      if (ms < startMs || ms > endMs) return false;
      if (filters.branchId && l.branchId !== filters.branchId) return false;
      const owner = l.ownerUserId ?? l.userId;
      if (filters.userId && owner !== filters.userId) return false;
      return true;
    });

    const leadCount = matchingLeads.length;
    const leadQualifiedCount = matchingLeads.filter((l) =>
      ['QUALIFIED', 'CONVERTED'].includes(l.state),
    ).length;
    const leadConvertedCount = matchingLeads.filter((l) => l.state === 'CONVERTED').length;

    const matchingActs = this.activities.filter((a) => {
      if (a.tenantId !== tenantId) return false;
      const ms = new Date(a.occurredAt).getTime();
      if (ms < startMs || ms > endMs) return false;
      if (filters.branchId && a.branchId !== filters.branchId) return false;
      if (filters.userId && a.actorId !== filters.userId) return false;
      return true;
    });
    const activityCount = matchingActs.length;

    const matchingSancs = this.sanctions.filter((s) => {
      if (s.tenantId !== tenantId) return false;
      if (s.status !== 'ACTIVE') return false;
      if (s.sanctionDate < bounds.startDate || s.sanctionDate > bounds.endDate) return false;
      if (filters.branchId && s.branchId !== filters.branchId) return false;
      if (filters.userId && s.userId !== filters.userId) return false;
      return true;
    });
    const sanctionCount = matchingSancs.length;
    const sanctionAmount = matchingSancs.reduce((acc, s) => acc + s.amount, 0);

    const matchingDisbs = this.disbursements.filter((d) => {
      if (d.tenantId !== tenantId) return false;
      if (!['RECORDED', 'VERIFIED'].includes(d.status)) return false;
      if (d.disbursedOn < bounds.startDate || d.disbursedOn > bounds.endDate) return false;
      if (filters.branchId && d.branchId !== filters.branchId) return false;
      if (filters.userId && d.userId !== filters.userId) return false;
      return true;
    });
    const disbursementCount = matchingDisbs.length;
    const disbursementAmount = matchingDisbs.reduce((acc, d) => acc + d.amount, 0);

    return {
      leadCount,
      leadQualifiedCount,
      leadConvertedCount,
      activityCount,
      sanctionCount,
      sanctionAmount,
      disbursementCount,
      disbursementAmount,
    };
  }

  async getBranchBreakdown(
    tx: Tx,
    tenantId: string,
    bounds: PeriodBounds,
    branchIds: string[],
  ): Promise<EntitySummaryRow[]> {
    const list = branchIds.length > 0 ? branchIds : Array.from(this.branches.keys());
    const results: EntitySummaryRow[] = [];
    for (const bId of list) {
      const bName = this.branches.get(bId) ?? bId;
      const totals = await this.computeOperationalMetrics(tx, tenantId, bounds, { branchId: bId });
      results.push({
        dimensionType: 'BRANCH',
        dimensionId: bId,
        dimensionName: bName,
        leadCount: totals.leadCount,
        sanctionCount: totals.sanctionCount,
        disbursementAmount: totals.disbursementAmount,
      });
    }
    return results;
  }

  async getUserBreakdown(
    tx: Tx,
    tenantId: string,
    bounds: PeriodBounds,
    filters: { branchId?: string; userId?: string },
  ): Promise<EntitySummaryRow[]> {
    const results: EntitySummaryRow[] = [];
    for (const [uId, u] of this.users.entries()) {
      if (u.tenantId && u.tenantId !== tenantId) continue;
      if (filters.userId && uId !== filters.userId) continue;
      if (filters.branchId && u.branchId !== filters.branchId) continue;
      const totals = await this.computeOperationalMetrics(tx, tenantId, bounds, { userId: uId });
      const bName = this.branches.get(u.branchId) ?? u.branchId;
      results.push({
        dimensionType: 'USER',
        dimensionId: uId,
        dimensionName: u.name,
        branchName: bName,
        leadCount: totals.leadCount,
        sanctionCount: totals.sanctionCount,
        disbursementAmount: totals.disbursementAmount,
      });
    }
    return results;
  }

  async refreshProjections(_tx: Tx, _tenantId: string, _startDate: string, _endDate: string): Promise<void> {}

  async getControlTotals(_tx: Tx, tenantId: string, summaryDate: string): Promise<ControlTotalsDto> {
    const matchingLeads = this.leads.filter(
      (l) => l.tenantId === tenantId && l.createdAt.startsWith(summaryDate),
    );
    const matchingSancs = this.sanctions.filter(
      (s) => s.tenantId === tenantId && s.sanctionDate === summaryDate,
    );
    const matchingDisbs = this.disbursements.filter(
      (d) => d.tenantId === tenantId && d.disbursedOn === summaryDate,
    );

    const oltpTotals = {
      leads: matchingLeads.length,
      sanctions: matchingSancs.length,
      sanctionAmount: matchingSancs.reduce((a, s) => a + s.amount, 0),
      disbursements: matchingDisbs.length,
      disbursementAmount: matchingDisbs.reduce((a, d) => a + d.amount, 0),
    };

    return {
      summaryDate,
      tenantId,
      oltpTotals,
      projectionTotals: { ...oltpTotals },
      variance: {
        leadsDiff: 0,
        sanctionsDiff: 0,
        sanctionAmountDiff: 0,
        disbursementsDiff: 0,
        disbursementAmountDiff: 0,
      },
      reconciled: true,
      asOf: new Date().toISOString(),
    };
  }

  async createReportRun(_tx: Tx, row: ReportRunRow): Promise<ReportRunRow> {
    this.reportRuns.set(`${row.tenant_id}:${row.id}`, { ...row });
    return row;
  }

  async getReportRun(_tx: Tx, tenantId: string, id: string): Promise<ReportRunRow | null> {
    return this.reportRuns.get(`${tenantId}:${id}`) ?? null;
  }

  async listReportRuns(_tx: Tx, tenantId: string): Promise<ReportRunRow[]> {
    return Array.from(this.reportRuns.values())
      .filter((r) => r.tenant_id === tenantId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async createExportJob(_tx: Tx, row: ExportJobRow): Promise<ExportJobRow> {
    this.exportJobs.set(`${row.tenant_id}:${row.id}`, { ...row });
    return row;
  }

  async getExportJob(_tx: Tx, tenantId: string, id: string): Promise<ExportJobRow | null> {
    return this.exportJobs.get(`${tenantId}:${id}`) ?? null;
  }

  async listExportJobs(_tx: Tx, tenantId: string, requesterId?: string): Promise<ExportJobRow[]> {
    return Array.from(this.exportJobs.values())
      .filter((e) => e.tenant_id === tenantId && (!requesterId || e.requester_id === requesterId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async updateExportJobDownloadedAt(_tx: Tx, tenantId: string, id: string): Promise<void> {
    const job = this.exportJobs.get(`${tenantId}:${id}`);
    if (job) {
      job.downloaded_at = new Date().toISOString();
    }
  }

  async fetchLeadsForExport(
    _tx: Tx,
    _tenantId: string,
    _branchId?: string | null,
  ): Promise<Array<Record<string, unknown>>> {
    return [];
  }

  async fetchCustomersForExport(
    _tx: Tx,
    _tenantId: string,
    _branchId?: string | null,
  ): Promise<Array<Record<string, unknown>>> {
    return [];
  }

  async queryOperationalSummary(
    _tx: Tx,
    _tenantId: string,
    _filters: { branchId?: string | null },
  ): Promise<Array<Record<string, unknown>>> {
    return [];
  }

  async fetchReportData(
    _tx: Tx,
    _tenantId: string,
    reportCode: string,
  ): Promise<{ headers: string[]; records: Array<Record<string, unknown>> }> {
    return {
      headers: ['id', 'report_code', 'generated_at'],
      records: [{ id: 'mock_1', report_code: reportCode, generated_at: new Date().toISOString() }],
    };
  }

  async createReportSchedule(_tx: Tx, row: ReportScheduleRow): Promise<ReportScheduleRow> {
    this.reportSchedules.set(`${row.tenant_id}:${row.id}`, { ...row });
    return row;
  }

  async listReportSchedules(_tx: Tx, tenantId: string): Promise<ReportScheduleRow[]> {
    return Array.from(this.reportSchedules.values())
      .filter((s) => s.tenant_id === tenantId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async deleteReportSchedule(_tx: Tx, tenantId: string, id: string): Promise<boolean> {
    return this.reportSchedules.delete(`${tenantId}:${id}`);
  }
}
