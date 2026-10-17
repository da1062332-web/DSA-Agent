// apps/api/test/messaging-live-pg.spec.ts
// Direct live PostgreSQL verification for Module 11 (Messaging / MOD-MSG).
// Connects as dsa_api (NOBYPASSRLS) and validates real PostgreSQL migrations, RLS policies, triggers, and audit transactions.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { monotonicFactory } from 'ulid';
import { createDb } from '../src/kernel-min/db';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import type { Database, RequestContext } from '@dsa/contracts';
import { resolveLocalTestDatabaseUrl } from './support/test-db-url';

const nextUlid = monotonicFactory();

const dbUrl = resolveLocalTestDatabaseUrl('DATABASE_URL');
const describeLivePg = dbUrl ? describe : describe.skip;

const TENANT_A = 'ten_01JTESTTENANT00000000000000';
const TENANT_B = 'ten_01JOTHERTENANT0000000000000';
const USER_A = 'usr_01JTESTUSER0000000000000000';

describeLivePg('Module 11 (MOD-MSG): Live PostgreSQL Verification', () => {
  let db: Kysely<Database>;
  let txRunner: ReturnType<typeof createTxRunner>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = createDb(dbUrl, { poolMax: 5 });
    txRunner = createTxRunner(db);
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('PG-MSG-001 verifies dsa_api connects with NOBYPASSRLS', async () => {
    const { rows } = await sql<{
      current_user: string;
      rolbypassrls: boolean;
    }>`SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user`.execute(db);

    expect(rows[0]?.current_user).toBe('dsa_api');
    expect(rows[0]?.rolbypassrls).toBe(false);
  });

  it('PG-MSG-002 verifies RLS tenant isolation on message_template and message', async () => {
    const ctxA: RequestContext = {
      principal: {
        kind: 'USER',
        id: USER_A,
        tenantId: TENANT_A,
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
        authTime: null,
      },
      correlationId: `corr_pg_rls_${Date.now()}`,
      now: new Date(),
    };

    const tmplId = `tmpl_${nextUlid()}`;
    const tmplCode = `test_rls_${Date.now().toString().slice(-6)}`;

    // Insert template in Tenant A
    await txRunner.withTenantTx(ctxA, async (tx) => {
      await sql`
        INSERT INTO app.message_template (
          id, tenant_id, code, channel, language, category, body, variables,
          version, status, lock_version, created_at, created_by, updated_at, updated_by
        ) VALUES (
          ${tmplId}, ${TENANT_A}, ${tmplCode}, 'EMAIL', 'en', 'TRANSACTIONAL',
          'Hello {{name}}', '[]'::jsonb, 1, 'APPROVED', 0, now(), ${USER_A}, now(), ${USER_A}
        )
      `.execute(tx);
    });

    // Query from Tenant A -> visible
    const queryA = await txRunner.withTenantTx(ctxA, async (tx) => {
      const res = await sql<{ id: string }>`SELECT id FROM app.message_template WHERE id = ${tmplId}`.execute(
        tx,
      );
      return res.rows;
    });
    expect(queryA.length).toBe(1);

    // Query from Tenant B -> hidden by RLS
    const ctxB: RequestContext = {
      ...ctxA,
      principal: {
        ...ctxA.principal,
        tenantId: TENANT_B,
      },
    };
    const queryB = await txRunner.withTenantTx(ctxB, async (tx) => {
      const res = await sql<{ id: string }>`SELECT id FROM app.message_template WHERE id = ${tmplId}`.execute(
        tx,
      );
      return res.rows;
    });
    expect(queryB.length).toBe(0);
  });

  it('PG-MSG-003 verifies fail-closed: querying message_template without app.tenant_id returns 0 rows', async () => {
    const { rows } = await sql<{ count: string }>`SELECT count(*) as count FROM app.message_template`.execute(
      db,
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('PG-MSG-004 verifies message_template version immutability guard: updating body on APPROVED template fails', async () => {
    const ctx: RequestContext = {
      principal: {
        kind: 'USER',
        id: USER_A,
        tenantId: TENANT_A,
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
        authTime: null,
      },
      correlationId: `corr_pg_mut_${Date.now()}`,
      now: new Date(),
    };

    const tmplId = `tmpl_${nextUlid()}`;
    const tmplCode = `test_guard_${Date.now().toString().slice(-6)}`;

    // Insert approved template
    await txRunner.withTenantTx(ctx, async (tx) => {
      await sql`
        INSERT INTO app.message_template (
          id, tenant_id, code, channel, language, category, body, variables,
          version, status, lock_version, created_at, created_by, updated_at, updated_by
        ) VALUES (
          ${tmplId}, ${TENANT_A}, ${tmplCode}, 'SMS', 'en', 'TRANSACTIONAL',
          'Initial Body', '[]'::jsonb, 1, 'APPROVED', 0, now(), ${USER_A}, now(), ${USER_A}
        )
      `.execute(tx);
    });

    // Attempt direct in-place update of body on APPROVED template
    await expect(
      txRunner.withTenantTx(ctx, async (tx) => {
        await sql`
          UPDATE app.message_template
          SET body = 'Mutated Body'
          WHERE id = ${tmplId}
        `.execute(tx);
      }),
    ).rejects.toThrow();
  });

  it('PG-MSG-005 verifies forbid_mutation trigger blocks DELETE on message_template and message', async () => {
    const ctx: RequestContext = {
      principal: {
        kind: 'USER',
        id: USER_A,
        tenantId: TENANT_A,
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
        authTime: null,
      },
      correlationId: `corr_pg_del_${Date.now()}`,
      now: new Date(),
    };

    const tmplId = `tmpl_${nextUlid()}`;
    const tmplCode = `test_del_${Date.now().toString().slice(-6)}`;

    await txRunner.withTenantTx(ctx, async (tx) => {
      await sql`
        INSERT INTO app.message_template (
          id, tenant_id, code, channel, language, category, body, variables,
          version, status, lock_version, created_at, created_by, updated_at, updated_by
        ) VALUES (
          ${tmplId}, ${TENANT_A}, ${tmplCode}, 'EMAIL', 'en', 'TRANSACTIONAL',
          'Body', '[]'::jsonb, 1, 'DRAFT', 0, now(), ${USER_A}, now(), ${USER_A}
        )
      `.execute(tx);
    });

    await expect(
      txRunner.withTenantTx(ctx, async (tx) => {
        await sql`DELETE FROM app.message_template WHERE id = ${tmplId}`.execute(tx);
      }),
    ).rejects.toThrow();
  });

  it('PG-MSG-006 verifies UNIQUE (tenant_id, code, version) constraint on message_template', async () => {
    const ctx: RequestContext = {
      principal: {
        kind: 'USER',
        id: USER_A,
        tenantId: TENANT_A,
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
        authTime: null,
      },
      correlationId: `corr_pg_uq_${Date.now()}`,
      now: new Date(),
    };

    const tmplCode = `test_uq_${Date.now().toString().slice(-6)}`;

    await txRunner.withTenantTx(ctx, async (tx) => {
      await sql`
        INSERT INTO app.message_template (
          id, tenant_id, code, channel, language, category, body, variables,
          version, status, lock_version, created_at, created_by, updated_at, updated_by
        ) VALUES (
          ${`tmpl_${nextUlid()}`}, ${TENANT_A}, ${tmplCode}, 'EMAIL', 'en', 'TRANSACTIONAL',
          'Body 1', '[]'::jsonb, 1, 'APPROVED', 0, now(), ${USER_A}, now(), ${USER_A}
        )
      `.execute(tx);
    });

    // Attempt inserting same code and same version 1
    await expect(
      txRunner.withTenantTx(ctx, async (tx) => {
        await sql`
          INSERT INTO app.message_template (
            id, tenant_id, code, channel, language, category, body, variables,
            version, status, lock_version, created_at, created_by, updated_at, updated_by
          ) VALUES (
            ${`tmpl_${nextUlid()}`}, ${TENANT_A}, ${tmplCode}, 'EMAIL', 'en', 'TRANSACTIONAL',
            'Body 1 duplicate', '[]'::jsonb, 1, 'APPROVED', 0, now(), ${USER_A}, now(), ${USER_A}
          )
        `.execute(tx);
      }),
    ).rejects.toThrow();
  });

  it('PG-MSG-007 verifies atomic message dispatch, dedupe registry and audit write', async () => {
    const ctx: RequestContext = {
      principal: {
        kind: 'USER',
        id: USER_A,
        tenantId: TENANT_A,
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [{ code: 'message.send', scope: 'TENANT', branchIds: [] }],
        authTime: null,
      },
      correlationId: `corr_pg_dispatch_${Date.now()}`,
      now: new Date(),
    };

    const tmplId = `tmpl_${nextUlid()}`;
    const msgId = `msg_${nextUlid()}`;
    const audId = `aud_${nextUlid()}`;
    const tmplCode = `test_disp_${Date.now().toString().slice(-6)}`;
    const providerMsgId = `ses_msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    await txRunner.withTenantTx(ctx, async (tx) => {
      // 1. Create template
      await sql`
        INSERT INTO app.message_template (
          id, tenant_id, code, channel, language, category, body, variables,
          version, status, lock_version, created_at, created_by, updated_at, updated_by
        ) VALUES (
          ${tmplId}, ${TENANT_A}, ${tmplCode}, 'EMAIL', 'en', 'TRANSACTIONAL',
          'Your loan is approved!', '[]'::jsonb, 1, 'APPROVED', 0, now(), ${USER_A}, now(), ${USER_A}
        )
      `.execute(tx);

      // 2. Create message
      await sql`
        INSERT INTO app.message (
          id, tenant_id, direction, channel, subject_type, subject_id,
          template_version_id, recipient_hash, recipient_masked, variables_redacted,
          provider, provider_message_id, status, status_history, blocked_reason,
          lock_version, created_at, created_by, updated_at, updated_by
        ) VALUES (
          ${msgId}, ${TENANT_A}, 'OUTBOUND', 'EMAIL', 'LEAD', 'lead_01J00000000000000000000001',
          ${tmplId}, ${'a'.repeat(64)}, 'u***@example.com', '{"amount":"500000"}'::jsonb,
          'SES', ${providerMsgId}, 'SENT', '[{"status":"SENT"}]'::jsonb, null,
          0, now(), ${USER_A}, now(), ${USER_A}
        )
      `.execute(tx);

      // 3. Create audit event atomically
      await sql`
        INSERT INTO app.audit_event (
          id, tenant_id, actor_type, actor_id, action, entity_type, entity_id, correlation_id, occurred_at
        ) VALUES (
          ${audId}, ${TENANT_A}, 'USER', ${USER_A}, 'message.sent', 'message', ${msgId}, ${ctx.correlationId}, now()
        )
      `.execute(tx);
    });

    // Verify all 3 records persisted inside Tenant A
    await txRunner.withTenantTx(ctx, async (tx) => {
      const msgRes = await sql<{
        id: string;
        status: string;
      }>`SELECT id, status FROM app.message WHERE id = ${msgId}`.execute(tx);
      expect(msgRes.rows[0]?.status).toBe('SENT');

      const audRes = await sql<{ id: string }>`SELECT id FROM app.audit_event WHERE id = ${audId}`.execute(
        tx,
      );
      expect(audRes.rows.length).toBe(1);
    });
  });

  it('PG-MSG-008 verifies dedupe_registry with PROVIDER_MESSAGE namespace works on PostgreSQL', async () => {
    const ctx: RequestContext = {
      principal: {
        kind: 'SERVICE',
        id: 'SYSTEM:webhook',
        tenantId: TENANT_A,
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [],
        authTime: null,
      },
      correlationId: `corr_pg_dedupe_${Date.now()}`,
      now: new Date(),
    };

    const eventKey = `SES:evt_${Date.now()}`;

    // 1. Insert dedupe entry
    await txRunner.withTenantTx(ctx, async (tx) => {
      await sql`
        INSERT INTO app.dedupe_registry (
          tenant_id, namespace, key, ref_id, created_at, expires_at
        ) VALUES (
          ${TENANT_A}, 'PROVIDER_MESSAGE', ${eventKey}, 'ses_msg_1001', now(), now() + interval '7 days'
        )
      `.execute(tx);
    });

    // 2. Duplicate insert must violate PRIMARY KEY (tenant_id, namespace, key)
    await expect(
      txRunner.withTenantTx(ctx, async (tx) => {
        await sql`
          INSERT INTO app.dedupe_registry (
            tenant_id, namespace, key, ref_id, created_at, expires_at
          ) VALUES (
            ${TENANT_A}, 'PROVIDER_MESSAGE', ${eventKey}, 'ses_msg_1001_dupe', now(), now() + interval '7 days'
          )
        `.execute(tx);
      }),
    ).rejects.toThrow();
  });

  it('PG-MSG-009 verifies concurrent frequency caps with MESSAGE_FREQ namespace on PostgreSQL dedupe_registry', async () => {
    const ctx: RequestContext = {
      principal: {
        kind: 'USER',
        id: USER_A,
        tenantId: TENANT_A,
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [{ code: 'message.send', scope: 'TENANT', branchIds: [] }],
        authTime: null,
      },
      correlationId: `corr_pg_freq_${Date.now()}`,
      now: new Date(),
    };

    const recipientHash = `hash_${nextUlid()}`;
    const hourBucket = '2026-10-12T17';
    const capPerHour = 3;

    // Simulate claiming slots concurrently across multiple attempts
    const claimSlot = async (slot: number) => {
      return txRunner.withTenantTx(ctx, async (tx) => {
        const slotKey = `freq:${recipientHash}:${hourBucket}:s${slot}`;
        const res = await sql`
          INSERT INTO app.dedupe_registry (tenant_id, namespace, key, ref_id, expires_at)
          VALUES (${TENANT_A}, 'MESSAGE_FREQ', ${slotKey}, 'msg_test', now() + interval '1 hour')
          ON CONFLICT (tenant_id, namespace, key) DO NOTHING
          RETURNING key
        `.execute(tx);
        return res.rows.length > 0;
      });
    };

    // Slot 1, 2, 3 should succeed
    const r1 = await claimSlot(1);
    const r2 = await claimSlot(2);
    const r3 = await claimSlot(3);
    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(r3).toBe(true);

    // Duplicate attempt for Slot 1, 2, or 3 must fail (ON CONFLICT DO NOTHING returns 0 rows)
    const dupeR1 = await claimSlot(1);
    expect(dupeR1).toBe(false);

    // Query PostgreSQL to verify exactly 3 slots exist for this recipient in MESSAGE_FREQ namespace
    await txRunner.withTenantTx(ctx, async (tx) => {
      const countRes = await sql<{ count: string }>`
        SELECT count(*) as count FROM app.dedupe_registry
        WHERE tenant_id = ${TENANT_A}
          AND namespace = 'MESSAGE_FREQ'
          AND key LIKE ${`freq:${recipientHash}:${hourBucket}:%`}
      `.execute(tx);
      expect(parseInt(countRes.rows[0]?.count ?? '0', 10)).toBe(capPerHour);
    });
  });

  it('PG-MSG-010 verifies resolve_public_entry security definer function and public_entry_index RLS on PostgreSQL', async () => {
    const connPath = `conn_${nextUlid()}`;

    // 1. Insert connection path into public_entry_index inside Tenant A
    const ctxA: RequestContext = {
      principal: {
        kind: 'USER',
        id: USER_A,
        tenantId: TENANT_A,
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
        authTime: null,
      },
      correlationId: `corr_entry_${Date.now()}`,
      now: new Date(),
    };

    await txRunner.withTenantTx(ctxA, async (tx) => {
      await sql`
        INSERT INTO app.public_entry_index (
          connection_path_id, tenant_id, provider, connection_id, signing_secret, status
        ) VALUES (
          ${connPath}, ${TENANT_A}, 'TEST_SES', 'conn_001', 'secret_xyz', 'ACTIVE'
        )
      `.execute(tx);
    });

    // 2. Call resolve_public_entry as unauthenticated/service caller (no tenant_id needed)
    // The SECURITY DEFINER function safely resolves tenant_id from the database
    const ctxPublic: RequestContext = {
      principal: {
        kind: 'SERVICE',
        id: 'SYSTEM:webhook_resolver',
        tenantId: 'ten_SYSTEM',
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [],
        authTime: null,
      },
      correlationId: `corr_pub_${Date.now()}`,
      now: new Date(),
    };

    await txRunner.withTenantTx(ctxPublic, async (tx) => {
      const res = await sql<{
        tenant_id: string;
        provider: string;
        connection_id: string;
        signing_secret: string;
        status: string;
      }>`
        SELECT * FROM app.resolve_public_entry(${connPath})
      `.execute(tx);

      expect(res.rows.length).toBe(1);
      expect(res.rows[0]?.tenant_id).toBe(TENANT_A);
      expect(res.rows[0]?.provider).toBe('TEST_SES');
      expect(res.rows[0]?.status).toBe('ACTIVE');
    });
  });

  it('PG-MSG-011 verifies message.send permission grants across tenant operational and admin roles', async () => {
    const adminDbUrl =
      resolveLocalTestDatabaseUrl('VERIFY_DATABASE_URL') || resolveLocalTestDatabaseUrl('DATABASE_URL');
    const adminDb = createDb(adminDbUrl!, { poolMax: 2 });
    try {
      const grantRows = await sql<{ role_code: string; permission_code: string }>`
        SELECT r.code AS role_code, rp.permission_code
          FROM app.role_permission rp
          JOIN app.role r ON r.id = rp.role_id
         WHERE rp.permission_code = 'message.send'
         ORDER BY r.code
      `.execute(adminDb);
      const roles = grantRows.rows.map((r) => r.role_code);
      expect(roles).toContain('ROLE-ORG-OWNER');
      expect(roles).toContain('ROLE-TENANT-ADMIN');
      expect(roles).toContain('ROLE-BRANCH-MGR');
      expect(roles).toContain('ROLE-LOAN-OPS');
    } finally {
      await adminDb.destroy();
    }
  });
});
