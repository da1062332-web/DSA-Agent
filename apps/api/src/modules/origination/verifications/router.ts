// apps/api/src/modules/origination/verifications/router.ts
// Module 22: Verification (MOD-VER) — Express router
import { Router, type Request, type Response } from 'express';
import {
  AppError,
  CreateVerificationSchema,
  ListVerificationsQuerySchema,
  RunVerificationCheckSchema,
  type RequestContext,
} from '@dsa/contracts';
import type { ApiDeps } from '../../types';
import { createCreditReportRouter } from './credit-report-router';
import { readIdempotencyKey } from './idempotency-key';
import { VerificationService } from './verification-service';

export function createRouter(deps: ApiDeps, serviceOverride?: VerificationService): Router {
  const router = Router();
  const service = serviceOverride ?? new VerificationService(deps);

  /**
   * API-VER-001: POST /v1/verifications
   */
  router.post('/verifications', async (req: Request, res: Response, next) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) throw AppError.of('UNAUTHENTICATED', 'Authentication required.');
      deps.authz.requirePermission(ctx, 'verification.perform');

      const idempotencyKey = readIdempotencyKey(req);

      const input = CreateVerificationSchema.parse(req.body);
      const { verification, isReplayed } = await service.createVerification(ctx, input, idempotencyKey);

      res.setHeader('ETag', `"${verification.lockVersion}"`);
      if (isReplayed) res.setHeader('Idempotent-Replayed', 'true');
      res.status(isReplayed ? 200 : 201).json(verification);
    } catch (err) {
      next(err);
    }
  });

  /**
   * API-VER-003: POST /v1/verifications/checks
   * The server runs a PAN, GST or bank-account (Rs 1 penny drop) check at the tenant's provider and stores the result. The caller
   * never states the result.
   */
  router.post('/verifications/checks', async (req: Request, res: Response, next) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) throw AppError.of('UNAUTHENTICATED', 'Authentication required.');
      deps.authz.requirePermission(ctx, 'verification.perform');

      const idempotencyKey = readIdempotencyKey(req);
      const input = RunVerificationCheckSchema.parse(req.body);
      const { verification, isReplayed } = await service.runCheck(ctx, input, idempotencyKey);

      res.setHeader('ETag', `"${verification.lockVersion}"`);
      if (isReplayed) res.setHeader('Idempotent-Replayed', 'true');
      res.status(isReplayed ? 200 : 201).json(verification);
    } catch (err) {
      next(err);
    }
  });

  /**
   * API-VER-002: GET /v1/verifications
   */
  router.get('/verifications', async (req: Request, res: Response, next) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) throw AppError.of('UNAUTHENTICATED', 'Authentication required.');
      deps.authz.requirePermission(ctx, 'verification.read');

      const query = ListVerificationsQuerySchema.parse(req.query);
      const result = await service.listVerifications(ctx, query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Helper: GET /v1/verifications/:id
   */
  router.get('/verifications/:id', async (req: Request, res: Response, next) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) throw AppError.of('UNAUTHENTICATED', 'Authentication required.');
      deps.authz.requirePermission(ctx, 'verification.read');

      const id = String(req.params.id ?? '');
      const result = await service.getVerificationById(ctx, id);
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // P1-05: the credit-bureau soft pull (API-CRP-001 to 003).
  router.use(createCreditReportRouter(deps));

  return router;
}
