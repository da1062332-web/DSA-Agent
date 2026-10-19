// OpenAPI paths for origination/verifications (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { CreateVerificationSchema, ListVerificationsQuerySchema } from '@dsa/contracts';
import { registerOperation } from '../../../http/openapi-op';

const tag = 'MOD-VER Verification';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'post',
    path: '/v1/verifications',
    operationId: 'API-VER-001',
    summary: 'POST /v1/verifications',
    tag,
    body: CreateVerificationSchema,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/verifications',
    operationId: 'API-VER-002',
    summary: 'GET /v1/verifications',
    tag,
    query: ListVerificationsQuerySchema,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/verifications/:id',
    operationId: 'VER-GET-VERIFICATIONS-BY-ID',
    summary: 'GET /v1/verifications/:id',
    tag,
  });
}
