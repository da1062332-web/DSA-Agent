// apps/api/test/reporting.spec.ts — MOD-RPT Reporting & Performance Engine Test Suite
import type { RequestContext, Tx, TxRunner } from '@dsa/contracts';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryReportingRepository } from '../src/modules/reporting/repository';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const inMemoryTxRunner: TxRunner = {
  async withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tx = {} as any;
    tx.tenantId = ctx.principal.tenantId;
    return fn(tx as Tx);
  },
};

describe('Module MOD-RPT — Reporting Engine and Performance Analytics', () => {
  let repo: InMemoryReportingRepository;

  const tenantA = 'ten_tenant_a';
  const tenantB = 'ten_tenant_b';

  // Test Principals
  const reportingUser = testPrincipal({
    tenantId: tenantA,
    id: 'usr_reporter',
    primaryBranchId: 'brn_main',
    grants: [{ code: 'report.read', scope: 'TENANT', branchIds: [] }],
  });

  const reportAdmin = testPrincipal({
    tenantId: tenantA,
    id: 'usr_admin',
    primaryBranchId: 'brn_main',
    grants: [
      { code: 'report.read', scope: 'TENANT', branchIds: [] },
      { code: 'report.manage', scope: 'TENANT', branchIds: [] },
    ],
  });

  const branchManager = testPrincipal({
    tenantId: tenantA,
    id: 'usr_bm',
    primaryBranchId: 'brn_main',
    grants: [{ code: 'report.read', scope: 'BRANCH', branchIds: ['brn_main'] }],
  });

  const unprivilegedUser = testPrincipal({
    tenantId: tenantA,
    id: 'usr_unprivileged',
    primaryBranchId: 'brn_main',
    grants: [], // No report.read
  });

  const otherTenantUser = testPrincipal({
    tenantId: tenantB,
    id: 'usr_tenant_b',
    primaryBranchId: 'brn_b1',
    grants: [{ code: 'report.read', scope: 'TENANT', branchIds: [] }],
  });

  const exportUser = testPrincipal({
    tenantId: tenantA,
    id: 'usr_exporter',
    primaryBranchId: 'brn_main',
    authTime: new Date().toISOString(),
    grants: [
      { code: 'report.read', scope: 'TENANT', branchIds: [] },
      { code: 'export.run', scope: 'TENANT', branchIds: [] },
    ],
  });

  const schedulerUser = testPrincipal({
    tenantId: tenantA,
    id: 'usr_scheduler',
    primaryBranchId: 'brn_main',
    grants: [
      { code: 'report.read', scope: 'TENANT', branchIds: [] },
      { code: 'report.schedule', scope: 'TENANT', branchIds: [] },
    ],
  });

  const otherTenantExportUser = testPrincipal({
    tenantId: tenantB,
    id: 'usr_tenant_b_exporter',
    primaryBranchId: 'brn_b1',
    authTime: new Date().toISOString(),
    grants: [
      { code: 'report.read', scope: 'TENANT', branchIds: [] },
      { code: 'report.manage', scope: 'TENANT', branchIds: [] },
      { code: 'report.schedule', scope: 'TENANT', branchIds: [] },
      { code: 'export.run', scope: 'TENANT', branchIds: [] },
    ],
  });

  function getApp(principal = reportingUser) {
    return createTestApp({
      auth: fakeAuth(principal),
      deps: {
        txRunner: inMemoryTxRunner,
        reportingRepository: repo,
      },
    });
  }

  beforeEach(() => {
    repo = new InMemoryReportingRepository();

    // Seed Operational Records for tenantA in period 2026-10
    // Leads
    repo.leads.push(
      {
        tenantId: tenantA,
        id: 'led_1',
        branchId: 'brn_main',
        userId: 'usr_agent1',
        state: 'CONVERTED',
        createdAt: '2026-10-05T10:00:00.000Z',
      },
      {
        tenantId: tenantA,
        id: 'led_2',
        branchId: 'brn_main',
        userId: 'usr_agent1',
        state: 'QUALIFIED',
        createdAt: '2026-10-10T11:00:00.000Z',
      },
      {
        tenantId: tenantA,
        id: 'led_3',
        branchId: 'brn_north',
        userId: 'usr_agent2',
        state: 'NEW',
        createdAt: '2026-10-15T12:00:00.000Z',
      },
      // Tenant B lead
      {
        tenantId: tenantB,
        id: 'led_b1',
        branchId: 'brn_b1',
        userId: 'usr_b1',
        state: 'CONVERTED',
        createdAt: '2026-10-06T10:00:00.000Z',
      },
    );

    // Activities
    repo.activities.push(
      {
        tenantId: tenantA,
        id: 'act_1',
        branchId: 'brn_main',
        actorId: 'usr_agent1',
        occurredAt: '2026-10-05T10:30:00.000Z',
      },
      {
        tenantId: tenantA,
        id: 'act_2',
        branchId: 'brn_main',
        actorId: 'usr_agent1',
        occurredAt: '2026-10-08T14:30:00.000Z',
      },
    );

    // Sanctions
    repo.sanctions.push({
      tenantId: tenantA,
      id: 'snc_1',
      branchId: 'brn_main',
      userId: 'usr_agent1',
      amount: 2500000,
      sanctionDate: '2026-10-12',
      status: 'ACTIVE',
    });

    // Disbursements
    repo.disbursements.push({
      tenantId: tenantA,
      id: 'dsb_1',
      branchId: 'brn_main',
      userId: 'usr_agent1',
      amount: 2000000,
      disbursedOn: '2026-10-18',
      status: 'VERIFIED',
    });

    // Seed approved targets in tenantA for 2026-10
    // Overall branch targets
    repo.targets.set(`${tenantA}:2026-10:ALL:ALL:LEAD_COUNT`, 10);
    repo.targets.set(`${tenantA}:2026-10:ALL:ALL:DISBURSEMENT_AMOUNT`, 5000000);
    // Specific branch target
    repo.targets.set(`${tenantA}:2026-10:BRANCH:brn_main:DISBURSEMENT_AMOUNT`, 2500000);
  });

  describe('API-RPT-001: GET /v1/metrics', () => {
    it('TC-RPT-001 rejects request when caller lacks report.read permission with 403 FORBIDDEN', async () => {
      const app = getApp(unprivilegedUser);

      const res = await request(app).get('/v1/metrics?period=2026-10');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('TC-RPT-002 rejects invalid period format with 422 VALIDATION_ERROR', async () => {
      const app = getApp(reportingUser);

      const res = await request(app).get('/v1/metrics?period=2026-13'); // invalid month
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('TC-RPT-003 computes operational actuals and matches approved targets with achievement %', async () => {
      const app = getApp(reportingUser);

      const res = await request(app).get(
        '/v1/metrics?period=2026-10&metricCodes=LEAD_COUNT,DISBURSEMENT_AMOUNT,LEAD_CONVERSION_RATE',
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.meta.period).toBe('2026-10');

      const leadCount = res.body.data.find((m: any) => m.metricCode === 'LEAD_COUNT');
      expect(leadCount).toBeDefined();
      expect(leadCount.actualValue).toBe(3); // 3 leads in tenant A
      expect(leadCount.targetValue).toBe(10);
      expect(leadCount.achievementPercentage).toBe(30); // 3/10 * 100

      const disbAmount = res.body.data.find((m: any) => m.metricCode === 'DISBURSEMENT_AMOUNT');
      expect(disbAmount).toBeDefined();
      expect(disbAmount.actualValue).toBe(2000000);
      expect(disbAmount.targetValue).toBe(5000000);
      expect(disbAmount.achievementPercentage).toBe(40); // 2M/5M * 100

      const convRate = res.body.data.find((m: any) => m.metricCode === 'LEAD_CONVERSION_RATE');
      expect(convRate).toBeDefined();
      expect(convRate.actualValue).toBe(33.33); // 1 converted / 3 total * 100
      expect(convRate.unit).toBe('PERCENTAGE');
    });

    it('TC-RPT-004 enforces tenant isolation: Tenant B sees only Tenant B metrics', async () => {
      const app = getApp(otherTenantUser);

      const res = await request(app).get(
        '/v1/metrics?period=2026-10&metricCodes=LEAD_COUNT,DISBURSEMENT_AMOUNT',
      );

      expect(res.status).toBe(200);
      const leadCount = res.body.data.find((m: any) => m.metricCode === 'LEAD_COUNT');
      expect(leadCount.actualValue).toBe(1); // Only 1 lead in Tenant B
      expect(leadCount.targetValue).toBeNull(); // No target in Tenant B
    });

    it('TC-RPT-005 enforces branch scoping on branch manager query', async () => {
      const app = getApp(branchManager);

      // Querying own allowed branch works
      const resAllowed = await request(app).get('/v1/metrics?period=2026-10&branchId=brn_main');
      expect(resAllowed.status).toBe(200);

      // Querying branch outside manager scope is rejected
      const resForbidden = await request(app).get('/v1/metrics?period=2026-10&branchId=brn_north');
      expect(resForbidden.status).toBe(403);
    });
  });

  describe('ENT-094: GET /v1/metrics/definitions', () => {
    it('TC-RPT-006 returns catalog of canonical metric definitions', async () => {
      const app = getApp(reportingUser);

      const res = await request(app).get('/v1/metrics/definitions');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(8);

      const codes = res.body.data.map((d: any) => d.code);
      expect(codes).toContain('LEAD_COUNT');
      expect(codes).toContain('SANCTION_COUNT');
      expect(codes).toContain('DISBURSEMENT_AMOUNT');
      expect(codes).toContain('LEAD_CONVERSION_RATE');
    });
  });

  describe('API-RPT-002: GET /v1/dashboards/:code', () => {
    it('TC-RPT-007 renders TEAM_PERFORMANCE dashboard (CMP-PERF.02.1) with summary, funnel and breakdown', async () => {
      const app = getApp(reportingUser);

      const res = await request(app).get('/v1/dashboards/TEAM_PERFORMANCE?period=2026-10');
      expect(res.status).toBe(200);
      expect(res.body.dashboardCode).toBe('TEAM_PERFORMANCE');
      expect(res.body.summary).toBeDefined();
      expect(res.body.summary.leads.actual).toBe(3);
      expect(res.body.summary.disbursements.amount).toBe(2000000);
      expect(res.body.funnel).toBeInstanceOf(Array);
      expect(res.body.funnel.length).toBe(5);
      expect(res.body.breakdown).toBeInstanceOf(Array);
    });

    it('TC-RPT-008 returns 404 for unknown dashboard code', async () => {
      const app = getApp(reportingUser);

      const res = await request(app).get('/v1/dashboards/UNKNOWN_DASHBOARD?period=2026-10');
      expect(res.status).toBe(404);
    });

    it('TC-RPT-009 returns LEADERBOARD dashboard with BLOCKED_PENDING_APPROVAL and 9 unresolved decisions', async () => {
      const app = getApp(reportingUser);

      const res = await request(app).get('/v1/dashboards/LEADERBOARD?period=2026-10');
      expect(res.status).toBe(200);
      expect(res.body.dashboardCode).toBe('LEADERBOARD');
      expect(res.body.rankingStatus).toBe('BLOCKED_PENDING_APPROVAL');
      expect(res.body.unresolvedDecisions).toBeInstanceOf(Array);
      expect(res.body.unresolvedDecisions.length).toBe(9);
      // Entries are present with raw operational metrics, but ranks and scores remain null
      expect(res.body.entries).toBeInstanceOf(Array);
      for (const entry of res.body.entries) {
        expect(entry.rank).toBeNull();
        expect(entry.score).toBeNull();
        expect(entry.volume).toBeGreaterThanOrEqual(0);
        // Minimum volume guardrail check (< 10 leads or < 5 sanctions)
        if (entry.volume < 10 || entry.sanctionCount < 5) {
          expect(entry.guardrailStatus).toBe('INSUFFICIENT_DATA');
        }
      }
    });

    it('TC-RPT-010 rejects branch manager requesting outside branch on TEAM_PERFORMANCE with 403', async () => {
      const app = getApp(branchManager);

      const res = await request(app).get(
        '/v1/dashboards/TEAM_PERFORMANCE?period=2026-10&branchId=brn_unauthorized',
      );
      expect(res.status).toBe(403);
    });

    it('TC-RPT-011 rejects branch manager requesting outside branch on LEADERBOARD with 403', async () => {
      const app = getApp(branchManager);

      const res = await request(app).get(
        '/v1/dashboards/LEADERBOARD?period=2026-10&branchId=brn_unauthorized',
      );
      expect(res.status).toBe(403);
    });

    it('TC-RPT-012 scopes LEADERBOARD to allowed branch when branch manager does not specify branchId', async () => {
      const app = getApp(branchManager);

      const res = await request(app).get('/v1/dashboards/LEADERBOARD?period=2026-10');
      expect(res.status).toBe(200);
      expect(res.body.entries).toBeInstanceOf(Array);
      for (const entry of res.body.entries) {
        expect(entry.branchName).toBe('Main Branch');
      }
    });

    it('TC-RPT-013 isolates LEADERBOARD queries across tenants', async () => {
      const app = getApp(otherTenantUser);

      const res = await request(app).get('/v1/dashboards/LEADERBOARD?period=2026-10');
      expect(res.status).toBe(200);
      // Tenant B has zero operational records in Tenant A
      expect(res.body.entries.length).toBe(0);
    });
  });

  describe('POST /v1/reporting/refresh', () => {
    it('TC-RPT-014 rejects refresh when caller has only report.read permission with 403 FORBIDDEN', async () => {
      const app = getApp(reportingUser);

      const res = await request(app)
        .post('/v1/reporting/refresh')
        .send({ startDate: '2026-10-01', endDate: '2026-10-31' });

      expect(res.status).toBe(403);
      expect(res.body.error?.message).toContain('report.manage or config.manage');
    });

    it('TC-RPT-015 allows refresh when caller has report.manage permission', async () => {
      const app = getApp(reportAdmin);

      const res = await request(app)
        .post('/v1/reporting/refresh')
        .send({ startDate: '2026-10-01', endDate: '2026-10-31' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('refreshed successfully');
    });

    it('TC-RPT-016 rejects refresh with 422 VALIDATION_ERROR on invalid date formats', async () => {
      const app = getApp(reportAdmin);

      const res = await request(app)
        .post('/v1/reporting/refresh')
        .send({ startDate: 'invalid-date', endDate: '2026-10-31' });

      expect(res.status).toBe(422);
    });
  });

  describe('FR-RPT-008: GET /v1/reporting/control-totals', () => {
    it('TC-RPT-017 returns reconciled OLTP vs projection daily operational totals', async () => {
      const app = getApp(reportingUser);

      const res = await request(app).get('/v1/reporting/control-totals?summaryDate=2026-10-12');
      expect(res.status).toBe(200);
      expect(res.body.summaryDate).toBe('2026-10-12');
      expect(res.body.oltpTotals).toBeDefined();
      expect(res.body.projectionTotals).toBeDefined();
      expect(res.body.variance).toBeDefined();
      expect(res.body.reconciled).toBe(true);
      expect(res.body.oltpTotals.sanctions).toBe(1);
      expect(res.body.oltpTotals.sanctionAmount).toBe(2500000);
    });

    it('TC-RPT-018 rejects control-totals query when caller lacks report.read with 403 FORBIDDEN', async () => {
      const app = getApp(unprivilegedUser);

      const res = await request(app).get('/v1/reporting/control-totals?summaryDate=2026-10-12');
      expect(res.status).toBe(403);
    });
  });

  describe('SUB-RPT.03: Multi-Category Dashboards', () => {
    it('TC-RPT-019 renders EXECUTIVE dashboard with KPIs and monthly totals', async () => {
      const app = getApp(reportingUser);

      const res = await request(app).get('/v1/dashboards/EXECUTIVE?period=2026-10');
      expect(res.status).toBe(200);
      expect(res.body.dashboardCode).toBe('EXECUTIVE');
      expect(res.body.portfolioSummary).toBeDefined();
      expect(res.body.portfolioSummary.totalLeads).toBe(3);
      expect(res.body.growthTrends).toBeInstanceOf(Array);
      expect(res.body.topBranches).toBeInstanceOf(Array);
    });

    it('TC-RPT-020 renders BRANCH dashboard with branch-level metrics', async () => {
      const app = getApp(reportingUser);

      const res = await request(app).get('/v1/dashboards/BRANCH?period=2026-10&branchId=brn_main');
      expect(res.status).toBe(200);
      expect(res.body.dashboardCode).toBe('BRANCH');
      expect(res.body.branchId).toBe('brn_main');
      expect(res.body.summary).toBeDefined();
      expect(res.body.summary.leadCount).toBe(2);
      expect(res.body.officerPerformance).toBeInstanceOf(Array);
    });

    it('TC-RPT-021 renders OPERATIONS dashboard with pipeline and activity metrics', async () => {
      const app = getApp(reportingUser);

      const res = await request(app).get('/v1/dashboards/OPERATIONS?period=2026-10');
      expect(res.status).toBe(200);
      expect(res.body.dashboardCode).toBe('OPERATIONS');
      expect(res.body.throughput).toBeDefined();
      expect(res.body.throughput.leadsProcessed).toBe(3);
      expect(res.body.slaPerformance).toBeDefined();
    });

    it('TC-RPT-022 renders FINANCE dashboard with sanction and disbursement metrics', async () => {
      const app = getApp(reportingUser);

      const res = await request(app).get('/v1/dashboards/FINANCE?period=2026-10');
      expect(res.status).toBe(200);
      expect(res.body.dashboardCode).toBe('FINANCE');
      expect(res.body.disbursements).toBeDefined();
      expect(res.body.disbursements.netDisbursedAmount).toBe(2000000);
      expect(res.body.productBreakdown).toBeInstanceOf(Array);
    });

    it('TC-RPT-023 renders CONNECTOR dashboard without runtime MOD-CPT connector dependency', async () => {
      const app = getApp(reportingUser);

      const res = await request(app).get('/v1/dashboards/CONNECTOR?period=2026-10');
      expect(res.status).toBe(200);
      expect(res.body.dashboardCode).toBe('CONNECTOR');
      expect(res.body.channelSummary).toBeDefined();
      expect(res.body.channelSummary.leadsSourced).toBe(3);
      expect(res.body.topPartners).toBeInstanceOf(Array);
    });
  });

  describe('SUB-RPT.04: Report Catalogue & Runner', () => {
    it('TC-RPT-024 lists canonical standard reports in catalogue', async () => {
      const app = getApp(reportingUser);

      const res = await request(app).get('/v1/reports');
      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThanOrEqual(6);

      const codes = res.body.data.map((r: any) => r.code);
      expect(codes).toContain('RPT_LEAD_PIPELINE');
      expect(codes).toContain('RPT_DISBURSEMENT_REGISTER');
      expect(codes).toContain('RPT_SANCTION_LEDGER');
      expect(codes).toContain('RPT_BRANCH_SUMMARY');
      expect(codes).toContain('RPT_ACTIVITY_AUDIT');
      expect(codes).toContain('RPT_TARGET_ACHIEVEMENT');
    });

    it('TC-RPT-025 executes a report run asynchronously and returns 202 ACCEPTED', async () => {
      const app = getApp(reportingUser);

      const res = await request(app)
        .post('/v1/reports/RPT_DISBURSEMENT_REGISTER/runs')
        .send({
          format: 'CSV',
          parameters: { branchId: 'brn_main' },
        });

      expect(res.status).toBe(202);
      expect(res.body.id).toMatch(/^rpr_/);
      expect(res.body.reportCode).toBe('RPT_DISBURSEMENT_REGISTER');
      expect(['PENDING', 'RUNNING', 'COMPLETED']).toContain(res.body.status);
    });

    it('TC-RPT-026 retrieves report run status and details by id', async () => {
      const app = getApp(reportingUser);

      const createRes = await request(app)
        .post('/v1/reports/RPT_LEAD_PIPELINE/runs')
        .send({ format: 'JSON' });
      const runId = createRes.body.id;

      const getRes = await request(app).get(`/v1/report-runs/${runId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(runId);
      expect(getRes.body.status).toBe('COMPLETED');
      expect(getRes.body.rowCount).toBeGreaterThanOrEqual(0);
    });

    it('TC-RPT-027 rejects report run creation for non-existent report code with 404 NOT_FOUND', async () => {
      const app = getApp(reportingUser);

      const res = await request(app).post('/v1/reports/UNKNOWN_REPORT_CODE/runs').send({ format: 'CSV' });

      expect(res.status).toBe(404);
    });
  });

  describe('SUB-RPT.05: Exports & Report Schedules', () => {
    it('TC-RPT-028 rejects export creation when caller lacks export.run with 403 FORBIDDEN', async () => {
      const app = getApp(reportingUser); // reportingUser only has report.read

      const res = await request(app)
        .post('/v1/exports')
        .send({
          exportType: 'METRICS',
          fileFormat: 'CSV',
          filters: { period: '2026-10' },
          scopeType: 'TENANT',
        });

      expect(res.status).toBe(403);
      expect(res.body.error?.message).toContain('export.run');
    });

    it('TC-RPT-029 creates export job with 24-hour expiry for user with export.run permission', async () => {
      const app = getApp(exportUser);

      const res = await request(app)
        .post('/v1/exports')
        .send({
          exportType: 'METRICS',
          fileFormat: 'CSV',
          filters: { period: '2026-10' },
          scopeType: 'TENANT',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^exp_/);
      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.expiresAt).toBeDefined();

      // Check expiresAt is approximately 24 hours in future
      const expTime = new Date(res.body.expiresAt).getTime();
      const nowTime = Date.now();
      const diffHours = (expTime - nowTime) / (1000 * 60 * 60);
      expect(diffHours).toBeGreaterThan(23);
      expect(diffHours).toBeLessThan(25);
    });

    it('TC-RPT-030 retrieves export job by ID', async () => {
      const app = getApp(exportUser);

      const createRes = await request(app)
        .post('/v1/exports')
        .send({
          exportType: 'OPERATIONAL_SUMMARY',
          fileFormat: 'JSON',
          filters: { date: '2026-10-12' },
          scopeType: 'TENANT',
        });

      const getRes = await request(app).get(`/v1/exports/${createRes.body.id}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(createRes.body.id);
      expect(getRes.body.downloadUrl).toBeDefined();
    });

    it('TC-RPT-031 rejects report schedule creation when caller lacks report.schedule with 403 FORBIDDEN', async () => {
      const app = getApp(reportingUser);

      const res = await request(app)
        .post('/v1/report-schedules')
        .send({
          reportCode: 'RPT_DISBURSEMENT_REGISTER',
          frequency: 'WEEKLY',
          recipientEmails: ['finance@example.com'],
          recipientScope: 'TENANT',
        });

      expect(res.status).toBe(403);
    });

    it('TC-RPT-032 creates report schedule with frequency for schedulerUser', async () => {
      const app = getApp(schedulerUser);

      const res = await request(app)
        .post('/v1/report-schedules')
        .send({
          reportCode: 'RPT_DISBURSEMENT_REGISTER',
          frequency: 'WEEKLY',
          recipientEmails: ['finance@example.com'],
          recipientScope: 'TENANT',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^sch_/);
      expect(res.body.reportCode).toBe('RPT_DISBURSEMENT_REGISTER');
      expect(res.body.frequency).toBe('WEEKLY');
      expect(res.body.isActive).toBe(true);
    });

    it('TC-RPT-033 lists report schedules and TC-RPT-034 deletes a schedule', async () => {
      const app = getApp(schedulerUser);

      const createRes = await request(app)
        .post('/v1/report-schedules')
        .send({
          reportCode: 'RPT_BRANCH_SUMMARY',
          frequency: 'MONTHLY',
          recipientEmails: ['operations@example.com'],
          recipientScope: 'TENANT',
        });
      const schedId = createRes.body.id;

      // List schedules
      const listRes = await request(app).get('/v1/report-schedules');
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.some((s: any) => s.id === schedId)).toBe(true);

      // Delete schedule
      const delRes = await request(app).delete(`/v1/report-schedules/${schedId}`);
      expect(delRes.status).toBe(204);

      // Verify deleted
      const listAfter = await request(app).get('/v1/report-schedules');
      expect(listAfter.body.data.some((s: any) => s.id === schedId)).toBe(false);
    });
    it('TC-IMP-EXP-001 enforces step-up MFA and rejects export creation when authTime is missing or stale', async () => {
      const staleExportUser = testPrincipal({
        tenantId: tenantA,
        id: 'usr_stale_exporter',
        primaryBranchId: 'brn_main',
        authTime: null, // No fresh MFA step-up
        grants: [
          { code: 'report.read', scope: 'TENANT', branchIds: [] },
          { code: 'export.run', scope: 'TENANT', branchIds: [] },
        ],
      });
      const app = getApp(staleExportUser);

      const res = await request(app).post('/v1/exports').send({
        exportType: 'METRICS',
        fileFormat: 'CSV',
        filters: {},
        scopeType: 'TENANT',
      });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('STEP_UP_REQUIRED');
    });

    it('TC-IMP-EXP-002 prevents branch-scoped user from initiating tenant-wide export', async () => {
      const branchExportUser = testPrincipal({
        tenantId: tenantA,
        id: 'usr_branch_exporter',
        primaryBranchId: 'brn_branch1',
        authTime: new Date().toISOString(),
        grants: [
          { code: 'report.read', scope: 'BRANCH', branchIds: ['brn_branch1'] },
          { code: 'export.run', scope: 'BRANCH', branchIds: ['brn_branch1'] },
        ],
      });
      const app = getApp(branchExportUser);

      const res = await request(app).post('/v1/exports').send({
        exportType: 'METRICS',
        fileFormat: 'CSV',
        filters: {},
        scopeType: 'TENANT', // Attempt tenant escalation
      });

      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('FORBIDDEN');
    });

    it('TC-IMP-EXP-003 downloads generated export file with correct headers and content', async () => {
      const app = getApp(exportUser);

      const createRes = await request(app).post('/v1/exports').send({
        exportType: 'METRICS',
        fileFormat: 'CSV',
        filters: {},
        scopeType: 'TENANT',
      });

      expect(createRes.status).toBe(201);
      const exportId = createRes.body.id;

      const downloadRes = await request(app).get(`/v1/exports/${exportId}/download`);
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers['content-type']).toContain('text/csv');
      expect(downloadRes.headers['content-disposition']).toContain(`export_${exportId}.csv`);
      expect(downloadRes.text).toContain('date');
    });

    it('TC-IMP-EXP-004 rejects download attempt by unauthorized user with 403 FORBIDDEN', async () => {
      const appExporter = getApp(exportUser);
      const appUnauthorized = getApp(reportingUser); // lacks export.run

      const createRes = await request(appExporter).post('/v1/exports').send({
        exportType: 'METRICS',
        fileFormat: 'CSV',
        filters: {},
        scopeType: 'TENANT',
      });

      const exportId = createRes.body.id;
      const downloadRes = await request(appUnauthorized).get(`/v1/exports/${exportId}/download`);
      expect(downloadRes.status).toBe(403);
    });

    it('TC-IMP-EXP-005 rejects download of expired export with 400 VALIDATION_ERROR', async () => {
      const app = getApp(exportUser);

      const createRes = await request(app).post('/v1/exports').send({
        exportType: 'METRICS',
        fileFormat: 'CSV',
        filters: {},
        scopeType: 'TENANT',
      });

      const exportId = createRes.body.id;

      // Manually simulate expiration in repo
      const job = await repo.getExportJob({} as any, tenantA, exportId);
      if (job) {
        job.expires_at = new Date(Date.now() - 1000).toISOString();
      }

      const downloadRes = await request(app).get(`/v1/exports/${exportId}/download`);
      expect(downloadRes.status).toBe(422);
      expect(downloadRes.body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('TC-IMP-EXP-006 returns 404 for nonexistent export download', async () => {
      const app = getApp(exportUser);
      const downloadRes = await request(app).get('/v1/exports/exp_nonexistent/download');
      expect(downloadRes.status).toBe(404);
    });

    it('TC-IMP-EXP-001b rejects export creation when authTime is older than 900s (MFA step-up expired)', async () => {
      const expiredMfaUser = testPrincipal({
        tenantId: tenantA,
        id: 'usr_expired_mfa_exporter',
        primaryBranchId: 'brn_main',
        authTime: new Date(Date.now() - 1000 * 1000).toISOString(), // 1000s ago > 900s limit
        grants: [
          { code: 'report.read', scope: 'TENANT', branchIds: [] },
          { code: 'export.run', scope: 'TENANT', branchIds: [] },
        ],
      });
      const app = getApp(expiredMfaUser);

      const res = await request(app).post('/v1/exports').send({
        exportType: 'METRICS',
        fileFormat: 'CSV',
        filters: {},
        scopeType: 'TENANT',
      });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('STEP_UP_REQUIRED');
    });

    it('TC-RPT-033 isolates exports across tenants (Tenant B cannot read, list, or download Tenant A export)', async () => {
      const appA = getApp(exportUser);
      const appB = getApp(otherTenantExportUser);

      const createRes = await request(appA).post('/v1/exports').send({
        exportType: 'METRICS',
        fileFormat: 'CSV',
        filters: {},
        scopeType: 'TENANT',
      });

      expect(createRes.status).toBe(201);
      const exportId = createRes.body.id;

      // Tenant B attempts to read export job -> 404
      const getResB = await request(appB).get(`/v1/exports/${exportId}`);
      expect(getResB.status).toBe(404);

      // Tenant B attempts to download export file -> 404
      const dlResB = await request(appB).get(`/v1/exports/${exportId}/download`);
      expect(dlResB.status).toBe(404);

      // Tenant B lists exports -> does not contain Tenant A export
      const listResB = await request(appB).get('/v1/exports');
      expect(listResB.status).toBe(200);
      expect(listResB.body.data.some((e: any) => e.id === exportId)).toBe(false);
    });

    it('TC-RPT-034 isolates report runs across tenants (Tenant B cannot read, list, or download Tenant A report run)', async () => {
      const appA = getApp(reportingUser);
      const appB = getApp(otherTenantUser);

      const runRes = await request(appA).post('/v1/reports/RPT_LEAD_PIPELINE/runs').send({ format: 'CSV' });

      expect(runRes.status).toBe(202);
      const runId = runRes.body.id;

      // Tenant B attempts to read Tenant A report run -> 404
      const getResB = await request(appB).get(`/v1/report-runs/${runId}`);
      expect(getResB.status).toBe(404);

      // Tenant B attempts to download Tenant A report run -> 404
      const dlResB = await request(appB).get(`/v1/report-runs/${runId}/download`);
      expect(dlResB.status).toBe(404);

      // Tenant B lists report runs -> does not contain Tenant A report run
      const listResB = await request(appB).get('/v1/report-runs');
      expect(listResB.status).toBe(200);
      expect(listResB.body.data.some((r: any) => r.id === runId)).toBe(false);
    });

    it('TC-RPT-035 isolates report schedules across tenants (Tenant B cannot list or delete Tenant A schedule)', async () => {
      const appA = getApp(schedulerUser);
      const appB = getApp(otherTenantExportUser);

      const schedRes = await request(appA)
        .post('/v1/report-schedules')
        .send({
          reportCode: 'RPT_LEAD_PIPELINE',
          frequency: 'DAILY',
          recipientEmails: ['analyst@tenant-a.com'],
          recipientScope: 'TENANT',
        });

      expect(schedRes.status).toBe(201);
      const scheduleId = schedRes.body.id;

      // Tenant B attempts to delete Tenant A schedule -> 404
      const delResB = await request(appB).delete(`/v1/report-schedules/${scheduleId}`);
      expect(delResB.status).toBe(404);

      // Tenant B lists schedules -> does not contain Tenant A schedule
      const listResB = await request(appB).get('/v1/report-schedules');
      expect(listResB.status).toBe(200);
      expect(listResB.body.data.some((s: any) => s.id === scheduleId)).toBe(false);
    });
  });
});
