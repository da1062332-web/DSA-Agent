// OpenAPI paths for ledger (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { registerOperation } from '../../http/openapi-op';

const tag = 'MOD-LED Ledger';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'get',
    path: '/v1/ledger/trial-balance',
    operationId: 'API-LED-007',
    summary: 'GET /v1/ledger/trial-balance',
    tag,
  });
}
