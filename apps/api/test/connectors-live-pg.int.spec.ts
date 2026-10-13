// apps/api/test/connectors-live-pg.int.spec.ts
// Direct live PostgreSQL verification for Module 27 (Connector Management / MOD-CON).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import path from 'node:path';
import { monotonicFactory } from 'ulid';
import { createDb } from '../src/kernel-min/db';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import type { Database, RequestContext } from '@dsa/contracts';
import { createAuditPort, createAuthz, createIdGenerator } from '@dsa/kernel';
import { ConnectorService } from '../src/modules/origination/connectors/connector-service';

const nextUlid = monotonicFactory();

try {
  process.loadEnvFile(path.resolve(__dirname, '../.env'));
} catch {
  // Ignore if already loaded
}

const dbUrl = process.env.DATABASE_URL;
const describeLivePg = dbUrl ? describe : describe.skip;

const TENANT_A = 'ten_01JTESTTENANT00000000000000';
const USER_A = 'usr_01JTESTUSER0000000000000000';
let branchA: string;
let approverUserId: string;

describeLivePg('Module 27 (MOD-CON): Live PostgreSQL & RLS Verification', () => {
  let db: Kysely<Database>;
  let txRunner: ReturnType<typeof createTxRunner>;
  let service: ConnectorService;

  const ids = createIdGenerator();
  const authz = createAuthz();
  const audit = createAuditPort(ids);

  beforeAll(async () => {
    if (!dbUrl) return;
    db = createDb(dbUrl, { poolMax: 5 });
    txRunner = createTxRunner(db);

    service = new ConnectorService({
      txRunner,
      authz,
      audit,
      ids,
      userDirectory: {} as any,
    });

    const ctxSetup: RequestContext = {
      principal: {
        kind: 'USER',
        id: USER_A,
        tenantId: TENANT_A,
        grants: [{ code: 'connector.manage', scope: 'TENANT', branchIds: [] }],
        queueIds: [],
        managedTeamMemberIds: [],
        primaryBranchId: null,
        authTime: null,
      },
      correlationId: `setup_${nextUlid()}`,
      now: new Date(),
    };

    await txRunner.withTenantTx(ctxSetup, async (tx) => {
      // Find existing branch or create one
      const bRes = await sql<{ id: string }>`SELECT id FROM app.branch WHERE tenant_id = ${TENANT_A} LIMIT 1`.execute(tx);
      if (bRes.rows.length > 0 && bRes.rows[0]) {
        branchA = bRes.rows[0].id;
      } else {
        // Find or create organisation
        let orgId = 'org_01JTESTORG0000000000000000';
        await sql`
          INSERT INTO app.organisation (id, tenant_id, legal_name, constitution, status, lock_version, created_by, updated_by)
          VALUES (${orgId}, ${TENANT_A}, 'Test Org', 'PVT_LTD', 'ACTIVE', 0, ${USER_A}, ${USER_A})
          ON CONFLICT (tenant_id, id) DO NOTHING
        `.execute(tx);

        branchA = `br_${nextUlid()}`;
        await sql`
          INSERT INTO app.branch (id, tenant_id, organisation_id, name, code, pincode, status, lock_version, created_by, updated_by)
          VALUES (${branchA}, ${TENANT_A}, ${orgId}, 'Test Branch', ${`B${nextUlid().slice(-5)}`}, '400001', 'ACTIVE', 0, ${USER_A}, ${USER_A})
        `.execute(tx);
      }

      // Find or create separate approver user
      approverUserId = `usr_${nextUlid()}`;
      await sql`
        INSERT INTO app.app_user (id, tenant_id, idp_subject, email, display_name, user_type, status, availability, primary_branch_id, lock_version, created_by, updated_by)
        VALUES (${approverUserId}, ${TENANT_A}, ${`idp_${nextUlid()}`}, ${`approver_${nextUlid().slice(-6)}@dsa.com`}, 'Finance Approver', 'STAFF', 'ACTIVE', 'AVAILABLE', ${branchA}, 0, ${USER_A}, ${USER_A})
      `.execute(tx);
    });
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('PG-CON-001 creates a connector in live PostgreSQL with encrypted PAN and masked PAN', async () => {
    const ctx: RequestContext = {
      principal: {
        kind: 'USER',
        id: USER_A,
        tenantId: TENANT_A,
        grants: [
          { code: 'connector.manage', scope: 'TENANT', branchIds: [] },
          { code: 'connector.read', scope: 'TENANT', branchIds: [] },
        ],
        queueIds: [],
        managedTeamMemberIds: [],
        primaryBranchId: branchA,
        authTime: null,
      },
      correlationId: `req_${nextUlid()}`,
      now: new Date(),
    };

    const uniqueNum = String(Math.floor(1000 + Math.random() * 9000));
    const pan = `ABCDE${uniqueNum}F`;

    const { connector } = await service.createConnector(
      ctx,
      {
        connectorType: 'INDIVIDUAL',
        legalName: 'Live Partner Financials',
        contactPerson: 'Suresh Kumar',
        mobileE164: '+919876543210',
        email: `suresh_${uniqueNum}@partner.com`,
        pan,
        primaryBranchId: branchA,
        relationshipOwnerUserId: USER_A,
      },
      `idem_${nextUlid()}`,
    );

    expect(connector.id).toMatch(/^con_/);
    expect(connector.status).toBe('DRAFT');
    expect(connector.panMasked).toBe(`ABCDE****F`);

    // Verify plaintext PAN is NOT stored directly in database column
    await txRunner.withTenantTx(ctx, async (tx) => {
      const row = await sql<{ encrypted_pan: Buffer; pan_masked: string }>`
        SELECT encrypted_pan, pan_masked FROM app.connector WHERE id = ${connector.id}
      `.execute(tx);
      expect(row.rows.length).toBe(1);
      const firstRow = row.rows[0]!;
      expect(firstRow.pan_masked).toBe('ABCDE****F');
      expect(Buffer.isBuffer(firstRow.encrypted_pan)).toBe(true);
      expect(firstRow.encrypted_pan.toString('utf8')).not.toBe(pan);
    });
  });

  it('PG-CON-002 verifies Bank Account approval dual-control SOD and cooling period in Postgres', async () => {
    const ctxMaker: RequestContext = {
      principal: {
        kind: 'USER',
        id: USER_A,
        tenantId: TENANT_A,
        grants: [
          { code: 'connector.manage', scope: 'TENANT', branchIds: [] },
          { code: 'connector.read', scope: 'TENANT', branchIds: [] },
          { code: 'connector.bank_change_approve', scope: 'TENANT', branchIds: [] },
        ],
        queueIds: [],
        managedTeamMemberIds: [],
        primaryBranchId: branchA,
        authTime: null,
      },
      correlationId: `req_${nextUlid()}`,
      now: new Date(),
    };

    const ctxApprover: RequestContext = {
      ...ctxMaker,
      principal: {
        ...ctxMaker.principal,
        id: approverUserId, // Separate approver!
      },
    };

    const uniqueNum = String(Math.floor(1000 + Math.random() * 9000));
    const { connector } = await service.createConnector(
      ctxMaker,
      {
        connectorType: 'PVT_LTD',
        legalName: 'Apex Capital Advisors Pvt Ltd',
        contactPerson: 'Anjali Gupta',
        mobileE164: '+919811223344',
        email: `anjali_${uniqueNum}@apex.com`,
        pan: `XYZPQ${uniqueNum}K`,
        primaryBranchId: branchA,
        relationshipOwnerUserId: USER_A,
      },
      `idem_${nextUlid()}`,
    );

    // 1. Submit bank account (created by USER_A)
    const { bankAccount } = await service.createBankAccount(
      ctxMaker,
      connector.id,
      {
        accountHolderName: 'Apex Capital Advisors Pvt Ltd',
        accountNumber: '98765432109876',
        ifscCode: 'ICIC0001234',
      },
      `idem_${nextUlid()}`,
    );

    expect(bankAccount.status).toBe('PENDING_APPROVAL');
    expect(bankAccount.accountMasked).toBe('**********9876');

    // 2. USER_A attempts self-approval -> Throws SOD error!
    await expect(
      service.approveBankAccount(ctxMaker, connector.id, bankAccount.id, { remarks: 'Self approval' }),
    ).rejects.toThrow('Separation of Duties (SOD)');

    // 3. Separate approver USER_APPROVER approves -> Succeeds and sets cooling period
    const approved = await service.approveBankAccount(
      ctxApprover,
      connector.id,
      bankAccount.id,
      { remarks: 'Finance verification complete' },
    );

    expect(approved.status).toBe('ACTIVE');
    expect(approved.approvedBy).toBe(approverUserId);
    expect(approved.coolingUntil).toBeDefined();
  });

  it('PG-CON-003 executes attribution change request and safely updates lead attribution in Postgres', async () => {
    const ctxMaker: RequestContext = {
      principal: {
        kind: 'USER',
        id: USER_A,
        tenantId: TENANT_A,
        grants: [
          { code: 'connector.manage', scope: 'TENANT', branchIds: [] },
          { code: 'connector.attribution_change', scope: 'TENANT', branchIds: [] },
          { code: 'connector.read', scope: 'TENANT', branchIds: [] },
        ],
        queueIds: [],
        managedTeamMemberIds: [],
        primaryBranchId: branchA,
        authTime: null,
      },
      correlationId: `req_${nextUlid()}`,
      now: new Date(),
    };

    const ctxApprover: RequestContext = {
      ...ctxMaker,
      principal: {
        ...ctxMaker.principal,
        id: approverUserId,
      },
    };

    // Create a connector
    const { connector } = await service.createConnector(
      ctxMaker,
      {
        connectorType: 'INDIVIDUAL',
        legalName: 'Amit Verma DSA',
        contactPerson: 'Amit Verma',
        mobileE164: '+919822334455',
        email: `amit_${nextUlid().slice(-6)}@dsa.com`,
        pan: `PANAM${String(Math.floor(1000 + Math.random() * 9000))}X`,
        primaryBranchId: branchA,
        relationshipOwnerUserId: USER_A,
      },
      `idem_${nextUlid()}`,
    );

    // Set connector to ACTIVE in DB directly for test
    await txRunner.withTenantTx(ctxMaker, async (tx) => {
      await sql`UPDATE app.connector SET status = 'ACTIVE' WHERE id = ${connector.id}`.execute(tx);
    });

    // Create a test lead in TENANT_A
    const leadId = `lead_${nextUlid()}`;
    await txRunner.withTenantTx(ctxMaker, async (tx) => {
      await sql`
        INSERT INTO app.lead (
          id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash,
          email, email_hash, source, owner_user_id, priority, product_category, lock_version,
          created_at, created_by, updated_at, updated_by
        ) VALUES (
          ${leadId}, ${TENANT_A}, ${branchA}, 'Test Borrower', '+919711223344', '\x1122',
          'borrower@example.com', '\x3344', 'REFERRAL', ${USER_A}, 'MEDIUM', 'HL', 0,
          now(), ${USER_A}, now(), ${USER_A}
        )
      `.execute(tx);
    });

    // 1. Submit attribution change request
    const { request } = await service.createAttributionChangeRequest(
      ctxMaker,
      {
        leadId,
        proposedConnectorId: connector.id,
        reason: 'Customer confirms Amit Verma made the referral introduction',
        evidenceRef: 'upl_referral_mandate_01',
      },
      `idem_${nextUlid()}`,
    );

    expect(request.status).toBe('PENDING');

    // 2. Self-approval by USER_A throws SOD-09
    await expect(
      service.approveAttributionChangeRequest(ctxMaker, request.id, { remarks: 'Self approve' }, 0),
    ).rejects.toThrow('SOD-09');

    // 3. Separate approver approves -> Calls apply_attribution_change
    const approved = await service.approveAttributionChangeRequest(
      ctxApprover,
      request.id,
      { remarks: 'Verified with borrower' },
      0,
    );

    expect(approved.status).toBe('APPROVED');
    expect(approved.approverId).toBe(approverUserId);

    // 4. Assert that lead attribution was atomically updated in Postgres!
    await txRunner.withTenantTx(ctxApprover, async (tx) => {
      const leadRow = await sql<{ connector_id: string }>`
        SELECT connector_id FROM app.lead WHERE id = ${leadId}
      `.execute(tx);
      expect(leadRow.rows[0]?.connector_id).toBe(connector.id);
    });
  });
});
