// apps/api/src/modules/origination/lender-cases/openapi.ts — owner: Dev 4 (MOD-LCS Lender Cases)
import {
  BuildPackageInputSchema,
  LenderCaseStatusHistoryResourceSchema,
  CreateLenderCaseInputSchema,
  LenderCaseResourceSchema,
  LenderQueryResourceSchema,
  RecordLenderQueryInputSchema,
  RecordQueryResponseInputSchema,
  SubmissionPackageResourceSchema,
  SubmitLenderCaseInputSchema,
  SubmitLenderCaseResponseSchema,
  UpdateLenderCaseStatusInputSchema,
} from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { z } from 'zod';

/** A lender query with the lender's answer, if one was recorded. */
const LenderQueryHistorySchema = LenderQueryResourceSchema.extend({
  responseText: z.string().nullable(),
  responseDocumentReferences: z.array(z.string()),
});

export const tags = [
  {
    name: 'MOD-LCS Lender Cases',
    description: 'Lender cases, submission packaging, and status tracking (MOD-LCS).',
  },
];

export function registerOpenApi(registry: OpenAPIRegistry): void {
  // POST /v1/applications/{id}/lender-cases
  registry.registerPath({
    method: 'post',
    path: '/v1/applications/{id}/lender-cases',
    operationId: 'API-LCS-001',
    summary: 'API-LCS-001: Create Lender Case',
    tags: ['MOD-LCS Lender Cases'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      headers: z.object({
        'Idempotency-Key': z.string().optional(),
      }),
      body: {
        content: {
          'application/json': {
            schema: CreateLenderCaseInputSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Lender case created',
        content: {
          'application/json': {
            schema: LenderCaseResourceSchema,
          },
        },
      },
    },
  });

  // GET /v1/applications/{id}/lender-cases
  registry.registerPath({
    method: 'get',
    path: '/v1/applications/{id}/lender-cases',
    operationId: 'API-LCS-001-LIST',
    summary: 'List Lender Cases for Application',
    tags: ['MOD-LCS Lender Cases'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'List of lender cases',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(LenderCaseResourceSchema),
            }),
          },
        },
      },
    },
  });

  // GET /v1/lender-cases/{id}
  registry.registerPath({
    method: 'get',
    path: '/v1/lender-cases/{id}',
    operationId: 'API-LCS-002',
    summary: 'API-LCS-002: Retrieve Lender Case',
    tags: ['MOD-LCS Lender Cases'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Lender case detail',
        content: {
          'application/json': {
            schema: LenderCaseResourceSchema,
          },
        },
      },
    },
  });

  // POST /v1/lender-cases/{id}/package
  registry.registerPath({
    method: 'post',
    path: '/v1/lender-cases/{id}/package',
    operationId: 'API-LCS-003',
    summary: 'API-LCS-003: Build or Preview Submission Package',
    tags: ['MOD-LCS Lender Cases'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      headers: z.object({
        'If-Match': z.string().optional(),
      }),
      body: {
        content: {
          'application/json': {
            schema: BuildPackageInputSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Submission package generated',
        content: {
          'application/json': {
            schema: z.object({
              package: SubmissionPackageResourceSchema,
              case: LenderCaseResourceSchema,
            }),
          },
        },
      },
    },
  });

  // POST /v1/lender-cases/{id}/submission
  registry.registerPath({
    method: 'post',
    path: '/v1/lender-cases/{id}/submission',
    operationId: 'API-LCS-004',
    summary: 'API-LCS-004: Submit Lender Case',
    tags: ['MOD-LCS Lender Cases'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      headers: z.object({
        'Idempotency-Key': z.string().optional(),
        'If-Match': z.string().optional(),
      }),
      body: {
        content: {
          'application/json': {
            schema: SubmitLenderCaseInputSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Lender case submitted',
        content: {
          'application/json': {
            schema: SubmitLenderCaseResponseSchema,
          },
        },
      },
    },
  });

  // POST /v1/lender-cases/{id}/status-updates
  registry.registerPath({
    method: 'post',
    path: '/v1/lender-cases/{id}/status-updates',
    operationId: 'API-LCS-005',
    summary: 'API-LCS-005: Record Status Update',
    tags: ['MOD-LCS Lender Cases'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      headers: z.object({
        'If-Match': z.string(),
      }),
      body: {
        content: {
          'application/json': {
            schema: UpdateLenderCaseStatusInputSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Status update recorded',
        content: {
          'application/json': {
            schema: LenderCaseResourceSchema,
          },
        },
      },
    },
  });

  // POST /v1/lender-cases/{id}/queries
  registry.registerPath({
    method: 'post',
    path: '/v1/lender-cases/{id}/queries',
    operationId: 'API-LCS-006',
    summary: 'API-LCS-006: Record Lender Query',
    tags: ['MOD-LCS Lender Cases'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: RecordLenderQueryInputSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Query recorded',
        content: {
          'application/json': {
            schema: z.object({
              query: LenderQueryResourceSchema,
              case: LenderCaseResourceSchema,
            }),
          },
        },
      },
    },
  });

  // POST /v1/lender-queries/{id}/responses
  registry.registerPath({
    method: 'post',
    path: '/v1/lender-queries/{id}/responses',
    operationId: 'API-LCS-007',
    summary: 'API-LCS-007: Record Query Response',
    tags: ['MOD-LCS Lender Cases'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: RecordQueryResponseInputSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Query response recorded',
        content: {
          'application/json': {
            schema: z.object({
              query: LenderQueryResourceSchema,
              case: LenderCaseResourceSchema,
            }),
          },
        },
      },
    },
  });

  // GET /v1/lender-cases/{id}/queries
  registry.registerPath({
    method: 'get',
    path: '/v1/lender-cases/{id}/queries',
    operationId: 'API-LCS-008',
    summary: 'API-LCS-008: List Lender Queries',
    tags: ['MOD-LCS Lender Cases'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Queries raised on this case, oldest first',
        content: {
          'application/json': {
            schema: z.object({ data: z.array(LenderQueryHistorySchema) }),
          },
        },
      },
    },
  });

  // GET /v1/lender-cases/{id}/history
  registry.registerPath({
    method: 'get',
    path: '/v1/lender-cases/{id}/history',
    operationId: 'API-LCS-009',
    summary: 'API-LCS-009: List Lender Case Status History',
    tags: ['MOD-LCS Lender Cases'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Status transitions of this case, oldest first',
        content: {
          'application/json': {
            schema: z.object({ data: z.array(LenderCaseStatusHistoryResourceSchema) }),
          },
        },
      },
    },
  });

  // GET /v1/lender-cases/{id}/package
  registry.registerPath({
    method: 'get',
    path: '/v1/lender-cases/{id}/package',
    operationId: 'API-LCS-010',
    summary: 'API-LCS-010: Retrieve Submission Package',
    tags: ['MOD-LCS Lender Cases'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'The package the case was built and frozen with',
        content: {
          'application/json': {
            schema: SubmissionPackageResourceSchema,
          },
        },
      },
    },
  });
}
