// apps/api/src/modules/crm/tasks/task-service.ts — owner: Dev 6 (MOD-08 Tasks)
import {
  AppError,
  type AuditPort,
  type CreateTaskCommand,
  type CreatedTask,
  type DecisionPort,
  type IdGenerator,
  type IdPrefix,
  type OutboxPort,
  type RequestContext,
  type SlaClass,
  type Tx,
  type UserDirectoryPort,
} from '@dsa/contracts';
import { ulid } from 'ulid';
import { getTaskScopeFilter, requirePermission, requireTaskAccess } from './authz-helper';
import type { TaskRepository, TaskRow } from './repository';
import type {
  CompleteTaskInput,
  CreateTaskInput,
  TaskListQuery,
  TaskResource,
  UpdateTaskInput,
} from './types';

export interface TaskServiceDeps {
  repository: TaskRepository;
  decisionPort?: DecisionPort;
  userDirectoryPort?: UserDirectoryPort;
  auditPort?: AuditPort;
  outboxPort?: OutboxPort;
  idGenerator?: IdGenerator;
}

export class TaskService {
  constructor(private readonly deps: TaskServiceDeps) {}

  private nextId(prefix: IdPrefix): string {
    return this.deps.idGenerator ? this.deps.idGenerator.next(prefix) : `${prefix}_${ulid()}`;
  }

  private toResource(task: TaskRow): TaskResource {
    return {
      id: task.id,
      tenantId: task.tenant_id,
      type: task.type,
      title: task.title,
      ownerUserId: task.owner_user_id,
      ownerQueueId: task.owner_queue_id,
      linkedType: task.linked_type,
      linkedId: task.linked_id,
      branchId: task.branch_id,
      priority: task.priority,
      status: task.status,
      dueAt: task.due_at.toISOString(),
      slaClass: task.sla_class,
      slaDecisionRecordId: task.sla_decision_record_id,
      outcomeCode: task.outcome_code,
      completionNote: task.completion_note,
      completedAt: task.completed_at ? task.completed_at.toISOString() : null,
      completedBy: task.completed_by,
      followUpTaskId: task.follow_up_task_id,
      tags: task.tags,
      lockVersion: task.lock_version,
      createdAt: task.created_at.toISOString(),
      createdBy: task.created_by,
      updatedAt: task.updated_at.toISOString(),
      updatedBy: task.updated_by,
    };
  }

  /** Calculate SLA due time via DK-sla.target or fallback */
  private async calculateDueAt(
    tx: Tx,
    ctx: RequestContext,
    slaClass?: SlaClass,
    explicitDueAt?: string,
    priority?: 'HIGH' | 'MEDIUM' | 'LOW',
  ): Promise<{ dueAt: Date; decisionRecordId: string | null; ruleVersionId: string | null }> {
    if (explicitDueAt) {
      return {
        dueAt: new Date(explicitDueAt),
        decisionRecordId: null,
        ruleVersionId: null,
      };
    }

    if (!slaClass) {
      throw AppError.of('VALIDATION_ERROR', 'dueAt or slaClass is required');
    }

    let targetMinutes = 1440; // Default 24 hours fallback if decision engine is missing or fails
    let decisionRecordId: string | null = null;
    let ruleVersionId: string | null = null;

    if (this.deps.decisionPort) {
      try {
        const decisionRes = await this.deps.decisionPort.decide(tx, ctx, {
          decisionKey: 'DK-sla.target',
          scope: {},
          subject: { type: 'TASK', id: 'new_task' },
          evaluationTime: ctx.now ? ctx.now.toISOString() : new Date().toISOString(),
          idempotencyKey: `sla_${ctx.correlationId}_${slaClass}`,
          facts: {
            sla: { class: slaClass },
            record: {
              type: 'TASK',
              priority: priority ?? 'MEDIUM',
            },
          },
        });
        if (decisionRes.status === 'OK' && decisionRes.outputs) {
          const out = decisionRes.outputs as { target_business_minutes?: number };
          targetMinutes = out.target_business_minutes ?? 1440;
          decisionRecordId = decisionRes.decisionRecordId;
          ruleVersionId = decisionRes.ruleSetVersionId;
        }
      } catch {
        // Fallback applied
      }
    } else {
      // Approved elapsed minutes mappings for MVP (calendar ALWAYS)
      switch (slaClass) {
        case 'CUSTOMER_FIRST_CONTACT':
          targetMinutes = 120; // 2 hours
          break;
        case 'CUSTOMER_FOLLOW_UP':
          targetMinutes = 1440; // 24 hours
          break;
        case 'LENDER_QUERY':
          targetMinutes = 240; // 4 hours
          break;
        case 'DOCUMENT_REVIEW':
          targetMinutes = 360; // 6 hours
          break;
        case 'INTERNAL_REVIEW':
          targetMinutes = 480; // 8 hours
          break;
        default:
          targetMinutes = 1440;
      }
    }

    const nowTime = ctx.now ? ctx.now.getTime() : Date.now();
    const dueAt = new Date(nowTime + targetMinutes * 60 * 1000);
    return { dueAt, decisionRecordId, ruleVersionId };
  }

