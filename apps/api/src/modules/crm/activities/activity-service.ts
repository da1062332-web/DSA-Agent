// apps/api/src/modules/crm/activities/activity-service.ts — owner: Dev 1 / Dev 5
// CMP-ACT.01.2 Activity Service (MOD-ACT / SUB-ACT.01 interaction logging)
// The database is the record. Every read and write runs in the caller's tenant transaction, and the audit event and the
// idempotency record are written in that same transaction. Database errors propagate: a failed write is never reported
// as success. The in-memory store is only the unit-test seam, used when the test TxRunner reports that no database is
// configured.
// Visibility (DSA Notion MODULE 10): an activity is visible to its author and to anyone who can read its subject, with the
// subject's own read permission (lead.read, customer.read, application.read) and scope. Logging or editing needs
// activity.create or activity.update with a scope that covers the subject.
import {
  AppError,
  type Activity,
  type AuditPort,
  type CreateActivityInput,
  type PermissionCode,
  type RequestContext,
  type SubjectType,
  type Tx,
  type TxRunner,
  type UpdateActivityInput,
} from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import { sql } from 'kysely';
import { monotonicFactory } from 'ulid';

const nextUlid = monotonicFactory();

export interface SubjectLookup {
  id: string;
  tenantId: string;
  branchId?: string;
  ownerUserId?: string;
  status?: string;
}

export interface ActivityFilter {
  subjectType?: SubjectType;
  subjectId?: string;
  limit?: number;
  cursor?: string;
}

interface StoredActivity extends Activity {
  hiddenAt?: string;
  hiddenBy?: string;
}

export const READ_PERMISSION: Record<SubjectType, PermissionCode> = {
  LEAD: 'lead.read',
  CUSTOMER: 'customer.read',
  LOAN_APPLICATION: 'application.read',
};

/** The test TxRunner (test/support/fake-auth.ts) rejects with this; it means "no database", never a real failure. */
const NO_DATABASE = /^No TxRunner/;
const NO_DB = Symbol('no-database');

const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();

function mapDbRowToActivity(row: Record<string, unknown>): StoredActivity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    subjectType: row.subject_type as SubjectType,
    subjectId: String(row.subject_id),
    links: [{ type: row.subject_type as SubjectType, id: String(row.subject_id) }],
    kind: row.kind as Activity['kind'],
    outcomeCode: (row.outcome_code as Activity['outcomeCode']) ?? null,
    occurredAt: iso(row.occurred_at),
    durationSeconds: row.duration_s !== null && row.duration_s !== undefined ? Number(row.duration_s) : null,
    note: (row.note as string | null) ?? null,
    actorId: String(row.actor_id),
    actorBranchId: (row.actor_branch_id as string | null) ?? 'DEFAULT',
    actorTeamId: (row.actor_team_id as string | null) ?? null,
    lockVersion: Number(row.lock_version ?? 0),
    isHidden: Boolean(row.is_hidden),
    hiddenAt: row.hidden_at ? iso(row.hidden_at) : undefined,
    hiddenBy: (row.hidden_by as string | null) ?? undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at ?? row.created_at),
  };
}

/** A cursor is base64url of {"k": occurredAt, "id": activityId}; anything else is a 422, never silently page one. */
function decodeActivityCursor(cursor: string | undefined): { k: string; id: string } | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { k?: unknown; id?: unknown };
    if (typeof v.k === 'string' && typeof v.id === 'string' && !Number.isNaN(Date.parse(v.k))) {
      return { k: v.k, id: v.id };
    }
  } catch {
    // reported below
  }
  throw AppError.of('VALIDATION_ERROR', 'Invalid cursor.', [{ field: 'cursor', issue: 'INVALID' }]);
}

const encodeActivityCursor = (a: Activity) =>
  Buffer.from(JSON.stringify({ k: a.occurredAt, id: a.id })).toString('base64url');

