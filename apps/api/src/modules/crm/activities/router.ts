// apps/api/src/modules/crm/activities/router.ts — owner: Dev 1 / Dev 5
// Module: crm/activities (MOD-ACT)
// APIs:
//   API-ACT-001: POST /v1/activities (interaction logging)
//   API-ACT-002: PATCH /v1/activities/:id (update or hide)
//   GET /v1/activities/:id
//   GET /v1/activities (a subject's activities, or without a subject the caller's own)
//   API-ACT-003: GET /v1/timeline?subjectType=&subjectId= (the subject's activity timeline; read permission on the subject)
// Free-text fields reject PAN/Aadhaar/account-number patterns (Contracts §12).
import { Router, type Request } from 'express';
import {
  AppError,
  CreateActivitySchema,
  UpdateActivitySchema,
  SUBJECT_TYPES,
  type SubjectType,
  type RequestContext,
} from '@dsa/contracts';
import type { ApiDeps } from '../../types';
import { ActivityService, type ActivityFilter } from './activity-service';

export function createRouter(deps: ApiDeps): Router {
  const router = Router();
  const activityService = new ActivityService(deps.txRunner, deps.audit);

  /**
   * API-ACT-001 — Create Activity
   * POST /v1/activities
   */
  router.post('/activities', async (req, res, next) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) {
        throw AppError.of('UNAUTHENTICATED', 'Authentication required');
      }

      const idempotencyKey = req.get('Idempotency-Key');
      if (!idempotencyKey) {
        throw AppError.of('VALIDATION_ERROR', 'Idempotency-Key header is required for creating activities', [
          { field: 'Idempotency-Key', issue: 'REQUIRED' },
        ]);
      }
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) {
        throw AppError.of('VALIDATION_ERROR', 'Invalid Idempotency-Key format', [
          { field: 'Idempotency-Key', issue: 'INVALID_FORMAT' },
        ]);
      }

      const parsedBody = CreateActivitySchema.parse(req.body);

      const { activity, isReplayed } = await activityService.createActivity(ctx, parsedBody, idempotencyKey);

      res.setHeader('ETag', `"${activity.lockVersion}"`);
      if (isReplayed) {
        res.setHeader('Idempotent-Replayed', 'true');
        res.status(200).json(activity);
      } else {
        res.status(201).json(activity);
      }
    } catch (err) {
      next(err);
    }
  });

  /**
   * API-ACT-002 — Update or Hide Activity
   * PATCH /v1/activities/:id
   */
  router.patch('/activities/:id', async (req, res, next) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) {
        throw AppError.of('UNAUTHENTICATED', 'Authentication required');
      }

      const ifMatch = req.get('If-Match');
      if (!ifMatch) {
        throw AppError.of('VALIDATION_ERROR', 'If-Match header is required for updates', [
          { field: 'If-Match', issue: 'REQUIRED' },
        ]);
      }

      const parsedBody = UpdateActivitySchema.parse(req.body);

      const updated = await activityService.updateActivity(ctx, req.params.id, parsedBody, ifMatch);

      res.setHeader('ETag', `"${updated.lockVersion}"`);
      res.status(200).json(updated);
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /v1/activities/:id
   */
  router.get('/activities/:id', async (req, res, next) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) {
        throw AppError.of('UNAUTHENTICATED', 'Authentication required');
      }

      const activity = await activityService.getActivity(ctx, req.params.id);

      res.setHeader('ETag', `"${activity.lockVersion}"`);
      res.status(200).json(activity);
    } catch (err) {
      next(err);
    }
  });

  const listQuery = (req: Request): ActivityFilter => {
    const raw = req.query;
    const subjectType = typeof raw.subjectType === 'string' ? raw.subjectType : undefined;
    if (subjectType !== undefined && !SUBJECT_TYPES.includes(subjectType as SubjectType)) {
      throw AppError.of('VALIDATION_ERROR', 'Unknown subjectType.', [{ field: 'subjectType', issue: 'INVALID' }]);
    }
    const limitRaw = typeof raw.limit === 'string' ? raw.limit : undefined;
    if (limitRaw !== undefined && !/^\d{1,3}$/.test(limitRaw)) {
      throw AppError.of('VALIDATION_ERROR', 'limit must be an integer from 1 to 200.', [
        { field: 'limit', issue: 'INVALID' },
      ]);
    }
    return {
      subjectType: subjectType as SubjectType | undefined,
      subjectId: typeof raw.subjectId === 'string' ? raw.subjectId : undefined,
      limit: limitRaw !== undefined ? Number(limitRaw) : undefined,
      cursor: typeof raw.cursor === 'string' ? raw.cursor : undefined,
    };
  };

  /**
   * GET /v1/activities
   */
  router.get('/activities', async (req, res, next) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) {
        throw AppError.of('UNAUTHENTICATED', 'Authentication required');
      }
      res.status(200).json(await activityService.listActivities(ctx, listQuery(req)));
    } catch (err) {
      next(err);
    }
  });

  /**
   * API-ACT-003: GET /v1/timeline — the subject's timeline. The subject is required.
   */
  router.get('/timeline', async (req, res, next) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) {
        throw AppError.of('UNAUTHENTICATED', 'Authentication required');
      }
      const filter = listQuery(req);
      if (!filter.subjectType || !filter.subjectId) {
        throw AppError.of('VALIDATION_ERROR', 'subjectType and subjectId are required.', [
          { field: filter.subjectType ? 'subjectId' : 'subjectType', issue: 'REQUIRED' },
        ]);
      }
      res.status(200).json(await activityService.listActivities(ctx, filter));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
