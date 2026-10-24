// apps/api/src/modules/crm/notifications/notification-service.ts — owner: Dev 1 / Dev 5
// Module: MOD-NTF (Domain DOM-C — Follow-ups & Communication)
// Canonical entities: ENT-033 (notification), ENT-005 (app_user profile preferences)
import {
  AppError,
  CreateNotificationInputSchema,
  type CreateNotificationInput,
  type ListNotificationsQuery,
  type MarkNotificationsReadInput,
  type NotificationPreferences,
  type NotificationRecord,
  type RequestContext,
  type TxRunner,
  type UserProfile,
} from '@dsa/contracts';
import { sql } from 'kysely';
import { monotonicFactory } from 'ulid';
import { PreferenceResolver } from './preference-resolver';
import { NotificationStreamHub } from './stream-hub';

/** The unit-test TxRunners reject with "No TxRunner …": no database, so the in-memory store stands in. Anything else is a
 *  real failure and propagates; a notification is never reported as stored when it was not. */
const isNoDatabase = (err: unknown): boolean => err instanceof Error && /^No TxRunner/.test(err.message);

const nextUlid = monotonicFactory();

export class NotificationService {
  // In-memory fallback stores for unit test runs without active database connection
  private static memoryNotifications = new Map<string, NotificationRecord>();
  private static memoryUserProfiles = new Map<
    string,
    { lockVersion: number; preferences: NotificationPreferences; email: string; displayName: string }
  >();

  constructor(
    private readonly txRunner?: TxRunner,
    private readonly streamHub: NotificationStreamHub = NotificationStreamHub.getInstance(),
  ) {}

  /**
   * Reset in-memory test stores
   */
  static resetMemoryStore(): void {
    NotificationService.memoryNotifications.clear();
    NotificationService.memoryUserProfiles.clear();
    NotificationStreamHub.getInstance().reset();
  }

  static seedNotification(record: NotificationRecord): void {
    NotificationService.memoryNotifications.set(record.id, record);
  }

  static seedUserProfile(
    userId: string,
    profile: {
      lockVersion: number;
      preferences: NotificationPreferences;
      email: string;
      displayName: string;
    },
  ): void {
    NotificationService.memoryUserProfiles.set(userId, profile);
  }

  /**
   * API-NTF-001: List notifications for authenticated user
   */
  async listNotifications(
    ctx: RequestContext,
    query: ListNotificationsQuery,
  ): Promise<{
    data: NotificationRecord[];
    meta: { nextCursor: string | null; limit: number; unreadCount: number };
  }> {
    const tenantId = ctx.principal.tenantId;
    const userId = ctx.principal.id;
    const limit = query.limit;

    if (this.txRunner) {
      try {
        return await this.txRunner.withTenantTx(ctx, async (tx) => {
          let baseQuery = sql`
            SELECT id, tenant_id, user_id, category, title, deep_link, read_at, lock_version, created_at
            FROM app.notification
            WHERE tenant_id = ${tenantId}
              AND user_id = ${userId}
          `;

          if (query.status === 'UNREAD') {
            baseQuery = sql`${baseQuery} AND read_at IS NULL`;
          } else if (query.status === 'READ') {
            baseQuery = sql`${baseQuery} AND read_at IS NOT NULL`;
          }

          if (query.cursor) {
            baseQuery = sql`
              ${baseQuery}
              AND (
                created_at < (SELECT created_at FROM app.notification WHERE tenant_id = ${tenantId} AND user_id = ${userId} AND id = ${query.cursor})
                OR (
                  created_at = (SELECT created_at FROM app.notification WHERE tenant_id = ${tenantId} AND user_id = ${userId} AND id = ${query.cursor})
                  AND id < ${query.cursor}
                )
              )
            `;
          }

          baseQuery = sql`${baseQuery} ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`;

          const res = await baseQuery.execute(tx);

          // Count total unread
          const unreadRes = await sql<{ count: string }>`
            SELECT count(*) as count FROM app.notification
            WHERE tenant_id = ${tenantId}
              AND user_id = ${userId}
              AND read_at IS NULL
          `.execute(tx);
          const unreadCount = parseInt(unreadRes.rows[0]?.count ?? '0', 10);

          const hasMore = res.rows.length > limit;
          const rows = hasMore ? res.rows.slice(0, limit) : res.rows;
          const nextCursor =
            hasMore && rows[rows.length - 1] ? (rows[rows.length - 1] as { id: string }).id : null;

          const data: NotificationRecord[] = (
            rows as Array<{
              id: string;
              tenant_id: string;
              user_id: string;
              category: NotificationRecord['category'];
              title: string;
              deep_link: string;
              read_at: string | Date | null;
              lock_version: number;
              created_at: string | Date;
            }>
          ).map((r) => ({
            id: r.id as NotificationRecord['id'],
            tenantId: r.tenant_id,
            userId: r.user_id,
            category: r.category,
            title: r.title,
            deepLink: r.deep_link,
            readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
            lockVersion: r.lock_version,
            createdAt: new Date(r.created_at).toISOString(),
          }));

          return { data, meta: { nextCursor, limit, unreadCount } };
        });
      } catch (err: unknown) {
        if (!isNoDatabase(err)) throw err;
      }
    }

    // In-memory fallback
    const all = Array.from(NotificationService.memoryNotifications.values()).filter((n) => {
      if (n.tenantId !== tenantId || n.userId !== userId) return false;
      if (query.status === 'UNREAD' && n.readAt !== null) return false;
      if (query.status === 'READ' && n.readAt === null) return false;
      return true;
    });

    all.sort((a, b) => {
      const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.id.localeCompare(a.id);
    });

    let paginated = all;
    if (query.cursor) {
      const cursorIndex = all.findIndex((n) => n.id === query.cursor);
      if (cursorIndex >= 0) {
        paginated = all.slice(cursorIndex + 1);
      }
    }

    const unreadCount = Array.from(NotificationService.memoryNotifications.values()).filter(
      (n) => n.tenantId === tenantId && n.userId === userId && n.readAt === null,
    ).length;

    const hasMore = paginated.length > limit;
    const resultRows = hasMore ? paginated.slice(0, limit) : paginated;
    const lastRow = resultRows[resultRows.length - 1];
    const nextCursor = hasMore && lastRow ? lastRow.id : null;

    return { data: resultRows, meta: { nextCursor, limit, unreadCount } };
  }