  /**
   * API-TASK-001: Create Task
   */
  async createTask(
    tx: Tx,
    ctx: RequestContext,
    input: CreateTaskInput,
    idempotencyKey: string,
  ): Promise<{ resource: TaskResource; isReplayed: boolean }> {
    const tenantId = ctx.principal.tenantId;

    // 1. Idempotency check
    const existing = await this.deps.repository.findTaskByIdempotencyKey(tx, tenantId, idempotencyKey);
    if (existing) {
      if (
        existing.type !== input.type ||
        existing.linked_type !== input.linkedType ||
        existing.linked_id !== input.linkedId ||
        existing.branch_id !== input.branchId
      ) {
        throw AppError.of('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used for a different request.');
      }
      return {
        resource: this.toResource(existing),
        isReplayed: true,
      };
    }

    requirePermission(ctx, 'task.create');

    // Branch scope check: if caller has BRANCH scope only, branchId must be permitted
    const branchGrants = ctx.principal.grants.filter((g) => g.code === 'task.create' && g.scope === 'BRANCH');
    const tenantGrants = ctx.principal.grants.filter((g) => g.code === 'task.create' && g.scope === 'TENANT');
    if (branchGrants.length > 0 && tenantGrants.length === 0) {
      const allowedBranches = new Set<string>();
      for (const g of branchGrants) {
        for (const b of g.branchIds) allowedBranches.add(b);
      }
      if (ctx.principal.primaryBranchId) allowedBranches.add(ctx.principal.primaryBranchId);
      if (!allowedBranches.has(input.branchId)) {
        throw AppError.of('FORBIDDEN', `Cannot create task in branch '${input.branchId}'.`);
      }
    }

    // 2. Validate owner/queue eligibility if UserDirectoryPort is configured
    if (input.ownerUserId && this.deps.userDirectoryPort) {
      const user = await this.deps.userDirectoryPort.getUser(tx, input.ownerUserId);
      if (user && user.status !== 'ACTIVE') {
        throw AppError.of('VALIDATION_ERROR', `Assigned user '${input.ownerUserId}' is not active.`);
      }
    }
    if (input.ownerQueueId && this.deps.userDirectoryPort) {
      const queue = await this.deps.userDirectoryPort.getQueue(tx, input.ownerQueueId);
      if (queue && (!queue.active || !queue.recordTypes.includes('TASK'))) {
        throw AppError.of('VALIDATION_ERROR', `Queue '${input.ownerQueueId}' is inactive or does not accept tasks.`);
      }
    }

    // 3. Compute dueAt and SLA decision
    const { dueAt, decisionRecordId, ruleVersionId } = await this.calculateDueAt(
      tx,
      ctx,
      input.slaClass,
      input.dueAt,
      input.priority,
    );

    const taskId = this.nextId('task');
    const now = ctx.now;

    const row: TaskRow = {
      id: taskId,
      tenant_id: tenantId,
      type: input.type,
      title: input.title,
      owner_user_id: input.ownerUserId ?? null,
      owner_queue_id: input.ownerQueueId ?? null,
      linked_type: input.linkedType,
      linked_id: input.linkedId,
      branch_id: input.branchId,
      priority: input.priority,
      status: 'OPEN',
      due_at: dueAt,
      sla_class: input.slaClass ?? null,
      sla_decision_record_id: decisionRecordId,
      sla_rule_version_id: ruleVersionId,
      outcome_code: null,
      completion_note: null,
      completed_at: null,
      completed_by: null,
      follow_up_task_id: null,
      idempotency_key: idempotencyKey,
      created_by_source: ctx.principal.kind === 'USER' ? 'USER' : 'SYSTEM',
      tags: input.tags,
      lock_version: 0,
      created_at: now,
      created_by: ctx.principal.id,
      updated_at: now,
      updated_by: ctx.principal.id,
    };

    await this.deps.repository.insertTask(tx, row);

    // Outbox & Audit
    await this.deps.repository.insertOutboxEvent(tx, {
      id: this.nextId('evt'),
      tenant_id: tenantId,
      event_type: 'task.created',
      event_version: 1,
      subject_type: 'TASK',
      subject_id: taskId,
      payload: {
        taskId,
        type: row.type,
        title: row.title,
        ownerUserId: row.owner_user_id,
        ownerQueueId: row.owner_queue_id,
        linkedType: row.linked_type,
        linkedId: row.linked_id,
        dueAt: row.due_at.toISOString(),
      },
      correlation_id: ctx.correlationId,
      chain_depth: 0,
      created_at: now,
    });

    const resource = this.toResource(row);

    await this.deps.repository.insertAuditEvent(tx, {
      id: this.nextId('aud'),
      tenant_id: tenantId,
      actor_type: ctx.principal.kind,
      actor_id: ctx.principal.id,
      action: 'task.created',
      entity_type: 'task',
      entity_id: taskId,
      after: resource as unknown as Record<string, unknown>,
      correlation_id: ctx.correlationId,
      occurred_at: now,
    });

    return { resource, isReplayed: false };
  }

