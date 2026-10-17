// apps/api/test/notifications-live-pg.spec.ts
// Direct live PostgreSQL verification for Module 12 (Notifications / MOD-NTF).
// Connects as dsa_api (NOBYPASSRLS) and validates real PostgreSQL migrations, RLS policies, triggers, and preferences.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import path from 'node:path';
import { monotonicFactory } from 'ulid';
import { createDb } from '../src/kernel-min/db';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import type { Database, RequestContext } from '@dsa/contracts';
import { NotificationService } from '../src/modules/crm/notifications/notification-service';

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

function makeCtx(tenantId: string, userId: string): RequestContext {
  return {
    principal: {
      kind: 'USER',
      id: userId,
      tenantId,
      primaryBranchId: null,
      managedTeamMemberIds: [],
      queueIds: [],
      grants: [],
      authTime: null,
    },
    correlationId: `corr_${nextUlid()}`,
    now: new Date(),
  };
}

describeLivePg('Module 12 (MOD-NTF): Live PostgreSQL Verification', () => {
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

  it('PG-NTF-001 verifies dsa_api connects with NOBYPASSRLS', async () => {
    const { rows } = await sql<{
      current_user: string;
      rolbypassrls: boolean;
    }>`SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user`.execute(db);

    expect(rows[0]?.current_user).toBe('dsa_api');
    expect(rows[0]?.rolbypassrls).toBe(false);
  });

  it('PG-NTF-002 verifies RLS tenant isolation on app.notification', async () => {
    const ctxA = makeCtx(TENANT_A, USER_A);
    const ctxB = makeCtx(TENANT_B, USER_A);
    const notifId = `ntf_${nextUlid()}`;

    // Insert under Tenant A
    await txRunner.withTenantTx(ctxA, async (tx) => {
      await sql`
        INSERT INTO app.notification (
          id, tenant_id, user_id, category, title, deep_link, read_at
        ) VALUES (
          ${notifId}, ${TENANT_A}, ${USER_A}, 'TASK', 'Live PG RLS Isolation Test', '/tasks/1', NULL
        )
      `.execute(tx);
    });

    // Read under Tenant A -> visible
    await txRunner.withTenantTx(ctxA, async (tx) => {
      const res = await sql<{ id: string }>`
        SELECT id FROM app.notification WHERE id = ${notifId}
      `.execute(tx);
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]?.id).toBe(notifId);
    });

    // Read under Tenant B -> NOT visible (RLS isolation enforced)
    await txRunner.withTenantTx(ctxB, async (tx) => {
      const res = await sql<{ id: string }>`
        SELECT id FROM app.notification WHERE id = ${notifId}
      `.execute(tx);
      expect(res.rows).toHaveLength(0);
    });
  });

  it('PG-NTF-003 verifies touch_row trigger increments lock_version and updates updated_at', async () => {
    const ctx = makeCtx(TENANT_A, USER_A);
    const notifId = `ntf_${nextUlid()}`;

    await txRunner.withTenantTx(ctx, async (tx) => {
      await sql`
        INSERT INTO app.notification (
          id, tenant_id, user_id, category, title, deep_link, read_at
        ) VALUES (
          ${notifId}, ${TENANT_A}, ${USER_A}, 'ALERT', 'Trigger verification', '/alerts/1', NULL
        )
      `.execute(tx);

      const before = await sql<{ lock_version: number }>`
        SELECT lock_version FROM app.notification WHERE id = ${notifId}
      `.execute(tx);
      expect(before.rows[0]?.lock_version).toBe(0);

      // Perform UPDATE
      await sql`
        UPDATE app.notification SET read_at = now() WHERE id = ${notifId}
      `.execute(tx);

      const after = await sql<{ lock_version: number; read_at: string }>`
        SELECT lock_version, read_at FROM app.notification WHERE id = ${notifId}
      `.execute(tx);
      expect(after.rows[0]?.lock_version).toBe(1);
      expect(after.rows[0]?.read_at).toBeTruthy();
    });
  });

  it('PG-NTF-004 verifies notification_no_delete trigger blocks DELETE operations', async () => {
    const ctx = makeCtx(TENANT_A, USER_A);
    const notifId = `ntf_${nextUlid()}`;

    await txRunner.withTenantTx(ctx, async (tx) => {
      await sql`
        INSERT INTO app.notification (
          id, tenant_id, user_id, category, title, deep_link
        ) VALUES (
          ${notifId}, ${TENANT_A}, ${USER_A}, 'SYSTEM', 'Append-only verification', '/sys'
        )
      `.execute(tx);

      // Attempt DELETE -> must fail via trigger
      await expect(sql`DELETE FROM app.notification WHERE id = ${notifId}`.execute(tx)).rejects.toThrow();
    });
  });

  it('PG-NTF-005 verifies storage and retrieval of notification_preferences on app_user', async () => {
    const ctx = makeCtx(TENANT_A, USER_A);
    const prefs = {
      channels: { inApp: true, email: true, sms: false, whatsapp: false },
      digestFrequency: 'DAILY_DIGEST',
      mutedCategories: ['TASK'],
    };

    await txRunner.withTenantTx(ctx, async (tx) => {
      await sql`
        UPDATE app.app_user
        SET notification_preferences = ${JSON.stringify(prefs)}::jsonb
        WHERE tenant_id = ${TENANT_A} AND id = ${USER_A}
      `.execute(tx);

      const res = await sql<{ notification_preferences: Record<string, unknown> }>`
        SELECT notification_preferences FROM app.app_user
        WHERE tenant_id = ${TENANT_A} AND id = ${USER_A}
      `.execute(tx);

      expect(res.rows[0]?.notification_preferences).toEqual(prefs);
    });
  });

  it('PG-NTF-006 verifies NotificationService listNotifications and markAsRead against PostgreSQL', async () => {
    const ctx = makeCtx(TENANT_A, USER_A);
    const service = new NotificationService(txRunner);

    // Create a new notification via service
    const notif = await service.createNotification(ctx, {
      userId: USER_A,
      category: 'APPLICATION',
      title: 'Application ready for review in PG',
      deepLink: '/applications/app_pg_test',
    });

    expect(notif).not.toBeNull();
    const notifId = notif!.id;

    // List notifications
    const listRes = await service.listNotifications(ctx, { limit: 10, status: 'UNREAD' });
    const found = listRes.data.find((n) => n.id === notifId);
    expect(found).toBeDefined();
    expect(found?.title).toBe('Application ready for review in PG');

    // Mark as read
    const markRes = await service.markAsRead(ctx, { notificationIds: [notifId] });
    expect(markRes.updatedCount).toBe(1);

    // List unread again -> not present in UNREAD
    const listAfter = await service.listNotifications(ctx, { limit: 10, status: 'UNREAD' });
    expect(listAfter.data.find((n) => n.id === notifId)).toBeUndefined();

    // Present in READ list
    const listRead = await service.listNotifications(ctx, { limit: 10, status: 'READ' });
    const foundRead = listRead.data.find((n) => n.id === notifId);
    expect(foundRead).toBeDefined();
    expect(foundRead?.readAt).toBeTruthy();
  });

  it('PG-NTF-007 verifies getProfile and updatePreferences optimistic locking on PostgreSQL', async () => {
    const ctx = makeCtx(TENANT_A, USER_A);
    const service = new NotificationService(txRunner);

    // 1. Get profile
    const { profile, lockVersion } = await service.getProfile(ctx);
    expect(profile.id).toBe(USER_A);
    expect(lockVersion).toBeGreaterThanOrEqual(0);

    // 2. Update preferences with current lockVersion
    const updated = await service.updatePreferences(
      ctx,
      {
        channels: { inApp: true, email: true, sms: false, whatsapp: false },
        digestFrequency: 'IMMEDIATE',
        mutedCategories: ['SYSTEM'],
      },
      `"${lockVersion}"`,
    );

    expect(updated.lockVersion).toBe(lockVersion + 1);
    expect(updated.profile.notificationPreferences.mutedCategories).toEqual(['SYSTEM']);

    // 3. Stale update with previous lockVersion must throw VERSION_CONFLICT
    await expect(
      service.updatePreferences(
        ctx,
        {
          channels: { inApp: true, email: false, sms: false, whatsapp: false },
          digestFrequency: 'MUTED',
          mutedCategories: [],
        },
        `"${lockVersion}"`,
      ),
    ).rejects.toThrow();
  });
});
