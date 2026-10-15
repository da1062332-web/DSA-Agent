// apps/api/src/modules/crm/workforce/router.ts — Module 26: Workforce router
import { AppError } from '@dsa/contracts';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireCtx } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { SqlWorkforceRepository, type WorkforceRepository } from './repository';
import { WorkforceService } from './service';
import {
  CheckInInputSchema,
  CheckOutInputSchema,
  CreateDelegationInputSchema,
  UpdateAvailabilityInputSchema,
  UpdateCapacityInputSchema,
} from './types';

export function createRouter(deps: ApiDeps): Router {
  const router = Router();
  const repository = (deps.workforceRepository as WorkforceRepository) ?? new SqlWorkforceRepository();
  const service = new WorkforceService({ repository });

  const toDetails = (issues: any[]) =>
    issues.map((i) => ({ field: i.path?.join('.'), issue: i.message || 'INVALID' }));

  // 1. API-USR-009: PATCH /v1/me and PATCH /v1/me/availability — Availability toggle (self)
  const handleAvailabilityToggle = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = requireCtx(req);
      const parsed = UpdateAvailabilityInputSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.of('VALIDATION_ERROR', 'Invalid availability status', toDetails(parsed.error.issues));
      }

      const ifMatch = req.header('If-Match');
      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.updateMyAvailability(tx, ctx, ifMatch, parsed.data.availability);
      });

      res.setHeader('ETag', result.etag);
      return res.status(200).json(result.user);
    } catch (err) {
      next(err);
    }
  };

  router.patch('/me/availability', handleAvailabilityToggle);
  router.patch('/me', handleAvailabilityToggle);

  // 2. GET /v1/workforce/agents — Agent capacity and availability overview
  router.get('/workforce/agents', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = requireCtx(req);
      const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;

      const agents = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.listWorkforceAgents(tx, ctx, branchId);
      });

      return res.status(200).json({ agents });
    } catch (err) {
      next(err);
    }
  });

  // 3. PATCH /v1/workforce/agents/:id/capacity — Update capacity limit
  router.patch('/workforce/agents/:id/capacity', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = requireCtx(req);
      const targetUserId = String(req.params.id);
      const parsed = UpdateCapacityInputSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.of(
          'VALIDATION_ERROR',
          'Invalid capacity value. Must be integer between 0 and 100',
          toDetails(parsed.error.issues),
        );
      }

      const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.updateAgentCapacity(tx, ctx, targetUserId, parsed.data.capacity);
      });

      res.setHeader('ETag', result.etag);
      return res.status(200).json(result.user);
    } catch (err) {
      next(err);
    }
  });

  // 4. API-WRK-001: POST /v1/delegations — Start leave coverage delegation
  router.post('/delegations', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = requireCtx(req);
      const parsed = CreateDelegationInputSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.of('VALIDATION_ERROR', 'Invalid delegation input', toDetails(parsed.error.issues));
      }

      const delegation = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.createDelegation(tx, ctx, parsed.data);
      });

      res.setHeader('ETag', `"${delegation.lockVersion}"`);
      return res.status(201).json(delegation);
    } catch (err) {
      next(err);
    }
  });

  // 5. API-WRK-002: POST /v1/delegations/:id/end — End leave coverage delegation
  router.post('/delegations/:id/end', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = requireCtx(req);
      const delegationId = String(req.params.id);

      const delegation = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.endDelegation(tx, ctx, delegationId);
      });

      res.setHeader('ETag', `"${delegation.lockVersion}"`);
      return res.status(200).json(delegation);
    } catch (err) {
      next(err);
    }
  });

  // 6. GET /v1/delegations — List delegations
  router.get('/delegations', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = requireCtx(req);
      const delegatorId = typeof req.query.delegatorId === 'string' ? req.query.delegatorId : undefined;
      const delegateId = typeof req.query.delegateId === 'string' ? req.query.delegateId : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;

      const delegations = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        return service.listDelegations(tx, ctx, { delegatorId, delegateId, status });
      });

      return res.status(200).json({ delegations });
    } catch (err) {
      next(err);
    }
  });

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
