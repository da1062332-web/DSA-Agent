// apps/api/src/modules/crm/workforce/router.ts — Module 26: Workforce router (attendance). Capacity, availability and delegations were removed with task P0-02.
import { AppError } from '@dsa/contracts';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireCtx } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { SqlWorkforceRepository, type WorkforceRepository } from './repository';
import { WorkforceService } from './service';
import { CheckInInputSchema, CheckOutInputSchema } from './types';

export function createRouter(deps: ApiDeps): Router {
  const router = Router();
  const repository = (deps.workforceRepository as WorkforceRepository) ?? new SqlWorkforceRepository();
  const service = new WorkforceService({ repository });

  const toDetails = (issues: any[]) =>
    issues.map((i) => ({ field: i.path?.join('.'), issue: i.message || 'INVALID' }));

  // 7. POST /v1/attendance/check-in — Check-in
  router.post('/attendance/check-in', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = requireCtx(req);
      const parsed = CheckInInputSchema.safeParse(req.body || {});
      if (!parsed.success) {
        throw AppError.of('VALIDATION_ERROR', 'Invalid check-in input', toDetails(parsed.error.issues));
      }

      const record = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.checkIn(tx, ctx, parsed.data.notes);
      });

      return res.status(201).json(record);
    } catch (err) {
      next(err);
    }
  });

  // 8. POST /v1/attendance/check-out — Check-out
  router.post('/attendance/check-out', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = requireCtx(req);
      const parsed = CheckOutInputSchema.safeParse(req.body || {});
      if (!parsed.success) {
        throw AppError.of('VALIDATION_ERROR', 'Invalid check-out input', toDetails(parsed.error.issues));
      }

      const record = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.checkOut(tx, ctx, parsed.data.notes);
      });

      return res.status(200).json(record);
    } catch (err) {
      next(err);
    }
  });

  // 9. GET /v1/attendance/me/today — Current user today's attendance status
  router.get('/attendance/me/today', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = requireCtx(req);
      const record = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.getMyTodayAttendance(tx, ctx);
      });

      return res.status(200).json({ attendance: record });
    } catch (err) {
      next(err);
    }
  });

  // 10. GET /v1/attendance — List attendance records
  router.get('/attendance', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = requireCtx(req);
      const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
      const date = typeof req.query.date === 'string' ? req.query.date : undefined;
      const fromDate = typeof req.query.fromDate === 'string' ? req.query.fromDate : undefined;
      const toDate = typeof req.query.toDate === 'string' ? req.query.toDate : undefined;

      const records = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.listAttendance(tx, ctx, { userId, date, fromDate, toDate });
      });

      return res.status(200).json({ records });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
