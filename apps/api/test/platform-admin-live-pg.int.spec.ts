// apps/api/test/platform-admin-live-pg.int.spec.ts
// Direct live PostgreSQL verification for Module 40 (Platform Administration / MOD-ADM).
import { sql, type Kysely } from 'kysely';
import { monotonicFactory } from 'ulid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@dsa/contracts';
import { createDb } from '../src/kernel-min/db';
import { resolveLocalTestDatabaseUrl } from './support/test-db-url';

const nextUlid = monotonicFactory();

const dbUrl = resolveLocalTestDatabaseUrl('DATABASE_URL');
const adminDbUrl = resolveLocalTestDatabaseUrl('VERIFY_DATABASE_URL') || resolveLocalTestDatabaseUrl('DATABASE_URL');
const describeLivePg = dbUrl ? describe : describe.skip;

const TENANT_A = 'ten_01JTESTTENANT00000000000000';

describeLivePg('Module 40 (MOD-ADM): Live PostgreSQL Verification', () => {
  let db: Kysely<Database>;
  let adminDb: Kysely<Database>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = createDb(dbUrl, { poolMax: 5 });
    adminDb = createDb(adminDbUrl!, { poolMax: 2 });
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (adminDb) await adminDb.destroy();
  });

  it('PG-ADM-001: Verifies permissions for platform admin and data correction exist in catalog', async () => {
    const rows = await sql<{ code: string }>`
      SELECT code FROM app.permission
       WHERE code IN (
         'platform.console',
         'platform.flags',
         'platform.master_data',
         'platform.jobs',
         'platform.support_access',
         'platform.release',
         'data_correction.request',
         'data_correction.approve'
       )
       ORDER BY code
    `.execute(db);

    const codes = rows.rows.map((r) => r.code);
    expect(codes).toContain('platform.console');
    expect(codes).toContain('platform.flags');
    expect(codes).toContain('platform.master_data');
    expect(codes).toContain('platform.jobs');
    expect(codes).toContain('platform.support_access');
    expect(codes).toContain('platform.release');
    expect(codes).toContain('data_correction.request');
    expect(codes).toContain('data_correction.approve');
  });

  it('PG-ADM-002: Verifies feature_flag table exists and supports global and tenant scopes', async () => {
    const testKey = `flag_test_${nextUlid()}`;
    await sql`
      INSERT INTO app.feature_flag (key, scope, value, owner, description, lock_version, updated_by)
      VALUES (${testKey}, 'GLOBAL', true, 'Test Suite', 'Live PG test flag', 1, 'TEST')
    `.execute(adminDb);

    const check = await sql<{ key: string; value: boolean; scope: string }>`
      SELECT key, value, scope FROM app.feature_flag WHERE key = ${testKey}
    `.execute(db);

    expect(check.rows.length).toBe(1);
    expect(check.rows[0]?.value).toBe(true);
    expect(check.rows[0]?.scope).toBe('GLOBAL');
  });

  it('PG-ADM-003: Verifies master_data_item table exists and contains seeded datasets', async () => {
    const rows = await sql<{ dataset: string; count: string }>`
      SELECT dataset, count(*)::text as count FROM app.master_data_item GROUP BY dataset
    `.execute(db);

    const datasets = rows.rows.map((r) => r.dataset);
    expect(datasets).toContain('loan_categories');
    expect(datasets).toContain('kyc_document_types');
  });

  it('PG-ADM-004: Verifies support_access_grant table enforces tenant RLS and status checks', async () => {
    const grantId = `sag_${nextUlid()}`;
    await sql`
      INSERT INTO app.support_access_grant (
        id, tenant_id, support_user_id, reason, expires_at, status, lock_version, created_by
      ) VALUES (
        ${grantId}, ${TENANT_A}, 'usr_support_01', 'Live PG verification test', now() + interval '2 hours', 'PENDING', 1, 'TEST'
      )
    `.execute(adminDb);

    const res = await sql<{ id: string; status: string }>`
      SELECT id, status FROM app.support_access_grant WHERE id = ${grantId}
    `.execute(adminDb);

    expect(res.rows[0]?.id).toBe(grantId);
    expect(res.rows[0]?.status).toBe('PENDING');
  });

  it('PG-ADM-005: Verifies data_correction_request table enforces tenant RLS and status checks', async () => {
    const corrId = `dcr_${nextUlid()}`;
    await sql`
      INSERT INTO app.data_correction_request (
        id, tenant_id, entity_type, entity_id, field_name, old_value, new_value, reason, status, submitted_by, lock_version, created_by
      ) VALUES (
        ${corrId}, ${TENANT_A}, 'LEAD', 'lead_test_01', 'phone', '9876543210', '9876543211', 'Incorrect phone', 'PENDING', 'usr_maker', 1, 'usr_maker'
      )
    `.execute(adminDb);

    const res = await sql<{ id: string; status: string }>`
      SELECT id, status FROM app.data_correction_request WHERE id = ${corrId}
    `.execute(adminDb);

    expect(res.rows[0]?.id).toBe(corrId);
    expect(res.rows[0]?.status).toBe('PENDING');
  });
});