  /**
   * TaskPort Implementation (Contracts §4.3)
   */
  async createTaskPort(
    tx: Tx,
    ctx: RequestContext,
    cmd: CreateTaskCommand,
  ): Promise<CreatedTask> {
    const ownerUserId = 'userId' in cmd.owner ? cmd.owner.userId : undefined;
    const ownerQueueId = 'queueId' in cmd.owner ? cmd.owner.queueId : undefined;

    const res = await this.createTask(
      tx,
      ctx,
      {
        type: cmd.type,
        title: cmd.title,
        ownerUserId,
        ownerQueueId,
        linkedType: cmd.linked.type,
        linkedId: cmd.linked.id,
        branchId: cmd.linked.branchId,
        priority: cmd.priority ?? 'MEDIUM',
        slaClass: cmd.slaClass,
        dueAt: cmd.dueAt,
        tags: [],
      },
      cmd.idempotencyKey,
    );

    return {
      taskId: res.resource.id,
      dueAt: res.resource.dueAt,
      slaDecisionRecordId: res.resource.slaDecisionRecordId,
      replayed: res.isReplayed,
    };
  }

  /**
   * API-TASK-003: Update Task
   */
  async updateTask(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    expectedLockVersion: number,
    input: UpdateTaskInput,
  ): Promise<TaskResource> {
    const tenantId = ctx.principal.tenantId;
    const task = await this.deps.repository.findTaskByIdForUpdate(tx, tenantId, id);

    requireTaskAccess(ctx, 'task.update', task);

    if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
      throw AppError.of('INVALID_STATE', `Cannot update task in '${task.status}' status.`);
    }

    // Owner / Queue updates
    let ownerUserId = task.owner_user_id;
    let ownerQueueId = task.owner_queue_id;

    if (input.ownerUserId !== undefined) {
      ownerUserId = input.ownerUserId;
      if (input.ownerUserId !== null) {
        ownerQueueId = null;
      }
    }
    if (input.ownerQueueId !== undefined) {
      ownerQueueId = input.ownerQueueId;
      if (input.ownerQueueId !== null) {
        ownerUserId = null;
      }
    }

    if (!ownerUserId && !ownerQueueId) {
      throw AppError.of('VALIDATION_ERROR', 'A task must have either an owner user or an owner queue.');
    }

    const updated = await this.deps.repository.updateTask(
      tx,
      tenantId,
      id,
      expectedLockVersion,
      {
        owner_user_id: ownerUserId,
        owner_queue_id: ownerQueueId,
        priority: input.priority,
        status: input.status,
        due_at: input.dueAt ? new Date(input.dueAt) : undefined,
        updated_by: ctx.principal.id,
      },
    );

    if (!updated) {
      throw AppError.of('VERSION_CONFLICT', 'Task update conflicted with another change (ETag mismatch).');
    }

    const resource = this.toResource(updated);

    await this.deps.repository.insertAuditEvent(tx, {
      id: this.nextId('aud'),
      tenant_id: tenantId,
      actor_type: ctx.principal.kind,
      actor_id: ctx.principal.id,
      action: 'task.updated',
      entity_type: 'task',
      entity_id: id,
      after: resource as unknown as Record<string, unknown>,
      correlation_id: ctx.correlationId,
      occurred_at: ctx.now,
    });