  /**
   * API-NTF-002: Mark notifications as read for authenticated user
   */
  async markAsRead(
    ctx: RequestContext,
    input: MarkNotificationsReadInput,
  ): Promise<{ updatedCount: number }> {
    const tenantId = ctx.principal.tenantId;
    const userId = ctx.principal.id;
    const ids = input.notificationIds;

    if (ids.length === 0) {
      return { updatedCount: 0 };
    }

    const searchIds = Array.from(
      new Set(
        ids.flatMap((id) => [
          id,
          id.startsWith('ntf_') ? id.slice(4) : `ntf_${id}`,
          id.toLowerCase(),
          id.toUpperCase(),
        ]),
      ),
    );

    if (this.txRunner) {
      try {
        return await this.txRunner.withTenantTx(ctx, async (tx) => {
          const res = await sql<{ id: string }>`
            UPDATE app.notification
            SET read_at = now()
            WHERE tenant_id = ${tenantId}
              AND user_id = ${userId}
              AND id = ANY(${searchIds})
              AND read_at IS NULL
            RETURNING id
          `.execute(tx);

          return { updatedCount: res.rows.length };
        });
      } catch (err: unknown) {
        if (!isNoDatabase(err)) throw err;
      }
    }

    // In-memory fallback
    let updatedCount = 0;
    const nowIso = ctx.now.toISOString();
    const marked = new Set<string>();
    for (const id of searchIds) {
      const record = NotificationService.memoryNotifications.get(id);
      if (record && record.tenantId === tenantId && record.userId === userId && record.readAt === null && !marked.has(record.id)) {
        marked.add(record.id);
        record.readAt = nowIso;
        record.lockVersion += 1;
        updatedCount += 1;
      }
    }

    return { updatedCount };
  }

