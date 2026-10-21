// OpenAPI paths for platform (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { UpdateTenantConfigRequest } from '@dsa/contracts';
import { registerOperation } from '../../http/openapi-op';
import { DeadLetterDiscard, DeadLetterQuery } from './dead-letters';
import { AccessReviewCreate, AccessReviewDecisions, OrgChartQuery } from './org-chart';
import {
  CalendarPut,
  ConfigBundle,
  EffectiveSettingsQuery,
  LabelsPut,
  PicklistValueCreate,
  SettingPut,
} from './configuration';

const tag = 'MOD-CFG Configuration';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'get',
    path: '/v1/config',
    operationId: 'CFG-GET-CONFIG',
    summary: 'GET /v1/config',
    tag,
  });
  registerOperation(registry, {
    method: 'patch',
    path: '/v1/config',
    operationId: 'CFG-PATCH-CONFIG',
    summary: 'PATCH /v1/config',
    tag,
    body: UpdateTenantConfigRequest,
    ifMatch: true,
  });
  const intTag = 'MOD-INT Integrations';
  registerOperation(registry, {
    method: 'get',
    path: '/v1/dead-letters',
    operationId: 'API-INT-003',
    summary:
      'Parked outbox events and exhausted jobs of the tenant, without payloads (integration.dlq_manage; cursor)',
    tag: intTag,
    query: DeadLetterQuery,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/dead-letters/:id/replay',
    operationId: 'API-INT-004',
    summary: 'Put a dead letter back in line (integration.dlq_manage)',
    tag: intTag,
    status: 202,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/dead-letters/:id/discard',
    operationId: 'API-INT-005',
    summary:
      'Discard a dead letter with a reason; it is kept for audit and never delivered (integration.dlq_manage)',
    tag: intTag,
    body: DeadLetterDiscard,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/org-chart',
    operationId: 'API-ORG-010',
    summary: 'Branches, teams, managers and members as of a date (any staff, within scope)',
    tag: 'MOD-ORG Organisation',
    query: OrgChartQuery,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/access-reviews',
    operationId: 'API-ACL-005',
    summary: 'Start an access review: one item per role assignment in force (user.manage)',
    tag: 'MOD-ACL Access Control',
    body: AccessReviewCreate,
    status: 201,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/access-reviews/:id',
    operationId: 'API-ACL-005-GET',
    summary: 'An access review and its items (user.manage)',
    tag: 'MOD-ACL Access Control',
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/access-reviews/:id/decisions',
    operationId: 'API-ACL-006',
    summary:
      'Certify or revoke items; never your own access (SOD-10); revoking ends the assignment (user.manage)',
    tag: 'MOD-ACL Access Control',
    body: AccessReviewDecisions,
  });
  const cfg = 'MOD-CFG Configuration';
  registerOperation(registry, {
    method: 'get',
    path: '/v1/settings/effective',
    operationId: 'API-CFG-001',
    summary: 'Effective settings with the level each came from (any staff)',
    tag: cfg,
    query: EffectiveSettingsQuery,
  });
  registerOperation(registry, {
    method: 'put',
    path: '/v1/settings/:scope/:key',
    operationId: 'API-CFG-002',
    summary:
      'Set a key at TENANT, ORGANISATION:<id>, BRANCH:<id> or USER:<id> (config.manage; If-Match 0 when unset)',
    tag: cfg,
    body: SettingPut,
    ifMatch: true,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/labels',
    operationId: 'API-CFG-003-GET',
    summary: 'Label set of a locale (any staff)',
    tag: cfg,
  });
  registerOperation(registry, {
    method: 'put',
    path: '/v1/labels',
    operationId: 'API-CFG-003',
    summary: 'Replace the labels and sub-stages of a locale (config.manage; If-Match)',
    tag: cfg,
    body: LabelsPut,
    ifMatch: true,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/calendars',
    operationId: 'API-CFG-004',
    summary: 'Business calendars (any staff)',
    tag: cfg,
  });
  registerOperation(registry, {
    method: 'put',
    path: '/v1/calendars/:id',
    operationId: 'API-CFG-005',
    summary: 'Create (If-Match 0) or replace a business calendar (config.manage)',
    tag: cfg,
    body: CalendarPut,
    ifMatch: true,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/picklists/:category',
    operationId: 'API-CFG-006',
    summary: 'Values of a tenant picklist (any staff)',
    tag: cfg,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/picklists/:category/values',
    operationId: 'API-CFG-007',
    summary: 'Add a picklist value (config.manage)',
    tag: cfg,
    body: PicklistValueCreate,
    status: 201,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/config-bundles/export',
    operationId: 'API-CFG-008',
    summary: 'Export settings, labels, calendars and picklists as a bundle (config.manage)',
    tag: cfg,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/config-bundles/import',
    operationId: 'API-CFG-009',
    summary: 'Validate a bundle and keep it as a draft; nothing is applied (config.manage)',
    tag: cfg,
    body: ConfigBundle,
    status: 202,
    idempotent: true,
  });
}
