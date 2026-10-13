// OpenAPI registration for module crm/activities (owner: Dev 1 / Dev 5)
// tools/gen-openapi.ts writes openapi/openapi.yaml (never hand-edited; CI fails on a diff).
import {
  ActivitySchema,
  CreateActivitySchema,
  UpdateActivitySchema,
  ErrorEnvelope,
  ListMeta,
} from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { z } from 'zod';

export const tags = [
  { name: 'MOD-ACT Activities', description: 'Activity timeline and interaction tracking (MOD-ACT).' },
];

export function registerOpenApi(registry: OpenAPIRegistry): void {
  registry.register('Activity', ActivitySchema);
  registry.register('CreateActivityInput', CreateActivitySchema);
  registry.register('UpdateActivityInput', UpdateActivitySchema);

  // POST /v1/activities (API-ACT-001)
  registry.registerPath({
    method: 'post',
    path: '/v1/activities',
    operationId: 'API-ACT-001',
    summary: 'Record an interaction (API-ACT-001)',
    tags: ['MOD-ACT Activities'],
    description:
      'Records an interaction (call, meeting, visit, note) against a lead, customer, or loan application.',
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,128}$' },
      },
    ],
    request: {
      body: {
        content: {
          'application/json': {
            schema: CreateActivitySchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Activity successfully recorded',
        content: {
          'application/json': {
            schema: ActivitySchema,
          },
        },
      },
      400: {
        description: 'Malformed request',
        content: { 'application/json': { schema: ErrorEnvelope } },
      },
      401: {
        description: 'Unauthenticated',
        content: { 'application/json': { schema: ErrorEnvelope } },
      },
      403: {
        description: 'Forbidden - missing activity.create permission',
        content: { 'application/json': { schema: ErrorEnvelope } },
      },
      404: {
        description: 'Subject not found or out of scope',
        content: { 'application/json': { schema: ErrorEnvelope } },
      },
      422: {
        description: 'Validation error or S2 PII data rejected in notes',
        content: { 'application/json': { schema: ErrorEnvelope } },
      },
    },
  });

  // PATCH /v1/activities/{id} (API-ACT-002)
  registry.registerPath({
    method: 'patch',
    path: '/v1/activities/{id}',
    operationId: 'API-ACT-002',
    summary: 'Update or hide an activity (API-ACT-002)',
    tags: ['MOD-ACT Activities'],
    description:
      'Edits an activity outcome, duration, note, or soft-hides it with optimistic concurrency protection.',
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
      {
        name: 'If-Match',
        in: 'header',
        required: true,
        schema: { type: 'string' },
      },
    ],
    request: {
      body: {
        content: {
          'application/json': {
            schema: UpdateActivitySchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Activity successfully updated',
        content: {
          'application/json': {
            schema: ActivitySchema,
          },
        },
      },
      401: {
        description: 'Unauthenticated',
        content: { 'application/json': { schema: ErrorEnvelope } },
      },
      403: {
        description: 'Forbidden - missing activity.update permission',
        content: { 'application/json': { schema: ErrorEnvelope } },
      },
      404: {
        description: 'Activity not found',
        content: { 'application/json': { schema: ErrorEnvelope } },
      },
      409: {
        description: 'Version conflict - If-Match does not match current version',
        content: { 'application/json': { schema: ErrorEnvelope } },
      },
      422: {
        description: 'Validation error',
        content: { 'application/json': { schema: ErrorEnvelope } },
      },
    },
  });

  // GET /v1/activities/{id}
  registry.registerPath({
    method: 'get',
    path: '/v1/activities/{id}',
    operationId: 'API-ACT-003',
    summary: 'Get an activity by ID',
    tags: ['MOD-ACT Activities'],
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ],
    responses: {
      200: {
        description: 'Activity retrieved',
        content: {
          'application/json': {
            schema: ActivitySchema,
          },
        },
      },
      404: {
        description: 'Activity not found',
        content: { 'application/json': { schema: ErrorEnvelope } },
      },
    },
  });

  // GET /v1/activities
  registry.registerPath({
    method: 'get',
    path: '/v1/activities',
    operationId: 'API-ACT-004',
    summary: 'List activities',
    tags: ['MOD-ACT Activities'],
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'subjectType',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['LEAD', 'CUSTOMER', 'LOAN_APPLICATION'] },
      },
      {
        name: 'subjectId',
        in: 'query',
        required: false,
        schema: { type: 'string' },
      },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: 50 },
      },
      {
        name: 'cursor',
        in: 'query',
        required: false,
        schema: { type: 'string' },
      },
    ],
    responses: {
      200: {
        description: 'Paginated list of activities',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(ActivitySchema),
              meta: ListMeta,
            }),
          },
        },
      },
    },
  });
}
