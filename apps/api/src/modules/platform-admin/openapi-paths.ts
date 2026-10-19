// OpenAPI paths for platform-admin (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import {
  ApproveDataCorrectionRequestSchema,
  ApproveSupportAccessRequestSchema,
  CreateDataCorrectionRequestSchema,
  CreateSupportAccessRequestSchema,
  ListPlatformTenantsQuerySchema,
  MasterDataImportRequestSchema,
  PauseQueueRequestSchema,
  ResumeQueueRequestSchema,
  RevokeSupportAccessRequestSchema,
  UpdateFeatureFlagRequestSchema,
  UpdateReleaseRequestSchema,
} from '@dsa/contracts';
import { registerOperation } from '../../http/openapi-op';

const tag = 'MOD-ADM Administration';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'get',
    path: '/platform/v1/tenants',
    operationId: 'API-TEN-002',
    summary: 'GET /platform/v1/tenants',
    tag,
    query: ListPlatformTenantsQuerySchema,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/platform/v1/flags',
    operationId: 'API-ADM-002',
    summary: 'GET /platform/v1/flags',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/platform/v1/flags/:key',
    operationId: 'ADM-GET-FLAGS-BY-ID',
    summary: 'GET /platform/v1/flags/:key',
    tag,
  });
  registerOperation(registry, {
    method: 'put',
    path: '/platform/v1/flags/:key',
    operationId: 'ADM-PUT-FLAGS-BY-ID',
    summary: 'PUT /platform/v1/flags/:key',
    tag,
    body: UpdateFeatureFlagRequestSchema,
    ifMatch: true,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/platform/v1/master-data',
    operationId: 'API-ADM-003',
    summary: 'GET /platform/v1/master-data',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/platform/v1/master-data/imports',
    operationId: 'ADM-POST-MASTER-DATA-IMPORTS',
    summary: 'POST /platform/v1/master-data/imports',
    tag,
    body: MasterDataImportRequestSchema,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/platform/v1/jobs',
    operationId: 'API-ADM-005',
    summary: 'GET /platform/v1/jobs',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/platform/v1/queues/:queue/pause',
    operationId: 'ADM-POST-QUEUES-BY-ID-PAUSE',
    summary: 'POST /platform/v1/queues/:queue/pause',
    tag,
    body: PauseQueueRequestSchema,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/platform/v1/queues/:queue/resume',
    operationId: 'ADM-POST-QUEUES-BY-ID-RESUME',
    summary: 'POST /platform/v1/queues/:queue/resume',
    tag,
    body: ResumeQueueRequestSchema,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/platform/v1/dead-letters/:id/replay',
    operationId: 'ADM-POST-DEAD-LETTERS-BY-ID-REPLAY',
    summary: 'POST /platform/v1/dead-letters/:id/replay',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/platform/v1/dead-letters/:id/discard',
    operationId: 'ADM-POST-DEAD-LETTERS-BY-ID-DISCARD',
    summary: 'POST /platform/v1/dead-letters/:id/discard',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/platform/v1/health',
    operationId: 'ADM-GET-HEALTH',
    summary: 'GET /platform/v1/health',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/platform/v1/support-access-requests',
    operationId: 'ADM-GET-SUPPORT-ACCESS-REQUESTS',
    summary: 'GET /platform/v1/support-access-requests',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/platform/v1/support-access-requests',
    operationId: 'ADM-POST-SUPPORT-ACCESS-REQUESTS',
    summary: 'POST /platform/v1/support-access-requests',
    tag,
    body: CreateSupportAccessRequestSchema,
    status: 201,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/platform/v1/releases',
    operationId: 'ADM-GET-RELEASES',
    summary: 'GET /platform/v1/releases',
    tag,
  });
  registerOperation(registry, {
    method: 'put',
    path: '/platform/v1/releases/:version',
    operationId: 'ADM-PUT-RELEASES-BY-ID',
    summary: 'PUT /platform/v1/releases/:version',
    tag,
    body: UpdateReleaseRequestSchema,
    ifMatch: true,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/support-access-requests',
    operationId: 'ADM-GET-SUPPORT-ACCESS-REQUESTS-2',
    summary: 'GET /v1/support-access-requests',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/support-access-requests/:id/approval',
    operationId: 'ADM-POST-SUPPORT-ACCESS-REQUESTS-BY-ID-APPROVAL',
    summary: 'POST /v1/support-access-requests/:id/approval',
    tag,
    body: ApproveSupportAccessRequestSchema,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/support-access-requests/:id/revocation',
    operationId: 'ADM-POST-SUPPORT-ACCESS-REQUESTS-BY-ID-REVOCATION',
    summary: 'POST /v1/support-access-requests/:id/revocation',
    tag,
    body: RevokeSupportAccessRequestSchema,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/data-corrections',
    operationId: 'API-ADM-009',
    summary: 'GET /v1/data-corrections',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/data-corrections',
    operationId: 'ADM-POST-DATA-CORRECTIONS',
    summary: 'POST /v1/data-corrections',
    tag,
    body: CreateDataCorrectionRequestSchema,
    status: 201,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/data-corrections/:id/approval',
    operationId: 'ADM-POST-DATA-CORRECTIONS-BY-ID-APPROVAL',
    summary: 'POST /v1/data-corrections/:id/approval',
    tag,
    body: ApproveDataCorrectionRequestSchema,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/data-corrections/:id/execute',
    operationId: 'ADM-POST-DATA-CORRECTIONS-BY-ID-EXECUTE',
    summary: 'POST /v1/data-corrections/:id/execute',
    tag,
  });
}
