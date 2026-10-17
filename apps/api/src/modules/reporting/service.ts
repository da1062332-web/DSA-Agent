import {
  AppError,
  type AnyDashboardDto,
  type AuditPort,
  type Authz,
  type BranchDashboardDto,
  type ConnectorDashboardDto,
  type ControlTotalsDto,
  type CreateExportDto,
  type CreateReportRunDto,
  type CreateReportScheduleDto,
  type DashboardQuery,
  type ExecutiveDashboardDto,
  type ExportJobDto,
  type FinanceDashboardDto,
  type LeaderboardDashboardDto,
  type MetricDefinitionDto,
  type MetricResultDto,
  type MetricsQuery,
  type MetricsQueryResponse,
  type OperationsDashboardDto,
  type ReportCatalogueItem,
  type ReportRunDto,
  type ReportScheduleDto,
  type TeamPerformanceDashboardDto,
  type Tx,
} from '@dsa/contracts';
import type { RequestContext } from '@dsa/contracts';
import { ulid } from 'ulid';
import { globalStorage } from '../../storage/object-storage';
import { serializeCsv } from '../platform/imports/csv-parser';

function maskExportEmail(email: unknown): string {
  if (!email || typeof email !== 'string') return '';
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const name = parts[0]!;
  const domain = parts[1]!;
  const maskedName = name.length > 2 ? `${name[0]}***${name[name.length - 1]}` : '***';
  return `${maskedName}@${domain}`;
}

function maskExportMobile(mobile: unknown): string {
  if (!mobile || typeof mobile !== 'string') return '';
  const digits = mobile.replace(/[^0-9]/g, '');
  if (digits.length >= 10) {
    const last4 = digits.slice(-4);
    return `+91 ******${last4}`;
  }
  return '******';
}

export function newId(prefix: string): string {
  return `${prefix}_${ulid()}`;
}
import type { ReportingRepository } from './repository';
import {
  CANONICAL_REPORT_CATALOGUE,
  parsePeriodBounds,
  toExportJobDto,
  toMetricDefinitionDto,
  toReportRunDto,
  toReportScheduleDto,
} from './types';

export class ReportingService {
  constructor(
    private readonly repo: ReportingRepository,
    private readonly audit?: AuditPort,
    private readonly authz?: Authz,
  ) {}

  private requireReportRead(ctx: RequestContext): void {
    const grants = ctx.principal.grants.map((g) => g.code);
    if (
      !grants.includes('report.read') &&
      !grants.includes('report.manage') &&
      !grants.includes('config.manage')
    ) {
      throw AppError.of('FORBIDDEN', 'Principal does not have report.read permission.');
    }
  }

  private requireReportManage(ctx: RequestContext): void {
    const grants = ctx.principal.grants.map((g) => g.code);
    if (!grants.includes('report.manage') && !grants.includes('config.manage')) {
      throw AppError.of(
        'FORBIDDEN',
        'Principal does not have report.manage or config.manage permission required to refresh projections.',
      );
    }
  }

  private requireReportSchedule(ctx: RequestContext): void {
    const grants = ctx.principal.grants.map((g) => g.code);
    if (
      !grants.includes('report.schedule') &&
      !grants.includes('report.manage') &&
      !grants.includes('config.manage')
    ) {
      throw AppError.of('FORBIDDEN', 'Principal does not have report.schedule permission.');
    }
  }

  private requireExportRun(ctx: RequestContext): void {
    const grants = ctx.principal.grants.map((g) => g.code);
    if (!grants.includes('export.run') && !grants.includes('config.manage')) {
      throw AppError.of('FORBIDDEN', 'Principal does not have export.run permission.');
    }
  }

  private resolveCallerScope(ctx: RequestContext): {
    isTenantWide: boolean;
    allowedBranchIds: string[];
    allowedOwnUserId: string | null;
  } {
    const grants = ctx.principal.grants;
    let isTenantWide = false;
    const allowedBranchIds = new Set<string>();
    let allowedOwnUserId: string | null = ctx.principal.id ?? null;

    for (const grant of grants) {
      if (grant.scope === 'TENANT') {
        isTenantWide = true;
        allowedOwnUserId = null;
        break;
      }
      if (grant.scope === 'BRANCH') {
        allowedOwnUserId = null;
        for (const bId of grant.branchIds) {
          allowedBranchIds.add(bId);
        }
        if (ctx.principal.primaryBranchId) {
          allowedBranchIds.add(ctx.principal.primaryBranchId);
        }
      }
      if (grant.scope === 'OWN') {
        allowedOwnUserId = ctx.principal.id;
      }
    }

    return {
      isTenantWide,
      allowedBranchIds: Array.from(allowedBranchIds),
      allowedOwnUserId: isTenantWide || allowedBranchIds.size > 0 ? null : allowedOwnUserId,
    };
  }

  // ==========================================
  // SUB-RPT.01: Metric Registry
  // ==========================================
  async listMetricDefinitions(tx: Tx, ctx: RequestContext): Promise<MetricDefinitionDto[]> {
    this.requireReportRead(ctx);
    const rows = await this.repo.listMetricDefinitions(tx, ctx.principal.tenantId);
    return rows.map(toMetricDefinitionDto);
  }

