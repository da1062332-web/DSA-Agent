// OpenAPI registration for origination/applications (owner: Dev 3). Swagger group: MOD-APP Loan Applications.
import { listResponse } from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { type ZodTypeAny } from 'zod';
import { ChecklistResponseSchema } from './checklist-schemas';
import { EligibilityAssessment, EligibilityListQuery, OverrideRequest } from './eligibility-schemas';
import {
  Application,
  ApplicationHold,
  ApplicationListQuery,
  ApplicationPatch,
  ApplicationTransition,
} from './schemas';

export const tags = [
  {
    name: 'MOD-APP Loan Applications',
    description:
      'Internal loan file: list, read, edit and hold (MOD-APP, SUB-APP.01, .03). Reads need application.read; edits and holds need application.update and an If-Match version. Scope: RM sees own, branch roles see their branch, org owner sees the tenant. Transitions, parties, ownership, completeness and waivers are not in this slice.',
  },
  {
    name: 'MOD-ELG Eligibility',
    description:
      'Preliminary eligibility assessment of an application (MOD-ELG). Run and history need application.read; an override needs eligibility.override and a reason. Until an eligibility rule set is published every criterion is UNKNOWN. It never promises approval.',
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

  registry.registerPath({
    method: 'post',
    path: '/v1/applications/{id}/transitions',
    tags: tag,
    operationId: 'API-APP-005',
    summary:
      'Move an application: T-APP-01 select product and start documents, T-APP-02 send to review, T-APP-10 cancel with a reason',
    parameters: [
      { $ref: '#/components/parameters/IdempotencyKey' },
      { $ref: '#/components/parameters/IfMatch' },
    ],
    request: { body: { required: true, content: json(ApplicationTransition) } },
    responses: {
      200: { description: 'Transitioned', content: json(Application) },
      403: { description: 'FORBIDDEN (the permission for this transition is missing)' },
      404: { description: 'NOT_FOUND (also when outside the caller scope)' },
      409: {
        description: 'VERSION_CONFLICT or INVALID_TRANSITION or INVALID_STATE (product version not in force)',
      },
      422: {
        description: 'VALIDATION_ERROR (unknown product version, wrong category, or missing cancel reason)',
      },
    },
  });

  const elg = ['MOD-ELG Eligibility'];
  registry.registerPath({
    method: 'post',
    path: '/v1/applications/{id}/eligibility-assessments',
    tags: elg,
    operationId: 'API-ELG-001',
    summary: 'Run an eligibility assessment for the application (application.read)',
    parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
    responses: {
      201: { description: 'Assessment recorded', content: json(EligibilityAssessment) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND (also when outside the caller scope)' },
      409: { description: 'INVALID_STATE (no product chosen yet)' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/applications/{id}/eligibility-assessments',
    tags: elg,
    operationId: 'API-ELG-002',
    summary: 'Assessment history for the application, oldest first (application.read)',
    request: { query: EligibilityListQuery as never },
    responses: {
      200: { description: 'Page of assessments', content: json(listResponse(EligibilityAssessment)) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND (also when outside the caller scope)' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/eligibility-assessments/{id}/overrides',
    tags: elg,
    operationId: 'API-ELG-003',
    summary: 'Override a failed result with a reason (eligibility.override)',
    parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
    request: { body: { required: true, content: json(OverrideRequest) } },
    responses: {
      201: { description: 'Override recorded', content: json(EligibilityAssessment) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND (also when outside the caller scope)' },
      409: { description: 'INVALID_STATE (only a FAIL result can be overridden)' },
      422: { description: 'VALIDATION_ERROR (unknown product version, or reason too short)' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/applications/{id}/checklist',
    tags: tag,
    operationId: 'API-APP-007',
    summary: 'Document checklist of the application with a completeness summary (application.read)',
    responses: {
      200: { description: 'Checklist items and summary', content: json(ChecklistResponseSchema) },
      401: { description: 'UNAUTHENTICATED' },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND (also when outside the caller scope)' },
    },
  });
}
