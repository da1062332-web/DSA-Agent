// apps/api/test/connectors-live-pg.int.spec.ts
// Direct live PostgreSQL verification for Module 27 (Connectors / MOD-CON).
// Connects as dsa_api (NOBYPASSRLS) and validates real PostgreSQL migrations, RLS policies, triggers, and tenant isolation.
import { sql, type Kysely } from 'kysely';
import path from 'node:path';
import { monotonicFactory } from 'ulid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database, RequestContext } from '@dsa/contracts';
import { createDb } from '../src/kernel-min/db';
import { createTxRunner } from '../src/kernel-min/tx-runner';

const nextUlid = monotonicFactory();

try {
  process.loadEnvFile(path.resolve(__dirname, '../.env'));
} catch {
  // Ignore if already loaded
}

const dbUrl = process.env.DATABASE_URL;
const adminDbUrl = process.env.VERIFY_DATABASE_URL || process.env.DATABASE_URL;
const describeLivePg = dbUrl ? describe : describe.skip;

const TENANT_A = 'ten_01JTESTTENANT00000000000000';
const TENANT_B = 'ten_01JTESTTENANT00000000000002';
const USER_A = 'usr_01JTESTUSER0000000000000000';
const BRANCH_A = 'br_01JMUMBAI000000000000000000';

