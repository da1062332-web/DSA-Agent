// OpenAPI paths for origination/sanctions (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { registerOperation } from '../../../http/openapi-op';

const tag = 'MOD-SND Sanctions and Disbursements';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'get',
    path: '/v1/lender-cases/:id/sanctions',
    operationId: 'SND-GET-LENDER-CASES-BY-ID-SANCTIONS',
    summary: 'GET /v1/lender-cases/:id/sanctions',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/sanctions',
    operationId: 'SND-GET-SANCTIONS',
    summary: 'GET /v1/sanctions',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/disbursements',
    operationId: 'SND-GET-DISBURSEMENTS',
    summary: 'GET /v1/disbursements',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/sanctions/:id',
    operationId: 'SND-GET-SANCTIONS-BY-ID',
    summary: 'GET /v1/sanctions/:id',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/sanctions/:id/tranches',
    operationId: 'SND-GET-SANCTIONS-BY-ID-TRANCHES',
    summary: 'GET /v1/sanctions/:id/tranches',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/tranches/:id',
    operationId: 'SND-GET-TRANCHES-BY-ID',
    summary: 'GET /v1/tranches/:id',
    tag,
  });
}
