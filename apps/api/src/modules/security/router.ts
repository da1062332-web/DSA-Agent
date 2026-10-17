// apps/api/src/modules/security/router.ts — Module 39: Security (MOD-SEC)
import {
  AppError,
  CreateIncidentRequestSchema,
  CreateSecurityEventRequestSchema,
  IncidentListQuerySchema,
  SecurityEventListQuerySchema,
  UpdateIncidentRequestSchema,
} from '@dsa/contracts';
import { Router } from 'express';
import { idempotencyKey, ifMatchVersion, requireCtx, sendResource } from '../../http/request';
import type { ApiDeps } from '../types';
import { SecurityService } from './service';

export function createRouter(deps: ApiDeps): Router {
  const router = Router();
  const service = new SecurityService(deps);

  // ==========================================================================
  // SUB-SEC.01: Security Events (ENT-096)
  // ==========================================================================

  /**
   * POST /v1/security/events
   * Record security monitoring event with automatic credential/secret redaction.
   */
  router.post('/security/events', async (req, res, next) => {
    try {
      const ctx = requireCtx(req);
      const parsed = CreateSecurityEventRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.of(
          'VALIDATION_ERROR',
          'Invalid security event request body.',
          parsed.error.issues.map((i) => ({ field: i.path.join('.'), issue: i.message })),
        );
      }

      const event = await service.recordSecurityEvent(ctx, parsed.data);
      res.status(201).json(event);
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /v1/security/events
   * List security events in the acting tenant (restricted to InfoSec / Compliance).
   */
  router.get('/security/events', async (req, res, next) => {
    try {
      const ctx = requireCtx(req);
      deps.authz.requirePermission(ctx, 'security.incident');

      const parsedQuery = SecurityEventListQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        throw AppError.of(
          'VALIDATION_ERROR',
          'Invalid security event query parameters.',
          parsedQuery.error.issues.map((i) => ({ field: i.path.join('.'), issue: i.message })),
        );
      }

      const result = await service.listSecurityEvents(ctx, parsedQuery.data);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================================================
  // SUB-SEC.02: Incident and Breach Management (ENT-102)
  // ==========================================================================

  /**
   * API-SEC-001: POST /v1/incidents
   * Record a security incident (Idempotency-Key required).
   */
  router.post('/incidents', async (req, res, next) => {
    try {
      const ctx = requireCtx(req);
      deps.authz.requirePermission(ctx, 'security.incident');
      const idemKey = idempotencyKey(req);

      const parsed = CreateIncidentRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.of(
          'VALIDATION_ERROR',
          'Invalid incident creation request body.',
          parsed.error.issues.map((i) => ({ field: i.path.join('.'), issue: i.message })),
        );
      }

      const result = await service.createIncident(ctx, parsed.data, idemKey);
      sendResource(res, result.status, { ...result.body, version: result.body.lockVersion }, result.replayed);
    } catch (err) {
      next(err);
    }
  });

  /**
   * API-SEC-002: PATCH /v1/incidents/:id
   * Update incident assessment and notification timestamps (If-Match required).
   */
  router.patch('/incidents/:id', async (req, res, next) => {
    try {
      const ctx = requireCtx(req);
      deps.authz.requirePermission(ctx, 'security.incident');
      const expectedVersion = ifMatchVersion(req);

      const parsed = UpdateIncidentRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.of(
          'VALIDATION_ERROR',
          'Invalid incident update request body.',
          parsed.error.issues.map((i) => ({ field: i.path.join('.'), issue: i.message })),
        );
      }

      const updated = await service.updateIncident(ctx, req.params.id, parsed.data, expectedVersion);
      sendResource(res, 200, { ...updated, version: updated.lockVersion });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /v1/incidents/:id
   * Fetch single incident record by ID.
   */
  router.get('/incidents/:id', async (req, res, next) => {
    try {
      const ctx = requireCtx(req);
      deps.authz.requirePermission(ctx, 'security.incident');

      const incident = await service.getIncident(ctx, req.params.id);
      sendResource(res, 200, { ...incident, version: incident.lockVersion });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /v1/incidents
   * Query incidents list in the acting tenant.
   */
  router.get('/incidents', async (req, res, next) => {
    try {
      const ctx = requireCtx(req);
      deps.authz.requirePermission(ctx, 'security.incident');

      const parsedQuery = IncidentListQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        throw AppError.of(
          'VALIDATION_ERROR',
          'Invalid incident list query parameters.',
          parsedQuery.error.issues.map((i) => ({ field: i.path.join('.'), issue: i.message })),
        );
      }

      const list = await service.listIncidents(ctx, parsedQuery.data);
      res.status(200).json(list);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
