// apps/api/src/modules/origination/verifications/credit-report-router.ts
// Module 22: Verification (MOD-VER) — the credit-bureau soft pull routes (P1-05), mounted from the verifications router.
//   API-CRP-001  POST /v1/customers/{id}/credit-reports          pull a report (or return the one under 24 hours old)
//   API-CRP-002  GET  /v1/customers/{id}/credit-reports/latest   the newest report
//   API-CRP-003  GET  /v1/customers/{id}/credit-reports          the history, newest first
import { Router, type Request, type Response } from 'express';
import {
  AppError,
  LatestCreditReportQuerySchema,
  ListCreditReportsQuerySchema,
  PullCreditReportSchema,
  type RequestContext,
} from '@dsa/contracts';
import type { ApiDeps } from '../../types';
import { CreditReportService } from './credit-report-service';
import { readIdempotencyKey } from './idempotency-key';

/** The customer id of the path. A value that cannot be an id is a 404 like any unknown customer, and is never echoed. */
function customerIdOf(req: Request): string {
  const id = String(req.params.id ?? '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw AppError.of('NOT_FOUND', 'Customer not found.');
  return id;
}

function contextOf(req: Request): RequestContext {
  const ctx = req.ctx as RequestContext | undefined;
  if (!ctx || !ctx.principal) throw AppError.of('UNAUTHENTICATED', 'Authentication required.');
  return ctx;
}

export function createCreditReportRouter(deps: ApiDeps, serviceOverride?: CreditReportService): Router {
  const router = Router();
  const service = serviceOverride ?? new CreditReportService(deps);

  // API-CRP-001. The permission comes first, then the shape of the id, the Idempotency-Key and the body.
  router.post('/customers/:id/credit-reports', async (req: Request, res: Response, next) => {
    try {
      const ctx = contextOf(req);
      deps.authz.requirePermission(ctx, 'credit_report.pull');
      const customerId = customerIdOf(req);
      const idempotencyKey = readIdempotencyKey(req);
      const input = PullCreditReportSchema.parse(req.body);

      const { report, cached, isReplayed } = await service.pull(ctx, customerId, input, idempotencyKey);

      res.setHeader('ETag', `"${report.lockVersion}"`);
      if (cached) res.setHeader('X-Credit-Report-Cache', 'HIT');
      if (isReplayed) res.setHeader('Idempotent-Replayed', 'true');
      // 201 for a new report; 200 for a cached one and for a replay of an earlier request.
      res.status(cached || isReplayed ? 200 : 201).json(report);
    } catch (err) {
      next(err);
    }
  });

  // API-CRP-002 (registered before the list: "latest" is not an id).
  router.get('/customers/:id/credit-reports/latest', async (req: Request, res: Response, next) => {
    try {
      const ctx = contextOf(req);
      deps.authz.requirePermission(ctx, 'credit_report.read');
      const customerId = customerIdOf(req);
      const query = LatestCreditReportQuerySchema.parse(req.query);

      const report = await service.latest(ctx, customerId, query);

      res.setHeader('ETag', `"${report.lockVersion}"`);
      res.status(200).json(report);
    } catch (err) {
      next(err);
    }
  });

  // API-CRP-003
  router.get('/customers/:id/credit-reports', async (req: Request, res: Response, next) => {
    try {
      const ctx = contextOf(req);
      deps.authz.requirePermission(ctx, 'credit_report.read');
      const customerId = customerIdOf(req);
      const query = ListCreditReportsQuerySchema.parse(req.query);

      res.status(200).json(await service.list(ctx, customerId, query));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
