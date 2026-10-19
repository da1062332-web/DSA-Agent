// OpenAPI paths for crm/tasks (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { registerOperation } from '../../../http/openapi-op';

const tag = 'MOD-TASK Tasks';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'post',
    path: '/v1/tasks/:id/snooze',
    operationId: 'TASK-POST-TASKS-BY-ID-SNOOZE',
    summary: 'POST /v1/tasks/:id/snooze',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/tasks/bulk-reassignment',
    operationId: 'API-TASK-006',
    summary: 'POST /v1/tasks/bulk-reassignment',
    tag,
  });
}
