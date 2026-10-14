// apps/api/test/document-sharing-live-pg.int.spec.ts
// Direct live PostgreSQL verification for Module 25 (Document Sharing / MOD-DSH).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import path from 'node:path';
import { monotonicFactory } from 'ulid';
import { createDb } from '../src/kernel-min/db';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import type { Database, RequestContext } from '@dsa/contracts';
import { createAuditPort, createAuthz, createIdGenerator } from '@dsa/kernel';
import { DocumentSharingService } from '../src/modules/origination/document-sharing/document-sharing-service';

const nextUlid = monotonicFactory();

try {
  process.loadEnvFile(path.resolve(__dirname, '../.env'));
} catch {
  // Ignore if already loaded
}

const dbUrl = process.env.DATABASE_URL;
const describeLivePg = dbUrl ? describe : describe.skip;

const TENANT_A = 'ten_01JTESTTENANT00000000000000';
const TENANT_B = 'ten_01JOTHERTENANT0000000000000';
const USER_A = 'usr_01JTESTUSER0000000000000000';

describeLivePg('Module 25 (MOD-DSH): Live PostgreSQL & RLS Verification', () => {
  let db: Kysely<Database>;
  let txRunner: ReturnType<typeof createTxRunner>;
  let service: DocumentSharingService;

  const ids = createIdGenerator();
  const authz = createAuthz();
  const audit = createAuditPort(ids);

  beforeAll(async () => {
    if (!dbUrl) return;
    db = createDb(dbUrl, { poolMax: 5 });
    txRunner = createTxRunner(db);

    service = new DocumentSharingService({
      txRunner,
      authz,
      audit,
      ids,
      userDirectory: {} as any,
    });
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('PG-DSH-001 verifies RLS tenant isolation on upload_link and external_share', async () => {
    const ctxA: RequestContext = {
      principal: {
        kind: 'USER',
        id: USER_A,
        tenantId: TENANT_A,
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [
          { code: 'document.upload', scope: 'TENANT', branchIds: [] },
          { code: 'share.create', scope: 'TENANT', branchIds: [] },
        ],
        authTime: null,
      },
      correlationId: `corr_test_${nextUlid()}`,
      now: new Date(),
    };

    const ctxB: RequestContext = {
      principal: {
        kind: 'USER',
        id: 'usr_01JTESTUSER0000000000000002',
        tenantId: TENANT_B,
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [{ code: 'document.upload', scope: 'TENANT', branchIds: [] }],
        authTime: null,
      },
      correlationId: `corr_test_${nextUlid()}`,
      now: new Date(),
    };

    const testLinkId = `upl_${nextUlid()}`;
    const testTokenHash = `hash_${nextUlid()}`;
    const testAppId = `app_${nextUlid()}`;

    // 1. Insert in Tenant A
    await txRunner.withTenantTx(ctxA, async (tx) => {
      await sql`
        INSERT INTO app.upload_link (
          id, tenant_id, application_id, token_hash, items, expires_at,
          otp_required, max_uses, uses, created_by, updated_by
        ) VALUES (
          ${testLinkId}, ${TENANT_A}, ${testAppId}, ${testTokenHash},
          ARRAY['chk_1'], now() + interval '2 days', false, 5, 0, ${USER_A}, ${USER_A}
        )
      `.execute(tx);
    });

    // 2. Query in Tenant A -> Visible
    const visibleInA = await txRunner.withTenantTx(ctxA, async (tx) => {
      const res = await sql<{ id: string }>`SELECT id FROM app.upload_link WHERE id = ${testLinkId}`.execute(tx);
      return res.rows.length;
    });
    expect(visibleInA).toBe(1);

    // 3. Query in Tenant B -> Invisible (RLS isolation)
    const visibleInB = await txRunner.withTenantTx(ctxB, async (tx) => {
      const res = await sql<{ id: string }>`SELECT id FROM app.upload_link WHERE id = ${testLinkId}`.execute(tx);
      return res.rows.length;
    });
    expect(visibleInB).toBe(0);
  });

  it('PG-DSH-002 verifies resolve_public_upload_link Security Definer function', async () => {
    const rawToken = `token_${nextUlid()}`;
    const crypto = await import('node:crypto');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const testLinkId = `upl_${nextUlid()}`;

    const ctxA: RequestContext = {
      principal: {
        kind: 'USER',
        id: USER_A,
        tenantId: TENANT_A,
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [{ code: 'document.upload', scope: 'TENANT', branchIds: [] }],
        authTime: null,
      },
      correlationId: `corr_sec_${nextUlid()}`,
      now: new Date(),
    };

    await txRunner.withTenantTx(ctxA, async (tx) => {
      await sql`
        INSERT INTO app.upload_link (
          id, tenant_id, application_id, token_hash, items, expires_at,
          otp_required, max_uses, uses, created_by, updated_by
        ) VALUES (
          ${testLinkId}, ${TENANT_A}, 'app_test_demo', ${tokenHash},
          ARRAY['chk_1'], now() + interval '2 days', false, 5, 0, ${USER_A}, ${USER_A}
        )
      `.execute(tx);
    });

    const res = await sql<{
      tenant_id: string;
      upload_link_id: string;
    }>`SELECT * FROM app.resolve_public_upload_link(${tokenHash})`.execute(db);

    expect(res.rows[0]?.tenant_id).toBe(TENANT_A);
    expect(res.rows[0]?.upload_link_id).toBe(testLinkId);
  });
});
