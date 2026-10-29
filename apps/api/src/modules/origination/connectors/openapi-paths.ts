// OpenAPI paths for origination/connectors (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import {
  ActivateConnectorSchema,
  ApproveAttributionChangeRequestSchema,
  ApproveConnectorBankAccountSchema,
  ConnectorPortalAccessSchema,
  ConnectorPortalRevocationSchema,
  CreateAttributionChangeRequestSchema,
  CreateConnectorAgreementSchema,
  CreateConnectorBankAccountSchema,
  CreateConnectorSchema,
  InviteConnectorUserSchema,
  ListConnectorsQuerySchema,
  ResolveAttributionDisputeSchema,
  UpdateConnectorSchema,
  UpdateConnectorStatusSchema,
} from '@dsa/contracts';
import { registerOperation } from '../../../http/openapi-op';

const tag = 'MOD-CON Connectors';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'post',
    path: '/v1/connectors',
    operationId: 'API-CON-001',
    summary: 'POST /v1/connectors',
    tag,
    body: CreateConnectorSchema,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/connectors',
    operationId: 'API-CON-002',
    summary: 'GET /v1/connectors',
    tag,
    query: ListConnectorsQuerySchema,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/connectors/:id',
    operationId: 'CON-GET-CONNECTORS-BY-ID',
    summary: 'GET /v1/connectors/:id',
    tag,
  });
  registerOperation(registry, {
    method: 'patch',
    path: '/v1/connectors/:id',
    operationId: 'API-CON-003',
    summary: 'PATCH /v1/connectors/:id',
    tag,
    body: UpdateConnectorSchema,
    ifMatch: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/connectors/:id/activation',
    operationId: 'API-CON-005',
    summary: 'POST /v1/connectors/:id/activation',
    tag,
    body: ActivateConnectorSchema,
    idempotent: true,
    ifMatch: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/connectors/:id/status',
    operationId: 'API-CON-006',
    summary: 'POST /v1/connectors/:id/status',
    tag,
    body: UpdateConnectorStatusSchema,
    idempotent: true,
    ifMatch: true,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/connectors/:id/bank-accounts',
    operationId: 'CON-GET-CONNECTORS-BY-ID-BANK-ACCOUNTS',
    summary: 'GET /v1/connectors/:id/bank-accounts',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/connectors/:id/bank-accounts',
    operationId: 'API-CON-007',
    summary: 'POST /v1/connectors/:id/bank-accounts',
    tag,
    body: CreateConnectorBankAccountSchema,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/connectors/:id/bank-accounts/:accountId/approval',
    operationId: 'CON-POST-CONNECTORS-BY-ID-BANK-ACCOUNTS-BY-ID-APPROVAL',
    summary: 'POST /v1/connectors/:id/bank-accounts/:accountId/approval',
    tag,
    body: ApproveConnectorBankAccountSchema,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/connectors/:id/agreements',
    operationId: 'CON-GET-CONNECTORS-BY-ID-AGREEMENTS',
    summary: 'GET /v1/connectors/:id/agreements',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/connectors/:id/agreements',
    operationId: 'API-CON-004',
    summary: 'POST /v1/connectors/:id/agreements',
    tag,
    body: CreateConnectorAgreementSchema,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/connectors/:id/users',
    operationId: 'API-CON-011',
    summary:
      'POST /v1/connectors/:id/users (invite a portal user; INVITED until the invitee sets a password)',
    tag,
    body: InviteConnectorUserSchema,
    status: 201,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/connectors/lookup',
    operationId: 'CON-GET-CONNECTORS-LOOKUP',
    summary: 'GET /v1/connectors/lookup (picker data: id, legal name, status, branch only)',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/connectors/:id/users',
    operationId: 'CON-GET-CONNECTORS-BY-ID-USERS',
    summary: 'GET /v1/connectors/:id/users (portal users and invitation state)',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/connectors/:id/users/:userId/invitation/resend',
    operationId: 'CON-POST-CONNECTOR-USER-INVITATION-RESEND',
    summary: 'POST /v1/connectors/:id/users/:userId/invitation/resend',
    tag,
    status: 202,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/connectors/:id/users/:userId/invitation/revocation',
    operationId: 'CON-POST-CONNECTOR-USER-INVITATION-REVOCATION',
    summary: 'POST /v1/connectors/:id/users/:userId/invitation/revocation',
    tag,
    body: ConnectorPortalRevocationSchema,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/connectors/:id/users/:userId/access',
    operationId: 'CON-POST-CONNECTOR-USER-ACCESS',
    summary: 'POST /v1/connectors/:id/users/:userId/access (suspend or reactivate a portal user)',
    tag,
    body: ConnectorPortalAccessSchema,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/attribution-change-requests',
    operationId: 'CON-GET-ATTRIBUTION-CHANGE-REQUESTS',
    summary: 'GET /v1/attribution-change-requests',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/attribution-change-requests',
    operationId: 'API-CON-009',
    summary: 'POST /v1/attribution-change-requests',
    tag,
    body: CreateAttributionChangeRequestSchema,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/attribution-change-requests/:id/approval',
    operationId: 'API-CON-010',
    summary: 'POST /v1/attribution-change-requests/:id/approval',
    tag,
    body: ApproveAttributionChangeRequestSchema,
    ifMatch: true,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/attribution-disputes',
    operationId: 'CON-GET-ATTRIBUTION-DISPUTES',
    summary: 'GET /v1/attribution-disputes',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/attribution-disputes/:id/resolution',
    operationId: 'API-CON-008',
    summary: 'POST /v1/attribution-disputes/:id/resolution',
    tag,
    body: ResolveAttributionDisputeSchema,
    ifMatch: true,
  });
}
