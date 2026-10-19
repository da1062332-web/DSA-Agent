// OpenAPI paths for platform (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { UpdateTenantConfigRequest } from '@dsa/contracts';
import { registerOperation } from '../../http/openapi-op';

const tag = 'MOD-CFG Configuration';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'get',
    path: '/v1/config',
    operationId: 'CFG-GET-CONFIG',
    summary: 'GET /v1/config',
    tag,
  });
  registerOperation(registry, {
    method: 'patch',
    path: '/v1/config',
    operationId: 'CFG-PATCH-CONFIG',
    summary: 'PATCH /v1/config',
    tag,
    body: UpdateTenantConfigRequest,
    ifMatch: true,
  });
}