export class ActivityService {
  // Unit-test seam (see NO_DATABASE). Never consulted when a database is configured.
  private static memoryActivities = new Map<string, StoredActivity>();
  private static memorySubjects = new Map<string, SubjectLookup>();
  private static memoryIdempotency = new Map<string, Activity>();
  private static memoryAudits: Array<{
    id: string;
    tenantId: string;
    action: string;
    actorId: string;
    entityId: string;
    occurredAt: string;
    data: unknown;
  }> = [];

  constructor(
    private readonly txRunner?: TxRunner,
    private readonly audit?: AuditPort,
  ) {}

  /** For testing: seed known subjects (leads, customers, applications) */
  static seedSubject(subject: SubjectLookup): void {
    ActivityService.memorySubjects.set(`${subject.tenantId}:${subject.id}`, subject);
  }

  /** For testing: reset in-memory state */
  static resetMemoryStore(): void {
    ActivityService.memoryActivities.clear();
    ActivityService.memorySubjects.clear();
    ActivityService.memoryIdempotency.clear();
    ActivityService.memoryAudits = [];
  }

  /** For testing: retrieve audit log */
  static getAuditLog() {
    return [...ActivityService.memoryAudits];
  }

  /** Runs fn in the tenant transaction. Returns NO_DB only when the test TxRunner says there is no database. */
  private async inTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T | typeof NO_DB> {
    if (!this.txRunner) return NO_DB;
    try {
      return await this.txRunner.withTenantTx(ctx, fn);
    } catch (err) {
      if (err instanceof Error && !(err instanceof AppError) && NO_DATABASE.test(err.message)) return NO_DB;
      throw err;
    }
  }

  private requirePermission(ctx: RequestContext, code: PermissionCode): void {
    if (!ctx.principal.grants.some((g) => g.code === code)) {
      throw AppError.of('FORBIDDEN', `Forbidden: principal requires ${code} permission`);
    }
  }

  /** True when one of the caller's grants for `code` covers the subject (TENANT, BRANCH, TEAM or OWN scope). */
  private covers(ctx: RequestContext, code: PermissionCode, subject: SubjectLookup): boolean {
    const p = ctx.principal;
    for (const g of p.grants.filter((x) => x.code === code)) {
      if (g.scope === 'TENANT') return true;
      if (g.scope === 'BRANCH') {
        const branches = new Set([...(g.branchIds ?? []), ...(p.primaryBranchId ? [p.primaryBranchId] : [])]);
        if (subject.branchId && branches.has(subject.branchId)) return true;
      }
      if (g.scope === 'TEAM') {
        const team = new Set([p.id, ...(p.managedTeamMemberIds ?? [])]);
        if (subject.ownerUserId && team.has(subject.ownerUserId)) return true;
      }
      if (g.scope === 'OWN' && subject.ownerUserId === p.id) return true;
    }
    return false;
  }

  private async findSubjectInDb(tx: Tx, type: SubjectType, id: string): Promise<SubjectLookup | null> {
    if (type === 'LEAD') {
      const r = await sql<Record<string, string>>`
        select id, tenant_id, branch_id, owner_user_id from lead where id = ${id}`.execute(tx);
      const row = r.rows[0];
      return row
        ? { id: row.id!, tenantId: row.tenant_id!, branchId: row.branch_id, ownerUserId: row.owner_user_id }
        : null;
    }
    if (type === 'CUSTOMER') {
      const r = await sql<Record<string, string>>`
        select id, tenant_id, home_branch_id from customer where id = ${id}`.execute(tx);
      const row = r.rows[0];
      return row ? { id: row.id!, tenantId: row.tenant_id!, branchId: row.home_branch_id } : null;
    }
    const r = await sql<Record<string, string>>`
      select id, tenant_id, branch_id, sales_owner_id from loan_application where id = ${id}`.execute(tx);
    const row = r.rows[0];
    return row ? { id: row.id!, tenantId: row.tenant_id!, branchId: row.branch_id, ownerUserId: row.sales_owner_id } : null;
  }

