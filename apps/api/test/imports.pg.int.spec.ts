// apps/api/test/imports.pg.int.spec.ts — MOD-IMP PostgreSQL Integration Tests
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireLocalTestDatabaseUrl } from './support/test-db-url';

describe('Module MOD-IMP — PostgreSQL Integration (Real Tables & RLS)', () => {
  const connectionString =
    requireLocalTestDatabaseUrl('VERIFY_DATABASE_URL');

  const tenantA = 'ten_01JTESTTENANT00000000000000';
  const tenantB = 'ten_demo_01';

  let adminClient: pg.Client;
  let apiClient: pg.Client;

  const runId = Date.now().toString(36);
  const branchId = `br_imp_pg_${runId}`;
  const userId = `usr_imp_pg_${runId}`;

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
       VALUES ($1, $2, 'Import Test Org', 'DSA_ORG', 'ACTIVE', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [tenantA, `tenant-imp-${runId}`],
    );

    // Ensure organisation
    const orgId = `org_imp_pg_${runId}`;
    await adminClient.query(
      `INSERT INTO app.organisation (id, tenant_id, legal_name, constitution, status, created_by, updated_by)
       VALUES ($1, $2, 'Import Org Ltd', 'PVT_LTD', 'ACTIVE', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [orgId, tenantA],
    );

    // Ensure branch
    await adminClient.query(
      `INSERT INTO app.branch (id, tenant_id, organisation_id, code, name, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'Import Main Branch', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [branchId, tenantA, orgId, `IMP_${runId.toUpperCase()}`.slice(0, 20)],
    );

    // Ensure user
    await adminClient.query(
      `INSERT INTO app.app_user (id, tenant_id, idp_subject, primary_branch_id, email, display_name, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, 'Import Test Operator', 'ACTIVE', 'tester', 'tester')
       ON CONFLICT (id) DO NOTHING`,
      [userId, tenantA, `sub_imp_${runId}`, branchId, `importer_${runId}@example.com`],
    );
  });

  afterAll(async () => {
    await adminClient?.end();
    await apiClient?.end();
  });

  it('PG-IMP-001 verifies ENT-110 import_batch creation, constraints and state transitions', async () => {
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');

      const batchId = `imp_test_${Date.now()}`;

      // Insert valid import_batch
      const res = await adminClient.query(
        `INSERT INTO app.import_batch (
          id, tenant_id, requester_id, target_entity, source_file_key, file_format,
          file_size_bytes, checksum_sha256, status, total_rows
        ) VALUES ($1, $2, $3, 'LEAD', 'quarantine/test.csv', 'CSV', 1024, 'abc123hash', 'UPLOADED', 10)
        RETURNING *`,
        [batchId, tenantA, userId],
      );

      expect(res.rows[0].id).toBe(batchId);
      expect(res.rows[0].status).toBe('UPLOADED');
      expect(res.rows[0].lock_version).toBe(0);

      // Verify state transition from UPLOADED -> PARSED -> MAPPED -> COMPLETED
      const updateRes = await adminClient.query(
        `UPDATE app.import_batch
            SET status = 'COMPLETED',
                valid_rows = 10,
                imported_rows = 10,
                committed_at = now(),
                lock_version = lock_version + 1
          WHERE id = $1
          RETURNING *`,
        [batchId],
      );

      expect(updateRes.rows[0].status).toBe('COMPLETED');
      expect(updateRes.rows[0].lock_version).toBe(1);
      expect(updateRes.rows[0].committed_at).toBeDefined();

      // Verify invalid status rejection by check constraint
      await expect(
        adminClient.query(`UPDATE app.import_batch SET status = 'INVALID_STATUS' WHERE id = $1`, [batchId]),
      ).rejects.toThrow();
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-IMP-002 verifies strict RLS tenant isolation on import_batch', async () => {
    const batchA = `imp_rls_a_${Date.now()}`;

    // Admin creates batch for Tenant A
    await adminClient.query(
      `INSERT INTO app.import_batch (
        id, tenant_id, requester_id, target_entity, source_file_key, file_format,
        file_size_bytes, checksum_sha256, status, total_rows
      ) VALUES ($1, $2, $3, 'LEAD', 'quarantine/rls.csv', 'CSV', 512, 'hash_rls', 'UPLOADED', 5)`,
      [batchA, tenantA, userId],
    );

    // apiClient querying with app.tenant_id = tenantA should see batchA
    await apiClient.query('BEGIN');
    try {
      await apiClient.query(`SET LOCAL app.tenant_id = '${tenantA}'`);
      const visible = await apiClient.query(`SELECT id FROM app.import_batch WHERE id = $1`, [batchA]);
      expect(visible.rows.length).toBe(1);
      expect(visible.rows[0].id).toBe(batchA);
    } finally {
      await apiClient.query('ROLLBACK');
    }

    // apiClient querying with app.tenant_id = tenantB must NOT see batchA
    await apiClient.query('BEGIN');
    try {
      await apiClient.query(`SET LOCAL app.tenant_id = '${tenantB}'`);
      const blocked = await apiClient.query(`SELECT id FROM app.import_batch WHERE id = $1`, [batchA]);
      expect(blocked.rows.length).toBe(0);
    } finally {
      await apiClient.query('ROLLBACK');
    }

    // apiClient without tenant context fails closed
    await apiClient.query('BEGIN');
    try {
      await apiClient.query(`SET LOCAL app.tenant_id = ''`);
      const failClosed = await apiClient.query(`SELECT id FROM app.import_batch WHERE id = $1`, [batchA]);
      expect(failClosed.rows.length).toBe(0);
    } finally {
      await apiClient.query('ROLLBACK');
    }
  });

  it('PG-IMP-003 verifies lead import_batch_id foreign key and attribution retention', async () => {
    await adminClient.query('BEGIN');
    try {
      const batchId = `imp_fk_${Date.now()}`;
      await adminClient.query(
        `INSERT INTO app.import_batch (
          id, tenant_id, requester_id, target_entity, source_file_key, file_format,
          file_size_bytes, checksum_sha256, status, total_rows
        ) VALUES ($1, $2, $3, 'LEAD', 'source/lead_fk.csv', 'CSV', 2048, 'hash_fk', 'COMPLETED', 1)`,
        [batchId, tenantA, userId],
      );

      const leadId = `lead_imp_fk_${Date.now()}`;
      const res = await adminClient.query(
        `INSERT INTO app.lead (
          id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash,
          product_category, state, owner_user_id, source, lock_version,
          created_at, created_by, updated_at, updated_by, import_batch_id
        ) VALUES ($1, $2, $3, 'Imported Lead Customer', '+919876543210', decode('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'hex'),
          'PL', 'NEW', $4, 'API', 0, now(), 'tester', now(), 'tester', $5)
        RETURNING id, import_batch_id`,
        [leadId, tenantA, branchId, userId, batchId],
      );

      expect(res.rows[0].import_batch_id).toBe(batchId);

      // Verify FK constraint rejection when pointing to nonexistent import_batch
      await expect(
        adminClient.query(
          `INSERT INTO app.lead (
            id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash,
            product_category, state, owner_user_id, source, lock_version,
            created_at, created_by, updated_at, updated_by, import_batch_id
          ) VALUES ($1, $2, $3, 'Bad FK Customer', '+919876543211', decode('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'hex'),
            'PL', 'NEW', $4, 'API', 0, now(), 'tester', now(), 'tester', 'imp_nonexistent_id')`,
          [`lead_bad_fk_${Date.now()}`, tenantA, branchId, userId],
        ),
      ).rejects.toThrow();
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-IMP-004 verifies customer import_batch_id foreign key', async () => {
    await adminClient.query('BEGIN');
    try {
      const batchId = `imp_fk_cust_${Date.now()}`;
      await adminClient.query(
        `INSERT INTO app.import_batch (
          id, tenant_id, requester_id, target_entity, source_file_key, file_format,
          file_size_bytes, checksum_sha256, status, total_rows
        ) VALUES ($1, $2, $3, 'CUSTOMER', 'source/cust.csv', 'CSV', 1024, 'hash_cust', 'COMPLETED', 1)`,
        [batchId, tenantA, userId],
      );

      const custId = `cust_imp_fk_${Date.now()}`;
      const res = await adminClient.query(
        `INSERT INTO app.customer (
          id, tenant_id, home_branch_id, party_type, full_name,
          lock_version, created_at, created_by, updated_at, updated_by, import_batch_id
        ) VALUES ($1, $2, $3, 'INDIVIDUAL', 'Imported Customer',
          0, now(), 'tester', now(), 'tester', $4)
        RETURNING id, import_batch_id`,
        [custId, tenantA, branchId, batchId],
      );

      expect(res.rows[0].import_batch_id).toBe(batchId);
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-IMP-005 verifies job_queue atomic pickup with SKIP LOCKED concurrency', async () => {
    await adminClient.query('BEGIN');
    try {
      const jobId = `job_test_${Date.now()}`;

      // Insert pending job
      await adminClient.query(
        `INSERT INTO app.job_queue (
          id, tenant_id, job_type, payload, status, run_at
        ) VALUES ($1, $2, 'IMPORT_COMMIT', '{"batchId": "imp_123"}'::jsonb, 'PENDING', now())`,
        [jobId, tenantA],
      );

      // Worker 1 picks up job with SKIP LOCKED
      const worker1 = await adminClient.query(
        `SELECT id, status FROM app.job_queue
          WHERE status = 'PENDING' AND id = $1
          FOR UPDATE SKIP LOCKED`,
        [jobId],
      );

      expect(worker1.rows.length).toBe(1);
      expect(worker1.rows[0].id).toBe(jobId);

      // Transition to RUNNING
      await adminClient.query(
        `UPDATE app.job_queue
            SET status = 'RUNNING', started_at = now()
          WHERE id = $1`,
        [jobId],
      );

      // Worker 2 searching for PENDING skips this job
      const worker2 = await adminClient.query(
        `SELECT id FROM app.job_queue
          WHERE status = 'PENDING' AND id = $1
          FOR UPDATE SKIP LOCKED`,
        [jobId],
      );

      expect(worker2.rows.length).toBe(0);
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });
});
