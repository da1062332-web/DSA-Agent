import {
  AdjustmentResponseSchema,
  ApproveCommissionPlanInputSchema,
  ApproveRecalculationProposalInputSchema,
  CalculateCommissionInputSchema,
  CancelPayoutRequestInputSchema,
  CommissionCalculationResponseSchema,
  CommissionPayableResponseSchema,
  CommissionPlanResponseSchema,
  CreateClawbackInputSchema,
  CreateCommissionPlanInputSchema,
  CreatePayoutBatchInputSchema,
  CreatePayoutRequestInputSchema,
  CreateRecalculationProposalInputSchema,
  PayoutApprovalInputSchema,
  PayoutApprovalResponseSchema,
  PayoutBatchResponseSchema,
  PayoutRequestResponseSchema,
  RecalculationProposalResponseSchema,
  RecordPaymentFailureInputSchema,
  RecordPaymentInputSchema,
  RejectClawbackInputSchema,
  UpdateCommissionPlanInputSchema,
} from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { z } from 'zod';

export const tags = [
  { name: 'MOD-COM Commission', description: 'Lender commission plans, calculations, and splits (MOD-COM).' },
  {
    name: 'MOD-PAY Payouts',
    description: 'Connector payout requests, maker-checker approvals and batches (MOD-PAY).',
  },
];

