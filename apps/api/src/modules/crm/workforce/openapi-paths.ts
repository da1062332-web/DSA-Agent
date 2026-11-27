// OpenAPI paths for crm/workforce (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { registerOperation } from '../../../http/openapi-op';

const tag = 'MOD-WRK Workforce';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'post',
    path: '/v1/attendance/check-in',
    operationId: 'WRK-POST-ATTENDANCE-CHECK-IN',
    summary: 'POST /v1/attendance/check-in',
    tag,
    status: 201,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/attendance/check-out',
    operationId: 'WRK-POST-ATTENDANCE-CHECK-OUT',
    summary: 'POST /v1/attendance/check-out',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/attendance/me/today',
    operationId: 'WRK-GET-ATTENDANCE-ME-TODAY',
    summary: 'GET /v1/attendance/me/today',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/attendance',
    operationId: 'WRK-GET-ATTENDANCE',
    summary: 'GET /v1/attendance',
    tag,
  });
}
