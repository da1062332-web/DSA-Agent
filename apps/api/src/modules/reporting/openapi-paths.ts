// OpenAPI paths for reporting (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { registerOperation } from '../../http/openapi-op';

const tag = 'MOD-RPT Reporting';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'get',
    path: '/v1/metric-definitions',
    operationId: 'RPT-GET-METRIC-DEFINITIONS',
    summary: 'GET /v1/metric-definitions',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/metric-definitions/:code',
    operationId: 'RPT-GET-METRIC-DEFINITIONS-BY-ID',
    summary: 'GET /v1/metric-definitions/:code',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/report-runs/:id/download',
    operationId: 'RPT-GET-REPORT-RUNS-BY-ID-DOWNLOAD',
    summary: 'GET /v1/report-runs/:id/download',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/report-runs',
    operationId: 'RPT-GET-REPORT-RUNS',
    summary: 'GET /v1/report-runs',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/exports/:id/download',
    operationId: 'RPT-GET-EXPORTS-BY-ID-DOWNLOAD',
    summary: 'GET /v1/exports/:id/download',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/exports',
    operationId: 'RPT-GET-EXPORTS',
    summary: 'GET /v1/exports',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/report-schedules',
    operationId: 'RPT-GET-REPORT-SCHEDULES',
    summary: 'GET /v1/report-schedules',
    tag,
  });
  registerOperation(registry, {
    method: 'delete',
    path: '/v1/report-schedules/:id',
    operationId: 'RPT-DELETE-REPORT-SCHEDULES-BY-ID',
    summary: 'DELETE /v1/report-schedules/:id',
    tag,
    status: 204,
  });
}
