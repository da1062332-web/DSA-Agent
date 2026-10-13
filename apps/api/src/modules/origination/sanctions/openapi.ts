// apps/api/src/modules/origination/sanctions/openapi.ts — owner: Dev 3 (MOD-SND Sanctions & Disbursement)
import {
  CancelSanctionRequestSchema,
  ExceptionApprovalRequestSchema,
  RecordSanctionRequestSchema,
  RecordTrancheRequestSchema,
  VerifyTrancheRequestSchema,
  VoidTrancheRequestSchema,
} from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { z } from 'zod';

export const tags = [
  { name: 'MOD-SND Sanctions & Disbursement', description: 'Sanction recording, tranches, verification, and exceptions (MOD-SND).' },
];

export function registerOpenApi(registry: OpenAPIRegistry): void {
  // API-SND-001: Record or Revise Sanction
  registry.registerPath({
    method: 'post',
    path: '/v1/lender-cases/{id}/sanctions',
    operationId: 'API-SND-001',
    summary: 'API-SND-001: Record or Revise Sanction',
    tags: ['MOD-SND Sanctions & Disbursement'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: RecordSanctionRequestSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Sanction recorded successfully',
        content: {
          'application/json': {
            schema: z.object({
              id: z.string(),
              version: z.number(),
              amount: z.number(),
              status: z.string(),
            }),
          },
        },
      },
    },
  });

  // API-SND-002: Record Disbursement Tranche
  registry.registerPath({
    method: 'post',
    path: '/v1/sanctions/{id}/tranches',
    operationId: 'API-SND-002',
    summary: 'API-SND-002: Record Disbursement Tranche',
    tags: ['MOD-SND Sanctions & Disbursement'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: RecordTrancheRequestSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Disbursement tranche recorded',
        content: {
          'application/json': {
            schema: z.object({
              tranche: z.object({
                id: z.string(),
                trancheNo: z.number(),
                amount: z.number(),
                status: z.string(),
              }),
              remainingSanctionAmount: z.number(),
            }),
          },
        },
      },
    },
  });

  // API-SND-003: Verify or Return a Tranche
  registry.registerPath({
    method: 'post',
    path: '/v1/tranches/{id}/verification',
    operationId: 'API-SND-003',
    summary: 'API-SND-003: Verify or Return Tranche (SOD-04)',
    tags: ['MOD-SND Sanctions & Disbursement'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: VerifyTrancheRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Tranche verified or returned',
        content: {
          'application/json': {
            schema: z.object({
              id: z.string(),
              status: z.string(),
              verifiedBy: z.string().nullable(),
            }),
          },
        },
      },
    },
  });

  // API-SND-004: Approve Evidence Exception
  registry.registerPath({
    method: 'post',
    path: '/v1/tranches/{id}/exception-approval',
    operationId: 'API-SND-004',
    summary: 'API-SND-004: Approve Evidence Exception',
    tags: ['MOD-SND Sanctions & Disbursement'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: ExceptionApprovalRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Evidence exception approved',
        content: {
          'application/json': {
            schema: z.object({
              id: z.string(),
              exceptionApprovalId: z.string().nullable(),
            }),
          },
        },
      },
    },
  });

  // API-SND-005: Cancel Sanction
  registry.registerPath({
    method: 'post',
    path: '/v1/sanctions/{id}/cancellation',
    operationId: 'API-SND-005',
    summary: 'API-SND-005: Cancel Sanction',
    tags: ['MOD-SND Sanctions & Disbursement'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: CancelSanctionRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Sanction cancelled',
        content: {
          'application/json': {
            schema: z.object({
              id: z.string(),
              status: z.string(),
              cancelReason: z.string().nullable(),
            }),
          },
        },
      },
    },
  });

  // API-SND-006: Void and Replace Tranche
  registry.registerPath({
    method: 'post',
    path: '/v1/tranches/{id}/void',
    operationId: 'API-SND-006',
    summary: 'API-SND-006: Void and Replace Tranche',
    tags: ['MOD-SND Sanctions & Disbursement'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: VoidTrancheRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Tranche voided and optionally replaced',
        content: {
          'application/json': {
            schema: z.object({
              voidedTranche: z.object({
                id: z.string(),
                status: z.string(),
                voidReason: z.string().nullable(),
              }),
            }),
          },
        },
      },
    },
  });
}
