// OpenAPI paths for crm/workforce (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { registerOperation } from '../../../http/openapi-op';

const tag = 'MOD-WRK Workforce';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'patch',
    path: '/v1/me/availability',
    operationId: 'WRK-PATCH-ME-AVAILABILITY',
    summary: 'PATCH /v1/me/availability',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/workforce/agents',
    operationId: 'WRK-GET-WORKFORCE-AGENTS',
    summary: 'GET /v1/workforce/agents',
    tag,
  });
  registerOperation(registry, {
    method: 'patch',
    path: '/v1/workforce/agents/:id/capacity',
    operationId: 'WRK-PATCH-WORKFORCE-AGENTS-BY-ID-CAPACITY',
    summary: 'PATCH /v1/workforce/agents/:id/capacity',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/delegations',
    operationId: 'API-WRK-001',
    summary: 'POST /v1/delegations',
    tag,
    status: 201,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/delegations/:id/end',
    operationId: 'API-WRK-002',
    summary: 'POST /v1/delegations/:id/end',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/delegations',
    operationId: 'WRK-GET-DELEGATIONS',
    summary: 'GET /v1/delegations',
    tag,
  });
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
