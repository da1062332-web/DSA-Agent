// apps/api/src/modules/crm/targets/openapi.ts — owner: Dev 5 (MOD-PERF Targets)
import {
  ApproveTargetRequestSchema,
  CreateTargetRequestSchema,
  TargetDtoSchema,
  TargetListQuerySchema,
  TargetListResponseSchema,
} from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { z } from 'zod';

export const tags = [
  {
    name: 'MOD-PERF Targets',
    description: 'Performance targets and approval lifecycle (TASK-428 / MOD-PERF SUB-PERF.01).',
  },
];

export function registerOpenApi(registry: OpenAPIRegistry): void {
  // API-PERF-001: Create Target
  registry.registerPath({
    method: 'post',
    path: '/v1/targets',
    operationId: 'API-PERF-001',
    summary: 'API-PERF-001: Create Target (Idempotent)',
    tags: ['MOD-PERF Targets'],
    security: [{ bearerAuth: [] }],
    request: {
      headers: z.object({
        'idempotency-key': z.string().describe('Idempotency key (8-128 chars)'),
      }),
      body: {
        content: {
          'application/json': {
            schema: CreateTargetRequestSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Target created in PENDING_APPROVAL status',
        content: {
          'application/json': {
            schema: TargetDtoSchema,
          },
        },
      },
    },
  });

  // API-PERF-002: List Targets
  registry.registerPath({
    method: 'get',
    path: '/v1/targets',
    operationId: 'API-PERF-002',
    summary: 'API-PERF-002: List Targets',
    tags: ['MOD-PERF Targets'],
    security: [{ bearerAuth: [] }],
    request: {
      query: TargetListQuerySchema,
    },
    responses: {
      200: {
        description: 'List of targets matching query and branch scope',
        content: {
          'application/json': {
            schema: TargetListResponseSchema,
          },
        },
      },
    },
  });

  // API-PERF-003: Approve or Reject Target
  registry.registerPath({
    method: 'post',
    path: '/v1/targets/{id}/approval',
    operationId: 'API-PERF-003',
    summary: 'API-PERF-003: Approve or Reject Target (Dual Control)',
    tags: ['MOD-PERF Targets'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      headers: z.object({
        'if-match': z.string().describe('Target lock version/ETag'),
      }),
      body: {
        content: {
          'application/json': {
            schema: ApproveTargetRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Target approved or rejected',
        content: {
          'application/json': {
            schema: TargetDtoSchema,
          },
        },
      },
    },
  });

  // API-PERF-004: Get Target By ID
  registry.registerPath({
    method: 'get',
    path: '/v1/targets/{id}',
    operationId: 'API-PERF-004',
    summary: 'API-PERF-004: Get Target By ID',
    tags: ['MOD-PERF Targets'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Target details',
        content: {
          'application/json': {
            schema: TargetDtoSchema,
          },
        },
      },
    },
  });

  // API-PERF-005: Get Target History
  registry.registerPath({
    method: 'get',
    path: '/v1/targets/{id}/history',
    operationId: 'API-PERF-005',
    summary: 'API-PERF-005: Get Target Revision History',
    tags: ['MOD-PERF Targets'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'All versions for this target slice',
        content: {
          'application/json': {
            schema: TargetListResponseSchema,
          },
        },
      },
    },
  });
}
