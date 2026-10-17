// apps/api/test/targets.pg.int.spec.ts — owner: Dev 5 (MOD-PERF Targets Live PostgreSQL Integration Tests)
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('Module 20 — Performance Targets PostgreSQL Integration (Real Database & Constraints)', () => {
  const connectionString =
    process.env.VERIFY_DATABASE_URL ||
    'postgresql://postgres.mlpkwwhnagxzinaohdxg:Qloax%40DSA%2312@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';

  const tenantA = 'ten_01JTESTTENANT00000000000000';
  const tenantB = 'ten_demo_01';

  let adminClient: pg.Client;
  let apiClient: pg.Client;

  // Test fixture IDs
  const runId = Date.now().toString(36);
  const orgId = `org_trg_pg_${runId}`;
  const branchId = `br_trg_pg_${runId}`;
  const creatorId = `usr_trg_cr_${runId}`;
  const approverId = `usr_trg_ap_${runId}`;
  const targetId1 = `trg_01JTESTTARGET00000000001_${runId}`;
  const targetId2 = `trg_01JTESTTARGET00000000002_${runId}`;

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
       VALUES ($1, $2, 'Target Test Org', 'DSA_ORG', 'ACTIVE', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [tenantA, `tenant-trg-${runId}`],
    );

    // Ensure organisation
    await adminClient.query(
      `INSERT INTO app.organisation (id, tenant_id, legal_name, constitution, status, created_by, updated_by)
       VALUES ($1, $2, 'TRG Test Org', 'PVT_LTD', 'ACTIVE', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [orgId, tenantA],
    );

    // Ensure branch
    await adminClient.query(
      `INSERT INTO app.branch (id, tenant_id, organisation_id, code, name, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'Target Pune Branch', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [branchId, tenantA, orgId, `PUN_${runId.toUpperCase()}`.slice(0, 20)],
    );

    // Ensure users
    await adminClient.query(
      `INSERT INTO app.app_user (id, tenant_id, idp_subject, primary_branch_id, email, display_name, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, 'Target Creator', 'ACTIVE', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [creatorId, tenantA, `idp_${creatorId}`, branchId, `creator_${runId}@example.com`],
    );

    await adminClient.query(
      `INSERT INTO app.app_user (id, tenant_id, idp_subject, primary_branch_id, email, display_name, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, 'Target Approver', 'ACTIVE', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [approverId, tenantA, `idp_${approverId}`, branchId, `approver_${runId}@example.com`],
    );
  });

  afterAll(async () => {
    // Cleanup test data
    if (adminClient) {
      await adminClient.query(
        `DELETE FROM app.target WHERE tenant_id = $1 AND (created_by = $2 OR approved_by = $3)`,
        [tenantA, creatorId, approverId],
      );
      await adminClient.query(`DELETE FROM app.app_user WHERE tenant_id = $1 AND id IN ($2, $3)`, [
        tenantA,
        creatorId,
        approverId,
      ]);
      await adminClient.query(`DELETE FROM app.branch WHERE tenant_id = $1 AND id = $2`, [tenantA, branchId]);
      await adminClient.query(`DELETE FROM app.organisation WHERE tenant_id = $1 AND id = $2`, [
        tenantA,
        orgId,
      ]);
      await adminClient.end();
    }
    if (apiClient) {
      await apiClient.end();
    }
  });

  it('enforces RLS: fail-closed without app.tenant_id context', async () => {
    // apiClient connects as dsa_api with RLS enabled
    await apiClient.query('RESET ALL');
    const res = await apiClient.query('SELECT count(*) FROM app.target');
    expect(Number(res.rows[0].count)).toBe(0);
  });

  it('enforces SOD-04 dual-control database constraint: approved_by <> created_by', async () => {
    await apiClient.query('BEGIN');
    await apiClient.query(`SET LOCAL app.tenant_id = '${tenantA}'`);

    let error: any = null;
    try {
      await apiClient.query(
        `INSERT INTO app.target (
          id, tenant_id, period, dimension_type, dimension_id, metric_code,
          target_value, unit, version, status, lock_version,
          created_by, updated_by, approved_by, approved_at
        ) VALUES (
          $1, $2, '2026-10', 'BRANCH', $3, 'DISBURSEMENT_AMOUNT',
          5000000, 'INR', 1, 'APPROVED', 0,
          $4, $4, $4, now() -- approved_by == created_by (SOD-04 violation)
        )`,
        [targetId1, tenantA, branchId, creatorId],
      );
    } catch (err: any) {
      error = err;
    } finally {
      await apiClient.query('ROLLBACK');
    }

    expect(error).not.toBeNull();
    expect(error.message).toMatch(/target_check|violates check constraint/i);
  });

  it('allows approval by separate user and records target', async () => {
    await apiClient.query('BEGIN');
    await apiClient.query(`SET LOCAL app.tenant_id = '${tenantA}'`);

    // Insert as PENDING_APPROVAL by creatorId
    await apiClient.query(
      `INSERT INTO app.target (
        id, tenant_id, period, dimension_type, dimension_id, metric_code,
        target_value, unit, version, status, lock_version,
        created_by, updated_by
      ) VALUES (
        $1, $2, '2026-10', 'BRANCH', $3, 'DISBURSEMENT_AMOUNT',
        5000000, 'INR', 1, 'PENDING_APPROVAL', 0,
        $4, $4
      )`,
      [targetId1, tenantA, branchId, creatorId],
    );

    // Approve as approverId
    const updateRes = await apiClient.query(
      `UPDATE app.target
       SET status = 'APPROVED',
           approved_by = $3,
           approved_at = now(),
           updated_by = $3,
           lock_version = lock_version + 1
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantA, targetId1, approverId],
    );

    expect(updateRes.rows).toHaveLength(1);
    expect(updateRes.rows[0].status).toBe('APPROVED');
    expect(updateRes.rows[0].approved_by).toBe(approverId);
    expect(updateRes.rows[0].lock_version).toBe(1);

    await apiClient.query('COMMIT');
  });

  it('enforces partial unique index: at most one APPROVED target per slice', async () => {
    await apiClient.query('BEGIN');
    await apiClient.query(`SET LOCAL app.tenant_id = '${tenantA}'`);

    let error: any = null;
    try {
      // Attempt to insert another APPROVED target for the same slice
      await apiClient.query(
        `INSERT INTO app.target (
          id, tenant_id, period, dimension_type, dimension_id, metric_code,
          target_value, unit, version, status, lock_version,
          created_by, updated_by, approved_by, approved_at
        ) VALUES (
          $1, $2, '2026-10', 'BRANCH', $3, 'DISBURSEMENT_AMOUNT',
          6000000, 'INR', 2, 'APPROVED', 0,
          $4, $5, $5, now()
        )`,
        [targetId2, tenantA, branchId, creatorId, approverId],
      );
    } catch (err: any) {
      error = err;
    } finally {
      await apiClient.query('ROLLBACK');
    }

    expect(error).not.toBeNull();
    expect(error.message).toMatch(/target_current_approved_idx|unique constraint/i);
  });

  it('enforces metric code and unit consistency check constraint', async () => {
    await apiClient.query('BEGIN');
    await apiClient.query(`SET LOCAL app.tenant_id = '${tenantA}'`);

    let error: any = null;
    try {
      // Attempt to insert DISBURSEMENT_AMOUNT with unit 'COUNT'
      await apiClient.query(
        `INSERT INTO app.target (
          id, tenant_id, period, dimension_type, dimension_id, metric_code,
          target_value, unit, version, status, lock_version,
          created_by, updated_by
        ) VALUES (
          $1, $2, '2026-10', 'BRANCH', $3, 'DISBURSEMENT_AMOUNT',
          100, 'COUNT', 2, 'PENDING_APPROVAL', 0,
          $4, $4
        )`,
        [`trg_bad_unit_${runId}`, tenantA, branchId, creatorId],
      );
    } catch (err: any) {
      error = err;
    } finally {
      await apiClient.query('ROLLBACK');
    }

    expect(error).not.toBeNull();
    expect(error.message).toMatch(/check constraint/i);
  });

  it('enforces tenant isolation under RLS', async () => {
    // Switch to tenantB context
    await apiClient.query('BEGIN');
    await apiClient.query(`SET LOCAL app.tenant_id = '${tenantB}'`);

    // Query for target created in tenantA
    const res = await apiClient.query('SELECT * FROM app.target WHERE id = $1', [targetId1]);
    expect(res.rows).toHaveLength(0);

    await apiClient.query('ROLLBACK');
  });
});
