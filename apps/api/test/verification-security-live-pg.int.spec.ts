// apps/api/test/verification-security-live-pg.int.spec.ts
// Live PostgreSQL verification and tenant-isolation tests for Module 22 (Verification / MOD-VER).
// Connects as dsa_api (NOBYPASSRLS) and validates real PostgreSQL migrations, RLS policies, immutability,
// verifier role grants, and read-only permissions for Compliance and RM.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import path from 'node:path';
import { createDb } from '../src/kernel-min/db';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import type { Database, RequestContext } from '@dsa/contracts';

try {
  process.loadEnvFile(path.resolve(__dirname, '../.env'));
} catch {
  // Ignore if already loaded
}

const dbUrl = process.env.DATABASE_URL;
const describeLivePg = dbUrl ? describe : describe.skip;

const TENANT_A = 'ten_demo_01';
const TENANT_B = 'ten_01JOTHERTENANT0000000000000';
const USER_A = 'usr_demo_01';
const USER_B = 'usr_01JOTHERUSER00000000000000';
const BRANCH_A = 'br_demo_01';
const APP_A = 'app_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const CONSENT_A = 'cnst_01M4V6DFM0TFA9D04QJTW32ETD';

function makeCtx(tenantId: string, userId: string, branchId?: string): RequestContext {
  return {
    principal: {
      kind: 'USER',
      id: userId,
      tenantId,
      primaryBranchId: branchId ?? BRANCH_A,
      managedTeamMemberIds: [],
      queueIds: [],
      grants: [],
      authTime: null,
    },
    correlationId: `corr_vrf_${Date.now()}`,
    now: new Date(),
  };
}