export function registerOpenApi(registry: OpenAPIRegistry): void {
  registry.register('CreateCommissionPlanInput', CreateCommissionPlanInputSchema);
  registry.register('CommissionPlanResponse', CommissionPlanResponseSchema);
  registry.register('CalculateCommissionInput', CalculateCommissionInputSchema);
  registry.register('CommissionCalculationResponse', CommissionCalculationResponseSchema);
  registry.register('CommissionPayableResponse', CommissionPayableResponseSchema);
  registry.register('CreateRecalculationProposalInput', CreateRecalculationProposalInputSchema);
  registry.register('RecalculationProposalResponse', RecalculationProposalResponseSchema);
  registry.register('CreatePayoutRequestInput', CreatePayoutRequestInputSchema);
  registry.register('PayoutRequestResponse', PayoutRequestResponseSchema);
  registry.register('PayoutBatchResponse', PayoutBatchResponseSchema);

  // API-COM-003: POST /v1/commission-plans
  registry.registerPath({
    method: 'post',
    path: '/v1/commission-plans',
    operationId: 'API-COM-003',
    summary: 'Create commission plan (API-COM-003)',
    tags: ['MOD-COM Commission'],
    request: {
      body: { content: { 'application/json': { schema: CreateCommissionPlanInputSchema } }, required: true },
    },
    responses: {
      201: {
        description: 'Plan created',
        content: { 'application/json': { schema: CommissionPlanResponseSchema } },
      },
    },
  });

  // API-COM-004: PATCH /v1/commission-plans/{id}
  registry.registerPath({
    method: 'patch',
    path: '/v1/commission-plans/{id}',
    operationId: 'API-COM-004',
    summary: 'Update commission plan (API-COM-004)',
    tags: ['MOD-COM Commission'],
    request: {
      headers: z.object({ 'If-Match': z.string() }),
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: UpdateCommissionPlanInputSchema } }, required: true },
    },
    responses: {
      200: {
        description: 'Plan updated',
        content: { 'application/json': { schema: CommissionPlanResponseSchema } },
      },
    },
  });

  // API-COM-008: POST /v1/commission-plans/{id}/approval
  registry.registerPath({
    method: 'post',
    path: '/v1/commission-plans/{id}/approval',
    operationId: 'API-COM-008',
    summary: 'Approve commission plan (API-COM-008, SOD-02)',
    tags: ['MOD-COM Commission'],
    request: {
      headers: z.object({ 'If-Match': z.string() }),
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: ApproveCommissionPlanInputSchema } }, required: true },
    },
    responses: {
      200: {
        description: 'Plan approved',
        content: { 'application/json': { schema: CommissionPlanResponseSchema } },
      },
    },
  });

  // API-COM-001: GET /v1/commission-calculations/{id}
  registry.registerPath({
    method: 'get',
    path: '/v1/commission-calculations/{id}',
    operationId: 'API-COM-001',
    summary: 'Get calculation snapshot (API-COM-001)',
    tags: ['MOD-COM Commission'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Calculation snapshot',
        content: { 'application/json': { schema: CommissionCalculationResponseSchema } },
      },
    },
  });

  // API-COM-009: POST /v1/clawbacks
  registry.registerPath({
    method: 'post',
    path: '/v1/clawbacks',
    operationId: 'API-COM-009',
    summary: 'Record clawback with evidence (API-COM-009)',
    tags: ['MOD-COM Commission'],
    request: {
      body: { content: { 'application/json': { schema: CreateClawbackInputSchema } }, required: true },
    },
    responses: {
      201: {
        description: 'Clawback recorded',
        content: { 'application/json': { schema: AdjustmentResponseSchema } },
      },
    },
  });

  // POST /v1/clawbacks/{id}/rejection
  registry.registerPath({
    method: 'post',
    path: '/v1/clawbacks/{id}/rejection',
    operationId: 'API-COM-010',
    summary: 'Reject clawback proposal',
    tags: ['MOD-COM Commission'],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: RejectClawbackInputSchema } }, required: true },
    },
    responses: {
      200: {
        description: 'Clawback rejected',
        content: { 'application/json': { schema: z.object({ id: z.string(), status: z.string() }) } },
      },
    },
  });

  // API-COM-005: POST /v1/recalculation-proposals
  registry.registerPath({
    method: 'post',
    path: '/v1/recalculation-proposals',
    operationId: 'API-COM-005',
    summary: 'Propose commission recalculation (API-COM-005)',
    tags: ['MOD-COM Commission'],
    request: {
      body: {
        content: { 'application/json': { schema: CreateRecalculationProposalInputSchema } },
        required: true,
      },
    },
    responses: {
      201: {
        description: 'Recalculation proposal created',
        content: { 'application/json': { schema: RecalculationProposalResponseSchema } },
      },
    },
  });

  // API-COM-006: POST /v1/recalculation-proposals/{id}/approval
  registry.registerPath({
    method: 'post',
    path: '/v1/recalculation-proposals/{id}/approval',
    operationId: 'API-COM-006',
    summary: 'Approve recalculation proposal (API-COM-006, SOD-07)',
    tags: ['MOD-COM Commission'],
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: { 'application/json': { schema: ApproveRecalculationProposalInputSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Recalculation approved and new calculation generated',
        content: {
          'application/json': {
            schema: z.object({
              id: z.string(),
              status: z.string(),
              newCalculationId: z.string(),
            }),
          },
        },
      },
    },
  });

  // API-PAY-001: POST /v1/payout-requests
  registry.registerPath({
    method: 'post',
    path: '/v1/payout-requests',
    operationId: 'API-PAY-001',
    summary: 'Create payout request (API-PAY-001)',
    tags: ['MOD-PAY Payouts'],
    request: {
      body: { content: { 'application/json': { schema: CreatePayoutRequestInputSchema } }, required: true },
    },
    responses: {
      201: {
        description: 'Payout request created',
        content: { 'application/json': { schema: PayoutRequestResponseSchema } },
      },
    },
  });

  // POST /v1/payout-requests/{id}/cancel
  registry.registerPath({
    method: 'post',
    path: '/v1/payout-requests/{id}/cancel',
    operationId: 'API-PAY-008',
    summary: 'Cancel payout request',
    tags: ['MOD-PAY Payouts'],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: CancelPayoutRequestInputSchema } }, required: true },
    },
    responses: {
      200: {
        description: 'Payout request cancelled',
        content: { 'application/json': { schema: z.object({ id: z.string(), status: z.string() }) } },
      },
    },
  });

  // API-PAY-003: POST /v1/payout-requests/{id}/approval
  registry.registerPath({
    method: 'post',
    path: '/v1/payout-requests/{id}/approval',
    operationId: 'API-PAY-003',
    summary: 'Approve or reject payout request (API-PAY-003, SOD-03)',
    tags: ['MOD-PAY Payouts'],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: PayoutApprovalInputSchema } }, required: true },
    },
    responses: {
      200: {
        description: 'Payout request approval response',
        content: { 'application/json': { schema: PayoutApprovalResponseSchema } },
      },
    },
  });

  // API-PAY-004: POST /v1/payout-requests/{id}/payment
  registry.registerPath({
    method: 'post',
    path: '/v1/payout-requests/{id}/payment',
    operationId: 'API-PAY-004',
    summary: 'Record payment reference / UTR (API-PAY-004)',
    tags: ['MOD-PAY Payouts'],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: RecordPaymentInputSchema } }, required: true },
    },
    responses: {
      200: {
        description: 'Payment recorded',
        content: { 'application/json': { schema: PayoutRequestResponseSchema } },
      },
    },
  });

  // API-PAY-005: POST /v1/payout-requests/{id}/payment-failure
  registry.registerPath({
    method: 'post',
    path: '/v1/payout-requests/{id}/payment-failure',
    operationId: 'API-PAY-005',
    summary: 'Record payment failure (API-PAY-005)',
    tags: ['MOD-PAY Payouts'],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: RecordPaymentFailureInputSchema } }, required: true },
    },
    responses: {
      200: {
        description: 'Payment failure recorded',
        content: { 'application/json': { schema: PayoutRequestResponseSchema } },
      },
    },
  });

  // API-PAY-006: POST /v1/payout-batches
  registry.registerPath({
    method: 'post',
    path: '/v1/payout-batches',
    operationId: 'API-PAY-006',
    summary: 'Create payout batch (API-PAY-006)',
    tags: ['MOD-PAY Payouts'],
    request: {
      body: { content: { 'application/json': { schema: CreatePayoutBatchInputSchema } }, required: true },
    },
    responses: {
      201: {
        description: 'Payout batch created',
        content: { 'application/json': { schema: PayoutBatchResponseSchema } },
      },
    },
  });
}
