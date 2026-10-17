// apps/api/test/customers.pg.spec.ts — owner: Dev 5 (MOD-CUST PostgreSQL Integration & RLS)
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('Module 8 — Customers PostgreSQL Integration (Real Database & RLS)', () => {
  const connectionString =
    process.env.VERIFY_DATABASE_URL ||
    'postgresql://postgres.mlpkwwhnagxzinaohdxg:Qloax%40DSA%2312@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';

  const tenantA = 'ten_01JTESTTENANT00000000000000';
  const tenantB = 'ten_demo_01';
  const branchA = 'br_01JMUMBAI000000000000000000';
  const branchB = 'br_demo_01';

  let adminClient: pg.Client;
  let apiClient: pg.Client;

  beforeAll(async () => {
    adminClient = new pg.Client({ connectionString });
    await adminClient.connect();

    // App client connecting as dsa_api via DATABASE_URL
    const apiDbUrl =
      process.env.DATABASE_URL ||
      'postgresql://dsa_api.mlpkwwhnagxzinaohdxg:Qloax%40DSA%2312@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';
    apiClient = new pg.Client({ connectionString: apiDbUrl });
    await apiClient.connect();
  });

  afterAll(async () => {
    await adminClient?.end();
    await apiClient?.end();
  });

  it('PG-CUST-001 enforces party_type and full_name check constraints on customer table', async () => {
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      const testId = `cust_test_err_${Date.now()}`;

      // 1. Invalid party_type
      await adminClient.query('SAVEPOINT sp_pt');
      await expect(
        adminClient.query(
          `INSERT INTO app.customer (
            id, tenant_id, party_type, full_name, home_branch_id, status,
            lock_version, created_at, created_by, updated_at, updated_by
          ) VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 0, now(), 'tester', now(), 'tester')`,
          [testId, tenantA, 'ALIEN_TYPE', 'Valid Name', branchA],
        ),
      ).rejects.toThrow(/party_type/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_pt');

      // 2. Full name too short (< 2 chars)
      await adminClient.query('SAVEPOINT sp_fn');
      await expect(
        adminClient.query(
          `INSERT INTO app.customer (
            id, tenant_id, party_type, full_name, home_branch_id, status,
            lock_version, created_at, created_by, updated_at, updated_by
          ) VALUES ($1, $2, 'INDIVIDUAL', $3, $4, 'ACTIVE', 0, now(), 'tester', now(), 'tester')`,
          [testId, tenantA, 'A', branchA],
        ),
      ).rejects.toThrow(/full_name/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_fn');
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-CUST-002 enforces home_branch foreign key constraints on customer table', async () => {
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      const testId = `cust_test_fk_${Date.now()}`;

      // Invalid branch ID
      await expect(
        adminClient.query(
          `INSERT INTO app.customer (
            id, tenant_id, party_type, full_name, home_branch_id, status,
            lock_version, created_at, created_by, updated_at, updated_by
          ) VALUES ($1, $2, 'INDIVIDUAL', 'Test Customer', 'br_NONEXISTENT_BRANCH', 'ACTIVE', 0, now(), 'tester', now(), 'tester')`,
          [testId, tenantA],
        ),
      ).rejects.toThrow(/customer_tenant_id_home_branch_id_fkey|foreign key/i);
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-CUST-003 enforces unique constraint on customer_contact_point hash', async () => {
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      const custId = `cust_test_cp_${Date.now()}`;
      const cpId1 = `ccp_test_1_${Date.now()}`;
      const cpId2 = `ccp_test_2_${Date.now()}`;
      const hash = Buffer.from('test_hash_unique');

      // Create customer
      await adminClient.query(
        `INSERT INTO app.customer (
          id, tenant_id, party_type, full_name, home_branch_id, status,
          lock_version, created_at, created_by, updated_at, updated_by
        ) VALUES ($1, $2, 'INDIVIDUAL', 'Contact Test Customer', $3, 'ACTIVE', 0, now(), 'tester', now(), 'tester')`,
        [custId, tenantA, branchA],
      );

      // Insert first contact point
      await adminClient.query(
        `INSERT INTO app.customer_contact_point (
          id, tenant_id, customer_id, kind, value, value_hash, is_primary, created_at, created_by
        ) VALUES ($1, $2, $3, 'MOBILE', '+919876543210', $4, true, now(), 'tester')`,
        [cpId1, tenantA, custId, hash],
      );

      // Attempt duplicate contact point with same (tenant_id, customer_id, kind, value_hash)
      await expect(
        adminClient.query(
          `INSERT INTO app.customer_contact_point (
            id, tenant_id, customer_id, kind, value, value_hash, is_primary, created_at, created_by
          ) VALUES ($1, $2, $3, 'MOBILE', '+919876543210', $4, false, now(), 'tester')`,
          [cpId2, tenantA, custId, hash],
        ),
      ).rejects.toThrow(/unique|duplicate key/i);
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-CUST-004 enforces consent_only_withdraw trigger and forbids illegal mutation or deletion', async () => {
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      const consentId = `cnst_test_guard_${Date.now()}`;

      // Insert active consent
      await adminClient.query(
        `INSERT INTO app.consent_record (
          id, tenant_id, subject_type, subject_id, purpose, notice_version,
          channel, captured_by, captured_at, status
        ) VALUES ($1, $2, 'CUSTOMER', 'cust_001', 'CONTACT', 'NV-2026.1', 'WEB_FORM', 'tester', now(), 'ACTIVE')`,
        [consentId, tenantA],
      );

      // Attempt direct DELETE -> blocked by consent_record_no_delete trigger
      await adminClient.query('SAVEPOINT sp_del');
      await expect(
        adminClient.query(`DELETE FROM app.consent_record WHERE id = $1`, [consentId]),
      ).rejects.toThrow(/append-only|DELETE rejected|forbid_mutation/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_del');

      // Attempt illegal status update (e.g. status = 'EXPIRED') -> blocked by consent_only_withdraw trigger
      await adminClient.query('SAVEPOINT sp_exp');
      await expect(
        adminClient.query(`UPDATE app.consent_record SET status = 'EXPIRED' WHERE id = $1`, [consentId]),
      ).rejects.toThrow(/may only move ACTIVE -> WITHDRAWN/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_exp');

      // Valid transition ACTIVE -> WITHDRAWN with withdrawn_at succeeds
      const withdrawRes = await adminClient.query(
        `UPDATE app.consent_record
         SET status = 'WITHDRAWN', withdrawn_at = now(), withdrawn_by = 'tester', withdrawal_reason = 'Opted out'
         WHERE id = $1
         RETURNING status`,
        [consentId],
      );
      expect(withdrawRes.rows[0].status).toBe('WITHDRAWN');
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-CUST-005 enforces PostgreSQL Row-Level Security (RLS) tenant isolation on customer', async () => {
    const custA = `cust_rls_a_${Date.now()}`;
    const custB = `cust_rls_b_${Date.now()}`;

    // Seed rows under Tenant A and Tenant B using admin
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      await adminClient.query(
        `INSERT INTO app.customer (id, tenant_id, party_type, full_name, home_branch_id, status, lock_version, created_at, created_by, updated_at, updated_by)
         VALUES ($1, $2, 'INDIVIDUAL', 'Customer Tenant A', $3, 'ACTIVE', 0, now(), 'admin', now(), 'admin')`,
        [custA, tenantA, branchA],
      );
      await adminClient.query(
        `INSERT INTO app.customer (id, tenant_id, party_type, full_name, home_branch_id, status, lock_version, created_at, created_by, updated_at, updated_by)
         VALUES ($1, $2, 'INDIVIDUAL', 'Customer Tenant B', $3, 'ACTIVE', 0, now(), 'admin', now(), 'admin')`,
        [custB, tenantB, branchB],
      );
      await adminClient.query('COMMIT');
    } catch (e) {
      await adminClient.query('ROLLBACK');
      throw e;
    }

    try {
      // Query as dsa_api with tenant context set to Tenant A
      await apiClient.query('BEGIN');
      await apiClient.query('SET LOCAL search_path = app, public');
      await apiClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);

      const selectA = await apiClient.query(`SELECT id, tenant_id FROM app.customer WHERE id IN ($1, $2)`, [
        custA,
        custB,
      ]);

      // RLS must return ONLY Tenant A's customer; Tenant B's customer must be invisible
      expect(selectA.rows.length).toBe(1);
      expect(selectA.rows[0].id).toBe(custA);
      expect(selectA.rows[0].tenant_id).toBe(tenantA);

      // Attempting to select Tenant B's customer directly returns 0 rows
      const directB = await apiClient.query(`SELECT id FROM app.customer WHERE id = $1`, [custB]);
      expect(directB.rows.length).toBe(0);

      await apiClient.query('ROLLBACK');

      // Fail-closed verification: Query without app.tenant_id must see 0 rows
      await apiClient.query('BEGIN');
      await apiClient.query('SET LOCAL search_path = app, public');
      const noTenant = await apiClient.query(`SELECT id FROM app.customer WHERE id IN ($1, $2)`, [
        custA,
        custB,
      ]);
      expect(noTenant.rows.length).toBe(0);
      await apiClient.query('ROLLBACK');
    } finally {
      // Clean up test rows
      await adminClient.query(`DELETE FROM app.customer WHERE id IN ($1, $2)`, [custA, custB]);
    }
  });
});
