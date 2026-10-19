// OpenAPI paths for integrations (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { ConfigureIntegrationRequestSchema, ListIntegrationsQuerySchema } from '@dsa/contracts';
import { registerOperation } from '../../http/openapi-op';

const tag = 'MOD-INT Integrations';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'get',
    path: '/v1/integrations/capabilities',
    operationId: 'INT-GET-INTEGRATIONS-CAPABILITIES',
    summary: 'GET /v1/integrations/capabilities',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/integrations',
    operationId: 'API-INT-001',
    summary: 'GET /v1/integrations',
    tag,
    query: ListIntegrationsQuerySchema,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/integrations/:provider',
    operationId: 'INT-GET-INTEGRATIONS-BY-ID',
    summary: 'GET /v1/integrations/:provider',
    tag,
  });
  registerOperation(registry, {
    method: 'put',
    path: '/v1/integrations/:provider',
    operationId: 'API-INT-002',
    summary: 'PUT /v1/integrations/:provider',
    tag,
    body: ConfigureIntegrationRequestSchema,
    ifMatch: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/integrations/:provider/ping',
    operationId: 'INT-POST-INTEGRATIONS-BY-ID-PING',
    summary: 'POST /v1/integrations/:provider/ping',
    tag,
  });
}
