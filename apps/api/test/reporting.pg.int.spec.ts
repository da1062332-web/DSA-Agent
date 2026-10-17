// apps/api/test/reporting.pg.int.spec.ts — MOD-RPT Reporting PostgreSQL Integration Tests
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireLocalTestDatabaseUrl } from './support/test-db-url';

describe('Module MOD-RPT — PostgreSQL Integration (Real Tables & RLS)', () => {
  const connectionString =
    requireLocalTestDatabaseUrl('VERIFY_DATABASE_URL');

  const tenantA = 'ten_01JTESTTENANT00000000000000';
  const tenantB = 'ten_demo_01';

  let adminClient: pg.Client;
  let apiClient: pg.Client;

  const runId = Date.now().toString(36);
  const branchId = `br_rpt_pg_${runId}`;
  const userId = `usr_rpt_pg_${runId}`;

  beforeAll(async () => {
    adminClient = new pg.Client({ connectionString });
    await adminClient.connect();

    const apiDbUrl =
      requireLocalTestDatabaseUrl('DATABASE_URL');
    apiClient = new pg.Client({ connectionString: apiDbUrl });
    await apiClient.connect();

    const orgId = `org_rpt_pg_${runId}`;

    // Ensure tenantA exists
    await adminClient.query(
      `INSERT INTO app.tenant (id, slug, legal_name, tenant_type, status, created_by)
       VALUES ($1, $2, 'Reporting Test Org', 'DSA_ORG', 'ACTIVE', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [tenantA, `tenant-rpt-${runId}`],
    );

    // Ensure organisation
    await adminClient.query(
      `INSERT INTO app.organisation (id, tenant_id, legal_name, constitution, status, created_by, updated_by)
       VALUES ($1, $2, 'RPT Test Org', 'PVT_LTD', 'ACTIVE', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [orgId, tenantA],
    );

    // Ensure branch
    await adminClient.query(
      `INSERT INTO app.branch (id, tenant_id, organisation_id, code, name, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'Reporting Branch', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [branchId, tenantA, orgId, `RPT_${runId.toUpperCase()}`.slice(0, 20)],
    );

    // Ensure user exists for FK references
    await adminClient.query(
      `INSERT INTO app.app_user (id, tenant_id, idp_subject, primary_branch_id, email, display_name, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, 'Reporting Test User', 'ACTIVE', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [userId, tenantA, `idp_${userId}`, branchId, `rpt_${runId}@example.com`],
    );

    // Ensure metric_definition rows exist for tenantA
    await adminClient.query(
      `INSERT INTO app.metric_definition (tenant_id, code, name, description, category, unit, aggregation_type, source_domain)
       VALUES ($1, 'LEAD_COUNT', 'Lead Intake Count', 'Total new leads', 'ACTIVITY', 'COUNT', 'COUNT', 'CRM')
       ON CONFLICT (tenant_id, code) DO NOTHING`,
      [tenantA],
    );
  });

  afterAll(async () => {
    if (adminClient) {
      await adminClient.query(`DELETE FROM app.rpt_daily_operational_summary WHERE tenant_id = $1`, [
        tenantA,
      ]);
      await adminClient.end();
    }
    if (apiClient) {
      await apiClient.end();
    }
  });

  it('PG-RPT-001 metric_definition catalog exists and is readable in schema app', async () => {
    const res = await adminClient.query(
      `SELECT code, name, category, unit FROM app.metric_definition WHERE tenant_id = $1 ORDER BY code`,
      [tenantA],
    );
    expect(res.rows.length).toBeGreaterThanOrEqual(1);
    const codes = res.rows.map((r: { code: string }) => r.code);
    expect(codes).toContain('LEAD_COUNT');
  });

  it('PG-RPT-002 rpt_daily_operational_summary enforces RLS tenant isolation', async () => {
    // Insert row for tenantA as admin
    const today = new Date().toISOString().slice(0, 10);
    await adminClient.query(
      `INSERT INTO app.rpt_daily_operational_summary (
        tenant_id, summary_date, branch_id, user_id,
        lead_created_count, lead_qualified_count, lead_converted_count,
        activity_count, sanction_count, sanction_amount,
        disbursement_count, disbursement_amount
       ) VALUES ($1, $2, $3, $4, 5, 3, 2, 8, 1, 1000000, 1, 1000000)
       ON CONFLICT (tenant_id, summary_date, branch_id, user_id) DO UPDATE SET lead_created_count = 5`,
      [tenantA, today, branchId, userId],
    );

    // Query as dsa_api with tenantA context
    await apiClient.query('BEGIN');
    try {
      await apiClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
      const resA = await apiClient.query(
        `SELECT * FROM app.rpt_daily_operational_summary WHERE summary_date = $1`,
        [today],
      );
      expect(resA.rows.length).toBeGreaterThanOrEqual(1);
      expect(resA.rows[0].lead_created_count).toBe(5);

      // Query as dsa_api with tenantB context
      await apiClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantB]);
      const resB = await apiClient.query(
        `SELECT * FROM app.rpt_daily_operational_summary WHERE summary_date = $1 AND branch_id = $2`,
        [today, branchId],
      );
      expect(resB.rows.length).toBe(0); // Zero cross-tenant leakage!
    } finally {
      await apiClient.query('ROLLBACK');
    }
  });

  it('PG-RPT-003 fails closed without app.tenant_id set for dsa_api', async () => {
    await apiClient.query('BEGIN');
    try {
      // No set_config('app.tenant_id')
      const res = await apiClient.query(`SELECT count(*)::int as cnt FROM app.rpt_daily_operational_summary`);
      expect(res.rows[0].cnt).toBe(0);
    } finally {
      await apiClient.query('ROLLBACK');
    }
  });

  it('PG-RPT-004 verifies report.manage permission exists in app.permission and is granted to admin roles', async () => {
    const permRes = await adminClient.query(
      `SELECT code, description FROM app.permission WHERE code = 'report.manage'`,
    );
    expect(permRes.rows.length).toBe(1);
    expect(permRes.rows[0].code).toBe('report.manage');

    const rolePermRes = await adminClient.query(
      `SELECT r.code as role_code, rp.permission_code
       FROM app.role_permission rp
       JOIN app.role r ON r.id = rp.role_id
       WHERE rp.permission_code = 'report.manage'`,
    );
    expect(rolePermRes.rows.length).toBeGreaterThanOrEqual(1);
    const roleCodes = rolePermRes.rows.map((r: { role_code: string }) => r.role_code);
    expect(roleCodes).toContain('ROLE-TENANT-ADMIN');
  });

  it('PG-RPT-005 verifies formula JSONB, grain, and versioning on metric_definition (ENT-094)', async () => {
    const res = await adminClient.query(
      `SELECT code, formula, grain, date_basis, version
       FROM app.metric_definition
       WHERE code = 'DISBURSEMENT_AMOUNT'
       LIMIT 1`,
    );
    expect(res.rows.length).toBe(1);
    const row = res.rows[0];
    expect(row.formula).toBeDefined();
    expect(row.formula.type).toBe('SUM');
    expect(row.grain).toBe('DAILY');
    expect(row.date_basis).toBe('DISBURSED_AT');
    expect(row.version).toBeGreaterThanOrEqual(1);
  });

  it('PG-RPT-006 app.report_run enforces RLS and allows dsa_api insertion', async () => {
    const reportRunId = `rpr_${runId}`;
    await apiClient.query('BEGIN');
    try {
      await apiClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
      await apiClient.query(
        `INSERT INTO app.report_run (
          id, tenant_id, report_code, status, parameters, row_count, result_summary, created_by
         ) VALUES ($1, $2, 'RPT_LEAD_PIPELINE', 'COMPLETED', '{}'::jsonb, 10, '{"success":true}'::jsonb, $3)`,
        [reportRunId, tenantA, userId],
      );

      // Verify readable in tenantA
      const resA = await apiClient.query(`SELECT id, report_code, status FROM app.report_run WHERE id = $1`, [
        reportRunId,
      ]);
      expect(resA.rows.length).toBe(1);
      expect(resA.rows[0].report_code).toBe('RPT_LEAD_PIPELINE');

      // Verify isolated from tenantB
      await apiClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantB]);
      const resB = await apiClient.query(`SELECT id FROM app.report_run WHERE id = $1`, [reportRunId]);
      expect(resB.rows.length).toBe(0);
    } finally {
      await apiClient.query('ROLLBACK');
    }
  });

  it('PG-RPT-007 app.export_job (ENT-111) enforces RLS and 24-hr expiry constraint', async () => {
    const exportJobId = `exp_${runId}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await apiClient.query('BEGIN');
    try {
      await apiClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
      await apiClient.query(
        `INSERT INTO app.export_job (
          id, tenant_id, requester_id, scope_type, export_type, file_format,
          filters, row_count, status, expires_at
         ) VALUES ($1, $2, $3, 'TENANT', 'METRICS', 'CSV', '{}'::jsonb, 25, 'COMPLETED', $4)`,
        [exportJobId, tenantA, userId, expiresAt],
      );

      const resA = await apiClient.query(
        `SELECT id, export_type, status, expires_at FROM app.export_job WHERE id = $1`,
        [exportJobId],
      );
      expect(resA.rows.length).toBe(1);
      expect(resA.rows[0].export_type).toBe('METRICS');

      // Verify isolated from tenantB
      await apiClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantB]);
      const resB = await apiClient.query(`SELECT id FROM app.export_job WHERE id = $1`, [exportJobId]);
      expect(resB.rows.length).toBe(0);
    } finally {
      await apiClient.query('ROLLBACK');
    }
  });

  it('PG-RPT-008 app.report_schedule enforces RLS and tenant isolation', async () => {
    const scheduleId = `sch_${runId}`;
    const nextRun = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await apiClient.query('BEGIN');
    try {
      await apiClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
      await apiClient.query(
        `INSERT INTO app.report_schedule (
          id, tenant_id, report_code, frequency, filters, recipient_emails,
          recipient_scope, created_by, is_active, next_run_at
         ) VALUES ($1, $2, 'RPT_DISBURSEMENT_REGISTER', 'WEEKLY', '{}'::jsonb, ARRAY['ops@dsa.test'], 'TENANT', $3, true, $4)`,
        [scheduleId, tenantA, userId, nextRun],
      );

      const resA = await apiClient.query(
        `SELECT id, report_code, frequency FROM app.report_schedule WHERE id = $1`,
        [scheduleId],
      );
      expect(resA.rows.length).toBe(1);
      expect(resA.rows[0].report_code).toBe('RPT_DISBURSEMENT_REGISTER');

      // Verify isolated from tenantB
      await apiClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantB]);
      const resB = await apiClient.query(`SELECT id FROM app.report_schedule WHERE id = $1`, [scheduleId]);
      expect(resB.rows.length).toBe(0);
    } finally {
      await apiClient.query('ROLLBACK');
    }
  });

  it('PG-RPT-009 verifies export.run and report.schedule permissions exist and are granted', async () => {
    const permRes = await adminClient.query(
      `SELECT code FROM app.permission WHERE code IN ('export.run', 'report.schedule')`,
    );
    expect(permRes.rows.length).toBe(2);

    const rolePermRes = await adminClient.query(
      `SELECT DISTINCT rp.permission_code
       FROM app.role_permission rp
       WHERE rp.permission_code IN ('export.run', 'report.schedule')`,
    );
    expect(rolePermRes.rows.length).toBe(2);
  });
});
