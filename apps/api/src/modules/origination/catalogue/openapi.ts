// apps/api/src/modules/origination/catalogue/openapi.ts — owner: Developer 5 (Bhushan)
import {
  CreateEmpanelmentInputSchema,
  CreateLenderInputSchema,
  CreateProductInputSchema,
  CreateProductVersionInputSchema,
  EmpanelmentResponseSchema,
  LenderContactResponseSchema,
  LenderResponseSchema,
  ProductResponseSchema,
  ProductVersionResponseSchema,
  SetLenderContactsInputSchema,
  UpdateEmpanelmentInputSchema,
  UpdateLenderInputSchema,
  UpdateProductStatusInputSchema,
} from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { z } from 'zod';

export const tags = [
  { name: 'MOD-LND Lenders', description: 'Lender directory, empanelment and contact management (MOD-LND).' },
  { name: 'MOD-PRD Products', description: 'Loan product catalogue and immutable versioning (MOD-PRD).' },
];

export function registerOpenApi(registry: OpenAPIRegistry): void {
  registry.register('CreateLenderInput', CreateLenderInputSchema);
  registry.register('UpdateLenderInput', UpdateLenderInputSchema);
  registry.register('LenderResponse', LenderResponseSchema);
  registry.register('CreateEmpanelmentInput', CreateEmpanelmentInputSchema);
  registry.register('EmpanelmentResponse', EmpanelmentResponseSchema);
  registry.register('CreateProductInput', CreateProductInputSchema);
  registry.register('ProductResponse', ProductResponseSchema);
  registry.register('CreateProductVersionInput', CreateProductVersionInputSchema);
  registry.register('ProductVersionResponse', ProductVersionResponseSchema);

  // API-LND-001: POST /v1/lenders
  registry.registerPath({
    method: 'post',
    path: '/v1/lenders',
    operationId: 'API-LND-001',
    summary: 'Create lender (API-LND-001)',
    tags: ['MOD-LND Lenders'],
    request: {
      headers: z.object({ 'Idempotency-Key': z.string() }),
      body: { content: { 'application/json': { schema: CreateLenderInputSchema } }, required: true },
    },
    responses: {
      201: {
        description: 'Lender created',
        content: { 'application/json': { schema: LenderResponseSchema } },
      },
    },
  });

  // API-LND-002: GET /v1/lenders
  registry.registerPath({
    method: 'get',
    path: '/v1/lenders',
    operationId: 'API-LND-002',
    summary: 'List lenders (API-LND-002)',
    tags: ['MOD-LND Lenders'],
    responses: {
      200: {
        description: 'List of lenders',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(LenderResponseSchema),
              meta: z.object({ nextCursor: z.string().nullable(), limit: z.number() }),
            }),
          },
        },
      },
    },
  });

  // API-LND-003: PATCH /v1/lenders/{id}
  registry.registerPath({
    method: 'patch',
    path: '/v1/lenders/{id}',
    operationId: 'API-LND-003',
    summary: 'Update lender (API-LND-003)',
    tags: ['MOD-LND Lenders'],
    request: {
      headers: z.object({ 'If-Match': z.string() }),
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: UpdateLenderInputSchema } }, required: true },
    },
    responses: {
      200: {
        description: 'Lender updated',
        content: { 'application/json': { schema: LenderResponseSchema } },
      },
    },
  });

  // GET /v1/lenders/{id}
  registry.registerPath({
    method: 'get',
    path: '/v1/lenders/{id}',
    operationId: 'API-LND-007',
    summary: 'Get lender by ID',
    tags: ['MOD-LND Lenders'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Lender details',
        content: { 'application/json': { schema: LenderResponseSchema } },
      },
    },
  });

  // API-LND-004: POST /v1/lenders/{id}/empanelments
  registry.registerPath({
    method: 'post',
    path: '/v1/lenders/{id}/empanelments',
    operationId: 'API-LND-004',
    summary: 'Add empanelment (API-LND-004)',
    tags: ['MOD-LND Lenders'],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: CreateEmpanelmentInputSchema } }, required: true },
    },
    responses: {
      201: {
        description: 'Empanelment added',
        content: { 'application/json': { schema: EmpanelmentResponseSchema } },
      },
    },
  });

  // GET /v1/empanelments/{id}
  registry.registerPath({
    method: 'get',
    path: '/v1/empanelments/{id}',
    operationId: 'API-LND-008',
    summary: 'Get empanelment by ID',
    tags: ['MOD-LND Lenders'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Empanelment details',
        content: { 'application/json': { schema: EmpanelmentResponseSchema } },
      },
    },
  });

  // API-LND-005: PATCH /v1/empanelments/{id}
  registry.registerPath({
    method: 'patch',
    path: '/v1/empanelments/{id}',
    operationId: 'API-LND-005',
    summary: 'Update empanelment (API-LND-005)',
    tags: ['MOD-LND Lenders'],
    request: {
      headers: z.object({ 'If-Match': z.string() }),
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: UpdateEmpanelmentInputSchema } }, required: true },
    },
    responses: {
      200: {
        description: 'Empanelment updated',
        content: { 'application/json': { schema: EmpanelmentResponseSchema } },
      },
    },
  });

  // API-LND-006: PUT /v1/lenders/{id}/contacts
  registry.registerPath({
    method: 'put',
    path: '/v1/lenders/{id}/contacts',
    operationId: 'API-LND-006',
    summary: 'Set lender contacts (API-LND-006)',
    tags: ['MOD-LND Lenders'],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: SetLenderContactsInputSchema } }, required: true },
    },
    responses: {
      200: {
        description: 'Contacts set',
        content: { 'application/json': { schema: z.object({ data: z.array(LenderContactResponseSchema) }) } },
      },
    },
  });

  // API-PRD-001: POST /v1/products
  registry.registerPath({
    method: 'post',
    path: '/v1/products',
    operationId: 'API-PRD-001',
    summary: 'Create loan product (API-PRD-001)',
    tags: ['MOD-PRD Products'],
    request: {
      body: { content: { 'application/json': { schema: CreateProductInputSchema } }, required: true },
    },
    responses: {
      201: {
        description: 'Product created',
        content: { 'application/json': { schema: ProductResponseSchema } },
      },
    },
  });

  // API-PRD-002: GET /v1/products
  registry.registerPath({
    method: 'get',
    path: '/v1/products',
    operationId: 'API-PRD-002',
    summary: 'List products catalogue (API-PRD-002)',
    tags: ['MOD-PRD Products'],
    responses: {
      200: {
        description: 'Product catalogue',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(ProductResponseSchema),
              meta: z.object({ nextCursor: z.string().nullable(), limit: z.number() }),
            }),
          },
        },
      },
    },
  });

  // API-PRD-003: POST /v1/products/{id}/versions
  registry.registerPath({
    method: 'post',
    path: '/v1/products/{id}/versions',
    operationId: 'API-PRD-003',
    summary: 'Create new immutable product version (API-PRD-003)',
    tags: ['MOD-PRD Products'],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: CreateProductVersionInputSchema } }, required: true },
    },
    responses: {
      201: {
        description: 'Product version created',
        content: { 'application/json': { schema: ProductVersionResponseSchema } },
      },
    },
  });

  // API-PRD-004: GET /v1/product-versions/{id}
  registry.registerPath({
    method: 'get',
    path: '/v1/product-versions/{id}',
    operationId: 'API-PRD-004',
    summary: 'Get product version detail (API-PRD-004)',
    tags: ['MOD-PRD Products'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Product version detail',
        content: { 'application/json': { schema: ProductVersionResponseSchema } },
      },
    },
  });

  // API-PRD-005: POST /v1/products/{id}/status
  registry.registerPath({
    method: 'post',
    path: '/v1/products/{id}/status',
    operationId: 'API-PRD-005',
    summary: 'Update product status (API-PRD-005)',
    tags: ['MOD-PRD Products'],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: UpdateProductStatusInputSchema } }, required: true },
    },
    responses: {
      200: {
        description: 'Product status updated',
        content: { 'application/json': { schema: ProductResponseSchema } },
      },
    },
  });
}