describeLivePg('Module 22 (MOD-VER): Live PostgreSQL Security & Isolation Verification', () => {
  let db: Kysely<Database>;
  let txRunner: ReturnType<typeof createTxRunner>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = createDb(dbUrl, { poolMax: 5 });
    txRunner = createTxRunner(db);

    // The tests below attach verifications to this application and consent record, so they have to exist. They are created
    // here as synthetic data in the throwaway database (tests/guard refuses any non-local connection), not taken from hosted.
    const admin = createDb(process.env.VERIFY_DATABASE_URL || dbUrl, { poolMax: 1 });
    try {
      await sql`
        INSERT INTO app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
        VALUES ('cus_vrf_sec_synthetic', ${TENANT_A}, 'INDIVIDUAL', 'Synthetic Verification Customer', ${BRANCH_A}, ${USER_A}, ${USER_A})
        ON CONFLICT (id) DO NOTHING
      `.execute(admin);
      await sql`
        INSERT INTO app.loan_application (id, tenant_id, branch_id, customer_id, product_category, requested_amount,
                                          applicant_type, sales_owner_id, created_by, updated_by)
        VALUES (${APP_A}, ${TENANT_A}, ${BRANCH_A}, 'cus_vrf_sec_synthetic', 'PL', 100000, 'SALARIED', ${USER_A}, ${USER_A}, ${USER_A})
        ON CONFLICT (id) DO NOTHING
      `.execute(admin);
      await sql`
        INSERT INTO app.consent_record (id, tenant_id, subject_type, subject_id, purpose, notice_version, channel, captured_by, captured_at)
        VALUES (${CONSENT_A}, ${TENANT_A}, 'CUSTOMER', 'cus_vrf_sec_synthetic', 'LOAN_PROCESSING', 'V1', 'IN_PERSON', ${USER_A}, now())
        ON CONFLICT (id) DO NOTHING
      `.execute(admin);
    } finally {
      await admin.destroy();
    }
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('PG-VRF-SEC-001: verifies dsa_api connects with NOBYPASSRLS', async () => {
    const { rows } = await sql<{
      current_user: string;
      rolbypassrls: boolean;
    }>`SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user`.execute(db);

    expect(rows[0]?.current_user).toBe('dsa_api');
    expect(rows[0]?.rolbypassrls).toBe(false);
  });

  it('PG-VRF-SEC-002: verifies verifier roles exist with complete verification permissions in database catalog', async () => {
    const ctxA = makeCtx(TENANT_A, USER_A);

    const roles = await txRunner.withTenantTx(ctxA, async (tx) => {
      const { rows } = await sql<{ code: string; name: string }>`
        SELECT code, name FROM app.role 
        WHERE code IN ('ROLE-DOC-VERIFIER', 'ROLE-VERIFIER')
        ORDER BY code
      `.execute(tx);
      return rows;
    });

    expect(roles.length).toBeGreaterThanOrEqual(1);
    const roleCodes = roles.map((r) => r.code);
    expect(roleCodes).toContain('ROLE-DOC-VERIFIER');

    // Verify role permissions
    const perms = await txRunner.withTenantTx(ctxA, async (tx) => {
      const { rows } = await sql<{ code: string; permission_code: string }>`
        SELECT r.code, rp.permission_code
        FROM app.role r
        JOIN app.role_permission rp ON rp.role_id = r.id AND rp.tenant_id = r.tenant_id
        WHERE r.code IN ('ROLE-DOC-VERIFIER', 'ROLE-VERIFIER')
        ORDER BY rp.permission_code
      `.execute(tx);
      return rows;
    });

    const grantedCodes = new Set(perms.map((p) => p.permission_code));
    expect(grantedCodes.has('verification.read')).toBe(true);
    expect(grantedCodes.has('verification.perform')).toBe(true);
    expect(grantedCodes.has('verification.create')).toBe(true);
    expect(grantedCodes.has('verification.complete')).toBe(true);
    expect(grantedCodes.has('document.review')).toBe(true);
  });

  it('PG-VRF-SEC-003: verifies read-only verification permissions for Compliance and RM (no perform or complete)', async () => {
    const ctxA = makeCtx(TENANT_A, USER_A);

    const perms = await txRunner.withTenantTx(ctxA, async (tx) => {
      const { rows } = await sql<{ code: string; permission_code: string }>`
        SELECT r.code, rp.permission_code
        FROM app.role r
        JOIN app.role_permission rp ON rp.role_id = r.id AND rp.tenant_id = r.tenant_id
        WHERE r.code IN ('ROLE-COMPLIANCE', 'ROLE-RM')
        ORDER BY r.code, rp.permission_code
      `.execute(tx);
      return rows;
    });

    // Check ROLE-COMPLIANCE
    const compliancePerms = perms.filter((p) => p.code === 'ROLE-COMPLIANCE').map((p) => p.permission_code);
    expect(compliancePerms).toContain('verification.read');
    expect(compliancePerms).not.toContain('verification.perform');
    expect(compliancePerms).not.toContain('verification.complete');
    expect(compliancePerms).not.toContain('verification.create');

    // Check ROLE-RM
    const rmPerms = perms.filter((p) => p.code === 'ROLE-RM').map((p) => p.permission_code);
    expect(rmPerms).toContain('verification.read');
    expect(rmPerms).not.toContain('verification.perform');
    expect(rmPerms).not.toContain('verification.complete');
    expect(rmPerms).not.toContain('verification.create');
  });

  it('PG-VRF-SEC-004: verifies RLS tenant isolation on app.verification_request', async () => {
    const reqId = `vrf_sec_test_${Date.now()}`;
    const ctxA = makeCtx(TENANT_A, USER_A, BRANCH_A);
    const ctxB = makeCtx(TENANT_B, USER_B);

    // 1. Insert verification_request under Tenant A
    await txRunner.withTenantTx(ctxA, async (tx) => {
      await sql`
        INSERT INTO app.verification_request (
          id, tenant_id, application_id, verification_type, status,
          branch_id, priority, lock_version, created_at, created_by,
          updated_at, updated_by
        ) VALUES (
          ${reqId}, ${TENANT_A}, ${APP_A}, 'DOCUMENT_REVIEW', 'INITIATED',
          ${BRANCH_A}, 'HIGH', 0, now(), ${USER_A},
          now(), ${USER_A}
        )
      `.execute(tx);
    });

    // 2. Query within Tenant A: record MUST be visible
    const rowsTenantA = await txRunner.withTenantTx(ctxA, async (tx) => {
      const { rows } = await sql<{ id: string; tenant_id: string }>`
        SELECT id, tenant_id FROM app.verification_request WHERE id = ${reqId}
      `.execute(tx);
      return rows;
    });
    expect(rowsTenantA).toHaveLength(1);
    expect(rowsTenantA[0]?.id).toBe(reqId);
    expect(rowsTenantA[0]?.tenant_id).toBe(TENANT_A);

    // 3. Query within Tenant B: record MUST NOT be visible (RLS blocks cross-tenant access)
    const rowsTenantB = await txRunner.withTenantTx(ctxB, async (tx) => {
      const { rows } = await sql<{ id: string }>`
        SELECT id FROM app.verification_request WHERE id = ${reqId}
      `.execute(tx);
      return rows;
    });
    expect(rowsTenantB).toHaveLength(0);

    // 4. Fail-closed check: Query without setting tenant context
    const { rows: noTenantRows } = await sql<{ id: string }>`
      SELECT id FROM app.verification_request WHERE id = ${reqId}
    `.execute(db);
    expect(noTenantRows).toHaveLength(0);
  });

  it('PG-VRF-SEC-005: verifies RLS tenant isolation on app.verification (ENT-064)', async () => {
    const verId = `ver_sec_test_${Date.now()}`;
    const ctxA = makeCtx(TENANT_A, USER_A);
    const ctxB = makeCtx(TENANT_B, USER_B);

    // 1. Insert verification check under Tenant A
    await txRunner.withTenantTx(ctxA, async (tx) => {
      await sql`
        INSERT INTO app.verification (
          id, tenant_id, subject_type, subject_id, check_type, method, purpose,
          consent_record_id, result, minimal_result, evidence_ref, performed_by, performed_at,
          lock_version, created_at
        ) VALUES (
          ${verId}, ${TENANT_A}, 'LOAN_APPLICATION', ${APP_A}, 'PAN', 'MANUAL', 'KYC',
          ${CONSENT_A}, 'VERIFIED', '{"statusDescription":"PAN matched borrower"}'::jsonb,
          'evidence_pan_01.pdf', ${USER_A}, now(), 0, now()
        )
      `.execute(tx);
    });

    // 2. Query within Tenant A: record MUST be visible
    const rowsTenantA = await txRunner.withTenantTx(ctxA, async (tx) => {
      const { rows } = await sql<{ id: string; tenant_id: string }>`
        SELECT id, tenant_id FROM app.verification WHERE id = ${verId}
      `.execute(tx);
      return rows;
    });
    expect(rowsTenantA).toHaveLength(1);
    expect(rowsTenantA[0]?.id).toBe(verId);
    expect(rowsTenantA[0]?.tenant_id).toBe(TENANT_A);

    // 3. Query within Tenant B: record MUST NOT be visible
    const rowsTenantB = await txRunner.withTenantTx(ctxB, async (tx) => {
      const { rows } = await sql<{ id: string }>`
        SELECT id FROM app.verification WHERE id = ${verId}
      `.execute(tx);
      return rows;
    });
    expect(rowsTenantB).toHaveLength(0);

    // 4. Fail-closed check: Query without tenant context
    const { rows: noTenantRows } = await sql<{ id: string }>`
      SELECT id FROM app.verification WHERE id = ${verId}
    `.execute(db);
    expect(noTenantRows).toHaveLength(0);
  });

  it('PG-VRF-SEC-006: verifies append-only immutability trigger blocks UPDATE and DELETE on app.verification', async () => {
    const verId = `ver_immut_test_${Date.now()}`;
    const ctxA = makeCtx(TENANT_A, USER_A);

    // 1. Insert record
    await txRunner.withTenantTx(ctxA, async (tx) => {
      await sql`
        INSERT INTO app.verification (
          id, tenant_id, subject_type, subject_id, check_type, method, purpose,
          consent_record_id, result, minimal_result, evidence_ref, performed_by, performed_at,
          lock_version, created_at
        ) VALUES (
          ${verId}, ${TENANT_A}, 'LOAN_APPLICATION', ${APP_A}, 'GST', 'MANUAL', 'KYC',
          ${CONSENT_A}, 'VERIFIED', '{"statusDescription":"GST active"}'::jsonb,
          'evidence_gst_01.pdf', ${USER_A}, now(), 0, now()
        )
      `.execute(tx);
    });

    // 2. Attempt UPDATE: trigger MUST block
    await expect(
      txRunner.withTenantTx(ctxA, async (tx) => {
        await sql`
          UPDATE app.verification SET result = 'REJECTED' WHERE id = ${verId}
        `.execute(tx);
      }),
    ).rejects.toThrow();

    // 3. Attempt DELETE: trigger or permissions MUST block
    await expect(
      txRunner.withTenantTx(ctxA, async (tx) => {
        await sql`
          DELETE FROM app.verification WHERE id = ${verId}
        `.execute(tx);
      }),
    ).rejects.toThrow();

    // 4. Record still exists intact
    const surviving = await txRunner.withTenantTx(ctxA, async (tx) => {
      const { rows } = await sql<{ id: string; result: string }>`
        SELECT id, result FROM app.verification WHERE id = ${verId}
      `.execute(tx);
      return rows;
    });
    expect(surviving).toHaveLength(1);
    expect(surviving[0]?.result).toBe('VERIFIED');
  });
});
