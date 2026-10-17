// apps/api/src/modules/crm/targets/router.ts — owner: Dev 5 (MOD-PERF Targets)
import {
  AppError,
  ApproveTargetRequestSchema,
  CreateTargetRequestSchema,
  TargetListQuerySchema,
  type ApproveTargetRequest,
  type CreateTargetRequest,
  type TargetListQuery,
} from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import { Router, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { idempotencyKey, ifMatchVersion, requireCtx, sendResource } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { SqlTargetRepository, type TargetRepository } from './repository';
import { TargetService } from './service';

function handleZodError(err: ZodError): never {
  const details = err.issues.map((i) => ({
    field: i.path.join('.'),
    issue: i.message,
  }));
  throw AppError.of('VALIDATION_ERROR', 'Request validation failed', details);
}

function getParamId(req: Request, paramName = 'id'): string {
  const raw = req.params[paramName];
  if (!raw) return '';
  return Array.isArray(raw) ? raw[0]! : raw;
}

export function createRouter(deps: ApiDeps): Router {
  const repo = (deps.targetRepository as TargetRepository) ?? new SqlTargetRepository();
  const service = new TargetService(repo, deps);

  const router = Router();

  // API-PERF-001: Create Target (Idempotent)
  router.post('/targets', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const key = idempotencyKey(req);

    let input: CreateTargetRequest;
    try {
      input = CreateTargetRequestSchema.parse(req.body);
    } catch (err: unknown) {
      if (err instanceof ZodError) return handleZodError(err);
      throw err;
    }

    const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const runCreate = async () => {
        const created = await service.createTarget(tx, ctx, input);
        return {
          status: created.status,
          body: created.target,
          resourceRef: created.resourceRef,
          replayed: false,
        };
      };

      if ('executeQuery' in (tx as unknown as Record<string, unknown>)) {
        return withIdempotency(tx, ctx, { key, method: 'POST', path: '/v1/targets', body: input }, runCreate);
      }

      if (typeof repo.withIdempotencyInMemory === 'function') {
        return repo.withIdempotencyInMemory(ctx.principal.tenantId, key, input, runCreate);
      }

      return runCreate();
    });

    sendResource(
      res,
      result.status,
      result.body,
      'replayed' in result ? (result.replayed as boolean) : undefined,
    );
  });

  // API-PERF-002: List Targets
  router.get('/targets', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);

    let query: TargetListQuery;
    try {
      query = TargetListQuerySchema.parse(req.query);
    } catch (err: unknown) {
      if (err instanceof ZodError) return handleZodError(err);
      throw err;
    }

    const result = await deps.txRunner.withTenantTx(ctx, (tx) => service.listTargets(tx, ctx, query));

    res.json(result);
  });

  // API-PERF-003: Approve or Reject Target
  router.post('/targets/:id/approval', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const id = getParamId(req);
    const version = ifMatchVersion(req);

    let input: ApproveTargetRequest;
    try {
      input = ApproveTargetRequestSchema.parse(req.body);
    } catch (err: unknown) {
      if (err instanceof ZodError) return handleZodError(err);
      throw err;
    }

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      service.approveTarget(tx, ctx, id, version, input),
    );

    res.setHeader('ETag', `"${result.target.lockVersion}"`);
    res.json(result.target);
  });

  // API-PERF-004: Get Target By ID
  router.get('/targets/:id', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const id = getParamId(req);

    const target = await deps.txRunner.withTenantTx(ctx, (tx) => service.getTarget(tx, ctx, id));

    res.setHeader('ETag', `"${target.lockVersion}"`);
    res.json(target);
  });

  // API-PERF-005: Get Target Slice History
  router.get('/targets/:id/history', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const id = getParamId(req);

    const history = await deps.txRunner.withTenantTx(ctx, (tx) => service.getTargetHistory(tx, ctx, id));

    res.json(history);
  });

  return router;
}
