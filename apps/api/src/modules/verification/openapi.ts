// apps/api/src/modules/verification/openapi.ts — owner: Developer 2 (Module 19: Verification)
import {
  ChecklistAttestationRequestSchema,
  CompleteVerificationRequestSchema,
  CreateVerificationRequestSchema,
  UpdateVerificationRequestSchema,
  VerificationListResponseSchema,
  VerificationResponseSchema,
} from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { z } from 'zod';

export const tags = [
  {
    name: 'MOD-VRF Verification',
    description: 'Verification cases, KYC checks, and document review attestation (MOD-VRF).',
  },
];

export function registerOpenApi(registry: OpenAPIRegistry): void {
  const TAG = 'MOD-VRF Verification';

  registry.registerPath({
    method: 'get',
    path: '/v1/verifications',
    operationId: 'API-VRF-001',
    summary: 'List verification requests with filtering and cursor pagination',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      query: z.object({
        status: z.string().optional(),
        verificationType: z.string().optional(),
        priority: z.string().optional(),
        applicationId: z.string().optional(),
        branchId: z.string().optional(),
        assignedToUserId: z.string().optional(),
        limit: z.coerce.number().optional(),
        cursor: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: 'Page of verification requests',
        content: { 'application/json': { schema: VerificationListResponseSchema } },
      },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden: requires verification.read' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/verifications/{id}',
    operationId: 'API-VRF-002',
    summary: 'Get verification request details',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Verification request details',
        content: { 'application/json': { schema: VerificationResponseSchema } },
      },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden: requires verification.read' },
      404: { description: 'Verification request not found' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/verifications',
    operationId: 'API-VRF-003',
    summary: 'Initiate a new verification request',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      body: { content: { 'application/json': { schema: CreateVerificationRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Verification request created',
        content: { 'application/json': { schema: VerificationResponseSchema } },
      },
      400: { description: 'Validation error' },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden: requires verification.create' },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/v1/verifications/{id}',
    operationId: 'API-VRF-004',
    summary: 'Update verification request (assign verifier, schedule, notes)',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      headers: z.object({ 'if-match': z.string() }),
      body: { content: { 'application/json': { schema: UpdateVerificationRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Verification request updated',
        content: { 'application/json': { schema: VerificationResponseSchema } },
      },
      400: { description: 'Validation error / If-Match required' },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden: requires verification.update' },
      404: { description: 'Verification request not found' },
      409: { description: 'Version conflict' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/verifications/{id}/complete',
    operationId: 'API-VRF-005',
    summary: 'Complete verification case (verdict and findings)',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: CompleteVerificationRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Verification request marked complete/failed',
        content: { 'application/json': { schema: VerificationResponseSchema } },
      },
      400: { description: 'Validation error' },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden: requires verification.complete' },
      404: { description: 'Verification request not found' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/verifications/{id}/checklist-review',
    operationId: 'API-VRF-006',
    summary: 'Review and attest a document checklist item',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: ChecklistAttestationRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Checklist item reviewed and attested',
        content: {
          'application/json': {
            schema: z.object({
              checklistItemId: z.string(),
              status: z.string(),
              reviewedBy: z.string(),
              reviewedAt: z.string(),
            }),
          },
        },
      },
      400: { description: 'Validation error' },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden: requires document.review' },
      404: { description: 'Verification request or checklist item not found' },
    },
  });
}