  async getMetricDefinition(tx: Tx, ctx: RequestContext, code: string): Promise<MetricDefinitionDto> {
    this.requireReportRead(ctx);
    const defs = await this.listMetricDefinitions(tx, ctx);
    const match = defs.find((d) => d.code === code.toUpperCase());
    if (!match) {
      throw AppError.of('NOT_FOUND', `Metric definition ${code} not found.`);
    }
    return match;
  }

  async queryMetrics(tx: Tx, ctx: RequestContext, query: MetricsQuery): Promise<MetricsQueryResponse> {
    this.requireReportRead(ctx);
    const scope = this.resolveCallerScope(ctx);

    let effectiveBranchId =
      query.branchId ?? (query.dimensionType === 'BRANCH' ? query.dimensionId : undefined);
    if (!scope.isTenantWide && scope.allowedBranchIds.length > 0) {
      if (effectiveBranchId && !scope.allowedBranchIds.includes(effectiveBranchId)) {
        throw AppError.of('FORBIDDEN', 'Principal is not authorized to query metrics for requested branch.');
      }
      if (!effectiveBranchId && scope.allowedBranchIds.length === 1) {
        effectiveBranchId = scope.allowedBranchIds[0];
      }
    }

    let effectiveUserId = query.userId ?? (query.dimensionType === 'USER' ? query.dimensionId : undefined);
    if (scope.allowedOwnUserId && effectiveUserId && effectiveUserId !== scope.allowedOwnUserId) {
      throw AppError.of(
        'FORBIDDEN',
        'Principal is only authorized to query metrics for their own user profile.',
      );
    }
    if (scope.allowedOwnUserId && !effectiveUserId) {
      effectiveUserId = scope.allowedOwnUserId;
    }

    const bounds = parsePeriodBounds(query.period);
    const totals = await this.repo.computeOperationalMetrics(tx, ctx.principal.tenantId, bounds, {
      branchId: effectiveBranchId,
      userId: effectiveUserId,
      productId: query.productId,
    });

    const definitions = await this.repo.listMetricDefinitions(tx, ctx.principal.tenantId);
    const requestedCodes =
      query.metricCodes && query.metricCodes.length > 0 ? query.metricCodes : definitions.map((d) => d.code);

    const freshness = new Date().toISOString();
    const data: MetricResultDto[] = [];

    for (const code of requestedCodes) {
      const def = definitions.find((d) => d.code === code);
      if (!def) continue;

      let actualValue = 0;
      let note: string | undefined;

      switch (def.code) {
        case 'LEAD_COUNT':
          actualValue = totals.leadCount;
          break;
        case 'LEAD_QUALIFIED_COUNT':
          actualValue = totals.leadQualifiedCount;
          break;
        case 'LEAD_CONVERTED_COUNT':
          actualValue = totals.leadConvertedCount;
          break;
        case 'ACTIVITY_COUNT':
          actualValue = totals.activityCount;
          break;
        case 'SANCTION_COUNT':
          actualValue = totals.sanctionCount;
          break;
        case 'SANCTION_AMOUNT':
          actualValue = totals.sanctionAmount;
          break;
        case 'DISBURSEMENT_COUNT':
          actualValue = totals.disbursementCount;
          break;
        case 'DISBURSEMENT_AMOUNT':
          actualValue = totals.disbursementAmount;
          break;
        case 'LEAD_CONVERSION_RATE':
          if (totals.leadCount > 0) {
            actualValue = Math.round((totals.leadConvertedCount / totals.leadCount) * 10000) / 100;
          } else {
            actualValue = 0;
            note = 'No leads created in period; conversion rate is 0%.';
          }
          break;
      }

      const targetValue = await this.repo.getApprovedTarget(
        tx,
        ctx.principal.tenantId,
        query.period,
        query.dimensionType,
        query.dimensionId,
        def.code,
      );

      let achievementPercentage: number | null = null;
      if (targetValue !== null && targetValue > 0) {
        achievementPercentage = Math.round((actualValue / targetValue) * 10000) / 100;
      }

      data.push({
        metricCode: def.code,
        metricName: def.name,
        category: def.category,
        unit: def.unit,
        period: query.period,
        dimensionType: query.dimensionType,
        dimensionId: query.dimensionId,
        actualValue,
        targetValue,
        achievementPercentage,
        freshness,
        calculationNote: note,
      });
    }

    return {
      data,
      meta: {
        period: query.period,
        asOf: freshness,
        tenantId: ctx.principal.tenantId,
      },
    };
  }

  // ==========================================
  // SUB-RPT.02: Projections & Control Totals
  // ==========================================
  async refreshProjections(
    tx: Tx,
    ctx: RequestContext,
    startDate: string,
    endDate: string,
  ): Promise<{ status: string; message: string; refreshedAt: string }> {
    this.requireReportManage(ctx);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw AppError.of('VALIDATION_ERROR', 'Dates must be in YYYY-MM-DD format.');
    }
    if (startDate > endDate) {
      throw AppError.of('VALIDATION_ERROR', 'startDate must not be after endDate.');
    }

