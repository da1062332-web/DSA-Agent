// OpenAPI paths for compliance (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { VerifyConsentInputSchema } from '@dsa/contracts';
import { registerOperation } from '../../http/openapi-op';
import {
  DataSubjectRequestCreate,
  DataSubjectRequestPatch,
  DataSubjectRequestQuery,
  RetentionPolicyPut,
} from './privacy-controls';

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
  const prv = 'MOD-PRV Privacy and Compliance';
  registerOperation(registry, {
    method: 'get',
    path: '/v1/retention-policies',
    operationId: 'API-PRV-005',
    summary:
      'Retention schedule: one entry per data class, the tenant value or the platform default (privacy.manage)',
    tag: prv,
  });
  registerOperation(registry, {
    method: 'put',
    path: '/v1/retention-policies/:class',
    operationId: 'API-PRV-006',
    summary:
      'Change the retention of a data class, never below the platform minimum (privacy.manage; step-up; If-Match 0 for a default)',
    tag: prv,
    body: RetentionPolicyPut,
    ifMatch: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/data-subject-requests',
    operationId: 'API-PRV-001',
    summary: 'Log a data-principal request; due 30 days after receipt unless given (privacy.manage)',
    tag: prv,
    body: DataSubjectRequestCreate,
    status: 201,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/data-subject-requests',
    operationId: 'API-PRV-002',
    summary: 'Data-principal request queue, earliest due first (privacy.manage; cursor)',
    tag: prv,
    query: DataSubjectRequestQuery,
  });
  registerOperation(registry, {
    method: 'patch',
    path: '/v1/data-subject-requests/:id',
    operationId: 'API-PRV-003',
    summary:
      'Progress or decide a request: RECEIVED, IN_PROGRESS, then COMPLETED or REJECTED with a decision (privacy.manage)',
    tag: prv,
    body: DataSubjectRequestPatch,
    ifMatch: true,
  });
}