  /**
   * Internal Service: Create notification for user and stream via SSE
   */
  async createNotification(
    ctx: RequestContext,
    rawInput: CreateNotificationInput,
  ): Promise<NotificationRecord | null> {
    const input = CreateNotificationInputSchema.parse(rawInput);
    const tenantId = ctx.principal.tenantId;
    const userId = input.userId;

    // 1. Resolve user's notification preferences
    const preferences = await this.resolvePreferences(ctx, tenantId, userId);

    // 2. Evaluate if in-app delivery is permitted
    if (!PreferenceResolver.shouldDeliverInApp(input.category, preferences)) {
      return null;
    }

    const notificationId = `ntf_${nextUlid()}`;
    const nowIso = ctx.now.toISOString();

    const record: NotificationRecord = {
      id: notificationId as NotificationRecord['id'],
      tenantId,
      userId,
      category: input.category,
      title: input.title,
      deepLink: input.deepLink,
      readAt: null,
      lockVersion: 0,
      createdAt: nowIso,
    };

    if (this.txRunner) {
      try {
        await this.txRunner.withTenantTx(ctx, async (tx) => {
          await sql`
            INSERT INTO app.notification (
              id, tenant_id, user_id, category, title, deep_link,
              read_at, lock_version, created_at, updated_at
            ) VALUES (
              ${record.id}, ${record.tenantId}, ${record.userId}, ${record.category},
              ${record.title}, ${record.deepLink}, ${record.readAt}, ${record.lockVersion},
              ${record.createdAt}, ${record.createdAt}
            )
          `.execute(tx);
        });
      } catch (err: unknown) {
        if (!isNoDatabase(err)) throw err;
        // In-memory fallback
        NotificationService.memoryNotifications.set(record.id, record);
      }
    } else {
      NotificationService.memoryNotifications.set(record.id, record);
    }

    // 3. Emit SSE live event to connected user clients
    this.streamHub.emit(tenantId, userId, 'notification.created', record);

    return record;
  }

  /**
   * Helper: Resolve user's notification preferences
   */
  private async resolvePreferences(
    ctx: RequestContext,
    tenantId: string,
    userId: string,
  ): Promise<NotificationPreferences> {
    if (this.txRunner) {
      try {
        return await this.txRunner.withTenantTx(ctx, async (tx) => {
          const res = await sql<{ notification_preferences: unknown }>`
            SELECT notification_preferences FROM app.app_user
            WHERE tenant_id = ${tenantId}
              AND id = ${userId}
            LIMIT 1
          `.execute(tx);
          const row = res.rows[0];
          return PreferenceResolver.normalizePreferences(row?.notification_preferences);
        });
      } catch (err: unknown) {
        if (!isNoDatabase(err)) throw err;
      }
    }

    const memUser = NotificationService.memoryUserProfiles.get(userId);
    return memUser?.preferences ?? PreferenceResolver.DEFAULT_PREFERENCES;
  }

  /**
   * API-USR-010: Get current user profile with preferences
   */
  async getProfile(ctx: RequestContext): Promise<{ profile: UserProfile; lockVersion: number }> {
    const tenantId = ctx.principal.tenantId;
    const userId = ctx.principal.id;

    if (this.txRunner) {
      try {
        return await this.txRunner.withTenantTx(ctx, async (tx) => {
          const res = await sql<{
            id: string;
            tenant_id: string;
            email: string;
            display_name: string;
            user_type: string;
            status: string;
            availability: string;
            primary_branch_id: string;
            lock_version: number;
            notification_preferences: unknown;
          }>`
            SELECT id, tenant_id, email, display_name, user_type, status, availability,
                   primary_branch_id, lock_version, notification_preferences
            FROM app.app_user
            WHERE tenant_id = ${tenantId}
              AND id = ${userId}
            LIMIT 1
          `.execute(tx);

          const row = res.rows[0];
          if (!row) {
            throw AppError.of('NOT_FOUND', 'User profile not found');
          }

          const profile: UserProfile & Record<string, unknown> = {
            id: row.id as UserProfile['id'],
            tenantId: row.tenant_id,
            email: row.email,
            displayName: row.display_name,
            userType: row.user_type,
            status: row.status,
            availability: row.availability,
            primaryBranchId: row.primary_branch_id,
            lockVersion: row.lock_version,
            notificationPreferences: PreferenceResolver.normalizePreferences(row.notification_preferences),
            grants: ctx.principal.grants,
            queueIds: ctx.principal.queueIds,
            mfaVerifiedAt: ctx.principal.authTime,
          };

          return { profile, lockVersion: row.lock_version };
        });
      } catch (err: unknown) {
        if (!isNoDatabase(err)) throw err;
      }
    }

    // In-memory fallback
    const memUser = NotificationService.memoryUserProfiles.get(userId) ?? {
      lockVersion: 0,
      preferences: PreferenceResolver.DEFAULT_PREFERENCES,
      email: 'user@example.com',
      displayName: 'Staff User',
    };

    const profile: UserProfile & Record<string, unknown> = {
      id: userId as UserProfile['id'],
      tenantId,
      email: memUser.email,
      displayName: memUser.displayName,
      userType: 'STAFF',
      status: 'ACTIVE',
      availability: 'AVAILABLE',
      primaryBranchId: 'br_01JTESTBRANCH0000000000000',
      lockVersion: memUser.lockVersion,
      notificationPreferences: memUser.preferences,
      grants: ctx.principal.grants,
      queueIds: ctx.principal.queueIds,
      mfaVerifiedAt: ctx.principal.authTime,
    };

    return { profile, lockVersion: memUser.lockVersion };
  }

