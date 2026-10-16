// apps/api/test/lender-cases.pg.int.spec.ts — owner: Dev 4 (MOD-LCS PostgreSQL Integration & Real Database Verification)
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireLocalTestDatabaseUrl } from './support/test-db-url';

describe('Module 18 — Lender Cases PostgreSQL Integration (Real Database & Constraints)', () => {
  const connectionString =
    requireLocalTestDatabaseUrl('VERIFY_DATABASE_URL');

  const tenantA = 'ten_01JTESTTENANT00000000000000';
  const tenantB = 'ten_demo_01';
  const branchA = 'br_01JMUMBAI000000000000000000';

  let adminClient: pg.Client;
  let apiClient: pg.Client;

  // Test fixture IDs
  const runId = Date.now().toString(36);
  const orgId = `org_lcs_pg_${runId}`;
  const userId = `usr_lcs_pg_${runId}`;
  const customerId = `cust_lcs_pg_${runId}`;
  const lenderId1 = `lnd_lcs_pg_1_${runId}`;
  const lenderId2 = `lnd_lcs_pg_2_${runId}`;
  const empId1 = `emp_lcs_pg_1_${runId}`;
  const prodId = `prd_lcs_pg_${runId}`;
  const prodVerId = `lpv_lcs_pg_${runId}`;
  const appId = `app_lcs_pg_${runId}`;

  beforeAll(async () => {
    adminClient = new pg.Client({ connectionString });
    await adminClient.connect();

    const apiDbUrl =
      requireLocalTestDatabaseUrl('DATABASE_URL');
    apiClient = new pg.Client({ connectionString: apiDbUrl });
    await apiClient.connect();

    // Ensure tenantA exists
    await adminClient.query(
      `INSERT INTO app.tenant (id, slug, legal_name, tenant_type, status, created_by)
       VALUES ($1, $2, 'Test Org', 'DSA_ORG', 'ACTIVE', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [tenantA, `tenant-lcs-${runId}`],
    );

    // Ensure organisation
    await adminClient.query(
      `INSERT INTO app.organisation (id, tenant_id, legal_name, constitution, status, created_by, updated_by)
       VALUES ($1, $2, 'LCS Test Org', 'PVT_LTD', 'ACTIVE', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [orgId, tenantA],
    );

    // Ensure branch
    await adminClient.query(
      `INSERT INTO app.branch (id, tenant_id, organisation_id, code, name, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'LCS Mumbai', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [branchA, tenantA, orgId, `BR_${runId.toUpperCase()}`],
    );

    // Ensure user
    await adminClient.query(
      `INSERT INTO app.app_user (id, tenant_id, idp_subject, email, display_name, primary_branch_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'LCS Tester', $5, 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [userId, tenantA, `sub_lcs_${runId}`, `lcs_${runId}@example.com`, branchA],
    );

    // Ensure customer
    await adminClient.query(
      `INSERT INTO app.customer (id, tenant_id, party_type, full_name, home_branch_id, status, created_by, updated_by)
       VALUES ($1, $2, 'INDIVIDUAL', 'PG Test Customer', $3, 'ACTIVE', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [customerId, tenantA, branchA],
    );

    // Ensure lenders
    await adminClient.query(
      `INSERT INTO app.lender (id, tenant_id, name, lender_type, status, created_by, updated_by)
       VALUES ($1, $2, $3, 'BANK', 'ACTIVE', 'tester', 'tester'),
              ($4, $2, $5, 'NBFC', 'ACTIVE', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [lenderId1, tenantA, `LCS HDFC ${runId}`, lenderId2, `LCS ICICI ${runId}`],
    );

    // Ensure empanelment
    await adminClient.query(
      `INSERT INTO app.empanelment (id, tenant_id, organisation_id, lender_id, dsa_code, valid_range, permitted_categories, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, daterange(CURRENT_DATE - 30, CURRENT_DATE + 365), ARRAY['HL', 'PL'], 'ACTIVE', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [empId1, tenantA, orgId, lenderId1, `DSA_${runId.toUpperCase()}`],
    );

    // Ensure loan product & version
    await adminClient.query(
      `INSERT INTO app.loan_product (id, tenant_id, lender_id, name, category, applicant_types, secured, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'HL', ARRAY['SALARIED'], true, 'ACTIVE', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [prodId, tenantA, lenderId1, `Home Loan ${runId}`],
    );
    await adminClient.query(
      `INSERT INTO app.loan_product_version (id, tenant_id, product_id, version_no, effective_from, amount_min, amount_max, tenure_min_months, tenure_max_months, status, created_by)
       VALUES ($1, $2, $3, 1, now(), 100000, 50000000, 12, 360, 'ACTIVE', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [prodVerId, tenantA, prodId],
    );

    // Ensure loan application
    await adminClient.query(
      `INSERT INTO app.loan_application (id, tenant_id, branch_id, customer_id, product_category, product_version_id, requested_amount, applicant_type, status, sales_owner_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'HL', $5, 2500000, 'SALARIED', 'READY_FOR_SUBMISSION', $6, 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [appId, tenantA, branchA, customerId, prodVerId, userId],
    );
  });

  afterAll(async () => {
    // Clean up test data in reverse foreign key order
    try {
      await adminClient.query(`DELETE FROM app.submission_package WHERE tenant_id = $1 AND lender_case_id IN (SELECT id FROM app.lender_case WHERE tenant_id = $1)`, [tenantA]);
      await adminClient.query(`DELETE FROM app.lender_case_status_history WHERE tenant_id = $1 AND lender_case_id IN (SELECT id FROM app.lender_case WHERE tenant_id = $1)`, [tenantA]);
      await adminClient.query(`DELETE FROM app.lender_case WHERE tenant_id = $1 AND application_id = $2`, [tenantA, appId]);
      await adminClient.query(`DELETE FROM app.loan_application WHERE id = $1`, [appId]);
      await adminClient.query(`DELETE FROM app.loan_product_version WHERE id = $1`, [prodVerId]);
      await adminClient.query(`DELETE FROM app.loan_product WHERE id = $1`, [prodId]);
      await adminClient.query(`DELETE FROM app.empanelment WHERE id = $1`, [empId1]);
      await adminClient.query(`DELETE FROM app.lender WHERE id IN ($1, $2)`, [lenderId1, lenderId2]);
      await adminClient.query(`DELETE FROM app.customer WHERE id = $1`, [customerId]);
      await adminClient.query(`DELETE FROM app.app_user WHERE id = $1`, [userId]);
      await adminClient.query(`DELETE FROM app.branch WHERE id = $1`, [branchA]);
      await adminClient.query(`DELETE FROM app.organisation WHERE id = $1`, [orgId]);
    } catch {
      // Best-effort cleanup
    } finally {
      await adminClient?.end();
      await apiClient?.end();
    }
  });

  it('PG-LCS-001 enforces unique (application_id, attempt_no) constraint and attempt_no >= 1', async () => {
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      const caseId1 = `lcs_pg_att1_${runId}`;
      const caseId2 = `lcs_pg_att2_${runId}`;

      // Insert attempt 1
      await adminClient.query(
        `INSERT INTO app.lender_case (
          id, tenant_id, application_id, lender_id, product_version_id, empanelment_id,
          attempt_no, status, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, 1, 'DRAFT', 'tester', 'tester')`,
        [caseId1, tenantA, appId, lenderId1, prodVerId, empId1],
      );

      // Inserting another case with the SAME attempt_no (1) for this application must fail
      await adminClient.query('SAVEPOINT sp_dup');
      await expect(
        adminClient.query(
          `INSERT INTO app.lender_case (
            id, tenant_id, application_id, lender_id, product_version_id, empanelment_id,
            attempt_no, status, created_by, updated_by
          ) VALUES ($1, $2, $3, $4, $5, $6, 1, 'DRAFT', 'tester', 'tester')`,
          [caseId2, tenantA, appId, lenderId2, prodVerId, empId1],
        ),
      ).rejects.toThrow(/unique constraint|application_id.*attempt_no/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_dup');

      // Inserting with attempt_no = 0 must fail check (attempt_no >= 1)
      await adminClient.query('SAVEPOINT sp_zero');
      await expect(
        adminClient.query(
          `INSERT INTO app.lender_case (
            id, tenant_id, application_id, lender_id, product_version_id, empanelment_id,
            attempt_no, status, created_by, updated_by
          ) VALUES ($1, $2, $3, $4, $5, $6, 0, 'DRAFT', 'tester', 'tester')`,
          [caseId2, tenantA, appId, lenderId2, prodVerId, empId1],
        ),
      ).rejects.toThrow(/check constraint|attempt_no/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_zero');
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-LCS-002 enforces partial unique index lender_case_one_active_uq on (application_id, lender_id)', async () => {
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      const caseId1 = `lcs_pg_act1_${runId}`;
      const caseId2 = `lcs_pg_act2_${runId}`;

      // Insert active case 1 (status DRAFT) for lender 1
      await adminClient.query(
        `INSERT INTO app.lender_case (
          id, tenant_id, application_id, lender_id, product_version_id, empanelment_id,
          attempt_no, status, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, 1, 'DRAFT', 'tester', 'tester')`,
        [caseId1, tenantA, appId, lenderId1, prodVerId, empId1],
      );

      // Attempting to insert another active case (status SUBMITTED) for the SAME lender must fail
      await adminClient.query('SAVEPOINT sp_active_dup');
      await expect(
        adminClient.query(
          `INSERT INTO app.lender_case (
            id, tenant_id, application_id, lender_id, product_version_id, empanelment_id,
            attempt_no, status, submission_channel, submitted_at, created_by, updated_by
          ) VALUES ($1, $2, $3, $4, $5, $6, 2, 'SUBMITTED', 'PORTAL', now(), 'tester', 'tester')`,
          [caseId2, tenantA, appId, lenderId1, prodVerId, empId1],
        ),
      ).rejects.toThrow(/unique constraint|lender_case_one_active_uq/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_active_dup');
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-LCS-003 enforces status check constraints on submission metadata and decline reasons', async () => {
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      const testCaseId = `lcs_pg_chk_${runId}`;

      // 1. Status SUBMITTED without submitted_at / submission_channel must violate CHECK
      await adminClient.query('SAVEPOINT sp_submit_chk');
      await expect(
        adminClient.query(
          `INSERT INTO app.lender_case (
            id, tenant_id, application_id, lender_id, product_version_id, empanelment_id,
            attempt_no, status, created_by, updated_by
          ) VALUES ($1, $2, $3, $4, $5, $6, 1, 'SUBMITTED', 'tester', 'tester')`,
          [testCaseId, tenantA, appId, lenderId1, prodVerId, empId1],
        ),
      ).rejects.toThrow(/check constraint/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_submit_chk');

      // 2. Status REJECTED without decline_reason_code must violate CHECK (status <> 'REJECTED' OR decline_reason_code IS NOT NULL)
      await adminClient.query('SAVEPOINT sp_reject_chk');
      await expect(
        adminClient.query(
          `INSERT INTO app.lender_case (
            id, tenant_id, application_id, lender_id, product_version_id, empanelment_id,
            attempt_no, status, submission_channel, submitted_at, created_by, updated_by
          ) VALUES ($1, $2, $3, $4, $5, $6, 1, 'REJECTED', 'PORTAL', now(), 'tester', 'tester')`,
          [testCaseId, tenantA, appId, lenderId1, prodVerId, empId1],
        ),
      ).rejects.toThrow(/check constraint/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_reject_chk');

      // 3. Status REJECTED with valid decline_reason_code succeeds
      await adminClient.query('SAVEPOINT sp_reject_ok');
      const validReject = await adminClient.query(
        `INSERT INTO app.lender_case (
          id, tenant_id, application_id, lender_id, product_version_id, empanelment_id,
          attempt_no, status, submission_channel, submitted_at, decline_reason_code, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, 1, 'REJECTED', 'PORTAL', now(), 'POLICY', 'tester', 'tester')
        RETURNING id, status, decline_reason_code`,
        [testCaseId, tenantA, appId, lenderId1, prodVerId, empId1],
      );
      expect(validReject.rows[0].status).toBe('REJECTED');
      expect(validReject.rows[0].decline_reason_code).toBe('POLICY');
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_reject_ok');
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-LCS-004 enforces package_freeze_guard() trigger forbidding mutation of frozen submission packages', async () => {
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      const caseId = `lcs_pg_pkg_${runId}`;
      const pkgId = `pkg_pg_frz_${runId}`;

      await adminClient.query(
        `INSERT INTO app.lender_case (
          id, tenant_id, application_id, lender_id, product_version_id, empanelment_id,
          attempt_no, status, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, 1, 'PACKAGE_READY', 'tester', 'tester')`,
        [caseId, tenantA, appId, lenderId1, prodVerId, empId1],
      );

      // Insert already frozen package
      await adminClient.query(
        `INSERT INTO app.submission_package (
          id, tenant_id, lender_case_id, kind, manifest, manifest_sha256, consent_ids, built_by, built_at, frozen_at
        ) VALUES ($1, $2, $3, 'SUBMISSION', '{"documentVersions":[]}'::jsonb, repeat('a', 64), ARRAY['cnst_01'], 'tester', now(), now())`,
        [pkgId, tenantA, caseId],
      );

      // Attempting to UPDATE the frozen submission package must fail via trigger
      await expect(
        adminClient.query(
          `UPDATE app.submission_package SET manifest = '{"mutated": true}'::jsonb WHERE id = $1`,
          [pkgId],
        ),
      ).rejects.toThrow(/immutable.*only frozen_at may be set once/i);
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-LCS-005 enforces append-only trigger forbid_mutation() on lender_case_status_history', async () => {
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      const caseId = `lcs_pg_hist_${runId}`;
      const histId = `lcsh_pg_hist_${runId}`;

      await adminClient.query(
        `INSERT INTO app.lender_case (
          id, tenant_id, application_id, lender_id, product_version_id, empanelment_id,
          attempt_no, status, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, 1, 'DRAFT', 'tester', 'tester')`,
        [caseId, tenantA, appId, lenderId1, prodVerId, empId1],
      );

      // Insert initial history record
      await adminClient.query(
        `INSERT INTO app.lender_case_status_history (
          id, tenant_id, lender_case_id, from_status, to_status, status_source, actor
        ) VALUES ($1, $2, $3, NULL, 'DRAFT', 'MANUAL', 'tester')`,
        [histId, tenantA, caseId],
      );

      // Attempting UPDATE on status history must fail
      await adminClient.query('SAVEPOINT sp_upd');
      await expect(
        adminClient.query(
          `UPDATE app.lender_case_status_history SET to_status = 'SUBMITTED' WHERE id = $1`,
          [histId],
        ),
      ).rejects.toThrow(/append-only/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_upd');

      // Attempting DELETE on status history must fail
      await adminClient.query('SAVEPOINT sp_del');
      await expect(
        adminClient.query(
          `DELETE FROM app.lender_case_status_history WHERE id = $1`,
          [histId],
        ),
      ).rejects.toThrow(/append-only/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_del');
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-LCS-006 enforces Row-Level Security tenant isolation on lender_case table', async () => {
    const caseId = `lcs_pg_rls_${runId}`;

    // Insert case for tenantA via adminClient
    await adminClient.query(
      `INSERT INTO app.lender_case (
        id, tenant_id, application_id, lender_id, product_version_id, empanelment_id,
        attempt_no, status, created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, 1, 'DRAFT', 'tester', 'tester')`,
      [caseId, tenantA, appId, lenderId1, prodVerId, empId1],
    );

    try {
      // 1. Querying with apiClient under Tenant A context -> finds record
      await apiClient.query('BEGIN');
      await apiClient.query(`SET LOCAL app.tenant_id = '${tenantA}'`);
      await apiClient.query('SET LOCAL search_path = app, public');
      const resA = await apiClient.query(`SELECT id FROM app.lender_case WHERE id = $1`, [caseId]);
      expect(resA.rows.length).toBe(1);
      expect(resA.rows[0].id).toBe(caseId);
      await apiClient.query('ROLLBACK');

      // 2. Querying with apiClient under Tenant B context -> finds 0 rows (isolated)
      await apiClient.query('BEGIN');
      await apiClient.query(`SET LOCAL app.tenant_id = '${tenantB}'`);
      await apiClient.query('SET LOCAL search_path = app, public');
      const resB = await apiClient.query(`SELECT id FROM app.lender_case WHERE id = $1`, [caseId]);
      expect(resB.rows.length).toBe(0);
      await apiClient.query('ROLLBACK');

      // 3. Querying with apiClient without tenant context -> fail-closed (0 rows)
      await apiClient.query('BEGIN');
      await apiClient.query('SET LOCAL search_path = app, public');
      const resNoTenant = await apiClient.query(`SELECT id FROM app.lender_case WHERE id = $1`, [caseId]);
      expect(resNoTenant.rows.length).toBe(0);
      await apiClient.query('ROLLBACK');
    } finally {
      await adminClient.query(`DELETE FROM app.lender_case WHERE id = $1`, [caseId]);
    }
  });

  it('PG-LCS-007 verifies atomic transaction rollback during lender case submission', async () => {
    const caseId = `lcs_pg_rb_${runId}`;
    const pkgId = `pkg_pg_rb_${runId}`;
    const histId = `lcsh_pg_rb_${runId}`;

    // Seed draft case
    await adminClient.query(
      `INSERT INTO app.lender_case (
        id, tenant_id, application_id, lender_id, product_version_id, empanelment_id,
        attempt_no, status, created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, 1, 'DRAFT', 'tester', 'tester')`,
      [caseId, tenantA, appId, lenderId1, prodVerId, empId1],
    );

    // Multi-table submission transaction with intentional failure
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');

      // 1. Update case status to SUBMITTED
      await adminClient.query(
        `UPDATE app.lender_case SET
          status = 'SUBMITTED',
          submission_channel = 'PORTAL',
          submitted_at = now(),
          package_id = $2,
          lock_version = lock_version + 1
        WHERE id = $1`,
        [caseId, pkgId],
      );

      // 2. Insert package
      await adminClient.query(
        `INSERT INTO app.submission_package (
          id, tenant_id, lender_case_id, kind, manifest, manifest_sha256, consent_ids, built_by, built_at, frozen_at
        ) VALUES ($1, $2, $3, 'SUBMISSION', '{"docs":[]}'::jsonb, repeat('f', 64), ARRAY['cnst_01'], 'tester', now(), now())`,
        [pkgId, tenantA, caseId],
      );

      // 3. Insert status history
      await adminClient.query(
        `INSERT INTO app.lender_case_status_history (
          id, tenant_id, lender_case_id, from_status, to_status, status_source, actor
        ) VALUES ($1, $2, $3, 'DRAFT', 'SUBMITTED', 'MANUAL', 'tester')`,
        [histId, tenantA, caseId],
      );

      // 4. Inject failure before commit!
      throw new Error('Simulated network failure midway through submission transaction');
    } catch {
      await adminClient.query('ROLLBACK');
    }

    // Verify after rollback: case must still be in DRAFT state
    const caseCheck = await adminClient.query(`SELECT status, submitted_at, lock_version FROM app.lender_case WHERE id = $1`, [caseId]);
    expect(caseCheck.rows[0].status).toBe('DRAFT');
    expect(caseCheck.rows[0].submitted_at).toBeNull();
    expect(caseCheck.rows[0].lock_version).toBe(0);

    // Submission package must NOT exist
    const pkgCheck = await adminClient.query(`SELECT id FROM app.submission_package WHERE id = $1`, [pkgId]);
    expect(pkgCheck.rows.length).toBe(0);

    // Status history must NOT exist
    const histCheck = await adminClient.query(`SELECT id FROM app.lender_case_status_history WHERE id = $1`, [histId]);
    expect(histCheck.rows.length).toBe(0);

    // Cleanup
    await adminClient.query(`DELETE FROM app.lender_case WHERE id = $1`, [caseId]);
  });
});
