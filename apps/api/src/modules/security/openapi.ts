// apps/api/src/modules/security/openapi.ts — Module 39: Security (MOD-SEC, DOM-N)
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import {
  CreateIncidentRequestSchema,
  CreateSecurityEventRequestSchema,
  IncidentListQuerySchema,
  IncidentListResponseSchema,
  IncidentRecordSchema,
  SecurityEventListQuerySchema,
  SecurityEventListResponseSchema,
  SecurityEventSchema,
  UpdateIncidentRequestSchema,
} from '@dsa/contracts';
import { z } from 'zod';

export function registerOpenApi(registry: OpenAPIRegistry): void {
  // API-SEC-001: Record a security incident
  registry.registerPath({
    operationId: 'API-SEC-001',
    method: 'post',
    path: '/v1/incidents',
    summary: 'Record a security incident (API-SEC-001)',
    security: [{ bearerAuth: [] }],
    request: {
      headers: z.object({
        'Idempotency-Key': z.string().min(8).max(128),
      }),
      body: {
        content: {
          'application/json': {
            schema: CreateIncidentRequestSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Incident record created',
        headers: z.object({
          ETag: z.string().optional(),
          'Idempotent-Replayed': z.string().optional(),
        }),
        content: { 'application/json': { schema: IncidentRecordSchema } },
      },
      400: { description: 'Missing Idempotency-Key or Malformed Request' },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden (requires security.incident)' },
      422: { description: 'Validation error' },
    },
  });

  // API-SEC-002: Update incident assessments and notifications
  registry.registerPath({
    operationId: 'API-SEC-002',
    method: 'patch',
    path: '/v1/incidents/{id}',
    summary: 'Update incident assessments and notification timestamps (API-SEC-002)',
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      headers: z.object({
        'If-Match': z.string(),
      }),
      body: {
        content: {
          'application/json': {
            schema: UpdateIncidentRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Incident updated successfully',
        headers: z.object({
          ETag: z.string(),
        }),
        content: { 'application/json': { schema: IncidentRecordSchema } },
      },
      400: { description: 'Missing If-Match or Malformed Request' },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden (requires security.incident)' },
      404: { description: 'Incident not found' },
      409: { description: 'Version conflict (stale update) or Invalid transition' },
      422: { description: 'Validation error' },
    },
  });

  // API-SEC-003: Get single incident
  registry.registerPath({
    operationId: 'API-SEC-003',
    method: 'get',
    path: '/v1/incidents/{id}',
    summary: 'Retrieve single incident record by ID',
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Incident details',
        content: { 'application/json': { schema: IncidentRecordSchema } },
      },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden (requires security.incident)' },
      404: { description: 'Incident not found' },
    },
  });

  // API-SEC-004: List incidents
  registry.registerPath({
    operationId: 'API-SEC-004',
    method: 'get',
    path: '/v1/incidents',
    summary: 'List security incidents in the acting tenant',
    security: [{ bearerAuth: [] }],
    request: {
      query: IncidentListQuerySchema,
    },
    responses: {
      200: {
        description: 'List of security incidents',
        content: { 'application/json': { schema: IncidentListResponseSchema } },
      },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden (requires security.incident)' },
    },
  });

  // API-SEC-005: Record security event
  registry.registerPath({
    operationId: 'API-SEC-005',
    method: 'post',
    path: '/v1/security/events',
    summary: 'Record a security monitoring event (ENT-096)',
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        content: {
          'application/json': {
            schema: CreateSecurityEventRequestSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Security event recorded with sanitized details',
        content: { 'application/json': { schema: SecurityEventSchema } },
      },
      401: { description: 'Unauthenticated' },
      422: { description: 'Validation error' },
    },
  });

  // API-SEC-006: List security events
  registry.registerPath({
    operationId: 'API-SEC-006',
    method: 'get',
    path: '/v1/security/events',
    summary: 'List security monitoring events (InfoSec / Compliance authorized)',
    security: [{ bearerAuth: [] }],
    request: {
      query: SecurityEventListQuerySchema,
    },
    responses: {
      200: {
        description: 'List of security events',
        content: { 'application/json': { schema: SecurityEventListResponseSchema } },
      },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden (requires security.incident)' },
    },
  });
}
