// OpenAPI paths for platform/imports (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import {
  CommitImportSchema,
  ConfigureMappingSchema,
  CreateImportSchema,
  RollbackImportSchema,
} from '@dsa/contracts';
import { registerOperation } from '../../../http/openapi-op';

const tag = 'MOD-IMP Import and Export';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'post',
    path: '/v1/imports',
    operationId: 'IMP-POST-IMPORTS',
    summary: 'POST /v1/imports',
    tag,
    body: CreateImportSchema,
    status: 201,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/imports/:id/mapping',
    operationId: 'IMP-POST-IMPORTS-BY-ID-MAPPING',
    summary: 'POST /v1/imports/:id/mapping',
    tag,
    body: ConfigureMappingSchema,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/imports/:id/commit',
    operationId: 'IMP-POST-IMPORTS-BY-ID-COMMIT',
    summary: 'POST /v1/imports/:id/commit',
    tag,
    body: CommitImportSchema,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/imports/:id/rollback',
    operationId: 'IMP-POST-IMPORTS-BY-ID-ROLLBACK',
    summary: 'POST /v1/imports/:id/rollback',
    tag,
    body: RollbackImportSchema,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/imports/:id',
    operationId: 'IMP-GET-IMPORTS-BY-ID',
    summary: 'GET /v1/imports/:id',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/imports/:id/report',
    operationId: 'IMP-GET-IMPORTS-BY-ID-REPORT',
    summary: 'GET /v1/imports/:id/report',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/imports',
    operationId: 'IMP-GET-IMPORTS',
    summary: 'GET /v1/imports',
    tag,
  });
}
