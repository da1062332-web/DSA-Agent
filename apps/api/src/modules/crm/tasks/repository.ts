// apps/api/src/modules/crm/tasks/repository.ts — owner: Dev 6 (ENT-030 persistence)
import { AppError, type Tx } from '@dsa/contracts';
import { sql } from 'kysely';
import type { TaskPriority, TaskRow, TaskStatus } from './types';
export type { TaskRow };

export interface TaskListParams {
  tenantId: string;
  view: 'MINE' | 'QUEUES' | 'ALL';
  currentUserId: string;
  userQueueIds: string[];
  status?: TaskStatus;
  priority?: TaskPriority;
  linkedType?: string;
  linkedId?: string;
  branchId?: string;
  allowedBranchIds?: string[];
  allowedTeamUserIds?: string[];
  allowedOwnUserId?: string | null;
  isTenantWide?: boolean;
  limit: number;
  cursor?: string;
}

export interface TaskRepository {
  insertTask(tx: Tx, row: TaskRow): Promise<void>;
  findTaskById(tx: Tx, tenantId: string, id: string): Promise<TaskRow | null>;
  findTaskByIdForUpdate(tx: Tx, tenantId: string, id: string): Promise<TaskRow | null>;
  findTaskByIdempotencyKey(tx: Tx, tenantId: string, key: string): Promise<TaskRow | null>;
  updateTask(
    tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<
      Pick<
        TaskRow,
        | 'owner_user_id'
        | 'owner_queue_id'
        | 'priority'
        | 'status'
        | 'due_at'
        | 'outcome_code'
        | 'completion_note'
        | 'completed_at'
        | 'completed_by'
        | 'follow_up_task_id'
        | 'updated_by'
      >
    >,
  ): Promise<TaskRow | null>;
  listTasks(tx: Tx, params: TaskListParams): Promise<{ tasks: TaskRow[]; nextCursor: string | null }>;
  insertOutboxEvent(
    tx: Tx,
    event: {
      id: string;
      tenant_id: string;
      event_type: string;
      event_version: number;
      subject_type: string;
      subject_id: string;
      payload: Record<string, unknown>;
      correlation_id: string;
      causation_id?: string | null;
      chain_depth: number;
      created_at: Date;
    },
  ): Promise<void>;
  insertAuditEvent(
    tx: Tx,
    event: {
      id: string;
      tenant_id: string;
      actor_type: 'USER' | 'SERVICE';
      actor_id: string;
      action: string;
      entity_type: string;
      entity_id: string;
      after?: Record<string, unknown> | null;
      correlation_id: string;
      occurred_at: Date;
    },
  ): Promise<void>;
}

export class SqlTaskRepository implements TaskRepository {
  async insertTask(tx: Tx, row: TaskRow): Promise<void> {
    await sql`
      INSERT INTO task (
        id, tenant_id, type, title, owner_user_id, owner_queue_id,
        linked_type, linked_id, branch_id, priority, status, due_at,
        sla_class, sla_decision_record_id, sla_rule_version_id, outcome_code,
        completion_note, completed_at, completed_by, follow_up_task_id,
        idempotency_key, created_by_source, tags, lock_version,
        created_at, created_by, updated_at, updated_by
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.type}, ${row.title}, ${row.owner_user_id}, ${row.owner_queue_id},
        ${row.linked_type}, ${row.linked_id}, ${row.branch_id}, ${row.priority}, ${row.status}, ${row.due_at},
        ${row.sla_class}, ${row.sla_decision_record_id}, ${row.sla_rule_version_id}, ${row.outcome_code},
        ${row.completion_note}, ${row.completed_at}, ${row.completed_by}, ${row.follow_up_task_id},
        ${row.idempotency_key}, ${row.created_by_source}, ${row.tags}, ${row.lock_version},
        ${row.created_at}, ${row.created_by}, ${row.updated_at}, ${row.updated_by}
      )
    `.execute(tx);
  }

