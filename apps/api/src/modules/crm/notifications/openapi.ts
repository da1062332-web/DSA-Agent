// apps/api/src/modules/crm/notifications/openapi.ts — owner: Dev 1 / Dev 5
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import {
  ErrorEnvelope,
  ListNotificationsQuerySchema,
  MarkNotificationsReadSchema,
  NotificationPreferencesSchema,
  NotificationRecordSchema,
  UpdateProfilePreferencesSchema,
  UserProfileSchema,
} from '@dsa/contracts';
import { z } from 'zod';

export const tags = [
  { name: 'MOD-NTF Notifications', description: 'Notifications and user preferences (MOD-NTF).' },
  { name: 'MOD-USR Users', description: 'User profile preferences (MOD-USR).' },
];

export function registerOpenApi(registry: OpenAPIRegistry): void {
  registry.register('NotificationRecord', NotificationRecordSchema);
  registry.register('NotificationPreferences', NotificationPreferencesSchema);
  registry.register('UserProfile', UserProfileSchema);
  registry.register('UpdateProfilePreferencesInput', UpdateProfilePreferencesSchema);
  registry.register('MarkNotificationsReadInput', MarkNotificationsReadSchema);

  registry.registerPath({
    method: 'get',
    path: '/v1/notifications',
    operationId: 'API-NTF-001',
    summary: 'List user notifications (API-NTF-001)',
    tags: ['MOD-NTF Notifications'],
    security: [{ bearerAuth: [] }],
    request: {
      query: ListNotificationsQuerySchema,
    },
    responses: {
      200: {
        description: 'Paginated list of notifications',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(NotificationRecordSchema),
              meta: z.object({
                nextCursor: z.string().nullable(),
                limit: z.number(),
                unreadCount: z.number(),
              }),
            }),
          },
        },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/notifications/read',
    operationId: 'API-NTF-002',
    summary: 'Mark notifications as read (API-NTF-002)',
    tags: ['MOD-NTF Notifications'],
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        content: {
          'application/json': {
            schema: MarkNotificationsReadSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Notifications marked as read',
        content: {
          'application/json': {
            schema: z.object({
              newlyMarkedRead: z.number(),
              readAt: z.string().datetime(),
            }),
          },
        },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/notifications/stream',
    operationId: 'API-NTF-003',
    summary: 'Server-Sent Events stream for live notifications (API-NTF-003)',
    tags: ['MOD-NTF Notifications'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'SSE stream (text/event-stream)',
        content: {
          'text/event-stream': {
            schema: z.string().describe('Stream of SSE events'),
          },
        },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/v1/me',
    operationId: 'API-USR-009',
    summary: 'Update user profile notification preferences with concurrency control (API-USR-009)',
    tags: ['MOD-USR Users'],
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'If-Match',
        in: 'header',
        required: true,
        schema: { type: 'string' },
        description: 'Expected lock_version for optimistic concurrency control',
      },
    ],
    request: {
      body: {
        content: {
          'application/json': {
            schema: UpdateProfilePreferencesSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Updated user profile',
        headers: {
          ETag: {
            schema: { type: 'string' },
            description: 'Updated lock_version',
          },
        },
        content: {
          'application/json': {
            schema: UserProfileSchema,
          },
        },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      412: {
        description: 'Precondition Failed (concurrent update detected)',
        content: { 'application/json': { schema: ErrorEnvelope } },
      },
      428: {
        description: 'Precondition Required (missing If-Match header)',
        content: { 'application/json': { schema: ErrorEnvelope } },
      },
    },
  });
}
