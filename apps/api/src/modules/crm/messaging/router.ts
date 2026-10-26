// apps/api/src/modules/crm/messaging/router.ts — owner: Dev 1 / Dev 5
// Module: crm/messaging (MOD-MSG)
// APIs:
//   API-MSG-001: POST /v1/message-templates
//   API-MSG-002: GET /v1/message-templates
//   API-MSG-003: POST /v1/messages
//   API-MSG-004: GET /v1/messages?subjectType=&subjectId=
//   API-MSG-005: POST /public/v1/webhooks/messaging/:provider/:connectionPathId
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import {
  AppError,
  CreateTemplateSchema,
  ListMessagesQuerySchema,
  ListTemplatesQuerySchema,
  SendMessageSchema,
  type RequestContext,
} from '@dsa/contracts';
import type { ApiDeps } from '../../types';
import { MessagingService } from './messaging-service';

export function createRouter(deps: ApiDeps, serviceOverride?: MessagingService): Router {
  const router = Router();
  const messagingService = serviceOverride ?? new MessagingService(deps.txRunner);

  /**
   * API-MSG-001: Create Message Template
   * POST /v1/message-templates
   */
  router.post('/message-templates', async (req, res, next) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) {
        throw AppError.of('UNAUTHENTICATED', 'Authentication required');
      }

      const hasPermission = ctx.principal.grants.some((g) => g.code === 'config.manage');
      if (!hasPermission) {
        throw AppError.of('FORBIDDEN', 'Principal requires config.manage permission to create templates');
      }

      const idempotencyKey = req.get('Idempotency-Key');
      if (!idempotencyKey) {
        throw AppError.of('VALIDATION_ERROR', 'Idempotency-Key header is required for creating templates', [
          { field: 'Idempotency-Key', issue: 'REQUIRED' },
        ]);
      }
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) {
        throw AppError.of('VALIDATION_ERROR', 'Invalid Idempotency-Key format', [
          { field: 'Idempotency-Key', issue: 'INVALID_FORMAT' },
        ]);
      }

      const parsedBody = CreateTemplateSchema.parse(req.body);
      const { template, isReplayed } = await messagingService.createTemplate(ctx, parsedBody, idempotencyKey);

      res.setHeader('ETag', `"${template.lockVersion}"`);
      if (isReplayed) {
        res.setHeader('Idempotent-Replayed', 'true');
        res.status(200).json(template);
      } else {
        res.status(201).json(template);
      }
    } catch (err) {
      next(err);
    }
  });

  /**
   * Approves a draft template. A different person from its author must do it (SOD).
   * POST /v1/message-templates/:id/approval
   */
  router.post('/message-templates/:id/approval', async (req, res, next) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) {
        throw AppError.of('UNAUTHENTICATED', 'Authentication required');
      }
      const template = await messagingService.approveTemplate(ctx, String(req.params.id));
      res.setHeader('ETag', `"${template.lockVersion}"`);
      res.status(200).json(template);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Test delivery result for a SIMULATED message (DELIVERED or UNDELIVERED). Refused for real providers.
   * POST /v1/messages/:id/simulate-delivery
   */
  router.post('/messages/:id/simulate-delivery', async (req, res, next) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) {
        throw AppError.of('UNAUTHENTICATED', 'Authentication required');
      }
      const body = z.object({ outcome: z.enum(['DELIVERED', 'UNDELIVERED']) }).parse(req.body);
      const result = await messagingService.simulateDelivery(ctx, String(req.params.id), body.outcome);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * API-MSG-002: List Message Templates
   * GET /v1/message-templates
   */
  router.get('/message-templates', async (req, res, next) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) {
        throw AppError.of('UNAUTHENTICATED', 'Authentication required');
      }

      const parsedQuery = ListTemplatesQuerySchema.parse(req.query);
      const result = await messagingService.listTemplates(ctx, parsedQuery);

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * API-MSG-003: Send Message
   * POST /v1/messages
   */
  router.post('/messages', async (req, res, next) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) {
        throw AppError.of('UNAUTHENTICATED', 'Authentication required');
      }

      const idempotencyKey = req.get('Idempotency-Key');
      if (!idempotencyKey) {
        throw AppError.of('VALIDATION_ERROR', 'Idempotency-Key header is required for sending messages', [
          { field: 'Idempotency-Key', issue: 'REQUIRED' },
        ]);
      }
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) {
        throw AppError.of('VALIDATION_ERROR', 'Invalid Idempotency-Key format', [
          { field: 'Idempotency-Key', issue: 'INVALID_FORMAT' },
        ]);
      }

      const parsedBody = SendMessageSchema.parse(req.body);
      const { message, isReplayed } = await messagingService.sendMessage(ctx, parsedBody, idempotencyKey);

      res.setHeader('ETag', `"${message.lockVersion}"`);
      if (isReplayed) {
        res.setHeader('Idempotent-Replayed', 'true');
        res.status(200).json(message);
      } else {
        res.status(201).json(message);
      }
    } catch (err) {
      next(err);
    }
  });

  /**
   * API-MSG-004: List Messages for Subject
   * GET /v1/messages?subjectType=&subjectId=
   */
  router.get('/messages', async (req, res, next) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) {
        throw AppError.of('UNAUTHENTICATED', 'Authentication required');
      }

      const parsedQuery = ListMessagesQuerySchema.parse(req.query);
      const result = await messagingService.listMessages(ctx, parsedQuery);

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // API-MSG-005 delivery callbacks (ENT-115 public_entry_index, ENT-116 dedupe) are unauthenticated and arrive only at
  // /public/v1 (createPublicMessagingRouter below): providers hold no user token, so an authenticated copy under /v1 could
  // never be called.

  return router;
}

/**
 * Public Router mounted under /public/v1 (unauthenticated provider callbacks)
 * POST /public/v1/webhooks/messaging/:provider/:connectionPathId
 */
export function createPublicMessagingRouter(deps: ApiDeps, serviceOverride?: MessagingService): Router {
  const router = Router();
  const messagingService = serviceOverride ?? new MessagingService(deps.txRunner);

  router.post('/webhooks/messaging/:provider/:connectionPathId', async (req, res, next) => {
    try {
      const provider = String(req.params.provider ?? '');
      const connectionPathId = String(req.params.connectionPathId ?? '');
      const signature = req.get('x-provider-signature');

      const result = await messagingService.handlePublicWebhook(
        provider,
        connectionPathId,
        req.body ?? {},
        signature,
      );

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
