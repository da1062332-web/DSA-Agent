import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import pg from 'pg';
import { requireLocalTestDatabaseUrl } from './support/test-db-url';

describe('Module 7 — Leads PostgreSQL Integration (Real Database & RLS)', () => {
  const connectionString =
    requireLocalTestDatabaseUrl('VERIFY_DATABASE_URL');

  const tenantA = 'ten_01JTESTTENANT00000000000000';
  const tenantB = 'ten_01JOTHERTENANT0000000000000';
  const branchA = 'br_01JMUMBAI000000000000000000';
  const ownerUserA = 'usr_01JTESTUSER0000000000000000';

  let adminClient: pg.Client;
  let apiClient: pg.Client;

  beforeAll(async () => {
    adminClient = new pg.Client({ connectionString });
    await adminClient.connect();

    // App client connecting as dsa_api via DATABASE_URL
    const apiDbUrl =
      requireLocalTestDatabaseUrl('DATABASE_URL');
    apiClient = new pg.Client({ connectionString: apiDbUrl });
    await apiClient.connect();
  });

  afterAll(async () => {
    await adminClient?.end();
    await apiClient?.end();
  });

  it('PG-LEAD-001 enforces E.164 phone format database check constraint', async () => {
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      const testId = `lead_test_err_${Date.now()}`;
      
      // Attempt inserting invalid phone format (missing + or non-numeric)
      await expect(
        adminClient.query(
          `INSERT INTO app.lead (
            id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash,
            product_category, state, owner_user_id, source, lock_version,
            created_at, created_by, updated_at, updated_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), 'tester', now(), 'tester')`,
          [
            testId,
            tenantA,
            branchA,
            'Invalid Phone Customer',
            '9876543210', // Invalid: missing + prefix required by E.164 constraint
            Buffer.from('hash'),
            'PL',
            'NEW',
            ownerUserA,
            'WALK_IN',
            0,
          ],
        ),
      ).rejects.toThrow(/mobile_e164/i);
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-LEAD-002 enforces owner invariant BR-DOM-003 on lead table', async () => {
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      const testId = `lead_test_owner_${Date.now()}`;

      // Attempt inserting a NEW lead with NULL owner_user_id and NULL owner_queue_id
      await expect(
        adminClient.query(
          `INSERT INTO app.lead (
            id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash,
            product_category, state, owner_user_id, owner_queue_id, source, lock_version,
            created_at, created_by, updated_at, updated_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, NULL, $9, $10, now(), 'tester', now(), 'tester')`,
          [
            testId,
            tenantA,
            branchA,
            'No Owner Customer',
            '+919876543210',
            Buffer.from('hash'),
            'PL',
            'NEW',
            'WALK_IN',
            0,
          ],
        ),
      ).rejects.toThrow(/owner_present/i);
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-LEAD-003 forbids UPDATE and DELETE on lead_status_history via triggers', async () => {
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      const leadId = `lead_trig_${Date.now()}`;
      const historyId = `lsh_trig_${Date.now()}`;

      // Insert test lead and status history record
      await adminClient.query(
        `INSERT INTO app.lead (
          id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash,
          product_category, state, owner_user_id, source, lock_version,
          created_at, created_by, updated_at, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), 'tester', now(), 'tester')`,
        [
          leadId,
          tenantA,
          branchA,
          'Trigger Test',
          '+919876543210',
          Buffer.from('hash'),
          'PL',
          'NEW',
          ownerUserA,
          'WALK_IN',
          0,
        ],
      );

      await adminClient.query(
        `INSERT INTO app.lead_status_history (
          id, tenant_id, lead_id, from_state, to_state, transition_code, actor, occurred_at
        ) VALUES ($1, $2, $3, NULL, 'NEW', 'CREATE', 'tester', now())`,
        [historyId, tenantA, leadId],
      );

      // Attempting UPDATE on lead_status_history must fail
      await adminClient.query('SAVEPOINT sp1');
      await expect(
        adminClient.query(`UPDATE app.lead_status_history SET to_state = 'IN_PROGRESS' WHERE id = $1`, [historyId]),
      ).rejects.toThrow(/append-only/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp1');

      // Attempting DELETE on lead_status_history must fail
      await adminClient.query('SAVEPOINT sp2');
      await expect(
        adminClient.query(`DELETE FROM app.lead_status_history WHERE id = $1`, [historyId]),
      ).rejects.toThrow(/append-only/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp2');
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-LEAD-004 enforces Row-Level Security tenant isolation on lead table', async () => {
    // 1. Insert a lead for tenantA using adminClient
    const leadId = `lead_rls_${Date.now()}`;
    await adminClient.query(
      `INSERT INTO app.lead (
        id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash,
        product_category, state, owner_user_id, source, lock_version,
        created_at, created_by, updated_at, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), 'tester', now(), 'tester')`,
      [
        leadId,
        tenantA,
        branchA,
        'RLS Test Customer',
        '+919876543210',
        Buffer.from('hash'),
        'PL',
        'NEW',
        ownerUserA,
        'WALK_IN',
        0,
      ],
    );

    try {
      // 2. Querying with apiClient (dsa_api) setting app.tenant_id = tenantA must see the lead
      await apiClient.query('BEGIN');
      await apiClient.query(`SET LOCAL app.tenant_id = '${tenantA}'`);
      await apiClient.query('SET LOCAL search_path = app, public');
      const resTenantA = await apiClient.query(`SELECT id FROM app.lead WHERE id = $1`, [leadId]);
      expect(resTenantA.rows.length).toBe(1);
      expect(resTenantA.rows[0].id).toBe(leadId);
      await apiClient.query('ROLLBACK');

      // 3. Querying with apiClient (dsa_api) setting app.tenant_id = tenantB must see 0 rows
      await apiClient.query('BEGIN');
      await apiClient.query(`SET LOCAL app.tenant_id = '${tenantB}'`);
      await apiClient.query('SET LOCAL search_path = app, public');
      const resTenantB = await apiClient.query(`SELECT id FROM app.lead WHERE id = $1`, [leadId]);
      expect(resTenantB.rows.length).toBe(0); // Tenant isolation verified!
      await apiClient.query('ROLLBACK');

      // 4. Querying without app.tenant_id (fail-closed) must see 0 rows
      await apiClient.query('BEGIN');
      await apiClient.query('SET LOCAL search_path = app, public');
      const resNoTenant = await apiClient.query(`SELECT id FROM app.lead WHERE id = $1`, [leadId]);
      expect(resNoTenant.rows.length).toBe(0); // Fail-closed verified!
      await apiClient.query('ROLLBACK');
    } finally {
      // Cleanup inserted test lead
      await adminClient.query(`DELETE FROM app.lead WHERE id = $1`, [leadId]);
    }
  });

  it('PG-LEAD-005 verifies complete PostgreSQL transaction rollback on conversion failure', async () => {
    const leadId = `lead_conv_rb_${Date.now()}`;
    const custId = `cust_conv_rb_${Date.now()}`;
    const appId = `app_conv_rb_${Date.now()}`;

    // Seed qualified lead
    await adminClient.query(
      `INSERT INTO app.lead (
        id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash,
        product_category, state, owner_user_id, source, lock_version,
        qual_applicant_type, qual_requested_amount,
        created_at, created_by, updated_at, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'QUALIFIED', $8, $9, 0, 'SALARIED', 500000.00, now(), 'tester', now(), 'tester')`,
      [leadId, tenantA, branchA, 'Rollback Test', '+919876543210', Buffer.from('hash'), 'PL', ownerUserA, 'WALK_IN'],
    );

    // Simulate multi-table atomic conversion in transaction that fails midway
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');

      // Step 1: Insert Customer
      await adminClient.query(
        `INSERT INTO app.customer (id, tenant_id, party_type, full_name, home_branch_id, status, lock_version, created_at, created_by, updated_at, updated_by)
         VALUES ($1, $2, 'INDIVIDUAL', 'Rollback Test', $3, 'ACTIVE', 0, now(), 'tester', now(), 'tester')`,
        [custId, tenantA, branchA],
      );

      // Step 2: Insert Application
      await adminClient.query(
        `INSERT INTO app.loan_application (id, tenant_id, branch_id, customer_id, lead_id, product_category, requested_amount, currency, status, sales_owner_id, lock_version, created_at, created_by, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, $5, 'PL', 500000.00, 'INR', 'DRAFT', ownerUserA, 0, now(), 'tester', now(), 'tester')`,
        [appId, tenantA, branchA, custId, leadId],
      );

      // Step 3: Failure injected!
      throw new Error('Simulated failure during atomic conversion transaction');
    } catch {
      await adminClient.query('ROLLBACK');
    }

    // Verify after rollback: customer must NOT exist
    const custCheck = await adminClient.query(`SELECT id FROM app.customer WHERE id = $1`, [custId]);
    expect(custCheck.rows.length).toBe(0);

    // Application must NOT exist
    const appCheck = await adminClient.query(`SELECT id FROM app.loan_application WHERE id = $1`, [appId]);
    expect(appCheck.rows.length).toBe(0);

    // Lead must remain in original QUALIFIED state
    const leadCheck = await adminClient.query(`SELECT state FROM app.lead WHERE id = $1`, [leadId]);
    expect(leadCheck.rows[0].state).toBe('QUALIFIED');

    // Clean up
    await adminClient.query(`DELETE FROM app.lead WHERE id = $1`, [leadId]);
  });
});
