// apps/api/test/sanctions.pg.int.spec.ts — owner: Dev 3 / Dev 4 (MOD-SND PostgreSQL Integration & Real Database Verification)
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('Module 19 — Sanction and Disbursement PostgreSQL Integration (Real Database & Constraints)', () => {
  const connectionString =
    process.env.VERIFY_DATABASE_URL ||
    'postgresql://postgres.mlpkwwhnagxzinaohdxg:Qloax%40DSA%2312@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';

  const tenantA = 'ten_01JTESTTENANT00000000000000';
  const tenantB = 'ten_demo_01';
  const branchA = 'br_01JMUMBAI000000000000000000';

  let adminClient: pg.Client;
  let apiClient: pg.Client;

  // Test fixture IDs
  const runId = Date.now().toString(36);
  const orgId = `org_snd_pg_${runId}`;
  const userId = `usr_snd_pg_${runId}`;
  const verifierId = `usr_snd_vrf_${runId}`;
  const customerId = `cust_snd_pg_${runId}`;
  const lenderId = `lnd_snd_pg_${runId}`;
  const empId = `emp_snd_pg_${runId}`;
  const prodId = `prd_snd_pg_${runId}`;
  const prodVerId = `lpv_snd_pg_${runId}`;
  const appId = `app_snd_pg_${runId}`;
  const caseId = `lcs_snd_pg_${runId}`;

  beforeAll(async () => {
    adminClient = new pg.Client({ connectionString });
    await adminClient.connect();

    const apiDbUrl =
      process.env.DATABASE_URL ||
      'postgresql://dsa_api.mlpkwwhnagxzinaohdxg:Qloax%40DSA%2312@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';
    apiClient = new pg.Client({ connectionString: apiDbUrl });
    await apiClient.connect();

    // Ensure tenantA exists
    await adminClient.query(
      `INSERT INTO app.tenant (id, slug, legal_name, tenant_type, status, created_by)
       VALUES ($1, $2, 'Test Org', 'DSA_ORG', 'ACTIVE', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [tenantA, `tenant-snd-${runId}`],
    );

    // Ensure organisation
    await adminClient.query(
      `INSERT INTO app.organisation (id, tenant_id, legal_name, constitution, status, created_by, updated_by)
       VALUES ($1, $2, 'SND Test Org', 'PVT_LTD', 'ACTIVE', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [orgId, tenantA],
    );

    // Ensure branch
    await adminClient.query(
      `INSERT INTO app.branch (id, tenant_id, organisation_id, code, name, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'SND Mumbai', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [branchA, tenantA, orgId, `BR_SND_${runId.toUpperCase()}`],
    );

    // Ensure users (recorder and verifier)
    await adminClient.query(
      `INSERT INTO app.app_user (id, tenant_id, idp_subject, email, display_name, primary_branch_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'SND Recorder', $5, 'tester', 'tester'),
              ($6, $2, $7, $8, 'SND Verifier', $5, 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [userId, tenantA, `sub_rec_${runId}`, `rec_${runId}@example.com`, branchA,
       verifierId, `sub_vrf_${runId}`, `vrf_${runId}@example.com`],
    );

    // Ensure customer
    await adminClient.query(
      `INSERT INTO app.customer (id, tenant_id, party_type, full_name, home_branch_id, status, created_by, updated_by)
       VALUES ($1, $2, 'INDIVIDUAL', 'SND Test Customer', $3, 'ACTIVE', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [customerId, tenantA, branchA],
    );

    // Ensure lender
    await adminClient.query(
      `INSERT INTO app.lender (id, tenant_id, name, lender_type, status, created_by, updated_by)
       VALUES ($1, $2, $3, 'BANK', 'ACTIVE', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [lenderId, tenantA, `SND HDFC ${runId}`],
    );

    // Ensure empanelment
    await adminClient.query(
      `INSERT INTO app.empanelment (id, tenant_id, organisation_id, lender_id, dsa_code, valid_range, permitted_categories, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, daterange(CURRENT_DATE - 30, CURRENT_DATE + 365), ARRAY['HL', 'PL'], 'ACTIVE', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [empId, tenantA, orgId, lenderId, `DSA_SND_${runId.toUpperCase()}`],
    );

    // Ensure loan product & version
    await adminClient.query(
      `INSERT INTO app.loan_product (id, tenant_id, lender_id, name, category, applicant_types, secured, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'HL', ARRAY['SALARIED'], true, 'ACTIVE', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [prodId, tenantA, lenderId, `SND Home Loan ${runId}`],
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

    // Ensure lender case
    await adminClient.query(
      `INSERT INTO app.lender_case (
        id, tenant_id, application_id, lender_id, product_version_id, empanelment_id,
        attempt_no, status, submission_channel, submitted_at, created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, 1, 'SUBMITTED', 'PORTAL', now(), 'tester', 'tester')
      ON CONFLICT (id) DO NOTHING`,
      [caseId, tenantA, appId, lenderId, prodVerId, empId],
    );
  });

  afterAll(async () => {
    try {
      await adminClient.query(`DELETE FROM app.disbursement_tranche WHERE tenant_id = $1`, [tenantA]);
      await adminClient.query(`DELETE FROM app.sanction WHERE tenant_id = $1`, [tenantA]);
      await adminClient.query(`DELETE FROM app.lender_case WHERE id = $1`, [caseId]);
      await adminClient.query(`DELETE FROM app.loan_application WHERE id = $1`, [appId]);
      await adminClient.query(`DELETE FROM app.loan_product_version WHERE id = $1`, [prodVerId]);
      await adminClient.query(`DELETE FROM app.loan_product WHERE id = $1`, [prodId]);
      await adminClient.query(`DELETE FROM app.empanelment WHERE id = $1`, [empId]);
      await adminClient.query(`DELETE FROM app.lender WHERE id = $1`, [lenderId]);
      await adminClient.query(`DELETE FROM app.customer WHERE id = $1`, [customerId]);
      await adminClient.query(`DELETE FROM app.app_user WHERE id IN ($1, $2)`, [userId, verifierId]);
      await adminClient.query(`DELETE FROM app.branch WHERE id = $1`, [branchA]);
      await adminClient.query(`DELETE FROM app.organisation WHERE id = $1`, [orgId]);
    } catch {
      // Best-effort cleanup
    } finally {
      await adminClient?.end();
      await apiClient?.end();
    }
  });

  it('PG-SND-001 enforces unique (lender_case_id, version) constraint and version >= 1', async () => {
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      const sncId1 = `snc_pg_ver1_${runId}`;
      const sncId2 = `snc_pg_ver2_${runId}`;

      // Insert version 1
      await adminClient.query(
        `INSERT INTO app.sanction (
          id, tenant_id, lender_case_id, version, amount, tenure_months, rate_value, rate_type,
          sanction_date, valid_until, status, source, created_by, updated_by
        ) VALUES ($1, $2, $3, 1, 2000000, 240, 8.50, 'FLOATING', CURRENT_DATE, CURRENT_DATE + 90, 'ACTIVE', 'MANUAL', 'tester', 'tester')`,
        [sncId1, tenantA, caseId],
      );

      // Inserting duplicate version (1) for same case must fail
      await adminClient.query('SAVEPOINT sp_dup_ver');
      await expect(
        adminClient.query(
          `INSERT INTO app.sanction (
            id, tenant_id, lender_case_id, version, amount, tenure_months, rate_value, rate_type,
            sanction_date, valid_until, status, source, created_by, updated_by
          ) VALUES ($1, $2, $3, 1, 2200000, 240, 8.40, 'FLOATING', CURRENT_DATE, CURRENT_DATE + 90, 'ACTIVE', 'MANUAL', 'tester', 'tester')`,
          [sncId2, tenantA, caseId],
        ),
      ).rejects.toThrow(/unique constraint|lender_case_id.*version/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_dup_ver');

      // Inserting version = 0 must fail check (version >= 1)
      await adminClient.query('SAVEPOINT sp_zero_ver');
      await expect(
        adminClient.query(
          `INSERT INTO app.sanction (
            id, tenant_id, lender_case_id, version, amount, tenure_months, rate_value, rate_type,
            sanction_date, valid_until, status, source, created_by, updated_by
          ) VALUES ($1, $2, $3, 0, 2000000, 240, 8.50, 'FLOATING', CURRENT_DATE, CURRENT_DATE + 90, 'ACTIVE', 'MANUAL', 'tester', 'tester')`,
          [sncId2, tenantA, caseId],
        ),
      ).rejects.toThrow(/check constraint|version/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_zero_ver');
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-SND-002 enforces unique (sanction_id, tranche_no) constraint and tranche_no >= 1', async () => {
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      const sncId = `snc_pg_trn_${runId}`;
      const trnId1 = `trn_pg_t1_${runId}`;
      const trnId2 = `trn_pg_t2_${runId}`;

      // Insert parent sanction
      await adminClient.query(
        `INSERT INTO app.sanction (
          id, tenant_id, lender_case_id, version, amount, tenure_months, rate_value, rate_type,
          sanction_date, valid_until, status, source, created_by, updated_by
        ) VALUES ($1, $2, $3, 1, 2000000, 240, 8.50, 'FLOATING', CURRENT_DATE, CURRENT_DATE + 90, 'ACTIVE', 'MANUAL', 'tester', 'tester')`,
        [sncId, tenantA, caseId],
      );

      // Insert tranche 1
      await adminClient.query(
        `INSERT INTO app.disbursement_tranche (
          id, tenant_id, sanction_id, tranche_no, amount, disbursed_on, recorded_by, created_by, updated_by
        ) VALUES ($1, $2, $3, 1, 500000, CURRENT_DATE, $4, $4, $4)`,
        [trnId1, tenantA, sncId, userId],
      );

      // Duplicate tranche_no (1) must fail
      await adminClient.query('SAVEPOINT sp_dup_trn');
      await expect(
        adminClient.query(
          `INSERT INTO app.disbursement_tranche (
            id, tenant_id, sanction_id, tranche_no, amount, disbursed_on, recorded_by, created_by, updated_by
          ) VALUES ($1, $2, $3, 1, 500000, CURRENT_DATE, $4, $4, $4)`,
          [trnId2, tenantA, sncId, userId],
        ),
      ).rejects.toThrow(/unique constraint|sanction_id.*tranche_no/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_dup_trn');

      // tranche_no = 0 must fail check constraint
      await adminClient.query('SAVEPOINT sp_zero_trn');
      await expect(
        adminClient.query(
          `INSERT INTO app.disbursement_tranche (
            id, tenant_id, sanction_id, tranche_no, amount, disbursed_on, recorded_by, created_by, updated_by
          ) VALUES ($1, $2, $3, 0, 500000, CURRENT_DATE, $4, $4, $4)`,
          [trnId2, tenantA, sncId, userId],
        ),
      ).rejects.toThrow(/check constraint|tranche_no/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_zero_trn');
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-SND-003 enforces SOD-04 check constraint (verified_by <> recorded_by)', async () => {
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      const sncId = `snc_pg_sod_${runId}`;
      const trnId = `trn_pg_sod_${runId}`;

      await adminClient.query(
        `INSERT INTO app.sanction (
          id, tenant_id, lender_case_id, version, amount, tenure_months, rate_value, rate_type,
          sanction_date, valid_until, status, source, created_by, updated_by
        ) VALUES ($1, $2, $3, 1, 2000000, 240, 8.50, 'FLOATING', CURRENT_DATE, CURRENT_DATE + 90, 'ACTIVE', 'MANUAL', 'tester', 'tester')`,
        [sncId, tenantA, caseId],
      );

      // Attempting to set status = 'VERIFIED' where verified_by == recorded_by MUST FAIL SOD-04
      await adminClient.query('SAVEPOINT sp_same_user');
      await expect(
        adminClient.query(
          `INSERT INTO app.disbursement_tranche (
            id, tenant_id, sanction_id, tranche_no, amount, disbursed_on, status, recorded_by, verified_by, verified_at, created_by, updated_by
          ) VALUES ($1, $2, $3, 1, 500000, CURRENT_DATE, 'VERIFIED', $4, $4, now(), $4, $4)`,
          [trnId, tenantA, sncId, userId],
        ),
      ).rejects.toThrow(/check constraint|verified_by.*recorded_by/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_same_user');

      // Attempting to set status = 'VERIFIED' where verified_by IS NULL MUST FAIL SOD-04
      await adminClient.query('SAVEPOINT sp_null_user');
      await expect(
        adminClient.query(
          `INSERT INTO app.disbursement_tranche (
            id, tenant_id, sanction_id, tranche_no, amount, disbursed_on, status, recorded_by, verified_by, verified_at, created_by, updated_by
          ) VALUES ($1, $2, $3, 1, 500000, CURRENT_DATE, 'VERIFIED', $4, NULL, now(), $4, $4)`,
          [trnId, tenantA, sncId, userId],
        ),
      ).rejects.toThrow(/check constraint|verified_by/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_null_user');

      // When verified_by <> recorded_by, verification succeeds!
      await adminClient.query(
        `INSERT INTO app.disbursement_tranche (
          id, tenant_id, sanction_id, tranche_no, amount, disbursed_on, status, recorded_by, verified_by, verified_at, created_by, updated_by
        ) VALUES ($1, $2, $3, 1, 500000, CURRENT_DATE, 'VERIFIED', $4, $5, now(), $4, $4)`,
        [trnId, tenantA, sncId, userId, verifierId],
      );
      const res = await adminClient.query(`SELECT status, verified_by FROM app.disbursement_tranche WHERE id = $1`, [trnId]);
      expect(res.rows[0].status).toBe('VERIFIED');
      expect(res.rows[0].verified_by).toBe(verifierId);
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-SND-004 enforces VOID check constraint (voided_by and void_reason required)', async () => {
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      const sncId = `snc_pg_void_${runId}`;
      const trnId = `trn_pg_void_${runId}`;

      await adminClient.query(
        `INSERT INTO app.sanction (
          id, tenant_id, lender_case_id, version, amount, tenure_months, rate_value, rate_type,
          sanction_date, valid_until, status, source, created_by, updated_by
        ) VALUES ($1, $2, $3, 1, 2000000, 240, 8.50, 'FLOATING', CURRENT_DATE, CURRENT_DATE + 90, 'ACTIVE', 'MANUAL', 'tester', 'tester')`,
        [sncId, tenantA, caseId],
      );

      // Inserting VOIDED without void_reason must fail
      await adminClient.query('SAVEPOINT sp_no_reason');
      await expect(
        adminClient.query(
          `INSERT INTO app.disbursement_tranche (
            id, tenant_id, sanction_id, tranche_no, amount, disbursed_on, status, recorded_by, voided_by, void_reason, created_by, updated_by
          ) VALUES ($1, $2, $3, 1, 500000, CURRENT_DATE, 'VOIDED', $4, $5, NULL, $4, $4)`,
          [trnId, tenantA, sncId, userId, verifierId],
        ),
      ).rejects.toThrow(/check constraint|void_reason/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_no_reason');

      // Inserting VOIDED with both voided_by and void_reason succeeds
      await adminClient.query(
        `INSERT INTO app.disbursement_tranche (
          id, tenant_id, sanction_id, tranche_no, amount, disbursed_on, status, recorded_by, voided_by, void_reason, created_by, updated_by
        ) VALUES ($1, $2, $3, 1, 500000, CURRENT_DATE, 'VOIDED', $4, $5, 'Wrong bank account', $4, $4)`,
        [trnId, tenantA, sncId, userId, verifierId],
      );
      const res = await adminClient.query(`SELECT status, void_reason FROM app.disbursement_tranche WHERE id = $1`, [trnId]);
      expect(res.rows[0].status).toBe('VOIDED');
      expect(res.rows[0].void_reason).toBe('Wrong bank account');
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-SND-005 enforces date and amount validity constraints', async () => {
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      const sncId = `snc_pg_chk_${runId}`;

      // valid_until < sanction_date must fail
      await adminClient.query('SAVEPOINT sp_bad_date');
      await expect(
        adminClient.query(
          `INSERT INTO app.sanction (
            id, tenant_id, lender_case_id, version, amount, tenure_months, rate_value, rate_type,
            sanction_date, valid_until, status, source, created_by, updated_by
          ) VALUES ($1, $2, $3, 1, 2000000, 240, 8.50, 'FLOATING', '2026-10-15', '2026-10-10', 'ACTIVE', 'MANUAL', 'tester', 'tester')`,
          [sncId, tenantA, caseId],
        ),
      ).rejects.toThrow(/check constraint|valid_until/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_bad_date');

      // negative amount must fail
      await adminClient.query('SAVEPOINT sp_neg_amount');
      await expect(
        adminClient.query(
          `INSERT INTO app.sanction (
            id, tenant_id, lender_case_id, version, amount, tenure_months, rate_value, rate_type,
            sanction_date, valid_until, status, source, created_by, updated_by
          ) VALUES ($1, $2, $3, 1, -50000, 240, 8.50, 'FLOATING', '2026-10-15', '2026-11-15', 'ACTIVE', 'MANUAL', 'tester', 'tester')`,
          [sncId, tenantA, caseId],
        ),
      ).rejects.toThrow(/check constraint|amount/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_neg_amount');
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-SND-006 enforces Row-Level Security tenant isolation on sanction and disbursement_tranche', async () => {
    const sncId = `snc_pg_rls_${runId}`;
    const trnId = `trn_pg_rls_${runId}`;

    try {
      // Admin creates sanction and tranche under tenantA
      await adminClient.query(
        `INSERT INTO app.sanction (
          id, tenant_id, lender_case_id, version, amount, tenure_months, rate_value, rate_type,
          sanction_date, valid_until, status, source, created_by, updated_by
        ) VALUES ($1, $2, $3, 1, 2500000, 240, 8.50, 'FLOATING', CURRENT_DATE, CURRENT_DATE + 90, 'ACTIVE', 'MANUAL', 'tester', 'tester')`,
        [sncId, tenantA, caseId],
      );
      await adminClient.query(
        `INSERT INTO app.disbursement_tranche (
          id, tenant_id, sanction_id, tranche_no, amount, disbursed_on, recorded_by, created_by, updated_by
        ) VALUES ($1, $2, $3, 1, 1000000, CURRENT_DATE, $4, $4, $4)`,
        [trnId, tenantA, sncId, userId],
      );

      // Query via apiClient with tenantA context -> records MUST be visible
      await apiClient.query('BEGIN');
      try {
        await apiClient.query(`SET LOCAL app.tenant_id = '${tenantA}'`);
        await apiClient.query('SET LOCAL search_path = app, public');

        const sResA = await apiClient.query(`SELECT id FROM app.sanction WHERE id = $1`, [sncId]);
        expect(sResA.rows.length).toBe(1);
        expect(sResA.rows[0].id).toBe(sncId);

        const tResA = await apiClient.query(`SELECT id FROM app.disbursement_tranche WHERE id = $1`, [trnId]);
        expect(tResA.rows.length).toBe(1);
        expect(tResA.rows[0].id).toBe(trnId);
      } finally {
        await apiClient.query('ROLLBACK');
      }

      // Query via apiClient with tenantB context -> records MUST be invisible (RLS isolated)
      await apiClient.query('BEGIN');
      try {
        await apiClient.query(`SET LOCAL app.tenant_id = '${tenantB}'`);
        await apiClient.query('SET LOCAL search_path = app, public');

        const sResB = await apiClient.query(`SELECT id FROM app.sanction WHERE id = $1`, [sncId]);
        expect(sResB.rows.length).toBe(0);

        const tResB = await apiClient.query(`SELECT id FROM app.disbursement_tranche WHERE id = $1`, [trnId]);
        expect(tResB.rows.length).toBe(0);
      } finally {
        await apiClient.query('ROLLBACK');
      }

      // Fail-closed verification: Query without app.tenant_id must see 0 rows
      await apiClient.query('BEGIN');
      try {
        await apiClient.query('SET LOCAL search_path = app, public');
        const sResNone = await apiClient.query(`SELECT id FROM app.sanction WHERE id = $1`, [sncId]);
        expect(sResNone.rows.length).toBe(0);

        const tResNone = await apiClient.query(`SELECT id FROM app.disbursement_tranche WHERE id = $1`, [trnId]);
        expect(tResNone.rows.length).toBe(0);
      } finally {
        await apiClient.query('ROLLBACK');
      }
    } finally {
      await adminClient.query(`DELETE FROM app.disbursement_tranche WHERE id = $1`, [trnId]);
      await adminClient.query(`DELETE FROM app.sanction WHERE id = $1`, [sncId]);
    }
  });

  it('PG-SND-007 verifies void-and-replace lifecycle and replaced_by_tranche_id audit trail', async () => {
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      const sncId = `snc_pg_var_${runId}`;
      const trnId1 = `trn_pg_v1_${runId}`;
      const trnId2 = `trn_pg_v2_${runId}`;

      // Insert sanction
      await adminClient.query(
        `INSERT INTO app.sanction (
          id, tenant_id, lender_case_id, version, amount, tenure_months, rate_value, rate_type,
          sanction_date, valid_until, status, source, created_by, updated_by
        ) VALUES ($1, $2, $3, 1, 3000000, 240, 8.50, 'FLOATING', CURRENT_DATE, CURRENT_DATE + 90, 'ACTIVE', 'MANUAL', 'tester', 'tester')`,
        [sncId, tenantA, caseId],
      );

      // Insert tranche 1
      await adminClient.query(
        `INSERT INTO app.disbursement_tranche (
          id, tenant_id, sanction_id, tranche_no, amount, disbursed_on, recorded_by, created_by, updated_by
        ) VALUES ($1, $2, $3, 1, 1000000, CURRENT_DATE, $4, $4, $4)`,
        [trnId1, tenantA, sncId, userId],
      );

      // Insert tranche 2 replacing tranche 1
      await adminClient.query(
        `INSERT INTO app.disbursement_tranche (
          id, tenant_id, sanction_id, tranche_no, amount, disbursed_on, recorded_by, created_by, updated_by
        ) VALUES ($1, $2, $3, 2, 1000000, CURRENT_DATE, $4, $4, $4)`,
        [trnId2, tenantA, sncId, userId],
      );

      // Void tranche 1 with replaced_by_tranche_id
      await adminClient.query(
        `UPDATE app.disbursement_tranche
         SET status = 'VOIDED',
             voided_by = $1,
             void_reason = 'Incorrect beneficiary account details',
             replaced_by_tranche_id = $2,
             updated_by = $1
         WHERE id = $3`,
        [verifierId, trnId2, trnId1],
      );

      const res = await adminClient.query(
        `SELECT status, void_reason, replaced_by_tranche_id FROM app.disbursement_tranche WHERE id = $1`,
        [trnId1],
      );
      expect(res.rows[0].status).toBe('VOIDED');
      expect(res.rows[0].void_reason).toBe('Incorrect beneficiary account details');
      expect(res.rows[0].replaced_by_tranche_id).toBe(trnId2);
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });
});