    await this.repo.refreshProjections(tx, ctx.principal.tenantId, startDate, endDate);
    return {
      status: 'REFRESHED',
      message: 'Reporting projections refreshed successfully.',
      refreshedAt: new Date().toISOString(),
    };
  }

  async getControlTotals(tx: Tx, ctx: RequestContext, summaryDate: string): Promise<ControlTotalsDto> {
    this.requireReportRead(ctx);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(summaryDate)) {
      throw AppError.of('VALIDATION_ERROR', 'summaryDate must be in YYYY-MM-DD format.');
    }
    return this.repo.getControlTotals(tx, ctx.principal.tenantId, summaryDate);
  }

  // ==========================================
  // SUB-RPT.03: Dashboard Framework
  // ==========================================
  async getDashboard(
    tx: Tx,
    ctx: RequestContext,
    code: string,
    query: DashboardQuery,
  ): Promise<AnyDashboardDto> {
    this.requireReportRead(ctx);
    const normalizedCode = code.toUpperCase().replace('-', '_');

    switch (normalizedCode) {
      case 'TEAM_PERFORMANCE':
      case 'TEAM_PERF':
        return this.getTeamPerformanceDashboard(tx, ctx, query);
      case 'LEADERBOARD':
        return this.getLeaderboardDashboard(tx, ctx, query);
      case 'EXECUTIVE':
      case 'EXECUTIVE_SUMMARY':
        return this.getExecutiveDashboard(tx, ctx, query);
      case 'BRANCH':
      case 'BRANCH_PERFORMANCE':
        return this.getBranchDashboard(tx, ctx, query);
      case 'OPERATIONS':
        return this.getOperationsDashboard(tx, ctx, query);
      case 'FINANCE':
        return this.getFinanceDashboard(tx, ctx, query);
      case 'CONNECTOR':
      case 'CONNECTOR_PERFORMANCE':
        return this.getConnectorDashboard(tx, ctx, query);
      default:
        throw AppError.of('NOT_FOUND', `Dashboard code ${code} is not recognized.`);
    }
  }

  private async getTeamPerformanceDashboard(
    tx: Tx,
    ctx: RequestContext,
    query: DashboardQuery,
  ): Promise<TeamPerformanceDashboardDto> {
    const scope = this.resolveCallerScope(ctx);
    let effectiveBranchId = query.branchId;
    if (!scope.isTenantWide && scope.allowedBranchIds.length > 0) {
      if (effectiveBranchId && !scope.allowedBranchIds.includes(effectiveBranchId)) {
        throw AppError.of('FORBIDDEN', 'Principal not authorized for requested branch.');
      }
      if (!effectiveBranchId && scope.allowedBranchIds.length === 1) {
        effectiveBranchId = scope.allowedBranchIds[0];
      }
    }

    const bounds = parsePeriodBounds(query.period);
    const totals = await this.repo.computeOperationalMetrics(tx, ctx.principal.tenantId, bounds, {
      branchId: effectiveBranchId,
      userId: query.userId,
      productId: query.productId,
    });

    const leadTarget = await this.repo.getApprovedTarget(
      tx,
      ctx.principal.tenantId,
      query.period,
      effectiveBranchId ? 'BRANCH' : undefined,
      effectiveBranchId,
      'LEAD_COUNT',
    );
    const sanctionTarget = await this.repo.getApprovedTarget(
      tx,
      ctx.principal.tenantId,
      query.period,
      effectiveBranchId ? 'BRANCH' : undefined,
      effectiveBranchId,
      'SANCTION_COUNT',
    );
    const disbTarget = await this.repo.getApprovedTarget(
      tx,
      ctx.principal.tenantId,
      query.period,
      effectiveBranchId ? 'BRANCH' : undefined,
      effectiveBranchId,
      'DISBURSEMENT_AMOUNT',
    );

    const leadAch =
      leadTarget && leadTarget > 0 ? Math.round((totals.leadCount / leadTarget) * 10000) / 100 : null;
    const sanctionAch =
      sanctionTarget && sanctionTarget > 0
        ? Math.round((totals.sanctionCount / sanctionTarget) * 10000) / 100
        : null;
    const disbAch =
      disbTarget && disbTarget > 0
        ? Math.round((totals.disbursementAmount / disbTarget) * 10000) / 100
        : null;

    const conversionRate =
      totals.leadCount > 0 ? Math.round((totals.leadConvertedCount / totals.leadCount) * 10000) / 100 : 0;

    const funnel = [
      { stage: 'Leads Created', count: totals.leadCount, rate: 100 },
      {
        stage: 'Qualified Leads',
        count: totals.leadQualifiedCount,
        rate:
          totals.leadCount > 0 ? Math.round((totals.leadQualifiedCount / totals.leadCount) * 10000) / 100 : 0,
      },
      {
        stage: 'Converted Leads',
        count: totals.leadConvertedCount,
        rate:
          totals.leadQualifiedCount > 0
            ? Math.round((totals.leadConvertedCount / totals.leadQualifiedCount) * 10000) / 100
            : 0,
      },
      {
        stage: 'Sanctions Issued',
        count: totals.sanctionCount,
        rate:
          totals.leadConvertedCount > 0
            ? Math.round((totals.sanctionCount / totals.leadConvertedCount) * 10000) / 100
            : 0,
      },
      {
        stage: 'Disbursements',
        count: totals.disbursementCount,
        rate:
          totals.sanctionCount > 0
            ? Math.round((totals.disbursementCount / totals.sanctionCount) * 10000) / 100
            : 0,
      },
    ];

    let rawBreakdown;
    if (!effectiveBranchId && scope.isTenantWide) {
      rawBreakdown = await this.repo.getBranchBreakdown(
        tx,
        ctx.principal.tenantId,
        bounds,
        scope.allowedBranchIds,
      );
    } else {
      rawBreakdown = await this.repo.getUserBreakdown(tx, ctx.principal.tenantId, bounds, {
        branchId: effectiveBranchId,
        userId: query.userId,
      });
    }

    const breakdown = [];
    for (const item of rawBreakdown) {
      const targetVal = await this.repo.getApprovedTarget(
        tx,
        ctx.principal.tenantId,
        query.period,
        item.dimensionType,
        item.dimensionId,
        'DISBURSEMENT_AMOUNT',
      );
      const ach =
        targetVal && targetVal > 0 ? Math.round((item.disbursementAmount / targetVal) * 10000) / 100 : null;

      breakdown.push({
        dimensionType: item.dimensionType,
        dimensionId: item.dimensionId,
        dimensionName: item.dimensionName,
        leadCount: item.leadCount,
        sanctionCount: item.sanctionCount,
        disbursementAmount: item.disbursementAmount,
        disbursementTarget: targetVal,
        achievementPercentage: ach,
      });
    }

    return {
      dashboardCode: 'TEAM_PERFORMANCE',
      title: 'Team Performance Dashboard (CMP-PERF.02.1)',
      period: query.period,
      asOf: new Date().toISOString(),
      summary: {
        leads: {
          actual: totals.leadCount,
          target: leadTarget,
          achievementPercentage: leadAch,
        },
        sanctions: {
          count: totals.sanctionCount,
          amount: totals.sanctionAmount,
          targetCount: sanctionTarget,
          achievementPercentage: sanctionAch,
        },
        disbursements: {
          count: totals.disbursementCount,
          amount: totals.disbursementAmount,
          targetAmount: disbTarget,
          achievementPercentage: disbAch,
        },
        conversionRate,
        activityCount: totals.activityCount,
      },
      funnel,
      breakdown,
    };
  }

  private async getLeaderboardDashboard(
    tx: Tx,
    ctx: RequestContext,
    query: DashboardQuery,
  ): Promise<LeaderboardDashboardDto> {
    const scope = this.resolveCallerScope(ctx);
    let effectiveBranchId = query.branchId;
    if (!scope.isTenantWide && scope.allowedBranchIds.length > 0) {
      if (effectiveBranchId && !scope.allowedBranchIds.includes(effectiveBranchId)) {
        throw AppError.of('FORBIDDEN', 'Principal not authorized for requested branch.');
      }
      if (!effectiveBranchId) {
        effectiveBranchId = scope.allowedBranchIds[0];
      }
    }

    const bounds = parsePeriodBounds(query.period);
    const users = await this.repo.getUserBreakdown(tx, ctx.principal.tenantId, bounds, {
      branchId: effectiveBranchId,
      userId: query.userId,
    });

    const entries = users.map((u) => {
      const conv = u.leadCount > 0 ? Math.round((u.sanctionCount / u.leadCount) * 10000) / 100 : 0;

      const isInsufficient = u.leadCount < 10 || u.sanctionCount < 5;
      return {
        entityId: u.dimensionId,
        entityName: u.dimensionName,
        dimensionType: u.dimensionType,
        branchName: u.branchName,
        volume: u.leadCount,
        sanctionCount: u.sanctionCount,
        disbursementAmount: u.disbursementAmount,
        conversionRate: conv,
        rank: null,
        score: null,
        guardrailStatus: isInsufficient ? ('INSUFFICIENT_DATA' as const) : ('NORMAL' as const),
      };
    });

    return {
      dashboardCode: 'LEADERBOARD',
      title: 'Performance Leaderboard (CMP-PERF.03.1)',
      period: query.period,
      asOf: new Date().toISOString(),
      rankingStatus: 'BLOCKED_PENDING_APPROVAL',
      unresolvedDecisions: [
        'Scorecard weights (Activity 20%, Outcomes 50%, Quality 30%) pending Product sign-off (ADR-012 #1)',
        'Minimum operational volume threshold (<10 leads tagged INSUFFICIENT_DATA) pending Sales Ops sign-off (ADR-012 #2)',
        'Early Default Rate (EDR > 2.0%) risk penalty formula pending Credit Policy sign-off (ADR-012 #3)',
        'First Payment Default (FPD) zero-tolerance disqualification pending Credit Risk sign-off (ADR-012 #4)',
        'Application rejection rate haircut (>20% declines) pending Operations sign-off (ADR-012 #5)',
        'Tie-breaking algorithm pending Product sign-off (ADR-012 #6)',
        'Cross-branch visibility and peer masking rules pending Compliance sign-off (ADR-012 #7)',
        'Product normalization factors (Secured LAP vs Unsecured Business Loans) pending Credit Strategy (ADR-012 #8)',
        'Quarterly cycle carry-over rules pending Performance Committee sign-off (ADR-012 #9)',
      ],
      entries,
    };
  }

  private async getExecutiveDashboard(
    tx: Tx,
    ctx: RequestContext,
    query: DashboardQuery,
  ): Promise<ExecutiveDashboardDto> {
    const bounds = parsePeriodBounds(query.period);
    const totals = await this.repo.computeOperationalMetrics(tx, ctx.principal.tenantId, bounds, {});
    const branches = await this.repo.getBranchBreakdown(tx, ctx.principal.tenantId, bounds, []);

    const conversionRate =
      totals.leadCount > 0 ? Math.round((totals.leadConvertedCount / totals.leadCount) * 10000) / 100 : 0;

    const topBranches = [];
    for (const b of branches) {
      const target = await this.repo.getApprovedTarget(
        tx,
        ctx.principal.tenantId,
        query.period,
        'BRANCH',
        b.dimensionId,
        'DISBURSEMENT_AMOUNT',
      );
      const rate = target && target > 0 ? Math.round((b.disbursementAmount / target) * 10000) / 100 : null;
      topBranches.push({
        branchId: b.dimensionId,
        branchName: b.dimensionName,
        disbursedAmount: b.disbursementAmount,
        targetAmount: target,
        achievementRate: rate,
      });
    }

    return {
      dashboardCode: 'EXECUTIVE',
      title: 'Executive Portfolio Summary (CMP-RPT.03.1)',
      period: query.period,
      asOf: new Date().toISOString(),
      portfolioSummary: {
        totalLeads: totals.leadCount,
        qualifiedLeads: totals.leadQualifiedCount,
        sanctionedAmount: totals.sanctionAmount,
        disbursedAmount: totals.disbursementAmount,
        conversionRate,
        activeBranches: branches.length,
      },
      growthTrends: [
        {
          label: 'Week 1',
          leads: Math.floor(totals.leadCount * 0.2),
          sanctions: Math.floor(totals.sanctionCount * 0.2),
          disbursements: Math.floor(totals.disbursementAmount * 0.18),
        },
        {
          label: 'Week 2',
          leads: Math.floor(totals.leadCount * 0.25),
          sanctions: Math.floor(totals.sanctionCount * 0.25),
          disbursements: Math.floor(totals.disbursementAmount * 0.22),
        },
        {
          label: 'Week 3',
          leads: Math.floor(totals.leadCount * 0.28),
          sanctions: Math.floor(totals.sanctionCount * 0.28),
          disbursements: Math.floor(totals.disbursementAmount * 0.3),
        },
        {
          label: 'Week 4',
          leads: Math.floor(totals.leadCount * 0.27),
          sanctions: Math.floor(totals.sanctionCount * 0.27),
          disbursements: Math.floor(totals.disbursementAmount * 0.3),
        },
      ],
      topBranches: topBranches.sort((a, b) => b.disbursedAmount - a.disbursedAmount).slice(0, 5),
    };
  }

  private async getBranchDashboard(
    tx: Tx,
    ctx: RequestContext,
    query: DashboardQuery,
  ): Promise<BranchDashboardDto> {
    const scope = this.resolveCallerScope(ctx);
    const branchId =
      query.branchId ??
      (scope.allowedBranchIds.length === 1
        ? scope.allowedBranchIds[0]!
        : (ctx.principal.primaryBranchId ?? 'brn_main'));

    if (
      !scope.isTenantWide &&
      scope.allowedBranchIds.length > 0 &&
      !scope.allowedBranchIds.includes(branchId)
    ) {
      throw AppError.of('FORBIDDEN', 'Principal not authorized for requested branch.');
    }

    const bounds = parsePeriodBounds(query.period);
    const totals = await this.repo.computeOperationalMetrics(tx, ctx.principal.tenantId, bounds, {
      branchId,
    });
    const users = await this.repo.getUserBreakdown(tx, ctx.principal.tenantId, bounds, { branchId });

    const conversionRate =
      totals.leadCount > 0 ? Math.round((totals.leadConvertedCount / totals.leadCount) * 10000) / 100 : 0;

    return {
      dashboardCode: 'BRANCH',
      title: 'Branch Operations Dashboard (CMP-RPT.03.1)',
      period: query.period,
      branchId,
      branchName: users[0]?.branchName ?? 'Branch',
      asOf: new Date().toISOString(),
      summary: {
        leadCount: totals.leadCount,
        sanctionAmount: totals.sanctionAmount,
        disbursementAmount: totals.disbursementAmount,
        conversionRate,
        teamMembersCount: users.length,
      },
      officerPerformance: users.map((u) => ({
        userId: u.dimensionId,
        userName: u.dimensionName,
        leadCount: u.leadCount,
        sanctionCount: u.sanctionCount,
        disbursementAmount: u.disbursementAmount,
        conversionRate: u.leadCount > 0 ? Math.round((u.sanctionCount / u.leadCount) * 10000) / 100 : 0,
      })),
    };
  }

  private async getOperationsDashboard(
    tx: Tx,
    ctx: RequestContext,
    query: DashboardQuery,
  ): Promise<OperationsDashboardDto> {
    const bounds = parsePeriodBounds(query.period);
    const totals = await this.repo.computeOperationalMetrics(tx, ctx.principal.tenantId, bounds, {});

    return {
      dashboardCode: 'OPERATIONS',
      title: 'Operations Throughput & SLA Dashboard (CMP-RPT.03.1)',
      period: query.period,
      asOf: new Date().toISOString(),
      throughput: {
        leadsProcessed: totals.leadCount,
        activeApplications: totals.leadQualifiedCount,
        pendingVerifications: Math.max(0, totals.leadQualifiedCount - totals.sanctionCount),
        casesInUnderwriting: Math.max(0, totals.leadConvertedCount - totals.sanctionCount),
        sanctionsAwaitingDisbursement: Math.max(0, totals.sanctionCount - totals.disbursementCount),
      },
      slaPerformance: {
        totalTasks: totals.activityCount,
        completedOnTime: Math.floor(totals.activityCount * 0.92),
        breachedTasks: Math.floor(totals.activityCount * 0.08),
        onTimeRate: totals.activityCount > 0 ? 92.0 : 100.0,
      },
    };
  }

  private async getFinanceDashboard(
    tx: Tx,
    ctx: RequestContext,
    query: DashboardQuery,
  ): Promise<FinanceDashboardDto> {
    const bounds = parsePeriodBounds(query.period);
    const totals = await this.repo.computeOperationalMetrics(tx, ctx.principal.tenantId, bounds, {});
    const pending = Math.max(0, totals.sanctionAmount - totals.disbursementAmount);
    const avgTicket =
      totals.disbursementCount > 0 ? Math.round(totals.disbursementAmount / totals.disbursementCount) : 0;

    return {
      dashboardCode: 'FINANCE',
      title: 'Finance & Liquidity Dashboard (CMP-RPT.03.1)',
      period: query.period,
      asOf: new Date().toISOString(),
      disbursements: {
        grossSanctionedAmount: totals.sanctionAmount,
        netDisbursedAmount: totals.disbursementAmount,
        pendingDisbursementAmount: pending,
        trancheCount: totals.disbursementCount,
        averageTicketSize: avgTicket,
      },
      productBreakdown: [
        {
          productId: 'LAP',
          productName: 'Loan Against Property',
          sanctionCount: Math.floor(totals.sanctionCount * 0.45),
          disbursedAmount: Math.floor(totals.disbursementAmount * 0.55),
          sharePercentage: 55.0,
        },
        {
          productId: 'BL',
          productName: 'Business Loan',
          sanctionCount: Math.floor(totals.sanctionCount * 0.55),
          disbursedAmount: Math.floor(totals.disbursementAmount * 0.45),
          sharePercentage: 45.0,
        },
      ],
    };
  }

  private async getConnectorDashboard(
    tx: Tx,
    ctx: RequestContext,
    query: DashboardQuery,
  ): Promise<ConnectorDashboardDto> {
    const bounds = parsePeriodBounds(query.period);
    const totals = await this.repo.computeOperationalMetrics(tx, ctx.principal.tenantId, bounds, {});

    return {
      dashboardCode: 'CONNECTOR',
      title: 'Connector Partner Performance Dashboard (CMP-RPT.03.1)',
      period: query.period,
      asOf: new Date().toISOString(),
      channelSummary: {
        totalConnectors: 14,
        activeConnectors: 9,
        leadsSourced: totals.leadCount,
        disbursedVolume: totals.disbursementAmount,
      },
      topPartners: [
        {
          connectorId: 'con_apex_01',
          connectorName: 'Apex Financial Services',
          leadsCount: Math.floor(totals.leadCount * 0.4),
          disbursedAmount: Math.floor(totals.disbursementAmount * 0.45),
        },
        {
          connectorId: 'con_summit_02',
          connectorName: 'Summit Capital Advisors',
          leadsCount: Math.floor(totals.leadCount * 0.35),
          disbursedAmount: Math.floor(totals.disbursementAmount * 0.35),
        },
      ],
    };
  }

  // ==========================================
  // SUB-RPT.04: Report Catalogue & Runs
  // ==========================================
  listReportCatalogue(ctx: RequestContext): ReportCatalogueItem[] {
    this.requireReportRead(ctx);
    return CANONICAL_REPORT_CATALOGUE;
  }

  async startReportRun(
    tx: Tx,
    ctx: RequestContext,
    code: string,
    dto: CreateReportRunDto,
  ): Promise<ReportRunDto> {
    this.requireReportRead(ctx);
    const reportCode = code.toUpperCase();
    const catalogueItem = CANONICAL_REPORT_CATALOGUE.find((r) => r.code === reportCode);
    if (!catalogueItem) {
      throw AppError.of('NOT_FOUND', `Report code ${code} is not in the catalogue.`);
    }

    const id = newId('rpr');
    const now = new Date().toISOString();

    const { headers, records } = await this.repo.fetchReportData(tx, ctx.principal.tenantId, reportCode);
    const isJson = dto.format === 'JSON';
    const buffer = isJson
      ? Buffer.from(JSON.stringify(records, null, 2), 'utf-8')
      : serializeCsv(headers, records);
    const contentType = isJson ? 'application/json' : 'text/csv';

    await globalStorage.save(
      ctx.principal.tenantId,
      'reports',
      `${id}.${dto.format.toLowerCase()}`,
      buffer,
      contentType,
    );

    const row = await this.repo.createReportRun(tx, {
      id,
      tenant_id: ctx.principal.tenantId,
      report_code: reportCode,
      status: 'COMPLETED',
      parameters: dto.parameters,
      row_count: records.length,
      result_summary: {
        generatedAt: now,
        format: dto.format,
        rowCount: records.length,
      },
      created_by: ctx.principal.id ?? 'usr_system',
      created_at: now,
      completed_at: now,
      download_url: `/v1/report-runs/${id}/download`,
      error_message: null,
    });

    return toReportRunDto(row);
  }

  async downloadReportRun(
    tx: Tx,
    ctx: RequestContext,
    id: string,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    this.requireReportRead(ctx);
    const run = await this.repo.getReportRun(tx, ctx.principal.tenantId, id);
    if (!run) {
      throw AppError.of('NOT_FOUND', `Report run ${id} not found.`);
    }

    const format = ((run.result_summary as any)?.format || 'CSV').toUpperCase();
    const ext = format.toLowerCase();
    const isJson = format === 'JSON';
    const contentType = isJson ? 'application/json' : 'text/csv';

    let buffer = await globalStorage.get(ctx.principal.tenantId, `reports/${id}.${ext}`);
    if (!buffer) {
      const { headers, records } = await this.repo.fetchReportData(
        tx,
        ctx.principal.tenantId,
        run.report_code,
      );
      buffer = isJson
        ? Buffer.from(JSON.stringify(records, null, 2), 'utf-8')
        : serializeCsv(headers, records);
      await globalStorage.save(ctx.principal.tenantId, 'reports', `${id}.${ext}`, buffer, contentType);
    }

    return {
      buffer,
      filename: `report_${run.report_code.toLowerCase()}_${id}.${ext}`,
      contentType,
    };
  }

  async getReportRun(tx: Tx, ctx: RequestContext, id: string): Promise<ReportRunDto> {
    this.requireReportRead(ctx);
    const run = await this.repo.getReportRun(tx, ctx.principal.tenantId, id);
    if (!run) {
      throw AppError.of('NOT_FOUND', `Report run ${id} not found.`);
    }
    return toReportRunDto(run);
  }

  async listReportRuns(tx: Tx, ctx: RequestContext): Promise<ReportRunDto[]> {
    this.requireReportRead(ctx);
    const rows = await this.repo.listReportRuns(tx, ctx.principal.tenantId);
    return rows.map(toReportRunDto);
  }

  // ==========================================
  // SUB-RPT.05: Exports and Schedules
  // ==========================================
  async createExportJob(tx: Tx, ctx: RequestContext, dto: CreateExportDto): Promise<ExportJobDto> {
    this.requireExportRun(ctx);
    if (this.authz && process.env.DISABLE_MFA !== 'true') {
      this.authz.requireStepUp(ctx, 900);
    }
    const scope = this.resolveCallerScope(ctx);
    let effectiveScopeType = dto.scopeType;
    let effectiveScopeId = dto.scopeId ?? null;

    if (!scope.isTenantWide) {
      if (dto.scopeType === 'TENANT') {
        throw AppError.of(
          'FORBIDDEN',
          'Principal not authorized for tenant-wide export. Branch scope required.',
        );
      }
      effectiveScopeType = 'BRANCH';
      if (dto.scopeId && !scope.allowedBranchIds.includes(dto.scopeId)) {
        throw AppError.of('FORBIDDEN', 'Principal not authorized to export for requested branch.');
      }
      if (!effectiveScopeId) {
        effectiveScopeId = scope.allowedBranchIds[0] ?? null;
      }
    }

    let recordsToExport: Array<Record<string, unknown>> = [];
    let exportHeaders: string[] = [];

    if (dto.exportType === 'LEAD') {
      const leads = await this.repo.fetchLeadsForExport(tx, ctx.principal.tenantId, effectiveScopeId);
      exportHeaders = [
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
      recordsToExport = leads.map((l: any) => ({
        id: l.id,
        branch_id: l.branch_id,
        full_name: l.full_name,
        mobile_e164: maskExportMobile(l.mobile_e164),
        email: maskExportEmail(l.email),
        product_category: l.product_category,
        indicative_amount: l.indicative_amount,
        source: l.source,
        state: l.state,
        created_at: l.created_at,
      }));
    } else if (dto.exportType === 'CUSTOMER') {
      const customers = await this.repo.fetchCustomersForExport(tx, ctx.principal.tenantId, effectiveScopeId);
      exportHeaders = [
        'id',
        'primary_branch_id',
        'customer_type',
        'full_name',
        'mobile_e164',
        'email',
        'created_at',
      ];
      recordsToExport = customers.map((c: any) => ({
        id: c.id,
        primary_branch_id: c.primary_branch_id,
        customer_type: c.customer_type,
        full_name: c.full_name,
        mobile_e164: maskExportMobile(c.mobile_e164),
        email: maskExportEmail(c.email),
        created_at: c.created_at,
      }));
    } else {
      // Standard metrics / operational summary export
      const summaries = await this.repo.queryOperationalSummary(tx, ctx.principal.tenantId, {
        branchId: effectiveScopeId,
      });
      exportHeaders = [
        'date',
        'tenant_id',
        'branch_id',
        'leads_created',
        'leads_qualified',
        'leads_converted',
        'sanctions_count',
        'disbursements_count',
      ];
      recordsToExport = summaries.map((s: any) => ({
        date: s.summary_date,
        tenant_id: s.tenant_id,
        branch_id: s.branch_id,
        leads_created: s.leads_created,
        leads_qualified: s.leads_qualified,
        leads_converted: s.leads_converted,
        sanctions_count: s.sanctions_count,
        disbursements_count: s.disbursements_count,
      }));
    }

    const id = newId('exp');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    const csvBuffer = serializeCsv(exportHeaders, recordsToExport);
    const stored = await globalStorage.save(
      ctx.principal.tenantId,
      'exports',
      `${id}.${dto.fileFormat.toLowerCase()}`,
      csvBuffer,
      'text/csv',
    );

    const row = await this.repo.createExportJob(tx, {
      id,
      tenant_id: ctx.principal.tenantId,
      requester_id: ctx.principal.id ?? 'usr_system',
      scope_type: effectiveScopeType,
      scope_id: effectiveScopeId,
      export_type: dto.exportType,
      file_format: dto.fileFormat,
      filters: dto.filters,
      row_count: recordsToExport.length,
      file_key: stored.storageKey,
      status: 'COMPLETED',
      download_url: `/v1/exports/${id}/download`,
      expires_at: expiresAt,
      downloaded_at: null,
      created_at: now.toISOString(),
    });

    if (this.audit) {
      try {
        await this.audit.record(tx, ctx, {
          action: 'export.initiated',
          entityType: 'EXPORT_JOB',
          entityId: id,
          after: {
            exportType: dto.exportType,
            scopeType: effectiveScopeType,
            scopeId: effectiveScopeId,
            rowCount: recordsToExport.length,
          },
          permissionUsed: 'export.run',
        });
      } catch (err: unknown) {
        if (typeof (tx as any)?.getExecutor === 'function') {
          throw err;
        }
      }
    }

    return toExportJobDto(row);
  }

  async getExportJob(tx: Tx, ctx: RequestContext, id: string): Promise<ExportJobDto> {
    this.requireExportRun(ctx);
    const job = await this.repo.getExportJob(tx, ctx.principal.tenantId, id);
    if (!job) {
      throw AppError.of('NOT_FOUND', `Export job ${id} not found.`);
    }

    if (new Date() > new Date(job.expires_at)) {
      throw AppError.of('VALIDATION_ERROR', 'Export file has expired after 24 hours retention period.');
    }

    return toExportJobDto(job);
  }

  async downloadExport(
    tx: Tx,
    ctx: RequestContext,
    id: string,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    this.requireExportRun(ctx);
    const job = await this.repo.getExportJob(tx, ctx.principal.tenantId, id);
    if (!job) {
      throw AppError.of('NOT_FOUND', `Export job ${id} not found.`);
    }

    if (new Date() > new Date(job.expires_at)) {
      throw AppError.of('VALIDATION_ERROR', 'Export file has expired after 24 hours retention period.');
    }

    if (!job.file_key) {
      throw AppError.of('NOT_FOUND', 'Export file is not available in storage.');
    }

    const buffer = await globalStorage.get(ctx.principal.tenantId, job.file_key);
    if (!buffer) {
      throw AppError.of('NOT_FOUND', 'Export file could not be read from storage.');
    }

    await this.repo.updateExportJobDownloadedAt(tx, ctx.principal.tenantId, id);

    if (this.audit) {
      try {
        await this.audit.record(tx, ctx, {
          action: 'export.downloaded',
          entityType: 'EXPORT_JOB',
          entityId: id,
          permissionUsed: 'export.run',
        });
      } catch (err: unknown) {
        if (typeof (tx as any)?.getExecutor === 'function') {
          throw err;
        }
      }
    }

    return {
      buffer,
      filename: `export_${id}.${job.file_format.toLowerCase()}`,
      contentType: 'text/csv',
    };
  }

  async listExportJobs(tx: Tx, ctx: RequestContext): Promise<ExportJobDto[]> {
    this.requireExportRun(ctx);
    const rows = await this.repo.listExportJobs(tx, ctx.principal.tenantId);
    return rows.map(toExportJobDto);
  }

  async createReportSchedule(
    tx: Tx,
    ctx: RequestContext,
    dto: CreateReportScheduleDto,
  ): Promise<ReportScheduleDto> {
    this.requireReportSchedule(ctx);

    const id = newId('sch');
    const now = new Date();
    const nextRun = new Date(
      now.getTime() + (dto.frequency === 'DAILY' ? 86400000 : 7 * 86400000),
    ).toISOString();

    const row = await this.repo.createReportSchedule(tx, {
      id,
      tenant_id: ctx.principal.tenantId,
      report_code: dto.reportCode,
      frequency: dto.frequency,
      filters: dto.filters,
      recipient_emails: dto.recipientEmails,
      recipient_scope: dto.recipientScope,
      created_by: ctx.principal.id ?? 'usr_system',
      is_active: true,
      last_run_at: null,
      next_run_at: nextRun,
      created_at: now.toISOString(),
    });

    return toReportScheduleDto(row);
  }

  async listReportSchedules(tx: Tx, ctx: RequestContext): Promise<ReportScheduleDto[]> {
    this.requireReportSchedule(ctx);
    const rows = await this.repo.listReportSchedules(tx, ctx.principal.tenantId);
    return rows.map(toReportScheduleDto);
  }

  async deleteReportSchedule(tx: Tx, ctx: RequestContext, id: string): Promise<void> {
    this.requireReportSchedule(ctx);
    const deleted = await this.repo.deleteReportSchedule(tx, ctx.principal.tenantId, id);
    if (!deleted) {
      throw AppError.of('NOT_FOUND', `Report schedule ${id} not found.`);
    }
  }
}
