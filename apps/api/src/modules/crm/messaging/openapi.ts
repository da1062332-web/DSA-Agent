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

export function registerOpenApi(registry: OpenAPIRegistry): void {
  registry.register('MessageTemplate', MessageTemplateSchema);
  registry.register('CreateTemplateInput', CreateTemplateSchema);
  registry.register('MessageRecord', MessageRecordSchema);
  registry.register('SendMessageInput', SendMessageSchema);

  registry.registerPath({
    method: 'post',
    path: '/v1/message-templates',
    summary: 'Create message template (API-MSG-001)',
    tags: ['Messaging'],
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
    summary: 'List message templates (API-MSG-002)',
    tags: ['Messaging'],
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
    path: '/v1/messages',
    summary: 'Send outbound message (API-MSG-003)',
    tags: ['Messaging'],
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
    summary: 'List messages for subject (API-MSG-004)',
    tags: ['Messaging'],
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
