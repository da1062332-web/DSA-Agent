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

export function registerOpenApi(registry: OpenAPIRegistry): void {
  registry.register('NotificationRecord', NotificationRecordSchema);
  registry.register('NotificationPreferences', NotificationPreferencesSchema);
  registry.register('UserProfile', UserProfileSchema);
  registry.register('UpdateProfilePreferencesInput', UpdateProfilePreferencesSchema);
  registry.register('MarkNotificationsReadInput', MarkNotificationsReadSchema);

  registry.registerPath({
    method: 'get',
    path: '/v1/notifications',
    summary: 'List user notifications (API-NTF-001)',
    tags: ['Notifications'],
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
    summary: 'Mark notifications as read (API-NTF-002)',
    tags: ['Notifications'],
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
    summary: 'Server-Sent Events stream for live notifications (API-NTF-003)',
    tags: ['Notifications'],
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
    method: 'get',
    path: '/v1/me',
    summary: 'Get current user profile (API-USR-010)',
    tags: ['Users'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Current user profile with preferences and ETag header',
        headers: {
          ETag: {
            schema: { type: 'string' },
            description: 'Entity lock_version for concurrency control',
          },
        },
        content: {
          'application/json': {
            schema: UserProfileSchema,
          },
        },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/v1/me',
    summary: 'Update user profile notification preferences with concurrency control (API-USR-009)',
    tags: ['Users'],
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
      412: { description: 'Precondition Failed (concurrent update detected)', content: { 'application/json': { schema: ErrorEnvelope } } },
      428: { description: 'Precondition Required (missing If-Match header)', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });
}
