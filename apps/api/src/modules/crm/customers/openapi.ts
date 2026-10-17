// apps/api/src/modules/crm/customers/openapi.ts — owner: Dev 5 (MOD-CUST)
import { ListMeta } from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { z } from 'zod';
import {
  CreateConsentSchema,
  CreateCustomerSchema,
  UpdateCustomerSchema,
  WithdrawConsentSchema,
} from './types';

export const tags = [
  {
    name: 'MOD-CUST Customers',
    description: 'Customer profiles, consent tracking, and party deduplication (MOD-CUST).',
  },
];

export function registerOpenApi(registry: OpenAPIRegistry): void {
  registry.register('CreateCustomerInput', CreateCustomerSchema);
  registry.register('UpdateCustomerInput', UpdateCustomerSchema);
  registry.register('CreateConsentInput', CreateConsentSchema);
  registry.register('WithdrawConsentInput', WithdrawConsentSchema);

  // API-CUST-001: POST /v1/customers
  registry.registerPath({
    method: 'post',
    path: '/v1/customers',
    operationId: 'API-CUST-001',
    summary: 'Create a new customer party profile (API-CUST-001)',
    tags: ['MOD-CUST Customers'],
    request: {
      headers: z.object({
        'Idempotency-Key': z.string(),
      }),
      body: {
        content: { 'application/json': { schema: CreateCustomerSchema } },
        required: true,
      },
    },
    responses: {
      201: {
        description: 'Customer created successfully',
        headers: {
          ETag: {
            schema: { type: 'string' },
            description: 'Customer lock version',
          },
        },
        content: {
          'application/json': {
            schema: z.object({
              id: z.string(),
              tenantId: z.string(),
              partyType: z.enum(['INDIVIDUAL', 'ENTITY']),
              fullName: z.string(),
              homeBranchId: z.string(),
              status: z.enum(['ACTIVE', 'MERGED']),
              lockVersion: z.number(),
              primaryMobileMasked: z.string().nullable().optional(),
              primaryEmailMasked: z.string().nullable().optional(),
            }),
          },
        },
      },
    },
  });

  // API-CUST-010: GET /v1/customers
  registry.registerPath({
    method: 'get',
    path: '/v1/customers',
    operationId: 'API-CUST-010',
    summary: 'List customers in scope (API-CUST-010)',
    tags: ['MOD-CUST Customers'],
    request: {
      query: z.object({
        cursor: z.string().optional(),
        limit: z.coerce.number().optional(),
        partyType: z.enum(['INDIVIDUAL', 'ENTITY']).optional(),
        homeBranchId: z.string().optional(),
        status: z.enum(['ACTIVE', 'MERGED']).optional(),
      }),
    },
    responses: {
      200: {
        description: 'Paginated customer list',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(
                z.object({
                  id: z.string(),
                  tenantId: z.string(),
                  partyType: z.enum(['INDIVIDUAL', 'ENTITY']),
                  fullName: z.string(),
                  homeBranchId: z.string(),
                  status: z.enum(['ACTIVE', 'MERGED']),
                  lockVersion: z.number(),
                }),
              ),
              meta: ListMeta,
            }),
          },
        },
      },
    },
  });

  // Detail: GET /v1/customers/{id}
  registry.registerPath({
    method: 'get',
    path: '/v1/customers/{id}',
    operationId: 'API-CUST-002',
    summary: 'Get customer details by ID (API-CUST-002)',
    tags: ['MOD-CUST Customers'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Customer details',
        headers: {
          ETag: {
            schema: { type: 'string' },
            description: 'Customer lock version',
          },
        },
        content: {
          'application/json': {
            schema: z.object({
              id: z.string(),
              tenantId: z.string(),
              partyType: z.enum(['INDIVIDUAL', 'ENTITY']),
              fullName: z.string(),
              homeBranchId: z.string(),
              status: z.enum(['ACTIVE', 'MERGED']),
              lockVersion: z.number(),
              primaryMobileMasked: z.string().nullable().optional(),
              primaryEmailMasked: z.string().nullable().optional(),
            }),
          },
        },
      },
    },
  });

  // API-CUST-003: PATCH /v1/customers/{id}
  registry.registerPath({
    method: 'patch',
    path: '/v1/customers/{id}',
    operationId: 'API-CUST-003',
    summary: 'Update customer profile (API-CUST-003)',
    tags: ['MOD-CUST Customers'],
    request: {
      params: z.object({ id: z.string() }),
      headers: z.object({
        'If-Match': z.string(),
      }),
      body: {
        content: { 'application/json': { schema: UpdateCustomerSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Customer profile updated successfully',
        headers: {
          ETag: {
            schema: { type: 'string' },
            description: 'Updated lock version',
          },
        },
        content: {
          'application/json': {
            schema: z.object({
              id: z.string(),
              lockVersion: z.number(),
              fullName: z.string(),
              homeBranchId: z.string(),
            }),
          },
        },
      },
    },
  });

  // GET /v1/customers/{id}/consents
  registry.registerPath({
    method: 'get',
    path: '/v1/customers/{id}/consents',
    operationId: 'API-CUST-006',
    summary: 'List customer consents (API-CUST-006)',
    tags: ['MOD-CUST Customers'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'List of customer consents',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(
                z.object({
                  id: z.string(),
                  subjectType: z.enum(['CUSTOMER', 'LEAD']),
                  subjectId: z.string(),
                  purpose: z.string(),
                  noticeVersion: z.string(),
                  channel: z.string(),
                  status: z.enum(['ACTIVE', 'WITHDRAWN', 'EXPIRED']),
                }),
              ),
            }),
          },
        },
      },
    },
  });

  // API-CUST-004: POST /v1/customers/{id}/consents
  registry.registerPath({
    method: 'post',
    path: '/v1/customers/{id}/consents',
    operationId: 'API-CUST-004',
    summary: 'Record customer consent (API-CUST-004)',
    tags: ['MOD-CUST Customers'],
    request: {
      params: z.object({ id: z.string() }),
      headers: z.object({
        'Idempotency-Key': z.string(),
      }),
      body: {
        content: { 'application/json': { schema: CreateConsentSchema } },
        required: true,
      },
    },
    responses: {
      201: {
        description: 'Consent recorded successfully',
        content: {
          'application/json': {
            schema: z.object({
              id: z.string(),
              subjectType: z.literal('CUSTOMER'),
              subjectId: z.string(),
              purpose: z.string(),
              noticeVersion: z.string(),
              channel: z.string(),
              status: z.literal('ACTIVE'),
            }),
          },
        },
      },
    },
  });

  // API-CUST-005: POST /v1/consents/{id}/withdrawal
  registry.registerPath({
    method: 'post',
    path: '/v1/consents/{id}/withdrawal',
    operationId: 'API-CUST-005',
    summary: 'Withdraw an active consent (API-CUST-005)',
    tags: ['MOD-CUST Customers'],
    request: {
      params: z.object({ id: z.string() }),
      headers: z.object({
        'Idempotency-Key': z.string(),
      }),
      body: {
        content: { 'application/json': { schema: WithdrawConsentSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Consent withdrawn successfully',
        content: {
          'application/json': {
            schema: z.object({
              id: z.string(),
              status: z.literal('WITHDRAWN'),
              withdrawnAt: z.string().nullable(),
            }),
          },
        },
      },
    },
  });
}