  /**
   * API-USR-009: PATCH /v1/me update notification preferences with If-Match concurrency
   */
  async updatePreferences(
    ctx: RequestContext,
    preferences: NotificationPreferences,
    ifMatch?: string,
  ): Promise<{ profile: UserProfile; lockVersion: number }> {
    const tenantId = ctx.principal.tenantId;
    const userId = ctx.principal.id;

    if (!ifMatch) {
      throw AppError.of('VALIDATION_ERROR', 'If-Match header is required for updating profile preferences', [
        { field: 'If-Match', issue: 'REQUIRED' },
      ]);
    }

    const expectedLockVersion = parseInt(ifMatch.replace(/["']/g, ''), 10);
    if (isNaN(expectedLockVersion)) {
      throw AppError.of('VALIDATION_ERROR', 'Invalid If-Match lock version header format', [
        { field: 'If-Match', issue: 'INVALID_FORMAT' },
      ]);
    }

    if (this.txRunner) {
      try {
        return await this.txRunner.withTenantTx(ctx, async (tx) => {
          const currentRes = await sql<{
            id: string;
            lock_version: number;
          }>`
            SELECT id, lock_version FROM app.app_user
            WHERE tenant_id = ${tenantId}
              AND id = ${userId}
            FOR UPDATE
          `.execute(tx);

          const current = currentRes.rows[0];
          if (!current) {
            throw AppError.of('NOT_FOUND', 'User profile not found');
          }

          if (current.lock_version !== expectedLockVersion) {
            throw AppError.of(
              'VERSION_CONFLICT',
              `Profile version conflict: expected lock_version ${expectedLockVersion}, found ${current.lock_version}`,
            );
          }

          const updateRes = await sql<{
            id: string;
            tenant_id: string;
            email: string;
            display_name: string;
            user_type: string;
            status: string;
            availability: string;
            primary_branch_id: string;
            lock_version: number;
            notification_preferences: unknown;
          }>`
            UPDATE app.app_user
            SET notification_preferences = ${JSON.stringify(preferences)}::jsonb,
                lock_version = lock_version + 1,
                updated_at = now()
            WHERE tenant_id = ${tenantId}
              AND id = ${userId}
            RETURNING id, tenant_id, email, display_name, user_type, status, availability,
                      primary_branch_id, lock_version, notification_preferences
          `.execute(tx);

          const updated = updateRes.rows[0]!;
          const profile: UserProfile & Record<string, unknown> = {
            id: updated.id as UserProfile['id'],
            tenantId: updated.tenant_id,
            email: updated.email,
            displayName: updated.display_name,
            userType: updated.user_type,
            status: updated.status,
            availability: updated.availability,
            primaryBranchId: updated.primary_branch_id,
            lockVersion: updated.lock_version,
            notificationPreferences: PreferenceResolver.normalizePreferences(
              updated.notification_preferences,
            ),
            grants: ctx.principal.grants,
            queueIds: ctx.principal.queueIds,
            mfaVerifiedAt: ctx.principal.authTime,
          };

          return { profile, lockVersion: updated.lock_version };
        });
      } catch (err: unknown) {
        if (!isNoDatabase(err)) throw err;
      }
    }

    // In-memory fallback
    const memUser = NotificationService.memoryUserProfiles.get(userId) ?? {
      lockVersion: 0,
      preferences: PreferenceResolver.DEFAULT_PREFERENCES,
      email: 'user@example.com',
      displayName: 'Staff User',
    };

    if (memUser.lockVersion !== expectedLockVersion) {
      throw AppError.of(
        'VERSION_CONFLICT',
        `Profile version conflict: expected lock_version ${expectedLockVersion}, found ${memUser.lockVersion}`,
      );
    }

    memUser.lockVersion += 1;
    memUser.preferences = preferences;
    NotificationService.memoryUserProfiles.set(userId, memUser);

    const profile: UserProfile & Record<string, unknown> = {
      id: userId as UserProfile['id'],
      tenantId,
      email: memUser.email,
      displayName: memUser.displayName,
      userType: 'STAFF',
      status: 'ACTIVE',
      availability: 'AVAILABLE',
      primaryBranchId: 'br_01JTESTBRANCH0000000000000',
      lockVersion: memUser.lockVersion,
      notificationPreferences: memUser.preferences,
      grants: ctx.principal.grants,
      queueIds: ctx.principal.queueIds,
      mfaVerifiedAt: ctx.principal.authTime,
    };

    return { profile, lockVersion: memUser.lockVersion };
  }
}
