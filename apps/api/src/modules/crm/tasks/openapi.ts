// OpenAPI registration for module crm/tasks (owner: Dev 6). Register this module's paths with zod schemas;
// tools/gen-openapi.ts writes openapi/openapi.yaml (never hand-edited; CI fails on a diff).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { z } from 'zod';
import {
  CompleteTaskInputSchema,
  CreateTaskInputSchema,
  TaskListQuerySchema,
  UpdateTaskInputSchema,
} from './types';

export function registerOpenApi(registry: OpenAPIRegistry): void {
  const TaskResourceSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    type: z.string(),
    title: z.string(),
    ownerUserId: z.string().nullable(),
    ownerQueueId: z.string().nullable(),
    linkedType: z.string(),
    linkedId: z.string(),
    branchId: z.string(),
    priority: z.string(),
    status: z.string(),
    dueAt: z.string(),
    slaClass: z.string().nullable(),
    slaDecisionRecordId: z.string().nullable(),
    outcomeCode: z.string().nullable(),
    completionNote: z.string().nullable(),
    completedAt: z.string().nullable(),
    completedBy: z.string().nullable(),
    followUpTaskId: z.string().nullable(),
    tags: z.array(z.string()),
    lockVersion: z.number(),
    createdAt: z.string(),
    createdBy: z.string(),
    updatedAt: z.string(),
    updatedBy: z.string(),
  });

  // POST /v1/tasks
  registry.registerPath({
    method: 'post',
    path: '/v1/tasks',
    summary: 'API-TASK-001: Create Task',
    tags: ['Tasks'],
    security: [{ bearerAuth: [] }],
    request: {
      headers: z.object({
        'Idempotency-Key': z.string(),
      }),
      body: {
        content: {
          'application/json': {
            schema: CreateTaskInputSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Task created successfully',
        content: {
          'application/json': {
            schema: TaskResourceSchema,
          },
        },
      },
    },
  });

  // GET /v1/tasks
  registry.registerPath({
    method: 'get',
    path: '/v1/tasks',
    summary: 'API-TASK-002: List Tasks',
    tags: ['Tasks'],
    security: [{ bearerAuth: [] }],
    request: {
      query: TaskListQuerySchema,
    },
    responses: {
      200: {
        description: 'List of tasks matching criteria',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(TaskResourceSchema),
              pagination: z.object({
                nextCursor: z.string().nullable(),
                hasMore: z.boolean(),
              }),
            }),
          },
        },
      },
    },
  });

  // GET /v1/tasks/{id}
  registry.registerPath({
    method: 'get',
    path: '/v1/tasks/{id}',
    summary: 'Get Task Detail',
    tags: ['Tasks'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Task details',
        content: {
          'application/json': {
            schema: TaskResourceSchema,
          },
        },
      },
    },
  });

  // PATCH /v1/tasks/{id}
  registry.registerPath({
    method: 'patch',
    path: '/v1/tasks/{id}',
    summary: 'API-TASK-003: Update Task',
    tags: ['Tasks'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      headers: z.object({
        'If-Match': z.string(),
      }),
      body: {
        content: {
          'application/json': {
            schema: UpdateTaskInputSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Updated task',
        content: {
          'application/json': {
            schema: TaskResourceSchema,
          },
        },
      },
    },
  });

  // POST /v1/tasks/{id}/completion
  registry.registerPath({
    method: 'post',
    path: '/v1/tasks/{id}/completion',
    summary: 'API-TASK-004: Complete Task',
    tags: ['Tasks'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      headers: z.object({
        'If-Match': z.string(),
      }),
      body: {
        content: {
          'application/json': {
            schema: CompleteTaskInputSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Task completed successfully',
        content: {
          'application/json': {
            schema: z.object({
              task: TaskResourceSchema,
              followUpTask: TaskResourceSchema.nullable(),
            }),
          },
        },
      },
    },
  });
}
