// OpenAPI registration for crm/grievances (owner: Dev 3). Swagger group: MOD-GRV Grievances.
import { listResponse } from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { type ZodTypeAny } from 'zod';
import {
  Complaint,
  ComplaintCreate,
  ComplaintListQuery,
  ComplaintPatch,
  ComplaintResolution,
} from './schemas';

export const tags = [
  {
    name: 'MOD-GRV Grievances',
    description:
      'Customer complaints about a lead or an application: intake, queue, assignment and referral, resolution and reopening (MOD-GRV, SUB-GRV.01, .02, ENT-034). Writes need complaint.create or complaint.manage. Resolved complaints are read-only until reopened.',
  },
];

const json = (schema: ZodTypeAny) => ({ 'application/json': { schema } });

export function registerOpenApi(registry: OpenAPIRegistry): void {
  const tag = ['MOD-GRV Grievances'];
  const writeHeaders = (idem: boolean, ifMatch: boolean) => [
    ...(idem ? [{ $ref: '#/components/parameters/IdempotencyKey' }] : []),
    ...(ifMatch ? [{ $ref: '#/components/parameters/IfMatch' }] : []),
  ];

  registry.registerPath({
    method: 'post',
    path: '/v1/complaints',
    tags: tag,
    operationId: 'API-GRV-001',
    summary:
      'Record a complaint against a lead or application and issue an acknowledgement reference (complaint.create)',
    parameters: writeHeaders(true, false),
    request: { body: { required: true, content: json(ComplaintCreate) } },
    responses: {
      201: {
        description: 'Recorded; ackRef is the reference to quote to the customer',
        content: json(Complaint),
      },
      401: { description: 'UNAUTHENTICATED' },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND (complainant not in this tenant)' },
      422: { description: 'VALIDATION_ERROR (for example, SUBJECT_UNSUPPORTED for a lead complaint)' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/complaints',
    tags: tag,
    operationId: 'API-GRV-002',
    summary: 'Complaint queue, filtered by status, category or owner (complaint.manage)',
    request: { query: ComplaintListQuery as never },
    responses: {
      200: { description: 'Page of complaints', content: json(listResponse(Complaint)) },
      403: { description: 'FORBIDDEN' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/complaints/{id}',
    tags: tag,
    operationId: 'API-GRV-002-GET',
    summary: 'One complaint (complaint.manage)',
    responses: {
      200: { description: 'Complaint', content: json(Complaint) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND' },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/v1/complaints/{id}',
    tags: tag,
    operationId: 'API-GRV-003',
    summary:
      'Assign an owner, change category or due date, refer to a lender, or start work (complaint.manage)',
    parameters: writeHeaders(false, true),
    request: { body: { required: true, content: json(ComplaintPatch) } },
    responses: {
      200: { description: 'Updated', content: json(Complaint) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND' },
      409: { description: 'VERSION_CONFLICT, INVALID_STATE (resolved) or INVALID_TRANSITION' },
      422: { description: 'VALIDATION_ERROR' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/complaints/{id}/resolution',
    tags: tag,
    operationId: 'API-GRV-004',
    summary: 'Resolve a complaint with a written resolution, or reopen a resolved one (complaint.manage)',
    parameters: writeHeaders(true, true),
    request: { body: { required: true, content: json(ComplaintResolution) } },
    responses: {
      200: { description: 'Resolved or reopened', content: json(Complaint) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND' },
      409: { description: 'VERSION_CONFLICT or INVALID_TRANSITION' },
      422: { description: 'VALIDATION_ERROR' },
    },
  });
}
