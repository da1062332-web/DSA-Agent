// OpenAPI paths for automation (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import {
  CreateAutomationDefinitionSchema,
  CreateAutomationVersionSchema,
  ExecuteAutomationSchema,
  ReviewVersionActionSchema,
  SkipStepSchema,
} from '@dsa/contracts';
import { registerOperation } from '../../http/openapi-op';

const tag = 'MOD-WFA Workflow Automation';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'get',
    path: '/v1/automations',
    operationId: 'WFA-GET-AUTOMATIONS',
    summary: 'GET /v1/automations',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/automations',
    operationId: 'WFA-POST-AUTOMATIONS',
    summary: 'POST /v1/automations',
    tag,
    body: CreateAutomationDefinitionSchema,
    status: 201,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/automations/executions',
    operationId: 'WFA-GET-AUTOMATIONS-EXECUTIONS',
    summary: 'GET /v1/automations/executions',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/automations/executions/:executionId',
    operationId: 'WFA-GET-AUTOMATIONS-EXECUTIONS-BY-ID',
    summary: 'GET /v1/automations/executions/:executionId',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/automations/executions/:executionId/steps',
    operationId: 'WFA-GET-AUTOMATIONS-EXECUTIONS-BY-ID-STEPS',
    summary: 'GET /v1/automations/executions/:executionId/steps',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/automations/executions/:executionId/cancel',
    operationId: 'WFA-POST-AUTOMATIONS-EXECUTIONS-BY-ID-CANCEL',
    summary: 'POST /v1/automations/executions/:executionId/cancel',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/automations/executions/:executionId/resume',
    operationId: 'WFA-POST-AUTOMATIONS-EXECUTIONS-BY-ID-RESUME',
    summary: 'POST /v1/automations/executions/:executionId/resume',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/automations/executions/:executionId/steps/:stepIndex/skip',
    operationId: 'WFA-POST-AUTOMATIONS-EXECUTIONS-BY-ID-STEPS-BY-ID-SKIP',
    summary: 'POST /v1/automations/executions/:executionId/steps/:stepIndex/skip',
    tag,
    body: SkipStepSchema,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/automations/dead-letters',
    operationId: 'WFA-GET-AUTOMATIONS-DEAD-LETTERS',
    summary: 'GET /v1/automations/dead-letters',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/automations/dead-letters/:id',
    operationId: 'WFA-GET-AUTOMATIONS-DEAD-LETTERS-BY-ID',
    summary: 'GET /v1/automations/dead-letters/:id',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/automations/dead-letters/:id/resolve',
    operationId: 'WFA-POST-AUTOMATIONS-DEAD-LETTERS-BY-ID-RESOLVE',
    summary: 'POST /v1/automations/dead-letters/:id/resolve',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/automations/:id',
    operationId: 'WFA-GET-AUTOMATIONS-BY-ID',
    summary: 'GET /v1/automations/:id',
    tag,
  });
  registerOperation(registry, {
    method: 'patch',
    path: '/v1/automations/:id',
    operationId: 'WFA-PATCH-AUTOMATIONS-BY-ID',
    summary: 'PATCH /v1/automations/:id',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/automations/:id/versions',
    operationId: 'WFA-GET-AUTOMATIONS-BY-ID-VERSIONS',
    summary: 'GET /v1/automations/:id/versions',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/automations/:id/versions',
    operationId: 'WFA-POST-AUTOMATIONS-BY-ID-VERSIONS',
    summary: 'POST /v1/automations/:id/versions',
    tag,
    body: CreateAutomationVersionSchema,
    status: 201,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/automations/:id/versions/:versionId',
    operationId: 'WFA-GET-AUTOMATIONS-BY-ID-VERSIONS-BY-ID',
    summary: 'GET /v1/automations/:id/versions/:versionId',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/automations/:id/versions/:versionId/review',
    operationId: 'WFA-POST-AUTOMATIONS-BY-ID-VERSIONS-BY-ID-REVIEW',
    summary: 'POST /v1/automations/:id/versions/:versionId/review',
    tag,
    body: ReviewVersionActionSchema,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/automations/:id/execute',
    operationId: 'WFA-POST-AUTOMATIONS-BY-ID-EXECUTE',
    summary: 'POST /v1/automations/:id/execute',
    tag,
    body: ExecuteAutomationSchema,
    idempotent: true,
  });
}
