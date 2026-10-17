// apps/api/src/modules/platform/imports/router.ts — owner: Platform Squad (MOD-IMP, TASK-413)
import {
  AppError,
  CommitImportSchema,
  ConfigureMappingSchema,
  CreateImportSchema,
  RollbackImportSchema,
} from '@dsa/contracts';
import { Router, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { requireCtx } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { ImportRepository } from './repository';
import { ImportService } from './service';

function handleZodError(err: ZodError): never {
  const details = err.issues.map((i) => ({
    field: i.path.join('.'),
    issue: i.code,
    message: i.message,
  }));
  throw AppError.of('VALIDATION_ERROR', 'Request validation failed.', details);
}

function getParam(req: Request, name: string): string {
  const val = req.params[name];
  if (!val || typeof val !== 'string') {
    throw AppError.of('VALIDATION_ERROR', `Missing required path parameter: ${name}`);
  }
  return val;
}

export function createRouter(deps: ApiDeps): Router {
  const router = Router();
  const repo = (deps.importRepository as ImportRepository) ?? new ImportRepository();
  const service = new ImportService(deps, repo);

  /**
   * POST /v1/imports: Upload file and create import batch
   */
  router.post('/imports', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);

    // Support Idempotency-Key
    const idempotencyKey = req.header('Idempotency-Key');

    let body;
    try {
      body = CreateImportSchema.parse(req.body);
    } catch (err: unknown) {
      if (err instanceof ZodError) return handleZodError(err);
      throw err;
    }

    const batch = await deps.txRunner.withTenantTx(ctx, (tx) => service.createImport(tx, ctx, body));

    if (idempotencyKey) {
      res.setHeader('Idempotent-Replayed', 'false');
    }
    res.status(201).json(batch);
  });

  /**
   * POST /v1/imports/:id/mapping: Configure column mapping and preview
   */
  router.post('/imports/:id/mapping', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const id = getParam(req, 'id');

    let body;
    try {
      body = ConfigureMappingSchema.parse(req.body);
    } catch (err: unknown) {
      if (err instanceof ZodError) return handleZodError(err);
      throw err;
    }

    const batch = await deps.txRunner.withTenantTx(ctx, (tx) => service.configureMapping(tx, ctx, id, body));

    res.status(200).json(batch);
  });

  /**
   * POST /v1/imports/:id/commit: Validate and import rows asynchronously
   */
  router.post('/imports/:id/commit', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const id = getParam(req, 'id');

    let body;
    try {
      body = CommitImportSchema.parse(req.body ?? {});
    } catch (err: unknown) {
      if (err instanceof ZodError) return handleZodError(err);
      throw err;
    }

    const batch = await deps.txRunner.withTenantTx(ctx, (tx) => service.commitImport(tx, ctx, id, body));

    res.status(200).json(batch);
  });

  /**
   * POST /v1/imports/:id/rollback: Roll back batch within 24 hours
   */
  router.post('/imports/:id/rollback', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const id = getParam(req, 'id');

    let body;
    try {
      body = RollbackImportSchema.parse(req.body ?? { reason: 'User requested rollback' });
    } catch (err: unknown) {
      if (err instanceof ZodError) return handleZodError(err);
      throw err;
    }

    const batch = await deps.txRunner.withTenantTx(ctx, (tx) => service.rollbackImport(tx, ctx, id, body));

    res.status(200).json(batch);
  });

  /**
   * GET /v1/imports/:id: Retrieve import batch details
   */
  router.get('/imports/:id', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const id = getParam(req, 'id');

    const batch = await deps.txRunner.withTenantTx(ctx, (tx) => service.getImportBatch(tx, ctx, id));

    res.status(200).json(batch);
  });

  /**
   * GET /v1/imports/:id/report: Download validation error report CSV
   */
  router.get('/imports/:id/report', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const id = getParam(req, 'id');

    const buffer = await deps.txRunner.withTenantTx(ctx, (tx) => service.getReport(tx, ctx, id));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="import_${id}_errors.csv"`);
    res.status(200).send(buffer);
  });

  /**
   * GET /v1/imports: List all import batches
   */
  router.get('/imports', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);

    const batches = await deps.txRunner.withTenantTx(ctx, (tx) => service.listBatches(tx, ctx));

    res.status(200).json({ data: batches });
  });

  return router;
}
