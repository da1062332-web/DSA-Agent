// apps/api/src/modules/audit/openapi.ts — Module 37: Audit (MOD-AUD, DOM-N)
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import {
  AuditSearchQuery,
  AuditEventListResponse,
  AuditChainVerificationResponse,
  CreateEvidencePackRequest,
  EvidencePackResponse,
  EvidencePackListResponse,
} from '@dsa/contracts';
import { z } from 'zod';

export function registerOpenApi(registry: OpenAPIRegistry): void {
  // API-AUD-001: Search audit events
  registry.registerPath({
    method: 'get',
    path: '/v1/audit-events',
    summary: 'Search audit events with cursor-based pagination (API-AUD-001, API-AUD-002)',
    security: [{ bearerAuth: [] }],
    request: {
      query: AuditSearchQuery,
    },
    responses: {
      200: {
        description: 'Filtered list of audit events',
        content: { 'application/json': { schema: AuditEventListResponse } },
      },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden (requires audit.read)' },
    },
  });

  // Get single audit event by ID
  registry.registerPath({
    method: 'get',
    path: '/v1/audit-events/{id}',
    summary: 'Retrieve a single audit event by identifier',
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Audit event detail',
        content: { 'application/json': { schema: z.record(z.unknown()) } },
      },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden (requires audit.read)' },
      404: { description: 'Audit event not found' },
    },
  });

  // Get decision record linked to an audit event
  registry.registerPath({
    method: 'get',
    path: '/v1/audit-events/{id}/decision-record',
    summary: 'Retrieve the MOD-BRE decision record linked to an audit event',
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Linked MOD-BRE decision record',
        content: { 'application/json': { schema: z.record(z.unknown()) } },
      },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden (requires audit.read)' },
      404: { description: 'Audit event or linked decision record not found' },
    },
  });

  // API-AUD-003: Audit chain verification
  registry.registerPath({
    method: 'get',
    path: '/v1/audit-chain/verification',
    summary: 'Verify cryptographic hash chain integrity and tamper evidence (API-AUD-003)',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Audit chain verification report',
        content: { 'application/json': { schema: AuditChainVerificationResponse } },
      },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden (requires audit.read)' },
    },
  });

  // Chain seal trigger
  registry.registerPath({
    method: 'post',
    path: '/v1/audit-chain/seal',
    summary: 'Seal unsealed audit events into the cryptographic hash chain',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Seal execution summary',
        content: {
          'application/json': {
            schema: z.object({
              tenantId: z.string(),
              sealedCount: z.number().int(),
              lastSequence: z.number().int().nullable(),
              latestHash: z.string().nullable(),
            }),
          },
        },
      },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden (requires audit.read)' },
    },
  });

  // Request evidence export
  registry.registerPath({
    method: 'post',
    path: '/v1/evidence-packs',
    summary: 'Request asynchronous audit evidence pack export (TASK-408)',
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        content: {
          'application/json': {
            schema: CreateEvidencePackRequest,
          },
        },
      },
    },
    responses: {
      202: {
        description: 'Evidence pack export initiated',
        content: { 'application/json': { schema: EvidencePackResponse } },
      },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden (requires audit.export_evidence)' },
    },
  });

  // Get evidence pack by ID
  registry.registerPath({
    method: 'get',
    path: '/v1/evidence-packs/{id}',
    summary: 'Get evidence pack status and download metadata',
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Evidence pack details',
        content: { 'application/json': { schema: EvidencePackResponse } },
      },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden (requires audit.export_evidence)' },
      404: { description: 'Evidence pack not found' },
    },
  });

  // Download evidence pack
  registry.registerPath({
    method: 'get',
    path: '/v1/evidence-packs/{id}/download',
    summary: 'Download evidence pack JSON archive with independent authorization and tenant scoping',
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Evidence pack download package',
        content: { 'application/json': { schema: z.record(z.unknown()) } },
      },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden (requires audit.export_evidence)' },
      404: { description: 'Evidence pack not found' },
      409: { description: 'Evidence pack not ready for download or expired' },
    },
  });

  // List evidence packs
  registry.registerPath({
    method: 'get',
    path: '/v1/evidence-packs',
    summary: 'List evidence packs for tenant',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'List of evidence packs',
        content: { 'application/json': { schema: EvidencePackListResponse } },
      },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden (requires audit.export_evidence)' },
    },
  });
}
