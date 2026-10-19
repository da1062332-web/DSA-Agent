// OpenAPI paths for compliance (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { VerifyConsentInputSchema } from '@dsa/contracts';
import { registerOperation } from '../../http/openapi-op';

const tag = 'MOD-PRV Privacy and Compliance';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'get',
    path: '/v1/compliance/data-sharing-records',
    operationId: 'PRV-GET-COMPLIANCE-DATA-SHARING-RECORDS',
    summary: 'GET /v1/compliance/data-sharing-records',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/privacy/data-sharing-records',
    operationId: 'PRV-GET-PRIVACY-DATA-SHARING-RECORDS',
    summary: 'GET /v1/privacy/data-sharing-records',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/compliance/stats',
    operationId: 'PRV-GET-COMPLIANCE-STATS',
    summary: 'GET /v1/compliance/stats',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/privacy/stats',
    operationId: 'PRV-GET-PRIVACY-STATS',
    summary: 'GET /v1/privacy/stats',
    tag,
    body: VerifyConsentInputSchema,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/compliance/consent-check',
    operationId: 'PRV-POST-COMPLIANCE-CONSENT-CHECK',
    summary: 'POST /v1/compliance/consent-check',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/privacy/consent-check',
    operationId: 'PRV-POST-PRIVACY-CONSENT-CHECK',
    summary: 'POST /v1/privacy/consent-check',
    tag,
  });
}
