// OpenAPI paths for reconciliation (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import {
  AdjustmentApprovalInputSchema,
  AdjustmentProposalInputSchema,
  AutoIngestBankFeedInputSchema,
  BankReconcilePayoutInputSchema,
  CreateDisputeInputSchema,
  ImportLenderStatementInputSchema,
  ListExceptionsQuerySchema,
  ResolveExceptionInputSchema,
  UpdateDisputeInputSchema,
} from '@dsa/contracts';
import { registerOperation } from '../../http/openapi-op';

const tag = 'MOD-REC Reconciliation';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'post',
    path: '/v1/lender-statements',
    operationId: 'API-REC-001',
    summary: 'POST /v1/lender-statements',
    tag,
    body: ImportLenderStatementInputSchema,
    status: 201,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/reconciliation/auto-ingest',
    operationId: 'REC-POST-RECONCILIATION-AUTO-INGEST',
    summary: 'POST /v1/reconciliation/auto-ingest',
    tag,
    body: AutoIngestBankFeedInputSchema,
    status: 201,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/lender-statements/auto-ingest',
    operationId: 'REC-POST-LENDER-STATEMENTS-AUTO-INGEST',
    summary: 'POST /v1/lender-statements/auto-ingest',
    tag,
    body: AutoIngestBankFeedInputSchema,
    status: 201,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/lender-statements',
    operationId: 'REC-GET-LENDER-STATEMENTS',
    summary: 'GET /v1/lender-statements',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/lender-statements/:id',
    operationId: 'REC-GET-LENDER-STATEMENTS-BY-ID',
    summary: 'GET /v1/lender-statements/:id',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/lender-statements/:id/match',
    operationId: 'REC-POST-LENDER-STATEMENTS-BY-ID-MATCH',
    summary: 'POST /v1/lender-statements/:id/match',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/reconciliation-exceptions',
    operationId: 'API-REC-002',
    summary: 'GET /v1/reconciliation-exceptions',
    tag,
    query: ListExceptionsQuerySchema,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/reconciliation-exceptions/:id/resolution',
    operationId: 'API-REC-003',
    summary: 'POST /v1/reconciliation-exceptions/:id/resolution',
    tag,
    body: ResolveExceptionInputSchema,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/adjustments',
    operationId: 'API-REC-004',
    summary: 'POST /v1/adjustments',
    tag,
    body: AdjustmentProposalInputSchema,
    status: 201,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/adjustments/:id/approval',
    operationId: 'API-REC-005',
    summary: 'POST /v1/adjustments/:id/approval',
    tag,
    body: AdjustmentApprovalInputSchema,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/adjustments',
    operationId: 'REC-GET-ADJUSTMENTS',
    summary: 'GET /v1/adjustments',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/disputes',
    operationId: 'API-REC-006',
    summary: 'POST /v1/disputes',
    tag,
    body: CreateDisputeInputSchema,
    status: 201,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'patch',
    path: '/v1/disputes/:id',
    operationId: 'API-REC-007',
    summary: 'PATCH /v1/disputes/:id',
    tag,
    body: UpdateDisputeInputSchema,
    ifMatch: true,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/disputes',
    operationId: 'REC-GET-DISPUTES',
    summary: 'GET /v1/disputes',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/reconciliation/payouts/:id/bank-reconcile',
    operationId: 'REC-POST-RECONCILIATION-PAYOUTS-BY-ID-BANK-RECONCILE',
    summary: 'POST /v1/reconciliation/payouts/:id/bank-reconcile',
    tag,
    body: BankReconcilePayoutInputSchema,
  });
}
