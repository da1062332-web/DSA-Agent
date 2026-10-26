// apps/api/src/modules/crm/messaging/openapi.ts — owner: Dev 1 / Dev 5
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import {
  CreateTemplateSchema,
  ErrorEnvelope,
  ListMessagesQuerySchema,
  ListTemplatesQuerySchema,
  MessageRecordSchema,
  MessageTemplateSchema,
  SendMessageSchema,
} from '@dsa/contracts';
import { z } from 'zod';

export const tags = [
  { name: 'MOD-MSG Messaging', description: 'Templates, outbox, and delivery status (MOD-MSG).' },
];

export function registerOpenApi(registry: OpenAPIRegistry): void {
  registry.register('MessageTemplate', MessageTemplateSchema);
  registry.register('CreateTemplateInput', CreateTemplateSchema);
  registry.register('MessageRecord', MessageRecordSchema);
  registry.register('SendMessageInput', SendMessageSchema);

  registry.registerPath({
    method: 'post',
    path: '/v1/message-templates',
    operationId: 'API-MSG-001',
    summary: 'Create message template (API-MSG-001)',
    tags: ['MOD-MSG Messaging'],
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,128}$' },
      },
    ],
    request: {
      body: {
        content: {
          'application/json': {
            schema: CreateTemplateSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Template created',
        content: { 'application/json': { schema: MessageTemplateSchema } },
      },
      200: {
        description: 'Idempotent replay of template',
        content: { 'application/json': { schema: MessageTemplateSchema } },
      },
      400: { description: 'Bad request', content: { 'application/json': { schema: ErrorEnvelope } } },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/message-templates',
    operationId: 'API-MSG-002',
    summary: 'List message templates (API-MSG-002)',
    tags: ['MOD-MSG Messaging'],
    security: [{ bearerAuth: [] }],
    request: {
      query: ListTemplatesQuerySchema,
    },
    responses: {
      200: {
        description: 'Templates list',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(MessageTemplateSchema),
              meta: z.object({
                nextCursor: z.string().nullable(),
                limit: z.number().int(),
              }),
            }),
          },
        },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/message-templates/{id}/approval',
    operationId: 'API-MSG-004',
    summary: 'Approve a draft message template (a different person from its author; API-MSG-004)',
    tags: ['MOD-MSG Messaging'],
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'Template approved' },
      400: { description: 'Invalid state (not a draft)', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Separation of duties or permission', content: { 'application/json': { schema: ErrorEnvelope } } },
      404: { description: 'Template not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/messages/{id}/simulate-delivery',
    operationId: 'API-MSG-005',
    summary: 'Give a SIMULATED message a test delivery result (test environments only; API-MSG-005)',
    tags: ['MOD-MSG Messaging'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: z.object({ outcome: z.enum(['DELIVERED', 'UNDELIVERED']) }) } } },
    },
    responses: {
      200: { description: 'Delivery result recorded' },
      400: { description: 'Not a simulated message, or not in SENT state', content: { 'application/json': { schema: ErrorEnvelope } } },
      404: { description: 'Message not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/messages',
    operationId: 'API-MSG-003',
    summary: 'Send outbound message (API-MSG-003)',
    tags: ['MOD-MSG Messaging'],
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,128}$' },
      },
    ],
    request: {
      body: {
        content: {
          'application/json': {
            schema: SendMessageSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Message sent / queued',
        content: { 'application/json': { schema: MessageRecordSchema } },
      },
      200: {
        description: 'Idempotent replay',
        content: { 'application/json': { schema: MessageRecordSchema } },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: {
        description: 'Send blocked by eligibility guard or validation error',
        content: { 'application/json': { schema: ErrorEnvelope } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/messages',
    operationId: 'API-MSG-004',
    summary: 'List messages for subject (API-MSG-004)',
    tags: ['MOD-MSG Messaging'],
    security: [{ bearerAuth: [] }],
    request: {
      query: ListMessagesQuerySchema,
    },
    responses: {
      200: {
        description: 'Messages list',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(MessageRecordSchema),
              meta: z.object({
                nextCursor: z.string().nullable(),
                limit: z.number().int(),
              }),
            }),
          },
        },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });
}