  /** The subject, if it exists in the caller's tenant and `code` covers it; otherwise 404 (never reveal existence). */
  private async subjectFor(
    ctx: RequestContext,
    tx: Tx | null,
    type: SubjectType,
    id: string,
    code: PermissionCode,
  ): Promise<SubjectLookup> {
    const subject = tx
      ? await this.findSubjectInDb(tx, type, id)
      : (ActivityService.memorySubjects.get(`${ctx.principal.tenantId}:${id}`) ?? null);
    if (!subject || !this.covers(ctx, code, subject)) throw AppError.of('NOT_FOUND', 'Subject not found');
    return subject;
  }

  /** API-ACT-001 — Create Activity */
  async createActivity(
    ctx: RequestContext,
    input: CreateActivityInput,
    idempotencyKey: string,
  ): Promise<{ activity: Activity; isReplayed: boolean }> {
    this.requirePermission(ctx, 'activity.create');
    const tenantId = ctx.principal.tenantId;

    let subjectType: SubjectType;
    let subjectId: string;
    if (input.subjectType && input.subjectId) {
      subjectType = input.subjectType;
      subjectId = input.subjectId;
    } else if (input.links && input.links.length > 0) {
      subjectType = input.links[0]!.type;
      subjectId = input.links[0]!.id;
    } else {
      throw AppError.of('VALIDATION_ERROR', 'Must provide a subject reference');
    }
    const links = input.links && input.links.length > 0 ? input.links : [{ type: subjectType, id: subjectId }];

    const build = (): StoredActivity => {
      const nowIso = ctx.now.toISOString();
      return {
        id: `act_${nextUlid()}`,
        tenantId,
        subjectType,
        subjectId,
        links,
        kind: input.kind,
        outcomeCode: input.outcomeCode ?? null,
        occurredAt: input.occurredAt,
        durationSeconds: input.durationSeconds ?? input.duration_s ?? null,
        note: input.note ?? null,
        // Server-controlled attribution (FR-ACT-005): never taken from the request body.
        actorId: ctx.principal.id,
        actorBranchId: ctx.principal.primaryBranchId ?? 'DEFAULT',
        actorTeamId: ctx.principal.managedTeamMemberIds?.[0] ?? null,
        lockVersion: 0,
        isHidden: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    };

    const result = await this.inTx(ctx, (tx) =>
      withIdempotency(tx, ctx, { key: idempotencyKey, method: 'POST', path: '/v1/activities', body: input }, async () => {
        await this.subjectFor(ctx, tx, subjectType, subjectId, 'activity.create');
        const activity = build();
        await sql`
          insert into activity (id, tenant_id, subject_type, subject_id, kind, outcome_code, occurred_at, duration_s,
                                note, actor_id, actor_branch_id, actor_team_id, created_at, lock_version, is_hidden)
          values (${activity.id}, ${tenantId}, ${subjectType}, ${subjectId}, ${activity.kind}, ${activity.outcomeCode},
                  ${activity.occurredAt}, ${activity.durationSeconds}, ${activity.note}, ${activity.actorId},
                  ${activity.actorBranchId}, ${activity.actorTeamId}, ${ctx.now}, 0, false)`.execute(tx);
        await this.recordAudit(tx, ctx, 'activity.created', activity.id, { kind: activity.kind, subjectType, subjectId });
        return { status: 201, body: activity as Activity, resourceRef: activity.id };
      }),
    );
    if (result !== NO_DB) return { activity: result.body, isReplayed: Boolean(result.replayed) };

    // Unit-test seam.
    const idemKey = `${tenantId}:${ctx.principal.id}:${idempotencyKey}`;
    const cached = ActivityService.memoryIdempotency.get(idemKey);
    if (cached) return { activity: cached, isReplayed: true };
    await this.subjectFor(ctx, null, subjectType, subjectId, 'activity.create');
    const activity = build();
    ActivityService.memoryActivities.set(`${tenantId}:${activity.id}`, activity);
    this.memoryAudit(ctx, 'activity.created', activity.id, { kind: activity.kind, subjectType, subjectId });
    ActivityService.memoryIdempotency.set(idemKey, activity);
    return { activity, isReplayed: false };
  }

  /** API-ACT-002 — Update or Hide Activity */
  async updateActivity(ctx: RequestContext, id: string, input: UpdateActivityInput, ifMatch?: string): Promise<Activity> {
    this.requirePermission(ctx, 'activity.update');
    if (!ifMatch) throw AppError.of('VALIDATION_ERROR', 'If-Match header is required for updates');
    const expected = ifMatch.replace(/^W\//, '').replace(/^"|"$/g, '').trim();

    const apply = (stored: StoredActivity): StoredActivity => {
      if (String(stored.lockVersion) !== expected) {
        throw AppError.of(
          'VERSION_CONFLICT',
          `Version conflict: resource is at version ${stored.lockVersion}, requested version ${expected}`,
        );
      }
      const next: StoredActivity = { ...stored };
      if (input.outcomeCode !== undefined) next.outcomeCode = input.outcomeCode;
      if (input.durationSeconds !== undefined || input.duration_s !== undefined) {
        next.durationSeconds = input.durationSeconds ?? input.duration_s ?? null;
      }
      if (input.note !== undefined) next.note = input.note;
      if (input.isHidden !== undefined) {
        next.isHidden = input.isHidden;
        if (input.isHidden) {
          next.hiddenAt = ctx.now.toISOString();
          next.hiddenBy = ctx.principal.id;
        }
      }
      next.lockVersion = stored.lockVersion + 1;
      next.updatedAt = ctx.now.toISOString();
      return next;
    };
    const action = input.isHidden === true ? 'activity.hidden' : 'activity.updated';

    const result = await this.inTx(ctx, async (tx) => {
      const r = await sql<Record<string, unknown>>`select * from activity where id = ${id} for update`.execute(tx);
      const row = r.rows[0];
      // Hidden activities stay editable by activity.update holders, so a hide can be undone.
      if (!row) throw AppError.of('NOT_FOUND', 'Activity not found');
      const stored = mapDbRowToActivity(row);
      await this.subjectFor(ctx, tx, stored.subjectType, stored.subjectId, 'activity.update');
      const next = apply(stored);
      // touch_row bumps lock_version and updated_at.
      const u = await sql<Record<string, unknown>>`
        update activity set outcome_code = ${next.outcomeCode}, duration_s = ${next.durationSeconds}, note = ${next.note},
               is_hidden = ${next.isHidden}, hidden_at = ${next.hiddenAt ?? null}, hidden_by = ${next.hiddenBy ?? null},
               updated_by = ${ctx.principal.id}
         where id = ${id} returning *`.execute(tx);
      const saved = mapDbRowToActivity(u.rows[0]!);
      await this.recordAudit(tx, ctx, action, id, { lockVersion: saved.lockVersion, isHidden: saved.isHidden });
      return saved;
    });
    if (result !== NO_DB) return result;

    const key = `${ctx.principal.tenantId}:${id}`;
    const stored = ActivityService.memoryActivities.get(key);
    if (!stored) throw AppError.of('NOT_FOUND', 'Activity not found');
    await this.subjectFor(ctx, null, stored.subjectType, stored.subjectId, 'activity.update');
    const next = apply(stored);
    ActivityService.memoryActivities.set(key, next);
    this.memoryAudit(ctx, action, id, { lockVersion: next.lockVersion, isHidden: next.isHidden });
    return next;
  }

  /** Get single activity by ID: its author, or anyone who can read its subject. */
  async getActivity(ctx: RequestContext, id: string): Promise<Activity> {
    const visible = async (tx: Tx | null, a: StoredActivity | undefined | null): Promise<StoredActivity> => {
      if (!a || a.isHidden) throw AppError.of('NOT_FOUND', 'Activity not found');
      if (a.actorId !== ctx.principal.id) {
        await this.subjectFor(ctx, tx, a.subjectType, a.subjectId, READ_PERMISSION[a.subjectType]);
      }
      return a;
    };
    const result = await this.inTx(ctx, async (tx) => {
      const r = await sql<Record<string, unknown>>`select * from activity where id = ${id}`.execute(tx);
      return visible(tx, r.rows[0] ? mapDbRowToActivity(r.rows[0]) : null);
    });
    if (result !== NO_DB) return result;
    return visible(null, ActivityService.memoryActivities.get(`${ctx.principal.tenantId}:${id}`));
  }

  /**
   * List activities. With a subject: the subject's timeline, for anyone who can read the subject. Without one: only the
   * caller's own activities. Hidden activities are never listed. Newest first, cursor over (occurredAt, id).
   */
  async listActivities(
    ctx: RequestContext,
    filter: ActivityFilter = {},
  ): Promise<{ data: Activity[]; meta: { nextCursor: string | null; limit: number } }> {
    const limit = filter.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw AppError.of('VALIDATION_ERROR', 'limit must be an integer from 1 to 200.', [
        { field: 'limit', issue: 'OUT_OF_RANGE' },
      ]);
    }
    if (Boolean(filter.subjectType) !== Boolean(filter.subjectId)) {
      throw AppError.of('VALIDATION_ERROR', 'subjectType and subjectId go together.', [
        { field: filter.subjectType ? 'subjectId' : 'subjectType', issue: 'REQUIRED' },
      ]);
    }
    const after = decodeActivityCursor(filter.cursor);
    const page = (items: StoredActivity[]) => {
      const data = items.slice(0, limit);
      const last = data[data.length - 1];
      return { data, meta: { nextCursor: items.length > limit && last ? encodeActivityCursor(last) : null, limit } };
    };

    const result = await this.inTx(ctx, async (tx) => {
      if (filter.subjectType && filter.subjectId) {
        await this.subjectFor(ctx, tx, filter.subjectType, filter.subjectId, READ_PERMISSION[filter.subjectType]);
      }
      const r = await sql<Record<string, unknown>>`
        select * from activity
         where is_hidden = false
           ${
             filter.subjectType
               ? sql`and subject_type = ${filter.subjectType} and subject_id = ${filter.subjectId!}`
               : sql`and actor_id = ${ctx.principal.id}`
           }
           ${after ? sql`and (occurred_at, id) < (${after.k}::timestamptz, ${after.id})` : sql``}
         order by occurred_at desc, id desc
         limit ${limit + 1}`.execute(tx);
      return page(r.rows.map(mapDbRowToActivity));
    });
    if (result !== NO_DB) return result;

    if (filter.subjectType && filter.subjectId) {
      await this.subjectFor(ctx, null, filter.subjectType, filter.subjectId, READ_PERMISSION[filter.subjectType]);
    }
    const items = [...ActivityService.memoryActivities.values()]
      .filter(
        (a) =>
          a.tenantId === ctx.principal.tenantId &&
          !a.isHidden &&
          (filter.subjectType
            ? a.subjectType === filter.subjectType && a.subjectId === filter.subjectId
            : a.actorId === ctx.principal.id) &&
          (!after || a.occurredAt < after.k || (a.occurredAt === after.k && a.id < after.id)),
      )
      .sort((a, b) => (a.occurredAt === b.occurredAt ? (a.id < b.id ? 1 : -1) : a.occurredAt < b.occurredAt ? 1 : -1));
    return page(items);
  }

  private async recordAudit(
    tx: Tx,
    ctx: RequestContext,
    action: string,
    entityId: string,
    after: Record<string, unknown>,
  ): Promise<void> {
    if (!this.audit) throw AppError.of('DEPENDENCY_UNAVAILABLE', 'Audit is not configured.');
    await this.audit.record(tx, ctx, { action, entityType: 'activity', entityId, after });
  }

  private memoryAudit(ctx: RequestContext, action: string, entityId: string, data: unknown): void {
    ActivityService.memoryAudits.push({
      id: `aud_${nextUlid()}`,
      tenantId: ctx.principal.tenantId,
      action,
      actorId: ctx.principal.id,
      entityId,
      occurredAt: ctx.now.toISOString(),
      data,
    });
  }
}
