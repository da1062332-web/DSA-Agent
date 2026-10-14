// apps/api/src/modules/compliance/router.ts
// Module: compliance — owner: Dev 5 (MOD-PRV Privacy and Consent: SUB-PRV.01 to SUB-PRV.05)
import { Router, type Request, type Response } from 'express';
import {
  AppError,
  ListDataSharingRecordsQuerySchema,
  VerifyConsentInputSchema,
  type RequestContext,
} from '@dsa/contracts';
import type { ApiDeps } from '../types';
import { ComplianceService } from './compliance-service';
import { PostgresDataSharingPort } from './data-sharing-port';

export { PostgresDataSharingPort, ComplianceService };

export function createRouter(deps: ApiDeps, serviceOverride?: ComplianceService): Router {
  const router = Router();
  const service = serviceOverride ?? new ComplianceService(deps);

  /**
   * Helper to extract authenticated request context
   */
  const getContext = (req: Request): RequestContext => {
    const ctx = req.ctx as RequestContext | undefined;
    if (!ctx || !ctx.principal) {
      throw AppError.of('UNAUTHENTICATED', 'Authentication required.');
    }
    return ctx;
  };

  /**
   * GET /v1/compliance/data-sharing-records & /v1/privacy/data-sharing-records
   * SUB-PRV.05 Data-Sharing Inventory audit query
   */
  const handleListDataSharing = async (req: Request, res: Response, next: (err?: unknown) => void) => {
    try {
      const ctx = getContext(req);
      const query = ListDataSharingRecordsQuerySchema.parse(req.query);
      const result = await service.listDataSharingRecords(ctx, query);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  router.get('/compliance/data-sharing-records', handleListDataSharing);
  router.get('/privacy/data-sharing-records', handleListDataSharing);

  /**
   * GET /v1/compliance/stats & /v1/privacy/stats
   * Privacy governance and consent metric statistics
   */
  const handleGetStats = async (req: Request, res: Response, next: (err?: unknown) => void) => {
    try {
      const ctx = getContext(req);
      const stats = await service.getPrivacyStats(ctx);
      res.json(stats);
    } catch (err) {
      next(err);
    }
  };

  router.get('/compliance/stats', handleGetStats);
  router.get('/privacy/stats', handleGetStats);

  /**
   * POST /v1/compliance/consent-check & /v1/privacy/consent-check
   * Consent verification for a given subject (Customer or Lead) and purpose (SUB-PRV.01)
   */
  const handleConsentCheck = async (req: Request, res: Response, next: (err?: unknown) => void) => {
    try {
      const ctx = getContext(req);
      const input = VerifyConsentInputSchema.parse(req.body);
      const result = await service.verifyConsent(ctx, input);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  router.post('/compliance/consent-check', handleConsentCheck);
  router.post('/privacy/consent-check', handleConsentCheck);

  return router;
}
