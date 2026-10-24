// apps/api/src/modules/crm/notifications/router.ts — owner: Dev 1 / Dev 5
// Module: crm/notifications (MOD-NTF)
// APIs:
//   API-NTF-001: GET /v1/notifications
//   API-NTF-002: POST /v1/notifications/read
//   API-NTF-003: GET /v1/notifications/stream
//   API-USR-010: GET /v1/me
//   API-USR-009: PATCH /v1/me
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  AppError,
  ListNotificationsQuerySchema,
  MarkNotificationsReadSchema,
  UpdateProfilePreferencesSchema,
  type RequestContext,
} from '@dsa/contracts';
import type { ApiDeps } from '../../types';
import { NotificationService } from './notification-service';
import { NotificationStreamHub } from './stream-hub';

export function createRouter(
  deps: ApiDeps,
  serviceOverride?: NotificationService,
  streamHubOverride?: NotificationStreamHub,
): Router {
  const router = Router();
  const notificationService = serviceOverride ?? new NotificationService(deps.txRunner);
  const streamHub = streamHubOverride ?? NotificationStreamHub.getInstance();

  /**
   * API-NTF-001: List notifications for authenticated user
   * GET /v1/notifications
   */
  router.get('/notifications', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) {
        throw AppError.of('UNAUTHENTICATED', 'Authentication required');
      }

      const query = ListNotificationsQuerySchema.parse(req.query);
      const result = await notificationService.listNotifications(ctx, query);

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * API-NTF-002: Mark notifications as read
   * POST /v1/notifications/read
   */
  router.post('/notifications/read', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) {
        throw AppError.of('UNAUTHENTICATED', 'Authentication required');
      }

      // Gracefully handle empty notificationIds without failing schema validation
      if (Array.isArray(req.body?.notificationIds) && req.body.notificationIds.length === 0) {
        res.status(200).json({
          newlyMarkedRead: 0,
          readAt: ctx.now.toISOString(),
        });
        return;
      }

      // Normalize IDs: handle bare ULIDs, trim, and uppercase ULID portion where applicable
      const rawIds = Array.isArray(req.body?.notificationIds)
        ? req.body.notificationIds.map((id: unknown) => {
            if (typeof id !== 'string') return id;
            const trimmed = id.trim();
            if (/^[0-9A-Za-z]{26}$/.test(trimmed)) {
              return `ntf_${trimmed.toUpperCase()}`;
            }
            if (trimmed.toLowerCase().startsWith('ntf_') && trimmed.length === 30) {
              return `ntf_${trimmed.slice(4).toUpperCase()}`;
            }
            return trimmed;
          })
        : req.body?.notificationIds;

      const input = MarkNotificationsReadSchema.parse({
        ...req.body,
        notificationIds: rawIds,
      });
      const result = await notificationService.markAsRead(ctx, input);

      res.status(200).json({
        newlyMarkedRead: result.updatedCount,
        readAt: ctx.now.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * API-NTF-003: Live notification stream (SSE)
   * GET /v1/notifications/stream
   */
  router.get('/notifications/stream', (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) {
        throw AppError.of('UNAUTHENTICATED', 'Authentication required');
      }

      const tenantId = ctx.principal.tenantId;
      const userId = ctx.principal.id;

      // Server-Sent Events headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      // Send initial comment/ping to establish connection
      res.write(': connected\n\n');

      // Register client connection with stream hub
      const unregister = streamHub.registerClient(tenantId, userId, res);

      // Clean up when client disconnects
      req.on('close', () => {
        unregister();
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * API-USR-009: Update user profile preferences (with If-Match concurrency)
   * PATCH /v1/me
   */
  router.patch('/me', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) {
        throw AppError.of('UNAUTHENTICATED', 'Authentication required');
      }

      // API-USR-009 is one resource. Preferences are handled here; availability by the workforce module (next handler).
      // A body with both would lose one of them, so it is refused rather than half-applied.
      const hasPref = Boolean(req.body?.notificationPreferences || req.body?.preferences);
      if (!hasPref) {
        return next();
      }
      if (req.body && 'availability' in req.body) {
        throw AppError.of('VALIDATION_ERROR', 'Update preferences and availability in separate requests.', [
          { field: 'availability', issue: 'NOT_ALLOWED_WITH_PREFERENCES' },
        ]);
      }

      const ifMatch = req.get('If-Match');
      if (!ifMatch) {
        throw AppError.of(
          'VALIDATION_ERROR',
          'If-Match header is required for updating profile preferences',
          [{ field: 'If-Match', issue: 'REQUIRED' }],
        );
      }

      const input = UpdateProfilePreferencesSchema.parse(req.body);
      const preferences = input.notificationPreferences ?? input.preferences!;
      const { profile, lockVersion } = await notificationService.updatePreferences(ctx, preferences, ifMatch);

      res.setHeader('ETag', `"${lockVersion}"`);
      res.status(200).json(profile);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
