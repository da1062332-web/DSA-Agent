// OpenAPI paths for crm/leads (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { registerOperation } from '../../../http/openapi-op';

const tag = 'MOD-LEAD Leads';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'post',
    path: '/v1/leads/:id/conversions',
    operationId: 'LEAD-POST-LEADS-BY-ID-CONVERSIONS',
    summary: 'POST /v1/leads/:id/conversions',
    tag,
    idempotent: true,
    ifMatch: true,
  });
}
