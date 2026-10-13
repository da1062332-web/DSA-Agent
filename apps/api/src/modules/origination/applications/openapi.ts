// OpenAPI registration for origination/applications (owner: Dev 3). Swagger group: MOD-APP Loan Applications.
import { listResponse } from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { type ZodTypeAny } from 'zod';
import { Application, ApplicationHold, ApplicationListQuery, ApplicationPatch } from './schemas';

export const tags = [
  {
    name: 'MOD-APP Loan Applications',
    description:
      'Internal loan file: list, read, edit and hold (MOD-APP, SUB-APP.01, .03). Reads need application.read; edits and holds need application.update and an If-Match version. Scope: RM sees own, branch roles see their branch, org owner sees the tenant. Transitions, parties, ownership, completeness and waivers are not in this slice.',
  },
];

const json = (schema: ZodTypeAny) => ({ 'application/json': { schema } });

export function registerOpenApi(registry: OpenAPIRegistry): void {
  const tag = ['MOD-APP Loan Applications'];
  const ifMatch = [{ $ref: '#/components/parameters/IfMatch' }];

  registry.registerPath({
    method: 'get',
    path: '/v1/applications',
    tags: tag,
    operationId: 'API-APP-002',
    summary: 'List applications in the caller scope (application.read)',
    request: { query: ApplicationListQuery as never },
    responses: {
      200: { description: 'Page of applications', content: json(listResponse(Application)) },
      401: { description: 'UNAUTHENTICATED' },
      403: { description: 'FORBIDDEN' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/applications/{id}',
    tags: tag,
    operationId: 'API-APP-003',
    summary: 'One application in the caller scope (application.read)',
    responses: {
      200: { description: 'Application', content: json(Application) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND (also when outside the caller scope)' },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/v1/applications/{id}',
    tags: tag,
    operationId: 'API-APP-004',
    summary:
      'Edit the applicant request while the application is DRAFT or DOCUMENTS_PENDING (application.update)',
    parameters: ifMatch,
    request: { body: { required: true, content: json(ApplicationPatch) } },
    responses: {
      200: { description: 'Updated', content: json(Application) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND' },
      409: { description: 'VERSION_CONFLICT or INVALID_STATE (application no longer editable)' },
      422: { description: 'VALIDATION_ERROR' },
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/v1/applications/{id}/hold',
    tags: tag,
    operationId: 'API-APP-010',
    summary: 'Put an application on hold with a reason, or clear the hold (application.update)',
    parameters: ifMatch,
    request: { body: { required: true, content: json(ApplicationHold) } },
    responses: {
      200: { description: 'Hold set or cleared', content: json(Application) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND' },
      409: { description: 'VERSION_CONFLICT or INVALID_STATE (terminal application, or no hold to clear)' },
      422: { description: 'VALIDATION_ERROR (a reason is required to hold)' },
    },
  });
}
