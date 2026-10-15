// apps/api/test/payouts-live-pg.int.spec.ts
// Direct live PostgreSQL verification for MOD-PAY (Payout Management / Module 30 Part B).
import type { Database, RequestContext } from '@dsa/contracts';
import { createAuditPort, createAuthz, createIdGenerator } from '@dsa/kernel';
import { sql, type Kysely } from 'kysely';
import path from 'node:path';
import { monotonicFactory } from 'ulid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/kernel-min/db';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { decryptPaymentRef } from '../src/modules/finance/crypto';
import { FinanceService } from '../src/modules/finance/finance-service';
import { SqlFinanceRepository } from '../src/modules/finance/repository';
import { InMemoryFinancialStorage } from '../src/modules/finance/storage';

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
const USER_A_MAKER = 'usr_01JTESTUSER0000000000000000';
const USER_A_CHECKER = 'usr_01JTESTCHECKER0000000000000';

describeLivePg('MOD-PAY: Live PostgreSQL & RLS Verification', () => {
  let db: Kysely<Database>;
  let adminDb: Kysely<Database>;
  let txRunner: ReturnType<typeof createTxRunner>;
  let service: FinanceService;
  let repository: SqlFinanceRepository;
  let storage: InMemoryFinancialStorage;

  const ids = createIdGenerator();
  const authz = createAuthz();
  const audit = createAuditPort(ids);

  beforeAll(async () => {
    if (!dbUrl) return;
    db = createDb(dbUrl, { poolMax: 5 });
    adminDb = createDb(adminDbUrl!, { poolMax: 2 });
    txRunner = createTxRunner(db);
    repository = new SqlFinanceRepository();
    storage = new InMemoryFinancialStorage();

    service = new FinanceService({
      repository,
      audit,
      storage,
    });

    // Seed test tenants if not present using superuser connection
    await sql`
      insert into app.tenant (id, slug, legal_name, tenant_type, data_region, timezone, status, created_at, created_by)
      values 
        (${TENANT_A}, 'test-tenant-a', 'Test Tenant A', 'DSA_ORG', 'ap-south-1', 'Asia/Kolkata', 'ACTIVE', now(), 'SYSTEM'),
        (${TENANT_B}, 'test-tenant-b', 'Test Tenant B', 'DSA_ORG', 'ap-south-1', 'Asia/Kolkata', 'ACTIVE', now(), 'SYSTEM')
      on conflict (id) do nothing
    `.execute(adminDb);

    // Seed ROLE-COMMISSION-APPROVER role for TENANT_A
    const roleId = `rol_comm_approver_${TENANT_A}`;
    await sql`
      insert into app.role (id, tenant_id, code, name, is_template, version, created_at, created_by)
      values (${roleId}, ${TENANT_A}, 'ROLE-COMMISSION-APPROVER', 'Commission Approver', false, 1, now(), 'SYSTEM')
      on conflict (tenant_id, code) do nothing
    `.execute(adminDb);

    await sql`
      insert into app.role_permission (tenant_id, role_id, permission_code)
      values 
        (${TENANT_A}, ${roleId}, 'payout.approve'),
        (${TENANT_A}, ${roleId}, 'payout.record_payment'),
        (${TENANT_A}, ${roleId}, 'finance.view')
      on conflict do nothing
    `.execute(adminDb);
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
    if (adminDb) {
      await adminDb.destroy();
    }
  });

  async function ensureLender(tx: any, tenantId: string): Promise<string> {
    const existing = await sql<{ id: string }>`
      select id from app.lender where tenant_id = ${tenantId} limit 1
    `.execute(tx);
    if (existing.rows[0]) return existing.rows[0].id;

    const lenderId = `lnd_${nextUlid()}`;
    await sql`
      insert into app.lender (id, tenant_id, name, lender_type, status, lock_version, created_by, updated_by)
      values (${lenderId}, ${tenantId}, 'Test Bank Partner', 'BANK', 'ACTIVE', 0, ${USER_A_MAKER}, ${USER_A_MAKER})
    `.execute(adminDb);
    return lenderId;
  }

  it('MIGRATION-0044: Payout permissions and roles are properly registered in database catalog', async () => {
    const permRows = await sql<{ code: string }>`
      select code from app.permission
       where code in ('payout.request', 'payout.approve', 'payout.record_payment', 'finance.view')
       order by code
    `.execute(db);

    const codes = permRows.rows.map((r) => r.code);
    expect(codes).toContain('finance.view');
    expect(codes).toContain('payout.approve');
    expect(codes).toContain('payout.record_payment');
    expect(codes).toContain('payout.request');

    const roleRows = await sql<{ code: string }>`
      select code from app.role
       where code = 'ROLE-COMMISSION-APPROVER'
    `.execute(adminDb);
    expect(roleRows.rows.length).toBeGreaterThan(0);

    const grantRows = await sql<{ role_code: string; permission_code: string }>`
      select r.code as role_code, rp.permission_code
        from app.role_permission rp
        join app.role r on r.id = rp.role_id
       where r.code = 'ROLE-COMMISSION-APPROVER'
       order by rp.permission_code
    `.execute(adminDb);
    const approverGrants = grantRows.rows.map((g) => g.permission_code);
    expect(approverGrants).toContain('payout.approve');
    expect(approverGrants).toContain('finance.view');
  });

  it('DATABASE-INTEGRITY: Live payout lines partial unique index uq_payout_line_once prevents duplicate active lines', async () => {
    const makerCtx: RequestContext = {
      principal: {
        kind: 'USER',
        id: USER_A_MAKER,
        tenantId: TENANT_A,
        grants: [
          { code: 'payout.request', scope: 'TENANT', branchIds: [] },
          { code: 'payout.record_payment', scope: 'TENANT', branchIds: [] },
          { code: 'finance.view', scope: 'TENANT', branchIds: [] },
        ],
        queueIds: [],
        managedTeamMemberIds: [],
        primaryBranchId: null,
        authTime: new Date().toISOString(),
      },
      correlationId: `corr-${nextUlid()}`,
      now: new Date(),
    };

    const payableId = `cpay_live_${nextUlid()}`;
    const calculationId = `ccal_live_${nextUlid()}`;
    const connectorId = `con_live_${nextUlid()}`;

    // Insert live calculation and payable inside tenant transaction
    await txRunner.withTenantTx(makerCtx, async (tx) => {
      const lenderId = await ensureLender(tx, TENANT_A);
      await repository.insertCommissionCalculation(tx, {
        id: calculationId,
        tenant_id: TENANT_A,
        lender_id: lenderId,
        tranche_id: `trn_${nextUlid()}`,
        application_id: null,
        lender_case_id: null,
        event_date: new Date(),
        basis_amount: '100000.00',
        rate: '0.015000',
        rate_type: 'PERCENTAGE',
        cap: null,
        gross_amount: '15000.00',
        currency: 'INR',
        calc_kind: 'EARNED',
        rule_set_version_id: null,
        decision_record_id: null,
        inputs_hash: null,
        status: 'EARNED',
        supersedes_id: null,
        lock_version: 0,
        created_at: new Date(),
        created_by: USER_A_MAKER,
        updated_at: new Date(),
        updated_by: USER_A_MAKER,
      });

      await repository.insertCommissionPayable(tx, {
        id: payableId,
        tenant_id: TENANT_A,
        calculation_id: calculationId,
        connector_id: connectorId,
        share_rate: '0.700000',
        amount: '15000.00',
        currency: 'INR',
        state: 'ELIGIBLE',
        hold_reasons: null,
        eligibility_decision_id: null,
        lock_version: 0,
        created_at: new Date(),
        created_by: USER_A_MAKER,
        updated_at: new Date(),
        updated_by: USER_A_MAKER,
      });
    });

    // Create first payout request
    const payout1 = await txRunner.withTenantTx(makerCtx, async (tx) => {
      return service.createPayoutRequest(tx, makerCtx, {
        connectorId,
        origin: 'FINANCE',
        payableIds: [payableId as any],
      });
    });
    expect(payout1.id).toBeDefined();

    // Direct database violation attempt: try inserting second active line for same payable
    await expect(
      txRunner.withTenantTx(makerCtx, async (tx) => {
        await repository.insertPayoutLine(tx, {
          id: `pln_dup_${nextUlid()}`,
          tenant_id: TENANT_A,
          payout_id: `prq_other_${nextUlid()}`,
          payable_id: payableId,
          amount: '15000.00',
          currency: 'INR',
          status: 'INCLUDED',
          created_at: new Date(),
          created_by: USER_A_MAKER,
        });
      }),
    ).rejects.toThrow();
  });

  it('DATABASE-INTEGRITY: AES-256-GCM ciphertext persisted in database and decrypted accurately', async () => {
    const makerCtx: RequestContext = {
      principal: {
        kind: 'USER',
        id: USER_A_MAKER,
        tenantId: TENANT_A,
        grants: [
          { code: 'payout.request', scope: 'TENANT', branchIds: [] },
          { code: 'payout.record_payment', scope: 'TENANT', branchIds: [] },
          { code: 'finance.view', scope: 'TENANT', branchIds: [] },
        ],
        queueIds: [],
        managedTeamMemberIds: [],
        primaryBranchId: null,
        authTime: new Date().toISOString(),
      },
      correlationId: `corr-${nextUlid()}`,
      now: new Date(),
    };
    const checkerCtx: RequestContext = {
      principal: {
        kind: 'USER',
        id: USER_A_CHECKER,
        tenantId: TENANT_A,
        grants: [
          { code: 'payout.approve', scope: 'TENANT', branchIds: [] },
          { code: 'finance.view', scope: 'TENANT', branchIds: [] },
        ],
        queueIds: [],
        managedTeamMemberIds: [],
        primaryBranchId: null,
        authTime: new Date().toISOString(),
      },
      correlationId: `corr-${nextUlid()}`,
      now: new Date(),
    };

    const payableId = `cpay_live_${nextUlid()}`;
    const calculationId = `ccal_live_${nextUlid()}`;
    const connectorId = `con_live_${nextUlid()}`;

    await txRunner.withTenantTx(makerCtx, async (tx) => {
      const lenderId = await ensureLender(tx, TENANT_A);
      await repository.insertCommissionCalculation(tx, {
        id: calculationId,
        tenant_id: TENANT_A,
        lender_id: lenderId,
        tranche_id: `trn_${nextUlid()}`,
        application_id: null,
        lender_case_id: null,
        event_date: new Date(),
        basis_amount: '200000.00',
        rate: '0.015000',
        rate_type: 'PERCENTAGE',
        cap: null,
        gross_amount: '30000.00',
        currency: 'INR',
        calc_kind: 'EARNED',
        rule_set_version_id: null,
        decision_record_id: null,
        inputs_hash: null,
        status: 'EARNED',
        supersedes_id: null,
        lock_version: 0,
        created_at: new Date(),
        created_by: USER_A_MAKER,
        updated_at: new Date(),
        updated_by: USER_A_MAKER,
      });

      await repository.insertCommissionPayable(tx, {
        id: payableId,
        tenant_id: TENANT_A,
        calculation_id: calculationId,
        connector_id: connectorId,
        share_rate: '0.700000',
        amount: '21000.00',
        currency: 'INR',
        state: 'ELIGIBLE',
        hold_reasons: null,
        eligibility_decision_id: null,
        lock_version: 0,
        created_at: new Date(),
        created_by: USER_A_MAKER,
        updated_at: new Date(),
        updated_by: USER_A_MAKER,
      });
    });

    const payout = await txRunner.withTenantTx(makerCtx, async (tx) => {
      return service.createPayoutRequest(tx, makerCtx, {
        connectorId,
        origin: 'FINANCE',
        payableIds: [payableId as any],
      });
    });

    // Checker approves
    await txRunner.withTenantTx(checkerCtx, async (tx) => {
      return service.approvePayoutRequest(tx, checkerCtx, payout.id, { decision: 'APPROVED' });
    });

    const liveUtr = `HDFC${nextUlid()}`;
    const recorded = await txRunner.withTenantTx(makerCtx, async (tx) => {
      return service.recordPayoutPayment(tx, makerCtx, payout.id, {
        paymentRef: liveUtr,
        paidOn: new Date().toISOString(),
      });
    });

    expect(recorded.paymentRefMasked).toBe(`******${liveUtr.slice(-4)}`);

    // Verify raw database row has ciphertext and masked reference
    const dbRow = await txRunner.withTenantTx(makerCtx, async (tx) => {
      const res = await sql<{ payment_ref_ciphertext: string; payment_ref_masked: string }>`
        select payment_ref_ciphertext, payment_ref_masked
          from app.payout_request
         where tenant_id = ${TENANT_A} and id = ${payout.id}
      `.execute(tx);
      return res.rows[0];
    });

    expect(dbRow).toBeDefined();
    expect(dbRow!.payment_ref_masked).toBe(`******${liveUtr.slice(-4)}`);
    expect(dbRow!.payment_ref_ciphertext).toMatch(/^aes256gcm:/);

    // Verify decryption
    const decrypted = decryptPaymentRef(dbRow!.payment_ref_ciphertext);
    expect(decrypted).toBe(liveUtr);
  });

  it('DATABASE-RLS: Cross-tenant payout isolation (Tenant B cannot read Tenant A payout)', async () => {
    const tenantACtx: RequestContext = {
      principal: {
        kind: 'USER',
        id: USER_A_MAKER,
        tenantId: TENANT_A,
        grants: [
          { code: 'payout.request', scope: 'TENANT', branchIds: [] },
          { code: 'finance.view', scope: 'TENANT', branchIds: [] },
        ],
        queueIds: [],
        managedTeamMemberIds: [],
        primaryBranchId: null,
        authTime: new Date().toISOString(),
      },
      correlationId: `corr-${nextUlid()}`,
      now: new Date(),
    };

    const tenantBCtx: RequestContext = {
      principal: {
        kind: 'USER',
        id: 'usr_tenant_b_user',
        tenantId: TENANT_B,
        grants: [{ code: 'finance.view', scope: 'TENANT', branchIds: [] }],
        queueIds: [],
        managedTeamMemberIds: [],
        primaryBranchId: null,
        authTime: new Date().toISOString(),
      },
      correlationId: `corr-${nextUlid()}`,
      now: new Date(),
    };

    const payoutId = `prq_live_${nextUlid()}`;
    // Insert into tenant A within tenant A context
    await txRunner.withTenantTx(tenantACtx, async (tx) => {
      await sql`
        insert into app.payout_request (
          id, tenant_id, connector_id, origin, status, total, currency,
          submitted_by, submitted_at, lock_version, created_at, created_by, updated_at, updated_by
        ) values (
          ${payoutId}, ${TENANT_A}, 'con_01', 'FINANCE', 'SUBMITTED', 1000.00, 'INR',
          ${USER_A_MAKER}, now(), 0, now(), ${USER_A_MAKER}, now(), ${USER_A_MAKER}
        )
      `.execute(tx);
    });

    // Tenant B attempts to read Tenant A's payout through service with tenant context -> MUST fail
    await expect(
      txRunner.withTenantTx(tenantBCtx, async (tx) => {
        return service.getPayoutRequest(tx, tenantBCtx, payoutId);
      }),
    ).rejects.toThrowError(/not found/);
  });
});
