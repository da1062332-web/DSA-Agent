// apps/api/src/modules/crm/tasks/router.ts — owner: Dev 6 (MOD-08 Tasks). Task: TASK-302
// APIs: API-TASK-001 (create), API-TASK-002 (list), API-TASK-003 (update), API-TASK-004 (completion).
// Provides: TaskPort (real), TASK ScopeResolver.
import { AppError, type RequestContext } from '@dsa/contracts';
import { Router, type Request, type Response } from 'express';
import type { ZodError } from 'zod';
import type { ApiDeps } from '../../types';
import { SqlTaskRepository, type TaskRepository } from './repository';
import { TaskService } from './task-service';
import {
  CompleteTaskInputSchema,
  CreateTaskInputSchema,
  TaskListQuerySchema,
  UpdateTaskInputSchema,
} from './types';

function getRequestContext(req: Request): RequestContext {
  if (!req.ctx) {
    throw AppError.of('UNAUTHENTICATED', 'No request authentication context.');
  }
  return req.ctx;
}

function extractIdempotencyKey(req: Request): string {
  const raw = req.header('Idempotency-Key');
  if (!raw || !/^[A-Za-z0-9_-]{8,128}$/.test(raw)) {
    throw AppError.of('VALIDATION_ERROR', 'A valid Idempotency-Key header is required', [
      { field: 'Idempotency-Key', issue: 'REQUIRED_OR_INVALID_FORMAT' },
    ]);
  }
  return raw;
}

function extractIfMatch(req: Request): string {
  const raw = req.header('If-Match');
  if (!raw) {
    throw AppError.of('VALIDATION_ERROR', 'If-Match header is required for optimistic concurrency', [
      { field: 'If-Match', issue: 'REQUIRED' },
    ]);
  }
  return raw;
}

function extractParamId(req: Request, paramName = 'id'): string {
  const id = req.params[paramName];
  if (!id || typeof id !== 'string') {
    throw AppError.of('NOT_FOUND', 'Task not found');
  }
  return id;
}

function handleZodError(err: ZodError): never {
  const details = err.issues.map((i) => ({
    field: i.path.join('.'),
    issue: i.message,
  }));
  throw AppError.of('VALIDATION_ERROR', 'Request validation failed', details);
}

function parseETag(etagHeader: string, resourceId: string): number {
  const cleaned = etagHeader.replace(/^W\//, '').replace(/^"|"$/g, '');
  const parts = cleaned.split(':');
  if (parts.length === 2 && parts[0] === resourceId) {
    const v = parseInt(parts[1]!, 10);
    if (!isNaN(v)) return v;
  }
  const v = parseInt(cleaned, 10);
  if (!isNaN(v)) return v;
  throw AppError.of('VERSION_CONFLICT', 'Malformed ETag / If-Match header value');
}

export function createRouter(deps: ApiDeps): Router {
  const router = Router();

  const repository: TaskRepository =
    (deps.taskRepository as TaskRepository | undefined) ?? new SqlTaskRepository();
  const service = new TaskService({
    repository,
    decisionPort: deps.decisionPort,
    userDirectoryPort: deps.userDirectoryPort,
    auditPort: deps.auditPort,
    outboxPort: deps.outboxPort,
    idGenerator: deps.idGenerator,
  });

  // Register real TaskPort on deps if not provided
  if (!deps.taskPort) {
    deps.taskPort = {
      createTask: (tx, ctx, cmd) => service.createTaskPort(tx, ctx, cmd),
    };
  }

  /**
   * API-TASK-001: Create Task
   * POST /tasks
   */
  router.post('/tasks', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const idempotencyKey = extractIdempotencyKey(req);

    const parseResult = CreateTaskInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      handleZodError(parseResult.error);
    }

    const { resource, isReplayed } = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return service.createTask(tx, ctx, parseResult.data, idempotencyKey);
    });

    if (isReplayed) {
      res.setHeader('Idempotent-Replayed', 'true');
    }
    res.setHeader('ETag', `W/"${resource.id}:${resource.lockVersion}"`);
    res.status(isReplayed ? 200 : 201).json(resource);
  });

  /**
   * API-TASK-002: List Tasks
   * GET /tasks
   */
  router.get('/tasks', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);

    const parseResult = TaskListQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      handleZodError(parseResult.error);
    }

    const { data, nextCursor } = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return service.listTasks(tx, ctx, parseResult.data);
    });

    res.status(200).json({
      data,
      pagination: {
        nextCursor,
        hasMore: nextCursor !== null,
      },
    });
  });

  /**
   * GET /tasks/:id: Detail
   */
  router.get('/tasks/:id', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const id = extractParamId(req);

    const resource = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return service.getTask(tx, ctx, id);
    });

    res.setHeader('ETag', `W/"${resource.id}:${resource.lockVersion}"`);
    res.status(200).json(resource);
  });

  /**
   * API-TASK-003: Update Task
   * PATCH /tasks/:id
   */
  router.patch('/tasks/:id', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const id = extractParamId(req);
    const ifMatch = extractIfMatch(req);
    const expectedLockVersion = parseETag(ifMatch, id);

    const parseResult = UpdateTaskInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      handleZodError(parseResult.error);
    }

    const resource = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return service.updateTask(tx, ctx, id, expectedLockVersion, parseResult.data);
    });

    res.setHeader('ETag', `W/"${resource.id}:${resource.lockVersion}"`);
    res.status(200).json(resource);
  });

  /**
   * API-TASK-004: Complete Task
   * POST /tasks/:id/completion
   */
  router.post('/tasks/:id/completion', async (req: Request, res: Response) => {
    const ctx = getRequestContext(req);
    const id = extractParamId(req);
    const ifMatch = extractIfMatch(req);
    const expectedLockVersion = parseETag(ifMatch, id);
    const idempotencyKey = req.header('Idempotency-Key') ?? undefined;

    const parseResult = CompleteTaskInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      handleZodError(parseResult.error);
    }

    const { resource, followUpTask, isReplayed } = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      return service.completeTask(tx, ctx, id, expectedLockVersion, parseResult.data, idempotencyKey);
    });

    if (isReplayed) {
      res.setHeader('Idempotent-Replayed', 'true');
    }
    res.setHeader('ETag', `W/"${resource.id}:${resource.lockVersion}"`);
    res.status(200).json({
      task: resource,
      followUpTask: followUpTask ?? null,
    });
  });

  /**
   * API-TASK-005: Snooze (Conditional / Deferred in MVP)
   * POST /tasks/:id/snooze
   */
  router.post('/tasks/:id/snooze', async (_req: Request, _res: Response) => {
    throw AppError.of('INVALID_STATE', 'Task snooze and reminder schedules are deferred to TASK-405.');
  });

  /**
   * API-TASK-006: Bulk Reassignment (Deferred in MVP)
   * POST /tasks/bulk-reassignment
   */
  router.post('/tasks/bulk-reassignment', async (_req: Request, _res: Response) => {
    throw AppError.of('INVALID_STATE', 'Bulk reassignment is deferred pending TASK-411.');
  });

  return router;
}
