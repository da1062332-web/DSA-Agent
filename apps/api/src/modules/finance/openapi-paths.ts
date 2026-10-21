// OpenAPI paths for finance (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { CalculateCommissionInputSchema, DisbursePayoutGatewayInputSchema } from '@dsa/contracts';
import { ConsentOtpRequest, PortalDispute, PortalPayoutRequest, ReferralCreate } from './connector-portal';
import { registerOperation } from '../../http/openapi-op';

const tag = 'MOD-COM Commission and Payouts';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'get',
    path: '/v1/commission-plans',
    operationId: 'COM-GET-COMMISSION-PLANS',
    summary: 'GET /v1/commission-plans',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/commission-plans/:id',
    operationId: 'COM-GET-COMMISSION-PLANS-BY-ID',
    summary: 'GET /v1/commission-plans/:id',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/commission/calculate',
    operationId: 'COM-POST-COMMISSION-CALCULATE',
    summary: 'POST /v1/commission/calculate',
    tag,
    body: CalculateCommissionInputSchema,
    status: 201,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/commission-calculations',
    operationId: 'API-COM-002',
    summary: 'GET /v1/commission-calculations',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/commission-payables',
    operationId: 'API-COM-007',
    summary: 'GET /v1/commission-payables',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/clawbacks/:id/approval',
    operationId: 'COM-POST-CLAWBACKS-BY-ID-APPROVAL',
    summary: 'POST /v1/clawbacks/:id/approval',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/recalculation-proposals',
    operationId: 'COM-GET-RECALCULATION-PROPOSALS',
    summary: 'GET /v1/recalculation-proposals',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/recalculation-proposals/:id',
    operationId: 'COM-GET-RECALCULATION-PROPOSALS-BY-ID',
    summary: 'GET /v1/recalculation-proposals/:id',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/payout-requests',
    operationId: 'API-PAY-002',
    summary: 'GET /v1/payout-requests',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/payout-requests/:id',
    operationId: 'COM-GET-PAYOUT-REQUESTS-BY-ID',
    summary: 'GET /v1/payout-requests/:id',
    tag,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/payout-batches/:id/bank-file',
    operationId: 'API-PAY-007',
    summary: 'GET /v1/payout-batches/:id/bank-file',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/payout-requests/:id/disburse-gateway',
    operationId: 'COM-POST-PAYOUT-REQUESTS-BY-ID-DISBURSE-GATEWAY',
    summary: 'POST /v1/payout-requests/:id/disburse-gateway',
    tag,
    body: DisbursePayoutGatewayInputSchema,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/payout-batches/:id/dispatch-gateway',
    operationId: 'COM-POST-PAYOUT-BATCHES-BY-ID-DISPATCH-GATEWAY',
    summary: 'POST /v1/payout-batches/:id/dispatch-gateway',
    tag,
  });
  const cpt = 'MOD-CPT Connector Portal';
  registerOperation(registry, {
    method: 'get',
    path: '/portal/v1/referrals',
    operationId: 'API-CPT-001',
    summary: 'My referrals: masked name and a coarse status (connector users)',
    tag: cpt,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/portal/v1/referrals',
    operationId: 'API-CPT-002',
    summary: 'Refer a customer; needs a verified consent code for that mobile',
    tag: cpt,
    body: ReferralCreate,
    status: 201,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/portal/v1/referrals/consent-otp',
    operationId: 'API-CPT-003',
    summary: 'Send a consent code to the customer, or verify it (5 attempts, 10 minutes)',
    tag: cpt,
    body: ConsentOtpRequest,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/portal/v1/statements',
    operationId: 'API-CPT-004',
    summary: 'My earnings: expected, approved, paid, held and disputed, with lines',
    tag: cpt,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/portal/v1/payout-requests',
    operationId: 'API-CPT-005',
    summary: 'Request payout of my payable lines (step-up)',
    tag: cpt,
    body: PortalPayoutRequest,
    status: 201,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/portal/v1/disputes',
    operationId: 'API-CPT-006',
    summary: 'Dispute one of my statement lines or payouts',
    tag: cpt,
    body: PortalDispute,
    status: 201,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/portal/v1/rate-card',
    operationId: 'API-CPT-007',
    summary: 'My active agreement terms',
    tag: cpt,
  });
}