describeLivePg('Module 27 (MOD-CON): Live PostgreSQL Verification', () => {
  let db: Kysely<Database>;
  let adminDb: Kysely<Database>;
  let txRunner: ReturnType<typeof createTxRunner>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = createDb(dbUrl, { poolMax: 5 });
    adminDb = createDb(adminDbUrl!, { poolMax: 2 });
    txRunner = createTxRunner(db);

    // Ensure branch A exists for foreign key
    await sql`
      INSERT INTO app.branch (id, tenant_id, organisation_id, code, name, created_by, updated_by)
      VALUES (${BRANCH_A}, ${TENANT_A}, 'org_01JTESTORG0000000000000', 'BR_CON_A', 'Mumbai Main', 'SYSTEM', 'SYSTEM')
      ON CONFLICT (id) DO NOTHING
    `.execute(adminDb);
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (adminDb) await adminDb.destroy();
  });

  it('PG-CON-001: Verifies connector permissions registered in database catalog', async () => {
    const permRows = await sql<{ code: string }>`
      SELECT code FROM app.permission
       WHERE code IN ('connector.manage', 'connector.read', 'connector.approve_bank', 'connector.resolve_dispute')
       ORDER BY code
    `.execute(db);

    const codes = permRows.rows.map((r) => r.code);
    expect(codes).toContain('connector.manage');
    expect(codes).toContain('connector.read');
  });

  it('PG-CON-002: Verifies RLS tenant isolation on app.connector (Tenant B cannot read Tenant A connector)', async () => {
    const connectorId = `con_test_iso_${nextUlid()}`;
    const ctxA: RequestContext = {
      principal: {
        kind: 'USER',
        id: USER_A,
        tenantId: TENANT_A,
        primaryBranchId: BRANCH_A,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [{ code: 'connector.manage', scope: 'TENANT', branchIds: [] }],
        authTime: new Date().toISOString(),
      },
      correlationId: `corr-${nextUlid()}`,
      now: new Date(),
    };
    const ctxB: RequestContext = {
      principal: {
        kind: 'USER',
        id: 'usr_tenant_b_user',
        tenantId: TENANT_B,
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [{ code: 'connector.manage', scope: 'TENANT', branchIds: [] }],
        authTime: new Date().toISOString(),
      },
      correlationId: `corr-${nextUlid()}`,
      now: new Date(),
    };

    // 1. Insert connector for Tenant A inside Tenant A context
    await txRunner.withTenantTx(ctxA, async (tx) => {
      await sql`
        INSERT INTO app.connector (
          id, tenant_id, connector_type, legal_name, contact_person,
          mobile_e164, mobile_hash, email, email_hash,
          encrypted_pan, pan_hash, pan_masked,
          primary_branch_id, relationship_owner_user_id, status,
          lock_version, created_at, created_by, updated_at, updated_by
        ) VALUES (
          ${connectorId}, ${TENANT_A}, 'INDIVIDUAL', 'Isolation Connector', 'Ramesh Rao',
          '+919876543210', 'hash_mob_1', 'ramesh@example.com', 'hash_em_1',
          'enc_pan_1', ${`pan_hash_${nextUlid()}`}, 'ABCDE****F',
          ${BRANCH_A}, ${USER_A}, 'DRAFT',
          0, now(), ${USER_A}, now(), ${USER_A}
        )
      `.execute(tx);
    });

    // 2. Visible to Tenant A
    const resA = await txRunner.withTenantTx(ctxA, async (tx) => {
      return sql<{ id: string }>`SELECT id FROM app.connector WHERE id = ${connectorId}`.execute(tx);
    });
    expect(resA.rows.length).toBe(1);
    expect(resA.rows[0]?.id).toBe(connectorId);

    // 3. Invisible to Tenant B (RLS returns 0 rows)
    const resB = await txRunner.withTenantTx(ctxB, async (tx) => {
      return sql<{ id: string }>`SELECT id FROM app.connector WHERE id = ${connectorId}`.execute(tx);
    });
    expect(resB.rows.length).toBe(0);

    // 4. Fail-closed: unauthenticated / direct without tenant context returns 0 rows
    const resDirect = await sql<{ id: string }>`SELECT id FROM app.connector WHERE id = ${connectorId}`.execute(db);
    expect(resDirect.rows.length).toBe(0);
  });

  it('PG-CON-003: Verifies RLS tenant isolation on app.connector_bank_account', async () => {
    const connectorId = `con_bank_iso_${nextUlid()}`;
    const bankAccId = `cba_iso_${nextUlid()}`;
    const ctxA: RequestContext = {
      principal: {
        kind: 'USER',
        id: USER_A,
        tenantId: TENANT_A,
        primaryBranchId: BRANCH_A,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [{ code: 'connector.manage', scope: 'TENANT', branchIds: [] }],
        authTime: new Date().toISOString(),
      },
      correlationId: `corr-${nextUlid()}`,
      now: new Date(),
    };
    const ctxB: RequestContext = {
      principal: {
        kind: 'USER',
        id: 'usr_tenant_b_user',
        tenantId: TENANT_B,
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [{ code: 'connector.manage', scope: 'TENANT', branchIds: [] }],
        authTime: new Date().toISOString(),
      },
      correlationId: `corr-${nextUlid()}`,
      now: new Date(),
    };

    await txRunner.withTenantTx(ctxA, async (tx) => {
      await sql`
        INSERT INTO app.connector (
          id, tenant_id, connector_type, legal_name, contact_person,
          mobile_e164, mobile_hash, email, email_hash,
          encrypted_pan, pan_hash, pan_masked,
          primary_branch_id, relationship_owner_user_id, status,
          lock_version, created_at, created_by, updated_at, updated_by
        ) VALUES (
          ${connectorId}, ${TENANT_A}, 'INDIVIDUAL', 'Bank Iso Connector', 'Suresh Rao',
          '+919876543211', 'hash_mob_2', 'suresh@example.com', 'hash_em_2',
          'enc_pan_2', ${`pan_hash_${nextUlid()}`}, 'ABCDE****G',
          ${BRANCH_A}, ${USER_A}, 'ACTIVE',
          0, now(), ${USER_A}, now(), ${USER_A}
        )
      `.execute(tx);

      await sql`
        INSERT INTO app.connector_bank_account (
          id, tenant_id, connector_id, account_holder_name, encrypted_account_number, account_hash, account_masked,
          ifsc_code, status, lock_version, created_at, created_by, updated_at, updated_by
        ) VALUES (
          ${bankAccId}, ${TENANT_A}, ${connectorId}, 'Suresh Rao', 'enc_acc', 'acc_hash', '******1234',
          'HDFC0001234', 'PENDING_APPROVAL', 0, now(), ${USER_A}, now(), ${USER_A}
        )
      `.execute(tx);
    });

    const resB = await txRunner.withTenantTx(ctxB, async (tx) => {
      return sql<{ id: string }>`SELECT id FROM app.connector_bank_account WHERE id = ${bankAccId}`.execute(tx);
    });
    expect(resB.rows.length).toBe(0);
  });
});