    return resource;
  }

  /**
   * API-TASK-004: Complete Task
   */
  async completeTask(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    expectedLockVersion: number,
    input: CompleteTaskInput,
    idempotencyKey?: string,
  ): Promise<{ resource: TaskResource; followUpTask?: TaskResource | null; isReplayed: boolean }> {
    const tenantId = ctx.principal.tenantId;
    const task = await this.deps.repository.findTaskByIdForUpdate(tx, tenantId, id);

    requireTaskAccess(ctx, 'task.update', task);

    // ETag concurrency check first before replay or follow-up side effects
    if (expectedLockVersion !== task.lock_version) {
      throw AppError.of('VERSION_CONFLICT', 'Resource has been modified (ETag mismatch).');
    }

    // If already completed, idempotent replay check
    if (task.status === 'COMPLETED') {
      return {
        resource: this.toResource(task),
        isReplayed: true,
      };
    }

    if (task.status === 'CANCELLED') {
      throw AppError.of('INVALID_STATE', 'Cannot complete a cancelled task.');
    }

    // CHECK constraint: FOLLOW_UP and CALL types MUST have outcome_code
    if ((task.type === 'FOLLOW_UP' || task.type === 'CALL') && !input.outcomeCode) {
      throw AppError.of(
        'VALIDATION_ERROR',
        `Outcome code is required when completing a task of type '${task.type}'.`,
      );
    }

    const now = ctx.now;
    let followUpTaskId: string | null = null;
    let followUpResource: TaskResource | null = null;

    // Optional next action / follow up creation
    if (input.nextAction && input.nextAction.createFollowUp) {
      const followUpIdem = idempotencyKey ? `${idempotencyKey}:follow_up` : `followup_${id}_${now.getTime()}`;
      const followUp = await this.createTask(
        tx,
        ctx,
        {
          type: input.nextAction.followUpType,
          title: input.nextAction.followUpTitle ?? `Follow-up on: ${task.title}`,
          ownerUserId: task.owner_user_id ?? undefined,
          ownerQueueId: task.owner_queue_id ?? undefined,
          linkedType: task.linked_type,
          linkedId: task.linked_id,
          branchId: task.branch_id,
          priority: task.priority,
          dueAt: input.nextAction.followUpDueAt,
          tags: task.tags,
        },
        followUpIdem,
      );
      followUpTaskId = followUp.resource.id;
      followUpResource = followUp.resource;
    }

    const updated = await this.deps.repository.updateTask(
      tx,
      tenantId,
      id,
      expectedLockVersion,
      {
        status: 'COMPLETED',
        outcome_code: input.outcomeCode,
        completion_note: input.completionNote,
        completed_at: now,
        completed_by: ctx.principal.id,
        follow_up_task_id: followUpTaskId,
        updated_by: ctx.principal.id,
      },
    );

    if (!updated) {
      throw AppError.of('VERSION_CONFLICT', 'Task completion conflicted with another change (ETag mismatch).');
    }

    // Emit task.completed domain event
    await this.deps.repository.insertOutboxEvent(tx, {
      id: this.nextId('evt'),
      tenant_id: tenantId,
      event_type: 'task.completed',
      event_version: 1,
      subject_type: 'TASK',
      subject_id: id,
      payload: {
        taskId: id,
        outcomeCode: input.outcomeCode,
        completedAt: now.toISOString(),
        completedBy: ctx.principal.id,
        followUpTaskId,
      },
      correlation_id: ctx.correlationId,
      chain_depth: 0,
      created_at: now,
    });

    const resource = this.toResource(updated);

    await this.deps.repository.insertAuditEvent(tx, {
      id: this.nextId('aud'),
      tenant_id: tenantId,
      actor_type: ctx.principal.kind,
      actor_id: ctx.principal.id,
      action: 'task.completed',
      entity_type: 'task',
      entity_id: id,
      after: resource as unknown as Record<string, unknown>,
      correlation_id: ctx.correlationId,
      occurred_at: now,
    });

    return { resource, followUpTask: followUpResource, isReplayed: false };
  }

  /**
   * API-TASK-002: List Tasks
   */
  async listTasks(
    tx: Tx,
    ctx: RequestContext,
    query: TaskListQuery,
  ): Promise<{ data: TaskResource[]; nextCursor: string | null }> {
    requirePermission(ctx, 'task.read');

    const filter = getTaskScopeFilter(ctx, 'task.read');

    const result = await this.deps.repository.listTasks(tx, {
      tenantId: ctx.principal.tenantId,
      view: query.view,
      currentUserId: ctx.principal.id,
      userQueueIds: ctx.principal.queueIds,
      status: query.status,
      priority: query.priority,
      linkedType: query.linkedType,
      linkedId: query.linkedId,
      branchId: query.branchId,
      allowedBranchIds: filter.branchIds,
      allowedTeamUserIds: filter.teamUserIds,
      allowedOwnUserId: filter.ownUserId,
      isTenantWide: filter.isTenantWide,
      limit: query.limit,
      cursor: query.cursor,
    });

    return {
      data: result.tasks.map((t) => this.toResource(t)),
      nextCursor: result.nextCursor,
    };
  }

  /**
   * Get Single Task by ID
   */
  async getTask(tx: Tx, ctx: RequestContext, id: string): Promise<TaskResource> {
    const tenantId = ctx.principal.tenantId;
    const task = await this.deps.repository.findTaskById(tx, tenantId, id);

    requireTaskAccess(ctx, 'task.read', task);

    return this.toResource(task);
  }
}
