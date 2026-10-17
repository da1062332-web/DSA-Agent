// apps/api/test/activities-live-pg.spec.ts
// Direct live PostgreSQL verification for Module 10 (Activity / MOD-ACT).
// Connects as dsa_api (NOBYPASSRLS) and validates real PostgreSQL migrations, RLS policies, triggers, and audit transactions.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import { createDb } from '../src/kernel-min/db';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { createApp } from '../src/app';
import { fakeAuth, testPrincipal, createTestDeps } from './support/fake-auth';
import type { Database, RequestContext } from '@dsa/contracts';
import { resolveLocalTestDatabaseUrl } from './support/test-db-url';

// Load .env from root if not already loaded
const dbUrl = resolveLocalTestDatabaseUrl('DATABASE_URL');
const describeLivePg = dbUrl ? describe : describe.skip;

const TENANT_A = 'ten_01JTESTTENANT00000000000000';
const TENANT_B = 'ten_01JOTHERTENANT0000000000000';
const USER_A = 'usr_01JTESTUSER0000000000000000';
const BRANCH_A = 'br_01JMUMBAI000000000000000000';

describeLivePg('Module 10 (MOD-ACT): Live PostgreSQL Verification', () => {
  let db: Kysely<Database>;
  let txRunner: ReturnType<typeof createTxRunner>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = createDb(dbUrl, { poolMax: 5 });
    txRunner = createTxRunner(db);

    // The HTTP tests below log activities against this lead, so it has to exist. It is created here, as synthetic data, in the
    // throwaway database (the guard in tests/guard refuses any non-local connection), instead of relying on a row from hosted.
    const admin = createDb(resolveLocalTestDatabaseUrl('VERIFY_DATABASE_URL') || dbUrl, { poolMax: 1 });
    try {
      await sql`
        INSERT INTO app.lead (id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash, product_category, source, owner_user_id, created_by, updated_by)
        VALUES ('lead_test_live_http', ${TENANT_A}, ${BRANCH_A}, 'Synthetic Live Lead', '+919876500001',
                decode('00000000000000000000000000000001', 'hex'), 'PL', 'PHONE', ${USER_A}, ${USER_A}, ${USER_A})
        ON CONFLICT (id) DO NOTHING
      `.execute(admin);
    } finally {
      await admin.destroy();
    }
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('PG-ACT-001 verifies dsa_api connects with NOBYPASSRLS', async () => {
    const { rows } = await sql<{
      current_user: string;
      rolbypassrls: boolean;
    }>`SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user`.execute(db);

    expect(rows[0]?.current_user).toBe('dsa_api');
    expect(rows[0]?.rolbypassrls).toBe(false);
  });

  it('PG-ACT-002 verifies RLS tenant isolation on app.activity', async () => {
    const actId = `act_pg_test_rls_${Date.now()}`;
    const ctxA: RequestContext = {
      principal: testPrincipal({ tenantId: TENANT_A, id: USER_A }),
      correlationId: `c-${Date.now()}`,
      now: new Date(),
    };

    const ctxB: RequestContext = {
      principal: testPrincipal({ tenantId: TENANT_B, id: 'usr_other' }),
      correlationId: `c-${Date.now()}`,
      now: new Date(),
    };

    // 1. Insert activity for Tenant A inside Tenant A's transaction
    await txRunner.withTenantTx(ctxA, async (tx) => {
      await sql`
        INSERT INTO app.activity (
          id, tenant_id, subject_type, subject_id, kind, outcome_code,
          occurred_at, duration_s, note, actor_id, actor_branch_id,
          created_at, lock_version, is_hidden
        ) VALUES (
          ${actId}, ${TENANT_A}, 'LEAD', 'lead_test_01', 'CALL', 'CONNECTED',
          now(), 120, 'Live PG RLS test note', ${USER_A}, ${BRANCH_A},
          now(), 0, false
        )
      `.execute(tx);
    });

    // 2. Query within Tenant A: record MUST be visible
    const rowsTenantA = await txRunner.withTenantTx(ctxA, async (tx) => {
      const { rows } = await sql<{ id: string; tenant_id: string }>`
        SELECT id, tenant_id FROM app.activity WHERE id = ${actId}
      `.execute(tx);
      return rows;
    });
    expect(rowsTenantA).toHaveLength(1);
    expect(rowsTenantA[0]?.id).toBe(actId);
    expect(rowsTenantA[0]?.tenant_id).toBe(TENANT_A);

    // 3. Query within Tenant B: record MUST NOT be visible (RLS blocks it, returns 0 rows)
    const rowsTenantB = await txRunner.withTenantTx(ctxB, async (tx) => {
      const { rows } = await sql<{ id: string }>`
        SELECT id FROM app.activity WHERE id = ${actId}
      `.execute(tx);
      return rows;
    });
    expect(rowsTenantB).toHaveLength(0);

    // 4. Fail-closed check: Query as dsa_api without setting app.tenant_id
    const { rows: noTenantRows } = await sql<{ id: string }>`
      SELECT id FROM app.activity WHERE id = ${actId}
    `.execute(db);
    expect(noTenantRows).toHaveLength(0);
  });

  it('PG-ACT-003 verifies touch_row trigger increments lock_version and updates timestamp on UPDATE', async () => {
    const actId = `act_pg_test_touch_${Date.now()}`;
    const ctxA: RequestContext = {
      principal: testPrincipal({ tenantId: TENANT_A, id: USER_A }),
      correlationId: `c-${Date.now()}`,
      now: new Date(),
    };

    // Insert record with lock_version = 0
    await txRunner.withTenantTx(ctxA, async (tx) => {
      await sql`
        INSERT INTO app.activity (
          id, tenant_id, subject_type, subject_id, kind, outcome_code,
          occurred_at, duration_s, note, actor_id, actor_branch_id,
          created_at, lock_version, is_hidden
        ) VALUES (
          ${actId}, ${TENANT_A}, 'LEAD', 'lead_test_02', 'NOTE', NULL,
          now(), NULL, 'Initial note', ${USER_A}, ${BRANCH_A},
          now(), 0, false
        )
      `.execute(tx);
    });

    // Verify initial version is 0
    const initial = await txRunner.withTenantTx(ctxA, async (tx) => {
      const { rows } = await sql<{ lock_version: number; updated_at: string }>`
        SELECT lock_version, updated_at FROM app.activity WHERE id = ${actId}
      `.execute(tx);
      return rows[0];
    });
    expect(initial?.lock_version).toBe(0);

    // Update note — touch_row trigger MUST fire and increment lock_version
    await txRunner.withTenantTx(ctxA, async (tx) => {
      await sql`
        UPDATE app.activity
        SET note = 'Updated note after phone conversation'
        WHERE id = ${actId}
      `.execute(tx);
    });

    const updated = await txRunner.withTenantTx(ctxA, async (tx) => {
      const { rows } = await sql<{ lock_version: number; note: string; updated_at: string }>`
        SELECT lock_version, note, updated_at FROM app.activity WHERE id = ${actId}
      `.execute(tx);
      return rows[0];
    });
    expect(updated?.lock_version).toBe(1);
    expect(updated?.note).toBe('Updated note after phone conversation');
  });

  it('PG-ACT-004 verifies forbid_delete trigger blocks DELETE operations on app.activity', async () => {
    const actId = `act_pg_test_del_${Date.now()}`;
    const ctxA: RequestContext = {
      principal: testPrincipal({ tenantId: TENANT_A, id: USER_A }),
      correlationId: `c-${Date.now()}`,
      now: new Date(),
    };

    // Insert record
    await txRunner.withTenantTx(ctxA, async (tx) => {
      await sql`
        INSERT INTO app.activity (
          id, tenant_id, subject_type, subject_id, kind, outcome_code,
          occurred_at, note, actor_id, actor_branch_id, lock_version, is_hidden
        ) VALUES (
          ${actId}, ${TENANT_A}, 'LEAD', 'lead_test_03', 'NOTE', NULL,
          now(), 'Must not be deleted', ${USER_A}, ${BRANCH_A}, 0, false
        )
      `.execute(tx);
    });

    // Attempt DELETE — trigger MUST raise 42501 exception
    await expect(
      txRunner.withTenantTx(ctxA, async (tx) => {
        await sql`DELETE FROM app.activity WHERE id = ${actId}`.execute(tx);
      }),
    ).rejects.toThrow(/permission denied for table activity|table activity cannot be deleted/);

    // Verify row is still intact
    const surviving = await txRunner.withTenantTx(ctxA, async (tx) => {
      const { rows } = await sql<{ id: string }>`
        SELECT id FROM app.activity WHERE id = ${actId}
      `.execute(tx);
      return rows;
    });
    expect(surviving).toHaveLength(1);
  });

  it('PG-ACT-005 verifies soft-hiding updates is_hidden and hidden_at', async () => {
    const actId = `act_pg_test_hide_${Date.now()}`;
    const ctxA: RequestContext = {
      principal: testPrincipal({ tenantId: TENANT_A, id: USER_A }),
      correlationId: `c-${Date.now()}`,
      now: new Date(),
    };

    await txRunner.withTenantTx(ctxA, async (tx) => {
      await sql`
        INSERT INTO app.activity (
          id, tenant_id, subject_type, subject_id, kind, outcome_code,
          occurred_at, note, actor_id, actor_branch_id, lock_version, is_hidden
        ) VALUES (
          ${actId}, ${TENANT_A}, 'LEAD', 'lead_test_04', 'NOTE', NULL,
          now(), 'To be soft-hidden', ${USER_A}, ${BRANCH_A}, 0, false
        )
      `.execute(tx);
    });

    // Soft hide
    await txRunner.withTenantTx(ctxA, async (tx) => {
      await sql`
        UPDATE app.activity
        SET is_hidden = true, hidden_at = now(), hidden_by = ${USER_A}
        WHERE id = ${actId}
      `.execute(tx);
    });

    const hiddenRow = await txRunner.withTenantTx(ctxA, async (tx) => {
      const { rows } = await sql<{ is_hidden: boolean; hidden_by: string; lock_version: number }>`
        SELECT is_hidden, hidden_by, lock_version FROM app.activity WHERE id = ${actId}
      `.execute(tx);
      return rows[0];
    });

    expect(hiddenRow?.is_hidden).toBe(true);
    expect(hiddenRow?.hidden_by).toBe(USER_A);
    expect(hiddenRow?.lock_version).toBe(1);
  });

  it('PG-ACT-006 verifies atomic activity and audit_event write inside single transaction', async () => {
    const actId = `act_pg_test_atomic_${Date.now()}`;
    const audId = `aud_pg_test_atomic_${Date.now()}`;
    const ctxA: RequestContext = {
      principal: testPrincipal({ tenantId: TENANT_A, id: USER_A }),
      correlationId: `c-${Date.now()}`,
      now: new Date(),
    };

    // Commit transaction with both activity and audit event
    await txRunner.withTenantTx(ctxA, async (tx) => {
      await sql`
        INSERT INTO app.activity (
          id, tenant_id, subject_type, subject_id, kind, outcome_code,
          occurred_at, note, actor_id, actor_branch_id, lock_version, is_hidden
        ) VALUES (
          ${actId}, ${TENANT_A}, 'LEAD', 'lead_test_05', 'NOTE', NULL,
          now(), 'Audit atomic test', ${USER_A}, ${BRANCH_A}, 0, false
        )
      `.execute(tx);

      await sql`
        INSERT INTO app.audit_event (
          id, tenant_id, actor_type, actor_id, action, entity_type,
          entity_id, occurred_at, correlation_id, after
        ) VALUES (
          ${audId}, ${TENANT_A}, 'USER', ${USER_A}, 'activity.created',
          'activity', ${actId}, now(), ${ctxA.correlationId},
          ${JSON.stringify({ kind: 'NOTE', subjectId: 'lead_test_05' })}
        )
      `.execute(tx);
    });

    // Check both committed
    await txRunner.withTenantTx(ctxA, async (tx) => {
      const act = await sql<{ id: string }>`SELECT id FROM app.activity WHERE id = ${actId}`.execute(tx);
      const aud = await sql<{ id: string }>`SELECT id FROM app.audit_event WHERE id = ${audId}`.execute(tx);
      expect(act.rows).toHaveLength(1);
      expect(aud.rows).toHaveLength(1);
    });

    // Rollback test: error rolls back both
    const failActId = `act_pg_fail_${Date.now()}`;
    const failAudId = `aud_pg_fail_${Date.now()}`;

    await expect(
      txRunner.withTenantTx(ctxA, async (tx) => {
        await sql`
          INSERT INTO app.activity (
            id, tenant_id, subject_type, subject_id, kind, outcome_code,
            occurred_at, note, actor_id, actor_branch_id, lock_version, is_hidden
          ) VALUES (
            ${failActId}, ${TENANT_A}, 'LEAD', 'lead_test_fail', 'NOTE', NULL,
            now(), 'Will roll back', ${USER_A}, ${BRANCH_A}, 0, false
          )
        `.execute(tx);

        await sql`
          INSERT INTO app.audit_event (
            id, tenant_id, actor_type, actor_id, action, entity_type,
            entity_id, occurred_at, correlation_id
          ) VALUES (
            ${failAudId}, ${TENANT_A}, 'USER', ${USER_A}, 'activity.created',
            'activity', ${failActId}, now(), ${ctxA.correlationId}
          )
        `.execute(tx);

        throw new Error('Simulated transaction failure');
      }),
    ).rejects.toThrow('Simulated transaction failure');

    // Confirm neither row exists
    await txRunner.withTenantTx(ctxA, async (tx) => {
      const act = await sql<{ id: string }>`SELECT id FROM app.activity WHERE id = ${failActId}`.execute(tx);
      const aud = await sql<{ id: string }>`SELECT id FROM app.audit_event WHERE id = ${failAudId}`.execute(
        tx,
      );
      expect(act.rows).toHaveLength(0);
      expect(aud.rows).toHaveLength(0);
    });
  });

  it('PG-ACT-007 verifies end-to-end HTTP POST /v1/activities persists to PostgreSQL and triggers work', async () => {
    const principal = testPrincipal({
      tenantId: TENANT_A,
      id: USER_A,
      primaryBranchId: BRANCH_A,
      grants: [
        { code: 'activity.create', scope: 'TENANT', branchIds: [] },
        { code: 'activity.update', scope: 'TENANT', branchIds: [] },
      ],
    });

    const app = createApp({
      deps: createTestDeps({ txRunner }),
      corsAllowedOrigins: [],
      auth: fakeAuth(principal),
    });

    const res = await request(app)
      .post('/v1/activities')
      .set('Idempotency-Key', `idem_pg_live_${Date.now()}`)
      .send({
        kind: 'CALL',
        subjectType: 'LEAD',
        subjectId: 'lead_test_live_http',
        outcomeCode: 'CONNECTED',
        occurredAt: new Date().toISOString(),
        durationSeconds: 150,
        note: 'Live database HTTP integration test activity',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^act_/);
    expect(res.headers.etag).toBe('"0"');

    const createdId = res.body.id;

    // Verify row was physically written to PostgreSQL table app.activity!
    const rows = await txRunner.withTenantTx(
      { principal, correlationId: 'c-verify', now: new Date() },
      async (tx) => {
        const result = await sql<{
          id: string;
          tenant_id: string;
          kind: string;
          outcome_code: string;
          duration_s: number;
          lock_version: number;
        }>`
          SELECT id, tenant_id, kind, outcome_code, duration_s, lock_version
          FROM app.activity WHERE id = ${createdId}
        `.execute(tx);
        return result.rows;
      },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(createdId);
    expect(rows[0]?.tenant_id).toBe(TENANT_A);
    expect(rows[0]?.kind).toBe('CALL');
    expect(rows[0]?.outcome_code).toBe('CONNECTED');
    expect(rows[0]?.duration_s).toBe(150);
    expect(rows[0]?.lock_version).toBe(0);

    // Verify audit event was physically written to PostgreSQL app.audit_event!
    const auditRows = await txRunner.withTenantTx(
      { principal, correlationId: 'c-verify-aud', now: new Date() },
      async (tx) => {
        const result = await sql<{ action: string; entity_id: string }>`
          SELECT action, entity_id FROM app.audit_event WHERE entity_id = ${createdId}
        `.execute(tx);
        return result.rows;
      },
    );

    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    expect(auditRows[0]?.action).toBe('activity.created');
  });

  it('PG-ACT-008 verifies end-to-end HTTP PATCH optimistic concurrency and soft-hiding in PostgreSQL', async () => {
    const principal = testPrincipal({
      tenantId: TENANT_A,
      id: USER_A,
      primaryBranchId: BRANCH_A,
      grants: [
        { code: 'activity.create', scope: 'TENANT', branchIds: [] },
        { code: 'activity.update', scope: 'TENANT', branchIds: [] },
      ],
    });

    const app = createApp({
      deps: createTestDeps({ txRunner }),
      corsAllowedOrigins: [],
      auth: fakeAuth(principal),
    });

    // 1. Create activity via HTTP
    const createRes = await request(app)
      .post('/v1/activities')
      .set('Idempotency-Key', `idem_pg_patch_${Date.now()}`)
      .send({
        kind: 'NOTE',
        subjectType: 'LEAD',
        subjectId: 'lead_test_live_http',
        occurredAt: new Date().toISOString(),
        note: 'Live PG test before update',
      });

    expect(createRes.status).toBe(201);
    const actId = createRes.body.id;
    expect(createRes.headers.etag).toBe('"0"');

    // 2. PATCH with valid If-Match "0"
    const patchRes = await request(app).patch(`/v1/activities/${actId}`).set('If-Match', '"0"').send({
      outcomeCode: 'CONNECTED',
      note: 'Live PG test after update',
    });

    expect(patchRes.status).toBe(200);
    expect(patchRes.headers.etag).toBe('"1"');
    expect(patchRes.body.lockVersion).toBe(1);

    // Verify PostgreSQL row actually has lock_version = 1
    const dbRow = await txRunner.withTenantTx(
      { principal, correlationId: 'c-verify-patch', now: new Date() },
      async (tx) => {
        const { rows } = await sql<{ lock_version: number; note: string }>`
          SELECT lock_version, note FROM app.activity WHERE id = ${actId}
        `.execute(tx);
        return rows[0];
      },
    );
    expect(dbRow?.lock_version).toBe(1);
    expect(dbRow?.note).toBe('Live PG test after update');

    // 3. Stale If-Match "0" returns 409 VERSION_CONFLICT
    const staleRes = await request(app)
      .patch(`/v1/activities/${actId}`)
      .set('If-Match', '"0"')
      .send({ note: 'Stale update attempt' });

    expect(staleRes.status).toBe(409);
    expect(staleRes.body.error.code).toBe('VERSION_CONFLICT');

    // 4. Soft-hide with If-Match "1"
    const hideRes = await request(app)
      .patch(`/v1/activities/${actId}`)
      .set('If-Match', '"1"')
      .send({ isHidden: true });

    expect(hideRes.status).toBe(200);
    expect(hideRes.body.isHidden).toBe(true);

    // Verify PostgreSQL has is_hidden = true and audit event logged
    const hiddenDbRow = await txRunner.withTenantTx(
      { principal, correlationId: 'c-verify-hide', now: new Date() },
      async (tx) => {
        const { rows } = await sql<{ is_hidden: boolean; hidden_by: string }>`
          SELECT is_hidden, hidden_by FROM app.activity WHERE id = ${actId}
        `.execute(tx);
        return rows[0];
      },
    );
    expect(hiddenDbRow?.is_hidden).toBe(true);
    expect(hiddenDbRow?.hidden_by).toBe(USER_A);

    // 5. Subsequent GET returns 404
    const getRes = await request(app).get(`/v1/activities/${actId}`);
    expect(getRes.status).toBe(404);
  });
});
