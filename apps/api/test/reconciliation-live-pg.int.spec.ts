// apps/api/test/reconciliation-live-pg.int.spec.ts
// Direct live PostgreSQL & RLS verification for MOD-REC (Reconciliation Management, Domain DOM-K).
import type { Database, RequestContext } from '@dsa/contracts';
import { createAuditPort, createAuthz, createIdGenerator } from '@dsa/kernel';
import { sql, type Kysely } from 'kysely';
import crypto from 'node:crypto';
import path from 'node:path';
import { monotonicFactory } from 'ulid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/kernel-min/db';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { ReconciliationService } from '../src/modules/reconciliation/reconciliation-service';
import { PgReconciliationRepository } from '../src/modules/reconciliation/repository';

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

describeLivePg('MOD-REC: Live PostgreSQL & RLS Verification', () => {
  let db: Kysely<Database>;
  let adminDb: Kysely<Database>;
  let txRunner: ReturnType<typeof createTxRunner>;
  let service: ReconciliationService;
  let repository: PgReconciliationRepository;

  const ids = createIdGenerator();
  const authz = createAuthz();
  const audit = createAuditPort(ids);

  beforeAll(async () => {
    if (!dbUrl) return;
    db = createDb(dbUrl, { poolMax: 5 });
    adminDb = createDb(adminDbUrl!, { poolMax: 2 });
    txRunner = createTxRunner(db);
    repository = new PgReconciliationRepository();

    service = new ReconciliationService({
      repository,
      audit,
    });

    // Ensure test tenants exist
    await sql`
      insert into app.tenant (id, slug, legal_name, tenant_type, data_region, timezone, status, created_at, created_by)
      values 
        (${TENANT_A}, 'test-tenant-rec-a', 'Test Tenant Rec A', 'DSA_ORG', 'ap-south-1', 'Asia/Kolkata', 'ACTIVE', now(), 'SYSTEM'),
        (${TENANT_B}, 'test-tenant-rec-b', 'Test Tenant Rec B', 'DSA_ORG', 'ap-south-1', 'Asia/Kolkata', 'ACTIVE', now(), 'SYSTEM')
      on conflict (id) do nothing
    `.execute(adminDb);

    // Ensure test lenders exist
    await sql`
      insert into app.lender (id, tenant_id, name, lender_type, status, created_at, created_by, updated_at, updated_by)
      values 
        ('lnd_live_test', ${TENANT_A}, 'Live Test Bank A', 'BANK', 'ACTIVE', now(), 'SYSTEM', now(), 'SYSTEM'),
        ('lnd_iso_test_a', ${TENANT_A}, 'ISO Test Bank A', 'BANK', 'ACTIVE', now(), 'SYSTEM', now(), 'SYSTEM'),
        ('lnd_iso_test_b', ${TENANT_B}, 'ISO Test Bank B', 'BANK', 'ACTIVE', now(), 'SYSTEM', now(), 'SYSTEM'),
        ('lnd_match_test', ${TENANT_A}, 'Match Test Bank A', 'BANK', 'ACTIVE', now(), 'SYSTEM', now(), 'SYSTEM')
      on conflict (id) do nothing
    `.execute(adminDb);
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (adminDb) await adminDb.destroy();
  });

  function contextFor(tenantId: string, userId: string, grants: string[] = []): RequestContext {
    return {
      correlationId: `corr_${nextUlid()}`,
      ip: '127.0.0.1',
      userAgent: 'reconciliation-live-test',
      now: new Date(),
      principal: {
        id: userId,
        tenantId,
        kind: 'USER',
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        authTime: null,
        grants: grants.map((code) => ({ code: code as any, scope: 'TENANT' as const, branchIds: [] })),
      },
    };
  }

  it('INT-REC-001: Verifies Migration 0048 schema & permissions on live PostgreSQL', async () => {
    const tables = await sql<{ table_name: string }>`
      select table_name 
      from information_schema.tables 
      where table_schema = 'app' 
        and table_name in ('lender_statement', 'lender_statement_line', 'reconciliation_match', 'reconciliation_exception', 'dispute')
      order by table_name;
    `.execute(adminDb);

    const names = tables.rows.map((r) => r.table_name);
    expect(names).toContain('lender_statement');
    expect(names).toContain('lender_statement_line');
    expect(names).toContain('reconciliation_match');
    expect(names).toContain('reconciliation_exception');
    expect(names).toContain('dispute');
  });

  it('INT-REC-002: Imports lender statement and persists masked lines to live DB', async () => {
    const ctxA = contextFor(TENANT_A, USER_A_MAKER, ['finance.reconcile']);
    const period = `2026-${Math.floor(Math.random() * 80 + 10)}`;
    const fileSha256 = crypto
      .createHash('sha256')
      .update(Date.now() + nextUlid())
      .digest('hex');

    const imported = await txRunner.withTenantTx(ctxA, async (tx) => {
      return service.importLenderStatement(tx, ctxA, {
        lenderId: 'lnd_live_test',
        period,
        sourceFileKey: 'test/file.csv',
        importBatchId: 'batch_' + nextUlid(),
        fileSha256,
        lines: [
          {
            loanAccount: 'LOAN_LIVE_998877',
            customerName: 'Amitabh Bachchan',
            disbursedAmount: 1000000,
            commissionAmount: 15000,
            taxDeducted: 0,
            paidOn: '2026-09-15',
          },
        ],
      });
    });

    expect(imported.id).toBeDefined();
    expect(imported.totals.lineCount).toBe(1);

    // Verify stored data in DB: customer_name must be S2 masked, loan_account must not be plaintext
    const lineRow = await sql<{ customer_name_masked: string; loan_account_hash: string }>`
      select customer_name_masked, loan_account_hash 
      from app.lender_statement_line 
      where statement_id = ${imported.id}
    `.execute(adminDb);

    const firstRow = lineRow.rows[0]!;
    expect(firstRow.customer_name_masked).toContain('***');
    expect(firstRow.customer_name_masked).not.toBe('Amitabh Bachchan');
    expect(firstRow.loan_account_hash).toBeDefined();
    expect(firstRow.loan_account_hash).not.toBe('LOAN_LIVE_998877');
  });

  it('INT-REC-003: Enforces tenant isolation (RLS) on lender statements and lines', async () => {
    const ctxA = contextFor(TENANT_A, USER_A_MAKER, ['finance.reconcile', 'finance.view']);
    const ctxB = contextFor(TENANT_B, 'usr_b_maker', ['finance.reconcile', 'finance.view']);

    const period = `2026-${Math.floor(Math.random() * 80 + 10)}`;
    const fileSha256 = crypto
      .createHash('sha256')
      .update(Date.now() + nextUlid())
      .digest('hex');

    const statementA = await txRunner.withTenantTx(ctxA, async (tx) => {
      return service.importLenderStatement(tx, ctxA, {
        lenderId: 'lnd_iso_test_a',
        period,
        sourceFileKey: 'test/iso.csv',
        importBatchId: 'batch_' + nextUlid(),
        fileSha256,
        lines: [
          {
            loanAccount: 'LOAN_ISO_112233',
            customerName: 'Tenant A Customer',
            disbursedAmount: 500000,
            commissionAmount: 10000,
            taxDeducted: 0,
            paidOn: '2026-09-15',
          },
        ],
      });
    });

    // Query from Tenant B under RLS
    const stmtsForB = await txRunner.withTenantTx(ctxB, async (tx) => {
      return repository.listLenderStatements(tx, TENANT_B, 'lnd_iso_test_a');
    });

    // Statement A must be invisible to Tenant B
    expect(stmtsForB.find((s) => s.id === statementA.id)).toBeUndefined();
  });

  it('INT-REC-004: Enforces partial unique constraint uq_active_match_per_line', async () => {
    const ctxA = contextFor(TENANT_A, USER_A_MAKER, ['finance.reconcile']);
    const period = `2026-${Math.floor(Math.random() * 80 + 10)}`;
    const fileSha256 = crypto
      .createHash('sha256')
      .update(Date.now() + nextUlid())
      .digest('hex');

    const statement = await txRunner.withTenantTx(ctxA, async (tx) => {
      return service.importLenderStatement(tx, ctxA, {
        lenderId: 'lnd_match_test',
        period,
        sourceFileKey: 'test/match.csv',
        importBatchId: 'batch_' + nextUlid(),
        fileSha256,
        lines: [
          {
            loanAccount: 'LOAN_MATCH_999',
            customerName: 'Match Test Customer',
            disbursedAmount: 200000,
            commissionAmount: 2000,
            taxDeducted: 0,
            paidOn: '2026-09-15',
          },
        ],
      });
    });

    const lines = await txRunner.withTenantTx(ctxA, async (tx) => {
      return repository.listStatementLines(tx, TENANT_A, statement.id);
    });
    const lineId = lines[0]!.id;

    // Insert a valid commission calculation to satisfy FK
    const calcId = 'ccal_' + nextUlid();
    await sql`
      insert into app.commission_calculation (
        id, tenant_id, lender_id, tranche_id, event_date, basis_amount, rate, gross_amount, created_by, updated_by
      ) values (
        ${calcId}, ${TENANT_A}, 'lnd_match_test', ${'trn_' + nextUlid()}, '2026-09-15', 200000, 1.0, 2000, 'SYSTEM', 'SYSTEM'
      )
    `.execute(adminDb);

    // Direct insert of first active match
    await sql`
      insert into app.reconciliation_match (
        id, tenant_id, statement_line_id, calculation_id,
        matched_amount, status, match_type, created_at, created_by
      ) values (
        ${'rmt_' + nextUlid()}, ${TENANT_A}, ${lineId}, ${calcId},
        2000, 'ACTIVE', 'EXACT', now(), ${USER_A_MAKER}
      )
    `.execute(adminDb);

    // Attempt second active match on same statement_line_id — must fail with 23505 unique violation
    let failed = false;
    try {
      await sql`
        insert into app.reconciliation_match (
          id, tenant_id, statement_line_id, calculation_id,
          matched_amount, status, match_type, created_at, created_by
        ) values (
          ${'rmt_' + nextUlid()}, ${TENANT_A}, ${lineId}, ${calcId},
          2000, 'ACTIVE', 'VARIANCE', now(), ${USER_A_MAKER}
        )
      `.execute(adminDb);
    } catch (err: any) {
      failed = true;
      expect(err.message).toContain('uq_active_match_per_line');
    }
    expect(failed).toBe(true);
  });
});
