// apps/api/test/tasks.pg.spec.ts — owner: Dev 6 (MOD-TASK PostgreSQL Integration & RLS)
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('Module 9 — Tasks PostgreSQL Integration (Real Database & RLS)', () => {
  const connectionString =
    process.env.VERIFY_DATABASE_URL ||
    'postgresql://postgres.mlpkwwhnagxzinaohdxg:Qloax%40DSA%2312@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';

  const tenantA = 'ten_01JTESTTENANT00000000000000';
  const tenantB = 'ten_demo_01';
  const branchA = 'br_01JMUMBAI000000000000000000';

  let adminClient: pg.Client;
  let apiClient: pg.Client;

  beforeAll(async () => {
    adminClient = new pg.Client({ connectionString });
    await adminClient.connect();

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

  it('PG-TASK-001 enforces owner XOR queue check constraint on task table', async () => {
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      const testId = `tsk_test_xor_${Date.now()}`;

      // 1. Both owner_user_id and owner_queue_id NULL -> rejected by CHECK ((owner_user_id IS NULL) <> (owner_queue_id IS NULL))
      await adminClient.query('SAVEPOINT sp_null');
      await expect(
        adminClient.query(
          `INSERT INTO app.task (
            id, tenant_id, type, title, owner_user_id, owner_queue_id,
            linked_type, linked_id, branch_id, priority, status, due_at,
            idempotency_key, created_by_source, tags, lock_version,
            created_at, created_by, updated_at, updated_by
          ) VALUES (
            $1, $2, 'FOLLOW_UP', 'Invalid Task Owner', NULL, NULL,
            'LEAD', 'lead_01', $3, 'MEDIUM', 'OPEN', now(),
            'idem_xor_01', 'USER', '{}', 0,
            now(), 'tester', now(), 'tester'
          )`,
          [testId, tenantA, branchA],
        ),
      ).rejects.toThrow(/check constraint|owner/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_null');
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-TASK-002 enforces completion check constraints on outcome_code for FOLLOW_UP and CALL', async () => {
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      const testId = `tsk_test_out_${Date.now()}`;

      // Insert open task
      await adminClient.query(
        `INSERT INTO app.task (
          id, tenant_id, type, title, owner_user_id,
          linked_type, linked_id, branch_id, priority, status, due_at,
          idempotency_key, created_by_source, tags, lock_version,
          created_at, created_by, updated_at, updated_by
        ) VALUES (
          $1, $2, 'FOLLOW_UP', 'Completion Check Task', 'usr_01JTESTUSER0000000000000000',
          'LEAD', 'lead_01', $3, 'MEDIUM', 'OPEN', now(),
          $4, 'USER', '{}', 0,
          now(), 'tester', now(), 'tester'
        )`,
        [testId, tenantA, branchA, `idem_out_${Date.now()}`],
      );

      // Attempt completing without outcome_code
      await adminClient.query('SAVEPOINT sp_no_outcome');
      await expect(
        adminClient.query(
          `UPDATE app.task
           SET status = 'COMPLETED', completed_at = now(), completed_by = 'tester'
           WHERE id = $1`,
          [testId],
        ),
      ).rejects.toThrow(/check constraint|outcome_code/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT sp_no_outcome');

      // Completing with outcome_code succeeds
      const compRes = await adminClient.query(
        `UPDATE app.task
         SET status = 'COMPLETED', completed_at = now(), completed_by = 'tester', outcome_code = 'CONNECTED'
         WHERE id = $1
         RETURNING status, outcome_code`,
        [testId],
      );
      expect(compRes.rows[0].status).toBe('COMPLETED');
      expect(compRes.rows[0].outcome_code).toBe('CONNECTED');
    } finally {
      await adminClient.query('ROLLBACK');
    }
  });

  it('PG-TASK-003 enforces Row-Level Security (RLS) tenant isolation on task table', async () => {
    const taskA = `tsk_rls_a_${Date.now()}`;
    const taskB = `tsk_rls_b_${Date.now()}`;

    // Seed rows under Tenant A and Tenant B
    await adminClient.query('BEGIN');
    try {
      await adminClient.query('SET LOCAL search_path = app, public');
      await adminClient.query(
        `INSERT INTO app.task (
          id, tenant_id, type, title, owner_user_id,
          linked_type, linked_id, branch_id, priority, status, due_at,
          idempotency_key, created_by_source, tags, lock_version,
          created_at, created_by, updated_at, updated_by
        ) VALUES (
          $1, $2, 'GENERAL', 'Task Tenant A', 'usr_01JTESTUSER0000000000000000',
          'LEAD', 'lead_01', $3, 'MEDIUM', 'OPEN', now(),
          $4, 'USER', '{}', 0,
          now(), 'admin', now(), 'admin'
        )`,
        [taskA, tenantA, branchA, `idem_rls_a_${Date.now()}`],
      );
      await adminClient.query(
        `INSERT INTO app.task (
          id, tenant_id, type, title, owner_user_id,
          linked_type, linked_id, branch_id, priority, status, due_at,
          idempotency_key, created_by_source, tags, lock_version,
          created_at, created_by, updated_at, updated_by
        ) VALUES (
          $1, $2, 'GENERAL', 'Task Tenant B', 'usr_demo_01',
          'LEAD', 'lead_02', 'br_demo_01', 'MEDIUM', 'OPEN', now(),
          $3, 'USER', '{}', 0,
          now(), 'admin', now(), 'admin'
        )`,
        [taskB, tenantB, `idem_rls_b_${Date.now()}`],
      );
      await adminClient.query('COMMIT');
    } catch (e) {
      await adminClient.query('ROLLBACK');
      throw e;
    }

    try {
      // 1. Querying as dsa_api with tenant context set to Tenant A
      await apiClient.query('BEGIN');
      await apiClient.query('SET LOCAL search_path = app, public');
      await apiClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);

      const selectA = await apiClient.query(`SELECT id, tenant_id FROM app.task WHERE id IN ($1, $2)`, [
        taskA,
        taskB,
      ]);

      // Only Tenant A's task visible
      expect(selectA.rows.length).toBe(1);
      expect(selectA.rows[0].id).toBe(taskA);
      expect(selectA.rows[0].tenant_id).toBe(tenantA);

      // Selecting Tenant B directly returns 0 rows
      const directB = await apiClient.query(`SELECT id FROM app.task WHERE id = $1`, [taskB]);
      expect(directB.rows.length).toBe(0);
      await apiClient.query('ROLLBACK');

      // 2. Querying without app.tenant_id (fail-closed)
      await apiClient.query('BEGIN');
      await apiClient.query('SET LOCAL search_path = app, public');
      const noTenant = await apiClient.query(`SELECT id FROM app.task WHERE id IN ($1, $2)`, [taskA, taskB]);
      expect(noTenant.rows.length).toBe(0);
      await apiClient.query('ROLLBACK');
    } finally {
      await adminClient.query(`DELETE FROM app.task WHERE id IN ($1, $2)`, [taskA, taskB]);
    }
  });
});