  async findTaskById(tx: Tx, tenantId: string, id: string): Promise<TaskRow | null> {
    if (!tenantId) {
      throw AppError.of('VALIDATION_ERROR', 'Tenant context required', [
        { field: 'tenantId', issue: 'TENANT_CONTEXT_MISSING' },
      ]);
    }
    const result = await sql<TaskRow>`
      SELECT * FROM task
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return result.rows[0] ?? null;
  }

  async findTaskByIdForUpdate(tx: Tx, tenantId: string, id: string): Promise<TaskRow | null> {
    if (!tenantId) {
      throw AppError.of('VALIDATION_ERROR', 'Tenant context required', [
        { field: 'tenantId', issue: 'TENANT_CONTEXT_MISSING' },
      ]);
    }
    const result = await sql<TaskRow>`
      SELECT * FROM task
      WHERE tenant_id = ${tenantId} AND id = ${id}
      FOR UPDATE
    `.execute(tx);
    return result.rows[0] ?? null;
  }

  async findTaskByIdempotencyKey(tx: Tx, tenantId: string, key: string): Promise<TaskRow | null> {
    if (!tenantId) {
      throw AppError.of('VALIDATION_ERROR', 'Tenant context required', [
        { field: 'tenantId', issue: 'TENANT_CONTEXT_MISSING' },
      ]);
    }
    const result = await sql<TaskRow>`
      SELECT * FROM task
      WHERE tenant_id = ${tenantId} AND idempotency_key = ${key}
    `.execute(tx);
    return result.rows[0] ?? null;
  }

  async updateTask(
    tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<
      Pick<
        TaskRow,
        | 'owner_user_id'
        | 'owner_queue_id'
        | 'priority'
        | 'status'
        | 'due_at'
        | 'outcome_code'
        | 'completion_note'
        | 'completed_at'
        | 'completed_by'
        | 'follow_up_task_id'
        | 'updated_by'
      >
    >,
  ): Promise<TaskRow | null> {
    if (!tenantId) {
      throw AppError.of('VALIDATION_ERROR', 'Tenant context required', [
        { field: 'tenantId', issue: 'TENANT_CONTEXT_MISSING' },
      ]);
    }
    const result = await sql<TaskRow>`
      UPDATE task
      SET
        owner_user_id = ${updates.owner_user_id !== undefined ? updates.owner_user_id : sql`owner_user_id`},
        owner_queue_id = ${updates.owner_queue_id !== undefined ? updates.owner_queue_id : sql`owner_queue_id`},
        priority = COALESCE(${updates.priority ?? null}, priority),
        status = COALESCE(${updates.status ?? null}, status),
        due_at = COALESCE(${updates.due_at ?? null}, due_at),
        outcome_code = COALESCE(${updates.outcome_code ?? null}, outcome_code),
        completion_note = COALESCE(${updates.completion_note ?? null}, completion_note),
        completed_at = COALESCE(${updates.completed_at ?? null}, completed_at),
        completed_by = COALESCE(${updates.completed_by ?? null}, completed_by),
        follow_up_task_id = COALESCE(${updates.follow_up_task_id ?? null}, follow_up_task_id),
        updated_by = ${updates.updated_by ?? 'system'},
        lock_version = lock_version + 1,
        updated_at = now()
      WHERE tenant_id = ${tenantId}
        AND id = ${id}
        AND lock_version = ${expectedLockVersion}
      RETURNING *
    `.execute(tx);

    return result.rows[0] ?? null;
  }

  async listTasks(tx: Tx, params: TaskListParams): Promise<{ tasks: TaskRow[]; nextCursor: string | null }> {
    const limit = params.limit;
    const fetchLimit = limit + 1;

    let cursorDate: Date | null = null;
    let cursorId: string | null = null;
    if (params.cursor) {
      try {
        const decoded = Buffer.from(params.cursor, 'base64url').toString('utf8');
        const [d, cid] = decoded.split('|');
        if (d && cid && !isNaN(new Date(d).getTime())) {
          cursorDate = new Date(d);
          cursorId = cid;
        } else {
          throw new Error('Invalid cursor');
        }
      } catch {
        throw AppError.of('VALIDATION_ERROR', 'Invalid pagination cursor', [
          { field: 'cursor', issue: 'INVALID_CURSOR' },
        ]);
      }
    }

    const result = await sql<TaskRow>`
      SELECT * FROM task
      WHERE tenant_id = ${params.tenantId}
        ${params.status ? sql`AND status = ${params.status}` : sql``}
        ${params.priority ? sql`AND priority = ${params.priority}` : sql``}
        ${params.linkedType ? sql`AND linked_type = ${params.linkedType}` : sql``}
        ${params.linkedId ? sql`AND linked_id = ${params.linkedId}` : sql``}
        ${params.branchId ? sql`AND branch_id = ${params.branchId}` : sql``}
        ${
          params.view === 'MINE'
            ? sql`AND owner_user_id = ${params.currentUserId}`
            : params.view === 'QUEUES'
              ? sql`AND (owner_queue_id IS NOT NULL AND owner_queue_id = ANY(${params.userQueueIds}))`
              : !params.isTenantWide
                ? sql`AND (
                    ${params.allowedBranchIds && params.allowedBranchIds.length > 0 ? sql`branch_id = ANY(${params.allowedBranchIds})` : sql`false`}
                    OR ${params.allowedOwnUserId ? sql`owner_user_id = ${params.allowedOwnUserId}` : sql`false`}
                    OR ${params.allowedTeamUserIds && params.allowedTeamUserIds.length > 0 ? sql`owner_user_id = ANY(${params.allowedTeamUserIds})` : sql`false`}
                    OR ${params.userQueueIds && params.userQueueIds.length > 0 ? sql`owner_queue_id = ANY(${params.userQueueIds})` : sql`false`}
                  )`
                : sql``
        }
        ${cursorDate && cursorId ? sql`AND (due_at, id) < (${cursorDate}, ${cursorId})` : sql``}
      ORDER BY due_at ASC, id ASC
      LIMIT ${fetchLimit}
    `.execute(tx);

    const rows = result.rows;
    let nextCursor: string | null = null;

    if (rows.length > limit) {
      const nextItem = rows[limit - 1];
      if (nextItem) {
        nextCursor = Buffer.from(`${nextItem.due_at.toISOString()}|${nextItem.id}`).toString('base64url');
      }
      rows.pop();
    }

    return { tasks: rows, nextCursor };
  }

  async insertOutboxEvent(
    tx: Tx,
    event: {
      id: string;
      tenant_id: string;
      event_type: string;
      event_version: number;
      subject_type: string;
      subject_id: string;
      payload: Record<string, unknown>;
      correlation_id: string;
      causation_id?: string | null;
      chain_depth: number;
      created_at: Date;
    },
  ): Promise<void> {
    await sql`
      INSERT INTO outbox_event (
        id, tenant_id, event_type, event_version, subject_type, subject_id,
        payload, correlation_id, causation_id, chain_depth, created_at
      ) VALUES (
        ${event.id}, ${event.tenant_id}, ${event.event_type}, ${event.event_version},
        ${event.subject_type}, ${event.subject_id}, ${event.payload},
        ${event.correlation_id}, ${event.causation_id ?? null}, ${event.chain_depth},
        ${event.created_at}
      )
    `.execute(tx);
  }

  async insertAuditEvent(
    tx: Tx,
    event: {
      id: string;
      tenant_id: string;
      actor_type: 'USER' | 'SERVICE';
      actor_id: string;
      action: string;
      entity_type: string;
      entity_id: string;
      after?: Record<string, unknown> | null;
      correlation_id: string;
      occurred_at: Date;
    },
  ): Promise<void> {
    await sql`
      INSERT INTO audit_event (
        id, tenant_id, actor_type, actor_id, action, entity_type, entity_id,
        after, correlation_id, occurred_at
      ) VALUES (
        ${event.id}, ${event.tenant_id}, ${event.actor_type}, ${event.actor_id},
        ${event.action}, ${event.entity_type}, ${event.entity_id},
        ${event.after ? JSON.stringify(event.after) : null}, ${event.correlation_id},
        ${event.occurred_at}
      )
    `.execute(tx);
  }
}

export class InMemoryTaskRepository implements TaskRepository {
  readonly tasks = new Map<string, TaskRow>();
  readonly outboxEvents: Array<Record<string, unknown>> = [];
  readonly auditEvents: Array<Record<string, unknown>> = [];

  async insertTask(_tx: Tx, row: TaskRow): Promise<void> {
    this.tasks.set(`${row.tenant_id}:${row.id}`, { ...row });
  }

  async findTaskById(_tx: Tx, tenantId: string, id: string): Promise<TaskRow | null> {
    if (!tenantId) {
      throw AppError.of('VALIDATION_ERROR', 'Tenant context required', [
        { field: 'tenantId', issue: 'TENANT_CONTEXT_MISSING' },
      ]);
    }
    return this.tasks.get(`${tenantId}:${id}`) ?? null;
  }

  async findTaskByIdForUpdate(tx: Tx, tenantId: string, id: string): Promise<TaskRow | null> {
    return this.findTaskById(tx, tenantId, id);
  }

  async findTaskByIdempotencyKey(_tx: Tx, tenantId: string, key: string): Promise<TaskRow | null> {
    if (!tenantId) {
      throw AppError.of('VALIDATION_ERROR', 'Tenant context required', [
        { field: 'tenantId', issue: 'TENANT_CONTEXT_MISSING' },
      ]);
    }
    for (const t of this.tasks.values()) {
      if (t.tenant_id === tenantId && t.idempotency_key === key) {
        return t;
      }
    }
    return null;
  }

  async updateTask(
    _tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<
      Pick<
        TaskRow,
        | 'owner_user_id'
        | 'owner_queue_id'
        | 'priority'
        | 'status'
        | 'due_at'
        | 'outcome_code'
        | 'completion_note'
        | 'completed_at'
        | 'completed_by'
        | 'follow_up_task_id'
        | 'updated_by'
      >
    >,
  ): Promise<TaskRow | null> {
    if (!tenantId) {
      throw AppError.of('VALIDATION_ERROR', 'Tenant context required', [
        { field: 'tenantId', issue: 'TENANT_CONTEXT_MISSING' },
      ]);
    }
    const key = `${tenantId}:${id}`;
    const existing = this.tasks.get(key);

    if (!existing || existing.lock_version !== expectedLockVersion) {
      return null;
    }

    const updated: TaskRow = {
      ...existing,
      owner_user_id: updates.owner_user_id !== undefined ? updates.owner_user_id : existing.owner_user_id,
      owner_queue_id: updates.owner_queue_id !== undefined ? updates.owner_queue_id : existing.owner_queue_id,
      priority: updates.priority ?? existing.priority,
      status: updates.status ?? existing.status,
      due_at: updates.due_at ?? existing.due_at,
      outcome_code: updates.outcome_code ?? existing.outcome_code,
      completion_note: updates.completion_note ?? existing.completion_note,
      completed_at: updates.completed_at ?? existing.completed_at,
      completed_by: updates.completed_by ?? existing.completed_by,
      follow_up_task_id: updates.follow_up_task_id ?? existing.follow_up_task_id,
      updated_by: updates.updated_by ?? existing.updated_by,
      lock_version: existing.lock_version + 1,
      updated_at: new Date(),
    };

    this.tasks.set(`${existing.tenant_id}:${existing.id}`, updated);
    return updated;
  }

  async listTasks(_tx: Tx, params: TaskListParams): Promise<{ tasks: TaskRow[]; nextCursor: string | null }> {
    let list = Array.from(this.tasks.values()).filter((t) => t.tenant_id === params.tenantId);

    if (params.status) {
      list = list.filter((t) => t.status === params.status);
    }
    if (params.priority) {
      list = list.filter((t) => t.priority === params.priority);
    }
    if (params.linkedType) {
      list = list.filter((t) => t.linked_type === params.linkedType);
    }
    if (params.linkedId) {
      list = list.filter((t) => t.linked_id === params.linkedId);
    }
    if (params.branchId) {
      list = list.filter((t) => t.branch_id === params.branchId);
    }

    if (params.view === 'MINE') {
      list = list.filter((t) => t.owner_user_id === params.currentUserId);
    } else if (params.view === 'QUEUES') {
      list = list.filter((t) => t.owner_queue_id !== null && params.userQueueIds.includes(t.owner_queue_id));
    } else if (!params.isTenantWide) {
      list = list.filter((t) => {
        if (params.allowedBranchIds && params.allowedBranchIds.includes(t.branch_id)) {
          return true;
        }
        if (params.allowedOwnUserId && t.owner_user_id === params.allowedOwnUserId) {
          return true;
        }
        if (
          params.allowedTeamUserIds &&
          t.owner_user_id &&
          params.allowedTeamUserIds.includes(t.owner_user_id)
        ) {
          return true;
        }
        if (t.owner_queue_id && params.userQueueIds.includes(t.owner_queue_id)) {
          return true;
        }
        return false;
      });
    }

    list.sort((a, b) => {
      const cmp = a.due_at.getTime() - b.due_at.getTime();
      if (cmp !== 0) return cmp;
      return a.id.localeCompare(b.id);
    });

    if (params.cursor) {
      try {
        const decoded = Buffer.from(params.cursor, 'base64url').toString('utf8');
        const [d, cid] = decoded.split('|');
        if (d && cid && !isNaN(new Date(d).getTime())) {
          const cursorTime = new Date(d).getTime();
          list = list.filter((t) => {
            const time = t.due_at.getTime();
            if (time > cursorTime) return true;
            if (time === cursorTime && t.id.localeCompare(cid) > 0) return true;
            return false;
          });
        } else {
          throw new Error('Invalid cursor');
        }
      } catch {
        throw AppError.of('VALIDATION_ERROR', 'Invalid pagination cursor', [
          { field: 'cursor', issue: 'INVALID_CURSOR' },
        ]);
      }
    }

    let nextCursor: string | null = null;
    if (list.length > params.limit) {
      const nextItem = list[params.limit - 1];
      if (nextItem) {
        nextCursor = Buffer.from(`${nextItem.due_at.toISOString()}|${nextItem.id}`).toString('base64url');
      }
      list = list.slice(0, params.limit);
    }

    return { tasks: list, nextCursor };
  }

  async insertOutboxEvent(_tx: Tx, event: Record<string, unknown>): Promise<void> {
    this.outboxEvents.push({ ...event });
  }

  async insertAuditEvent(_tx: Tx, event: Record<string, unknown>): Promise<void> {
    this.auditEvents.push({ ...event });
  }
}
