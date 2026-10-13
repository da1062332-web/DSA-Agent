// apps/api/src/modules/crm/leads/openapi.ts — owner: Dev 5 (MOD-04 Leads)
import { ListMeta } from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { z } from 'zod';
import {
  AssignLeadInputObjectSchema,
  ConvertLeadInputSchema,
  CreateLeadInputSchema,
  LeadTransitionInputSchema,
  UpdateLeadInputSchema,
} from './types';

export const tags = [
  { name: 'MOD-LEAD Leads', description: 'Lead intake, assignment, transitions, and conversion (MOD-LEAD).' },
];

export function registerOpenApi(registry: OpenAPIRegistry): void {
  registry.register('CreateLeadInput', CreateLeadInputSchema);
  registry.register('UpdateLeadInput', UpdateLeadInputSchema);
  registry.register('LeadTransitionInput', LeadTransitionInputSchema);
  registry.register('AssignLeadInput', AssignLeadInputObjectSchema);
  registry.register('ConvertLeadInput', ConvertLeadInputSchema);

  // API-LEAD-001: POST /v1/leads
  registry.registerPath({
    method: 'post',
    path: '/v1/leads',
    operationId: 'API-LEAD-001',
    summary: 'Capture a new lead with consent (API-LEAD-001)',
    tags: ['MOD-LEAD Leads'],
    request: {
      headers: z.object({
        'Idempotency-Key': z.string(),
      }),
      body: {
        content: { 'application/json': { schema: CreateLeadInputSchema } },
        required: true,
      },
    },
    responses: {
      201: {
        description: 'Lead created successfully',
        headers: {
          ETag: {
            schema: { type: 'string' },
            description: 'Lead lock version',
          },
        },
        content: {
          'application/json': {
            schema: z.object({
              id: z.string(),
              state: z.literal('NEW'),
              mobileMasked: z.string(),
              duplicateFlag: z.string(),
              lockVersion: z.number(),
            }),
          },
        },
      },
    },
  });

  // API-LEAD-002: GET /v1/leads
  registry.registerPath({
    method: 'get',
    path: '/v1/leads',
    operationId: 'API-LEAD-002',
    summary: 'List and filter leads (API-LEAD-002)',
    tags: ['MOD-LEAD Leads'],
    request: {
      query: z.object({
        limit: z.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
        'filter[state]': z.string().optional(),
        state: z.string().optional(),
        'filter[ownerUserId]': z.string().optional(),
        ownerUserId: z.string().optional(),
        'filter[branchId]': z.string().optional(),
        branchId: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: 'Paginated list of leads',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(z.record(z.unknown())),
              meta: ListMeta,
            }),
          },
        },
      },
    },
  });

  // API-LEAD-003: GET /v1/leads/{id}
  registry.registerPath({
    method: 'get',
    path: '/v1/leads/{id}',
    operationId: 'API-LEAD-003',
    summary: 'Lead detail (API-LEAD-003)',
    tags: ['MOD-LEAD Leads'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Lead details',
        headers: {
          ETag: { schema: { type: 'string' } },
        },
        content: {
          'application/json': {
            schema: z.record(z.unknown()),
          },
        },
      },
      404: {
        description: 'Lead not found or outside authorized scope',
      },
    },
  });

  // API-LEAD-004: PATCH /v1/leads/{id}
  registry.registerPath({
    method: 'patch',
    path: '/v1/leads/{id}',
    operationId: 'API-LEAD-004',
    summary: 'Update lead mutable fields (API-LEAD-004)',
    tags: ['MOD-LEAD Leads'],
    request: {
      params: z.object({ id: z.string() }),
      headers: z.object({ 'If-Match': z.string() }),
      body: {
        content: { 'application/json': { schema: UpdateLeadInputSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Updated lead details',
        headers: {
          ETag: { schema: { type: 'string' } },
        },
        content: {
          'application/json': { schema: z.record(z.unknown()) },
        },
      },
      409: {
        description: 'VERSION_CONFLICT',
      },
    },
  });

  // API-LEAD-005: POST /v1/leads/{id}/transitions
  registry.registerPath({
    method: 'post',
    path: '/v1/leads/{id}/transitions',
    operationId: 'API-LEAD-005',
    summary: 'Lead state transition (API-LEAD-005)',
    tags: ['MOD-LEAD Leads'],
    request: {
      params: z.object({ id: z.string() }),
      headers: z.object({
        'If-Match': z.string(),
        'Idempotency-Key': z.string(),
      }),
      body: {
        content: { 'application/json': { schema: LeadTransitionInputSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Lead state updated',
        content: {
          'application/json': { schema: z.record(z.unknown()) },
        },
      },
      409: {
        description: 'INVALID_TRANSITION or VERSION_CONFLICT',
      },
    },
  });

  // API-LEAD-006: POST /v1/leads/{id}/assignments
  registry.registerPath({
    method: 'post',
    path: '/v1/leads/{id}/assignments',
    operationId: 'API-LEAD-006',
    summary: 'Assign or reassign lead (API-LEAD-006)',
    tags: ['MOD-LEAD Leads'],
    request: {
      params: z.object({ id: z.string() }),
      headers: z.object({
        'If-Match': z.string(),
        'Idempotency-Key': z.string(),
      }),
      body: {
        content: { 'application/json': { schema: AssignLeadInputObjectSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Lead assigned',
        content: {
          'application/json': { schema: z.record(z.unknown()) },
        },
      },
      422: {
        description: 'INVALID_ASSIGNEE',
      },
    },
  });

  // API-LEAD-007: POST /v1/leads/{id}/conversion
  registry.registerPath({
    method: 'post',
    path: '/v1/leads/{id}/conversion',
    operationId: 'API-LEAD-007',
    summary: 'Convert lead atomically to customer and application (API-LEAD-007)',
    tags: ['MOD-LEAD Leads'],
    request: {
      params: z.object({ id: z.string() }),
      headers: z.object({
        'If-Match': z.string(),
        'Idempotency-Key': z.string(),
      }),
      body: {
        content: { 'application/json': { schema: ConvertLeadInputSchema } },
        required: false,
      },
    },
    responses: {
      200: {
        description: 'Atomic conversion succeeded',
        content: {
          'application/json': {
            schema: z.object({
              leadId: z.string(),
              customerId: z.string(),
              applicationId: z.string(),
              status: z.literal('CONVERTED'),
            }),
          },
        },
      },
      409: {
        description: 'INVALID_STATE or VERSION_CONFLICT',
      },
    },
  });
}
