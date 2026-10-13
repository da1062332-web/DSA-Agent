// OpenAPI registration for origination/catalogue (owner: Dev 3). Swagger group: MOD-LND Lenders.
// Products (MOD-PRD) join this file in the next slice. tools/gen-openapi.ts writes openapi/openapi.yaml.
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { listResponse } from '@dsa/contracts';
import type { ZodTypeAny } from 'zod';
import {
  Empanelment,
  EmpanelmentCreate,
  EmpanelmentPatch,
  Lender,
  LenderCreate,
  LenderPatch,
  ListQuery,
} from './schemas';

export const tags = [
  {
    name: 'MOD-LND Lenders',
    description:
      'Lender directory, status and empanelments (MOD-LND, SUB-LND.01, .02, .05). Writes need config.manage; a paused lender blocks new cases with 422 LENDER_PAUSED.',
  },
];

const json = (schema: ZodTypeAny) => ({ 'application/json': { schema } });

export function registerOpenApi(registry: OpenAPIRegistry): void {
  const tag = ['MOD-LND Lenders'];
  const writeHeaders = (idem: boolean, ifMatch: boolean) => [
    ...(idem ? [{ $ref: '#/components/parameters/IdempotencyKey' }] : []),
    ...(ifMatch ? [{ $ref: '#/components/parameters/IfMatch' }] : []),
  ];

  registry.registerPath({
    method: 'post',
    path: '/v1/lenders',
    tags: tag,
    operationId: 'API-LND-001',
    summary: 'Create a lender (config.manage)',
    parameters: writeHeaders(true, false),
    request: { body: { required: true, content: json(LenderCreate) } },
    responses: {
      201: { description: 'Created', content: json(Lender) },
      401: { description: 'UNAUTHENTICATED' },
      403: { description: 'FORBIDDEN' },
      422: { description: 'VALIDATION_ERROR' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/lenders',
    tags: tag,
    operationId: 'API-LND-002',
    summary: 'List lenders (any signed-in staff)',
    request: { query: ListQuery as never },
    responses: {
      200: { description: 'Page of lenders', content: json(listResponse(Lender)) },
      401: { description: 'UNAUTHENTICATED' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/lenders/{id}',
    tags: tag,
    operationId: 'API-LND-002-GET',
    summary: 'One lender (any signed-in staff)',
    responses: {
      200: { description: 'Lender', content: json(Lender) },
      404: { description: 'NOT_FOUND' },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/v1/lenders/{id}',
    tags: tag,
    operationId: 'API-LND-003',
    summary: 'Update a lender, including PAUSED or TERMINATED status with a reason (config.manage)',
    parameters: writeHeaders(false, true),
    request: { body: { required: true, content: json(LenderPatch) } },
    responses: {
      200: { description: 'Updated', content: json(Lender) },
      403: { description: 'FORBIDDEN' },
      409: { description: 'VERSION_CONFLICT' },
      422: { description: 'VALIDATION_ERROR' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/lenders/{id}/empanelments',
    tags: tag,
    operationId: 'API-LND-004',
    summary: 'Add an empanelment (DSA code, validity, permitted product categories) (config.manage)',
    parameters: writeHeaders(true, false),
    request: { body: { required: true, content: json(EmpanelmentCreate) } },
    responses: {
      201: { description: 'Created', content: json(Empanelment) },
      403: { description: 'FORBIDDEN' },
      409: { description: 'INVALID_STATE (duplicate DSA code for this lender)' },
      422: { description: 'VALIDATION_ERROR' },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/v1/empanelments/{id}',
    tags: tag,
    operationId: 'API-LND-005',
    summary: 'Update an empanelment: end date, categories, status (config.manage)',
    parameters: writeHeaders(false, true),
    request: { body: { required: true, content: json(EmpanelmentPatch) } },
    responses: {
      200: { description: 'Updated', content: json(Empanelment) },
      403: { description: 'FORBIDDEN' },
      409: { description: 'VERSION_CONFLICT' },
      422: { description: 'VALIDATION_ERROR' },
    },
  });
}
